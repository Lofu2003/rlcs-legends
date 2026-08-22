// Bot Ecosystem V17 -- Einzelprozess-Performance-Vergleich OLD vs. NEW fuer
// BEIDE V17-Fixes (Rollen-Auswahl-Restrukturierung in
// scoreBotStaffRecoveryHire() + Personal-Markt-Pool-Rescale in
// ensureStaffMarketPopulation()). NEW laedt den aktuellen Code unveraendert.
// OLD monkey-patcht beide Funktionen mit einer vollstaendigen Reimplementation
// des exakten Vor-V17-Verhaltens (Einzel-Prioritaets-Auswahl-dann-Pruefung
// bzw. MIN=20/BATCH=8) -- fair, weil beide Pfade ansonsten identische echte
// Spiel-Operationen durchlaufen (dieselbe Saison-Simulation, derselbe Seed).
// Nutzung: node phase-perf-v17.js <OLD|NEW> <seed> <seasons>
const { createHeadlessGame } = require('./headless-runner');

const MODE = process.argv[2] || 'NEW';
const SEED = process.argv[3] || 'V17-PERF';
const SEASONS = parseInt(process.argv[4] || '10', 10);

function patchOldFn() {
  // OLD ensureStaffMarketPopulation: identische Struktur, aber MIN=20/BATCH=8
  // (Stand vor V17 Fix 2) statt der aktuellen 80/32-Konstanten.
  ensureStaffMarketPopulation = function (role) {
    const OLD_MIN = 20, OLD_BATCH = 8;
    const isCoach = role === 'Coach';
    const pool = isCoach ? FREE_AGENT_COACHES : (FREE_AGENT_STAFF[role] || (FREE_AGENT_STAFF[role] = []));
    const signedNames = new Set([...signedFreeAgentStaff].filter((k) => k.startsWith(role + '::')).map((k) => k.slice((role + '::').length)));
    const availableCount = pool.filter((p) => !signedNames.has(p.name)).length;
    if (availableCount >= OLD_MIN) return 0;
    const usedNames = new Set(pool.map((p) => p.name));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const genName = () => (isCoach
      ? pick(ROSTER_NICK_PREFIXES) + pick(ROSTER_NICK_SUFFIXES)
      : (Math.random() < 0.5 ? pick(ROSTER_STAFF_FIRST_NAMES_M) : pick(ROSTER_STAFF_FIRST_NAMES_F)) + ' ' + pick(ROSTER_STAFF_LAST_NAMES));
    const genOverall = () => (isCoach ? Math.round(44 + Math.random() * 46) : Math.round(50 + Math.random() * 45));
    const genCoachStats = (targetOverall) => {
      const stats = {};
      PLAYER_STAT_KEYS.forEach((k) => { stats[k] = Math.max(1, Math.min(99, Math.round(targetOverall + (Math.random() * 2 - 1) * 4))); });
      const overall = Math.round(PLAYER_STAT_KEYS.reduce((s, k) => s + stats[k], 0) / PLAYER_STAT_KEYS.length);
      return { stats, overall };
    };
    let added = 0;
    for (let i = 0; i < OLD_BATCH; i++) {
      let name; let guard = 0;
      do { name = genName(); guard += 1; } while (usedNames.has(name) && guard < 40);
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      if (isCoach) { const rolled = genCoachStats(genOverall()); pool.push({ name, overall: rolled.overall, ...rolled.stats }); }
      else { pool.push({ name, overall: genOverall() }); }
      added += 1;
    }
    return added;
  };

  // OLD scoreBotStaffRecoveryHire: identisches Dauer-Tracking-Preamble (das
  // ist reine Buchhaltung, kein Teil des Fix-1-Verhaltens), aber die
  // Vor-V17-Einzel-Prioritaets-Auswahl (EINE Rolle waehlen -> NUR DEREN Pool/
  // Preis pruefen -> bei Nichteignung sofort aufgeben) statt der Alle-Rollen-
  // Suche.
  scoreBotStaffRecoveryHire = function (org) {
    const roster = org.roster;
    if (!roster) return null;
    const filledRoles = new Set((roster.staff || []).filter((s) => s && !s.vacant).map((s) => s.role));
    const vacantRoles = ORG_ROSTER_STAFF_ROLES.filter((role) => !filledRoles.has(role));
    if (!roster.coach) vacantRoles.unshift('Coach');
    if (vacantRoles.length === 0) return null;
    if (!org.staffVacantSince) org.staffVacantSince = {};
    const nowSeason = careerState.seasonNumber;
    const vacantSet = new Set(vacantRoles);
    Object.keys(org.staffVacantSince).forEach((r) => { if (!vacantSet.has(r)) delete org.staffVacantSince[r]; });
    vacantRoles.forEach((r) => { if (typeof org.staffVacantSince[r] !== 'number' || !Number.isFinite(org.staffVacantSince[r])) org.staffVacantSince[r] = nowSeason; });
    const activePlayers = [...(roster.starters || []), roster.sub].filter(Boolean);
    const playerAvg = activePlayers.length ? activePlayers.reduce((s, p) => s + p.overall, 0) / activePlayers.length : 0;
    const priority = [];
    if (playerAvg < 45) priority.push('Coach', 'Scout');
    if (org.financeStatus === 'INSOLVENT') priority.push('Finanzvorstand');
    if (computeTeamMorale(org) < 45) priority.push('Psychologe');
    priority.push('Coach', 'Scout', 'Finanzvorstand', 'Analyst', 'Psychologe', 'Physiotherapeut', 'PR-Manager');
    const role = priority.find((r) => vacantRoles.includes(r)) || vacantRoles[0];
    const pool = freeAgentPersonnelPool(role).filter((p) => !signedFreeAgentStaff.has(role + '::' + p.name));
    if (pool.length === 0) return null;
    const cheapest = pool.reduce((min, p) => (calculatePlayerTransferValue(p) < calculatePlayerTransferValue(min) ? p : min));
    const price = calculatePlayerTransferValue(cheapest);
    const investBudget = botAvailableInvestmentBudget(org);
    if (price > investBudget || price > org.budget) return null;
    const isRecoveryContext = ensureBotOrgGoal(org) === 'DEEP_REBUILD' && org.financeStatus !== 'HEALTHY';
    const vacancyDuration = nowSeason - (org.staffVacantSince[role] !== undefined ? org.staffVacantSince[role] : nowSeason);
    const durationBonus = Math.min(45, vacancyDuration * 3);
    const countBonus = (vacantRoles.length - 1) * 8;
    const score = (role === 'Coach' ? 75 : 55) + durationBonus + countBonus;
    return {
      label: 'HIRE_STAFF', score, reason: (isRecoveryContext ? 'Recovery: v' : 'V') + 'akante Rolle ' + role + ' (seit ' + vacancyDuration + ' Saison(en) offen) günstig mit ' + cheapest.name + ' (' + cheapest.overall + ') besetzt.',
      execute: () => {
        const replacement = renameIfCollision(signFreeAgentPersonnel(role, cheapest, careerDate), orgExistingStaffNames(org), false);
        delete org.staffVacantSince[role];
        if (role === 'Coach') { roster.coach = replacement; }
        else { const idx = (roster.staff || []).findIndex((s) => s.role === role); if (idx !== -1) roster.staff[idx] = replacement; else { roster.staff = roster.staff || []; roster.staff.push(replacement); } }
        signedFreeAgentStaff.add(role + '::' + cheapest.name);
        const qaInfo = botEconomyDebugTelemetryEnabled ? { role, reason: isRecoveryContext ? 'STAFF_RECOVERY_HIRE' : 'STAFF_VACANCY_FILL', overall: cheapest.overall } : null;
        logTransfer('Free Agent', org.name, replacement.name, price, qaInfo);
        applyBotBudgetChange(org, 'staff_hire', -price, (isRecoveryContext ? 'Recovery-Einstellung' : 'Nachbesetzung') + ': ' + replacement.name + ' (' + role + ')');
        org.strength = computeOrgStrengthFromRoster(roster);
      },
    };
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
