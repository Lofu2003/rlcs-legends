// Bot Ecosystem V9 -- Talent Retention + Organic Underdog Mobility.
// Phase 1: reine Instrumentierung, KEINE Gameplay-Aenderung. Baut auf V8s
// Kohorten-/Save-Load-Mechanik auf, ergaenzt um: vollen Spieler-Panel (jede
// Saison, alle 454 Orgs, stabile QA-Player-ID), angereichertes transferLog
// (Reason/Seller-/Buyer-Kontext, siehe renderer.js qaEnsurePlayerId()/
// qaOrgRank()-Hooks), qaRetirementLog.
// Nutzung: node audit-run-v9.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V9-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv9_' + SEED + '.json');

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  botMatchUpsetTally = { '0-5': { strongerWins: 0, upsets: 0 }, '6-10': { strongerWins: 0, upsets: 0 }, '11-20': { strongerWins: 0, upsets: 0 }, '21-30': { strongerWins: 0, upsets: 0 }, '30+': { strongerWins: 0, upsets: 0 } };
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  const top50Names0 = [...sorted].reverse().slice(0, 50).map((o) => o.name);
  const allBotNames = bots.map((o) => o.name);
  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10, top50Names0, allBotNames,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    mid10InitialStrength: mid10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
  };
}

function snapshotFn(cohortNames, checkpointLabel, prevTelemetryTotals, seasonNum, allBotNamesForTitles, prevTransferLogLen, prevRetirementLogLen, prevMissedOppLogLen, prevConsentLen) {
  function orgPotentialStats(org) {
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    if (!roster.length) return { avgOverall: 0, avgPotential: 0, avgAge: 0, minPotential: 0, maxPotential: 0 };
    let sumO = 0, sumP = 0, sumA = 0, minP = 999, maxP = 0;
    roster.forEach((p) => {
      ensurePersonHasPotential(p);
      sumO += p.overall; sumP += p.potential; sumA += p.age || 0;
      if (p.potential < minP) minP = p.potential;
      if (p.potential > maxP) maxP = p.potential;
    });
    return {
      avgOverall: Math.round(sumO / roster.length), avgPotential: Math.round(sumP / roster.length * 10) / 10,
      avgAge: Math.round(sumA / roster.length * 10) / 10, minPotential: minP, maxPotential: maxP,
    };
  }
  const allBots = ORGANIZATIONS.filter((o) => o.roster);
  const sortedByStrength = [...allBots].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const rankOf = new Map();
  sortedByStrength.forEach((o, i) => rankOf.set(o.name, i + 1));
  const n = allBots.length;
  const bottomThird = new Set(sortedByStrength.slice(Math.ceil(2 * n / 3)).map((o) => o.name));
  const middleThird = new Set(sortedByStrength.slice(Math.floor(n / 3), Math.ceil(2 * n / 3)).map((o) => o.name));
  const topThird = new Set(sortedByStrength.slice(0, Math.floor(n / 3)).map((o) => o.name));
  const tierOf = (name) => (topThird.has(name) ? 'top' : (bottomThird.has(name) ? 'bottom' : 'mid'));

  // Bug-Fix (Bot-Ökosystem V9, selbst gefunden vor Erstauswertung): careerState.
  // seasonNumber inkrementiert erst GANZ AM ENDE einer Saison (~Tag 390 von
  // ~390-400) -- ein Filter auf transferLog/qaRetirementLog via `t.season ===
  // curSeason` faengt an DIESER Stelle im Code fast NUR den kurzen Uebergangs-
  // Tag-Ausschlag (Saisonende-Ausmusterung/-Ersatz) ein, nicht die ~90% der
  // Saison-Aktivitaet, die noch mit der ALTEN Saisonnummer geloggt wurde.
  // Robuster Fix: Laengen-Delta seit dem letzten Snapshot (beide Logs nutzen
  // unshift() -- neueste Eintraege zuerst -- die neuen Eintraege seit dem
  // letzten Snapshot sind exakt die ersten N = aktuelle Laenge - vorherige
  // Laenge Eintraege), unabhaengig von der internen Saisonnummer-Beschriftung.
  const seasonTransfersAll = transferLog.slice(0, Math.max(0, transferLog.length - (prevTransferLogLen || 0)));
  const seasonRetirementsAll = qaRetirementLog.slice(Math.max(0, (prevRetirementLogLen || 0)));
  const seasonConsentChecksAll = qaConsentChecks.slice(Math.max(0, (prevConsentLen || 0)));
  const consentSummary = {
    total: seasonConsentChecksAll.length,
    consented: seasonConsentChecksAll.filter((c) => c.consented).length,
    vetoed: seasonConsentChecksAll.filter((c) => !c.consented).length,
    upwardMoves: seasonConsentChecksAll.filter((c) => c.strengthDelta > 0).length,
    upwardConsented: seasonConsentChecksAll.filter((c) => c.strengthDelta > 0 && c.consented).length,
    downwardMoves: seasonConsentChecksAll.filter((c) => c.strengthDelta <= 0).length,
    downwardConsented: seasonConsentChecksAll.filter((c) => c.strengthDelta <= 0 && c.consented).length,
  };

  const orgs = {};
  cohortNames.forEach((name) => {
    const o = findOrgByName(name);
    if (!o) { orgs[name] = null; return; }
    const potStats = orgPotentialStats(o);
    const stats = ensureCareerOrgStats(name);
    const seasonTransfers = seasonTransfersAll;
    const transfersIn = seasonTransfers.filter((t) => t.to === name);
    const transfersOut = seasonTransfers.filter((t) => t.from === name);
    orgs[name] = {
      strength: o.strength, rank: rankOf.get(name), budget: Math.round(o.budget),
      rosterValue: typeof orgRosterMarketValue === 'function' ? Math.round(orgRosterMarketValue(o.roster)) : null,
      financeStatus: o.financeStatus, riskProfile: o.riskProfile, goal: (typeof ensureBotOrgGoal === 'function' ? ensureBotOrgGoal(o) : null),
      teamMorale: typeof computeTeamMorale === 'function' ? Math.round(computeTeamMorale(o)) : null,
      avgOverall: potStats.avgOverall, avgPotential: potStats.avgPotential, avgPotentialGap: Math.round((potStats.avgPotential - potStats.avgOverall) * 10) / 10, avgAge: potStats.avgAge,
      minPotential: potStats.minPotential, maxPotential: potStats.maxPotential,
      hasCoach: !!o.roster.coach, coachOverall: o.roster.coach ? o.roster.coach.overall : null,
      staffFilled: (o.roster.staff || []).filter((s) => s && !s.vacant).length,
      majorsWon: stats.majorsWon, worldsWon: stats.worldsWon, playoffAppearances: stats.playoffAppearances,
      transfersInCount: transfersIn.length, transfersOutCount: transfersOut.length,
      transferSpend: transfersIn.reduce((s, t) => s + (t.price || 0), 0), transferIncome: transfersOut.reduce((s, t) => s + (t.price || 0), 0),
      investBudget: typeof botAvailableInvestmentBudget === 'function' ? Math.round(botAvailableInvestmentBudget(o)) : null,
    };
  });

  const budgets = allBots.map((o) => o.budget).sort((a, b) => a - b);
  const bn = budgets.length;
  const pct = (p) => budgets[Math.min(bn - 1, Math.max(0, Math.floor(p * bn)))];
  const mean = budgets.reduce((s, b) => s + b, 0) / bn;
  const totalMoneySupply = budgets.reduce((s, b) => s + Math.max(0, b), 0);
  let giniSum = 0;
  for (let i = 0; i < bn; i++) giniSum += (2 * (i + 1) - bn - 1) * budgets[i];
  const gini = giniSum / (bn * budgets.reduce((s, b) => s + Math.max(0, b), 0) || 1);
  const insolventCount = allBots.filter((o) => o.financeStatus === 'INSOLVENT').length;

  // VOLLER SPIELER-PANEL (Phase 2/6/8/9): jede Saison, alle 454 Orgs,
  // Starter+Sub -- stabile QA-Player-ID via qaEnsurePlayerId(). Karriere-
  // Rekonstruktion (Verbleib/Abgang/Grund) passiert bewusst NICHT hier
  // (VM-Kontext, kein Zustand zwischen game.run()-Aufrufen), sondern
  // post-hoc im Analyse-Skript durch Panel-Diffing zwischen Saisons.
  const playerRows = [];
  allBots.forEach((o) => {
    const roster = o.roster;
    const rank = rankOf.get(o.name);
    const tier = tierOf(o.name);
    [...(roster.starters || []).map((p) => [p, true]), [roster.sub, false]].forEach(([p, isStarter]) => {
      if (!p) return;
      ensurePersonHasPotential(p);
      playerRows.push({
        id: qaEnsurePlayerId(p), name: p.name, org: o.name, orgTier: tier, orgStrength: o.strength, orgRank: rank, orgBudget: Math.round(o.budget),
        overall: p.overall, potential: p.potential, age: p.age,
        salary: typeof playerMonthlySalary === 'function' ? Math.round(playerMonthlySalary(p)) : null,
        marketValue: typeof calculatePlayerTransferValue === 'function' ? Math.round(calculatePlayerTransferValue(p)) : null,
        contractEnd: p.contractEnd || null, isStarter,
      });
    });
  });

  const curSeason = careerState.seasonNumber;

  const staffMarket = {};
  ['Coach', 'Scout', 'Analyst', 'Finanzvorstand', 'PR-Manager', 'Psychologe', 'Physiotherapeut'].forEach((role) => {
    const isCoach = role === 'Coach';
    const employed = allBots.filter((o) => (isCoach ? !!o.roster.coach : (o.roster.staff || []).some((s) => s && !s.vacant && s.role === role))).length;
    const signedNames = new Set([...signedFreeAgentStaff].filter((k) => k.startsWith(role + '::')).map((k) => k.slice((role + '::').length)));
    const pool = isCoach ? FREE_AGENT_COACHES : (FREE_AGENT_STAFF[role] || []);
    const available = pool.filter((p) => !signedNames.has(p.name)).length;
    staffMarket[role] = { employed, totalOrgs: allBots.length, availableFreeAgents: available, poolSize: pool.length };
  });

  const allPlayers = [];
  allBots.forEach((o) => [...(o.roster.starters || []), o.roster.sub].filter(Boolean).forEach((p) => allPlayers.push({ org: o.name, overall: p.overall, potential: p.potential || 0 })));
  function concentration(sortKey, count) {
    const top = [...allPlayers].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, count);
    return { uniqueOrgs: new Set(top.map((p) => p.org)).size, count: top.length, inBottom10: top.filter((p) => cohortNames.slice(0, 10).includes(p.org)).length, inTop10: top.filter((p) => cohortNames.slice(20, 30).includes(p.org)).length };
  }
  const talentConcentration = { top25Potential: concentration('potential', 25), top50Potential: concentration('potential', 50), top100Potential: concentration('potential', 100) };

  const fairnessRatios = [];
  seasonTransfersAll.forEach((t) => {
    if (typeof t.price !== 'number' || t.price <= 0) return;
    let person = null;
    for (const o of allBots) {
      const p = [...(o.roster.starters || []), o.roster.sub].filter(Boolean).find((x) => x.name === t.player);
      if (p) { person = p; break; }
    }
    if (!person) return;
    const fv = calculatePlayerTransferValue(person);
    if (fv > 0) fairnessRatios.push(t.price / fv);
  });
  fairnessRatios.sort((a, b) => a - b);

  const telemetryTotals = { ...botEconomyTelemetryTotals };
  const telemetryDelta = {};
  Object.keys(telemetryTotals).forEach((k) => { telemetryDelta[k] = telemetryTotals[k] - ((prevTelemetryTotals && prevTelemetryTotals[k]) || 0); });

  const bottom10Set = new Set(cohortNames.slice(0, 10));
  // Gleicher Laengen-Delta-Fix wie oben bei transferLog/qaRetirementLog --
  // botMissedOpportunityLog nutzt push() (neueste am Ende) mit einem 8000er-
  // Kappungs-Deckel (shift() von vorne, siehe logMissedOpportunity()). Solange
  // der Deckel in diesem Saison-Fenster nicht greift (Normalfall), ist
  // slice(prevLen) exakt; greift er doch, liefert es eine leicht zu kleine
  // (nie zu grosse) Teilmenge -- akzeptables Restrisiko, klar besser als der
  // vorherige systematische Beinahe-Totalausfall durch season===curSeason.
  const missedThisSeasonAll = botMissedOpportunityLog.slice(Math.max(0, (prevMissedOppLogLen || 0)));
  const missedThisSeason = missedThisSeasonAll.filter((e) => bottom10Set.has(e.orgName));
  const missedByReason = {};
  missedThisSeason.forEach((e) => { missedByReason[e.reason] = (missedByReason[e.reason] || 0) + 1; });

  let top50Snapshot = null;
  let fullTitles = null;
  if ([0, 5, 10, 15, 20].indexOf(seasonNum) !== -1) {
    top50Snapshot = sortedByStrength.slice(0, 50).map((o) => o.name);
    fullTitles = allBotNamesForTitles.map((name) => {
      const stats = ensureCareerOrgStats(name);
      return { name, majorsWon: stats.majorsWon, worldsWon: stats.worldsWon, playoffAppearances: stats.playoffAppearances, rank: rankOf.get(name) || null };
    });
  }

  return {
    label: checkpointLabel, season: curSeason, date: careerDate,
    orgs, playerRows,
    transfersThisSeason: seasonTransfersAll, retirementsThisSeason: seasonRetirementsAll,
    transferLogLenAfter: transferLog.length, retirementLogLenAfter: qaRetirementLog.length, missedOppLogLenAfter: botMissedOpportunityLog.length, consentLogLenAfter: qaConsentChecks.length,
    consentSummary,
    economy: {
      n: bn, mean: Math.round(mean), min: budgets[0], max: budgets[bn - 1],
      p10: pct(0.10), p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p90: pct(0.90), p95: pct(0.95), p99: pct(0.99),
      gini: Math.round(gini * 1000) / 1000, totalMoneySupply, insolventCount,
    },
    staffMarket, talentConcentration,
    transferFairness: {
      sampleSize: fairnessRatios.length,
      medianRatio: fairnessRatios.length ? Math.round(fairnessRatios[Math.floor(fairnessRatios.length / 2)] * 100) / 100 : null,
    },
    missedOpportunitiesBottom10: { total: missedThisSeason.length, byReason: missedByReason },
    matchUpsetTallyCumulative: JSON.parse(JSON.stringify(botMatchUpsetTally)),
    top50Snapshot, fullTitles,
    telemetryTotals, telemetryDelta,
  };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'bottom10=', setup.bottom10.length, 'mid10=', setup.mid10.length, 'top10=', setup.top10.length);

  const cohortNames = [...setup.bottom10, ...setup.mid10, ...setup.top10];
  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, setup, seasonSnapshots: [], saveLoadChecks: [], errors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  let prevTelemetry = null, prevTransferLogLen = 0, prevRetirementLogLen = 0, prevMissedOppLogLen = 0, prevConsentLen = 0;
  const s0 = game.run(snapshotFn, cohortNames, 'S0', prevTelemetry, 0, setup.allBotNames, prevTransferLogLen, prevRetirementLogLen, prevMissedOppLogLen, prevConsentLen);
  out.seasonSnapshots.push(s0);
  prevTelemetry = s0.telemetryTotals;
  prevTransferLogLen = s0.transferLogLenAfter; prevRetirementLogLen = s0.retirementLogLenAfter; prevMissedOppLogLen = s0.missedOppLogLenAfter; prevConsentLen = s0.consentLogLenAfter;
  flush();

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const snap = game.run(snapshotFn, cohortNames, 'S' + season, prevTelemetry, season, setup.allBotNames, prevTransferLogLen, prevRetirementLogLen, prevMissedOppLogLen, prevConsentLen);
    out.seasonSnapshots.push(snap);
    prevTelemetry = snap.telemetryTotals;
    prevTransferLogLen = snap.transferLogLenAfter; prevRetirementLogLen = snap.retirementLogLenAfter; prevMissedOppLogLen = snap.missedOppLogLenAfter; prevConsentLen = snap.consentLogLenAfter;

    const ms = Date.now() - t0;
    console.log('[' + SEED + '] Season', season, 'done in', ms, 'ms. insolvent=', snap.economy.insolventCount, 'gini=', snap.economy.gini, 'players=', snap.playerRows.length, 'transfers=', snap.transfersThisSeason.length, 'retirements=', snap.retirementsThisSeason.length);
    flush();
  }

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V9 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V9 FAILED:', err); process.exit(1); });
