// Turnier-Logik: echtes Swiss-Bracket-Format (wie bei Major-Turnieren / Lykon Regional
// Grid) statt fixer Runden-Anzahl für alle. Reine Zustands-/Paarungs-Logik ohne DOM.
//
// Struktur bei 8 Teams:
//   R1  (0-0):  4 Spiele, alle Teams zufällig gepaart
//   R2W (1-0):  2 Spiele — Gewinner von R1 gegeneinander
//   R2L (0-1):  2 Spiele — Verlierer von R1 gegeneinander
//     -> Gewinner von R2W = 2-0 = SOFORT QUALIFIZIERT (kein 3. Spiel nötig)
//     -> Verlierer von R2L = 0-2 = SOFORT ELIMINIERT
//     -> Verlierer von R2W + Gewinner von R2L = 1-1 = gehen in die Decider-Runde
//   R3  (1-1 Decider): 2 Spiele — Gewinner = 2-1 QUALIFIZIERT, Verlierer = 1-2 ELIMINIERT
//   Playoffs: die 4 Qualifizierten (2x 2-0, 2x 2-1), geseedet nach Tordifferenz —
//             SF1 = #1 vs #4, SF2 = #2 vs #3, dann Finale.
//
// Jedes einzelne Match ist eine Serie: Swiss-Stage = Bo5, Playoffs = Bo7.

const SWISS_BEST_OF = 5;
const PLAYOFF_BEST_OF = 7;

function createTournamentTeam(id, name, isPlayer, players, sub, coach) {
  return {
    id, name, isPlayer,
    players, sub: sub || null, coach: coach || null,
    wins: 0, losses: 0, scoreFor: 0, scoreAgainst: 0,
  };
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function scoreDiff(team) { return team.scoreFor - team.scoreAgainst; }

// Sortiert eine Gruppe von Teams (gleicher Rekord) nach Tordifferenz — für Seeding.
function rankByDiff(teams) {
  return teams.slice().sort((a, b) => scoreDiff(b) - scoreDiff(a));
}

// Ein "Match" ist jetzt eine BEST-OF-N-SERIE aus Einzelspielen (Swiss = Bo5,
// Playoffs = Bo7 — wie bei echten RLCS-Turnieren). scoreA/scoreB spiegeln den
// SERIEN-Stand (gewonnene Einzelspiele), nicht Tore eines einzelnen Spiels —
// dadurch funktionieren winnerOf/loserOf/Bracket-Anzeige unverändert weiter.
function seriesTargetWins(bestOf) { return Math.ceil(bestOf / 2); } // Bo5 -> 3, Bo7 -> 4

function createSeriesMatch(teamA, teamB, bestOf) {
  return {
    aId: teamA.id, bId: teamB.id, bestOf,
    games: [], seriesWinsA: 0, seriesWinsB: 0,
    played: false, scoreA: 0, scoreB: 0,
  };
}

// Paart eine Gruppe (2 oder 4 Teams) zufällig in 1 bzw. 2 Serien.
function pairGroup(teams, bestOf) {
  const shuffled = shuffleArray(teams);
  const matches = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    matches.push(createSeriesMatch(shuffled[i], shuffled[i + 1], bestOf));
  }
  return matches;
}

// Trägt EIN Einzelspiel-Ergebnis (Tore) in die Serie ein. Tor-Summen fließen
// SOFORT in team.scoreFor/scoreAgainst ein (feinere Tordifferenz-Grundlage
// fürs Playoff-Seeding als nur der Serien-Endstand). team.wins/losses werden
// erst EINMALIG gezählt, sobald die Serie durch Erreichen der Ziel-Sieganzahl
// entschieden ist (match.played wird dann true).
function recordSeriesGame(teams, match, goalsA, goalsB) {
  const teamA = teams.find((t) => t.id === match.aId);
  const teamB = teams.find((t) => t.id === match.bId);

  match.games.push({ goalsA, goalsB });
  teamA.scoreFor += goalsA; teamA.scoreAgainst += goalsB;
  teamB.scoreFor += goalsB; teamB.scoreAgainst += goalsA;

  if (goalsA > goalsB) match.seriesWinsA += 1; else match.seriesWinsB += 1;
  match.scoreA = match.seriesWinsA;
  match.scoreB = match.seriesWinsB;

  const target = seriesTargetWins(match.bestOf);
  if (match.seriesWinsA >= target || match.seriesWinsB >= target) {
    match.played = true;
    if (match.seriesWinsA > match.seriesWinsB) { teamA.wins += 1; teamB.losses += 1; }
    else { teamB.wins += 1; teamA.losses += 1; }
  }
}

// Simuliert eine komplette Serie sofort ohne Ticker (Bot-vs-Bot-Matches).
function simulateFullSeriesInstant(teams, match, simulateMatchFn) {
  const teamA = teams.find((t) => t.id === match.aId);
  const teamB = teams.find((t) => t.id === match.bId);
  while (!match.played) {
    const r = simulateMatchFn(teamA.players, teamB.players, teamA.name, teamB.name, {});
    recordSeriesGame(teams, match, r.scoreA, r.scoreB);
  }
}

function winnerOf(teams, match) {
  if (!match || !match.played) return null;
  const id = match.scoreA > match.scoreB ? match.aId : match.bId;
  return teams.find((t) => t.id === id);
}

function loserOf(teams, match) {
  if (!match || !match.played) return null;
  const id = match.scoreA > match.scoreB ? match.bId : match.aId;
  return teams.find((t) => t.id === id);
}

// Baut die Playoff-Seeding-Liste [#1, #2, #3, #4] aus den 2-0- und 2-1-Qualifizierten.
function seedPlayoffs(qual20, qual21) {
  const rankedTop = rankByDiff(qual20);   // #1, #2
  const rankedBottom = rankByDiff(qual21); // #3, #4
  return [...rankedTop, ...rankedBottom];
}
