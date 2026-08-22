// V18 -- Teil AU: Save-Corruption-Handling. NUR auf Testkopien (eigener
// persistDir). Prueft: fehlende optionale Felder, null, truncated/ungueltiges
// JSON, alte Save-Version -- Spiel darf NICHT abstuerzen, soll den bereits
// vorhandenen "Speicherstand beschaedigt"-Pfad (main.js -> {corrupted:true})
// nehmen, wo zutreffend.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHeadlessGame } = require('./headless-runner');

const PERSIST_DIR = path.join(os.tmpdir(), 'rlcs-v18-savecorrupt-' + Date.now());

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'V18-SAVECORRUPT', persistDir: PERSIST_DIR });
  game.initHeadlessCareer({ realOwnOrg: true });
  game.run((sid) => { currentSlotId = sid; }, 1);
  await game.run(() => saveGameState());

  const slotFile = path.join(PERSIST_DIR, 'slot-1.json');
  const raw = fs.readFileSync(slotFile, 'utf8');

  const cases = {
    truncated: raw.slice(0, Math.floor(raw.length / 2)), // abgeschnitten wie bei Absturz waehrend des Schreibens
    emptyFile: '',
    invalidJson: '{not valid json!!!',
    nullContent: 'null',
    missingOptionalField: (() => { const o = JSON.parse(raw); delete o.postInbox; delete o.npcRelations; delete o.pendingNegotiations; return JSON.stringify(o); })(),
    oldVersion: (() => { const o = JSON.parse(raw); delete o.version; delete o.botEconomyOverlay; delete o.staffDevelopment; return JSON.stringify(o); })(),
  };

  const results = [];
  for (const [name, content] of Object.entries(cases)) {
    fs.writeFileSync(slotFile, content);
    let crashed = false;
    let loadResult = null;
    try {
      loadResult = await game.run(() => loadGameState());
    } catch (e) {
      crashed = true;
      loadResult = String(e);
    }
    const screenAfter = game.run(() => (typeof document !== 'undefined' ? (document.querySelector('.screen:not(.hidden)') || {}).id : null));
    results.push({ case: name, crashed, screenAfter });
    console.log((crashed ? 'CRASH' : 'ok') + ' -- Fall "' + name + '" -- Screen danach: ' + screenAfter);
    fs.writeFileSync(slotFile, raw); // fuer den naechsten Fall zuruecksetzen
  }

  console.log('\npageErrors gesamt:', game.pageErrors.length, JSON.stringify(game.pageErrors.slice(0, 5)));
  const anyCrash = results.some((r) => r.crashed);
  console.log('RESULT:', (anyCrash || game.pageErrors.length > 0) ? 'FAIL (Absturz gefunden)' : 'PASS (kein Absturz bei keinem der ' + results.length + ' Korruptionsfaelle)');

  fs.writeFileSync(path.join(__dirname, '_save_corruption_v18_result.json'), JSON.stringify({ results, pageErrors: game.pageErrors }, null, 2));

  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch {}
})().catch((err) => { console.error('SAVE CORRUPTION TEST FAILED:', err); process.exit(1); });
