// Bot Ecosystem V13, Phase 33-35 -- Profiling (NOCH KEINE Optimierung) des
// Bot-vs-Bot-Scrim-Systems. Nutzt die neu ergaenzten, telemetrie-gated
// Zaehler in renderer.js (qaScrimProfile: evalCalls, totalMs, wasted.*).
// Einzelprozess, kein Parallel-Lauf (Performance-Zahlen sollen sauber sein).
// Nutzung: node scrim-profile-v13.js <seed> <seasons>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V13-SCRIMPROFILE';
const SEASONS = parseInt(process.argv[3] || '10', 10);
const OUT_FILE = path.join(__dirname, '_v13_scrimprofile_' + SEED + '.json');

function setupFn() { botEconomyDebugTelemetryEnabled = true; return { orgCount: ORGANIZATIONS.length }; }
function profileSnapshotFn() {
  return {
    evalCalls: qaScrimProfile.evalCalls,
    totalMs: qaScrimProfile.totalMs,
    wasted: Object.assign({}, qaScrimProfile.wasted),
    botScrimsResolved: qaBotScrimLog.length,
  };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. orgCount=', setup.orgCount);

  const out = { seed: SEED, seasons: SEASONS, orgCount: setup.orgCount, perSeason: [] };

  for (let season = 1; season <= SEASONS; season++) {
    const tSeason0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const seasonMs = Date.now() - tSeason0;
    const prof = game.run(profileSnapshotFn);
    const pctOfSeason = seasonMs > 0 ? Math.round((prof.totalMs / seasonMs) * 1000) / 10 : 0;
    out.perSeason.push({ season, seasonMs, scrimTotalMs: prof.totalMs, pctOfSeason, evalCalls: prof.evalCalls, wasted: prof.wasted, botScrimsResolved: prof.botScrimsResolved });
    console.log('[' + SEED + '] Season', season, 'total=' + seasonMs + 'ms scrimSubsystem=' + prof.totalMs + 'ms (' + pctOfSeason + '%) evalCalls=' + prof.evalCalls, 'wasted=', JSON.stringify(prof.wasted), 'resolved=', prof.botScrimsResolved);
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  }

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors.length;
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log('[' + SEED + '] SCRIM PROFILE DONE in', out.durationMs, 'ms. pageErrors:', out.pageErrors);
})().catch((err) => { console.error('[' + SEED + '] SCRIM PROFILE FAILED:', err); process.exit(1); });
