// Bot Ecosystem V17, erweiterter Save/Load-Migrationstest fuer
// `staffVacantSince` (botEconomyOverlay[orgName].staffVacantSince). Baut auf
// migration-test-v16.js auf, ERGAENZT um Fall 5 (neu, V17-Auftrag):
// "teilweise beschaedigter Eintrag" -- ein Org bekommt eine Mischung aus
// gueltigem Wert, korrupten Nicht-Zahl-Werten und einem Geister-Rollen-
// Schluessel, der in der echten Rollenliste gar nicht existiert.
//   1) aktueller Save (Feld vorhanden, normaler Roundtrip)
//   2) "vorherige Save-Version" (Feld komplett entfernt, wie ein v15-Save)
//   3) Feld explizit null gesetzt
//   4) Feld als leeres Objekt (Rand-/Normalfall)
//   5) NEU: teilweise beschaedigter Eintrag (String statt Zahl, negative
//      Zahl, Geister-Rollen-Schluessel, gemischt mit einem echten gueltigen
//      Eintrag im selben Objekt)
// Erfolg = 0 pageErrors in JEDEM Fall, staffVacantSince danach immer ein
// echtes Objekt (nie null/undefined) mit ausschliesslich endlichen
// Zahlenwerten (kein NaN-Leck in die Score-Berechnung), kein Absturz.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHeadlessGame } = require('./headless-runner');

const PERSIST_DIR = path.join(os.tmpdir(), 'rlcs-migration-test-v17-' + Date.now());

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'MIGRATION-V17', persistDir: PERSIST_DIR });
  game.initHeadlessCareer();
  game.run(() => { botEconomyDebugTelemetryEnabled = true; });

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
  writeSlot(2, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { delete o.staffVacantSince; }); });
  writeSlot(3, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { o.staffVacantSince = null; }); });
  writeSlot(4, (copy) => { Object.values(copy.botEconomyOverlay || {}).forEach((o) => { o.staffVacantSince = {}; }); });
  // Fall 5 (NEU, V17): teilweise beschaedigter Eintrag -- betrifft NUR die
  // erste Org mit echten Eintraegen, alle anderen Orgs bleiben unveraendert
  // (Fall 5 testet gezielte Teilkorruption, nicht globale Zerstoerung).
  let corruptedOrgName = null;
  writeSlot(5, (copy) => {
    const names = Object.keys(copy.botEconomyOverlay || {}).filter((n) => copy.botEconomyOverlay[n].staffVacantSince && Object.keys(copy.botEconomyOverlay[n].staffVacantSince).length > 0);
    if (!names.length) return;
    corruptedOrgName = names[0];
    const entry = copy.botEconomyOverlay[corruptedOrgName].staffVacantSince;
    const realRoleKeys = Object.keys(entry);
    if (realRoleKeys.length > 0) entry[realRoleKeys[0]] = 'nicht-eine-zahl'; // String statt Zahl
    if (realRoleKeys.length > 1) entry[realRoleKeys[1]] = -9999; // implausibler, aber numerischer Wert
    entry['GeisterRolle_' + Math.random().toString(36).slice(2)] = 3; // Schluessel, der in ORG_ROSTER_STAFF_ROLES/Coach nicht existiert
    // realRoleKeys[2] (falls vorhanden) bleibt unveraendert gueltig -- Mischfall.
  });

  let allOk = true;
  for (const slotId of [1, 2, 3, 4, 5]) {
    game.run((sid) => { currentSlotId = sid; }, slotId);
    await game.run(() => loadGameState());
    game.run(() => { reapplyBotEconomyOverlay(); });
    const check = game.run(() => {
      let badCount = 0;
      let nonFiniteCount = 0;
      const badDetails = [];
      ORGANIZATIONS.filter((o) => o.roster && o !== assignedOrg).forEach((org) => {
        if (org.staffVacantSince === null || org.staffVacantSince === undefined || typeof org.staffVacantSince !== 'object') { badCount++; return; }
        Object.entries(org.staffVacantSince).forEach(([role, val]) => {
          if (typeof val !== 'number' || !Number.isFinite(val)) { nonFiniteCount++; badDetails.push(org.name + '.' + role + '=' + JSON.stringify(val)); }
        });
      });
      return { badCount, nonFiniteCount, badDetails: badDetails.slice(0, 5) };
    });
    console.log('Slot ' + slotId + ': staffVacantSince kein gueltiges Objekt bei ' + check.badCount + ' Orgs (muss 0 sein), nicht-endliche Werte direkt nach Load=' + check.nonFiniteCount + (check.badDetails.length ? ' Beispiele=' + JSON.stringify(check.badDetails) : ''));
    if (check.badCount > 0) allOk = false;
    // Direkt nach Load duerfen korrupte Werte noch drinstehen (Selbstheilung
    // passiert erst beim naechsten scoreBotStaffRecoveryHire()-Aufruf) --
    // die eigentliche Pruefung ist NACH einer weiteren Saison.
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const postSeasonCheck = game.run(() => {
      let nonFiniteCount = 0;
      const badDetails = [];
      ORGANIZATIONS.filter((o) => o.roster && o !== assignedOrg).forEach((org) => {
        if (!org.staffVacantSince || typeof org.staffVacantSince !== 'object') return;
        Object.entries(org.staffVacantSince).forEach(([role, val]) => {
          if (typeof val !== 'number' || !Number.isFinite(val)) { nonFiniteCount++; badDetails.push(org.name + '.' + role + '=' + JSON.stringify(val)); }
        });
      });
      return { nonFiniteCount, badDetails: badDetails.slice(0, 5) };
    });
    console.log('Slot ' + slotId + ': nicht-endliche Werte NACH 1 weiterer Saison (Selbstheilung erwartet)=' + postSeasonCheck.nonFiniteCount + (postSeasonCheck.badDetails.length ? ' Beispiele=' + JSON.stringify(postSeasonCheck.badDetails) : ''));
    if (postSeasonCheck.nonFiniteCount > 0) allOk = false;
  }

  console.log('Fall 5 betraf Org: ' + corruptedOrgName);
  console.log('pageErrors gesamt: ' + game.pageErrors.length + ' ' + JSON.stringify(game.pageErrors.slice(0, 3)));
  console.log(allOk && game.pageErrors.length === 0 ? 'MIGRATION TEST V17: PASS' : 'MIGRATION TEST V17: FAIL');
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch {}
})().catch((err) => { console.error('MIGRATION TEST V17 FAILED:', err); process.exit(1); });
