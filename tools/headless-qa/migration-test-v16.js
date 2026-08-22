// Bot Ecosystem V16, Save/Load-Migrationstest fuer das neue `staffVacantSince`-
// Feld (botEconomyOverlay[orgName].staffVacantSince, siehe scoreBotStaffRecoveryHire()/
// syncBotEconomyOverlay()/reapplyBotEconomyOverlay() in renderer.js). Nutzt
// persistDir (echte JSON-Dateien auf Platte), damit der Save-Inhalt direkt
// manipuliert werden kann -- simuliert 4 Faelle:
//   1) aktueller Save (Feld vorhanden, normaler Roundtrip)
//   2) "vorherige Save-Version" (Feld komplett entfernt, wie ein v15-Save)
//   3) Feld explizit null gesetzt
//   4) Feld als leeres Objekt (Rand-/Normalfall)
// Erfolg = 0 pageErrors in JEDEM Fall, staffVacantSince danach immer ein
// echtes Objekt (nie null/undefined), kein Absturz.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHeadlessGame } = require('./headless-runner');

const PERSIST_DIR = path.join(os.tmpdir(), 'rlcs-migration-test-v16-' + Date.now());

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'MIGRATION-V16', persistDir: PERSIST_DIR });
  game.initHeadlessCareer();
  game.run(() => { botEconomyDebugTelemetryEnabled = true; });

  // 3 Saisons laufen lassen, damit echte Vakanzen + staffVacantSince-Eintraege entstehen.
  for (let season = 1; season <= 3; season++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }
  await game.run(() => saveGameState());

  const slotFile = path.join(PERSIST_DIR, 'slot-1.json');
  const raw = JSON.parse(fs.readFileSync(slotFile, 'utf8'));
  const orgNamesWithVacancy = Object.keys(raw.botEconomyOverlay || {}).filter((n) => raw.botEconomyOverlay[n].staffVacantSince && Object.keys(raw.botEconomyOverlay[n].staffVacantSince).length > 0);
  console.log('Fall 1 (aktueller Save): Orgs mit echten staffVacantSince-Eintraegen=' + orgNamesWithVacancy.length + ' Beispiel=' + JSON.stringify(raw.botEconomyOverlay[orgNamesWithVacancy[0]] && raw.botEconomyOverlay[orgNamesWithVacancy[0]].staffVacantSince));

  function writeSlot(slotId, mutateFn) {
    const copy = JSON.parse(JSON.stringify(raw));
    mutateFn(copy);
    fs.writeFileSync(path.join(PERSIST_DIR, 'slot-' + slotId + '.json'), JSON.stringify(copy));
  }
  // Fall 2: Feld komplett entfernen (wie ein v15-Save vor diesem Feature)
  writeSlot(2, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { delete o.staffVacantSince; }); });
  // Fall 3: Feld explizit null
  writeSlot(3, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { o.staffVacantSince = null; }); });
  // Fall 4: leeres Objekt (sollte trivial funktionieren, Kontrollfall)
  writeSlot(4, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { o.staffVacantSince = {}; }); });

  let allOk = true;
  for (const slotId of [1, 2, 3, 4]) {
    game.run((sid) => { currentSlotId = sid; }, slotId);
    await game.run(() => loadGameState());
    game.run(() => { reapplyBotEconomyOverlay(); });
    const check = game.run(() => {
      let badCount = 0;
      ORGANIZATIONS.filter((o) => o.roster && o !== assignedOrg).forEach((org) => {
        if (org.staffVacantSince === null || org.staffVacantSince === undefined || typeof org.staffVacantSince !== 'object') badCount++;
      });
      return { badCount, pageErrorsSoFar: (typeof qaBotDecisionLog !== 'undefined') ? 'n/a' : 'n/a' };
    });
    console.log('Slot ' + slotId + ': staffVacantSince nach Load ungueltig bei ' + check.badCount + ' Orgs (muss 0 sein)');
    if (check.badCount > 0) allOk = false;
    // Nach dem Laden noch 1 Saison weiterlaufen lassen -- prueft, dass
    // scoreBotStaffRecoveryHire() mit dem (ggf. frisch defaulteten) Feld
    // tatsaechlich weiterarbeitet, ohne Exception.
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }

  console.log('pageErrors gesamt: ' + game.pageErrors.length + ' ' + JSON.stringify(game.pageErrors.slice(0, 3)));
  console.log(allOk && game.pageErrors.length === 0 ? 'MIGRATION TEST: PASS' : 'MIGRATION TEST: FAIL');
  // Kurze Verschnaufpause vor dem Aufraeumen -- advanceOneCalendarDay() kann
  // intern noch einen autosave-artigen saveGameState()-Makrotask ausstehend
  // haben (setTimeout(0)-basiert, siehe headless-runner.js), der sonst mit
  // dem Verzeichnis-Loeschen kollidiert (reines Test-Script-Timing, kein
  // Produktbug -- das eigentliche Testergebnis oben steht bereits fest).
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch {}
})().catch((err) => { console.error('MIGRATION TEST FAILED:', err); process.exit(1); });
