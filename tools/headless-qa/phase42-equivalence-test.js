// Bot Ecosystem V13, Phase 42 -- Behavioral-Equivalence-Beweis fuer den
// scoreBotScrim()-Performance-Fix. Reiner Logiktest (kein Game-State noetig):
// testet die alte (chance zuerst berechnen, dann EINEN Zufallszug ziehen) und
// die neue (Zufallszug zuerst, dann bei Bedarf die teure Berechnung) Variante
// mit DEMSELBEN Zufallszug r ueber den gesamten gueltigen Parameterraum
// (idleFactor 0..1, morale 40..100 -- siehe TEAM_MORALE_BASE/WIN_RANGE in
// renderer.js) -- muss fuer JEDE Kombination identisch entscheiden.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOT_SCRIM_DAILY_CHANCE = 0.03;

function oldLogic(idleFactor, morale, r) {
  const moraleFactor = Math.max(0, (60 - morale) / 120);
  const chance = BOT_SCRIM_DAILY_CHANCE * (0.5 + idleFactor * 1.3 + moraleFactor);
  return r < chance;
}
function newLogic(idleFactor, morale, r) {
  const chanceUpperBound = BOT_SCRIM_DAILY_CHANCE * 2;
  if (r >= chanceUpperBound) return false;
  const moraleFactor = Math.max(0, (60 - morale) / 120);
  const chance = BOT_SCRIM_DAILY_CHANCE * (0.5 + idleFactor * 1.3 + moraleFactor);
  return r < chance;
}

const rng = mulberry32(0xC0FFEE);
const N = 5000000;
let mismatches = 0;
let oldTrueCount = 0, newTrueCount = 0;
let maxObservedChance = 0;
for (let i = 0; i < N; i++) {
  const idleFactor = rng();
  const morale = 40 + rng() * 60;
  const r = rng();
  const chance = BOT_SCRIM_DAILY_CHANCE * (0.5 + idleFactor * 1.3 + Math.max(0, (60 - morale) / 120));
  if (chance > maxObservedChance) maxObservedChance = chance;
  const o = oldLogic(idleFactor, morale, r);
  const n = newLogic(idleFactor, morale, r);
  if (o) oldTrueCount++;
  if (n) newTrueCount++;
  if (o !== n) mismatches++;
}
console.log('Trials:', N);
console.log('Max beobachtete chance (muss <= chanceUpperBound=' + (BOT_SCRIM_DAILY_CHANCE * 2) + ' sein):', maxObservedChance);
console.log('OLD true count:', oldTrueCount, 'NEW true count:', newTrueCount);
console.log('Mismatches (MUSS 0 sein fuer Behavioral Equivalence):', mismatches);
console.log(mismatches === 0 ? 'PASS: mathematisch exakt aequivalent.' : 'FAIL: Verhaltensaenderung entdeckt!');
