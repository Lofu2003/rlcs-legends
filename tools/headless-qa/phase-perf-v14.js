// Bot Ecosystem V14 -- Einzelprozess-Performance-Vergleich fuer den
// Retirement-Replacement-Fix (computeOrgReplacementTierCenter()). Vergleicht
// den V13-Referenzcode (ageAndRetireRosterForSeason() per game.run()
// zurueckgepatcht auf den exakten Vor-Fix-Stand: universeller Anker 2.75,
// keine Kaderkontext-Berechnung) gegen den aktuellen, gefixten V14-Code
// (unveraendert aus der echten Datei geladen). Telemetrie AUS (echtes
// Produktions-Timing). Nutzung: node phase-perf-v14.js <OLD|NEW> <seed> <seasons>
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2] || 'NEW';
const SEED = process.argv[3] || 'V14-PERF';
const SEASONS = parseInt(process.argv[4] || '10', 10);

// Wortwoertliche Kopie des Vor-Fix-Aufrufs (siehe renderer.js-Kommentar-
// Historie: `qualityStars = rollStarsAround(2.75, 2.25, Math.random)`).
function patchOldFn() {
  // Nur der EINE Baustein wird zurueckgepatcht (der echte, unveraenderte
  // ageAndRetireRosterForSeason()-Ablauf laeuft weiter) -- ersetzt die
  // Kaderkontext-Berechnung durch die alte, konstante 2.75 fuer die gesamte
  // Laufzeit dieses Benchmarks.
  computeOrgReplacementTierCenter = function () { return 2.75; };
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
