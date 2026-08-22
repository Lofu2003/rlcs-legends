// Bot Ecosystem V6 -- Phase 5-18 Langzeit-Audit, headless, deterministisch geseedet.
// Nutzung: node audit-run.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'AUDIT-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_audit_' + SEED + '.json');

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);

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

  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
    bottomTalents, midTalents, topTalents,
  };
}

function snapshotFn(cohortNames, talentNames, checkpointLabel, prevTelemetryTotals) {
  const STAFF_ROLES_ALL = ['Coach', 'Scout', 'Analyst', 'Finanzvorstand', 'PR-Manager', 'Psychologe', 'Physiotherapeut'];
  const allBots = ORGANIZATIONS.filter((o) => o.roster);
  const sortedByStrength = [...allBots].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const rankOf = new Map();
  sortedByStrength.forEach((o, i) => rankOf.set(o.name, i + 1));

  const orgs = {};
  cohortNames.forEach((name) => {
    const o = findOrgByName(name);
    if (!o) { orgs[name] = null; return; }
    orgs[name] = {
      strength: o.strength, rank: rankOf.get(name), budget: Math.round(o.budget),
      financeStatus: o.financeStatus, riskProfile: o.riskProfile, goal: (typeof ensureBotOrgGoal === 'function' ? ensureBotOrgGoal(o) : null),
      avgOverall: o.roster.starters.length ? Math.round(o.roster.starters.reduce((s, p) => s + p.overall, 0) / o.roster.starters.length) : 0,
      hasCoach: !!o.roster.coach, coachOverall: o.roster.coach ? o.roster.coach.overall : null,
      staffFilled: (o.roster.staff || []).filter((s) => s && !s.vacant).length,
      majorsWon: o.majorsWon || 0, worldsWon: o.worldsWon || 0, playoffAppearances: o.playoffAppearances || 0,
    };
  });

  // Economy-Vollbild ueber ALLE Bot-Orgs.
  const budgets = allBots.map((o) => o.budget).sort((a, b) => a - b);
  const n = budgets.length;
  const pct = (p) => budgets[Math.min(n - 1, Math.max(0, Math.floor(p * n)))];
  const mean = budgets.reduce((s, b) => s + b, 0) / n;
  const totalMoneySupply = budgets.reduce((s, b) => s + Math.max(0, b), 0);
  let giniSum = 0;
  for (let i = 0; i < n; i++) giniSum += (2 * (i + 1) - n - 1) * budgets[i];
  const gini = giniSum / (n * budgets.reduce((s, b) => s + Math.max(0, b), 0) || 1);
  const wealthTiers = { over25M: 0, over50M: 0, over100M: 0, over250M: 0, over500M: 0 };
  allBots.forEach((o) => {
    if (o.budget > 25000000) wealthTiers.over25M++;
    if (o.budget > 50000000) wealthTiers.over50M++;
    if (o.budget > 100000000) wealthTiers.over100M++;
    if (o.budget > 250000000) wealthTiers.over250M++;
    if (o.budget > 500000000) wealthTiers.over500M++;
  });
  const insolventCount = allBots.filter((o) => o.financeStatus === 'INSOLVENT').length;

  // Staff-Markt-Zensus fuer alle 7 Rollen.
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

  // Board-Compounding-Rohdaten: Roster-Wert vs Budget, fuer Korrelation ueber Saisons hinweg (Analyse-Skript berechnet die eigentliche Korrelation).
  const rosterValueVsBudgetSample = sortedByStrength.slice(0, 60).map((o) => ({
    name: o.name, rosterValue: (typeof orgRosterMarketValue === 'function' ? Math.round(orgRosterMarketValue(o.roster)) : null), budget: Math.round(o.budget),
  }));

  // Talent-Journeys.
  const talents = talentNames.map((name) => {
    let found = null;
    for (const o of allBots) {
      const p = [...(o.roster.starters || []), o.roster.sub].filter(Boolean).find((x) => x.name === name);
      if (p) { found = { org: o.name, overall: p.overall, potential: p.potential, age: p.age, isStarter: o.roster.starters.includes(p) }; break; }
    }
    return { name, ...(found || { retiredOrGone: true }) };
  });

  // Talent-Konzentration Top25/50/100 nach Potential UND Overall.
  const allPlayers = [];
  allBots.forEach((o) => [...(o.roster.starters || []), o.roster.sub].filter(Boolean).forEach((p) => allPlayers.push({ org: o.name, overall: p.overall, potential: p.potential || 0 })));
  function concentration(sortKey, count) {
    const top = [...allPlayers].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, count);
    return { uniqueOrgs: new Set(top.map((p) => p.org)).size, count: top.length };
  }
  const talentConcentration = {
    top25Potential: concentration('potential', 25), top50Potential: concentration('potential', 50), top100Potential: concentration('potential', 100),
    top25Overall: concentration('overall', 25), top50Overall: concentration('overall', 50), top100Overall: concentration('overall', 100),
  };

  // Transfer-Markt (aktuelle Saison).
  const curSeason = careerState.seasonNumber;
  const seasonTransfers = transferLog.filter((t) => t.season === curSeason);
  const botToBot = seasonTransfers.filter((t) => t.from !== 'Free Agent' && t.to !== 'Free Agent');
  const freeAgentSignings = seasonTransfers.filter((t) => t.from === 'Free Agent');
  const fees = seasonTransfers.map((t) => t.price).filter((p) => typeof p === 'number' && p > 0).sort((a, b) => a - b);

  const telemetryTotals = { ...botEconomyTelemetryTotals };
  const telemetryDelta = {};
  Object.keys(telemetryTotals).forEach((k) => { telemetryDelta[k] = telemetryTotals[k] - ((prevTelemetryTotals && prevTelemetryTotals[k]) || 0); });

  return {
    label: checkpointLabel, season: curSeason, date: careerDate,
    orgs, economy: {
      n, mean: Math.round(mean), min: budgets[0], max: budgets[n - 1],
      p10: pct(0.10), p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p90: pct(0.90), p95: pct(0.95), p99: pct(0.99),
      gini: Math.round(gini * 1000) / 1000, totalMoneySupply, insolventCount, wealthTiers,
    },
    staffMarket, rosterValueVsBudgetSample, talents, talentConcentration,
    transferMarket: {
      totalTransfers: seasonTransfers.length, botToBotCount: botToBot.length, freeAgentSigningsCount: freeAgentSignings.length,
      medianFee: fees.length ? fees[Math.floor(fees.length / 2)] : 0, topFee: fees.length ? fees[fees.length - 1] : 0,
    },
    telemetryTotals, telemetryDelta,
  };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'bottomTalents=', setup.bottomTalents.length, 'midTalents=', setup.midTalents.length, 'topTalents=', setup.topTalents.length);

  const cohortNames = [...setup.bottom10, ...setup.mid10, ...setup.top10];
  const talentNames = [...setup.bottomTalents, ...setup.midTalents, ...setup.topTalents].map((t) => t.name);

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, setup, seasonSnapshots: [], saveLoadChecks: [], antiExploitCohort: [], errors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  // Season-0-Baseline.
  let prevTelemetry = null;
  const s0 = game.run(snapshotFn, cohortNames, talentNames, 'S0', prevTelemetry);
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
    const snap = game.run(snapshotFn, cohortNames, talentNames, 'S' + season, prevTelemetry);
    out.seasonSnapshots.push(snap);
    prevTelemetry = snap.telemetryTotals;

    // Save/Load-Check alle 4 Saisons: echte Produktions-Serialisierung (collectSaveState()/loadGameState()).
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
        // State absichtlich veraendern, um sicherzustellen, dass der Vergleich nicht zufaellig "gleich" waere.
        game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster && x !== assignedOrg); o.budget += 999999; });
        const overlayDiag = game.run(() => {
          const bad = [];
          ORGANIZATIONS.forEach((o) => {
            if (!o.roster || o === assignedOrg) return;
            const saved = botEconomyOverlay[o.name];
            if (!saved || !Number.isFinite(saved.budget)) bad.push({ name: o.name, hasSaved: !!saved, budget: saved && saved.budget, hasCoach: !!o.roster.coach, hasSub: !!o.roster.sub });
          });
          return bad;
        });
        if (overlayDiag.length) console.log('[' + SEED + '] OVERLAY DIAG (non-finite/missing before load):', JSON.stringify(overlayDiag));
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
  console.log('[' + SEED + '] AUDIT DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT FAILED:', err); process.exit(1); });
