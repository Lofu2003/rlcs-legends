// Bot Ecosystem V14, Phase 6 (Why Top Teams Fall) / Phase 7 (Event Study,
// >=100 grosse Abstuerze) / Phase 8 (Death-Spiral-Feedback-Loop-Test) --
// gepoolt ueber alle 6 V14-BASE-Seeds (A-F), volle Jahres-Granularitaet.
const { loadRun, round, mean, pearson, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv14_V14-BASE-' + s + '.json') }));

function eventsInWindow(run, orgName, fromSeason, toSeasonExclusive) {
  const retirements = run.retirementLog.filter((r) => r.orgName === orgName && r.season >= fromSeason && r.season < toSeasonExclusive);
  const sales = run.transferLog.filter((t) => t.from === orgName && t.price > 0 && t.season >= fromSeason && t.season < toSeasonExclusive);
  const staffRoles = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];
  const staffChanges = run.transferLog.filter((t) => (t.to === orgName || t.from === orgName) && t.info && staffRoles.includes(t.info.role) && t.season >= fromSeason && t.season < toSeasonExclusive);
  return { retirements, sales, staffChanges };
}

console.log('=== PHASE 6: Warum fallen urspruengliche Top10 (S0)? Ursachen im Fenster VOR dem Absturz-Onset ===');
{
  let caseCount = 0;
  const tally = { hadRetirement: 0, hadSale: 0, hadStaffChange: 0, budgetDeclined: 0, moraleDeclined: 0, coachLost: 0, staffQualityDeclined: 0 };
  const examples = [];
  runs.forEach(({ seed, data }) => {
    data.setup.cohorts.top10.forEach((orgName) => {
      // Onset = erste Saison (>=3), in der der Rang > 50 faellt UND dort bleibt (naechste 2 Saisons ebenfalls > 50) -- vermeidet Ein-Saison-Ausreisser.
      let onset = null;
      for (let s = 3; s <= data.targetSeasons - 2; s++) {
        const r0 = rowByName(findSnap(data, s), orgName);
        const r1 = rowByName(findSnap(data, s + 1), orgName);
        const r2 = rowByName(findSnap(data, s + 2), orgName);
        if (r0 && r1 && r2 && r0.rank > 50 && r1.rank > 50 && r2.rank > 50) { onset = s; break; }
      }
      if (onset === null) return; // nie unter Top50 gefallen -- kein Absturzfall
      caseCount++;
      const windowStart = Math.max(0, onset - 5);
      const ev = eventsInWindow(data, orgName, windowStart, onset);
      if (ev.retirements.length > 0) tally.hadRetirement++;
      if (ev.sales.length > 0) tally.hadSale++;
      if (ev.staffChanges.length > 0) tally.hadStaffChange++;
      const rowBefore = rowByName(findSnap(data, windowStart), orgName);
      const rowAt = rowByName(findSnap(data, onset), orgName);
      if (rowBefore && rowAt) {
        if (rowAt.budget < rowBefore.budget) tally.budgetDeclined++;
        if (rowAt.teamMorale < rowBefore.teamMorale) tally.moraleDeclined++;
        if (rowAt.staffQuality < rowBefore.staffQuality) tally.staffQualityDeclined++;
        if (rowBefore.coachOverall !== null && rowAt.coachOverall === null) tally.coachLost++;
      }
      if (examples.length < 8) examples.push(seed + '/' + orgName + ': Onset S' + onset + ', Retirements=' + ev.retirements.length + ', Sales=' + ev.sales.length + ', StaffChanges=' + ev.staffChanges.length);
    });
  });
  console.log('Abgestuerzte Top10-Faelle (Rang>50, S3-S' + (runs[0].data.targetSeasons - 2) + '): ' + caseCount);
  Object.entries(tally).forEach(([k, v]) => console.log('  ' + k + ': ' + v + '/' + caseCount + ' (' + round(100 * v / caseCount, 1) + '%)'));
  console.log('Beispiele:'); examples.forEach((e) => console.log('  ' + e));
}

