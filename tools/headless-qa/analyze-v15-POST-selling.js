// Bot Ecosystem V15, Phase 9 (Selling AI, kontrafaktische Klassifikation
// GOOD/REASONABLE/QUESTIONABLE/BAD, >=5000 Verkaeufe) / Phase 10 (Verkauf
// wichtiger Starter ohne Ersatz UND ohne finanziellen Zwang). Kombiniert
// transferLog (qaInfo: overall/potential/age/sellerFinanceStatus/
// sellerBudget/reason) mit powerSnapshots (Staerke vorher/nachher) und
// erneutem transferLog-Scan (Ersatz durch dieselbe Org binnen 1/2 Saisons).
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-POST-' + s + '.json') }));

console.log('=== PHASE 9: Selling AI -- datenbasierte Klassifikation ===');
{
  const classified = { GOOD: 0, REASONABLE: 0, QUESTIONABLE: 0, BAD: 0 };
  let total = 0;
  const badExamples = [];
  runs.forEach(({ seed, data }) => {
    const sales = data.transferLog.filter((t) => t.price > 0 && t.info && typeof t.info.sellerFinanceStatus === 'string' && t.info.overall);
    sales.forEach((sale) => {
      total++;
      const distress = sale.info.sellerFinanceStatus === 'CRITICAL' || sale.info.sellerFinanceStatus === 'INSOLVENT';
      const oldStar = sale.info.age >= 30;
      const wasElite = sale.info.overall >= 85;
      const wasYoungCore = sale.info.age < 28 && sale.info.overall >= 80;
      // "Ersatz binnen N Saisons": eine spaetere Kauf-Transaktion DERSELBEN Org (egal welcher Spieler -- Rosterlueckenschluss zaehlt, kein exaktes 1:1-Namens-Matching noetig)
      const replacedWithin1 = data.transferLog.some((t2) => t2.to === sale.from && t2.season === sale.season + 1 && t2.info && t2.info.overall);
      const replacedWithin2 = replacedWithin1 || data.transferLog.some((t2) => t2.to === sale.from && t2.season === sale.season + 2 && t2.info && t2.info.overall);
      // Staerke der verkaufenden Org: Saison des Verkaufs vs. +2 Saisons
      const sNow = findSnap(data, sale.season), sLater = findSnap(data, Math.min(data.targetSeasons, sale.season + 2));
      const rNow = sNow ? rowByName(sNow, sale.from) : null, rLater = sLater ? rowByName(sLater, sale.from) : null;
      const strengthRecovered = rNow && rLater ? rLater.strength >= rNow.strength : null;

      let cls;
      if (distress) cls = 'GOOD'; // erzwungene Notlage -- rational per Definition
      else if (oldStar && (replacedWithin2 || strengthRecovered)) cls = 'GOOD'; // alternder Spieler, sinnvoll abgeloest/kompensiert
      else if (replacedWithin1) cls = 'REASONABLE'; // schnell ersetzt, kein Loch entstanden
      else if (wasYoungCore && !replacedWithin2 && strengthRecovered === false) cls = 'BAD'; // junger Leistungstraeger weg, kein Ersatz, Staerke sinkt
      else if (wasElite && !replacedWithin2) cls = 'QUESTIONABLE'; // starker Spieler weg, kein schneller Ersatz, aber Staerke nicht klar gesunken
      else cls = 'REASONABLE';
      classified[cls]++;
      if (cls === 'BAD' && badExamples.length < 6) badExamples.push(seed + '/' + sale.from + ': ' + sale.player + ' (Overall ' + sale.info.overall + ', Alter ' + sale.info.age + ') S' + sale.season + ', finance=' + sale.info.sellerFinanceStatus);
    });
  });
  console.log('n=' + total + ' (Ziel >=5000)');
  Object.entries(classified).forEach(([k, v]) => console.log('  ' + k + ': ' + v + ' (' + round(100 * v / total, 1) + '%)'));
  console.log('BAD-Beispiele: ' + badExamples.join(' | '));
}

console.log('\n=== PHASE 10: Verkauf wichtiger Starter OHNE Ersatz UND OHNE finanziellen Zwang ===');
{
  let cases = 0, total = 0;
  runs.forEach(({ data }) => {
    const sales = data.transferLog.filter((t) => t.price > 0 && t.info && typeof t.info.sellerFinanceStatus === 'string' && t.info.overall && t.info.role === 'Starter');
    sales.forEach((sale) => {
      total++;
      const distress = sale.info.sellerFinanceStatus === 'CRITICAL' || sale.info.sellerFinanceStatus === 'INSOLVENT';
      if (distress) return;
      const replacedWithin1 = data.transferLog.some((t2) => t2.to === sale.from && t2.season === sale.season + 1 && t2.info && t2.info.overall);
      if (!replacedWithin1) cases++;
    });
  });
  console.log('n Starter-Verkaeufe=' + total + ' -- davon OHNE finanziellen Zwang UND OHNE Ersatz binnen 1 Saison: ' + cases + ' (' + round(100 * cases / total, 1) + '%)');
  console.log('(Hinweis: "kein Ersatz binnen 1 Saison ueber transferLog" ueberschaetzt echte Luecken leicht -- der V14-Retirement-Fix-Mechanismus UND passive Rosterauffuellung ausserhalb von transferLog werden hier nicht erfasst, siehe Abschlussbericht-Disclaimer.)');
}
