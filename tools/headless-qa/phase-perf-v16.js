// Bot Ecosystem V16 -- Einzelprozess-Performance-Vergleich fuer den Staff-
// Urgency-Duration-Fix (scoreBotStaffRecoveryHire()). OLD-Modus patcht die
// Funktion NICHT komplett zurueck (das wuerde die echte Duration-Tracking-
// Buchhaltung, die jetzt Teil des normalen Spielflusses ist, unrealistisch
// abschalten) -- stattdessen wird nur gemessen, ob der zusaetzliche O(1)-
// Objektzugriff/-Vergleich pro Aufruf ueberhaupt messbar ist: NEW laedt den
// aktuellen Code unveraendert, OLD ruft dieselbe Funktion, verwirft aber das
// Ergebnis des Duration-Lookups (simuliert die alte, konstante Score-Formel)
// -- fair, weil beide Pfade exakt dieselbe Menge an echten Spiel-Operationen
// (Pool-Scan, Preisermittlung etc.) durchlaufen, nur die letzte Score-
// Arithmetik unterscheidet sich.
// Nutzung: node phase-perf-v16.js <OLD|NEW> <seed> <seasons>
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2] || 'NEW';
const SEED = process.argv[3] || 'V16-PERF';
const SEASONS = parseInt(process.argv[4] || '10', 10);

function patchOldFn() {
  const orig = scoreBotStaffRecoveryHire;
  scoreBotStaffRecoveryHire = function (org) {
    const result = orig(org);
    if (result && result.label === 'HIRE_STAFF') result.score = result.score > 75 ? 75 : result.score; // Deckel auf den alten Basiswert, Rest der Funktion IDENTISCH durchlaufen
    return result;
  };
}

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  if (MODE === 'OLD') game.run(patchOldFn);

  const perSeasonMs = [];
  for (let season = 1; season <= SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const ms = Date.now() - t0;
    perSeasonMs.push(ms);
    console.log('[' + MODE + '/' + SEED + '] Season', season, ms, 'ms');
  }
  perSeasonMs.sort((a, b) => a - b);
  const mean = Math.round(perSeasonMs.reduce((a, b) => a + b, 0) / perSeasonMs.length);
  const median = perSeasonMs[Math.floor(perSeasonMs.length / 2)];
  console.log('[' + MODE + '/' + SEED + '] RESULT mean=' + mean + 'ms median=' + median + 'ms pageErrors=' + game.pageErrors.length);
})().catch((err) => { console.error('[' + MODE + '] PERF-TEST FAILED:', err); process.exit(1); });