console.log('\n=== PHASE 7: Event Study -- Ranganstieg-Verlust >=50 Plaetze innerhalb 5 Saisons (alle Orgs, Ziel >=100 Faelle) ===');
{
  const events = [];
  runs.forEach(({ seed, data }) => {
    const allNames = data.setup.allBotNames;
    for (let s = 5; s <= data.targetSeasons; s++) {
      const snapBefore = findSnap(data, s - 5), snapNow = findSnap(data, s);
      if (!snapBefore || !snapNow) continue;
      allNames.forEach((name) => {
        const rBefore = rowByName(snapBefore, name), rNow = rowByName(snapNow, name);
        if (!rBefore || !rNow) return;
        if (rNow.rank - rBefore.rank >= 50) events.push({ seed, name, fromSeason: s - 5, toSeason: s, rankBefore: rBefore.rank, rankAfter: rNow.rank });
      });
    }
  });
  console.log('Gefundene Events: ' + events.length);
  const tally = { hadRetirement: 0, hadSale: 0, hadStaffChange: 0, budgetDeclined: 0, moraleDeclined: 0, coachLost: 0 };
  events.forEach((e) => {
    const data = runs.find((r) => r.seed === e.seed).data;
    const ev = eventsInWindow(data, e.name, e.fromSeason, e.toSeason);
    if (ev.retirements.length > 0) tally.hadRetirement++;
    if (ev.sales.length > 0) tally.hadSale++;
    if (ev.staffChanges.length > 0) tally.hadStaffChange++;
    const rowBefore = rowByName(findSnap(data, e.fromSeason), e.name);
    const rowAt = rowByName(findSnap(data, e.toSeason), e.name);
    if (rowBefore && rowAt) {
      if (rowAt.budget < rowBefore.budget) tally.budgetDeclined++;
      if (rowAt.teamMorale < rowBefore.teamMorale) tally.moraleDeclined++;
      if (rowBefore.coachOverall !== null && rowAt.coachOverall === null) tally.coachLost++;
    }
  });
  Object.entries(tally).forEach(([k, v]) => console.log('  ' + k + ': ' + v + '/' + events.length + ' (' + round(100 * v / events.length, 1) + '%)'));
}

console.log('\n=== PHASE 8: Death-Spiral-Test -- Lag-Korrelationen ueber ALLE Org-Saison-Uebergaenge (gepoolt) ===');
{
  const strengthDeltaSeries = [], winPctDeltaSeries = [], budgetDeltaPctSeries = [];
  const nextStrengthDelta = [];
  runs.forEach(({ data }) => {
    const allNames = data.setup.allBotNames;
    allNames.forEach((name) => {
      const rows = [];
      for (let s = 0; s <= data.targetSeasons; s++) { const r = rowByName(findSnap(data, s), name); if (r) rows.push({ season: s, ...r }); }
      for (let i = 1; i < rows.length - 1; i++) {
        const prev = rows[i - 1], cur = rows[i], next = rows[i + 1];
        const prevMatches = prev.wins + prev.losses, curMatches = cur.wins + cur.losses;
        const prevWinPct = prevMatches > 0 ? prev.wins / prevMatches : null;
        const curWinPct = curMatches > 0 ? cur.wins / curMatches : null;
        if (prevWinPct === null || curWinPct === null) continue;
        const strengthDelta = cur.strength - prev.strength;
        const winPctDelta = curWinPct - prevWinPct;
        const budgetDeltaPct = prev.budget > 0 ? (cur.budget - prev.budget) / prev.budget : null;
        const nextDelta = next.strength - cur.strength;
        if (budgetDeltaPct === null) continue;
        strengthDeltaSeries.push(strengthDelta);
        winPctDeltaSeries.push(winPctDelta);
        budgetDeltaPctSeries.push(budgetDeltaPct);
        nextStrengthDelta.push(nextDelta);
      }
    });
  });
  console.log('n Uebergaenge=' + strengthDeltaSeries.length);
  console.log('Korrelation strengthDelta(t) <-> winPctDelta(t): ' + pearson(strengthDeltaSeries, winPctDeltaSeries));
  console.log('Korrelation winPctDelta(t) <-> budgetDeltaPct(t): ' + pearson(winPctDeltaSeries, budgetDeltaPctSeries));
  console.log('Korrelation budgetDeltaPct(t) <-> strengthDelta(t+1) [Feedback-Loop-Kern]: ' + pearson(budgetDeltaPctSeries, nextStrengthDelta));
  console.log('Autokorrelation strengthDelta(t) <-> strengthDelta(t+1) [>0 = Todesspirale/Selbstverstaerkung, <0 = Mean-Reversion/Erholung, ~0 = kein Momentum]: ' + pearson(strengthDeltaSeries, nextStrengthDelta));
}
