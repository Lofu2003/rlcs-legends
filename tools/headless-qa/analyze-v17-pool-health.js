// Bot Ecosystem V17, Phase 10 (Candidate Pool Health) / 11 (Market
// Starvation) / 12 (Market Regeneration) / 13 (Role Bottleneck) / 24 (Staff
// Market Equilibrium). Nutzt poolHealthSnapshots (V17, neu) + staffHireTraceLog.
const { loadRun, round, mean } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-BASE-' + s + '.json') }));
const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];

console.log('=== PHASE 10: Candidate Pool Health je Rolle, ueber die Zeit ===');
[1, 5, 10, 20, 30, 50].forEach((season) => {
  console.log('S' + season + ':');
  ROLES.forEach((role) => {
    const rows = [];
    runs.forEach(({ data }) => {
      const snap = data.poolHealthSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons));
      if (snap) { const r = snap.roles.find((x) => x.role === role); if (r) rows.push(r); }
    });
    if (!rows.length) return;
    console.log('  ' + role + ': PoolSize Ø=' + round(mean(rows.map((r) => r.poolSize)), 1) +
      ' Overall[min/p10/med/p90/max]=' + round(mean(rows.map((r) => r.overallMin))) + '/' + round(mean(rows.map((r) => r.overallP10))) + '/' + round(mean(rows.map((r) => r.overallMedian))) + '/' + round(mean(rows.map((r) => r.overallP90))) + '/' + round(mean(rows.map((r) => r.overallMax))) +
      ' Preis-Median=' + round(mean(rows.map((r) => r.priceMedian))) + ' Gehalt-Median=' + round(mean(rows.map((r) => r.salaryMedian))));
  });
});

console.log('\n=== PHASE 11: Market Starvation -- Verteilung Poolgroesse je Rolle (0/1/2-5/6-10/>10) ===');
ROLES.forEach((role) => {
  const sizes = [];
  runs.forEach(({ data }) => data.poolHealthSnapshots.forEach((snap) => { const r = snap.roles.find((x) => x.role === role); if (r) sizes.push(r.poolSize); }));
  const buckets = { '0': 0, '1': 0, '2-5': 0, '6-10': 0, '>10': 0 };
  sizes.forEach((s) => { const b = s === 0 ? '0' : s === 1 ? '1' : s <= 5 ? '2-5' : s <= 10 ? '6-10' : '>10'; buckets[b]++; });
  console.log(role + ' (n=' + sizes.length + ' Snapshots): ' + JSON.stringify(buckets));
});

console.log('\n=== PHASE 12: Market Regeneration -- Gesamtpool vs. einzelne Rollen ===');
console.log('ensureStaffMarketPopulation(role): MIN=20/BATCH=8 gilt PRO ROLLE separat (STAFF_MARKET_ROLES-Schleife,');
console.log('siehe renderer.js) -- kein gemeinsamer Gesamtpool-Topf, jede Rolle wird unabhaengig auf >=20 gehalten.');
console.log('Strukturell kann daher KEINE Rolle strukturell "aussterben", solange ensureAllStaffMarketPopulations()');
console.log('jede Saison laeuft -- Phase 11 (oben) ist die empirische Gegenprobe.');

console.log('\n=== PHASE 13: Role Bottleneck -- Kandidaten/Vakanzen-Verhaeltnis ===');
[1, 5, 10, 20, 30, 50].forEach((season) => {
  console.log('S' + season + ':');
  ROLES.forEach((role) => {
    let poolSizeSum = 0, poolSizeN = 0, vacantCount = 0;
    runs.forEach(({ data }) => {
      const snap = data.poolHealthSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons));
      if (snap) { const r = snap.roles.find((x) => x.role === role); if (r) { poolSizeSum += r.poolSize; poolSizeN++; } }
      vacantCount += (data.staffHireTraceLog || []).filter((e) => e.season === Math.min(season, data.targetSeasons) && e.role === role).length;
    });
    if (!poolSizeN) return;
    const avgPool = poolSizeSum / poolSizeN;
    console.log('  ' + role + ': Ø-Poolgroesse=' + round(avgPool, 1) + ' vakante Rollen (gepoolt)=' + vacantCount + ' Ratio(Pool/Vakanzen)=' + (vacantCount ? round(avgPool * poolSizeN / vacantCount, 2) : 'n/a'));
  });
});

console.log('\n=== PHASE 24: Staff Market Equilibrium (grobe Jahresbilanz, gepoolt ueber alle Rollen+Seeds) ===');
{
  const hiresByRole = {}, vacatesByRole = {};
  runs.forEach(({ data }) => {
    (data.transferLog || []).forEach((t) => {
      if (!t.info || !t.info.role) return;
      if (t.to === 'Free Agent' && t.info.reason === 'STAFF_VACATE') vacatesByRole[t.info.role] = (vacatesByRole[t.info.role] || 0) + 1;
      if (t.to !== 'Free Agent' && ['STAFF_DOWNSIZE', 'STAFF_RECOVERY_HIRE', 'STAFF_VACANCY_FILL'].includes(t.info.reason)) hiresByRole[t.info.role] = (hiresByRole[t.info.role] || 0) + 1;
    });
  });
  ROLES.forEach((role) => console.log('  ' + role + ': Hires=' + (hiresByRole[role] || 0) + ' Vacates=' + (vacatesByRole[role] || 0)));
}
