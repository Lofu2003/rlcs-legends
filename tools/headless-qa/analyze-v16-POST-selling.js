// Bot Ecosystem V16, Phase 21 (Sale Event Study, >=10.000) / 22 (Counterfactual
// Quality) / 23 (BAD Sales Clustering) / 24 (No-Replacement A-E-Klassifikation)
// / 25 (Sale->Roster Damage) / 26 (Star Sales >=90 Overall).
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv16_V16-POST-' + s + '.json') }));

function buildSalesDataset() {
  const sales = [];
  runs.forEach(({ seed, data }) => {
    data.transferLog.filter((t) => t.price > 0 && t.info && typeof t.info.overall === 'number').forEach((sale) => {
      const distress = sale.info.sellerFinanceStatus === 'CRITICAL' || sale.info.sellerFinanceStatus === 'INSOLVENT';
      const replacedWithin1 = data.transferLog.some((t2) => t2.to === sale.from && t2.season === sale.season + 1 && t2.info && t2.info.overall);
      const replacedWithin2 = replacedWithin1 || data.transferLog.some((t2) => t2.to === sale.from && t2.season === sale.season + 2 && t2.info && t2.info.overall);
      const sNow = findSnap(data, sale.season), s1 = findSnap(data, Math.min(data.targetSeasons, sale.season + 1)), s2 = findSnap(data, Math.min(data.targetSeasons, sale.season + 2));
      const rNow = sNow ? rowByName(sNow, sale.from) : null, r1 = s1 ? rowByName(s1, sale.from) : null, r2 = s2 ? rowByName(s2, sale.from) : null;
      const strengthDelta1 = (rNow && r1) ? r1.strength - rNow.strength : null;
      const strengthDelta2 = (rNow && r2) ? r2.strength - rNow.strength : null;
      // Nachfolgeentscheidungen (S..S+2) fuer dieselbe Org -- fuer die A-E-Klassifikation
      const followDecisions = (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.org === sale.from && d.season >= sale.season && d.season <= sale.season + 2);
      const buyOptionSeen = followDecisions.some((d) => (d.availableOptions || []).some((o) => o.label === 'BUY_PLAYER'));
      const buyChosen = followDecisions.some((d) => d.chosenLabel === 'BUY_PLAYER');
      sales.push({ seed, sale, distress, replacedWithin1, replacedWithin2, strengthDelta1, strengthDelta2, buyOptionSeen, buyChosen, activeCountAtSale: rNow ? rNow.activePlayerCount : null });
    });
  });
  return sales;
}

console.log('=== PHASE 21: Sale Event Study ===');
const sales = buildSalesDataset();
console.log('n=' + sales.length + ' (Ziel >=10.000)');

console.log('\n=== PHASE 22/23: Klassifikation & BAD-Sales-Clustering ===');
{
  const classified = { GOOD: 0, REASONABLE: 0, QUESTIONABLE: 0, BAD: 0 };
  const badCases = [];
  sales.forEach((s) => {
    const info = s.sale.info;
    const oldStar = info.age >= 30;
    const wasElite = info.overall >= 85;
    const wasYoungCore = info.age < 28 && info.overall >= 80;
    const strengthRecovered = s.strengthDelta2 !== null ? s.strengthDelta2 >= 0 : null;
    let cls;
    if (s.distress) cls = 'GOOD';
    else if (oldStar && (s.replacedWithin2 || strengthRecovered)) cls = 'GOOD';
    else if (s.replacedWithin1) cls = 'REASONABLE';
    else if (wasYoungCore && !s.replacedWithin2 && strengthRecovered === false) cls = 'BAD';
    else if (wasElite && !s.replacedWithin2) cls = 'QUESTIONABLE';
    else cls = 'REASONABLE';
    classified[cls]++;
    if (cls === 'BAD') badCases.push(s);
  });
  const total = sales.length;
  Object.entries(classified).forEach(([k, v]) => console.log('  ' + k + ': ' + v + ' (' + round(100 * v / total, 1) + '%)'));
  console.log('\nBAD-Sales-Cluster (n=' + badCases.length + '):');
  const clusters = { hoheReserveVerkauft: 0, keinErsatzAmMarkt: 0, ErsatzVerfuegbarNichtGekauft: 0, MarktUeberhauptNichtGeprueft: 0 };
  badCases.forEach((s) => {
    const budgetHigh = s.sale.info.sellerBudget > 20000000;
    if (budgetHigh) clusters.hoheReserveVerkauft++;
    if (!s.buyOptionSeen) clusters.keinErsatzAmMarkt++;
    else if (!s.buyChosen) clusters.ErsatzVerfuegbarNichtGekauft++;
  });
  console.log(JSON.stringify(clusters));
}

