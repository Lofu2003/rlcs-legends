// Bot Ecosystem V13, Phase 43/44 -- Scrim-Volumen nach Tier (20 Saisons,
// Vergleich mit V12-Referenz Bottom~349.6/Mid~381.1/Top~347.3) und
// Match-Volumen-Luecke (offiziell allein vs. inkl. Scrims), auf dem
// POST-FIX+POST-OPTIMIZATION-Code (aktuelle data/org-rosters.js +
// renderer.js). matchHistory enthaelt AUSSCHLIESSLICH offizielle
// Turniermatches (recordMatchHistoryForEvent(), scrims laufen direkt ueber
// simulateMatch() ohne matchHistory-Eintrag) -- matchesForTeam(name).length
// ist damit exakt "offizielle Matches"; qaBotScrimLog liefert die Scrim-Seite.
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V13-VOLUME';
const SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = path.join(__dirname, '_v13_volume_' + SEED + '.json');

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  return { bottom10, mid10, top10 };
}

function finalMeasureFn(bottom10, mid10, top10) {
  const scrimCountByOrg = {};
  qaBotScrimLog.forEach((e) => {
    scrimCountByOrg[e.orgA] = (scrimCountByOrg[e.orgA] || 0) + 1;
    scrimCountByOrg[e.orgB] = (scrimCountByOrg[e.orgB] || 0) + 1;
  });
  function tierStats(names) {
    const official = names.map((n) => matchesForTeam(n).length);
    const scrims = names.map((n) => scrimCountByOrg[n] || 0);
    const combined = names.map((n, i) => official[i] + scrims[i]);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return { avgOfficial: avg(official), avgScrims: avg(scrims), avgCombined: avg(combined) };
  }
  return { bottom: tierStats(bottom10), mid: tierStats(mid10), top: tierStats(top10), totalScrimLogEntries: qaBotScrimLog.length };
}

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done.');

  for (let season = 1; season <= SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    console.log('[' + SEED + '] Season', season, 'done in', Date.now() - t0, 'ms.');
  }

  const measure = game.run(finalMeasureFn, setup.bottom10, setup.mid10, setup.top10);
  fs.writeFileSync(OUT_FILE, JSON.stringify(measure, null, 2));
  console.log('[' + SEED + '] RESULT:', JSON.stringify(measure));
  console.log('[' + SEED + '] Gap official-only (Top/Bottom):', (measure.top.avgOfficial / (measure.bottom.avgOfficial || 1)).toFixed(2) + 'x');
  console.log('[' + SEED + '] Gap incl. Scrims (Top/Bottom):', (measure.top.avgCombined / (measure.bottom.avgCombined || 1)).toFixed(2) + 'x');
  console.log('[' + SEED + '] DONE. pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] VOLUME TEST FAILED:', err); process.exit(1); });
