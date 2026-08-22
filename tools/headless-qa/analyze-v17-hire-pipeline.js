// Bot Ecosystem V17, Phase 4/5 (Sample Size, Root Cause Distribution) / 6
// (Budget Analysis) / 7 (Affordability Ratio) / 8 (Reserve Gate) / 9
// (Low-Budget Orgs) / 26 (False Unaffordable Rate). Nutzt qaStaffHireTraceLog
// (V17, neu): EIN Eintrag pro aktuell vakanter Rolle pro Saison pro Org, mit
// exaktem primaeren Reason-Code.
const { loadRun, round, mean, percentile } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-BASE-' + s + '.json') }));
const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];

let allEntries = [];
runs.forEach(({ data }) => { allEntries = allEntries.concat(data.staffHireTraceLog || []); });

console.log('=== PHASE 4: Sample Size ===');
console.log('n Vacancy-Decision-Events (alle Rollen, alle Saisons, gepoolt)=' + allEntries.length + ' (Ziel >=10.000)');
const noHire = allEntries.filter((e) => !e.hireStaffCreated);
console.log('n No-Hire-Option-Faelle=' + noHire.length + ' (Ziel >=2.000)');

console.log('\n=== PHASE 5: Root Cause Distribution (nach Rolle) ===');
ROLES.forEach((role) => {
  const roleEntries = allEntries.filter((e) => e.role === role);
  const reasonCounts = {};
  roleEntries.forEach((e) => { reasonCounts[e.reasonCode] = (reasonCounts[e.reasonCode] || 0) + 1; });
  const total = roleEntries.length;
  console.log(role + ' (n=' + total + '): ' + Object.entries(reasonCounts).map(([r, c]) => r + '=' + round(100 * c / total, 1) + '%').join(', '));
});
console.log('\nGesamt (alle Rollen gepoolt):');
{
  const reasonCounts = {};
  allEntries.forEach((e) => { reasonCounts[e.reasonCode] = (reasonCounts[e.reasonCode] || 0) + 1; });
  const total = allEntries.length;
  Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => console.log('  ' + r + ': ' + c + ' (' + round(100 * c / total, 1) + '%)'));
}

console.log('\n=== PHASE 6: Budget Analysis -- HIRE OPTION EXISTS vs. NO HIRE OPTION ===');
ROLES.forEach((role) => {
  const roleEntries = allEntries.filter((e) => e.role === role && e.wasEvaluatedThisSeason);
  const withOption = roleEntries.filter((e) => e.hireStaffCreated).map((e) => e.budget).sort((a, b) => a - b);
  const withoutOption = roleEntries.filter((e) => !e.hireStaffCreated).map((e) => e.budget).sort((a, b) => a - b);
  if (!withOption.length && !withoutOption.length) return;
  console.log(role + ':');
  console.log('  HIRE OPTION EXISTS (n=' + withOption.length + '): Median=' + round(percentile(withOption, 0.5)) + ' P10=' + round(percentile(withOption, 0.1)) + ' P25=' + round(percentile(withOption, 0.25)) + ' P75=' + round(percentile(withOption, 0.75)) + ' P90=' + round(percentile(withOption, 0.9)));
  console.log('  NO HIRE OPTION (n=' + withoutOption.length + '): Median=' + round(percentile(withoutOption, 0.5)) + ' P10=' + round(percentile(withoutOption, 0.1)) + ' P25=' + round(percentile(withoutOption, 0.25)) + ' P75=' + round(percentile(withoutOption, 0.75)) + ' P90=' + round(percentile(withoutOption, 0.9)));
});

