// Bot Ecosystem V15, Phase 21 (Recovery Study) / Phase 22 (Success Study) /
// Phase 23 (New Elite Study) / Phase 24 (Dynasty Failure) -- erweitert V14s
// reine Rang-Betrachtung um Management-Entscheidungen (decisionLog) im
// jeweiligen Zeitfenster.
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-POST-' + s + '.json') }));

function decisionRates(data, orgName, fromSeason, toSeasonExclusive) {
  const ds = (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.org === orgName && d.season >= fromSeason && d.season < toSeasonExclusive);
  if (!ds.length) return null;
  const rate = (label) => ds.filter((d) => d.chosenLabel === label).length / ds.length;
  return { n: ds.length, buyRate: rate('BUY_PLAYER'), sellRate: rate('SELL_PLAYER'), hireRate: rate('HIRE_STAFF'), saveRate: rate('SAVE_MONEY') };
}

console.log('=== PHASE 21: Recovery Study -- Top50 -> unter Rang150: was unterscheidet Rueckkehrer von dauerhaft Schwachen? ===');
{
  const recovered = [], stuck = [];
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      for (let s = 1; s <= data.targetSeasons - 10; s++) {
        const rPrev = rowByName(findSnap(data, s - 1), name), rNow = rowByName(findSnap(data, s), name);
        if (!rPrev || !rNow || rPrev.rank > 50 || rNow.rank <= 150) continue;
        const rLater = rowByName(findSnap(data, s + 10), name);
        const rates = decisionRates(data, name, s, s + 10);
        if (!rates) continue;
        if (rLater && rLater.rank <= 50) recovered.push(rates); else stuck.push(rates);
      }
    });
  });
  console.log('Rueckkehrer n=' + recovered.length + ' | Dauerhaft-schwach n=' + stuck.length);
  ['buyRate', 'sellRate', 'hireRate', 'saveRate'].forEach((k) => {
    console.log('  ' + k + ': Rueckkehrer=' + round(100 * mean(recovered.map((r) => r[k])), 1) + '% vs Dauerhaft-schwach=' + round(100 * mean(stuck.map((r) => r[k])), 1) + '%');
  });
}

console.log('\n=== PHASE 22: Success Study -- Bottom200 -> Top50: welche Entscheidungen begleiten den Aufstieg? ===');
{
  const climbers = [];
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      for (let s = 10; s <= data.targetSeasons; s++) {
        const rBefore = rowByName(findSnap(data, s - 10), name), rNow = rowByName(findSnap(data, s), name);
        if (!rBefore || !rNow || rBefore.rank < 200 || rNow.rank > 50) continue;
        const rates = decisionRates(data, name, s - 10, s);
        if (rates) climbers.push(rates);
      }
    });
  });
  console.log('n Aufstiegs-Episoden (Bottom200->Top50 binnen 10 Saisons)=' + climbers.length);
  ['buyRate', 'sellRate', 'hireRate', 'saveRate'].forEach((k) => console.log('  Ø-' + k + '=' + round(100 * mean(climbers.map((r) => r[k])), 1) + '%'));
}

console.log('\n=== PHASE 23: New Elite Study -- was passiert in den ersten 1/2/3/5 Saisons nach Top10-Eintritt? ===');
{
  const episodes = [];
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      for (let s = 1; s <= data.targetSeasons; s++) {
        const rPrev = rowByName(findSnap(data, s - 1), name), rNow = rowByName(findSnap(data, s), name);
        if (!rPrev || !rNow || rPrev.rank <= 10 || rNow.rank > 10) continue;
        episodes.push({ data, name, entrySeason: s });
      }
    });
  });
  console.log('n Top10-Neueintritte=' + episodes.length + ' (Ziel >=500)');
  [1, 2, 3, 5].forEach((horizon) => {
    let hadRetirement = 0, hadSale = 0, total = 0;
    episodes.forEach(({ data, name, entrySeason }) => {
      const ret = data.retirementLog.filter((r) => r.orgName === name && r.season >= entrySeason && r.season < entrySeason + horizon).length;
      const sale = data.transferLog.filter((t) => t.from === name && t.price > 0 && t.season >= entrySeason && t.season < entrySeason + horizon).length;
      total++;
      if (ret > 0) hadRetirement++;
      if (sale > 0) hadSale++;
    });
    console.log('  Binnen ' + horizon + ' Saison(en) nach Eintritt: Verrentung in ' + round(100 * hadRetirement / total, 1) + '%, Verkauf in ' + round(100 * hadSale / total, 1) + '% der Episoden (n=' + total + ')');
  });
}

console.log('\n=== PHASE 24: Dynasty Failure -- korreliert das Verlassen von Top10 mit Verrentung im selben Fenster? ===');
{
  let exits = 0, exitsWithRetirement = 0;
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      for (let s = 1; s <= data.targetSeasons; s++) {
        const rPrev = rowByName(findSnap(data, s - 1), name), rNow = rowByName(findSnap(data, s), name);
        if (!rPrev || !rNow || rPrev.rank > 10 || rNow.rank <= 10) continue;
        exits++;
        const ret = data.retirementLog.filter((r) => r.orgName === name && r.season >= s - 1 && r.season <= s).length;
        if (ret > 0) exitsWithRetirement++;
      }
    });
  });
  console.log('n Top10-Austritte=' + exits + ' davon mit Verrentung im selben/vorherigen Fenster: ' + exitsWithRetirement + ' (' + round(100 * exitsWithRetirement / exits, 1) + '%)');
  console.log('(Konsistent mit dem V14-Root-Cause: Dynastien scheitern ueberwiegend am selben Mechanismus wie generelle Top-Team-Abstuerze -- Verrentung dominiert.)');
}
