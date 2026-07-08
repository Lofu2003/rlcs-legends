// Generiert einen zufälligen Bot-Gegner mit 3 Spielern — gleiche Stat-Achsen wie
// TEST_PLAYERS, damit dieselbe Duell-/Schusslogik (match.js) auf beide anwendbar ist.

const BOT_TEAM_NAMES = [
  'Crimson Wolves', 'Static Frontier', 'Aurora Drift', 'Nightfall Circuit',
  'Iron Comet', 'Velocity Union', 'Pale Horizon', 'Rogue Signal',
];

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

function generateBotTeam() {
  const usedNames = new Set();
  return {
    name: BOT_TEAM_NAMES[randomInt(0, BOT_TEAM_NAMES.length - 1)],
    players: [generateBotPlayer(usedNames), generateBotPlayer(usedNames), generateBotPlayer(usedNames)],
  };
}

// Erzeugt `count` Bot-Teams mit garantiert eindeutigen Namen (fürs Turnier) —
// solange count <= Anzahl der Namen im Pool.
function generateBotTeams(count) {
  const shuffledNames = BOT_TEAM_NAMES.slice().sort(() => Math.random() - 0.5);
  const teams = [];
  for (let i = 0; i < count; i++) {
    const usedNames = new Set();
    teams.push({
      name: shuffledNames[i % shuffledNames.length],
      players: [generateBotPlayer(usedNames), generateBotPlayer(usedNames), generateBotPlayer(usedNames)],
    });
  }
  return teams;
}
