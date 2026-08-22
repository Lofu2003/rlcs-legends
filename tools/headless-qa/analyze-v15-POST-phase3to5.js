// Bot Ecosystem V14, Phase 3 (Cohorts) / Phase 4 (Rank Transition Matrix) /
// Phase 5 (Strength Transition) -- gepoolt ueber alle 6 V14-BASE-Seeds (A-F,
// je 50 Saisons, unveraenderter V13-Code). powerSnapshots existieren JEDE
// Saison (siehe audit-run-v14.js), Checkpoints hier nur eine Teilmenge davon.
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => loadRun('_auditv15_V15-POST-' + s + '.json'));
const CHECKPOINTS = [0, 5, 10, 15, 20, 30, 40, 50];
const COHORT_KEYS = ['top10', 'r11_50', 'r51_100', 'r101_200', 'r201_300', 'r301_400', 'bottomRest'];

function bucketForRank(rank) {
  if (rank <= 10) return 'Top10';
  if (rank <= 50) return 'Top50';
  if (rank <= 100) return 'Top100';
  if (rank <= 200) return '101-200';
  return '201+';
}

console.log('=== PHASE 3: Cohort-Durchschnittsrang ueber die Saisons (gepoolt, n=' + runs.length + ' Seeds) ===');
COHORT_KEYS.forEach((key) => {
  const line = [key + ':'];
  CHECKPOINTS.forEach((season) => {
    const ranks = [];
    runs.forEach((run) => {
      const names = run.setup.cohorts[key];
      const snap = findSnap(run, season);
      if (!snap) return;
      names.forEach((n) => { const row = rowByName(snap, n); if (row) ranks.push(row.rank); });
    });
    line.push('S' + season + '=' + round(mean(ranks), 1));
  });
  console.log(line.join(' '));
});

console.log('\n=== PHASE 4: Rank Transition Matrix (S0-Kohorte -> Ziel-Bucket bei S10/S20/S30/S50, gepoolt) ===');
COHORT_KEYS.forEach((startKey) => {
  console.log('\nS0 ' + startKey + ' (n pro Seed=' + runs[0].setup.cohorts[startKey].length + '):');
  [10, 20, 30, 50].forEach((season) => {
    const counts = { Top10: 0, Top50: 0, Top100: 0, '101-200': 0, '201+': 0 };
    let total = 0;
    runs.forEach((run) => {
      const names = run.setup.cohorts[startKey];
      const snap = findSnap(run, season);
      if (!snap) return;
      names.forEach((n) => { const row = rowByName(snap, n); if (row) { counts[bucketForRank(row.rank)]++; total++; } });
    });
    const pct = Object.entries(counts).map(([k, v]) => k + ' ' + round(100 * v / total, 1) + '%').join(', ');
    console.log('  S' + season + ': ' + pct + ' (n=' + total + ')');
  });
});

console.log('\n=== PHASE 5: Staerke-Entwicklung Top10 vs. BottomRest (S0-Kohorte, gepoolt) ===');
['top10', 'bottomRest'].forEach((key) => {
  const line = [key + ':'];
  CHECKPOINTS.forEach((season) => {
    const strengths = [];
    runs.forEach((run) => {
      const names = run.setup.cohorts[key];
      const snap = findSnap(run, season);
      if (!snap) return;
      names.forEach((n) => { const row = rowByName(snap, n); if (row) strengths.push(row.strength); });
    });
    line.push('S' + season + '=' + round(mean(strengths), 1));
  });
  console.log(line.join(' '));
});
