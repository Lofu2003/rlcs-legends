// Save/Load Integrity V1 -- Kernverifikation.
// Nutzung: node roundtrip-test.js
const fs = require('fs');
const path = require('path');
const { createHeadlessGame } = require('./headless-runner');
const { compareGameStates, computeGameplayStateHash } = require('./statediff');

const STATEDIFF_SRC = fs.readFileSync(path.join(__dirname, 'statediff.js'), 'utf8');

// Vollständiger Gameplay-relevanter Snapshot ALLER 454 Orgs (Budget/Roster/
// Coach/Staff/Overall) -- läuft im VM-Context (siehe game.run()).
function fullSnapshotFn() {
  function personSnap(p) {
    if (!p) return null;
    if (p.vacant) return { vacant: true, role: p.role };
    return { name: p.name, overall: p.overall, age: p.age, potential: p.potential };
  }
  const orgSnap = (o) => ({
    name: o.name,
    budget: o.budget,
    financeStatus: o.financeStatus,
    strength: o.strength,
    starters: (o.roster.starters || []).map(personSnap),
    sub: personSnap(o.roster.sub),
    coach: personSnap(o.roster.coach),
    staff: (o.roster.staff || []).map(personSnap),
    reserve: (o.roster.reserve || []).map(personSnap),
  });
  const bots = ORGANIZATIONS.filter((o) => o.roster).map(orgSnap);
  const own = assignedOrg && assignedOrg.roster ? orgSnap(assignedOrg) : null;
  return { own, bots };
}

async function doRoundtripBatch(game, count, label) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const before = game.run(fullSnapshotFn);
    await game.run(() => saveGameState());
    // Live-State absichtlich veraendern (andere Org als vorher, damit ein
    // etwaiger "load tut nichts" fälschlich als PASS durchgehen würde --
    // dieser Test MUSS beweisen, dass load() den State aktiv restauriert).
    // Bug-Fix (Test-Methodik-Fehler, per Diagnose gefunden): eine direkte
    // `coach.overall += 3`-Mutation HIER (am lebenden Objekt, unter Umgehung
    // von applyStaffStatDelta()) verletzt das Overall<=Potential-Invariant
    // künstlich -- ensurePersonHasPotential()s LEGITIME Selbstheilung (siehe
    // dortigen Kommentar: "Potenzial wird bei Bedarf auf den höchsten
    // vorhandenen Stat angehoben, nie gesenkt") greift dann beim naechsten
    // personEffectiveStatCap()-Aufruf und hebt potential dauerhaft an --
    // das war ein Test-Artefakt (die Mutation selbst war unrealistisch),
    // KEIN echter Save/Load-Bug. Nur Budget (ein reiner Skalar ohne
    // Invarianten-Kopplung) eignet sich für diese Zwischen-Mutation.
    game.run((idx) => {
      const bots = ORGANIZATIONS.filter((o) => o.roster && o !== assignedOrg);
      const o = bots[idx % bots.length];
      o.budget += 12345;
    }, i);
    await game.run(() => loadGameState());
    const after = game.run(fullSnapshotFn);
    const diffs = compareGameStates(before, after, []);
    results.push({ iteration: i, diffCount: diffs.length, diffs: diffs.slice(0, 20) });
    if (diffs.length > 0) console.log('  [' + label + '] iteration', i, 'DRIFT:', diffs.length, 'diffs. Sample:', JSON.stringify(diffs.slice(0, 5)));
  }
  return results;
}

(async () => {
  console.log('=== ROUNDTRIP TEST (Save/Load Integrity V1) ===\n');
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'ROUNDTRIP-SEED' });
  game.initHeadlessCareer({ realOwnOrg: true });

  // "dichter" Mid-Career-Zustand: ein paar Saisons laufen lassen, damit
  // Transfers/Retirements/Coach-Wechsel/Entwicklung bereits stattgefunden
  // haben (Auftragsabschnitt 25: "komplexer Mid-Career-Save").
  console.log('Baue Mid-Career-Zustand auf (3 Saisons)...');
  for (let s = 0; s < 3; s++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }
  console.log('Mid-Career-Zustand bereit. pageErrors bisher:', game.pageErrors.length);

  // --- 20x ROUNDTRIP, KEIN Tagesfortschritt dazwischen ---
  console.log('\n--- 20x Save/Load Roundtrip (kein Tagesfortschritt) ---');
  const r20 = await doRoundtripBatch(game, 20, '20x');
  const totalDrift20 = r20.reduce((s, r) => s + r.diffCount, 0);
  console.log('20x Ergebnis: total diffs =', totalDrift20, totalDrift20 === 0 ? 'PASS' : 'FAIL');

  // --- 100x, falls schnell genug ---
  console.log('\n--- 100x Save/Load Roundtrip (optional, falls schnell) ---');
  const t0 = Date.now();
  const r100 = await doRoundtripBatch(game, 100, '100x');
  const totalDrift100 = r100.reduce((s, r) => s + r.diffCount, 0);
  console.log('100x Ergebnis: total diffs =', totalDrift100, totalDrift100 === 0 ? 'PASS' : 'FAIL', 'Dauer:', Date.now() - t0, 'ms');

  console.log('\npageErrors gesamt:', game.pageErrors.length, JSON.stringify(game.pageErrors.slice(0, 5)));

  const out = { totalDrift20, totalDrift100, r20DriftIterations: r20.filter((r) => r.diffCount > 0), r100DriftIterations: r100.filter((r) => r.diffCount > 0), pageErrors: game.pageErrors };
  fs.writeFileSync(path.join(__dirname, '_roundtrip_result.json'), JSON.stringify(out, null, 2));
  console.log('\nErgebnis geschrieben nach _roundtrip_result.json');
})().catch((err) => { console.error('ROUNDTRIP TEST FAILED:', err); process.exit(1); });
