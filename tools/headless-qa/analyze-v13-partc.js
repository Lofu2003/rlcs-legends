// Bot Ecosystem V13, Phase 55/57/58/59/60/61 -- Wirtschaft/Personal/
// Wettbewerbs-Mobilitaet/Dynastien, aus den bereits vorhandenen V13-POST2-
// A/B/C-Laeufen (POST-FIX+POST-OPTIMIZATION, 50 Saisons, Checkpoints
// 0/5/10/15/20/25/30/40/50).
const fs = require('fs');
const path = require('path');
function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv13_V13-POST2-A.json'), B: loadRun('_auditv13_V13-POST2-B.json'), C: loadRun('_auditv13_V13-POST2-C.json') };
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function gini(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  s.forEach((v, i) => { cum += (i + 1) * v; });
  return round((2 * cum) / (n * sum) - (n + 1) / n, 3);
}

console.log('=== PHASE 55: Wirtschaft bei S50 (gepoolt) ===');
{
  const budgets = [];
  Object.values(runs).forEach((d) => { const snap = d.powerSnapshots.find((s) => s.season === 50); if (snap) snap.rows.forEach((r) => budgets.push(r.budget)); });
  budgets.sort((a, b) => a - b);
  console.log('n=' + budgets.length + ' Mean=' + round(budgets.reduce((a, b) => a + b, 0) / budgets.length) + ' Median=' + percentile(budgets, 0.5) + ' Gini=' + gini(budgets));
  console.log('Negative Budgets: ' + budgets.filter((v) => v < 0).length);
}

console.log('\n=== PHASE 57: Personal-Belegungsrate bei S50 (gepoolt, aus staffSnapshots) ===');
{
  let filled = 0, total = 0;
  Object.values(runs).forEach((d) => {
    const snap = d.staffSnapshots.find((s) => s.season === 50);
    if (!snap) return;
    // staffSnapshots enthaelt nur BESETZTE Rollen (siehe qaCaptureStaffSnapshot()) -- Vergleich gegen max. moegliche Slots (Coach+6 Staff je Org).
    const orgCount = d.setup.allBotNames.length + 1;
    total += orgCount * 7;
    filled += snap.rows.length;
  });
  console.log('Belegt: ' + filled + ' / Max moeglich: ' + total + ' = ' + round(100 * filled / total, 1) + '%');
}

console.log('\n=== PHASE 58: Wettbewerbs-Mobilitaet (Rank Bottom/Mid/Top, S0->S20->S50) ===');
{
  function avgRank(runSet, names, season) {
    const ranks = [];
    Object.values(runSet).forEach((d, idx) => {
      const nameList = Array.isArray(names) ? names : names(d);
      const snap = d.powerSnapshots.find((s) => s.season === season);
      if (!snap) return;
      nameList.forEach((n) => { const row = snap.rows.find((r) => r.name === n); if (row) ranks.push(row.rank); });
    });
    return ranks.length ? round(ranks.reduce((a, b) => a + b, 0) / ranks.length, 1) : null;
  }
  ['bottom10', 'mid10', 'top10'].forEach((tier) => {
    const s0 = avgRank(runs, (d) => d.setup[tier], 0);
    const s20 = avgRank(runs, (d) => d.setup[tier], 20);
    const s50 = avgRank(runs, (d) => d.setup[tier], 50);
    console.log(tier + ': avgRank S0=' + s0 + ' -> S20=' + s20 + ' -> S50=' + s50);
  });
}

console.log('\n=== PHASE 59: Neue Elite (wie viele NICHT-urspruengliche Top-X-Orgs erreichen S50 Top-X) ===');
{
  [100, 50, 10, 5, 3, 1].forEach((topN) => {
    let newEntrants = 0, total = 0;
    Object.values(runs).forEach((d) => {
      const s0 = d.powerSnapshots.find((s) => s.season === 0);
      const s50 = d.powerSnapshots.find((s) => s.season === 50);
      if (!s0 || !s50) return;
      const origTopN = new Set(s0.rows.filter((r) => r.rank <= topN).map((r) => r.name));
      const nowTopN = s50.rows.filter((r) => r.rank <= topN).map((r) => r.name);
      total += nowTopN.length;
      newEntrants += nowTopN.filter((n) => !origTopN.has(n)).length;
    });
    console.log('Top' + topN + ': ' + newEntrants + '/' + total + ' (' + round(100 * newEntrants / total, 1) + '%) sind NEU (waren bei S0 nicht in Top' + topN + ')');
  });
}

console.log('\n=== PHASE 60: Abstieg der urspruenglichen Top10 (S0) bis S50 ===');
{
  const finalRanks = [];
  Object.values(runs).forEach((d) => {
    const s0 = d.powerSnapshots.find((s) => s.season === 0);
    const s50 = d.powerSnapshots.find((s) => s.season === 50);
    if (!s0 || !s50) return;
    const origTop10 = s0.rows.filter((r) => r.rank <= 10).map((r) => r.name);
    origTop10.forEach((n) => { const row = s50.rows.find((r) => r.name === n); if (row) finalRanks.push(row.rank); });
  });
  finalRanks.sort((a, b) => a - b);
  console.log('n=' + finalRanks.length + ' avgRankBeiS50=' + round(finalRanks.reduce((a, b) => a + b, 0) / finalRanks.length, 1) + ' medianRankBeiS50=' + percentile(finalRanks, 0.5));
  console.log('noch in Top10 bei S50: ' + finalRanks.filter((r) => r <= 10).length + '/' + finalRanks.length);
  console.log('abgestiegen unter Top50: ' + finalRanks.filter((r) => r > 50).length + '/' + finalRanks.length);
}

console.log('\n=== PHASE 61: Dynastien -- laengste #1/Top5/Top10-Serie ueber die Checkpoints (0,5,10,...,50) ===');
{
  Object.entries(runs).forEach(([seedName, d]) => {
    const checkpoints = d.powerSnapshots.map((s) => s.season).sort((a, b) => a - b);
    function longestStreak(threshold) {
      const orgStreak = {};
      let best = { org: null, len: 0 };
      checkpoints.forEach((season) => {
        const snap = d.powerSnapshots.find((s) => s.season === season);
        const inTier = new Set(snap.rows.filter((r) => r.rank <= threshold).map((r) => r.name));
        Object.keys(orgStreak).forEach((n) => { if (!inTier.has(n)) orgStreak[n] = 0; });
        inTier.forEach((n) => { orgStreak[n] = (orgStreak[n] || 0) + 1; if (orgStreak[n] > best.len) best = { org: n, len: orgStreak[n] }; });
      });
      return best;
    }
    const b1 = longestStreak(1), b5 = longestStreak(5), b10 = longestStreak(10);
    console.log(seedName + ': #1-Serie=' + b1.org + ' (' + b1.len + '/' + checkpoints.length + ' Checkpoints) | Top5-Serie=' + b5.org + ' (' + b5.len + ') | Top10-Serie=' + b10.org + ' (' + b10.len + ')');
  });
  console.log('(Hinweis: nur an Checkpoint-Granularitaet gemessen, nicht an jeder einzelnen Saison -- disclosed Limitation)');
}
