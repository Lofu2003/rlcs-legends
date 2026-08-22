// Bot Ecosystem V12, Phase 44-48 -- Scrim-Volumen & Entwicklungs-Effekt nach
// Tier. Separater, leichterer 20-Saisons-Lauf (Auftragsabschnitt 44: "Nach 20
// Saisons") -- nutzt qaSeriesCountByOrg (offizielle Serien, V10) UND
// qaBotScrimLog (neue V12-Bot-Scrims), beide unter demselben Telemetrie-Flag.
// Nutzung: node audit-run-v12-scrims.js <seed> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V12-SCRIM-A';
const TARGET_SEASONS = 20;
const OUT_FILE = process.argv[3] || path.join(__dirname, '_auditv12scrim_' + SEED + '.json');

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  return { bottom10, mid10, top10 };
}
function powerAndOverallSnapshotFn() {
  return qaCapturePowerSnapshot();
}
function finalDumpFn(cohortNames) {
  const seriesByOrg = {};
  cohortNames.forEach((name) => { seriesByOrg[name] = qaSeriesCountByOrg[name] || 0; });
  const scrimCountByOrg = {};
  qaBotScrimLog.forEach((e) => {
    scrimCountByOrg[e.orgA] = (scrimCountByOrg[e.orgA] || 0) + 1;
    scrimCountByOrg[e.orgB] = (scrimCountByOrg[e.orgB] || 0) + 1;
  });
  const scrimForCohort = {};
  cohortNames.forEach((name) => { scrimForCohort[name] = scrimCountByOrg[name] || 0; });
  return { seriesByOrg, scrimForCohort, totalBotScrims: qaBotScrimLog.length };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  const cohortNames = [...setup.bottom10, ...setup.mid10, ...setup.top10];
  console.log('[' + SEED + '] setup done. cohorts=', cohortNames.length);

  const before = game.run(powerAndOverallSnapshotFn);

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    console.log('[' + SEED + '] Season', season, 'done in', Date.now() - t0, 'ms.');
  }

  const after = game.run(powerAndOverallSnapshotFn);
  const dump = game.run(finalDumpFn, cohortNames);

  const beforeMap = new Map(before.map((r) => [r.name, r]));
  const afterMap = new Map(after.map((r) => [r.name, r]));
  const devByTier = { bottom: [], mid: [], top: [] };
  ['bottom10', 'mid10', 'top10'].forEach((key) => {
    const tier = key.replace('10', '');
    setup[key].forEach((name) => {
      const b = beforeMap.get(name), a = afterMap.get(name);
      if (b && a) devByTier[tier].push(a.avgStarterOverall - b.avgStarterOverall);
    });
  });

  const out = {
    seed: SEED, targetSeasons: TARGET_SEASONS, setup,
    seriesByOrg: dump.seriesByOrg, scrimForCohort: dump.scrimForCohort, totalBotScrims: dump.totalBotScrims,
    devByTier, durationMs: Date.now() - t0all, pageErrors: game.pageErrors,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log('[' + SEED + '] SCRIM AUDIT DONE in', out.durationMs, 'ms. totalBotScrims:', dump.totalBotScrims, 'pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] SCRIM AUDIT FAILED:', err); process.exit(1); });
