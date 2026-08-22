// Bot Ecosystem V15, Phase 27 "RNG vs Management" -- erweitert
// identical-start-test-v14.js: CLONE_COUNT 12->20, plus Management-
// Decision-Tracking (decisionLog/retirementLog/transferLog GEFILTERT auf die
// Klon-Gruppe) im finalen Dump, um die Divergenz-URSACHEN grob zu
// dekomponieren (Match-Ergebnisse/Retirement-Timing/Markt-Zufall vs.
// tatsaechlich unterschiedliche Management-Entscheidungen -- letztere sind
// bei identischem Start nur durch AKTUELLEN Kaderzustand + RNG getrieben,
// siehe MQS-Vorbefund: die Entscheidungslogik selbst ist fuer alle Klone
// identisch).
// Nutzung: node identical-start-test-v15.js <seed> <seasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V15-IDENTICAL-A';
const SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_v15_identical_' + SEED + '.json');
const CLONE_COUNT = 20;
const CHECKPOINTS = [0, 5, 10, 15, 20].filter((s) => s <= SEASONS);

function setupFn(cloneCount) {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sortedByStrength = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const template = sortedByStrength[Math.floor(sortedByStrength.length / 2)];
  const sortedByName = [...bots].sort((a, b) => a.name.localeCompare(b.name));
  const group = sortedByName.slice(0, cloneCount);
  const templateClone = JSON.parse(JSON.stringify({
    roster: template.roster, budget: template.budget,
    equipmentLevel: template.equipmentLevel, basecampInvestLevel: template.basecampInvestLevel,
  }));
  group.forEach((org) => {
    const clone = JSON.parse(JSON.stringify(templateClone));
    org.roster = clone.roster;
    org.budget = clone.budget;
    org.equipmentLevel = clone.equipmentLevel;
    org.basecampInvestLevel = clone.basecampInvestLevel;
    org.strength = computeOrgStrengthFromRoster(org.roster);
  });
  return { groupNames: group.map((o) => o.name), templateName: template.name, templateStrength: template.strength, templateBudget: template.budget };
}

function snapshotFn(seasonNum, groupNames) {
  const rows = groupNames.map((name) => {
    const org = findOrgByName(name);
    return {
      name, rank: qaOrgRank(org), strength: org.strength || 0, budget: org.budget || 0,
      avgStarterOverall: (org.roster.starters || []).length ? org.roster.starters.reduce((s, p) => s + (p ? p.overall : 0), 0) / org.roster.starters.length : 0,
      wins: (careerWinLossTally[name] && careerWinLossTally[name].wins) || 0,
      losses: (careerWinLossTally[name] && careerWinLossTally[name].losses) || 0,
      coachOverall: (org.roster.coach && !org.roster.coach.vacant) ? org.roster.coach.overall : null,
    };
  });
  return { season: seasonNum, rows };
}

function finalDumpFn(groupNames) {
  const groupSet = groupNames;
  return {
    retirements: qaRetirementLog.filter((r) => groupSet.includes(r.orgName)),
    transfers: transferLog.filter((t) => groupSet.includes(t.to) || groupSet.includes(t.from)),
    decisions: (typeof qaBotDecisionLog !== 'undefined' ? qaBotDecisionLog : []).filter((d) => groupSet.includes(d.org)),
  };
}

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn, CLONE_COUNT);
  console.log('[' + SEED + '] setup done. group=', setup.groupNames.join(','));

  const out = { seed: SEED, seasons: SEASONS, setup, snapshots: [] };
  out.snapshots.push(game.run(snapshotFn, 0, setup.groupNames));
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));

  for (let season = 1; season <= SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    if (CHECKPOINTS.indexOf(season) !== -1) out.snapshots.push(game.run(snapshotFn, season, setup.groupNames));
    console.log('[' + SEED + '] Season', season, 'done in', Date.now() - t0, 'ms.');
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  }

  const dump = game.run(finalDumpFn, setup.groupNames);
  out.retirements = dump.retirements;
  out.transfers = dump.transfers;
  out.decisions = dump.decisions;
  out.pageErrors = game.pageErrors;
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  console.log('[' + SEED + '] IDENTICAL-START-TEST DONE. pageErrors:', game.pageErrors.length, 'retirements:', out.retirements.length, 'transfers:', out.transfers.length);
})().catch((err) => { console.error('[' + SEED + '] IDENTICAL-START-TEST FAILED:', err); process.exit(1); });
