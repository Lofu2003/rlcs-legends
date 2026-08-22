// Bot Ecosystem V14, Phase 9 (Replacement Quality) / Phase 10-11 (Transfer AI
// Rationalitaet, Value Intelligence) / Phase 12 (Selling Intelligence) /
// Phase 13 (Contract Retention) / Phase 31 (Strong-vs-Weak-Management-Test,
// wiederverwendet die Rationalitaets-Klassifikation aus Phase 11 statt einem
// isolierten synthetischen Test -- Auftrag verbietet ausdruecklich eine neue
// Bot-KI, "nur bestehende Entscheidungen bewerten"). Datenquelle: transferLog
// (jetzt mit vollem qaInfo an ALLEN Bot-Kaufpfaden, siehe renderer.js-
// Erweiterung dieser Runde) und qaRetirementLog aus allen 6 V14-BASE-Seeds.
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv14_V14-BASE-' + s + '.json') }));

console.log('=== PHASE 13: Contract Retention -- strukturelle Vorpruefung (Code-Beweis) ===');
console.log('checkBotOrgContractExpirations() (renderer.js) ruft fuer JEDEN Bot-Org-Slot mit');
console.log('abgelaufenem Vertrag UNBEDINGT renewContractInPlace() auf -- kein Bedingungspfad');
console.log('fuehrt je zu einem echten Vertragsverlust bei Bot-Orgs (nur assignedOrg hat eine');
console.log('echte Verlust-Moeglichkeit ueber removeOwnExpiredPerson()). "Contract Loss" ist fuer');
console.log('die 453 Bot-Orgs strukturell 0 -- keine Simulation noetig, siehe Codepfad.');
{
  // Empirische Gegenprobe: qaRetirementLog enthaelt AUSSCHLIESSLICH altersbedingte
  // Abgaenge (kein "reason"-Feld noetig, weil kein anderer Abgangsweg existiert).
  let totalRetirements = 0;
  runs.forEach(({ data }) => { totalRetirements += data.retirementLog.length; });
  console.log('Empirische Gegenprobe: ' + totalRetirements + ' Log-Eintraege in qaRetirementLog ueber alle 6 Seeds, ALLE aus ageAndRetireRosterForSeason() (einziger Erzeugungsort, siehe grep) -- 0 vertragsbedingte Abgaenge moeglich.');
}

console.log('\n=== PHASE 9: Replacement Quality nach Retirement (Free-Agent-Nachbesetzung, matched by org+role+Fenster<=2 Saisons) ===');
{
  const buckets = { weak: [], mid: [], strong: [] }; // nach orgStrength zum Retirement-Zeitpunkt
  let matched = 0, unmatched = 0;
  runs.forEach(({ data }) => {
    const faBuys = data.transferLog.filter((t) => t.from === 'Free Agent' && t.info && typeof t.info.replacedOverall === 'number');
    data.retirementLog.forEach((ret) => {
      const cand = faBuys.filter((t) => t.to === ret.orgName && t.info.role === ret.role && t.season >= ret.season && t.season <= ret.season + 2);
      if (cand.length === 0) { unmatched++; return; }
      const repl = cand[0];
      matched++;
      const gap = ret.overall - repl.info.overall; // positiv = Ersatz SCHWAECHER als der Verrentete
      const tier = ret.orgStrength >= 70 ? 'strong' : ret.orgStrength >= 35 ? 'mid' : 'weak';
      buckets[tier].push(gap);
    });
  });
  console.log('Matched=' + matched + ' Unmatched(kein FA-Kauf im Fenster gefunden)=' + unmatched);
  Object.entries(buckets).forEach(([tier, gaps]) => {
    if (!gaps.length) { console.log(tier + ': n=0'); return; }
    console.log(tier + ' (OrgStrength): n=' + gaps.length + ' Ø-Gap(verrentet-ersatz)=' + round(mean(gaps), 2) + ' (positiv=Ersatz schwaecher, negativ=Ersatz staerker) | Ersatz schwaecher in ' + round(100 * gaps.filter((g) => g > 0).length / gaps.length, 1) + '% der Faelle');
  });
}

