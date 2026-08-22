// Bot Ecosystem V16, Teil A -- Phase 2 (Money Flow Accounting/Reconciliation),
// Phase 3 (Income Root Cause), Phase 4 (Income vs. Expense), Phase 5 (Cash
// Distribution), Phase 9 (Income Scaling), Phase 10 (Player Price Economy),
// Phase 11 (Staff Price Economy), Phase 12 (Money Sinks). Nutzt die bereits
// bestehende, PRO-KATEGORIE-KUMULATIVE `income`-Aufschluesselung in
// qaCapturePowerSnapshot() (seit Bot-Oekosystem V10) -- KEINE neue
// Instrumentierung noetig, nur Analyse der bereits pro Saison mitgeschnittenen
// Werte.
const { loadRun, round, mean, percentile } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv16_V16-POST-' + s + '.json') }));
const INCOME_CATEGORIES = ['board_income', 'sponsor', 'tournament_prize', 'transfer_sale', 'transfer_purchase', 'salary', 'staff_hire', 'equipment', 'basecamp'];

function rowByName(snap, name) { return snap ? snap.rows.find((r) => r.name === name) : null; }
function findSnap(run, season) { return run.powerSnapshots.find((s) => s.season === season); }

console.log('=== PHASE 2: Money Flow Reconciliation -- budget(S)-budget(S-1) === Summe(Income-Kategorie-Deltas)? ===');
{
  let checked = 0, mismatches = 0;
  const mismatchExamples = [];
  runs.forEach(({ seed, data }) => {
    for (let s = 1; s <= Math.min(10, data.targetSeasons); s++) {
      const prev = findSnap(data, s - 1), cur = findSnap(data, s);
      if (!prev || !cur) continue;
      cur.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName) return;
        const rPrev = rowByName(prev, r.name);
        if (!rPrev) return;
        checked++;
        const budgetDelta = r.budget - rPrev.budget;
        let incomeSum = 0;
        INCOME_CATEGORIES.forEach((cat) => { incomeSum += (r.income[cat] || 0) - (rPrev.income[cat] || 0); });
        const diff = Math.abs(budgetDelta - incomeSum);
        if (diff > 1) { // >1 Euro Toleranz (Rundung)
          mismatches++;
          if (mismatchExamples.length < 5) mismatchExamples.push({ seed, org: r.name, season: s, budgetDelta: round(budgetDelta), incomeSum: round(incomeSum), diff: round(diff) });
        }
      });
    }
  });
  console.log('Geprueft (S1-S10, alle Bot-Orgs, 5 Seeds): ' + checked + ' Org-Saison-Uebergaenge');
  console.log('Abweichungen (>1€, unbekannte Geldquelle): ' + mismatches + ' (' + round(100 * mismatches / checked, 3) + '%)');
  if (mismatchExamples.length) console.log('Beispiele: ' + JSON.stringify(mismatchExamples));
}

console.log('\n=== PHASE 3: Income Root Cause -- Ø kumulative Einnahmen pro Kategorie bei S1/S10/S30/S50 (gepoolt, alle Bot-Orgs) ===');
{
  [1, 10, 30, 50].forEach((season) => {
    const totals = {};
    INCOME_CATEGORIES.forEach((c) => { totals[c] = []; });
    runs.forEach(({ data }) => {
      const snap = findSnap(data, Math.min(season, data.targetSeasons));
      if (!snap) return;
      snap.rows.forEach((r) => { if (r.name === data.setup.assignedOrgName) return; INCOME_CATEGORIES.forEach((c) => totals[c].push(r.income[c] || 0)); });
    });
    console.log('S' + season + ': ' + INCOME_CATEGORIES.map((c) => c + '=' + round(mean(totals[c]))).join(', '));
  });
}

