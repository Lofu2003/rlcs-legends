// Bot Ecosystem V13, Phase 24/25/26 -- PRE-FIX (V13-BASE-A/B/C) vs POST-FIX
// (V13-POST2-A/B/C) Vergleich: Verteilung, 99er-Seltenheit, Karriere-Realismus.
const fs = require('fs');
const path = require('path');
function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const preRuns = { A: loadRun('_auditv13_V13-BASE-A.json'), B: loadRun('_auditv13_V13-BASE-B.json'), C: loadRun('_auditv13_V13-BASE-C.json') };
const postRuns = { A: loadRun('_auditv13_V13-POST2-A.json'), B: loadRun('_auditv13_V13-POST2-B.json'), C: loadRun('_auditv13_V13-POST2-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p90: percentile(s, 0.9), p99: percentile(s, 0.99), n: s.length };
}
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
function pooledDist(runSet) {
  const out = {};
  CHECKPOINTS.forEach((season) => {
    const overalls = [], potentials = [];
    Object.values(runSet).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === season); if (snap) snap.players.forEach((p) => { overalls.push(p.overall); potentials.push(p.potential); }); });
    out[season] = { overalls, potentials };
  });
  return out;
}
const preDist = pooledDist(preRuns), postDist = pooledDist(postRuns);
const p99share = (arr) => arr.length ? round(100 * arr.filter((v) => v >= 99).length / arr.length, 1) : null;
const shareGe = (arr, t) => arr.length ? round(100 * arr.filter((v) => v >= t).length / arr.length, 1) : null;

console.log('=== PHASE 24: PRE-FIX vs POST-FIX Verteilung (S0-S50) ===');
CHECKPOINTS.forEach((season) => {
  const preOv = preDist[season].overalls, postOv = postDist[season].overalls;
  const prePot = preDist[season].potentials, postPot = postDist[season].potentials;
  if (!postOv.length) return;
  console.log('S' + season + ':');
  console.log('  Overall:   PRE  median=' + distStats(preOv).median + ' mean=' + distStats(preOv).mean + ' p10=' + distStats(preOv).p10 + ' p90=' + distStats(preOv).p90);
  console.log('             POST median=' + distStats(postOv).median + ' mean=' + distStats(postOv).mean + ' p10=' + distStats(postOv).p10 + ' p90=' + distStats(postOv).p90);
  console.log('  Potential: PRE  median=' + distStats(prePot).median + ' mean=' + distStats(prePot).mean);
  console.log('             POST median=' + distStats(postPot).median + ' mean=' + distStats(postPot).mean);
  console.log('  Potential99%: PRE=' + p99share(prePot) + ' POST=' + p99share(postPot) + ' | Overall99%: PRE=' + p99share(preOv) + ' POST=' + p99share(postOv));
});

console.log('\n=== PHASE 25: 99er-Seltenheit bei S50 (POST-FIX) ===');
{
  const ov = postDist[50].overalls, pot = postDist[50].potentials;
  console.log('Overall  >=90: ' + shareGe(ov, 90) + '%  >=95: ' + shareGe(ov, 95) + '%  >=98: ' + shareGe(ov, 98) + '%  >=99: ' + shareGe(ov, 99) + '%');
  console.log('Potential>=90: ' + shareGe(pot, 90) + '%  >=95: ' + shareGe(pot, 95) + '%  >=98: ' + shareGe(pot, 98) + '%  >=99: ' + shareGe(pot, 99) + '%');
}

console.log('\n=== Generation-Log nach Kategorie, POST-FIX ===');
{
  const allGen = [];
  Object.values(postRuns).forEach((d) => allGen.push(...d.generationLog));
  const byReason = {};
  allGen.forEach((g) => { byReason[g.creationReason] = byReason[g.creationReason] || []; byReason[g.creationReason].push(g); });
  Object.keys(byReason).forEach((reason) => {
    const arr = byReason[reason];
    console.log(reason + ': n=' + arr.length + ' avgPotential=' + round(arr.reduce((s, g) => s + g.potential, 0) / arr.length, 1) + ' %>=99=' + p99share(arr.map((g) => g.potential)) + '%');
  });
}

console.log('\n=== PHASE 26: Karriere-Realismus (POST-FIX, aus retirementLog) ===');
{
  const allRet = [];
  Object.values(postRuns).forEach((d) => allRet.push(...d.retirementLog));
  const withPeak = allRet.filter((r) => typeof r.peakOverall === 'number' && typeof r.peakAge === 'number');
  const peakAges = withPeak.map((r) => r.peakAge).sort((a, b) => a - b);
  const peakOveralls = withPeak.map((r) => r.peakOverall).sort((a, b) => a - b);
  const retOveralls = withPeak.map((r) => r.overall).sort((a, b) => a - b);
  const realizedAtCareerHigh = withPeak.filter((r) => r.overall >= r.peakOverall).length;
  console.log('n mit Peak-Tag=' + withPeak.length + '/' + allRet.length);
  console.log('Peak Age: median=' + percentile(peakAges, 0.5) + ' mean=' + round(peakAges.reduce((a, b) => a + b, 0) / peakAges.length, 1));
  console.log('Peak Overall: median=' + percentile(peakOveralls, 0.5));
  console.log('Retirement Overall: median=' + percentile(retOveralls, 0.5));
  console.log('Anteil bei Karriere-Hoehepunkt in Rente gegangen (Overall>=peakOverall): ' + round(100 * realizedAtCareerHigh / withPeak.length, 1) + '%');
  const busts = withPeak.filter((r) => r.potential >= 90 && r.peakOverall < 75);
  console.log('Busts (Potential>=90, aber PeakOverall<75): n=' + busts.length);
  const lateBloomers = withPeak.filter((r) => r.peakAge >= 30 && r.peakOverall >= 85);
  console.log('Late-Bloomer-Kandidaten (PeakAge>=30, PeakOverall>=85): n=' + lateBloomers.length);
}

console.log('\n=== pageErrors (POST-FIX) ===');
Object.keys(postRuns).forEach((k) => console.log(k + ':', postRuns[k].pageErrors ? postRuns[k].pageErrors.length : 'n/a'));
