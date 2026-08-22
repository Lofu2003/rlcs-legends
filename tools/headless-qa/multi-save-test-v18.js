// V18 -- Release-Candidate Multi-Save-Test (Teil AS): 3 Slots A/B/C,
// mindestens 30 Wechsel, ABSICHTLICH aehnliche Org-/Personennamen ueber die
// Slots hinweg (staerkerer Stresstest als der reine Budget-Marker-Test aus
// V12/multi-save-test.js -- deckt auch namensbasierte statt referenzbasierte
// Lookup-Bugs auf, die ein reiner Zahlen-Marker nicht faende).
const { createHeadlessGame } = require('./headless-runner');

const SWITCHES = 33; // >= 30 laut V18-Auftrag

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'MULTI-SAVE-V18' });
  game.initHeadlessCareer({ realOwnOrg: true });

  // Absichtlich verwechslungsanfaellige, aber unterscheidbare Namen (Slot A/B/C).
  const slotData = {
    1: { budget: 111111, orgName: 'Team Vitality', playerMarker: 'QA Spieler A' },
    2: { budget: 222222, orgName: 'Team Vitalitiy', playerMarker: 'QA Spieler A ' }, // Tippfehler-Variante + Trailing Space
    3: { budget: 333333, orgName: 'Team VitalityX', playerMarker: 'QA  Spieler A' }, // doppeltes Leerzeichen
  };

  for (const slot of [1, 2, 3]) {
    const d = slotData[slot];
    game.run((s, budget, orgName, playerMarker) => {
      currentSlotId = s;
      assignedOrg.name = orgName;
      assignedOrg.budget = budget;
      if (assignedOrg.roster.starters[0]) assignedOrg.roster.starters[0].name = playerMarker;
    }, slot, d.budget, d.orgName, d.playerMarker);
    await game.run(() => saveGameState());
  }

  const results = [];
  let contamination = false;
  for (let i = 0; i < SWITCHES; i++) {
    const slot = [1, 2, 3][i % 3];
    game.run((s) => { currentSlotId = s; }, slot);
    await game.run(() => loadGameState());
    const state = game.run(() => ({ budget: assignedOrg.budget, orgName: assignedOrg.name, playerName: assignedOrg.roster.starters[0] ? assignedOrg.roster.starters[0].name : null }));
    const expected = slotData[slot];
    const ok = state.budget === expected.budget && state.orgName === expected.orgName && state.playerName === expected.playerMarker;
    if (!ok) contamination = true;
    results.push({ iteration: i, slot, expected, actual: state, ok });
  }

  console.log('=== V18 MULTI SAVE TEST (aehnliche Namen, ' + SWITCHES + ' Wechsel) ===');
  console.log('Kontamination:', contamination);
  console.log('Fehlgeschlagene Faelle:', JSON.stringify(results.filter((r) => !r.ok), null, 2));
  console.log('pageErrors:', game.pageErrors.length);
  console.log('RESULT:', contamination || game.pageErrors.length > 0 ? 'FAIL' : 'PASS');
  process.exit(0);
})().catch((err) => { console.error('V18 MULTI SAVE TEST FAILED:', err); process.exit(1); });
