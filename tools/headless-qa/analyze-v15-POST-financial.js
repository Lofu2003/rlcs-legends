// Bot Ecosystem V15, Phase 17 (Financial Management/Cash Reserve Ratio) /
// Phase 18 (Dynamic Budget Strategy -- Code-Beweis: KEIN fixes Preislimit,
// siehe Abschlussbericht) / Phase 19 (Investment Pressure) / Phase 20
// (Rebuild Detection).
const { loadRun, round, mean, pearson, findSnap } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-POST-' + s + '.json') }));

console.log('=== PHASE 17: Financial Management -- Cash Reserve Ratio (Budget / Monatsgehalt) bei S50 ===');
{
  const byFinance = {};
  runs.forEach(({ data }) => {
    const snap = findSnap(data, data.targetSeasons);
    if (!snap) return;
    snap.rows.forEach((r) => {
      if (r.name === data.setup.assignedOrgName || !r.salaryCost) return;
      const ratio = r.budget / r.salaryCost; // "Monate Gehalt in der Reserve"
      const key = 'ALL';
      (byFinance[key] = byFinance[key] || []).push(ratio);
    });
  });
  const allRatios = byFinance.ALL || [];
  allRatios.sort((a, b) => a - b);
  console.log('n=' + allRatios.length + ' Median-Reserve-Monate=' + round(allRatios[Math.floor(allRatios.length / 2)], 1) + ' Ø=' + round(mean(allRatios), 1));
  console.log('Reserve > 24 Monate (deutliches Horten): ' + allRatios.filter((r) => r > 24).length + ' (' + round(100 * allRatios.filter((r) => r > 24).length / allRatios.length, 1) + '%)');
  console.log('Reserve < 1 Monat (riskant knapp): ' + allRatios.filter((r) => r < 1).length + ' (' + round(100 * allRatios.filter((r) => r < 1).length / allRatios.length, 1) + '%)');
}

console.log('\n=== PHASE 18: Dynamic Budget Strategy -- Code-Beweis ===');
console.log('calculatePlayerTransferValue()/calculatePrice() (data/pricing.js) kennen KEIN fixes');
console.log('Preislimit -- der Preis waechst rein exponentiell mit Overall (Basis 1.18), die einzige');
console.log('Kaufgrenze ist `price > org.budget` bzw. `price > investBudget`, beides PROPORTIONAL');
console.log('zum tatsaechlichen Budget der jeweiligen Org. Keine Simulation noetig, kein Fix noetig.');

console.log('\n=== PHASE 19: Investment Pressure -- skaliert BUY_PLAYER-Score mit Kaderschwaeche? ===');
{
  const gaps = [], scores = [];
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').forEach((d) => {
    const buyOpt = (d.availableOptions || []).find((o) => o.label === 'BUY_PLAYER');
    if (!buyOpt || !d.weakestStarterOverall) return;
    gaps.push(d.rosterAvgOverall - d.weakestStarterOverall);
    scores.push(buyOpt.score);
  }));
  console.log('n=' + gaps.length + ' Korrelation Kaderschwaeche-Gap<->BUY_PLAYER-Score=' + pearson(gaps, scores) + ' (positiv erwartet: groessere Schwachstelle -> hoehere Kaufpriotitaet, strukturell durch gain*3*goalMult in der Formel garantiert)');
  // Investieren gesunde, bereits starke Orgs trotzdem weiter (sinnlos Geld verbrennen)?
  const strongHealthyInvestRate = [];
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.financeStatus === 'HEALTHY' && d.rosterAvgOverall >= 90).forEach((d) => {
    strongHealthyInvestRate.push(d.chosenLabel === 'BUY_PLAYER' || d.chosenLabel === 'BUY_EQUIPMENT' || d.chosenLabel === 'UPGRADE_BASECAMP');
  }));
  console.log('Bereits starke (Ø-Overall>=90), gesunde Orgs -- investieren sie trotzdem weiter (statt SAVE_MONEY)? ' + round(100 * strongHealthyInvestRate.filter(Boolean).length / (strongHealthyInvestRate.length || 1), 1) + '% (n=' + strongHealthyInvestRate.length + ')');
}

console.log('\n=== PHASE 20: Rebuild Detection -- unterscheidet sich das Verhalten von REBUILD/DEEP_REBUILD-Orgs? ===');
{
  const byGoal = {};
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.reason).forEach((d) => {
    const m = d.reason.match(/Ziel: ([A-Z_]+)/);
    if (!m) return;
    const goal = m[1].replace('.', '');
    (byGoal[goal] = byGoal[goal] || []).push(d.chosenLabel);
  }));
  Object.entries(byGoal).forEach(([goal, labels]) => {
    const buyRate = labels.filter((l) => l === 'BUY_PLAYER').length / labels.length;
    const saveRate = labels.filter((l) => l === 'SAVE_MONEY').length / labels.length;
    console.log(goal + ': n=' + labels.length + ' BUY_PLAYER-Rate=' + round(100 * buyRate, 1) + '% SAVE_MONEY-Rate=' + round(100 * saveRate, 1) + '%');
  });
  console.log('(ensureBotOrgGoal() existiert bereits als "Rebuild-Erkennung" -- rang-/staerke-/finanzbasiert, siehe renderer.js. Falls BUY_PLAYER-Rate fuer REBUILD/DEEP_REBUILD nicht sichtbar hoeher ist als fuer CONTENDER/PLAYOFF, waere das ein Hinweis auf zu schwache Priorisierung.)');
}
