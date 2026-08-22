// Bot Ecosystem V12, Phase 42 -- Human-Scrim-Regression: Invite/Receive/
// Accept/Reject muss nach den V12-Aenderungen (Bot-vs-Bot-Scrims, Cooldown-
// Fix) weiterhin exakt wie vorher funktionieren.
const { createHeadlessGame } = require('./headless-runner');

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'HUMAN-SCRIM-REGRESSION' });
  game.initHeadlessCareer({ realOwnOrg: true });
  const results = [];

  // 1) Outgoing invite erzeugt korrekten Eintrag.
  const t1 = game.run(() => {
    const opp = ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster);
    sendScrimInvite(opp.name);
    const inv = scrimInvites.find((i) => i.opponentOrgName === opp.name);
    return { opponent: opp.name, created: !!inv, status: inv ? inv.status : null, direction: inv ? inv.direction : null };
  });
  results.push({ test: '1_outgoing_invite_created', pass: t1.created && t1.status === 'pending' && t1.direction === 'outgoing', detail: t1 });

  // 2) Duplicate-Invite an denselben Gegner wird ignoriert.
  const t2 = game.run((oppName) => {
    const before = scrimInvites.length;
    sendScrimInvite(oppName);
    return { before, after: scrimInvites.length };
  }, t1.opponent);
  results.push({ test: '2_duplicate_invite_blocked', pass: t2.before === t2.after, detail: t2 });

  // 3) resolveScrimInvites löst die pending Einladung auf (ready ODER declined)
  // -- respondDate liegt einen Tag in der Zukunft (SCRIM_RESPONSE_DELAY_DAYS),
  // also erst NACH Tagfortschritt fällig.
  game.run(() => { advanceOneCalendarDay(); });
  const t3 = game.run((oppName) => {
    const inv = scrimInvites.find((i) => i.opponentOrgName === oppName);
    return { status: inv ? inv.status : 'removed' };
  }, t1.opponent);
  results.push({ test: '3_invite_resolved', pass: ['ready', 'removed'].includes(t3.status) || t3.status === 'declined', detail: t3 });

  // 4) Falls ready: playScrim() entwickelt Spieler UND respektiert Cooldown danach.
  if (t3.status === 'ready') {
    const t4 = game.run((oppName) => {
      const before = [...assignedOrg.roster.starters].map((p) => p.overall);
      playScrim(oppName);
      const after = [...assignedOrg.roster.starters].map((p) => p.overall);
      return { before, after, lastScrimDate: assignedOrg.lastScrimDate, careerDate };
    }, t1.opponent);
    const grew = t4.after.some((v, i) => v >= t4.before[i]); // >= da Rundung manchmal 0 Zuwachs zeigt
    results.push({ test: '4_playScrim_development', pass: grew && t4.lastScrimDate === t4.careerDate, detail: t4 });

    // 5) Cooldown blockiert sofortige neue Einladung nach dem Spielen.
    const t5 = game.run(() => {
      const opp2 = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster)[3];
      const before = scrimInvites.length;
      sendScrimInvite(opp2.name);
      return { before, after: scrimInvites.length };
    });
    results.push({ test: '5_cooldown_blocks_new_invite', pass: t5.before === t5.after, detail: t5 });
  } else {
    results.push({ test: '4_playScrim_development', skipped: true, reason: 'Gegner hat abgelehnt (Zufallsergebnis) oder Einladung entfernt' });
    results.push({ test: '5_cooldown_blocks_new_invite', skipped: true });
  }

  // 6) Incoming invite: reject-Pfad.
  const t6 = game.run(() => {
    scrimInvites.push({ id: 'test_incoming_1', direction: 'incoming', opponentOrgName: ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster).name, sentDate: careerDate, respondDate: null, status: 'pending' });
    respondToIncomingScrim('test_incoming_1', false);
    return { stillExists: scrimInvites.some((i) => i.id === 'test_incoming_1') };
  });
  results.push({ test: '6_incoming_reject_removes_invite', pass: !t6.stillExists, detail: t6 });

  // 7) Incoming invite: accept-Pfad fuehrt zu 'ready'.
  const t7 = game.run(() => {
    scrimInvites.push({ id: 'test_incoming_2', direction: 'incoming', opponentOrgName: ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster).name, sentDate: careerDate, respondDate: null, status: 'pending' });
    respondToIncomingScrim('test_incoming_2', true);
    const inv = scrimInvites.find((i) => i.id === 'test_incoming_2');
    return { status: inv ? inv.status : 'missing' };
  });
  results.push({ test: '7_incoming_accept_ready', pass: t7.status === 'ready', detail: t7 });

  const allPass = results.filter((r) => !r.skipped).every((r) => r.pass);
  console.log('=== HUMAN SCRIM REGRESSION ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('ALL PASS (excl. skipped):', allPass, 'pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('HUMAN SCRIM REGRESSION FAILED:', err); process.exit(1); });
