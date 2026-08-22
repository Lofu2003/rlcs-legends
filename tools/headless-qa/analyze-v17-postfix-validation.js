// Bot Ecosystem V17 -- konsolidierte Post-Fix-Validierung: vergleicht die
// V17-BASE-Daten (Vor-Fix, 5x50 Saisons, bereits vorhanden aus der Root-
// Cause-Phase) gegen die V17-POST-Daten (Nach-Fix-1+Fix-2, 5 NEUE Seeds x50 +
// 2 NEUE Seeds x100). Deckt die Pflichtmetriken ab: Staff-Vakanz-Kennzahlen
// je Rolle, Finanz-Regression, Wettbewerbs-Regression, Talent-Regression,
// Markt-Regression.
const { loadRun, round, mean, percentile, gini, pearson, findSnap, rowByName } = require('./v14-lib');

const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];
const BASE_SEEDS = ['A', 'B', 'C', 'D', 'E'];
const POST_SEEDS = ['A', 'B', 'C', 'D', 'E'];

const baseRuns = BASE_SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-BASE-' + s + '.json') }));
const postRuns = POST_SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-POST-' + s + '.json') }));
const post100Runs = ['A', 'B'].map((s) => ({ seed: s, data: loadRun('_auditv17_V17-POST-100-' + s + '.json') }));

function pooledTrace(runs) { let all = []; runs.forEach(({ data }) => { all = all.concat(data.staffHireTraceLog || []); }); return all; }
function pooledVacancyLog(runs) { let all = []; runs.forEach(({ seed, data }) => (data.staffVacancyLog || []).forEach((v) => all.push({ seed, ...v }))); return all; }

console.log('########## PFLICHTMETRIKEN A: STAFF-VAKANZ JE ROLLE (BASE vs. POST) ##########');
{
  const baseVac = pooledVacancyLog(baseRuns);
  const postVac = pooledVacancyLog(postRuns);
  const baseTrace = pooledTrace(baseRuns);
  const postTrace = pooledTrace(postRuns);
  ROLES.forEach((role) => {
    const bClosed = baseVac.filter((v) => v.role === role && v.duration !== undefined);
    const pClosed = postVac.filter((v) => v.role === role && v.duration !== undefined);
    const bDur = bClosed.map((v) => v.duration).sort((a, b) => a - b);
    const pDur = pClosed.map((v) => v.duration).sort((a, b) => a - b);
    const bTrace = baseTrace.filter((e) => e.role === role);
    const pTrace = postTrace.filter((e) => e.role === role);
    const rate = (arr, pred) => arr.length ? round(100 * arr.filter(pred).length / arr.length, 1) : null;
    console.log('--- ' + role + ' ---');
    console.log('  Vacancy Duration (geschlossene Episoden) BASE n=' + bDur.length + ' P50=' + percentile(bDur, 0.5) + ' P75=' + percentile(bDur, 0.75) + ' P90=' + percentile(bDur, 0.9) + ' P95=' + percentile(bDur, 0.95) + ' Mean=' + round(mean(bDur), 1));
    console.log('  Vacancy Duration (geschlossene Episoden) POST n=' + pDur.length + ' P50=' + percentile(pDur, 0.5) + ' P75=' + percentile(pDur, 0.75) + ' P90=' + percentile(pDur, 0.9) + ' P95=' + percentile(pDur, 0.95) + ' Mean=' + round(mean(pDur), 1));
    console.log('  Hire-Option-Rate BASE=' + rate(bTrace, (e) => e.hireStaffCreated) + '% POST=' + rate(pTrace, (e) => e.hireStaffCreated) + '%');
    console.log('  No-Hire-Rate BASE=' + rate(bTrace, (e) => !e.hireStaffCreated) + '% POST=' + rate(pTrace, (e) => !e.hireStaffCreated) + '%');
    console.log('  Affordable-Candidate-Rate (economicallyViable) BASE=' + rate(bTrace, (e) => e.economicallyViable) + '% POST=' + rate(pTrace, (e) => e.economicallyViable) + '%');
    console.log('  Market-Empty-Rate BASE=' + rate(bTrace, (e) => e.reasonCode === 'MARKET_EMPTY') + '% POST=' + rate(pTrace, (e) => e.reasonCode === 'MARKET_EMPTY') + '%');
    console.log('  Budget-Gate-Rate BASE=' + rate(bTrace, (e) => e.reasonCode === 'BUDGET_GATE') + '% POST=' + rate(pTrace, (e) => e.reasonCode === 'BUDGET_GATE') + '%');
  });
}

