// Bot Ecosystem V9, Phase 41 -- "Long Run Save"-Regression, diesmal mit
// FIX fuer das V8-bekannte Harness-Artefakt: initHeadlessCareer({realOwnOrg:true})
// statt einer zweckentfremdeten Bot-Org als assignedOrg (siehe headless-
// runner.js-Kommentar). Bewusst NICHT in audit-run-v9.js integriert -- ein
// Save/Load-Reload mitten in einem Karriere-Telemetrie-Lauf wuerde die dort
// verwendeten, rein In-Memory gehaltenen QA-Player-IDs (person.__qaId)
// fragmentieren (loadGameState() baut Personen-Objekte aus den reinen
// Save-Daten neu auf, __qaId ist bewusst NICHT Teil des Save-Schemas). Save/
// Load-Regression und Karriere-Telemetrie sind deshalb zwei separate
// Laeufe, wie es Phase 40/41 ohnehin als eigene Pflicht-Regressionspunkte
// vorsieht.
// Nutzung: node longrun-save-test.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V9-LONGRUN-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_longrun_' + SEED + '.json');

function sampleFn() {
  const sample = ORGANIZATIONS.filter((o) => o.roster).slice(0, 30).map((o) => ({
    name: o.name, budget: Math.round(o.budget * 100) / 100, strength: o.strength,
    coachOverall: o.roster.coach ? o.roster.coach.overall : null,
    starterOveralls: o.roster.starters.map((p) => p.overall),
  }));
  // Eigene Org explizit mit aufnehmen (realOwnOrg:true -- das ist jetzt eine
  // ECHTE, vollstaendig initialisierte Org, kein Platzhalter mehr).
  sample.push({ name: assignedOrg.name, budget: Math.round(assignedOrg.budget * 100) / 100, strength: assignedOrg.strength, own: true });
  return sample;
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer({ realOwnOrg: true });

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, checks: [], pageErrors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });

    if (season % 4 === 0) {
      const before = game.run(sampleFn);
      await game.run(() => saveGameState());
      game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster); o.budget += 999999; });
      await game.run(() => loadGameState());
      const after = game.run(sampleFn);
      const identical = JSON.stringify(before) === JSON.stringify(after);
      out.checks.push({ season, identical, before: identical ? null : before, after: identical ? null : after });
      console.log('[' + SEED + '] Season', season, 'save/load check: identical=', identical);
      flush();
    }
  }

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  out.allIdentical = out.checks.every((c) => c.identical);
  flush();
  console.log('[' + SEED + '] LONGRUN SAVE TEST DONE in', out.durationMs, 'ms. allIdentical=', out.allIdentical, 'pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] LONGRUN SAVE TEST FAILED:', err); process.exit(1); });
