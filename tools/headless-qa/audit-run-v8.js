// Bot Ecosystem V8 -- Market Value + Generational Mobility + Board Feedback Audit.
// Baut auf audit-run-v7.js auf (identische Kohorten-/Save-Load-Mechanik),
// erweitert um: volle 454-Org-Titelverfolgung an den 5 Checkpoints, einen
// GLOBALEN (nicht nur Kohorten-) Talent-Pool von bis zu 100 jungen
// Hochpotential-Spielern, und eine Transferwert-Fairness-Stichprobe je Saison.
// Nutzung: node audit-run-v8.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V8-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv8_' + SEED + '.json');

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  botMatchUpsetTally = { '0-5': { strongerWins: 0, upsets: 0 }, '6-10': { strongerWins: 0, upsets: 0 }, '11-20': { strongerWins: 0, upsets: 0 }, '21-30': { strongerWins: 0, upsets: 0 }, '30+': { strongerWins: 0, upsets: 0 } };
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  const top50Names0 = [...sorted].reverse().slice(0, 50).map((o) => o.name);

  function pickTalents(orgNames, count) {
    const candidates = [];
    orgNames.forEach((name) => {
      const org = findOrgByName(name);
      if (!org || !org.roster) return;
      [...(org.roster.starters || []), org.roster.sub].filter(Boolean).forEach((p) => {
        ensurePersonHasPotential(p);
        const gap = (p.potential || 0) - (p.overall || 0);
        if (gap >= 8) candidates.push({ name: p.name, org: org.name, overall: p.overall, potential: p.potential, age: p.age, gap });
      });
    });
    candidates.sort((a, b) => b.gap - a.gap);
    return candidates.slice(0, count);
  }
  const bottomTalents = pickTalents(bottom10, 10);
  const midTalents = pickTalents(mid10, 10);
  const topTalents = pickTalents(top10, 10);

  // V8 NEU (Auftrags-Talentwirtschaft, Phase 16): 100 junge Hochpotential-
  // Spieler aus ALLEN 454 Orgs (nicht nur den 30-Org-Kohorten) -- misst, ob
  // der Zugang zu Top-Talent nach dem Root-Cause-#3-Fix wirklich Org-
  // unabhaengig verteilt ist, statt nur "Bottom/Mid/Top bekommen je 10".
  const allBotNames = bots.map((o) => o.name);
  const globalCandidates = [];
  allBotNames.forEach((name) => {
    const org = findOrgByName(name);
    if (!org || !org.roster) return;
    [...(org.roster.starters || []), org.roster.sub].filter(Boolean).forEach((p) => {
      ensurePersonHasPotential(p);
      const gap = (p.potential || 0) - (p.overall || 0);
      if (gap >= 8 && (p.age || 99) <= 21) globalCandidates.push({ name: p.name, org: org.name, overall: p.overall, potential: p.potential, age: p.age, gap });
    });
  });
  globalCandidates.sort((a, b) => b.gap - a.gap);
  const globalYoungTalents = globalCandidates.slice(0, 100);

  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10, top50Names0,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    mid10InitialStrength: mid10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
    bottomTalents, midTalents, topTalents, globalYoungTalents,
    allBotNames,
  };
}