console.log('\n=== PHASE 7: Affordability Ratio (nur Faelle mit vorhandenem Kandidaten, wasEvaluatedThisSeason) ===');
{
  const withCandidate = allEntries.filter((e) => e.wasEvaluatedThisSeason && e.cheapestPrice !== null);
  const priceToBudget = withCandidate.filter((e) => e.budget > 0).map((e) => e.cheapestPrice / e.budget);
  const salaryToPayroll = withCandidate.filter((e) => e.monthlyPayroll > 0).map((e) => e.cheapestSalary / e.monthlyPayroll);
  priceToBudget.sort((a, b) => a - b); salaryToPayroll.sort((a, b) => a - b);
  console.log('n=' + withCandidate.length);
  console.log('cheapestPrice/budget: Median=' + round(percentile(priceToBudget, 0.5), 4) + ' P90=' + round(percentile(priceToBudget, 0.9), 3) + ' P99=' + round(percentile(priceToBudget, 0.99), 2));
  console.log('cheapestSalary/monthlyPayroll: Median=' + round(percentile(salaryToPayroll, 0.5), 3) + ' P90=' + round(percentile(salaryToPayroll, 0.9), 3));
  const clearlyAffordable = withCandidate.filter((e) => e.cheapestPrice / (e.budget || 1) < 0.1).length;
  console.log('Kandidat kostet <10% des Budgets: ' + round(100 * clearlyAffordable / withCandidate.length, 1) + '% -- die meisten Kandidaten sind PREISLICH klein relativ zum Budget, wenn ueberhaupt vorhanden.');
}

console.log('\n=== PHASE 8: Reserve Gate -- blockiert die Reserve-Regel oekonomisch tragbare Hires? ===');
{
  const reserveGated = allEntries.filter((e) => e.reasonCode === 'RESERVE_GATE');
  const budgetGated = allEntries.filter((e) => e.reasonCode === 'BUDGET_GATE');
  console.log('RESERVE_GATE n=' + reserveGated.length + ' BUDGET_GATE n=' + budgetGated.length);
  if (reserveGated.length) {
    const excessBeyondReserve = reserveGated.map((e) => e.cashRoom); // wie nah am Limit
    console.log('  Ø-cashRoom in RESERVE_GATE-Faellen=' + round(mean(excessBeyondReserve)) + ' (je naeher an 0, desto knapper -- Reserve ist der bindende, nicht der Kaderwert-Deckel)');
  }
}

console.log('\n=== PHASE 9: Low-Budget Orgs -- No-Option-Faelle mit <1 Mio Budget ===');
{
  const lowBudgetNoOption = allEntries.filter((e) => e.wasEvaluatedThisSeason && !e.hireStaffCreated && e.budget < 1000000);
  const total = allEntries.filter((e) => e.wasEvaluatedThisSeason && !e.hireStaffCreated).length;
  console.log('n Low-Budget(<1M)-No-Option=' + lowBudgetNoOption.length + '/' + total + ' (' + round(100 * lowBudgetNoOption.length / total, 1) + '%)');
  const insolvent = lowBudgetNoOption.filter((e) => e.financeStatus === 'INSOLVENT' || e.financeStatus === 'CRITICAL').length;
  console.log('  davon tatsaechlich finanziell gefaehrdet (CRITICAL/INSOLVENT): ' + round(100 * insolvent / lowBudgetNoOption.length, 1) + '%');
  console.log('  davon HEALTHY trotz <1M Budget (liquide genug fuer WENIGSTENS einen guenstigen Staff, aber trotzdem blockiert): ' + round(100 * (lowBudgetNoOption.length - insolvent) / lowBudgetNoOption.length, 1) + '%');
}

console.log('\n=== PHASE 26: False Unaffordable Rate -- Kernmetrik ===');
{
  // "False unaffordable" = ROLE_PRIORITY_GATE-Faelle, die oekonomisch TRAGBAR
  // gewesen waeren (economicallyViable=true) -- diese Rolle wurde NICHT wegen
  // echter Unbezahlbarkeit ausgehungert, sondern rein wegen der Options-
  // Auswahl-Reihenfolge.
  const priorityGated = allEntries.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE');
  const falseUnaffordable = priorityGated.filter((e) => e.economicallyViable);
  console.log('n ROLE_PRIORITY_GATE=' + priorityGated.length + ' davon oekonomisch TRAGBAR gewesen (aber nie versucht)=' + falseUnaffordable.length + ' (' + round(100 * falseUnaffordable.length / priorityGated.length, 1) + '%)');
  console.log('Als Anteil ALLER No-Hire-Faelle: ' + round(100 * falseUnaffordable.length / noHire.length, 1) + '%');
}