console.log('\n=== PHASE 24: No-Replacement-Sales -- A-E-Klassifikation (Ziel: die wichtigsten Kategorien quantifizieren) ===');
{
  const noReplacement = sales.filter((s) => !s.replacedWithin1 && !s.distress);
  console.log('n Verkaeufe ohne Zwang UND ohne Ersatz binnen 1 Saison=' + noReplacement.length + '/' + sales.filter((s) => !s.distress).length);
  let A = 0, B = 0, D = 0, E = 0;
  noReplacement.forEach((s) => {
    const surplusRoster = s.activeCountAtSale !== null && s.activeCountAtSale >= 4; // Sub noch da -- kein akuter Ersatzbedarf
    if (surplusRoster) { A++; return; }
    if (!s.buyOptionSeen) { B++; return; }
    if (!s.buyChosen) {
      D++; // C und D zusammengefasst (siehe Log-Text) -- beide bedeuten "Option war da, wurde nicht genutzt"
      return;
    }
    // buyChosen aber trotzdem kein sichtbarer Ersatz binnen 1 Saison (evtl. Timing/andere Rolle) -> als potenziell schlecht werten
    E++;
  });
  console.log('A) kein Ersatz noetig (Kader hatte Puffer/Sub): ' + A + ' (' + round(100 * A / noReplacement.length, 1) + '%)');
  console.log('B) Ersatz waere sinnvoll, Markt hatte nichts (nie BUY_PLAYER-Option gesehen): ' + B + ' (' + round(100 * B / noReplacement.length, 1) + '%)');
  console.log('C+D) Ersatz-Option war da, aber Bot kaufte nicht/investierte anders: ' + D + ' (' + round(100 * D / noReplacement.length, 1) + '%)');
  console.log('E) Kaufoption genutzt, aber trotzdem kein sichtbarer Ersatz binnen 1 Saison (Rand-/Timing-Faelle): ' + E + ' (' + round(100 * E / noReplacement.length, 1) + '%)');
}

console.log('\n=== PHASE 25: Sale -> Roster Damage (Staerkeverlust-Schwellen, S+2) ===');
{
  const withDelta = sales.filter((s) => s.strengthDelta2 !== null);
  [3, 5, 10, 20].forEach((threshold) => {
    const count = withDelta.filter((s) => -s.strengthDelta2 > threshold).length;
    console.log('  Verlust >' + threshold + ' Staerkepunkte (S+2): ' + count + ' (' + round(100 * count / withDelta.length, 1) + '%)');
  });
}

console.log('\n=== PHASE 26: Star Sales (Overall >=90) ===');
{
  const stars = sales.filter((s) => s.sale.info.overall >= 90);
  console.log('n=' + stars.length);
  const byReason = {};
  stars.forEach((s) => { byReason[s.sale.info.reason] = (byReason[s.sale.info.reason] || 0) + 1; });
  console.log('Nach Grund: ' + JSON.stringify(byReason));
  const distressCount = stars.filter((s) => s.distress).length;
  const oldCount = stars.filter((s) => s.sale.info.age >= 30).length;
  console.log('Finanznotlage: ' + round(100 * distressCount / stars.length, 1) + '% | Alter>=30: ' + round(100 * oldCount / stars.length, 1) + '% | Weder-noch (potenziell strategisch/fragwuerdig): ' + round(100 * stars.filter((s) => !s.distress && s.sale.info.age < 30).length / stars.length, 1) + '%');
}
