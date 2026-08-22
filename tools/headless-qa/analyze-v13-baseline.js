// Bot Ecosystem V13, Phase 1 -- Bestaetigung des V12-Post-Fix-Zustands ueber
// 3 NEUE Seeds (V13-BASE-A/B/C, 50 Saisons, UNVERAENDERTER V12-Code zum
// Zeitpunkt des Laufs). Erwartung laut Auftrag: Median Overall~92, Mean~87,
// Potential99~47%, Overall99~27%.
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv13_V13-BASE-A.json'), B: loadRun('_auditv13_V13-BASE-B.json'), C: loadRun('_auditv13_V13-BASE-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p90: percentile(s, 0.9), n: s.length };
}

const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
function pooledDist() {
  const out = {};
  CHECKPOINTS.forEach((season) => {
    const overalls = [], potentials = [];
    Object.values(runs).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === season); if (snap) snap.players.forEach((p) => { overalls.push(p.overall); potentials.push(p.potential); }); });
    out[season] = { overalls, potentials };
  });
  return out;
}
const dist = pooledDist();

console.log('=== PHASE 1: V12-Baseline-Bestaetigung (3 neue Seeds, gepoolt) ===');
CHECKPOINTS.forEach((season) => {
  const ov = dist[season].overalls, pot = dist[season].potentials;
  if (!ov.length) return;
  const p99share = (arr) => arr.length ? round(100 * arr.filter((v) => v >= 99).length / arr.length, 1) : null;
  console.log('S' + season + ': n=' + ov.length + ' MedianOverall=' + distStats(ov).median + ' MeanOverall=' + distStats(ov).mean +
    ' | Potential99%=' + p99share(pot) + ' | Overall99%=' + p99share(ov));
});

console.log('\n=== Erwartung laut Auftrag (S50): Median~92 Mean~87 Potential99~47% Overall99~27% ===');

console.log('\n=== Generation-Log: Anzahl je Kategorie (gepoolt, alle 3 Laeufe) ===');
{
  const allGen = [];
  Object.values(runs).forEach((d) => allGen.push(...d.generationLog));
  const byReason = {};
  allGen.forEach((g) => { byReason[g.creationReason] = byReason[g.creationReason] || []; byReason[g.creationReason].push(g); });
  Object.keys(byReason).forEach((reason) => {
    const arr = byReason[reason];
    const p99 = round(100 * arr.filter((g) => g.potential >= 99).length / arr.length, 1);
    console.log(reason + ': n=' + arr.length + ' avgPotential=' + round(arr.reduce((s, g) => s + g.potential, 0) / arr.length, 1) + ' %>=99=' + p99 + '%');
  });
}

console.log('\n=== pageErrors ===');
Object.keys(runs).forEach((k) => console.log(k + ':', runs[k].pageErrors ? runs[k].pageErrors.length : runs[k].errors.length));
