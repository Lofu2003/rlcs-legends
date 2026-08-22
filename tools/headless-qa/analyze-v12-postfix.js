// Bot Ecosystem V12 -- Analyse ueber die 3 POST-FIX-Laeufe (V12-POST-A/B/C,
// 3 NEUE Seeds, 50 Saisons, mit V12 Fix #1 "Transfer-Backfill-Generational-
// Lock entfernt" UND Bot-Scrim-KI beide aktiv).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const preRuns = { A: loadRun('_auditv12_V12-BASE-A.json'), B: loadRun('_auditv12_V12-BASE-B.json'), C: loadRun('_auditv12_V12-BASE-C.json') };
const runs = { A: loadRun('_auditv12_V12-POST-A.json'), B: loadRun('_auditv12_V12-POST-B.json'), C: loadRun('_auditv12_V12-POST-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p90: percentile(s, 0.9), n: s.length };
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
const preDist = pooledDist(preRuns), postDist = pooledDist(runs);

console.log('=== Re-Measure: PRE-FIX vs POST-FIX (Median Overall, Potential=99%, S0-S50) ===');
CHECKPOINTS.forEach((season) => {
  const preOv = preDist[season].overalls, postOv = postDist[season].overalls;
  if (!postOv.length) return;
  const p99share = (arr) => arr.length ? round(100 * arr.filter((v) => v >= 99).length / arr.length, 1) : null;
  console.log('S' + season + ': MedianOverall PRE=' + distStats(preOv).median + ' POST=' + distStats(postOv).median +
    ' | Potential99% PRE=' + p99share(preDist[season].potentials) + ' POST=' + p99share(postDist[season].potentials) +
    ' | Overall99% PRE=' + p99share(preOv) + ' POST=' + p99share(postOv));
});

console.log('\n=== Fix #1 Wirksamkeitsnachweis: TRANSFER_BACKFILL Potential POST-FIX ===');
{
  const allGen = [];
  Object.values(runs).forEach((d) => allGen.push(...d.generationLog));
  const tb = allGen.filter((g) => g.creationReason === 'TRANSFER_BACKFILL');
  const rr = allGen.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT');
  console.log('TRANSFER_BACKFILL (n=' + tb.length + '): avgPotential=' + round(tb.reduce((s, g) => s + g.potential, 0) / tb.length, 1) + ' %>=99=' + round(100 * tb.filter((g) => g.potential >= 99).length / tb.length, 1) + '  (PRE-FIX war 97.6 / 79.3%)');
  console.log('RETIREMENT_REPLACEMENT (n=' + rr.length + '): avgPotential=' + round(rr.reduce((s, g) => s + g.potential, 0) / rr.length, 1) + ' %>=99=' + round(100 * rr.filter((g) => g.potential >= 99).length / rr.length, 1));
}

console.log('\n=== Stationarity Check (POST-FIX, Median/Mean Overall) ===');
[20, 30, 40, 50].forEach((season) => {
  const ov = postDist[season].overalls;
  if (!ov.length) return;
  console.log('S' + season + ': median=' + distStats(ov).median + ' mean=' + distStats(ov).mean);
});

console.log('\n=== Superstar Rarity (POST-FIX, S50) ===');
{
  const ov = postDist[50].overalls;
  const c90 = ov.filter((v) => v >= 90).length, c95 = ov.filter((v) => v >= 95).length, c98 = ov.filter((v) => v >= 98).length, c99 = ov.filter((v) => v >= 99).length;
  console.log('n=' + ov.length + ' 90+=' + round(100 * c90 / ov.length, 1) + '% 95+=' + round(100 * c95 / ov.length, 1) + '% 98+=' + round(100 * c98 / ov.length, 1) + '% 99=' + round(100 * c99 / ov.length, 1) + '%');
  const pt = postDist[50].potentials;
  console.log('Potential=99: ' + round(100 * pt.filter((v) => v === 99).length / pt.length, 1) + '%');
}

console.log('\n=== Career Decline (POST-FIX, sollte unveraendert von V11 bleiben) ===');
{
  const allRet = [];
  Object.values(runs).forEach((d) => allRet.push(...d.retirementLog));
  const withPeak = allRet.filter((r) => r.peakOverall !== undefined);
  console.log('n=' + withPeak.length + ' Career-High-Anteil=' + round(100 * withPeak.filter((r) => r.overall >= r.peakOverall).length / withPeak.length, 1) + '%');
}

console.log('\n=== Competitive Mobility (POST-FIX, Bottom/Mid/Top S0->S20->S50) ===');
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

console.log('\n=== New Elite (POST-FIX, Top5 bei S50, war nicht Top50 bei S0) ===');
Object.entries(runs).forEach(([k, d]) => {
  const s0 = d.powerSnapshots.find((p) => p.season === 0);
  const last = d.powerSnapshots[d.powerSnapshots.length - 1];
  const top50S0 = new Set([...s0.rows].sort((a, b) => a.rank - b.rank).slice(0, 50).map((r) => r.name));
  const top5Last = [...last.rows].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const newElite = top5Last.filter((r) => !top50S0.has(r.name));
  console.log('Run ' + k + ' neue Top5:', JSON.stringify(newElite.map((r) => r.name)));
});

console.log('\n=== Top Decline (POST-FIX, urspruengliche Top10) ===');
{
  let stats = { belowTop50: 0, belowTop100: 0, belowTop200: 0, belowTop300: 0, total: 0 };
  Object.values(runs).forEach((d) => {
    d.setup.top10.forEach((name) => {
      stats.total++;
      let worstRank = 0;
      d.powerSnapshots.forEach((s) => { const row = s.rows.find((r) => r.name === name); if (row && row.rank > worstRank) worstRank = row.rank; });
      if (worstRank > 50) stats.belowTop50++; if (worstRank > 100) stats.belowTop100++; if (worstRank > 200) stats.belowTop200++; if (worstRank > 300) stats.belowTop300++;
    });
  });
  console.log(JSON.stringify(stats));
}

console.log('\n=== Dynasties (POST-FIX, Rang-1 je Checkpoint) ===');
Object.entries(runs).forEach(([k, d]) => {
  const rank1PerCheckpoint = d.powerSnapshots.map((s) => { const r1 = [...s.rows].sort((a, b) => a.rank - b.rank)[0]; return r1 ? r1.name : null; });
  console.log('Run ' + k + ':', JSON.stringify(rank1PerCheckpoint));
});

console.log('\n=== Economy Regression (POST-FIX, S50) ===');
{
  const rows = [];
  Object.values(runs).forEach((d) => { const s = d.powerSnapshots.find((p) => p.season === 50); if (s) rows.push(...s.rows); });
  const budgets = rows.map((r) => r.budget).sort((a, b) => a - b);
  const n = budgets.length;
  const mean = budgets.reduce((a, b) => a + b, 0) / n;
  let giniSum = 0;
  for (let i = 0; i < n; i++) giniSum += (2 * (i + 1) - n - 1) * budgets[i];
  const gini = giniSum / (n * budgets.reduce((s, b) => s + Math.max(0, b), 0) || 1);
  const negCount = rows.filter((r) => r.budget < 0).length;
  console.log(JSON.stringify({ n, mean: Math.round(mean), median: percentile(budgets, 0.5), p90: percentile(budgets, 0.9), gini: round(gini, 3), negativeBudgets: negCount }));
}

console.log('\n=== Staff Market (POST-FIX, S50) ===');
{
  const byRole = {};
  Object.values(runs).forEach((d) => { const s = d.staffSnapshots.find((x) => x.season === 50); if (s) s.rows.forEach((r) => { byRole[r.role] = (byRole[r.role] || 0) + 1; }); });
  console.log('Besetzte Rollen (von max 3*454=1362 je Rolle):', JSON.stringify(byRole));
}

console.log('\n[Analyse Post-Fix abgeschlossen]');
