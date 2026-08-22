// V18 -- Release-Candidate Save/Load-Test: nutzt collectSaveState() DIREKT
// (die tatsaechliche, vollstaendige Persistenz-Nutzlast, siehe renderer.js)
// statt einer kuratierten Teilmenge -- deckt dadurch WIRKLICH alle in V18
// Teil AR geforderten Bereiche ab (Post, Training, Strategie, Shop,
// Basecamp, Scouting/Beziehungen/KI-Memory (npcRelations), Verhandlungen,
// Turniere, Stats, Krankheit (Teil von playerDevelopment/roster), Rente,
// Staff Vacancies (botEconomyOverlay.staffVacantSince)) in EINEM generischen
// Tiefen-Diff, statt Felder einzeln nachzubauen und dabei welche zu vergessen.
// Nutzung: node roundtrip-test-v18.js
const fs = require('fs');
const path = require('path');
const { createHeadlessGame } = require('./headless-runner');
const { compareGameStates } = require('./statediff');

function fullStateSnapshotFn() {
  const s = collectSaveState();
  return JSON.parse(JSON.stringify(s)); // tiefe Kopie, roundtrippt Sets/Arrays identisch zu save/load selbst
}

async function doRoundtripBatch(game, count, label, mutateFn) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const before = game.run(fullStateSnapshotFn);
    await game.run(() => saveGameState());
    game.run(mutateFn, i);
    await game.run(() => loadGameState());
    const after = game.run(fullStateSnapshotFn);
    const diffs = compareGameStates(before, after, []);
    results.push({ iteration: i, diffCount: diffs.length, diffs: diffs.slice(0, 20) });
    if (diffs.length > 0) console.log('  [' + label + '] iteration', i, 'DRIFT:', diffs.length, 'diffs. Sample:', JSON.stringify(diffs.slice(0, 5)));
  }
  return results;
}

// Mutiert zwischen Save und Load verschiedene, unabhaengige Teile des
// State (nicht nur Budget wie im V17-Test) -- rotierend je Iteration, damit
// ueber genug Iterationen JEDER grosse Teilbereich mindestens einmal
// "beweisen muss, dass load() ihn wirklich wiederherstellt" statt nur
// zufaellig unveraendert zu bleiben.
function mutateRotating(idx) {
  const mode = idx % 6;
  if (mode === 0) {
    const bots = ORGANIZATIONS.filter((o) => o.roster && o !== assignedOrg);
    bots[idx % bots.length].budget += 12345;
  } else if (mode === 1) {
    assignedOrg.budget += 9999;
  } else if (mode === 2) {
    postInbox.push({ id: 'qa-mutate-' + idx, type: 'INFO', title: 'QA Mutation Marker', body: 'test', date: careerDate, read: false });
  } else if (mode === 3) {
    basecampLevel = (basecampLevel || 0) + 1;
  } else if (mode === 4) {
    shopCart = ['qa-mutate-marker-' + idx];
  } else {
    seasonPoints[assignedOrg.name] = (seasonPoints[assignedOrg.name] || 0) + 1;
  }
}

(async () => {
  console.log('=== V18 FULL-STATE ROUNDTRIP TEST ===\n');
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'V18-ROUNDTRIP-SEED' });
  game.initHeadlessCareer({ realOwnOrg: true });

  console.log('Baue Mid-Career-Zustand auf (4 Saisons, damit Post/Verhandlungen/Scrims/Strategien/Shop echten Inhalt haben)...');
  for (let s = 0; s < 4; s++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }
  console.log('Mid-Career-Zustand bereit. pageErrors bisher:', game.pageErrors.length);

  const stateSizeInfo = game.run(() => {
    const s = collectSaveState();
    return { postInboxLen: (s.postInbox || []).length, npcRelationsKeys: Object.keys(s.npcRelations || {}).length, pendingNegotiationsLen: (s.pendingNegotiations || []).length, scrimHistoryLen: (s.scrimHistory || []).length };
  });
  console.log('State-Fuellstand vor Test:', JSON.stringify(stateSizeInfo));

  console.log('\n--- 20x Save/Load Roundtrip (voller State, rotierende Mutation) ---');
  const r20 = await doRoundtripBatch(game, 20, '20x', mutateRotating);
  const totalDrift20 = r20.reduce((s, r) => s + r.diffCount, 0);
  console.log('20x Ergebnis: total diffs =', totalDrift20, totalDrift20 === 0 ? 'PASS' : 'FAIL');

  console.log('\n--- 100x Save/Load Roundtrip (voller State, rotierende Mutation) ---');
  const t0 = Date.now();
  const r100 = await doRoundtripBatch(game, 100, '100x', mutateRotating);
  const totalDrift100 = r100.reduce((s, r) => s + r.diffCount, 0);
  console.log('100x Ergebnis: total diffs =', totalDrift100, totalDrift100 === 0 ? 'PASS' : 'FAIL', 'Dauer:', Date.now() - t0, 'ms');

  console.log('\npageErrors gesamt:', game.pageErrors.length, JSON.stringify(game.pageErrors.slice(0, 5)));

  const out = { totalDrift20, totalDrift100, r20DriftIterations: r20.filter((r) => r.diffCount > 0), r100DriftIterations: r100.filter((r) => r.diffCount > 0), pageErrors: game.pageErrors };
  fs.writeFileSync(path.join(__dirname, '_roundtrip_v18_result.json'), JSON.stringify(out, null, 2));
  console.log('\nErgebnis geschrieben nach _roundtrip_v18_result.json');
})().catch((err) => { console.error('V18 ROUNDTRIP TEST FAILED:', err); process.exit(1); });