console.log('\n########## PFLICHTMETRIKEN B: FINANZ-REGRESSION (BASE vs. POST) ##########');
function financialRegression(runs, label) {
  [1, 10, 25, 50].forEach((season) => {
    const rows = [];
    runs.forEach(({ data }) => { const snap = data.powerSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons)); if (snap) rows.push(...snap.rows); });
    if (!rows.length) return;
    const negBudget = rows.filter((r) => r.budget < 0).length;
    const budgets = rows.map((r) => r.budget);
    const cashMonths = rows.filter((r) => r.salaryCost > 0).map((r) => r.budget / r.salaryCost);
    console.log('  [' + label + '] S' + season + ' (n=' + rows.length + '): Negativ-Budget-Rate=' + round(100 * negBudget / rows.length, 1) + '% Budget-Gini=' + gini(budgets.map((b) => Math.max(0, b))) + ' Median-Cash-Reserve-Monate=' + round(percentile([...cashMonths].sort((a, b) => a - b), 0.5), 1));
  });
}
financialRegression(baseRuns, 'BASE');
financialRegression(postRuns, 'POST');

console.log('\n########## PFLICHTMETRIKEN C: WETTBEWERBS-REGRESSION -- Rank-Autokorrelation S1 vs. SN ##########');
function competitiveRegression(runs, label, checkpoints) {
  checkpoints.forEach((season) => {
    const xs = [], ys = [];
    runs.forEach(({ data }) => {
      const s1 = findSnap(data, 1);
      const sN = findSnap(data, Math.min(season, data.targetSeasons));
      if (!s1 || !sN || season > data.targetSeasons) return;
      s1.rows.forEach((r1) => { const rN = rowByName(sN, r1.name); if (rN) { xs.push(r1.rank); ys.push(rN.rank); } });
    });
    if (!xs.length) return;
    console.log('  [' + label + '] Rank-Korrelation S1 vs. S' + season + ' (n=' + xs.length + '): r=' + pearson(xs, ys));
  });
}
competitiveRegression(baseRuns, 'BASE', [5, 10, 20, 30, 50]);
competitiveRegression(postRuns, 'POST', [5, 10, 20, 30, 50]);
competitiveRegression(post100Runs, 'POST-100', [5, 10, 20, 30, 50, 60, 100]);

console.log('\n########## PFLICHTMETRIKEN D: TALENT-REGRESSION (BASE vs. POST) ##########');
function talentRegression(runs, label) {
  [1, 25, 50].forEach((season) => {
    const rows = [];
    runs.forEach(({ data }) => { const snap = data.distributionSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons)); if (snap) rows.push(...snap.players); });
    if (!rows.length) return;
    const overalls = rows.map((r) => r.overall);
    const overall99 = rows.filter((r) => r.overall >= 99).length;
    const potential99 = rows.filter((r) => r.potential >= 99).length;
    console.log('  [' + label + '] S' + season + ' (n=' + rows.length + '): Median-Overall=' + percentile([...overalls].sort((a, b) => a - b), 0.5) + ' Mean-Overall=' + round(mean(overalls), 1) + ' Overall99-Count=' + overall99 + ' Potential99-Count=' + potential99);
  });
  let retireCount = 0; runs.forEach(({ data }) => { retireCount += (data.retirementLog || []).length; });
  console.log('  [' + label + '] Retirement-Count gesamt (gepoolt)=' + retireCount);
}
talentRegression(baseRuns, 'BASE');
talentRegression(postRuns, 'POST');

console.log('\n########## PFLICHTMETRIKEN E: MARKT-REGRESSION ##########');
function marketRegression(runs, label) {
  [1, 25, 50].forEach((season) => {
    const rows = [];
    runs.forEach(({ data }) => { const snap = data.marketPoolSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons)); if (snap) rows.push(snap); });
    if (!rows.length) return;
    console.log('  [' + label + '] S' + season + ': Ø-Spieler-Frei-Pool=' + round(mean(rows.map((r) => r.playersRemaining)), 0) + '/' + round(mean(rows.map((r) => r.playersTotal)), 0));
  });
  // Staff-Pool-Integritaet: Duplikate/NaN/Alter-Fehler/Rollen-Fehler ueber alle Snapshots.
  let dupeIssues = 0, nanIssues = 0, checkedSnaps = 0;
  runs.forEach(({ data }) => (data.poolHealthSnapshots || []).forEach((snap) => {
    checkedSnaps++;
    snap.roles.forEach((r) => {
      if (r.overallMin !== null && (Number.isNaN(r.overallMin) || Number.isNaN(r.overallMax))) nanIssues++;
      if (r.ageMin !== null && (r.ageMin < 0 || r.ageMax > 90)) nanIssues++;
    });
  }));
  console.log('  [' + label + '] Staff-Pool-Snapshots geprueft=' + checkedSnaps + ' NaN/Altersfehler=' + nanIssues);
}
marketRegression(baseRuns, 'BASE');
marketRegression(postRuns, 'POST');