console.log('\n=== PHASE 4: Verdienen Bots zu viel oder geben zu wenig aus? -- Ø-Einnahmen vs. Ø-Ausgaben pro Saison (Delta, gepoolt) ===');
{
  [5, 10, 20, 30, 40, 50].forEach((season) => {
    const incomeDeltas = [], expenseDeltas = [];
    runs.forEach(({ data }) => {
      const prev = findSnap(data, Math.max(0, season - 1)), cur = findSnap(data, Math.min(season, data.targetSeasons));
      if (!prev || !cur) return;
      cur.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName) return;
        const rPrev = rowByName(prev, r.name);
        if (!rPrev) return;
        let inc = 0, exp = 0;
        ['board_income', 'sponsor', 'tournament_prize', 'transfer_sale'].forEach((c) => { inc += (r.income[c] || 0) - (rPrev.income[c] || 0); });
        ['transfer_purchase', 'salary', 'staff_hire', 'equipment', 'basecamp'].forEach((c) => { exp += Math.abs((r.income[c] || 0) - (rPrev.income[c] || 0)); });
        incomeDeltas.push(inc); expenseDeltas.push(exp);
      });
    });
    console.log('S' + season + ': Ø-Einnahmen/Saison=' + round(mean(incomeDeltas)) + ' Ø-Ausgaben/Saison=' + round(mean(expenseDeltas)) + ' Ø-Netto=' + round(mean(incomeDeltas) - mean(expenseDeltas)));
  });
}

console.log('\n=== PHASE 5: Cash-Verteilung (Perzentile) bei S1/S5/S10/S20/S30/S50 ===');
{
  [1, 5, 10, 20, 30, 50].forEach((season) => {
    const budgets = [], payrollMonths = [];
    runs.forEach(({ data }) => {
      const snap = findSnap(data, Math.min(season, data.targetSeasons));
      if (!snap) return;
      snap.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName || !r.salaryCost) return;
        budgets.push(r.budget);
        payrollMonths.push(r.budget / r.salaryCost);
      });
    });
    budgets.sort((a, b) => a - b); payrollMonths.sort((a, b) => a - b);
    console.log('S' + season + ' Budget: Median=' + round(percentile(budgets, 0.5)) + ' P10=' + round(percentile(budgets, 0.1)) + ' P25=' + round(percentile(budgets, 0.25)) + ' P75=' + round(percentile(budgets, 0.75)) + ' P90=' + round(percentile(budgets, 0.9)) + ' P99=' + round(percentile(budgets, 0.99)));
    console.log('S' + season + ' Payroll-Monate: Median=' + round(percentile(payrollMonths, 0.5), 1) + ' P10=' + round(percentile(payrollMonths, 0.1), 1) + ' P90=' + round(percentile(payrollMonths, 0.9), 1) + ' P99=' + round(percentile(payrollMonths, 0.99), 1));
  });
}

console.log('\n=== PHASE 9: Income Scaling -- waechst Einkommen schneller als Kosten ueber die Zeit? ===');
{
  const seasons = [1, 5, 10, 20, 30, 40, 50];
  const series = { income: [], expense: [] };
  seasons.forEach((season) => {
    const incomeDeltas = [], expenseDeltas = [];
    runs.forEach(({ data }) => {
      const prev = findSnap(data, Math.max(0, season - 1)), cur = findSnap(data, Math.min(season, data.targetSeasons));
      if (!prev || !cur) return;
      cur.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName) return;
        const rPrev = rowByName(prev, r.name);
        if (!rPrev) return;
        let inc = 0, exp = 0;
        ['board_income', 'sponsor', 'tournament_prize'].forEach((c) => { inc += (r.income[c] || 0) - (rPrev.income[c] || 0); });
        ['salary'].forEach((c) => { exp += Math.abs((r.income[c] || 0) - (rPrev.income[c] || 0)); });
        incomeDeltas.push(inc); expenseDeltas.push(exp);
      });
    });
    series.income.push(round(mean(incomeDeltas)));
    series.expense.push(round(mean(expenseDeltas)));
  });
  console.log('Saisons: ' + seasons.join(', '));
  console.log('Ø passives Einkommen (Board+Sponsor+Preisgeld) pro Saison: ' + series.income.join(', '));
  console.log('Ø Gehaltskosten pro Saison: ' + series.expense.join(', '));
  console.log('Verhaeltnis Einkommen/Gehalt S1 vs S50: ' + round(series.income[0] / (series.expense[0] || 1), 2) + ' -> ' + round(series.income[series.income.length - 1] / (series.expense[series.expense.length - 1] || 1), 2));
}

