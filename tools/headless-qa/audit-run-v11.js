// Bot Ecosystem V11 -- Generational Realism, Stat Inflation & Career
// Dynamics. Phase 1/2: reine Instrumentierung, KEINE Gameplay-Aenderung.
// V10-Code ist Baseline. Nutzt renderer.js' neue V11-QA-Hooks:
// qaTagGeneration()/qaGenerationLog (Erzeugungs-Herkunft jeder Person),
// qaScanAndUpdatePeaks() (Peak-Overall/Peak-Age, saisonweise), erweitertes
// qaRetirementLog (Karriere-Eckdaten), qaCaptureStaffSnapshot() (volle
// Personal-Verteilung je Rolle).
// Nutzung: node audit-run-v11.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V11-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '50', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv11_' + SEED + '.json');
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50].filter((s) => s <= TARGET_SEASONS);

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  const top50Names0 = [...sorted].reverse().slice(0, 50).map((o) => o.name);
  const allBotNames = bots.map((o) => o.name);
  // Phase 5: INITIAL-Taggung -- jede Person, die bereits beim Karrierestart
  // existiert (generateOrgRoster()), bekommt hier (statt im Kern-Rosterbau-
  // Code, um dessen Determinismus/Seeding nicht anzufassen) ihre QA-Tags.
  ORGANIZATIONS.filter((o) => o.roster).forEach((org) => {
    const roster = org.roster;
    [...(roster.starters || []), roster.sub].filter(Boolean).forEach((p) => qaTagGeneration(p, org.name, 'Starter', 'INITIAL'));
    if (roster.coach) qaTagGeneration(roster.coach, org.name, 'Coach', 'INITIAL');
    (roster.staff || []).filter((s) => s && !s.vacant).forEach((s) => qaTagGeneration(s, org.name, s.role, 'INITIAL'));
  });
  qaScanAndUpdatePeaks();
  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10, top50Names0, allBotNames,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    mid10InitialStrength: mid10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
  };
}

function powerSnapshotFn(seasonNum) {
  return { season: seasonNum, date: careerDate, rows: qaCapturePowerSnapshot() };
}
function staffSnapshotFn(seasonNum) {
  return { season: seasonNum, rows: qaCaptureStaffSnapshot() };
}
function distributionSnapshotFn(seasonNum) {
  return { season: seasonNum, players: qaCaptureFullPlayerOveralls() };
}
function finalDumpFn() {
  return { generationLog: qaGenerationLog, retirementLog: qaRetirementLog };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'checkpoints=', CHECKPOINTS.join(','));

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, setup, powerSnapshots: [], staffSnapshots: [], distributionSnapshots: [], generationLog: [], retirementLog: [], errors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const power0 = game.run(powerSnapshotFn, 0);
  out.powerSnapshots.push(power0);
  out.staffSnapshots.push(game.run(staffSnapshotFn, 0));
  out.distributionSnapshots.push(game.run(distributionSnapshotFn, 0));
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

    if (CHECKPOINTS.indexOf(season) !== -1) {
      out.powerSnapshots.push(game.run(powerSnapshotFn, season));
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

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V11 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length, 'generationLog:', out.generationLog.length, 'retirementLog:', out.retirementLog.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V11 FAILED:', err); process.exit(1); });
