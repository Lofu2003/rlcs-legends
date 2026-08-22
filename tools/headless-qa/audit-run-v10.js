// Bot Ecosystem V10 -- Relative Power, Competitive Ladder & Economic Scale
// Audit. Phase 1/2: reine Instrumentierung, KEINE Gameplay-Aenderung.
// V9-Code ist Baseline. Nutzt die neuen renderer.js-QA-Hooks
// qaCapturePowerSnapshot() (voller 454-Org-Machtzustand, nur an den
// Checkpoint-Saisons S0/1/2/3/5/10/15/20), qaIncomeTotals (kumulative
// Einkommens-/Ausgaben-Kategorien je Org), qaSeriesCountByOrg (kumulative
// Serienzahl je Org), plus seasonQualifiedTeams (Turnierzugang je Region).
// Nutzung: node audit-run-v10.js <seed> <targetSeasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V10-A';
const TARGET_SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_auditv10_' + SEED + '.json');
const CHECKPOINTS = [0, 1, 2, 3, 5, 10, 15, 20];

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  botMatchUpsetTally = { '0-5': { strongerWins: 0, upsets: 0 }, '6-10': { strongerWins: 0, upsets: 0 }, '11-20': { strongerWins: 0, upsets: 0 }, '21-30': { strongerWins: 0, upsets: 0 }, '30+': { strongerWins: 0, upsets: 0 } };
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const bottom10 = sorted.slice(0, 10).map((o) => o.name);
  const mid10 = sorted.slice(Math.floor(sorted.length / 2) - 5, Math.floor(sorted.length / 2) + 5).map((o) => o.name);
  const top10 = sorted.slice(-10).map((o) => o.name);
  const top50Names0 = [...sorted].reverse().slice(0, 50).map((o) => o.name);
  const allBotNames = bots.map((o) => o.name);
  return {
    totalOrgCount: ORGANIZATIONS.length, assignedOrgName: assignedOrg.name,
    bottom10, mid10, top10, top50Names0, allBotNames,
    bottom10InitialStrength: bottom10.map((n) => findOrgByName(n).strength),
    mid10InitialStrength: mid10.map((n) => findOrgByName(n).strength),
    top10InitialStrength: top10.map((n) => findOrgByName(n).strength),
  };
}

// Leichte, JEDE Saison erfasste Kohorten-Buchhaltung (30 Orgs: bottom10/
// mid10/top10) -- Serien-/Einkommens-Deltas seit letztem Aufruf + ob die Org
// diese Saison ueberhaupt fuer Open 1-6/Major/LCQ qualifiziert war
// (seasonQualifiedTeams[region], siehe resolveOpenQualifierEvent()).
function seasonLiteFn(cohortNames, prevSeriesCounts, prevIncomeTotals, seasonNum) {
  const rows = {};
  cohortNames.forEach((name) => {
    const o = findOrgByName(name);
    if (!o) { rows[name] = null; return; }
    const region = orgRegion(o.country);
    const qualified = region ? (seasonQualifiedTeams[region] || []).includes(name) : null;
    const seriesNow = qaSeriesCountByOrg[name] || 0;
    const seriesDelta = seriesNow - ((prevSeriesCounts && prevSeriesCounts[name]) || 0);
    const incomeNow = qaIncomeTotals[name] || {};
    const incomeDelta = {};
    Object.keys(incomeNow).forEach((k) => { incomeDelta[k] = incomeNow[k] - ((prevIncomeTotals && prevIncomeTotals[name] && prevIncomeTotals[name][k]) || 0); });
    rows[name] = { qualifiedThisSeason: qualified, seriesThisSeason: seriesDelta, incomeThisSeason: incomeDelta, strength: o.strength, rank: qaOrgRank(o) };
  });
  return {
    season: careerState.seasonNumber, date: careerDate, rows,
    seriesCountsSnapshot: Object.assign({}, qaSeriesCountByOrg),
    incomeTotalsSnapshot: JSON.parse(JSON.stringify(qaIncomeTotals)),
  };
}

// Voller Machtzustands-Schnappschuss (454 Orgs) NUR an Checkpoint-Saisons --
// nutzt qaCapturePowerSnapshot() direkt.
function powerSnapshotFn(seasonNum) {
  return { season: seasonNum, date: careerDate, rows: qaCapturePowerSnapshot() };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. assignedOrg=', setup.assignedOrgName, 'bottom10=', setup.bottom10.length, 'mid10=', setup.mid10.length, 'top10=', setup.top10.length);

  const cohortNames = [...setup.bottom10, ...setup.mid10, ...setup.top10];
  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, setup, seasonLite: [], powerSnapshots: [], errors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  let prevSeriesCounts = {}, prevIncomeTotals = {};

  const lite0 = game.run(seasonLiteFn, cohortNames, prevSeriesCounts, prevIncomeTotals, 0);
  out.seasonLite.push(lite0);
  prevSeriesCounts = lite0.seriesCountsSnapshot; prevIncomeTotals = lite0.incomeTotalsSnapshot;
  const power0 = game.run(powerSnapshotFn, 0);
  out.powerSnapshots.push(power0);
  flush();
  console.log('[' + SEED + '] S0 captured. orgs in power snapshot:', power0.rows.length);

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const lite = game.run(seasonLiteFn, cohortNames, prevSeriesCounts, prevIncomeTotals, season);
    out.seasonLite.push(lite);
    prevSeriesCounts = lite.seriesCountsSnapshot; prevIncomeTotals = lite.incomeTotalsSnapshot;

    if (CHECKPOINTS.indexOf(season) !== -1) {
      const power = game.run(powerSnapshotFn, season);
      out.powerSnapshots.push(power);
    }

    const ms = Date.now() - t0;
    console.log('[' + SEED + '] Season', season, 'done in', ms, 'ms. actualSeasonNum=', lite.season);
    flush();
  }

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] AUDIT V10 DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length, 'powerSnapshots:', out.powerSnapshots.length);
})().catch((err) => { console.error('[' + SEED + '] AUDIT V10 FAILED:', err); process.exit(1); });
