// Bot Ecosystem V15, Phase 42 -- Chaos-Test: 30 Saisons, wie chaos-run-v10.js
// (unveraendert uebernommene Checks) PLUS drei neue Checks (Auftragsvorgabe):
// Ghost Player (Roster-Slot mit unvollstaendigem/leerem Personen-Objekt),
// Duplicate Player (derselbe Name zweimal im aktiven Kader EINER Org, ODER
// derselbe Name mehrfach im FREE_AGENT_PLAYERS-Pool -- letzteres direkt
// relevant fuer den V15-Pool-Regen-Fix, der neue Namen erzeugt), Broken
// Staff Slot (Personal-Array-Eintrag ohne gueltige role/vacant-Form).
// Nutzung: node chaos-run-v15.js <seed> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V15-CHAOS-A';
const OUT_FILE = process.argv[3] || path.join(__dirname, '_chaos_' + SEED + '.json');
const TARGET_SEASONS = 30;

function scanFn(season) {
  const anomalies = [];
  ORGANIZATIONS.filter((o) => o.roster).forEach((org) => {
    const starters = org.roster.starters || [];
    if (starters.length < 3) anomalies.push({ type: 'EMPTY_OR_INCOMPLETE_ROSTER', org: org.name, count: starters.length });
    if (!org.roster.coach) anomalies.push({ type: 'MISSING_COACH', org: org.name });
    const active = [...starters, org.roster.sub].filter(Boolean);
    active.forEach((p) => {
      if (!p.name || typeof p.overall !== 'number') anomalies.push({ type: 'GHOST_PLAYER', org: org.name, player: p.name || '(kein Name)' });
      ['overall', 'potential', 'age'].forEach((k) => {
        const v = p[k];
        if (typeof v !== 'number' || Number.isNaN(v)) anomalies.push({ type: 'NAN_OR_UNDEFINED_STAT', org: org.name, player: p.name, field: k, value: v });
        else if (v < 0) anomalies.push({ type: 'NEGATIVE_STAT', org: org.name, player: p.name, field: k, value: v });
        else if (k !== 'age' && v > 99) anomalies.push({ type: 'STAT_ABOVE_CAP', org: org.name, player: p.name, field: k, value: v });
      });
    });
    const names = active.map((p) => p.name).filter(Boolean);
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupeNames.length) anomalies.push({ type: 'DUPLICATE_PLAYER', org: org.name, names: [...new Set(dupeNames)] });
    (org.roster.staff || []).forEach((s, i) => {
      if (!s || (typeof s.role !== 'string') || (!s.vacant && typeof s.overall !== 'number')) {
        anomalies.push({ type: 'BROKEN_STAFF_SLOT', org: org.name, index: i, value: s ? JSON.stringify(s).slice(0, 100) : 'null' });
      }
    });
    if (typeof org.budget !== 'number' || Number.isNaN(org.budget)) anomalies.push({ type: 'BUDGET_NAN', org: org.name, value: org.budget });
    if (!Number.isFinite(org.budget) || Math.abs(org.budget) > 1e12) anomalies.push({ type: 'BUDGET_OVERFLOW_SUSPECT', org: org.name, value: org.budget });
    if (typeof org.strength !== 'number' || Number.isNaN(org.strength)) anomalies.push({ type: 'STRENGTH_NAN', org: org.name, value: org.strength });
  });
  // V15-spezifisch: FREE_AGENT_PLAYERS-Pool auf Namensduplikate pruefen (direkt
  // relevant fuer ensurePlayerMarketPopulation() -- Namenskollisionsschutz
  // im Regen-Loop selbst, hier die unabhaengige Gegenprobe).
  const poolNames = FREE_AGENT_PLAYERS.map((p) => p.name);
  const poolDupes = poolNames.filter((n, i) => poolNames.indexOf(n) !== i);
  if (poolDupes.length) anomalies.push({ type: 'DUPLICATE_PLAYER', org: '(FREE_AGENT_PLAYERS-Pool)', names: [...new Set(poolDupes)] });
  const ranks = ORGANIZATIONS.filter((o) => o.roster).map((o) => qaOrgRank(o)).sort((a, b) => a - b);
  const expected = ranks.map((_, i) => i + 1);
  const rankingBroken = JSON.stringify(ranks) !== JSON.stringify(expected);
  if (rankingBroken) anomalies.push({ type: 'BROKEN_RANKING', sample: ranks.slice(0, 10) });
  return { season, anomalyCount: anomalies.length, anomalies: anomalies.slice(0, 50) };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer({ realOwnOrg: true });
  botEconomyDebugTelemetryEnabled = true;

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, scans: [], saveCorruptionCheck: null, pageErrors: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const scan0 = game.run(scanFn, 0);
  out.scans.push(scan0);
  flush();

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const scan = game.run(scanFn, season);
    out.scans.push(scan);
    console.log('[' + SEED + '] Season', season, 'anomalies=', scan.anomalyCount);
    flush();
  }

  const before = game.run(scanFn, 'pre-save');
  await game.run(() => saveGameState());
  await game.run(() => loadGameState());
  const after = game.run(scanFn, 'post-load');
  out.saveCorruptionCheck = { anomaliesBefore: before.anomalyCount, anomaliesAfter: after.anomalyCount, newAnomaliesIntroduced: after.anomalyCount > before.anomalyCount };

  out.totalAnomalies = out.scans.reduce((s, sc) => s + sc.anomalyCount, 0);
  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] CHAOS TEST DONE in', out.durationMs, 'ms. totalAnomalies=', out.totalAnomalies, 'saveCorruption=', out.saveCorruptionCheck.newAnomaliesIntroduced, 'pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] CHAOS TEST FAILED:', err); process.exit(1); });
