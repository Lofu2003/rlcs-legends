// Bot Ecosystem V12, Phase 61 -- Scrim Save Test: speichert/laedt mitten in
// pending invite / ready-to-play (angenommen) Zustand, prueft dass der
// Zustand exakt erhalten bleibt. Baut die scrimInvites-Eintraege DIREKT
// (nicht ueber sendScrimInvite()/respondToIncomingScrim(), die zusaetzlich
// pushPostMessage()/UI-Renders ausloesen) -- reiner Save/Load-State-Test.
const { createHeadlessGame } = require('./headless-runner');

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'SCRIM-SAVE-TEST' });
  game.initHeadlessCareer({ realOwnOrg: true });
  const results = [];

  // --- Fall 1: PENDING ---
  const before1 = game.run(() => {
    const opp = ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster);
    scrimInvites.push({ id: 'save_test_pending', direction: 'outgoing', opponentOrgName: opp.name, sentDate: careerDate, respondDate: addDaysToDateStr(careerDate, 1), status: 'pending' });
    return JSON.parse(JSON.stringify(scrimInvites));
  });
  await game.run(() => saveGameState());
  game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster); o.budget += 1; });
  await game.run(() => loadGameState());
  const after1 = game.run(() => JSON.parse(JSON.stringify(scrimInvites)));
  results.push({ case: 'pending', identical: JSON.stringify(before1) === JSON.stringify(after1), before: before1, after: after1 });

  // --- Fall 2: READY (angenommen, wartet auf "Match spielen") ---
  const before2 = game.run(() => {
    const opp = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster)[3];
    scrimInvites.push({ id: 'save_test_ready', direction: 'outgoing', opponentOrgName: opp.name, sentDate: careerDate, respondDate: careerDate, status: 'ready', readyDate: careerDate, expiresDate: addDaysToDateStr(careerDate, 3), postMessageId: null });
    return JSON.parse(JSON.stringify(scrimInvites));
  });
  await game.run(() => saveGameState());
  game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster); o.budget += 1; });
  await game.run(() => loadGameState());
  const after2 = game.run(() => JSON.parse(JSON.stringify(scrimInvites)));
  results.push({ case: 'ready', identical: JSON.stringify(before2) === JSON.stringify(after2), before: before2, after: after2 });

  // --- Fall 3: nach dem Reload kann das ready-Scrim noch korrekt via
  // playScrim() gespielt werden (State nicht durch Save/Load beschaedigt).
  const playResult = game.run(() => {
    const inv = scrimInvites.find((i) => i.id === 'save_test_ready');
    if (!inv) return { error: 'invite missing after reload' };
    const beforeOveralls = assignedOrg.roster.starters.map((p) => p.overall);
    playScrim(inv.opponentOrgName);
    const afterOveralls = assignedOrg.roster.starters.map((p) => p.overall);
    return { found: true, beforeOveralls, afterOveralls, lastScrimDate: assignedOrg.lastScrimDate, careerDate };
  });
  results.push({ case: 'play_after_reload', playResult, pass: playResult.found && playResult.lastScrimDate === playResult.careerDate });

  // --- Fall 4 (der eigentliche Regressionsfund): ueberlebt die Scrim-
  // Entwicklung selbst einen WEITEREN Save/Load-Zyklus? (Bug: playScrim()/
  // resolveBotVsBotScrim() schrieben frueher direkt auf p[k]/p.overall ohne
  // dev.baseline/dev.deltas -- reapplyPlayerDevelopmentToRosters() verwarf
  // den Zuwachs beim naechsten Laden wieder.)
  await game.run(() => saveGameState());
  game.run(() => { const o = ORGANIZATIONS.find((x) => x.roster); o.budget += 1; });
  await game.run(() => loadGameState());
  const overallsAfterSecondReload = game.run(() => assignedOrg.roster.starters.map((p) => p.overall));
  const devPersisted = JSON.stringify(overallsAfterSecondReload) === JSON.stringify(playResult.afterOveralls);
  results.push({ case: 'scrim_development_survives_second_reload', pass: devPersisted, expected: playResult.afterOveralls, actual: overallsAfterSecondReload });

  const allIdentical = results.filter((r) => r.identical !== undefined).every((r) => r.identical);
  const allPass = results.filter((r) => r.pass !== undefined).every((r) => r.pass);
  console.log('=== SCRIM SAVE TEST ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('allIdentical:', allIdentical, 'allPass:', allPass, 'pageErrors:', game.pageErrors.length);
  process.exit(0);
})().catch((err) => { console.error('SCRIM SAVE TEST FAILED:', err); process.exit(1); });
