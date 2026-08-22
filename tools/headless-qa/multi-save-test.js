// Bot Ecosystem V12, Phase 58 -- Multi-Save-Test: 3 unabhaengige Save-Slots
// (A/B/C, ueber currentSlotId -- bereits vom bestehenden electronAPI-Stub
// unterstuetzt, siehe headless-runner.js), mindestens 20 Wechsel, 0
// Kontamination zwischen den Slots.
const { createHeadlessGame } = require('./headless-runner');

const SWITCHES = 21; // >= 20 laut Auftrag

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'MULTI-SAVE-TEST' });
  game.initHeadlessCareer({ realOwnOrg: true });

  // 3 unterscheidbare Zustaende erzeugen (unique Budget-Marker je Slot) und
  // in Slot 1/2/3 speichern.
  const markers = { 1: 111111, 2: 222222, 3: 333333 };
  for (const slot of [1, 2, 3]) {
    game.run((s, m) => {
      currentSlotId = s;
      assignedOrg.budget = m;
    }, slot, markers[slot]);
    await game.run(() => saveGameState());
  }

  const results = [];
  let contamination = false;
  for (let i = 0; i < SWITCHES; i++) {
    const slot = [1, 2, 3][i % 3];
    game.run((s) => { currentSlotId = s; }, slot);
    await game.run(() => loadGameState());
    const budget = game.run(() => assignedOrg.budget);
    const ok = budget === markers[slot];
    if (!ok) contamination = true;
    results.push({ iteration: i, slot, expected: markers[slot], actual: budget, ok });
  }

  console.log('=== MULTI SAVE TEST ===');
  console.log('Switches:', SWITCHES, 'Kontamination:', contamination);
  console.log('Fehlgeschlagene Faelle:', JSON.stringify(results.filter((r) => !r.ok)));
  console.log('pageErrors:', game.pageErrors.length);
  console.log('RESULT:', contamination || game.pageErrors.length > 0 ? 'FAIL' : 'PASS');
  process.exit(0);
})().catch((err) => { console.error('MULTI SAVE TEST FAILED:', err); process.exit(1); });