console.log('\n=== PHASE 10: Player Price Economy -- Median/P90 Transferpreis vs. Budget/Payroll ueber die Zeit ===');
{
  [5, 10, 20, 30, 40, 50].forEach((season) => {
    const prices = [];
    runs.forEach(({ data }) => {
      data.transferLog.filter((t) => t.price > 0 && t.season === season && t.to !== 'Free Agent').forEach((t) => prices.push(t.price));
    });
    prices.sort((a, b) => a - b);
    const budgets = [], payrolls = [];
    runs.forEach(({ data }) => { const snap = findSnap(data, Math.min(season, data.targetSeasons)); if (snap) snap.rows.forEach((r) => { if (r.name !== data.setup.assignedOrgName) { budgets.push(r.budget); payrolls.push(r.salaryCost); } }); });
    const medPrice = percentile(prices, 0.5), p90Price = percentile(prices, 0.9);
    console.log('S' + season + ': n=' + prices.length + ' Median-Preis=' + round(medPrice) + ' P90-Preis=' + round(p90Price) + ' | Median-Preis/Median-Budget=' + round(medPrice / (percentile(budgets.sort((a, b) => a - b), 0.5) || 1), 4) + ' | Median-Preis/Median-Monatsgehalt=' + round(medPrice / (percentile(payrolls.sort((a, b) => a - b), 0.5) || 1), 1));
  });
}

console.log('\n=== PHASE 11: Staff Price Economy -- kann eine reiche Org praktisch jeden Staff bezahlen? ===');
{
  [10, 30, 50].forEach((season) => {
    const staffPrices = [];
    runs.forEach(({ data }) => {
      data.transferLog.filter((t) => t.season === season && t.info && ['STAFF_DOWNSIZE', 'STAFF_RECOVERY_HIRE', 'STAFF_VACANCY_FILL'].includes(t.info.reason)).forEach((t) => staffPrices.push(t.price));
    });
    staffPrices.sort((a, b) => a - b);
    const budgets = [];
    runs.forEach(({ data }) => { const snap = findSnap(data, Math.min(season, data.targetSeasons)); if (snap) snap.rows.forEach((r) => { if (r.name !== data.setup.assignedOrgName) budgets.push(r.budget); }); });
    budgets.sort((a, b) => a - b);
    console.log('S' + season + ': n Staff-Hires=' + staffPrices.length + ' Median-Preis=' + round(percentile(staffPrices, 0.5)) + ' P90-Preis=' + round(percentile(staffPrices, 0.9)) + ' | vs. Median-Budget=' + round(percentile(budgets, 0.5)) + ' (Ratio=' + round(percentile(staffPrices, 0.9) / (percentile(budgets, 0.5) || 1), 5) + ')');
  });
}

console.log('\n=== PHASE 12: Money Sinks -- welche bestehenden Ausgabenkategorien skalieren NICHT mit wachsendem Budget? ===');
{
  [10, 30, 50].forEach((season) => {
    const equipLevels = [], basecampLevels = [];
    runs.forEach(({ data }) => {
      const snap = findSnap(data, Math.min(season, data.targetSeasons));
      if (snap) snap.rows.forEach((r) => { if (r.name !== data.setup.assignedOrgName) { equipLevels.push(r.equipmentLevel); basecampLevels.push(r.basecampInvestLevel); } });
    });
    console.log('S' + season + ': Ø-Equipment-Level=' + round(mean(equipLevels), 2) + '/10 Ø-Basecamp-Level=' + round(mean(basecampLevels), 2) + '/10 (BOT_INVEST_MAX_LEVEL=10, harte Obergrenze -- danach kein weiterer Money Sink mehr moeglich)');
    console.log('  Level=10 erreicht (voll ausgeschoepft): Equipment=' + round(100 * equipLevels.filter((l) => l >= 10).length / equipLevels.length, 1) + '% Basecamp=' + round(100 * basecampLevels.filter((l) => l >= 10).length / basecampLevels.length, 1) + '%');
  });
}
