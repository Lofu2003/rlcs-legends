// Bot Ecosystem V16, Phase 6 (Unused Investment Opportunities, >=5000 Faelle)
// / Phase 7 (SAVE_MONEY-Analyse, >=10000) / Phase 8 (Spending-Cap-Audit).
const { loadRun, round, mean } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv16_V16-BASE-' + s + '.json') }));

console.log('=== PHASE 6: Unused Investment -- Cash>24 Payroll-Monate: gab es eine sinnvolle Option? ===');
{
  const cases = [];
  runs.forEach(({ data }) => {
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').forEach((d) => {
      // Payroll-Monate approximiert aus budget/decisionLog (kein salaryCost dort
      // erfasst) -- nutzt stattdessen den vorhandenen Score-Kontext: Reserve
      // gilt hier operational als "gross" bei budget > 50 Mio (grober, aber
      // konsistenter Schwellwert ueber alle Saisons).
      if (d.budget < 50000000 || d.financeStatus !== 'HEALTHY') return;
      cases.push(d);
    });
  });
  console.log('n Faelle (Budget>50Mio, HEALTHY)=' + cases.length + ' (Ziel >=5000)');
  const hadBuyOption = cases.filter((d) => (d.availableOptions || []).some((o) => o.label === 'BUY_PLAYER'));
  const hadHireOption = cases.filter((d) => (d.availableOptions || []).some((o) => o.label === 'HIRE_STAFF'));
  const hadInvestOption = cases.filter((d) => (d.availableOptions || []).some((o) => o.label === 'BUY_EQUIPMENT' || o.label === 'UPGRADE_BASECAMP'));
  const hadAnyOption = cases.filter((d) => (d.availableOptions || []).length > 0);
  const savedAnyway = cases.filter((d) => d.chosenLabel === 'SAVE_MONEY');
  const savedWithOption = cases.filter((d) => d.chosenLabel === 'SAVE_MONEY' && (d.availableOptions || []).length > 0);
  console.log('  hatte BUY_PLAYER-Option: ' + hadBuyOption.length + ' (' + round(100 * hadBuyOption.length / cases.length, 1) + '%)');
  console.log('  hatte HIRE_STAFF-Option: ' + hadHireOption.length + ' (' + round(100 * hadHireOption.length / cases.length, 1) + '%)');
  console.log('  hatte Equipment/Basecamp-Option: ' + hadInvestOption.length + ' (' + round(100 * hadInvestOption.length / cases.length, 1) + '%)');
  console.log('  hatte GAR KEINE Option (nichts zu tun -- Kader/Personal/Investition alle am Limit): ' + (cases.length - hadAnyOption.length) + ' (' + round(100 * (cases.length - hadAnyOption.length) / cases.length, 1) + '%)');
  console.log('  waehlte SAVE_MONEY: ' + savedAnyway.length + ' (' + round(100 * savedAnyway.length / cases.length, 1) + '%), davon TROTZ verfuegbarer Option: ' + savedWithOption.length + ' (' + round(100 * savedWithOption.length / (savedAnyway.length || 1), 1) + '% der Sparer)');
}

console.log('\n=== PHASE 7: SAVE_MONEY-Analyse -- warum gewinnt SAVE_MONEY? ===');
{
  const saveDecisions = [];
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.chosenLabel === 'SAVE_MONEY').forEach((d) => saveDecisions.push(d)));
  console.log('n=' + saveDecisions.length + ' (Ziel >=10000)');
  const noOptions = saveDecisions.filter((d) => (d.availableOptions || []).length === 0);
  console.log('  SAVE_MONEY gewinnt, weil GAR KEINE andere Option existierte: ' + noOptions.length + ' (' + round(100 * noOptions.length / saveDecisions.length, 1) + '%)');
  const withOptionsButLow = saveDecisions.filter((d) => (d.availableOptions || []).length > 0);
  console.log('  SAVE_MONEY gewinnt TROTZ vorhandener (aber niedriger score) Optionen: ' + withOptionsButLow.length + ' (' + round(100 * withOptionsButLow.length / saveDecisions.length, 1) + '%)');
  if (withOptionsButLow.length) {
    const avgBestOtherScore = mean(withOptionsButLow.map((d) => Math.max(...d.availableOptions.map((o) => o.score))));
    console.log('  Ø-bester-Alternativ-Score in diesen Faellen=' + round(avgBestOtherScore, 2) + ' (SAVE_MONEY-Baseline-Score=6, siehe BOT_SAVE_MONEY_SCORE)');
    const labelCounts = {};
    withOptionsButLow.forEach((d) => d.availableOptions.forEach((o) => { labelCounts[o.label] = (labelCounts[o.label] || 0) + 1; }));
    console.log('  Haeufigste angebotene (aber verlorene) Labels: ' + JSON.stringify(labelCounts));
  }
  const buckets = { '<1M': 0, '1-10M': 0, '10-50M': 0, '50-200M': 0, '>200M': 0 };
  saveDecisions.forEach((d) => {
    const b = d.budget < 1e6 ? '<1M' : d.budget < 1e7 ? '1-10M' : d.budget < 5e7 ? '10-50M' : d.budget < 2e8 ? '50-200M' : '>200M';
    buckets[b]++;
  });
  console.log('  SAVE_MONEY nach Budget-Groesse: ' + JSON.stringify(buckets));
}

console.log('\n=== PHASE 8: Spending-Cap-Audit -- Code-Fakten (keine Simulation, direkte Formel-Pruefung) ===');
console.log('botAvailableInvestmentBudget(): min(orgRemainingBudget=budget-rosterMarketValue, budget-reserveTarget).');
console.log('reserveTarget = monthlySalary * BOT_RISK_RESERVE_MONTHS[riskProfile] (1-6 Monate, CONSERVATIVE=6/BALANCED=4/AMBITIOUS=2.5/AGGRESSIVE=1).');
console.log('KEIN fixer Euro-Deckel gefunden -- beide Terme skalieren MIT dem tatsaechlichen Budget/Kaderwert.');
console.log('ABER: sobald rosterMarketValue nah an budget heranreicht (ausgereifter Kader), sinkt ceilingRoom -- das');
console.log('ist die einzige "weiche" Deckelung, kein Bug, sondern Ausdruck von "Kader bereits ausgereizt".');
console.log('scoreBotInvestment(): BOT_INVEST_MAX_LEVEL=10 ist ein HARTER Deckel -- ab Level 10 (Equipment UND');
console.log('Basecamp) liefert die Funktion IMMER null, unabhaengig von Budget. Das IST ein echter Money-Sink-Deckel.');
