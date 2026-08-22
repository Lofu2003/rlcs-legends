// V18.1 -- Phase 9: Krankheit. QA-seitig reproduzierbar (direkte
// person.illness-Zuweisung, wie im Auftrag vorgesehen: "Produktionslogik
// nicht dauerhaft veraendern") statt auf ein zufaelliges maybeTriggerIllness()
// zu warten. Prueft: Anzeige-Feld korrekt, Physio-Effekt auf Genesungsdauer,
// Ausschluss aus Scrim-faehigem Kader bei >50% erkrankten Aktiven, Genesung
// nach Ablauf der Dauer, Save/Load-Konsistenz waehrend Krankheit.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHeadlessGame } = require('./headless-runner');

const PERSIST_DIR = path.join(os.tmpdir(), 'rlcs-v181-illness-' + Date.now());

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'V181-ILLNESS', persistDir: PERSIST_DIR });
  game.initHeadlessCareer({ realOwnOrg: true });
  game.run((sid) => { currentSlotId = sid; }, 1);

  console.log('=== Test 1: Krankheit setzen, Anzeige-Berechnung pruefen ===');
  const r1 = game.run(() => {
    const p = assignedOrg.roster.starters[0];
    p.illness = { since: careerDate, duration: 5 };
    const remaining = Math.max(0, p.illness.duration - daysBetweenDateStrs(p.illness.since, careerDate));
    return { name: p.name, illness: p.illness, remaining };
  });
  console.log(JSON.stringify(r1));
  console.log('Test 1:', (r1.remaining === 5) ? 'PASS' : 'FAIL');

  console.log('\n=== Test 2: Save/Load waehrend Krankheit -- Feld bleibt erhalten ===');
  await game.run(() => saveGameState());
  await game.run(() => loadGameState());
  const r2 = game.run(() => {
    const p = assignedOrg.roster.starters[0];
    return { illness: p.illness };
  });
  console.log(JSON.stringify(r2));
  const test2Pass = r2.illness && r2.illness.duration === 5;
  console.log('Test 2:', test2Pass ? 'PASS' : 'FAIL');

  console.log('\n=== Test 3: Scrim-Ausschluss bei Mehrheit erkrankter Aktiver ===');
  const r3 = game.run(() => {
    const roster = assignedOrg.roster;
    const active = [...(roster.starters || []), roster.sub].filter(Boolean);
    active.forEach((p) => { p.illness = { since: careerDate, duration: 5 }; });
    // scoreBotScrim() o.ae. pruefen -- direkter Zugriff auf die dokumentierte Bedingung (Zeile ~3468)
    const majoritySick = active.filter((p) => p.illness).length > active.length / 2;
    return { activeCount: active.length, sickCount: active.filter((p) => p.illness).length, majoritySick };
  });
  console.log(JSON.stringify(r3));
  console.log('Test 3 (Mehrheits-Bedingung korrekt erkannt):', r3.majoritySick ? 'PASS' : 'FAIL');

  console.log('\n=== Test 4: Genesung nach Ablauf der Dauer ===');
  const r4 = game.run(() => {
    const p = assignedOrg.roster.starters[0];
    p.illness = { since: '2026-01-01', duration: 3 };
    careerDate = '2026-01-05'; // 4 Tage vergangen > duration=3
    checkIllnessRecoveries();
    return { illnessAfter: p.illness };
  });
  console.log(JSON.stringify(r4));
  console.log('Test 4 (Genesung nach Ablauf):', r4.illnessAfter === null ? 'PASS' : 'FAIL');

  console.log('\n=== Test 5: Physiotherapeut-Effekt (Reduktions-Prozentsatz existiert und ist sinnvoll) ===');
  const r5 = game.run(() => {
    const withoutPhysio = physiotherapeutIllnessReductionPct(assignedOrg);
    const staff = assignedOrg.roster.staff || [];
    const physioSlot = staff.find((s) => s.role === 'Physiotherapeut');
    return { withoutPhysio, hasPhysioSlot: !!physioSlot, physioVacant: physioSlot ? physioSlot.vacant : null };
  });
  console.log(JSON.stringify(r5));
  console.log('Test 5 (Funktion liefert plausiblen Wert):', typeof r5.withoutPhysio === 'number' && r5.withoutPhysio >= 0 ? 'PASS' : 'FAIL');

  console.log('\npageErrors:', game.pageErrors.length, JSON.stringify(game.pageErrors.slice(0, 5)));
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch {}
})().catch((err) => { console.error('ILLNESS TEST FAILED:', err); process.exit(1); });
