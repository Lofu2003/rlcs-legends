// Bot Ecosystem V13, Phase 49 -- Einzelprozess-Performance-Benchmark
// (KEIN Parallel-Lauf, nur dieser eine Prozess auf der Maschine). Vergleicht
// den V12-Scrim-Eligibility-Code (per game.run() zur Laufzeit ueber
// scoreBotScrim() zurueckgepatcht -- exakte Kopie der VOR Phase 41 in
// renderer.js stehenden Funktion) gegen den aktuellen, optimierten V13-Code
// (unveraendert aus der echten Datei geladen). Telemetrie bleibt AUS (echtes
// Produktions-Timing, keine Debug-Zaehler-Overhead).
// Nutzung: node phase49-benchmark-v13.js <OLD|NEW> <seed> <seasons>
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2] || 'NEW';
const SEED = process.argv[3] || 'V13-BENCH';
const SEASONS = parseInt(process.argv[4] || '10', 10);

// Wortwoertliche Kopie der VOR Phase-41-Optimierung in renderer.js stehenden
// scoreBotScrim()-Funktion (V12-Verhalten, siehe Bot-Ökosystem-V13-Kommentar
// in der echten Datei fuer die Herleitung des Fixes).
function patchOldFn() {
  scoreBotScrim = function (org) {
    if (!org.roster || !org.roster.starters || org.roster.starters.length < 3) return false;
    if (org.lastScrimDate && daysBetweenDateStrs(org.lastScrimDate, careerDate) < BOT_SCRIM_COOLDOWN_DAYS) return false;
    const activePlayers = [...org.roster.starters, org.roster.sub].filter(Boolean);
    if (activePlayers.length === 0) return false;
    if (activePlayers.filter((p) => p.illness).length > activePlayers.length / 2) return false;
    const daysSinceLastOfficial = org.lastOfficialMatchDate ? daysBetweenDateStrs(org.lastOfficialMatchDate, careerDate) : 45;
    const idleFactor = Math.max(0, Math.min(1, daysSinceLastOfficial / 30));
    const moraleFactor = Math.max(0, (60 - computeTeamMorale(org)) / 120);
    const chance = BOT_SCRIM_DAILY_CHANCE * (0.5 + idleFactor * 1.3 + moraleFactor);
    return Math.random() < chance;
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
  const p95 = perSeasonMs[Math.min(perSeasonMs.length - 1, Math.floor(perSeasonMs.length * 0.95))];
  console.log('[' + MODE + '/' + SEED + '] RESULT mean=' + mean + 'ms median=' + median + 'ms p95=' + p95 + 'ms pageErrors=' + game.pageErrors.length);
})().catch((err) => { console.error('[' + MODE + '] BENCHMARK FAILED:', err); process.exit(1); });
