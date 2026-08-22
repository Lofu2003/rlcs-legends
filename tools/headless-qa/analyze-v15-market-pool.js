// Bot Ecosystem V15, Phase 5 "Unused Wealth Root Cause" -- Kernfund dieser
// Runde: FREE_AGENT_PLAYERS (data/free-agents.js) ist ein FESTER Pool mit
// nur 180 Eintraegen OHNE Nachfuell-Mechanik (anders als FREE_AGENT_STAFF/
// FREE_AGENT_COACHES, die ensureStaffMarketPopulation() haben, siehe
// renderer.js). signedFreeAgentPlayers waechst nur (Set), wird NIE geleert
// ausser bei neuer Karriere. Bei 453 konkurrierenden Bot-Orgs ist der Pool
// damit strukturell fast sofort erschoepft.
const { loadRun, round, mean } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-BASE-' + s + '.json') }));

console.log('=== PHASE 5a: Free-Agent-Spieler-Pool-Erschoepfung ueber die Zeit (gepoolt) ===');
{
  [1, 2, 3, 5, 10, 20, 30, 50].forEach((season) => {
    const remainings = [];
    runs.forEach(({ data }) => {
      const snap = data.marketPoolSnapshots.find((s) => s.season === season);
      if (snap) remainings.push(snap.playersRemaining);
    });
    if (!remainings.length) return;
    console.log('S' + season + ': Ø-verbleibende FA-Spieler=' + round(mean(remainings), 1) + '/180 (' + round(100 * mean(remainings) / 180, 1) + '%) [' + remainings.join(',') + ']');
  });
}

console.log('\n=== PHASE 5b: Missed-Opportunity-Log -- Gruende fuer "kein Kauf" (gepoolt, gedeckelt auf letzte 8000/Lauf) ===');
{
  const reasonCounts = {};
  let total = 0;
  runs.forEach(({ data }) => {
    (data.missedOpportunityLog || []).forEach((e) => {
      total++;
      const r = e.reason || (e.tooExpensiveCount > 0 ? 'TOO_EXPENSIVE(shortlist)' : e.scoutTooLowCount > 0 ? 'SCOUT_PERCEPTION' : 'OTHER');
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    });
  });
  console.log('n=' + total);
  Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => console.log('  ' + r + ': ' + c + ' (' + round(100 * c / total, 1) + '%)'));
}

console.log('\n=== PHASE 5c: SEASONAL_ECONOMY-Entscheidungen OHNE jede BUY_PLAYER-Option im availableOptions (= Kandidatenfunktion lieferte null) ===');
{
  let totalDecisions = 0, noBuyOptionAtAll = 0;
  let weakRosterRichBudgetNoBuyOption = 0, weakRosterRichBudgetCases = 0;
  runs.forEach(({ data }) => {
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').forEach((d) => {
      totalDecisions++;
      const hasBuyOption = (d.availableOptions || []).some((o) => o.label === 'BUY_PLAYER');
      if (!hasBuyOption) noBuyOptionAtAll++;
      // "Unused Wealth"-Signatur: schwacher Kader (weakestStarterOverall < rosterAvg - 10) + grosses Budget (>50 Mio)
      if (d.weakestStarterOverall > 0 && d.rosterAvgOverall - d.weakestStarterOverall >= 10 && d.budget > 50000000) {
        weakRosterRichBudgetCases++;
        if (!hasBuyOption) weakRosterRichBudgetNoBuyOption++;
      }
    });
  });
  console.log('n SEASONAL_ECONOMY-Entscheidungen=' + totalDecisions);
  console.log('davon OHNE jede BUY_PLAYER-Option (Kandidatenfunktion lieferte null)=' + noBuyOptionAtAll + ' (' + round(100 * noBuyOptionAtAll / totalDecisions, 1) + '%)');
  console.log('Faelle "schwacher Slot + Budget>50Mio"=' + weakRosterRichBudgetCases + ', davon OHNE BUY_PLAYER-Option=' + weakRosterRichBudgetNoBuyOption + ' (' + round(100 * weakRosterRichBudgetNoBuyOption / (weakRosterRichBudgetCases || 1), 1) + '%)');
}

console.log('\n=== PHASE 5d: Kreuzvergleich -- Pool-Fuellstand zum Zeitpunkt der "kein Kauf trotz Bedarf"-Faelle ===');
{
  const buckets = { poolFull: [], poolMedium: [], poolLow: [] }; // >50%, 20-50%, <20% verbleibend
  runs.forEach(({ data }) => {
    const poolBySeasonMap = {};
    data.marketPoolSnapshots.forEach((s) => { poolBySeasonMap[s.season] = s.playersRemaining / s.playersTotal; });
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').forEach((d) => {
      if (!(d.weakestStarterOverall > 0 && d.rosterAvgOverall - d.weakestStarterOverall >= 10 && d.budget > 50000000)) return;
      const hasBuyOption = (d.availableOptions || []).some((o) => o.label === 'BUY_PLAYER');
      const poolPct = poolBySeasonMap[d.season];
      if (poolPct === undefined) return;
      const bucket = poolPct > 0.5 ? 'poolFull' : poolPct > 0.2 ? 'poolMedium' : 'poolLow';
      buckets[bucket].push(hasBuyOption);
    });
  });
  Object.entries(buckets).forEach(([b, arr]) => {
    if (!arr.length) { console.log(b + ': n=0'); return; }
    const hadOption = arr.filter(Boolean).length;
    console.log(b + ': n=' + arr.length + ' hatte BUY_PLAYER-Option=' + hadOption + ' (' + round(100 * hadOption / arr.length, 1) + '%)');
  });
}
