// Bot Ecosystem V15, Phase 25 (Management Quality Score, NUR Analyse) /
// Phase 26 (Causal Lag: ManagementQuality(S) -> Strength/Rank(S+1/+3/+5)).
// WICHTIGER Vorbefund (siehe Abschlussbericht): auf reiner ENTSCHEIDUNGS-
// Ebene ist "Rationalitaet" fuer ALLE 453 Orgs strukturell IDENTISCH (der
// Dispatcher waehlt IMMER die hoechste verfuegbare Punktzahl, dieselbe
// Code-Logik fuer jede Org) -- Varianz zwischen Orgs kann NUR aus
// unterschiedlichen VERFUEGBAREN OPTIONEN (Marktglueck/Budget/RNG) kommen,
// nicht aus unterschiedlicher "Cleverness". MQS misst deshalb bewusst
// AUSGANGS-/ERGEBNISgroessen, die tatsaechlich variieren, nicht "traf die
// beste Wahl" (das waere uninformativ, siehe Beweis oben).
const { loadRun, round, mean, pearson, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-BASE-' + s + '.json') }));

function computeMQS(data, orgName, fromSeason, toSeason) {
  const decisions = (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.org === orgName && d.season >= fromSeason && d.season <= toSeason);
  if (!decisions.length) return null;
  const staffCoverage = decisions.filter((d) => d.coachOverall !== null).length / decisions.length;
  const buyCount = decisions.filter((d) => d.chosenLabel === 'BUY_PLAYER').length;
  const rFrom = rowByName(findSnap(data, fromSeason), orgName), rTo = rowByName(findSnap(data, toSeason), orgName);
  const rosterGrowth = (rFrom && rTo) ? rTo.avgStarterOverall - rFrom.avgStarterOverall : 0;
  return { staffCoverage, buyCount, rosterGrowth };
}
function zscore(values) {
  const m = mean(values), sd = Math.sqrt(mean(values.map((v) => (v - m) * (v - m)))) || 1;
  return values.map((v) => (v - m) / sd);
}

console.log('=== PHASE 25: Management Quality Score (S0-S10-Fenster, gepoolt) -- NUR Analyse ===');
const mqsEntries = [];
runs.forEach(({ seed, data }) => {
  data.setup.allBotNames.forEach((name) => {
    const mqs = computeMQS(data, name, 0, 10);
    if (mqs) mqsEntries.push({ seed, name, ...mqs, data });
  });
});
{
  const staffCov = zscore(mqsEntries.map((e) => e.staffCoverage));
  const buyC = zscore(mqsEntries.map((e) => e.buyCount));
  const rosterG = zscore(mqsEntries.map((e) => e.rosterGrowth));
  mqsEntries.forEach((e, i) => { e.mqs = (staffCov[i] + buyC[i] + rosterG[i]) / 3; });
  console.log('n=' + mqsEntries.length + ' Komponenten: staffCoverage(Anteil Saisons mit besetztem Coach), buyCount(erfolgreiche Kaeufe S0-S10), rosterGrowth(Ø-Overall-Zuwachs S0-S10)');
  console.log('MQS-Verteilung: Min=' + round(Math.min(...mqsEntries.map((e) => e.mqs)), 2) + ' Max=' + round(Math.max(...mqsEntries.map((e) => e.mqs)), 2) + ' StdDev=1.0 (z-normiert)');
}

console.log('\n=== PHASE 26: Causal Lag -- MQS(S0-S10) vs. Strength/Rank bei S11/S13/S15 (=S+1/S+3/S+5 relativ zum Fenster-Ende) ===');
{
  [11, 13, 15].forEach((targetSeason) => {
    const mqsVals = [], strengthVals = [], rankVals = [];
    mqsEntries.forEach((e) => {
      const r = rowByName(findSnap(e.data, targetSeason), e.name);
      if (!r) return;
      mqsVals.push(e.mqs); strengthVals.push(r.strength); rankVals.push(r.rank);
    });
    console.log('S' + targetSeason + ' (n=' + mqsVals.length + '): Korrelation MQS<->Strength=' + pearson(mqsVals, strengthVals) + ' MQS<->Rank=' + pearson(mqsVals, rankVals) + ' (negativ bei Rank erwartet: hoeheres MQS -> niedrigere/bessere Rangzahl)');
  });
}
