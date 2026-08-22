// Bot Ecosystem V10 -- Phase 48-56 Analyse ueber die 3 POST-FIX-Laeufe
// (V10-POST-A/B/C, 3 NEUE Seeds, 20 Saisons, mit dem Root-Cause-#1-Fix
// "scoreBotStaffUpgrade() ohne goal==='REBUILD'-Sperre" aktiv).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const preRuns = { A: loadRun('_auditv10_V10-BASE-A.json'), B: loadRun('_auditv10_V10-BASE-B.json'), C: loadRun('_auditv10_V10-BASE-C.json') };
const runs = { A: loadRun('_auditv10_V10-POST-A.json'), B: loadRun('_auditv10_V10-POST-B.json'), C: loadRun('_auditv10_V10-POST-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function stats(nums) { const s = [...nums].sort((a, b) => a - b); return { p10: percentile(s, 0.1), median: percentile(s, 0.5), p90: percentile(s, 0.9), p99: percentile(s, 0.99), n: s.length }; }

const powerAt = {};
[0, 1, 2, 3, 5, 10, 15, 20].forEach((season) => {
  const rows = [];
  Object.values(runs).forEach((d) => { const snap = d.powerSnapshots.find((p) => p.season === season); if (snap) rows.push(...snap.rows); });
  powerAt[season] = rows;
});

// ============================================================
// PHASE 48 -- Strength Percentile Mobility (Bottom10, POST-FIX vs PRE-FIX).
// ============================================================
console.log('=== PHASE 48: Strength Percentile Mobility (Bottom10, POST-FIX) ===');
function percentileRank(rows, name) {
  const sorted = [...rows].sort((a, b) => a.strength - b.strength);
  const idx = sorted.findIndex((r) => r.name === name);
  return idx === -1 ? null : round(100 * idx / (sorted.length - 1), 1);
}
const percMobility = [];
Object.entries(runs).forEach(([k, d]) => {
  d.setup.bottom10.forEach((name) => {
    const row = { run: k, org: name };
    [0, 5, 10, 15, 20].forEach((season) => {
      const snap = d.powerSnapshots.find((p) => p.season === season);
      row['pctile_S' + season] = snap ? percentileRank(snap.rows, name) : null;
    });
    percMobility.push(row);
  });
});
const avgPctile = {};
[0, 5, 10, 15, 20].forEach((season) => { avgPctile[season] = round(percMobility.reduce((s, r) => s + (r['pctile_S' + season] || 0), 0) / percMobility.length, 1); });
console.log('POST-FIX Bottom10 Ø Strength-Perzentil je Saison:', JSON.stringify(avgPctile));

// ============================================================
// PHASE 49 -- Rank Mobility (30 Bottom10-Faelle, volle Bucket-Skala).
// ============================================================
console.log('\n=== PHASE 49: Rank Mobility (30 Bottom10-Faelle, POST-FIX) ===');
function bucketOfRank(rank) {
  if (rank === 1) return '#1'; if (rank <= 5) return 'Top5'; if (rank <= 10) return 'Top10'; if (rank <= 30) return 'Top30';
  if (rank <= 50) return 'Top50'; if (rank <= 100) return 'Top100'; if (rank <= 200) return 'Top200'; if (rank <= 250) return 'Top250';
  if (rank <= 300) return 'Top300'; if (rank <= 350) return 'Top350'; return 'Top400+';
}
const bucketCounts = {};
let bestRanks = [];
Object.entries(runs).forEach(([k, d]) => {
  d.setup.bottom10.forEach((name) => {
    let bestRank = 999;
    d.powerSnapshots.forEach((s) => { const row = s.rows.find((r) => r.name === name); if (row && row.rank < bestRank) bestRank = row.rank; });
    bestRanks.push({ run: k, org: name, bestRank });
    const b = bucketOfRank(bestRank);
    bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  });
});
console.log('Bucket-Verteilung (bester je erreichter Rang, 30 Faelle, POST-FIX):', JSON.stringify(bucketCounts));
bestRanks.sort((a, b) => a.bestRank - b.bestRank);
console.log('Top5 beste Faelle:', JSON.stringify(bestRanks.slice(0, 5)));
console.log('WICHTIG: keine Erfolgsquote erzwungen -- reines Messergebnis.');

// ============================================================
// PHASE 50 -- Top Mobility (urspruengliche Top10, Abstieg).
// ============================================================
console.log('\n=== PHASE 50: Top Mobility (urspruengliche Top10, POST-FIX) ===');
let collapseStats = { belowTop50: 0, belowTop100: 0, belowTop200: 0, intoMidfieldOrWorse: 0, total: 0 };
Object.entries(runs).forEach(([k, d]) => {
  d.setup.top10.forEach((name) => {
    collapseStats.total++;
    let worstRank = 0;
    d.powerSnapshots.forEach((s) => { const row = s.rows.find((r) => r.name === name); if (row && row.rank > worstRank) worstRank = row.rank; });
    if (worstRank > 50) collapseStats.belowTop50++;
    if (worstRank > 100) collapseStats.belowTop100++;
    if (worstRank > 200) collapseStats.belowTop200++;
    if (worstRank > 227) collapseStats.intoMidfieldOrWorse++;
  });
});
console.log(JSON.stringify(collapseStats));

// ============================================================
// PHASE 51 -- New Elite (Top10/Top5/Top3/#1, POST-FIX).
// ============================================================
console.log('\n=== PHASE 51: New Elite (POST-FIX) ===');
let newEliteStats = { newTop10: 0, newTop5: 0, newTop3: 0, newNumber1: 0 };
Object.entries(runs).forEach(([k, d]) => {
  const top50NamesS0 = new Set(d.setup.top50Names0);
  const s20 = d.powerSnapshots.find((p) => p.season === 20);
  const finalTop10 = [...s20.rows].sort((a, b) => a.rank - b.rank).slice(0, 10);
  finalTop10.forEach((r) => {
    if (top50NamesS0.has(r.name)) return;
    newEliteStats.newTop10++;
    if (r.rank <= 5) newEliteStats.newTop5++;
    if (r.rank <= 3) newEliteStats.newTop3++;
    if (r.rank === 1) newEliteStats.newNumber1++;
  });
});
console.log(JSON.stringify(newEliteStats));

// ============================================================
// PHASE 52 -- Power Distribution vorher/nachher (S0/S5/S10/S15/S20).
// ============================================================
console.log('\n=== PHASE 52: Power Distribution (POST-FIX, avgStarterOverall) ===');
[0, 5, 10, 15, 20].forEach((season) => {
  const rows = powerAt[season];
  console.log('S' + season + ':', JSON.stringify(stats(rows.map((r) => r.avgStarterOverall))));
});

// ============================================================
// PHASE 53 -- Stat Cap (POST-FIX, Vollpopulation, vorher/nachher Vergleich).
// ============================================================
console.log('\n=== PHASE 53: Stat Cap Saturation (POST-FIX vs PRE-FIX, S20, Vollpopulation) ===');
function capPct(rows) {
  let n = 0, p90 = 0, p95 = 0, p98 = 0, p99 = 0;
  rows.forEach((r) => { n += r.activePlayerCount; p90 += r.statCap.p90; p95 += r.statCap.p95; p98 += r.statCap.p98; p99 += r.statCap.p99; });
  return { n, pct90: round(100 * p90 / n, 1), pct95: round(100 * p95 / n, 1), pct98: round(100 * p98 / n, 1), pct99: round(100 * p99 / n, 1) };
}
const preS20 = []; Object.values(preRuns).forEach((d) => { const s = d.powerSnapshots.find((p) => p.season === 20); if (s) preS20.push(...s.rows); });
console.log('PRE-FIX S20:', JSON.stringify(capPct(preS20)));
console.log('POST-FIX S20:', JSON.stringify(capPct(powerAt[20])));

// ============================================================
// PHASE 53b -- Coach-Overall nach Rang-Eimer, POST-FIX vs PRE-FIX (direkter
// Test, ob der Fix wirkt).
// ============================================================
console.log('\n=== PHASE 53b: Coach-Overall nach Rang-Eimer (S20, PRE-FIX vs POST-FIX) ===');
function rankBucketCoach(rows, loRank, hiRank) {
  const sel = rows.filter((r) => r.rank >= loRank && r.rank <= hiRank && typeof r.coachOverall === 'number');
  return { n: sel.length, avgCoachOverall: round(sel.reduce((s, r) => s + r.coachOverall, 0) / (sel.length || 1), 1) };
}
[[391, 410, 'Rang ~400'], [291, 310, 'Rang ~300'], [191, 210, 'Rang ~200'], [91, 110, 'Rang ~100'], [41, 60, 'Rang ~50']].forEach(([lo, hi, label]) => {
  console.log(label + ' PRE-FIX:', JSON.stringify(rankBucketCoach(preS20, lo, hi)), ' POST-FIX:', JSON.stringify(rankBucketCoach(powerAt[20], lo, hi)));
});

// ============================================================
// PHASE 54 -- Economy Regression (Budget-Verteilung/Gini/Insolvenz).
// ============================================================
console.log('\n=== PHASE 54: Economy Regression (POST-FIX, S20) ===');
{
  const budgets = powerAt[20].map((r) => r.budget).sort((a, b) => a - b);
  const n = budgets.length;
  const mean = budgets.reduce((a, b) => a + b, 0) / n;
  let giniSum = 0;
  for (let i = 0; i < n; i++) giniSum += (2 * (i + 1) - n - 1) * budgets[i];
  const gini = giniSum / (n * budgets.reduce((s, b) => s + Math.max(0, b), 0) || 1);
  console.log(JSON.stringify({ n, mean: Math.round(mean), median: percentile(budgets, 0.5), p90: percentile(budgets, 0.9), p99: percentile(budgets, 0.99), gini: round(gini, 3), totalMoney: Math.round(budgets.reduce((a, b) => a + Math.max(0, b), 0)) }));
}

// ============================================================
// PHASE 55 -- Market Regression (Meaningful Upgrade Access, S20).
// ============================================================
console.log('\n=== PHASE 55: Market Regression (Meaningful Upgrade Access, S20, POST-FIX) ===');
function calculatePrice(overall) { const raw = 10000 * Math.pow(1.18, overall - 60); return Math.round(raw / 1000) * 1000; }
{
  const tierMaps = {};
  Object.entries(runs).forEach(([k, d]) => {
    const s0 = d.powerSnapshots.find((p) => p.season === 0);
    const sorted = [...s0.rows].sort((a, b) => b.strength - a.strength);
    const n = sorted.length; const map = new Map();
    sorted.forEach((r, i) => map.set(r.name, i < n / 3 ? 'top' : (i < 2 * n / 3 ? 'mid' : 'bottom')));
    tierMaps[k] = map;
  });
  const byTier = { top: { n: 0, aff5: 0 }, mid: { n: 0, aff5: 0 }, bottom: { n: 0, aff5: 0 } };
  Object.entries(runs).forEach(([k, d]) => {
    const snap = d.powerSnapshots.find((p) => p.season === 20);
    snap.rows.forEach((r) => {
      const t = tierMaps[k].get(r.name); if (!t) return;
      byTier[t].n++;
      if (r.investBudget >= calculatePrice(Math.min(99, Math.round(r.avgStarterOverall) + 5))) byTier[t].aff5++;
    });
  });
  ['top', 'mid', 'bottom'].forEach((t) => console.log(t + ': +5 Upgrade bezahlbar =', round(100 * byTier[t].aff5 / byTier[t].n, 1) + '%'));
}

// ============================================================
// PHASE 39/Titles -- Vollpopulation, S20.
// ============================================================
console.log('\n=== Titles (Vollpopulation, POST-FIX, S20 -- ueber powerSnapshot-Rang approximiert) ===');
console.log('(Hinweis: V10-Telemetrie erfasst keine separaten Titel-Zaehler wie V9 -- Rang-1-Wiederholung ueber Checkpoints als Naeherung.)');
Object.entries(runs).forEach(([k, d]) => {
  const rank1PerCheckpoint = d.powerSnapshots.map((s) => { const r1 = s.rows.find((r) => r.rank === 1); return r1 ? r1.name : null; });
  console.log('Run ' + k + ' Rang-1 je Checkpoint:', JSON.stringify(rank1PerCheckpoint));
});

fs.writeFileSync(path.join(__dirname, '_v10_phase48to55.json'), JSON.stringify({ avgPctile, bucketCounts, bestRanks: bestRanks.slice(0, 10), collapseStats, newEliteStats }, null, 2));
console.log('\n[Zwischenstand gespeichert: _v10_phase48to55.json]');
