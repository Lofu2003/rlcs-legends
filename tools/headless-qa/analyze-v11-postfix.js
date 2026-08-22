// Bot Ecosystem V11 -- Phase 43/46-49/55/56 Analyse ueber die 3 POST-FIX-1-
// Laeufe (V11-POST-A/B/C, 3 NEUE Seeds, 50 Saisons, mit Root-Cause-#1-Fix
// "qualityStars aus breiter Org/Vorgaenger-unabhaengiger Lotterie" aktiv).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const preRuns = { A: loadRun('_auditv11_V11-BASE-A.json'), B: loadRun('_auditv11_V11-BASE-B.json'), C: loadRun('_auditv11_V11-BASE-C.json') };
const runs = { A: loadRun('_auditv11_V11-POST-A.json'), B: loadRun('_auditv11_V11-POST-B.json'), C: loadRun('_auditv11_V11-POST-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p25: percentile(s, 0.25), p75: percentile(s, 0.75), p90: percentile(s, 0.9), p95: percentile(s, 0.95), p99: percentile(s, 0.99), n: s.length };
}
function pearson(xs, ys) {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2 || 1);
}

const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
const distAt = {}, preDistAt = {};
CHECKPOINTS.forEach((season) => {
  const overalls = [], potentials = [];
  Object.values(runs).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === season); if (snap) snap.players.forEach((p) => { overalls.push(p.overall); potentials.push(p.potential); }); });
  distAt[season] = { overalls, potentials };
  const preOveralls = [], prePotentials = [];
  Object.values(preRuns).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === season); if (snap) snap.players.forEach((p) => { preOveralls.push(p.overall); prePotentials.push(p.potential); }); });
  preDistAt[season] = { overalls: preOveralls, potentials: prePotentials };
});

// ============================================================
// PHASE 43 -- Re-Measure (Median/P90/P99/99-Anteil/Potential99-Anteil, PRE vs POST).
// ============================================================
console.log('=== PHASE 43: Re-Measure (PRE-FIX vs POST-FIX) ===');
CHECKPOINTS.forEach((season) => {
  const preOv = preDistAt[season].overalls, postOv = distAt[season].overalls;
  const prePt = preDistAt[season].potentials, postPt = distAt[season].potentials;
  if (!postOv.length) return;
  const p99Share = (arr) => round(100 * arr.filter((v) => v >= 99).length / arr.length, 1);
  console.log('S' + season + ' Overall: PRE median=' + distStats(preOv).median + ' POST median=' + distStats(postOv).median + ' | PRE P90=' + distStats(preOv).p90 + ' POST P90=' + distStats(postOv).p90);
  console.log('       Potential=99 Anteil: PRE=' + p99Share(prePt) + '% POST=' + p99Share(postPt) + '%');
});

// ============================================================
// PHASE 46 -- Stationarity (S20/S30/S40/S50, POST-FIX).
// ============================================================
console.log('\n=== PHASE 46: Stationarity Check (POST-FIX, Median Overall) ===');
[20, 30, 40, 50].forEach((season) => {
  const ov = distAt[season].overalls;
  if (!ov.length) return;
  console.log('S' + season + ': median=' + distStats(ov).median + ' mean=' + distStats(ov).mean);
});

