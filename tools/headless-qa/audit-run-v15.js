// Bot Ecosystem V15 -- Autonomous Bot Management Intelligence, Phase 1/2.
// Baut 1:1 auf audit-run-v14.js auf (identische Setup-/Snapshot-Logik,
// identische Cohorts) -- einzige Ergaenzung: dumpt qaBotDecisionLog
// (renderer.js, neu diese Runde: hookt an runBotSeasonEconomyDecisions() +
// der monatlichen Krisen-Triage + Sponsor-Annahme) zusaetzlich zu den
// bereits bekannten V12-V14-Logs. V14-Retirement-Replacement-Fix bleibt
// unveraendert (Feature Freeze) -- dieser Lauf reproduziert V14-Post-Fix.
// Nutzung: node audit-run-v15.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V15-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '50', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv15_' + SEED + '.json');
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100].filter((s) => s <= TARGET_SEASONS);

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const names = (arr) => arr.map((o) => o.name);
  const cohorts = {
    top10: names(sorted.slice(0, 10)),
    r11_50: names(sorted.slice(10, 50)),
    r51_100: names(sorted.slice(50, 100)),
    r101_200: names(sorted.slice(100, 200)),
    r201_300: names(sorted.slice(200, 300)),
    r301_400: names(sorted.slice(300, 400)),
    bottomRest: names(sorted.slice(400)),
  };
  const bottom10 = names(sorted.slice(-10));
  const mid10 = names(sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5));
  const top10 = cohorts.top10;
  const allBotNames = names(bots);
  ORGANIZATIONS.filter((o) => o.roster).forEach((org) => {
    const roster = org.roster;
    [...(roster.starters || []), roster.sub].filter(Boolean).forEach((p) => qaTagGeneration(p, org.name, 'Starter', 'INITIAL'));
    if (roster.coach) qaTagGeneration(roster.coach, org.name, 'Coach', 'INITIAL');
    (roster.staff || []).filter((s) => s && !s.vacant).forEach((s) => qaTagGeneration(s, org.name, s.role, 'INITIAL'));
  });
  qaScanAndUpdatePeaks();
  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10, allBotNames, cohorts,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    mid10InitialStrength: mid10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
  };
}

function powerSnapshotFn(seasonNum) {
  return { season: seasonNum, date: careerDate, rows: qaCapturePowerSnapshot() };
}
// V15, Phase 5 Root-Cause-Vorabbefund: FREE_AGENT_PLAYERS ist ein FESTER
// Pool (180 Eintraege, siehe data/free-agents.js) OHNE Nachfuell-Mechanik
// (anders als FREE_AGENT_STAFF/FREE_AGENT_COACHES, die ensureStaffMarketPopulation()
// haben) -- signedFreeAgentPlayers waechst nur, wird nie geleert. Tracking
// hier billig (O(1), zwei Zahlen), da genau dieser Erschoepfungs-Verlauf
// Phase 5s zentrale Frage ("warum wird Geld nicht eingesetzt") beantworten
// koennte.
function marketPoolSnapshotFn(seasonNum) {
  // signedFreeAgentStaff ist rollenuebergreifend ('role::name'-Keys fuer
  // Coach+6 Rollen zusammen) -- fuer den Coach-Pool allein zaehlen wir hier
  // gezielt nur die 'Coach::'-Praefix-Eintraege, sonst waere die Zahl gegen
  // FREE_AGENT_COACHES.length nicht sinnvoll vergleichbar.
  let coachSigned = 0;
  signedFreeAgentStaff.forEach((k) => { if (k.indexOf('Coach::') === 0) coachSigned++; });
  return {
    season: seasonNum,
    playersRemaining: FREE_AGENT_PLAYERS.length - signedFreeAgentPlayers.size,
    playersTotal: FREE_AGENT_PLAYERS.length,
    coachesRemaining: FREE_AGENT_COACHES.length - coachSigned,
    coachesTotal: FREE_AGENT_COACHES.length,
  };
}
function staffSnapshotFn(seasonNum) {
  return { season: seasonNum, rows: qaCaptureStaffSnapshot() };
}
function distributionSnapshotFn(seasonNum) {
  return { season: seasonNum, players: qaCaptureFullPlayerOveralls() };
}
function finalDumpFn() {
  return {
    generationLog: qaGenerationLog, retirementLog: qaRetirementLog, rawPotentialLog: qaRawPotentialLog,
    selfHealLog: qaPotentialSelfHealLog, transferLog: transferLog, scrimLog: qaBotScrimLog,
    championLog: (typeof qaChampionLog !== 'undefined') ? qaChampionLog : [],
    decisionLog: (typeof qaBotDecisionLog !== 'undefined') ? qaBotDecisionLog : [],
    missedOpportunityLog: (typeof botMissedOpportunityLog !== 'undefined') ? botMissedOpportunityLog : [],
  };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'checkpoints=', CHECKPOINTS.join(','));

  const out = {
    seed: SEED, targetSeasons: TARGET_SEASONS, setup,
    powerSnapshots: [], staffSnapshots: [], distributionSnapshots: [], marketPoolSnapshots: [],
    generationLog: [], retirementLog: [], rawPotentialLog: [], selfHealLog: [], transferLog: [], scrimLog: [], championLog: [], decisionLog: [], missedOpportunityLog: [],
    errors: [],
  };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const power0 = game.run(powerSnapshotFn, 0);
  out.powerSnapshots.push(power0);
  out.staffSnapshots.push(game.run(staffSnapshotFn, 0));
  out.distributionSnapshots.push(game.run(distributionSnapshotFn, 0));
  out.marketPoolSnapshots.push(game.run(marketPoolSnapshotFn, 0));
  flush();
  console.log('[' + SEED + '] S0 captured. orgs in power snapshot:', power0.rows.length);

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    game.run(() => { qaScanAndUpdatePeaks(); });

    out.powerSnapshots.push(game.run(powerSnapshotFn, season));
    out.marketPoolSnapshots.push(game.run(marketPoolSnapshotFn, season));
    if (CHECKPOINTS.indexOf(season) !== -1) {
      out.staffSnapshots.push(game.run(staffSnapshotFn, season));
      out.distributionSnapshots.push(game.run(distributionSnapshotFn, season));
    }

    const ms = Date.now() - t0;
    console.log('[' + SEED + '] Season', season, 'done in', ms, 'ms.');
    flush();
  }

  const dump = game.run(finalDumpFn);
  out.generationLog = dump.generationLog;
  out.retirementLog = dump.retirementLog;
  out.rawPotentialLog = dump.rawPotentialLog;
  out.selfHealLog = dump.selfHealLog;
  out.transferLog = dump.transferLog;
  out.scrimLog = dump.scrimLog;
  out.championLog = dump.championLog;
  out.decisionLog = dump.decisionLog;
  out.missedOpportunityLog = dump.missedOpportunityLog;

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V15 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length,
    'decisionLog:', out.decisionLog.length, 'retirementLog:', out.retirementLog.length,
    'transferLog:', out.transferLog.length, 'powerSnapshots:', out.powerSnapshots.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V15 FAILED:', err); process.exit(1); });
