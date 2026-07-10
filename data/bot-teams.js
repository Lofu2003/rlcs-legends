// Generiert einen zufälligen Bot-Gegner mit 3 Spielern — gleiche Stat-Achsen wie
// TEST_PLAYERS, damit dieselbe Duell-/Schusslogik (match.js) auf beide anwendbar ist.

// Bot-Team-Namen kommen jetzt aus derselben ORGANIZATIONS-Liste (data/
// organizations.js), aus der auch der Nutzer seine eigene Org wählt — echte
// RLCS-Organisationen, verifiziert über Liquipedia. Reine Namens-Verwendung,
// keine echten Team-Rosters/-Stärken abgebildet (siehe Disclaimer im
// Hauptmenü/KONZEPT.md). Welche Org der Nutzer selbst gewählt hat, darf kein
// Bot mehr tragen (siehe excludedOrgName in generateBotTeams()).

const BOT_PLAYER_NAME_POOL = [
  'Kade', 'Rin', 'Bexley', 'Torin', 'Isla', 'Cassian', 'Merit', 'Sonne',
  'Dax', 'Wren', 'Lior', 'Vance', 'Nyx', 'Pryce', 'Oaklyn',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateBotPlayer(usedNames) {
  let name;
  do {
    name = BOT_PLAYER_NAME_POOL[randomInt(0, BOT_PLAYER_NAME_POOL.length - 1)];
  } while (usedNames.has(name));
  usedNames.add(name);

  const stats = {
    mechanics: randomInt(60, 92),
    gameSense: randomInt(60, 92),
    speed: randomInt(60, 92),
    shooting: randomInt(60, 92),
    defending: randomInt(60, 92),
    boostMgmt: randomInt(60, 92),
  };
  const overall = Math.round(
    (stats.mechanics + stats.gameSense + stats.speed + stats.shooting + stats.defending + stats.boostMgmt) / 6
  );
  return { name, overall, ...stats };
}

// Erzeugt `count` Bot-Teams mit garantiert eindeutigen Namen (fürs Turnier) —
// solange count <= Anzahl der verfügbaren Orga-Namen. `excludedOrgName` ist
// die vom Nutzer selbst gewählte Org (siehe goToOrgSelection() in
// renderer.js) — die darf kein Bot-Team tragen.
//
// Nur die ersten CORE_RIVAL_COUNT Bot-Teams ("Kern-Rivalen") bekommen 2 der 3
// Rosterplätze mit ECHTEN Spielern aus TEST_PLAYERS besetzt (unter Vertrag bei
// dieser Bot-Org — User-Wunsch: "Spieler die bei anderen Teams sind sollen
// ausgegraut sein"). Grund für die Begrenzung: seit der vollen RLCS-Saison-
// struktur (Doppel-K.O.-Open-Bracket, 32 statt 16 Teams) braucht das Turnier
// deutlich mehr Bot-Teams als früher — würde JEDES davon 2 echte Spieler
// bekommen, bräuchte man weit mehr als die 48 vorhandenen echten Spieler.
// Die ursprünglichen 15 Kern-Rivalen behalten ihre 2 Vertragsspieler
// UNVERÄNDERT (Kader-/Vertrags-Ökonomie bleibt exakt wie vorher: 30 unter
// Vertrag, 18 frei) — alle zusätzlichen Bot-Teams (für das größere Open-
// Bracket-Feld) bekommen bewusst KEINE echten Vertragsspieler, nur generische
// Rollenspieler: sie sind im Wesentlichen "Kanonenfutter" der frühen Doppel-
// K.O.-Runden und werden selten für Transfermarkt/Verhandlungen relevant.
const REAL_PLAYERS_PER_BOT_TEAM = 2;
const CORE_RIVAL_COUNT = 15;

function generateBotTeams(count, excludedOrgName) {
  const availableNames = ORGANIZATIONS.map((o) => o.name).filter((n) => n !== excludedOrgName);
  const shuffledNames = availableNames.slice().sort(() => Math.random() - 0.5);
  const shuffledRealPlayers = TEST_PLAYERS.slice().sort(() => Math.random() - 0.5);
  const teams = [];
  for (let i = 0; i < count; i++) {
    const usedNames = new Set();
    const isCoreRival = i < CORE_RIVAL_COUNT;
    const contractedReal = isCoreRival
      ? shuffledRealPlayers.slice(i * REAL_PLAYERS_PER_BOT_TEAM, (i + 1) * REAL_PLAYERS_PER_BOT_TEAM).map((p) => ({ ...p }))
      : [];
    const fillers = [];
    for (let f = contractedReal.length; f < 3; f++) fillers.push(generateBotPlayer(usedNames));
    teams.push({
      name: shuffledNames[i % shuffledNames.length],
      players: [...contractedReal, ...fillers],
    });
  }
  return teams;
}

// ── Rivalitäten: Bot-Teams entwickeln sich über Saisons weiter ──────────────
// Statt bei jedem Turnier komplett neue Gegner zu würfeln, bleiben dieselben
// Bot-Orgs über eine ganze Karriere hinweg bestehen (generateBotTeams() wird
// nur EINMAL pro Karriere aufgerufen, siehe renderer.js careerBotTeams) — das
// macht wiederkehrende Gegner und eine Kopf-an-Kopf-Bilanz erst möglich.
// Zwischen den Saisons entwickeln sich auch die Bot-Spieler leicht weiter
// (kleinerer, ungerichteter Drift als beim eigenen Team — Bots haben keine
// Sieg-Quote-Bias, sie werden einfach zufällig etwas besser oder schlechter).
function developBotTeamPlayer(p) {
  const statKeys = ['mechanics', 'gameSense', 'speed', 'shooting', 'defending', 'boostMgmt'];
  const developed = { ...p };
  statKeys.forEach((k) => {
    const drift = Math.round(Math.random() * 6 - 3); // ±3
    developed[k] = Math.max(50, Math.min(95, p[k] + drift));
  });
  developed.overall = Math.round(statKeys.reduce((sum, k) => sum + developed[k], 0) / statKeys.length);
  return developed;
}

function developBotTeams(teams) {
  return teams.map((t) => ({ ...t, players: t.players.map(developBotTeamPlayer) }));
}