// ============================================================
// PHASE 7/8 Re-Check -- Korrelation Retired Overall vs Replacement
// Potential, POST-FIX (Wirksamkeitsnachweis Fix #1).
// ============================================================
console.log('\n=== Fix #1 Wirksamkeitsnachweis: Retirement->Replacement-Korrelation POST-FIX ===');
const allGen = [], allRet = [];
Object.values(runs).forEach((d) => { allGen.push(...d.generationLog); allRet.push(...d.retirementLog); });
const genByKey = new Map();
allGen.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT').forEach((g) => {
  const key = g.org + '::' + g.role + '::' + g.birthSeason;
  if (!genByKey.has(key)) genByKey.set(key, []);
  genByKey.get(key).push(g);
});
const pairs = [];
allRet.forEach((r) => {
  const key = r.orgName + '::' + r.role + '::' + r.season;
  const cands = genByKey.get(key);
  if (cands && cands.length) { const repl = cands.shift(); pairs.push({ retiredOverall: r.overall, replPotential: repl.potential }); }
});
console.log('Gematchte Paare (POST-FIX):', pairs.length);
if (pairs.length > 10) console.log('Pearson-Korrelation POST-FIX:', round(pearson(pairs.map((p) => p.retiredOverall), pairs.map((p) => p.replPotential)), 3), '(PRE-FIX war 0.825)');
const rrGen = allGen.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT');
console.log('avgReplacementPotential POST-FIX:', round(rrGen.reduce((s, g) => s + g.potential, 0) / rrGen.length, 1), '(PRE-FIX war 94.2, INITIAL war 79.7)');
console.log('\nGenerationen-Trend POST-FIX (avgPotential nach Geburts-Dekade):');
const decades = {};
rrGen.forEach((g) => { const dd = Math.floor(g.birthSeason / 10) * 10; if (!decades[dd]) decades[dd] = []; decades[dd].push(g.potential); });
Object.keys(decades).sort((a, b) => a - b).forEach((dd) => { const arr = decades[dd]; console.log('Saisons ' + dd + '-' + (Number(dd) + 9) + ' (n=' + arr.length + '): avgPotential=' + round(arr.reduce((a, b) => a + b, 0) / arr.length, 1)); });

// ============================================================
// AGE DECLINE Re-Check (Phase 16/17, POST-FIX) -- unveraendert erwartet, da
// Fix #1 NICHT die Entwicklungs-/Alterslogik beruehrt. Dient als Grundlage
// fuer die Phase-44-Entscheidung (zweiter Fix noetig?).
// ============================================================
console.log('\n=== AGE DECLINE Re-Check (POST-FIX, sollte strukturell unveraendert sein) ===');
const withPeak = allRet.filter((r) => r.peakOverall !== undefined && r.peakAge !== undefined);
console.log('Faelle mit Karrieredaten:', withPeak.length);
if (withPeak.length > 20) {
  console.log('Anteil auf Career-High bei Rente:', round(100 * withPeak.filter((r) => r.overall >= r.peakOverall).length / withPeak.length, 1) + '%');
  [35, 37, 39].forEach((minAge) => {
    const sel = withPeak.filter((r) => r.age >= minAge);
    if (!sel.length) return;
    console.log(minAge + '+ (n=' + sel.length + '): ' + round(100 * sel.filter((r) => r.overall >= r.peakOverall).length / sel.length, 1) + '% auf Career-High');
  });
}

// ============================================================
// PHASE 47 -- Generational Diversity (Buckets bei S50, POST-FIX).
// ============================================================
console.log('\n=== PHASE 47: Generational Diversity (S50, POST-FIX) ===');
const ov50 = distAt[50] ? distAt[50].overalls : [];
if (ov50.length) {
  const buckets = { u50: 0, b50: 0, b60: 0, b70: 0, b80: 0, b90: 0, b95: 0, p99: 0 };
  ov50.forEach((v) => { if (v < 50) buckets.u50++; else if (v < 60) buckets.b50++; else if (v < 70) buckets.b60++; else if (v < 80) buckets.b70++; else if (v < 90) buckets.b80++; else if (v < 95) buckets.b90++; else if (v < 99) buckets.b95++; else buckets.p99++; });
  console.log('S50 Overall-Buckets:', JSON.stringify(buckets));
}

// ============================================================
// PHASE 48 -- Superstar Count (90+/95+/98+/99, S0 vs S50, POST-FIX).
// ============================================================
console.log('\n=== PHASE 48: Superstar Count (POST-FIX) ===');
[0, 20, 50].forEach((season) => {
  const ov = distAt[season] ? distAt[season].overalls : [];
  if (!ov.length) return;
  const c90 = ov.filter((v) => v >= 90).length, c95 = ov.filter((v) => v >= 95).length, c98 = ov.filter((v) => v >= 98).length, c99 = ov.filter((v) => v >= 99).length;
  console.log('S' + season + ' (n=' + ov.length + '): 90+=' + c90 + ' (' + round(100 * c90 / ov.length, 1) + '%) 95+=' + c95 + ' (' + round(100 * c95 / ov.length, 1) + '%) 98+=' + c98 + ' (' + round(100 * c98 / ov.length, 1) + '%) 99=' + c99 + ' (' + round(100 * c99 / ov.length, 1) + '%)');
});