function snapshotFn(cohortNames, talentNames, checkpointLabel, prevTelemetryTotals, seasonNum, allBotNamesForTitles) {
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
  const STAFF_ROLES_ALL = ['Coach', 'Scout', 'Analyst', 'Finanzvorstand', 'PR-Manager', 'Psychologe', 'Physiotherapeut'];
  const allBots = ORGANIZATIONS.filter((o) => o.roster);
  const sortedByStrength = [...allBots].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const rankOf = new Map();
  sortedByStrength.forEach((o, i) => rankOf.set(o.name, i + 1));

  const n = allBots.length;
  const tercileStrengths = [...sortedByStrength].map((o) => o.strength || 0).reverse();
  const worldMedianStrength = tercileStrengths[Math.floor(n / 2)];
  const bottomTercile = tercileStrengths.slice(0, Math.floor(n / 3));
  const midTercile = tercileStrengths.slice(Math.floor(n / 3), Math.floor(2 * n / 3));
  const topTercile = tercileStrengths.slice(Math.floor(2 * n / 3));
  const median = (arr) => arr.length ? arr[Math.floor(arr.length / 2)] : 0;

  const orgs = {};
  cohortNames.forEach((name) => {
    const o = findOrgByName(name);
    if (!o) { orgs[name] = null; return; }
    const potStats = orgPotentialStats(o);
    const stats = ensureCareerOrgStats(name);
    const curSeason = careerState.seasonNumber;
    const seasonTransfers = transferLog.filter((t) => t.season === curSeason);
    const transfersIn = seasonTransfers.filter((t) => t.to === name);
    const transfersOut = seasonTransfers.filter((t) => t.from === name);
    orgs[name] = {
      strength: o.strength, rank: rankOf.get(name), budget: Math.round(o.budget),
      rosterValue: typeof orgRosterMarketValue === 'function' ? Math.round(orgRosterMarketValue(o.roster)) : null,
      boardSupport: typeof calculateBoardSupport === 'function' ? Math.round(calculateBoardSupport(o)) : null,
      financeStatus: o.financeStatus, riskProfile: o.riskProfile, goal: (typeof ensureBotOrgGoal === 'function' ? ensureBotOrgGoal(o) : null),
      avgOverall: potStats.avgOverall, avgPotential: potStats.avgPotential, avgPotentialGap: Math.round((potStats.avgPotential - potStats.avgOverall) * 10) / 10, avgAge: potStats.avgAge,
      minPotential: potStats.minPotential, maxPotential: potStats.maxPotential,
      hasCoach: !!o.roster.coach, coachOverall: o.roster.coach ? o.roster.coach.overall : null,
      staffFilled: (o.roster.staff || []).filter((s) => s && !s.vacant).length,
      majorsWon: stats.majorsWon, worldsWon: stats.worldsWon, playoffAppearances: stats.playoffAppearances,
      transfersInCount: transfersIn.length, transfersOutCount: transfersOut.length,
      transferSpend: transfersIn.reduce((s, t) => s + (t.price || 0), 0), transferIncome: transfersOut.reduce((s, t) => s + (t.price || 0), 0),
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

  function orgsList() { return cohortNames.slice(0, 10).map((n2) => findOrgByName(n2)).filter(Boolean); }
  const bottomBudgets = orgsList().map((o) => o.budget).sort((a, b) => a - b);
  const bottomMedianBudget = bottomBudgets.length ? bottomBudgets[Math.floor(bottomBudgets.length / 2)] : 0;

  const elitePrice = calculatePrice(90);
  const midPrice = calculatePrice(75);
  const typicalSalary = playerMonthlySalary({ overall: 75 });
  // V8 NEU: dieselbe Kaufkraft-Messung zusaetzlich gegen den neuen, potential-
  // bewussten Transferwert eines realistischen jungen Talents (75 Overall,
  // 90 Potential, 19 Jahre) statt nur gegen den alten, potential-blinden Wert.
  const youngTalentTransferValue = typeof calculatePlayerTransferValue === 'function' ? calculatePlayerTransferValue({ overall: 75, potential: 90, age: 19 }) : null;
  const purchasingPower = {
    medianBudgetOverElitePrice: elitePrice ? Math.round(pct(0.50) / elitePrice * 100) / 100 : null,
    medianBudgetOverMidPrice: midPrice ? Math.round(pct(0.50) / midPrice * 100) / 100 : null,
    medianBudgetOverSalary: typicalSalary ? Math.round(pct(0.50) / typicalSalary) : null,
    medianBudgetOverYoungTalentValue: youngTalentTransferValue ? Math.round(pct(0.50) / youngTalentTransferValue * 100) / 100 : null,
    bottomMedianBudgetOverElitePrice: elitePrice ? Math.round(bottomMedianBudget / elitePrice * 100) / 100 : null,
    bottomMedianBudgetOverMidPrice: midPrice ? Math.round(bottomMedianBudget / midPrice * 100) / 100 : null,
  };

  const staffMarket = {};
  STAFF_ROLES_ALL.forEach((role) => {
    const isCoach = role === 'Coach';
    const employed = allBots.filter((o) => (isCoach ? !!o.roster.coach : (o.roster.staff || []).some((s) => s && !s.vacant && s.role === role))).length;
    const overalls = [];
    allBots.forEach((o) => {
      if (isCoach) { if (o.roster.coach) overalls.push(o.roster.coach.overall); }
      else { (o.roster.staff || []).forEach((s) => { if (s && !s.vacant && s.role === role) overalls.push(s.overall); }); }
    });
    const signedNames = new Set([...signedFreeAgentStaff].filter((k) => k.startsWith(role + '::')).map((k) => k.slice((role + '::').length)));
    const pool = isCoach ? FREE_AGENT_COACHES : (FREE_AGENT_STAFF[role] || []);
    const available = pool.filter((p) => !signedNames.has(p.name)).length;
    staffMarket[role] = {
      employed, totalOrgs: allBots.length, avgOverall: overalls.length ? Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length * 10) / 10 : 0,
      availableFreeAgents: available, poolSize: pool.length,
    };
  });

  const curSeason = careerState.seasonNumber;
  const seasonTransfersAll = transferLog.filter((t) => t.season === curSeason);
  const talents = talentNames.map((name) => {
    let found = null;
    for (const o of allBots) {
      const p = [...(o.roster.starters || []), o.roster.sub].filter(Boolean).find((x) => x.name === name);
      if (p) { found = { org: o.name, overall: p.overall, potential: p.potential, age: p.age, isStarter: o.roster.starters.includes(p) }; break; }
    }
    const soldThisSeason = seasonTransfersAll.find((t) => t.player === name);
    return { name, ...(found || { retiredOrGone: true }), soldThisSeason: soldThisSeason ? { from: soldThisSeason.from, to: soldThisSeason.to, price: soldThisSeason.price } : null };
  });

  const allPlayers = [];
  allBots.forEach((o) => [...(o.roster.starters || []), o.roster.sub].filter(Boolean).forEach((p) => allPlayers.push({ org: o.name, overall: p.overall, potential: p.potential || 0 })));
  function concentration(sortKey, count) {
    const top = [...allPlayers].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, count);
    return { uniqueOrgs: new Set(top.map((p) => p.org)).size, count: top.length, inBottom10: top.filter((p) => cohortNames.slice(0, 10).includes(p.org)).length, inTop10: top.filter((p) => cohortNames.slice(20, 30).includes(p.org)).length };
  }
  const talentConcentration = {
    top25Potential: concentration('potential', 25), top50Potential: concentration('potential', 50), top100Potential: concentration('potential', 100),
    top25Overall: concentration('overall', 25), top50Overall: concentration('overall', 50), top100Overall: concentration('overall', 100),
  };

  const botToBot = seasonTransfersAll.filter((t) => t.from !== 'Free Agent' && t.to !== 'Free Agent');
  const freeAgentSignings = seasonTransfersAll.filter((t) => t.from === 'Free Agent');
  const fees = seasonTransfersAll.map((t) => t.price).filter((p) => typeof p === 'number' && p > 0).sort((a, b) => a - b);

  // V8 NEU (Phase "Value Fairness"): fuer jeden Transfer DIESER Saison mit
  // noch auffindbarem Spieler (aktueller Overall/Potential als Naeherung fuer
  // den Kenntnisstand zum Verkaufszeitpunkt -- echte Zeitreihen-Kenntnis gibt
  // es nicht, daher explizit als Naeherung dokumentiert) das Verhaeltnis
  // gezahlter Preis / calculatePlayerTransferValue(aktuell) bilden. Median
  // nahe 1.0 = Transfermarkt bepreist im Schnitt fair nach der neuen Formel.
  const fairnessRatios = [];
  if (typeof calculatePlayerTransferValue === 'function') {
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
  }
  fairnessRatios.sort((a, b) => a - b);
  const transferFairness = {
    sampleSize: fairnessRatios.length,
    medianRatio: fairnessRatios.length ? Math.round(fairnessRatios[Math.floor(fairnessRatios.length / 2)] * 100) / 100 : null,
    p10Ratio: fairnessRatios.length ? Math.round(fairnessRatios[Math.floor(fairnessRatios.length * 0.1)] * 100) / 100 : null,
    p90Ratio: fairnessRatios.length ? Math.round(fairnessRatios[Math.floor(fairnessRatios.length * 0.9)] * 100) / 100 : null,
  };

  const telemetryTotals = { ...botEconomyTelemetryTotals };
  const telemetryDelta = {};
  Object.keys(telemetryTotals).forEach((k) => { telemetryDelta[k] = telemetryTotals[k] - ((prevTelemetryTotals && prevTelemetryTotals[k]) || 0); });

  const bottom10Set = new Set(cohortNames.slice(0, 10));
  const missedThisSeason = botMissedOpportunityLog.filter((e) => e.season === curSeason && bottom10Set.has(e.orgName));
  const missedByReason = {};
  missedThisSeason.forEach((e) => { missedByReason[e.reason] = (missedByReason[e.reason] || 0) + 1; });

  let top50Snapshot = null;
  let fullTitles = null;
  if ([0, 5, 10, 15, 20].indexOf(seasonNum) !== -1) {
    top50Snapshot = sortedByStrength.slice(0, 50).map((o) => o.name);
    // V8 NEU (Phase 13, "volle 454-Org-Titelverfolgung"): careerOrgStats ist
    // die einzige echte Quelle fuer Titel (siehe recordCareerOrgStats()) --
    // hier fuer ALLE Bot-Orgs gelesen, nicht nur die 30-Org-Kohorte.
    fullTitles = allBotNamesForTitles.map((name) => {
      const stats = ensureCareerOrgStats(name);
      return { name, majorsWon: stats.majorsWon, worldsWon: stats.worldsWon, playoffAppearances: stats.playoffAppearances, rank: rankOf.get(name) || null };
    });
  }

  return {
    label: checkpointLabel, season: curSeason, date: careerDate,
    orgs, worldStrength: { median: worldMedianStrength, bottomTercileMedian: median(bottomTercile), midTercileMedian: median(midTercile), topTercileMedian: median(topTercile) },
    economy: {
      n: bn, mean: Math.round(mean), min: budgets[0], max: budgets[bn - 1],
      p10: pct(0.10), p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p90: pct(0.90), p95: pct(0.95), p99: pct(0.99),
      gini: Math.round(gini * 1000) / 1000, totalMoneySupply, insolventCount,
    },
    purchasingPower, staffMarket, talents, talentConcentration, transferFairness,
    transferMarket: {
      totalTransfers: seasonTransfersAll.length, botToBotCount: botToBot.length, freeAgentSigningsCount: freeAgentSignings.length,
      medianFee: fees.length ? fees[Math.floor(fees.length / 2)] : 0, topFee: fees.length ? fees[fees.length - 1] : 0,
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
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'bottomTalents=', setup.bottomTalents.length, 'midTalents=', setup.midTalents.length, 'topTalents=', setup.topTalents.length, 'globalYoungTalents=', setup.globalYoungTalents.length);

  const cohortNames = [...setup.bottom10, ...setup.mid10, ...setup.top10];
  const talentNames = [...setup.bottomTalents, ...setup.midTalents, ...setup.topTalents, ...setup.globalYoungTalents].map((t) => t.name);
  // Duplikate moeglich (Kohorten-Talente koennen auch im globalen Pool
  // auftauchen) -- fuer die Talent-Journey-Tabelle irrelevant (nur einmal
  // je Name aufgeloest), daher unverändert gelassen statt dedupliziert.

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, setup, seasonSnapshots: [], saveLoadChecks: [], errors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  let prevTelemetry = null;
  const s0 = game.run(snapshotFn, cohortNames, talentNames, 'S0', prevTelemetry, 0, setup.allBotNames);
  out.seasonSnapshots.push(s0);
  prevTelemetry = s0.telemetryTotals;
  flush();

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const snap = game.run(snapshotFn, cohortNames, talentNames, 'S' + season, prevTelemetry, season, setup.allBotNames);
    out.seasonSnapshots.push(snap);
    prevTelemetry = snap.telemetryTotals;

    if (season % 4 === 0) {
      const check = await (async () => {
        const before = game.run(() => {
          const sample = ORGANIZATIONS.filter((o) => o.roster).slice(0, 30).map((o) => ({
            name: o.name, budget: Math.round(o.budget * 100) / 100, strength: o.strength,
            coachOverall: o.roster.coach ? o.roster.coach.overall : null,
            starterOveralls: o.roster.starters.map((p) => p.overall),
          }));
          return sample;
        });
        await game.run(() => saveGameState());
        game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster && x !== assignedOrg); o.budget += 999999; });
        await game.run(() => loadGameState());
        const after = game.run(() => {
          const sample = ORGANIZATIONS.filter((o) => o.roster).slice(0, 30).map((o) => ({
            name: o.name, budget: Math.round(o.budget * 100) / 100, strength: o.strength,
            coachOverall: o.roster.coach ? o.roster.coach.overall : null,
            starterOveralls: o.roster.starters.map((p) => p.overall),
          }));
          return sample;
        });
        const identical = JSON.stringify(before) === JSON.stringify(after);
        return { season, identical, before: identical ? null : before, after: identical ? null : after };
      })();
      out.saveLoadChecks.push(check);
    }

    const ms = Date.now() - t0;
    console.log('[' + SEED + '] Season', season, 'done in', ms, 'ms. insolvent=', snap.economy.insolventCount, 'gini=', snap.economy.gini, 'coaches=', snap.staffMarket.Coach.employed + '/' + snap.staffMarket.Coach.totalOrgs);
    flush();
  }

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V8 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V8 FAILED:', err); process.exit(1); });
