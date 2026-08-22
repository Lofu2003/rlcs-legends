// Bot Ecosystem V17 -- erweiterter Chaos-Test (>=50 Saisons laut Auftrag).
// Baut auf chaos-run-v16.js auf (alle bisherigen Checks unveraendert) PLUS
// die vom V17-Auftrag explizit geforderten zusaetzlichen Pruefungen:
//   - DUPLICATE_STAFF (Namensdopplung unter Coach+Staff, analog DUPLICATE_PLAYER)
//   - GHOST_STAFF (Staff-Eintrag ohne vacant-Flag, aber ohne Name/Overall)
//   - VACANCY_SINCE_WITHOUT_VACANCY (staffVacantSince-Eintrag fuer eine
//     tatsaechlich BESETZTE Rolle -- Aufraeum-Leck)
//   - VACANCY_WITHOUT_VACANCY_SINCE (Rolle ist vakant, aber KEIN
//     staffVacantSince-Eintrag -- Tracking-Luecke)
//   - INVALID_ROLE (Staff-Rolle ausserhalb der bekannten 6 Nicht-Coach-Rollen)
// Nutzung: node chaos-run-v17.js <seed> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V17-CHAOS-A';
const OUT_FILE = process.argv[3] || path.join(__dirname, '_chaos_' + SEED + '.json');
const TARGET_SEASONS = parseInt(process.argv[4] || '50', 10);

function scanFn(season) {
  const anomalies = [];
  const nowSeason = careerState.seasonNumber;
  const KNOWN_STAFF_ROLES = ORG_ROSTER_STAFF_ROLES; // die 6 Nicht-Coach-Rollen
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
    });
    const names = active.map((p) => p.name).filter(Boolean);
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupeNames.length) anomalies.push({ type: 'DUPLICATE_PLAYER', org: org.name, names: [...new Set(dupeNames)] });

    // V16: rohe Struktur-Validitaet jedes Staff-Slots.
    (org.roster.staff || []).forEach((s, i) => {
      if (!s || (typeof s.role !== 'string') || (!s.vacant && typeof s.overall !== 'number')) {
        anomalies.push({ type: 'BROKEN_STAFF_SLOT', org: org.name, index: i, value: s ? JSON.stringify(s).slice(0, 100) : 'null' });
      }
    });
    // V17-neu: GHOST_STAFF -- Slot ohne vacant-Flag (also "besetzt"), aber ohne
    // gueltigen Namen (Ueberschneidung mit BROKEN_STAFF_SLOT ist bewusst,
    // beide Checks bleiben getrennt fuer die vom Auftrag explizit genannte
    // Kategorie "ghost staff").
    (org.roster.staff || []).forEach((s, i) => {
      if (s && !s.vacant && (!s.name || typeof s.name !== 'string')) {
        anomalies.push({ type: 'GHOST_STAFF', org: org.name, index: i, role: s.role });
      }
    });
    // V17-neu: DUPLICATE_STAFF -- Namensdopplung unter Coach + besetzten Staff-Slots.
    const staffNames = [org.roster.coach && org.roster.coach.name, ...((org.roster.staff || []).filter((s) => s && !s.vacant).map((s) => s.name))].filter(Boolean);
    const dupeStaffNames = staffNames.filter((n, i) => staffNames.indexOf(n) !== i);
    if (dupeStaffNames.length) anomalies.push({ type: 'DUPLICATE_STAFF', org: org.name, names: [...new Set(dupeStaffNames)] });
    // V17-neu: INVALID_ROLE -- Rolle eines Staff-Slots ist keine der 6 bekannten Rollen.
    (org.roster.staff || []).forEach((s, i) => {
      if (s && typeof s.role === 'string' && KNOWN_STAFF_ROLES.indexOf(s.role) === -1) {
        anomalies.push({ type: 'INVALID_ROLE', org: org.name, index: i, role: s.role });
      }
    });

    // V16: staffVacantSince muss immer ein Objekt mit nur nicht-negativen,
    // nicht-zukuenftigen Zahlenwerten sein.
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
          // V17-neu: staffVacantSince-Eintrag fuer eine Rolle, die JETZT
          // tatsaechlich besetzt ist -- Aufraeum-Leck (die Rolle haette beim
          // Fuellen aus staffVacantSince entfernt werden muessen).
          if (!vacantSetNow.has(role)) {
            anomalies.push({ type: 'VACANCY_SINCE_WITHOUT_VACANCY', org: org.name, role, value: since });
          }
        });
        // V17-neu: Rolle ist JETZT vakant, hat aber KEINEN staffVacantSince-
        // Eintrag -- Tracking-Luecke (sollte bei jedem Saison-Tick fuer jede
        // aktuell vakante Rolle gesetzt sein).
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
