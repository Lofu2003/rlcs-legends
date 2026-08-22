// Bot Ecosystem V13, Phase 15/17/18/19 -- Root-Cause-Begleitanalysen auf Basis
// der PRE-FIX-Baseline (V13-BASE-A/B/C, bereits abgeschlossen). Phase 16
// (Transfer-Selektion) fehlt hier bewusst -- dafuer wird transferLog benoetigt,
// das erst im neuen phase2-forensics-v13.js-Lauf miterfasst wird.
const fs = require('fs');
const path = require('path');
function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv13_V13-BASE-A.json'), B: loadRun('_auditv13_V13-BASE-B.json'), C: loadRun('_auditv13_V13-BASE-C.json') };
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

let allGen = [], allRet = [];
Object.values(runs).forEach((d) => { allGen.push(...d.generationLog); allRet.push(...d.retirementLog); });

console.log('=== PHASE 15: Survivorship -- ALLE ERZEUGTEN vs AKTIV bei S50 (Potential-Verteilung) ===');
{
  const genPot = allGen.map((g) => g.potential);
  const s50Pot = [];
  Object.values(runs).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === 50); if (snap) snap.players.forEach((p) => s50Pot.push(p.potential)); });
  const p99 = (arr) => round(100 * arr.filter((v) => v >= 99).length / arr.length, 1);
  console.log('ALLE ERZEUGT (n=' + genPot.length + '): %Potential99=' + p99(genPot) + ' avgPotential=' + round(genPot.reduce((s, v) => s + v, 0) / genPot.length, 1));
  console.log('AKTIV BEI S50 (n=' + s50Pot.length + '): %Potential99=' + p99(s50Pot) + ' avgPotential=' + round(s50Pot.reduce((s, v) => s + v, 0) / s50Pot.length, 1));
  console.log('-> Differenz zeigt, ob hohe Potential-Spieler ueberproportional AKTIV BLEIBEN (Survivorship) statt gleichverteilt auszuscheiden.');
}

console.log('\n=== PHASE 17: Karrierelaenge nach Potential-Tier (aus retirementLog, birthSeason vorhanden) ===');
{
  const withBirth = allRet.filter((r) => typeof r.birthSeason === 'number');
  const tiers = [[0, 70, '<70'], [70, 80, '70-79'], [80, 90, '80-89'], [90, 95, '90-94'], [95, 99, '95-98'], [99, 100, '99']];
  tiers.forEach(([lo, hi, label]) => {
    const inTier = withBirth.filter((r) => r.potential >= lo && r.potential < hi);
    if (inTier.length === 0) { console.log('Potential ' + label + ': n=0'); return; }
    const lengths = inTier.map((r) => r.season - r.birthSeason).filter((v) => v >= 0);
    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)] || 0;
    console.log('Potential ' + label + ': n=' + inTier.length + ' (mit birthSeason-Tag, von ' + withBirth.length + '/' + allRet.length + ' Retirements gesamt) medianCareerLength=' + median + ' Saisons');
  });
}

console.log('\n=== PHASE 18: 99er-Zufluss (Generation) vs -Abfluss (Retirement) pro Saison ===');
{
  const genBySeasn = {}, retBySeasn = {};
  allGen.filter((g) => g.potential >= 99).forEach((g) => { genBySeasn[g.birthSeason] = (genBySeasn[g.birthSeason] || 0) + 1; });
  allRet.filter((r) => r.potential >= 99).forEach((r) => { retBySeasn[r.season] = (retBySeasn[r.season] || 0) + 1; });
  let cumGen = 0, cumRet = 0;
  for (let s = 0; s <= 50; s++) {
    cumGen += genBySeasn[s] || 0;
    cumRet += retBySeasn[s] || 0;
    if (s % 10 === 0 || s === 50) console.log('S' + s + ': kumulativ generiert(99)=' + cumGen + ' kumulativ ausgeschieden(99)=' + cumRet + ' Netto-Bestand=' + (cumGen - cumRet));
  }
}

console.log('\n=== PHASE 19: Equilibrium-Schaetzung (Generationsrate vs Retirement-Rate, letzte 20 Saisons) ===');
{
  const genLate = allGen.filter((g) => g.birthSeason >= 30 && g.birthSeason <= 50);
  const retLate = allRet.filter((r) => r.season >= 30 && r.season <= 50);
  const genRate99 = genLate.filter((g) => g.potential >= 99).length / 20;
  const retRate99 = retLate.filter((r) => r.potential >= 99).length / 20;
  console.log('Generationsrate Potential99 (S30-50, pro Saison, gepoolt 3 Laeufe): ' + round(genRate99, 2));
  console.log('Retirement-Rate Potential99 (S30-50, pro Saison, gepoolt 3 Laeufe): ' + round(retRate99, 2));
  console.log('-> Wenn Generationsrate > Retirement-Rate: Bestand waechst noch (kein Gleichgewicht bei S50 erreicht). Verhaeltnis: ' + round(genRate99 / (retRate99 || 1), 2) + 'x');
}