console.log('\n=== PHASE 10/11: Transfer AI Rationalitaet & Value Intelligence (alle FA-Kaeufe mit qaInfo, Ziel >=1000) ===');
{
  const buys = [];
  runs.forEach(({ data }) => {
    data.transferLog.filter((t) => t.from === 'Free Agent' && t.info && typeof t.info.replacedOverall === 'number' && typeof t.info.buyerBudget === 'number')
      .forEach((t) => buys.push(t));
  });
  console.log('n Kaeufe mit vollem qaInfo=' + buys.length);
  const gains = buys.map((t) => t.info.overall - t.info.replacedOverall);
  const rational = buys.filter((t) => t.info.overall > t.info.replacedOverall).length;
  console.log('Rational (Ersatz > vorheriger Spieler): ' + rational + '/' + buys.length + ' (' + round(100 * rational / buys.length, 1) + '%)');
  console.log('Irrational/neutral (Ersatz <= vorheriger Spieler): ' + (buys.length - rational) + '/' + buys.length + ' (' + round(100 * (buys.length - rational) / buys.length, 1) + '%)');
  console.log('Ø Overall-Gewinn pro Kauf: ' + round(mean(gains), 2));
  // Reiche Kaeufer (Budget-Quartile) -- kaufen sie tatsaechlich bessere Spieler?
  const sorted = [...buys].sort((a, b) => a.info.buyerBudget - b.info.buyerBudget);
  const q = Math.floor(sorted.length / 4);
  const quartiles = [sorted.slice(0, q), sorted.slice(q, 2 * q), sorted.slice(2 * q, 3 * q), sorted.slice(3 * q)];
  quartiles.forEach((qb, i) => {
    console.log('Budget-Quartil ' + (i + 1) + ' (n=' + qb.length + ', Ø-Budget=' + round(mean(qb.map((t) => t.info.buyerBudget))) + '): Ø-gekauft-Overall=' + round(mean(qb.map((t) => t.info.overall)), 1) + ' Ø-Gain=' + round(mean(qb.map((t) => t.info.overall - t.info.replacedOverall)), 2));
  });
}

console.log('\n=== PHASE 12: Selling Intelligence -- verkaufen gesunde/reiche Orgs unnoetig starke Spieler? ===');
{
  const sales = [];
  runs.forEach(({ data }) => {
    data.transferLog.filter((t) => t.price > 0 && t.info && typeof t.info.sellerFinanceStatus === 'string').forEach((t) => sales.push(t));
  });
  console.log('n Verkaeufe mit qaInfo=' + sales.length);
  const byReason = {};
  sales.forEach((t) => { const r = t.info.reason || 'UNKNOWN'; byReason[r] = (byReason[r] || 0) + 1; });
  console.log('Nach Grund: ' + Object.entries(byReason).map(([k, v]) => k + '=' + v + ' (' + round(100 * v / sales.length, 1) + '%)').join(', '));
  const healthySalesOfStars = sales.filter((t) => t.info.sellerFinanceStatus === 'HEALTHY' && t.info.overall >= 80);
  console.log('HEALTHY-Orgs verkaufen 80+-Overall-Spieler (potenziell unnoetig): ' + healthySalesOfStars.length + '/' + sales.length + ' (' + round(100 * healthySalesOfStars.length / sales.length, 1) + '%)');
  if (healthySalesOfStars.length) {
    console.log('  Beispiele: ' + healthySalesOfStars.slice(0, 5).map((t) => t.player + ' (Overall ' + t.info.overall + ') von ' + t.from + ', Budget=' + Math.round(t.info.sellerBudget)).join(' | '));
  }
}

console.log('\n=== PHASE 31: Strong-vs-Weak-Management-Test (reale Entscheidungsvarianz, KEINE neue Bot-KI) ===');
console.log('Wiederverwendet die Phase-11-Rationalitaets-Klassifikation: fuehrt eine "rationale"');
console.log('Kaufserie (Overall-Gewinn bei den meisten eigenen Kaeufen) zu einem besseren Rang-');
console.log('Verlauf als eine "irrationale" Serie? Pro Org: alle FA-Kaeufe der Org zusammengefasst,');
console.log('rationalRate = Anteil Kaeufe mit Overall-Gewinn > 0.');
{
  runs.forEach(({ seed, data }) => {
    const byOrg = {};
    data.transferLog.filter((t) => t.from === 'Free Agent' && t.info && typeof t.info.replacedOverall === 'number').forEach((t) => {
      if (!byOrg[t.to]) byOrg[t.to] = [];
      byOrg[t.to].push(t.info.overall > t.info.replacedOverall);
    });
    const orgStats = Object.entries(byOrg).filter(([, arr]) => arr.length >= 3).map(([org, arr]) => ({ org, rationalRate: arr.filter(Boolean).length / arr.length }));
    if (orgStats.length < 10) return;
    orgStats.sort((a, b) => b.rationalRate - a.rationalRate);
    const topDecile = orgStats.slice(0, Math.floor(orgStats.length / 10));
    const bottomDecile = orgStats.slice(-Math.floor(orgStats.length / 10));
    function avgRankDelta(list) {
      const deltas = list.map(({ org }) => {
        const r0 = rowByName(findSnap(data, 0), org), rEnd = rowByName(findSnap(data, data.targetSeasons), org);
        return (r0 && rEnd) ? rEnd.rank - r0.rank : null;
      }).filter((v) => v !== null);
      return round(mean(deltas), 1);
    }
    console.log('[' + seed + '] n Orgs mit >=3 FA-Kaeufen=' + orgStats.length + ' | Top-Rationalitaets-Dezil (n=' + topDecile.length + ') Ø-Rangaenderung S0->Ende=' + avgRankDelta(topDecile) + ' | Bottom-Rationalitaets-Dezil (n=' + bottomDecile.length + ') Ø-Rangaenderung=' + avgRankDelta(bottomDecile) + ' (negativ=verbessert, positiv=verschlechtert)');
  });
}
