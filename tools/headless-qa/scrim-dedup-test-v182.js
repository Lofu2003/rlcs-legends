// V18.2 -- gezielte Nachpruefung: sendScrimInvite() zweimal SOFORT
// hintereinander an denselben Gegner -- muss durch den bestehenden
// already-Guard (renderer.js ~3181) blockiert werden. Headless statt UI, da
// reine Logikpruefung (kein Rendering-Aspekt), deutlich schneller/praeziser
// als der vorherige UI-Test, der nur Zaehlwerte statt der vollen
// scrimInvites-Struktur erfasst hatte.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHeadlessGame } = require('./headless-runner');

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'V182-SCRIM-DEDUP' });
  game.initHeadlessCareer({ realOwnOrg: true });

  const r = game.run(() => {
    scrimInvites = []; // sauberer Ausgangspunkt
    assignedOrg.lastScrimDate = null; // Cooldown-Guard nicht faelschlich blockieren lassen
    const target = ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster).name;
    sendScrimInvite(target);
    const afterFirst = JSON.parse(JSON.stringify(scrimInvites));
    sendScrimInvite(target); // SOFORT nochmal, exakt derselbe Gegner
    const afterSecond = JSON.parse(JSON.stringify(scrimInvites));
    return { target, afterFirst, afterSecond };
  });

  console.log('Ziel-Org:', r.target);
  console.log('Nach 1. Einladung: n=' + r.afterFirst.length, JSON.stringify(r.afterFirst));
  console.log('Nach 2. Einladung (sofort, gleicher Gegner): n=' + r.afterSecond.length, JSON.stringify(r.afterSecond));
  const dedupWorks = r.afterSecond.length === r.afterFirst.length;
  console.log('\nRESULT Dedup-Guard greift korrekt (kein Duplikat erzeugt):', dedupWorks ? 'PASS' : 'FAIL');

  // Zusaetzlich: 5 Einladungen an denselben Gegner in schneller Folge (staerkerer Spam-Test).
  const r2 = game.run(() => {
    scrimInvites = [];
    assignedOrg.lastScrimDate = null;
    const target = ORGANIZATIONS.find((o) => o !== assignedOrg && o.roster).name;
    for (let i = 0; i < 5; i++) sendScrimInvite(target);
    return { target, count: scrimInvites.length, invites: scrimInvites };
  });
  console.log('\n5x-Spam-Test an denselben Gegner: n=' + r2.count, JSON.stringify(r2.invites));
  console.log('RESULT 5x-Spam blockiert (n sollte 1 sein):', r2.count === 1 ? 'PASS' : 'FAIL');

  console.log('\npageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('SCRIM DEDUP TEST FAILED:', err); process.exit(1); });
