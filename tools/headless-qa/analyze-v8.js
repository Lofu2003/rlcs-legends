const fs = require('fs');
const path = require('path');

function loadRun(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
}

const runs = {
  EXPLORE: loadRun('_auditv8_V8-EXPLORE.json'),
  A: loadRun('_auditv8_V8-FINAL-A.json'),
  B: loadRun('_auditv8_V8-FINAL-B.json'),
  C: loadRun('_auditv8_V8-FINAL-C.json'),
};

function median(arr) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

Object.entries(runs).forEach(([label, d]) => {
  console.log('\n========== RUN ' + label + ' (seed ' + d.seed + ') ==========');
  const bottom10 = d.setup.bottom10;
  const top10 = d.setup.top10;
  const s0 = d.seasonSnapshots[0];
  const s20 = d.seasonSnapshots[d.seasonSnapshots.length - 1];

  // 1. Bottom10 cohort rank mobility.
  const bottomRanksStart = bottom10.map((n) => s0.orgs[n].rank);
  const bottomRanksEnd = bottom10.map((n) => s20.orgs[n].rank);
  console.log('Bottom10 rank S0:', bottomRanksStart.join(','));
  console.log('Bottom10 rank S20:', bottomRanksEnd.join(','));
  console.log('Bottom10 best rank ever reached (any season):', Math.min(...d.seasonSnapshots.map((s) => Math.min(...bottom10.map((n) => s.orgs[n] ? s.orgs[n].rank : 999)))));

  // 2. Potential gap by cohort over time (S0/S5/S10/S15/S20).
  console.log('\navgPotentialGap (bottom10 vs top10) by checkpoint:');
  [0, 5, 10, 15, 20].forEach((sn) => {
    const snap = d.seasonSnapshots[sn];
    if (!snap) return;
    const bAvg = bottom10.map((n) => snap.orgs[n] ? snap.orgs[n].avgPotentialGap : null).filter((x) => x !== null);
    const tAvg = top10.map((n) => snap.orgs[n] ? snap.orgs[n].avgPotentialGap : null).filter((x) => x !== null);
    const mean = (arr) => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length * 10) / 10 : null;
    console.log('  S' + sn + ': bottom10 avg gap=' + mean(bAvg) + ' top10 avg gap=' + mean(tAvg));
  });

  // 3. talentConcentration.top100Potential.inBottom10 over time.
  console.log('\ntop100Potential.inBottom10 by checkpoint (V7 baseline was 0 almost always):');
  [0, 5, 10, 15, 20].forEach((sn) => {
    const snap = d.seasonSnapshots[sn];
    if (!snap) return;
    console.log('  S' + sn + ': ' + snap.talentConcentration.top100Potential.inBottom10 + ' (uniqueOrgs=' + snap.talentConcentration.top100Potential.uniqueOrgs + ')');
  });

  // 4. Transfer fairness median ratio over time.
  console.log('\ntransferFairness.medianRatio by checkpoint:');
  [1, 5, 10, 15, 20].forEach((sn) => {
    const snap = d.seasonSnapshots[sn];
    if (!snap || !snap.transferFairness) return;
    console.log('  S' + sn + ': median=' + snap.transferFairness.medianRatio + ' p10=' + snap.transferFairness.p10Ratio + ' p90=' + snap.transferFairness.p90Ratio + ' n=' + snap.transferFairness.sampleSize);
  });

  // 5. Purchasing power sanity + economy at S0/S20.
  console.log('\nEconomy S0 -> S20:');
  console.log('  S0 median budget:', s0.economy.p50, 'gini:', s0.economy.gini, 'insolvent:', s0.economy.insolventCount);
  console.log('  S20 median budget:', s20.economy.p50, 'gini:', s20.economy.gini, 'insolvent:', s20.economy.insolventCount);
  console.log('  purchasingPower S20:', JSON.stringify(s20.purchasingPower));

  // 6. Board budget vs roster value ratio (sanity that unchanged formula still consistent).
  const sampleOrgsS20 = Object.values(s20.orgs).filter(Boolean);
  const boardVals = sampleOrgsS20.map((o) => o.boardSupport).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  console.log('  boardSupport S20 min/median/max:', boardVals[0], median(boardVals), boardVals[boardVals.length - 1]);

  // 7. Missed opportunities (bottom10) totals across all seasons.
  const missedTotal = d.seasonSnapshots.reduce((s, snap) => s + (snap.missedOpportunitiesBottom10 ? snap.missedOpportunitiesBottom10.total : 0), 0);
  const missedByReasonTotal = {};
  d.seasonSnapshots.forEach((snap) => {
    if (!snap.missedOpportunitiesBottom10) return;
    Object.entries(snap.missedOpportunitiesBottom10.byReason).forEach(([k, v]) => { missedByReasonTotal[k] = (missedByReasonTotal[k] || 0) + v; });
  });
  console.log('\nmissedOpportunitiesBottom10 total across all seasons:', missedTotal, JSON.stringify(missedByReasonTotal));

  // 8. Full title distribution at S20 across all 454 orgs.
  if (s20.fullTitles) {
    const withMajor = s20.fullTitles.filter((o) => o.majorsWon > 0).length;
    const withWorlds = s20.fullTitles.filter((o) => o.worldsWon > 0).length;
    const totalOrgs = s20.fullTitles.length;
    const topMajors = [...s20.fullTitles].sort((a, b) => b.majorsWon - a.majorsWon).slice(0, 5);
    console.log('\nFull-population title spread @ S20 (n=' + totalOrgs + '):');
    console.log('  distinct orgs with >=1 Major:', withMajor, '(' + Math.round(withMajor / totalOrgs * 1000) / 10 + '%)');
    console.log('  distinct orgs with >=1 Worlds:', withWorlds, '(' + Math.round(withWorlds / totalOrgs * 1000) / 10 + '%)');
    console.log('  top5 by majorsWon:', JSON.stringify(topMajors.map((o) => o.name + ':' + o.majorsWon + 'M/' + o.worldsWon + 'W/rank' + o.rank)));
    // Wie viele der urspruenglichen Bottom10 tauchen ueberhaupt mit >=1 Major/Worlds/Playoff auf?
    const bottomWithAnyTitle = bottom10.filter((n) => { const e = s20.fullTitles.find((x) => x.name === n); return e && (e.majorsWon > 0 || e.worldsWon > 0); });
    const bottomWithPlayoff = bottom10.filter((n) => { const e = s20.fullTitles.find((x) => x.name === n); return e && e.playoffAppearances > 0; });
    console.log('  Bottom10-Kohorte mit >=1 Titel (Major/Worlds) nach 20 Saisons:', bottomWithAnyTitle.length + '/10', JSON.stringify(bottomWithAnyTitle));
    console.log('  Bottom10-Kohorte mit >=1 Playoff-Teilnahme:', bottomWithPlayoff.length + '/10');
  }

  // 9. Elite churn: how many of the original top50 survive in top50 at S20?
  if (s0.top50Snapshot && s20.top50Snapshot) {
    const survivors = s0.top50Snapshot.filter((n) => s20.top50Snapshot.includes(n));
    console.log('\nTop50 survival S0->S20:', survivors.length + '/50 (' + (50 - survivors.length) + ' new entries)');
  }
});

// Cross-run consistency check (does the fix behave consistently across seeds?).
console.log('\n\n========== CROSS-RUN SUMMARY ==========');
['A', 'B', 'C'].forEach((label) => {
  const d = runs[label];
  const s20 = d.seasonSnapshots[d.seasonSnapshots.length - 1];
  const bottom10 = d.setup.bottom10;
  const bestRankEver = Math.min(...d.seasonSnapshots.map((s) => Math.min(...bottom10.map((n) => s.orgs[n] ? s.orgs[n].rank : 999))));
  console.log('Run ' + label + ': bottom10 best-ever rank=' + bestRankEver + ', S20 top100Potential.inBottom10=' + s20.talentConcentration.top100Potential.inBottom10);
});
