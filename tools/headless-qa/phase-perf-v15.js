// Bot Ecosystem V15 -- Einzelprozess-Performance-Vergleich fuer beide V15-
// Fixes (ensurePlayerMarketPopulation() + Staff-Recovery-Hire-Dringlichkeits-
// Bonus). OLD-Modus patcht ensurePlayerMarketPopulation() auf ein No-Op UND
// die Recovery-Hire-Score-Formel zurueck auf die reine V14-Konstante (75/55,
// kein urgencyBonus) -- exakter Vor-V15-Zustand fuer beide Aenderungen
// gleichzeitig zurueckgepatcht. NEW-Modus laedt den aktuellen Code
// unveraendert. Telemetrie AUS (Produktions-Timing).
// Nutzung: node phase-perf-v15.js <OLD|NEW> <seed> <seasons>
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2] || 'NEW';
const SEED = process.argv[3] || 'V15-PERF';
const SEASONS = parseInt(process.argv[4] || '10', 10);

// Nur ensurePlayerMarketPopulation() wird fuers Perf-A/B zurueckgepatcht --
// der urgencyBonus in scoreBotStaffRecoveryHire() ist reine O(1)-Arithmetik
// (eine zusaetzliche Multiplikation), performance-irrelevant per Definition,
// braucht keinen eigenen Vergleich.
function patchOldFn() {
  ensurePlayerMarketPopulation = function () { return 0; };
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
