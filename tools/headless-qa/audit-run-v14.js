// Bot Ecosystem V14 -- Competitive Realism/Dynasties/Org Identity, Phase 1/2.
// V13-Code bleibt unveraendert (Feature Freeze siehe Masterprompt) -- dieses
// Skript ist reine Instrumentierung, baut auf audit-run-v12.js (V12/V13-
// Baseline-Harness) auf. Neu ggue. V12: volle qaCapturePowerSnapshot()-Zeile
// (jetzt inkl. teamMorale/staffQuality/wins/losses, siehe renderer.js-
// Erweiterung) JEDE Saison statt nur an 14 Checkpoints -- noetig fuer Phase 26
// ("Dynasty Length", Auftrag verlangt explizit Jahres- statt Checkpoint-
// Granularitaet). staffSnapshots/distributionSnapshots bleiben bei den
// bisherigen Checkpoints (Personal-/Verteilungs-Detailauswertung braucht keine
// Jahresgranularitaet, volle Personal-Einzelzeilen jede Saison waere >4 Mio.
// Zeilen ueber 50 Saisons x 454 Orgs). finalDumpFn() ergaenzt transferLog
// (Phase 9-16 Transfer-/Personal-KI-Analyse) neben den bereits aus V12
// bekannten Logs.
// Cohorts (Masterprompt Phase 3): 453 tatsaechliche Bot-Orgs (454 Orgs total
// minus assignedOrg, siehe audit-run-v12.js setupFn()) -- Bottom-Cohort daher
// 53 statt 54 Orgs (10+40+50+100+100+100+53=453), ehrlich an die reale
// Org-Zahl angepasst statt eine 454. Org zu erfinden.
// Nutzung: node audit-run-v14.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V14-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '50', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv14_' + SEED + '.json');
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100].filter((s) => s <= TARGET_SEASONS);

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (b.strength || 0) - (a.strength || 0)); // DESC: index 0 = staerkste Org bei S0
  const names = (arr) => arr.map((o) => o.name);
  const cohorts = {
    top10: names(sorted.slice(0, 10)),
    r11_50: names(sorted.slice(10, 50)),
    r51_100: names(sorted.slice(50, 100)),
    r101_200: names(sorted.slice(100, 200)),
    r201_300: names(sorted.slice(200, 300)),
    r301_400: names(sorted.slice(300, 400)),
    bottomRest: names(sorted.slice(400)), // 53 Orgs, siehe Datei-Kommentar
  };
  // Rueckwaertskompatible Namen (wie V12/V13-Skripte sie erwarten):
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
    championLog: (typeof qaChampionLog !== 'undefined') ? qaChampionLog : [], // Phase 27, siehe renderer.js -- leer, falls der laufende Prozess vor der V14-Champion-Instrumentierung gestartet wurde
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
    powerSnapshots: [], staffSnapshots: [], distributionSnapshots: [],
    generationLog: [], retirementLog: [], rawPotentialLog: [], selfHealLog: [], transferLog: [], scrimLog: [], championLog: [],
    errors: [],
  };
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

    // JEDE Saison (Phase 26 "Dynasty Length" -- Jahresgranularitaet Pflicht):
    out.powerSnapshots.push(game.run(powerSnapshotFn, season));
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

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V14 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length,
    'generationLog:', out.generationLog.length, 'retirementLog:', out.retirementLog.length,
    'transferLog:', out.transferLog.length, 'scrimLog:', out.scrimLog.length, 'powerSnapshots:', out.powerSnapshots.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V14 FAILED:', err); process.exit(1); });