// ============================================================
// PHASE 49 -- Career Stories (20 Beispiele aus retirementLog, POST-FIX).
// ============================================================
console.log('\n=== PHASE 49: Career Stories (POST-FIX, aus echten Retirements gezogen) ===');
const complete = withPeak.filter((r) => r.creationReason && r.season - r.birthSeason >= 3);
const superstars = complete.filter((r) => r.peakOverall >= 97).slice(0, 5);
const average = complete.filter((r) => r.peakOverall >= 75 && r.peakOverall < 90).slice(0, 5);
const busts = complete.filter((r) => r.potential - r.overall >= 8).slice(0, 5);
const unusual = complete.filter((r) => (r.season - r.birthSeason) >= 18 || (r.season - r.birthSeason) <= 5).slice(0, 5);
function fmt(r) { return r.personName + ' (' + r.orgName + ', ' + r.role + '): geboren S' + r.birthSeason + ' [' + r.creationReason + '], Rente S' + r.season + ' im Alter ' + r.age + ', Karrierelaenge=' + (r.season - r.birthSeason) + ', PeakOverall=' + r.peakOverall + ' bei Alter ' + r.peakAge + ', finales Potential=' + r.potential; }
console.log('-- 5 Superstars --'); superstars.forEach((r) => console.log(fmt(r)));
console.log('-- 5 Durchschnittsspieler --'); average.forEach((r) => console.log(fmt(r)));
console.log('-- 5 Busts (grosse Potential-Overall-Luecke am Karriereende) --'); busts.forEach((r) => console.log(fmt(r)));
console.log('-- 5 ungewoehnliche Verlaeufe (sehr kurz/sehr lang) --'); unusual.forEach((r) => console.log(fmt(r)));

// ============================================================
// PHASE 55/56 -- Tournaments (Rang-1-Wechsel) & Competitive Mobility.
// ============================================================
console.log('\n=== PHASE 55: Titles/Rang-1-Wechsel (POST-FIX) ===');
Object.entries(runs).forEach(([k, d]) => {
  const rank1PerCheckpoint = d.powerSnapshots.map((s) => { const r1 = [...s.rows].sort((a, b) => a.rank - b.rank)[0]; return r1 ? r1.name : null; });
  console.log('Run ' + k + ':', JSON.stringify(rank1PerCheckpoint));
});
console.log('\n=== PHASE 56: Competitive Mobility (POST-FIX, Bottom/Mid/Top S0->S20->S50) ===');
['bottom10', 'mid10', 'top10'].forEach((cohortKey) => {
  const label = cohortKey.replace('10', '');
  let s0Ranks = [], s20Ranks = [], sLastRanks = [];
  Object.values(runs).forEach((d) => {
    const s0 = d.powerSnapshots.find((p) => p.season === 0);
    const s20 = d.powerSnapshots.find((p) => p.season === 20);
    const last = d.powerSnapshots[d.powerSnapshots.length - 1];
    d.setup[cohortKey].forEach((name) => {
      const r0 = s0.rows.find((r) => r.name === name), r20 = s20 && s20.rows.find((r) => r.name === name), rL = last.rows.find((r) => r.name === name);
      if (r0) s0Ranks.push(r0.rank); if (r20) s20Ranks.push(r20.rank); if (rL) sLastRanks.push(rL.rank);
    });
  });
  const avg = (a) => round(a.reduce((s, v) => s + v, 0) / (a.length || 1), 1);
  console.log(label + ': ØRang S0=' + avg(s0Ranks) + ' S20=' + avg(s20Ranks) + ' S50=' + avg(sLastRanks));
});

console.log('\n[Analyse Post-Fix abgeschlossen]');
