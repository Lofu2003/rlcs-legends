// Bot Ecosystem V11 -- Analyse ueber die 3 POST-FIX-2-Laeufe (V11-POST2-A/B/C,
// 3 NEUE Seeds, 50 Saisons, mit Fix #1 (Generational Lock) UND Fix #2 (Age
// Decline) beide aktiv). Vergleicht PRE-FIX / POST-FIX-1 / POST-FIX-2.
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const preRuns = { A: loadRun('_auditv11_V11-BASE-A.json'), B: loadRun('_auditv11_V11-BASE-B.json'), C: loadRun('_auditv11_V11-BASE-C.json') };
const post1Runs = { A: loadRun('_auditv11_V11-POST-A.json'), B: loadRun('_auditv11_V11-POST-B.json'), C: loadRun('_auditv11_V11-POST-C.json') };
const runs = { A: loadRun('_auditv11_V11-POST2-A.json'), B: loadRun('_auditv11_V11-POST2-B.json'), C: loadRun('_auditv11_V11-POST2-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p25: percentile(s, 0.25), p75: percentile(s, 0.75), p90: percentile(s, 0.9), p95: percentile(s, 0.95), p99: percentile(s, 0.99), n: s.length };
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
const preDist = pooledDist(preRuns), post1Dist = pooledDist(post1Runs), postDist = pooledDist(runs);

// ============================================================
// Drei-Wege-Vergleich: Median/P90 Overall, Potential=99-Anteil.
// ============================================================
console.log('=== Drei-Wege-Vergleich: PRE-FIX / POST-FIX-1 / POST-FIX-2 (Median Overall, Potential=99%) ===');
CHECKPOINTS.forEach((season) => {
  const pre = preDist[season].overalls, p1 = post1Dist[season].overalls, p2 = postDist[season].overalls;
  if (!p2.length) return;
  const p99share = (arr) => arr.length ? round(100 * arr.filter((v) => v >= 99).length / arr.length, 1) : null;
  console.log('S' + season + ': MedianOverall PRE=' + distStats(pre).median + ' POST1=' + distStats(p1).median + ' POST2=' + distStats(p2).median +
    ' | Potential99% PRE=' + p99share(preDist[season].potentials) + ' POST1=' + p99share(post1Dist[season].potentials) + ' POST2=' + p99share(postDist[season].potentials));
});

// ============================================================
// AGE DECLINE Wirksamkeitsnachweis (Career-High-Anteil, PRE/POST1/POST2).
// ============================================================
console.log('\n=== Fix #2 Wirksamkeitsnachweis: Anteil auf Career-High bei Rente ===');
function atHighShare(runSet) {
  const allRet = [];
  Object.values(runSet).forEach((d) => allRet.push(...d.retirementLog));
  const withPeak = allRet.filter((r) => r.peakOverall !== undefined);
  const onHigh = withPeak.filter((r) => r.overall >= r.peakOverall).length;
  return { n: withPeak.length, pct: withPeak.length ? round(100 * onHigh / withPeak.length, 1) : null, allRet, withPeak };
}
const preHigh = atHighShare(preRuns), post1High = atHighShare(post1Runs), postHigh = atHighShare(runs);
console.log('PRE-FIX:', preHigh.pct + '% (n=' + preHigh.n + ')');
console.log('POST-FIX-1:', post1High.pct + '% (n=' + post1High.n + ')');
console.log('POST-FIX-2:', postHigh.pct + '% (n=' + postHigh.n + ')');
console.log('\nNach Alter bei Rente (POST-FIX-2):');
[35, 37, 39].forEach((minAge) => {
  const sel = postHigh.withPeak.filter((r) => r.age >= minAge);
  if (!sel.length) return;
  console.log(minAge + '+ (n=' + sel.length + '): ' + round(100 * sel.filter((r) => r.overall >= r.peakOverall).length / sel.length, 1) + '% auf Career-High');
});
console.log('\nPeak-Age Verteilung POST-FIX-2:', JSON.stringify(distStats(postHigh.withPeak.map((r) => r.peakAge))));
console.log('Karrierelaenge POST-FIX-2:', JSON.stringify(distStats(postHigh.withPeak.map((r) => r.season - r.birthSeason))));
console.log('Overall-Rueckgang Peak->Rente (nur Faelle mit echtem Rueckgang), POST-FIX-2:');
const declined = postHigh.withPeak.filter((r) => r.overall < r.peakOverall);
console.log('Anteil mit Rueckgang:', round(100 * declined.length / postHigh.withPeak.length, 1) + '%', 'ØRueckgang:', declined.length ? round(declined.reduce((s, r) => s + (r.peakOverall - r.overall), 0) / declined.length, 2) : 0);

// ============================================================
// Stationarity (POST-FIX-2, S20/30/40/50).
// ============================================================
console.log('\n=== Stationarity Check (POST-FIX-2) ===');
[20, 30, 40, 50].forEach((season) => {
  const ov = postDist[season].overalls;
  if (!ov.length) return;
  console.log('S' + season + ': median=' + distStats(ov).median + ' mean=' + distStats(ov).mean);
});

// ============================================================
// Superstar Count + Generational Diversity (POST-FIX-2, S50).
// ============================================================
console.log('\n=== Superstar Count & Diversity (POST-FIX-2, S50) ===');
const ov50 = postDist[50] ? postDist[50].overalls : [];
if (ov50.length) {
  const buckets = { u50: 0, b50: 0, b60: 0, b70: 0, b80: 0, b90: 0, b95: 0, p99: 0 };
  ov50.forEach((v) => { if (v < 50) buckets.u50++; else if (v < 60) buckets.b50++; else if (v < 70) buckets.b60++; else if (v < 80) buckets.b70++; else if (v < 90) buckets.b80++; else if (v < 95) buckets.b90++; else if (v < 99) buckets.b95++; else buckets.p99++; });
  console.log('S50 Buckets:', JSON.stringify(buckets));
  const c90 = ov50.filter((v) => v >= 90).length, c95 = ov50.filter((v) => v >= 95).length, c99 = ov50.filter((v) => v >= 99).length;
  console.log('90+=' + round(100 * c90 / ov50.length, 1) + '% 95+=' + round(100 * c95 / ov50.length, 1) + '% 99=' + round(100 * c99 / ov50.length, 1) + '%');
}

// ============================================================
// Competitive Mobility (POST-FIX-2).
// ============================================================
console.log('\n=== Competitive Mobility (POST-FIX-2, Bottom/Mid/Top S0->S20->S50) ===');
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

// ============================================================
// Economy Regression (POST-FIX-2, S50).
// ============================================================
console.log('\n=== Economy Regression (POST-FIX-2, S50) ===');
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
  console.log(JSON.stringify({ n, mean: Math.round(mean), median: percentile(budgets, 0.5), p90: percentile(budgets, 0.9), p99: percentile(budgets, 0.99), gini: round(gini, 3), negativeBudgets: negCount }));
}

// ============================================================
// Staff Market (POST-FIX-2, S50).
// ============================================================
console.log('\n=== Staff Market (POST-FIX-2, S50) ===');
{
  const byRole = {};
  Object.values(runs).forEach((d) => { const s = d.staffSnapshots.find((x) => x.season === 50); if (s) s.rows.forEach((r) => { byRole[r.role] = (byRole[r.role] || 0) + 1; }); });
  console.log('Besetzte Rollen (von max 3*454=1362 je Rolle):', JSON.stringify(byRole));
}

console.log('\n[Analyse Post-Fix-2 abgeschlossen]');
