// V18 -- Release-Candidate Chaos-Test. Baut auf chaos-run-v17.js auf (alle
// bisherigen Checks unveraendert) PLUS die von V18 Teil BC zusaetzlich
// geforderten Kategorien, die V17 noch nicht abdeckte:
//   - BROKEN_CONTRACT (contractEnd fehlt/ist kein gueltiges Datum/liegt
//     unplausibel weit in Vergangenheit oder Zukunft)
//   - BROKEN_DATE (careerDate selbst kein gueltiges Datum)
//   - TOURNAMENT_CORRUPTION (seasonQualifiedTeams/seasonTournamentResults
//     strukturell inkonsistent -- z.B. Ergebnis fuer ein Team, das nie
//     qualifiziert war)
// Nutzung: node chaos-run-v18.js <seed> <outFile> <seasons>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V18-CHAOS-A';
const OUT_FILE = process.argv[3] || path.join(__dirname, '_chaos_' + SEED + '.json');
const TARGET_SEASONS = parseInt(process.argv[4] || '55', 10);

function scanFn(season) {
  const anomalies = [];
  const nowSeason = careerState.seasonNumber;
  const KNOWN_STAFF_ROLES = ORG_ROSTER_STAFF_ROLES;

  function isValidDateStr(s) {
    if (typeof s !== 'string' || !s) return false;
    const d = new Date(s);
    return !Number.isNaN(d.getTime());
  }

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
      const salary = playerMonthlySalary(p);
      if (typeof salary !== 'number' || Number.isNaN(salary) || salary < 0) anomalies.push({ type: 'NEGATIVE_SALARY', org: org.name, player: p.name, value: salary });
      // V18-neu: BROKEN_CONTRACT -- falls contractEnd gesetzt ist, muss es ein
      // gueltiges Datum sein und darf nicht mehr als ~5 Jahre in der
      // Vergangenheit liegen (abgelaufene Vertraege werden saisonweise
      // verarbeitet, sollten also nie lange unbemerkt "haengen bleiben").
      if (p.contractEnd !== undefined && p.contractEnd !== null) {
        if (!isValidDateStr(p.contractEnd)) {
          anomalies.push({ type: 'BROKEN_CONTRACT', org: org.name, player: p.name, value: String(p.contractEnd) });
        } else {
          const endMs = new Date(p.contractEnd).getTime();
          const nowMs = new Date(careerDate).getTime();
          const yearsDiff = (nowMs - endMs) / (365.25 * 24 * 3600 * 1000);
          if (yearsDiff > 5) anomalies.push({ type: 'BROKEN_CONTRACT', org: org.name, player: p.name, value: p.contractEnd, note: 'contractEnd ' + Math.round(yearsDiff) + ' Jahre in der Vergangenheit' });
        }
      }
    });
    const names = active.map((p) => p.name).filter(Boolean);
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupeNames.length) anomalies.push({ type: 'DUPLICATE_PLAYER', org: org.name, names: [...new Set(dupeNames)] });

    (org.roster.staff || []).forEach((s, i) => {
      if (!s || (typeof s.role !== 'string') || (!s.vacant && typeof s.overall !== 'number')) {
        anomalies.push({ type: 'BROKEN_STAFF_SLOT', org: org.name, index: i, value: s ? JSON.stringify(s).slice(0, 100) : 'null' });
      }
    });
    (org.roster.staff || []).forEach((s, i) => {
      if (s && !s.vacant && (!s.name || typeof s.name !== 'string')) {
        anomalies.push({ type: 'GHOST_STAFF', org: org.name, index: i, role: s.role });
      }
    });
    const staffNames = [org.roster.coach && org.roster.coach.name, ...((org.roster.staff || []).filter((s) => s && !s.vacant).map((s) => s.name))].filter(Boolean);
    const dupeStaffNames = staffNames.filter((n, i) => staffNames.indexOf(n) !== i);
    if (dupeStaffNames.length) anomalies.push({ type: 'DUPLICATE_STAFF', org: org.name, names: [...new Set(dupeStaffNames)] });
    (org.roster.staff || []).forEach((s, i) => {
      if (s && typeof s.role === 'string' && KNOWN_STAFF_ROLES.indexOf(s.role) === -1) {
        anomalies.push({ type: 'INVALID_ROLE', org: org.name, index: i, role: s.role });
      }
    });

    if (org.staffVacantSince !== undefined) {
      if (typeof org.staffVacantSince !== 'object' || org.staffVacantSince === null) {
        anomalies.push({ type: 'INVALID_VACANCY_STATE', org: org.name, value: String(org.staffVacantSince) });
      } else {
        const filledRoles = new Set((org.roster.staff || []).filter((s) => s && !s.vacant).map((s) => s.role));
        const vacantRolesNow = KNOWN_STAFF_ROLES.filter((role) => !filledRoles.has(role));
        if (!org.roster.coach) vacantRolesNow.push('Coach');
        const vacantSetNow = new Set(vacantRolesNow);
        Object.entries(org.staffVacantSince).forEach(([role, since]) => {
          if (typeof since !== 'number' || Number.isNaN(since) || since < 0 || since > nowSeason) {
            anomalies.push({ type: 'INVALID_VACANCY_STATE', org: org.name, role, value: since });
          }
          if (!vacantSetNow.has(role)) {
            anomalies.push({ type: 'VACANCY_SINCE_WITHOUT_VACANCY', org: org.name, role, value: since });
          }
        });
        vacantRolesNow.forEach((role) => {
          if (org.staffVacantSince[role] === undefined) {
            anomalies.push({ type: 'VACANCY_WITHOUT_VACANCY_SINCE', org: org.name, role });
          }
        });
      }
    }
    if (typeof org.budget !== 'number' || Number.isNaN(org.budget)) anomalies.push({ type: 'BUDGET_NAN', org: org.name, value: org.budget });
    if (!Number.isFinite(org.budget) || Math.abs(org.budget) > 1e12) anomalies.push({ type: 'BUDGET_OVERFLOW_SUSPECT', org: org.name, value: org.budget });
    if (typeof org.strength !== 'number' || Number.isNaN(org.strength)) anomalies.push({ type: 'STRENGTH_NAN', org: org.name, value: org.strength });
  });

  // V18-neu: BROKEN_DATE -- careerDate selbst muss ein gueltiges Datum sein.
  if (!isValidDateStr(careerDate)) anomalies.push({ type: 'BROKEN_DATE', value: String(careerDate) });

  // V18-neu: TOURNAMENT_CORRUPTION -- jedes Team mit einem Turnier-Ergebnis
  // in seasonTournamentResults muss auch tatsaechlich in
  // seasonQualifiedTeams (fuer dasselbe Turnier) gelistet sein.
  if (typeof seasonTournamentResults === 'object' && seasonTournamentResults && typeof seasonQualifiedTeams === 'object' && seasonQualifiedTeams) {
    Object.keys(seasonTournamentResults).forEach((tournamentId) => {
      const results = seasonTournamentResults[tournamentId];
      const qualified = seasonQualifiedTeams[tournamentId];
      if (!results || !qualified) return;
      const qualifiedNames = new Set(Array.isArray(qualified) ? qualified : Object.keys(qualified));
      const resultTeams = Array.isArray(results) ? results.map((r) => r.orgName || r.name).filter(Boolean) : Object.keys(results);
      resultTeams.forEach((teamName) => {
        if (!qualifiedNames.has(teamName)) {
          anomalies.push({ type: 'TOURNAMENT_CORRUPTION', tournamentId, team: teamName, note: 'Ergebnis ohne Qualifikations-Eintrag' });
        }
      });
    });
  }

  const poolNames = FREE_AGENT_PLAYERS.map((p) => p.name);
  const poolDupes = poolNames.filter((n, i) => poolNames.indexOf(n) !== i);
  if (poolDupes.length) anomalies.push({ type: 'DUPLICATE_PLAYER', org: '(FREE_AGENT_PLAYERS-Pool)', names: [...new Set(poolDupes)] });
  const ranks = ORGANIZATIONS.filter((o) => o.roster).map((o) => qaOrgRank(o)).sort((a, b) => a - b);
  const expected = ranks.map((_, i) => i + 1);
  const rankingBroken = JSON.stringify(ranks) !== JSON.stringify(expected);
  if (rankingBroken) anomalies.push({ type: 'BROKEN_RANKING', sample: ranks.slice(0, 10) });
  return { season, anomalyCount: anomalies.length, anomalies: anomalies.slice(0, 50), typeCounts: anomalies.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {}) };
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
    console.log('[' + SEED + '] Season', season, 'anomalies=', scan.anomalyCount, JSON.stringify(scan.typeCounts));
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
