// V18 -- Teil AT: echter Neustart-Test. NICHT nur In-Memory (wie alle
// anderen Save/Load-Tests dieses Projekts, die denselben Node-Prozess
// wiederverwenden) -- hier speichert PROZESS 1 auf echte Festplatte und
// beendet sich VOLLSTAENDIG (process.exit), PROZESS 2 startet komplett neu
// (eigener Node-Aufruf) und laedt von derselben persistDir. Beweist, dass
// die Persistenz nicht zufaellig nur deshalb "funktioniert", weil derselbe
// In-Memory-Zustand nie wirklich verlassen wurde.
// Nutzung: node disk-restart-test-v18.js write <persistDir>  ODER
//          node disk-restart-test-v18.js read <persistDir>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2];
const PERSIST_DIR = process.argv[3];
const MARKER_BUDGET = 7654321;
const MARKER_ORG_NAME_SUFFIX = '__DISK_RESTART_MARKER__';

(async () => {
  if (MODE === 'write') {
    const game = await createHeadlessGame({ forwardConsole: false, seed: 'DISK-RESTART-V18', persistDir: PERSIST_DIR });
    game.initHeadlessCareer({ realOwnOrg: true });
    for (let s = 0; s < 2; s++) {
      game.run(() => {
        const startSeason = careerState.seasonNumber;
        let days = 0;
        while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
      });
    }
    game.run((budget, suffix) => {
      currentSlotId = 1;
      assignedOrg.budget = budget;
      assignedOrg.name = assignedOrg.name + suffix;
      postInbox.push({ id: 'disk-restart-marker', type: 'INFO', title: 'DISK RESTART MARKER', body: 'marker', date: careerDate, read: false });
    }, MARKER_BUDGET, MARKER_ORG_NAME_SUFFIX);
    await game.run(() => saveGameState());
    console.log('WRITE DONE. pageErrors=' + game.pageErrors.length);
    process.exit(0); // Prozess vollstaendig beenden -- kein Fortbestehen des In-Memory-State
  } else if (MODE === 'read') {
    // Frischer Prozess, frischer In-Memory-State -- kennt NICHTS vom
    // vorherigen Prozess ausser dem, was tatsaechlich auf Platte liegt.
    const game = await createHeadlessGame({ forwardConsole: false, seed: 'DISK-RESTART-V18-READER', persistDir: PERSIST_DIR });
    game.initHeadlessCareer({ realOwnOrg: true }); // legt zunaechst einen NEUEN, ANDEREN State an
    game.run(() => { currentSlotId = 1; });
    await game.run(() => loadGameState()); // muss den State von Prozess 1 von der Platte laden
    const result = game.run((suffix) => ({
      budget: assignedOrg.budget,
      orgNameHasMarker: assignedOrg.name.endsWith(suffix),
      hasMarkerPost: postInbox.some((m) => m.id === 'disk-restart-marker'),
    }), MARKER_ORG_NAME_SUFFIX);
    console.log('READ RESULT: ' + JSON.stringify(result));
    console.log('pageErrors=' + game.pageErrors.length);
    const pass = result.budget === MARKER_BUDGET && result.orgNameHasMarker && result.hasMarkerPost && game.pageErrors.length === 0;
    console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
    process.exit(pass ? 0 : 1);
  } else {
    console.error('Usage: node disk-restart-test-v18.js <write|read> <persistDir>');
    process.exit(1);
  }
})().catch((err) => { console.error('DISK RESTART TEST FAILED:', err); process.exit(1); });
