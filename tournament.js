// Turnier-Logik: echtes Swiss-Bracket-Format wie bei Major-Turnieren (Valve-Stil,
// 16 Teams, erster-auf-3-Siege/3-Niederlagen). Reine Zustands-/Paarungs-Logik ohne DOM.
//
// GENERALISIERTE Engine statt hartkodierter Felder pro Runde — funktioniert für
// beliebige Teamanzahl (Zweierpotenz) und beliebige WINS_TARGET/LOSSES_TARGET:
// Teams werden in "Record-Gruppen" (Schlüssel "W-L", z.B. "2-1") verwaltet. Jede
// Runde werden alle Gruppen gepaart, deren Teams noch genau (Runde-1) Spiele
// gespielt haben und deren Record noch nicht terminal ist (WINS_TARGET oder
// LOSSES_TARGET erreicht). Nach der Runde wandern Gewinner/Verlierer in die
// jeweils nächste Gruppe, oder werden qualifiziert/eliminiert falls terminal.
//
// Bei 16 Teams (WINS_TARGET=3, LOSSES_TARGET=3) ergibt das 5 Runden:
//   R1 (0-0, 16 Teams)  -> R2 (1-0/0-1, je 8) -> R3 (2-0/1-1/0-2, 4/8/4)
//   -> R4 (2-1/1-2, je 6) -> R5 (2-2, 6 Teams)
//   Terminal/qualifiziert: 3-0, 3-1, 3-2 (macht 2+3+3 = 8 Qualifizierte)
//   Terminal/eliminiert:   0-3, 1-3, 2-3
// Playoffs: 8 Qualifizierte, geseedet nach (weniger Niederlagen zuerst, dann
// Tordifferenz) -> Viertelfinale -> Halbfinale -> Finale (Standard-Bracket-
// Seeding, #1 und #2 treffen sich frühestens im Finale).
//
// Jedes einzelne Match ist eine Serie: Swiss-Stage = Bo5, Playoffs = Bo7.

const SWISS_BEST_OF = 5;
const PLAYOFF_BEST_OF = 7;
const WINS_TARGET = 3;
const LOSSES_TARGET = 3;

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

// ── Generalisierte Swiss-Engine ──────────────────────────────────────────────

function createSwissEngine(teams) {
  return {
    allTeams: teams,
    groups: { '0-0': { teams: teams.slice(), matches: null } },
    qualified: [],
    eliminated: [],
  };
}

function recordGamesPlayed(record) {
  const parts = record.split('-').map(Number);
  return parts[0] + parts[1];
}

function isTerminalRecord(record) {
  const parts = record.split('-').map(Number);
  return parts[0] >= WINS_TARGET || parts[1] >= LOSSES_TARGET;
}

// Liefert alle Record-Gruppen, die in dieser Runde gepaart werden (Teams haben
// genau Runde-1 Spiele gespielt, Record ist noch nicht terminal, Gruppe existiert
// bereits — d.h. es sind Teams reingewandert).
function activeGroupsForRound(engine, round) {
  return Object.keys(engine.groups).filter((record) => {
    const group = engine.groups[record];
    return group.teams && group.teams.length > 0
      && recordGamesPlayed(record) === round - 1
      && !isTerminalRecord(record);
  });
}

// Paart alle noch ungepaarten Gruppen der aktuellen Runde (idempotent — bereits
// gepaarte Gruppen werden nicht nochmal gepaart).
function pairRound(engine, round, bestOf) {
  activeGroupsForRound(engine, round).forEach((record) => {
    const group = engine.groups[record];
    if (!group.matches) group.matches = pairGroup(group.teams, bestOf);
  });
}

function getRoundMatches(engine, round) {
  return activeGroupsForRound(engine, round).flatMap((record) => engine.groups[record].matches || []);
}

function isRoundComplete(engine, round) {
  const matches = getRoundMatches(engine, round);
  return matches.length > 0 && matches.every((m) => m.played);
}

// Trägt Gewinner/Verlierer aller Gruppen der aktuellen Runde in die jeweils
// nächste Gruppe ein (oder markiert sie als qualifiziert/eliminiert, falls der
// neue Record terminal ist). Muss erst aufgerufen werden, wenn isRoundComplete()
// true ist.
function advanceRound(engine, round) {
  activeGroupsForRound(engine, round).forEach((record) => {
    const parts = record.split('-').map(Number);
    const w = parts[0], l = parts[1];
    const group = engine.groups[record];
    const winners = group.matches.map((m) => winnerOf(engine.allTeams, m));
    const losers = group.matches.map((m) => loserOf(engine.allTeams, m));

    const winRecord = (w + 1) + '-' + l;
    const lossRecord = w + '-' + (l + 1);

    // Gruppe IMMER anlegen/befüllen (auch wenn der Record terminal ist) — sonst
    // fehlen frisch qualifizierte/eliminierte Teams in der Bracket-Anzeige, die
    // ausschließlich über engine.groups liest. qualified/eliminated bleiben
    // zusätzlich die kompakte Liste fürs Playoff-Seeding bzw. den Endstand.
    if (!engine.groups[winRecord]) engine.groups[winRecord] = { teams: [], matches: null };
    engine.groups[winRecord].teams.push(...winners);
    if (w + 1 >= WINS_TARGET) engine.qualified.push(...winners);

    if (!engine.groups[lossRecord]) engine.groups[lossRecord] = { teams: [], matches: null };
    engine.groups[lossRecord].teams.push(...losers);
    if (l + 1 >= LOSSES_TARGET) engine.eliminated.push(...losers);
  });
}

// Ist die gesamte Swiss-Stage fertig (alle Teams qualifiziert oder eliminiert)?
function isSwissComplete(engine, totalTeams) {
  return engine.qualified.length + engine.eliminated.length === totalTeams;
}

// Rankt die qualifizierten Teams für die Playoff-Seeding: weniger Niederlagen
// zuerst (3-0 vor 3-1 vor 3-2), innerhalb desselben Records nach Tordifferenz.
function rankQualifiedTeams(qualified) {
  return qualified.slice().sort((a, b) => {
    if (a.losses !== b.losses) return a.losses - b.losses;
    return scoreDiff(b) - scoreDiff(a);
  });
}

// Baut das 8er-Playoff-Viertelfinale mit Standard-Bracket-Seeding (#1 und #2
// treffen sich frühestens im Finale): QF1=1v8, QF2=4v5, QF3=3v6, QF4=2v7 —
// SF1 = Sieger(QF1) vs Sieger(QF2), SF2 = Sieger(QF3) vs Sieger(QF4).
function buildPlayoffQuarterfinals(seeded, bestOf) {
  return {
    qf1: createSeriesMatch(seeded[0], seeded[7], bestOf),
    qf2: createSeriesMatch(seeded[3], seeded[4], bestOf),
    qf3: createSeriesMatch(seeded[2], seeded[5], bestOf),
    qf4: createSeriesMatch(seeded[1], seeded[6], bestOf),
  };
}

// Baut ein 4er-Playoff-Halbfinale (kleinere Variante derselben Bracket-
// Seeding-Idee — genutzt, wenn eine Turnierstufe nur 4 statt 8 Qualifizierte
// hervorbringt, z.B. nach den komprimierten GSL-Gruppen der Open Qualifier,
// siehe KONZEPT/Memory): SF1=1v4, SF2=2v3.
function buildPlayoffSemifinalsOnly(seeded, bestOf) {
  return {
    sf1: createSeriesMatch(seeded[0], seeded[3], bestOf),
    sf2: createSeriesMatch(seeded[1], seeded[2], bestOf),
  };
}

// ── Doppel-K.O.-Bracket (Open Qualifier, Tag 1-2) ────────────────────────────
// Jedes Team hat 2 Leben (LOSSES_TARGET=2 wie beim "echten" Doppel-K.O.). Statt
// eines klassischen Winners-/Losers-Bracket-Baums (feste Bracket-Pfade) nutzt
// diese Engine dieselbe Record-Gruppen-Idee wie die Swiss-Engine oben (Teams
// mit gleichem Loss-Stand spielen gegeneinander) — funktional identisch zu
// "2 Leben, bei 2 Niederlagen raus", nur mit zufälliger statt fest-verseedeter
// Paarung pro Runde. Es gibt bewusst KEIN Sieg-Ziel (WINS_TARGET) — das Feld
// wird stattdessen so lange gespielt, bis genau `cutoffSize` Teams mit weniger
// als 2 Niederlagen übrig sind (siehe finalizeDoubleElimCutoff()); die spielen
// dann in der nächsten Stufe (Swiss) weiter.
const OPEN_BRACKET_LOSSES_TARGET = 2;

function createDoubleElimEngine(teams) {
  return {
    allTeams: teams,
    groups: { '0': { teams: teams.slice(), matches: null } }, // Schlüssel = Anzahl Niederlagen
    eliminated: [],
    qualified: [], // wird erst von finalizeDoubleElimCutoff() befüllt
    cutoffReached: false,
  };
}

// Eine Gruppe (alle Teams mit demselben Loss-Stand) ist "zu paaren", solange
// sie noch Teams enthält, ihr Loss-Stand noch nicht das Elimination-Limit
// erreicht hat, und sie diese Runde noch nicht gepaart wurde.
function doubleElimGroupsToPair(engine) {
  return Object.keys(engine.groups).filter((lossKey) => {
    const group = engine.groups[lossKey];
    return group.teams && group.teams.length > 0 && Number(lossKey) < OPEN_BRACKET_LOSSES_TARGET && !group.matches;
  });
}

function pairDoubleElimRound(engine, bestOf) {
  doubleElimGroupsToPair(engine).forEach((lossKey) => {
    const group = engine.groups[lossKey];
    group.matches = pairGroup(group.teams, bestOf);
  });
}

function getDoubleElimRoundMatches(engine) {
  return Object.keys(engine.groups)
    .filter((lossKey) => engine.groups[lossKey].matches)
    .flatMap((lossKey) => engine.groups[lossKey].matches);
}

function isDoubleElimRoundComplete(engine) {
  const matches = getDoubleElimRoundMatches(engine);
  return matches.length > 0 && matches.every((m) => m.played);
}

// Trägt Gewinner (bleiben bei gleichem Loss-Stand) und Verlierer (Loss-Stand
// +1, ggf. eliminiert) der aktuellen Runde ein.
//
// WICHTIG (Bug-Fix, 2 Anläufe gebraucht): Sieger, die bei lossKey X bleiben,
// UND Verlierer, die von lossKey (X-1) NEU nach X hereinwandern, landen BEIDE
// in derselben Ziel-Gruppe X — wenn man das mit "group.teams = winners" (für
// die eigene Gruppe) UND "group.teams.push(...losers)" (von der Nachbar-
// gruppe aus) mischt, hängt das Ergebnis von der Objektschlüssel-Reihenfolge
// im forEach ab: wird "= winners" NACH dem Push ausgeführt, überschreibt es
// die gerade hereingewanderten Verlierer wieder (beobachtet: 24 Teams -> nur
// 6 statt 15 Überlebende nach Runde 3). Sauberer Fix: ALLES, was nach dieser
// Runde in Gruppe X landet (eigene Sieger + hereingewanderte Verlierer), erst
// in einer temporären `incoming`-Map SAMMELN (Phase 1, nur lesen/sammeln),
// und JEDEN Gruppen-Teams-Array erst am Ende GENAU EINMAL zuweisen (Phase 2)
// — keine Mischung aus Zuweisung und Push auf denselben Ziel-Array mehr.
function advanceDoubleElimRound(engine) {
  const pendingLossKeys = Object.keys(engine.groups).filter((lossKey) => engine.groups[lossKey].matches);
  const incoming = {}; // lossKey -> Array der Teams, die NACH dieser Runde dort stehen
  const newlyEliminated = [];

  pendingLossKeys.forEach((lossKey) => {
    const group = engine.groups[lossKey];
    const losses = Number(lossKey);
    const winners = group.matches.map((m) => winnerOf(engine.allTeams, m));
    const losers = group.matches.map((m) => loserOf(engine.allTeams, m));

    if (!incoming[lossKey]) incoming[lossKey] = [];
    incoming[lossKey].push(...winners);

    const newLossKey = String(losses + 1);
    if (losses + 1 >= OPEN_BRACKET_LOSSES_TARGET) {
      newlyEliminated.push(...losers);
    } else {
      if (!incoming[newLossKey]) incoming[newLossKey] = [];
      incoming[newLossKey].push(...losers);
    }
  });

  pendingLossKeys.forEach((lossKey) => { engine.groups[lossKey].matches = null; });
  Object.keys(incoming).forEach((lossKey) => {
    if (!engine.groups[lossKey]) engine.groups[lossKey] = { teams: [], matches: null };
    engine.groups[lossKey].teams = incoming[lossKey];
  });
  engine.eliminated.push(...newlyEliminated);
}

// Anzahl aktuell noch nicht eliminierter Teams (0 oder 1 Niederlage).
function doubleElimSurvivorCount(engine) {
  return engine.allTeams.length - engine.eliminated.length;
}

// Sobald genau `cutoffSize` (oder weniger) Teams übrig sind, wird das Feld
// eingefroren: alle verbliebenen Teams gelten als qualifiziert für die
// nächste Stufe (Swiss) — unabhängig von ihrem genauen Loss-Stand (0 oder 1).
function finalizeDoubleElimCutoff(engine, cutoffSize) {
  if (doubleElimSurvivorCount(engine) > cutoffSize) return false;
  const survivors = [];
  Object.keys(engine.groups).forEach((lossKey) => {
    if (Number(lossKey) < OPEN_BRACKET_LOSSES_TARGET) survivors.push(...engine.groups[lossKey].teams);
  });
  engine.qualified = survivors;
  engine.cutoffReached = true;
  return true;
}

// ── GSL-Mini-Gruppe (Tag 4) ───────────────────────────────────────────────
// Klassisches GSL-Format (4 Teams, 2 Leben): Match1 (A-B), Match2 (C-D),
// Winners-Match (Sieger(M1) vs Sieger(M2)) -> Sieger = 1. Platz/qualifiziert,
// Losers-Match (Verlierer(M1) vs Verlierer(M2)) -> Verlierer = eliminiert,
// Decider (Verlierer(Winners-Match) vs Sieger(Losers-Match)) -> Sieger =
// 2. Platz/qualifiziert, Verlierer = eliminiert. 2 Teams pro Mini-Gruppe
// qualifizieren sich, 2 werden eliminiert.
function createGslGroup(teams, bestOf) {
  return {
    teams, bestOf,
    match1: createSeriesMatch(teams[0], teams[1], bestOf),
    match2: createSeriesMatch(teams[2], teams[3], bestOf),
    winnersMatch: null,
    losersMatch: null,
    deciderMatch: null,
    qualified: [],
    eliminated: [],
  };
}

// Muss nach JEDEM in der Gruppe gespielten Match aufgerufen werden — baut die
// jeweils nächste Begegnung auf, sobald ihre Voraussetzungen (Vorgänger-
// Matches gespielt) erfüllt sind, und befüllt qualified/eliminated sobald der
// jeweilige Zweig entschieden ist.
function advanceGslGroup(allTeams, group) {
  if (group.match1.played && group.match2.played && !group.winnersMatch) {
    group.winnersMatch = createSeriesMatch(winnerOf(allTeams, group.match1), winnerOf(allTeams, group.match2), group.bestOf);
    group.losersMatch = createSeriesMatch(loserOf(allTeams, group.match1), loserOf(allTeams, group.match2), group.bestOf);
  }
  if (group.winnersMatch && group.winnersMatch.played && group.qualified.length === 0) {
    group.qualified.push(winnerOf(allTeams, group.winnersMatch));
  }
  if (group.losersMatch && group.losersMatch.played && group.eliminated.length === 0) {
    group.eliminated.push(loserOf(allTeams, group.losersMatch));
  }
  if (group.winnersMatch && group.losersMatch && group.winnersMatch.played && group.losersMatch.played && !group.deciderMatch) {
    group.deciderMatch = createSeriesMatch(loserOf(allTeams, group.winnersMatch), winnerOf(allTeams, group.losersMatch), group.bestOf);
  }
  if (group.deciderMatch && group.deciderMatch.played && group.qualified.length === 1) {
    group.qualified.push(winnerOf(allTeams, group.deciderMatch));
    group.eliminated.push(loserOf(allTeams, group.deciderMatch));
  }
}

function isGslGroupComplete(group) {
  return group.qualified.length === 2 && group.eliminated.length === 2;
}

// Liefert alle aktuell offenen (gespielten, aber noch nicht ausgewerteten)
// Matches einer GSL-Gruppe, in Reihenfolge — für UI/Turnier-Fortschritt.
function getGslGroupPendingMatches(group) {
  const matches = [group.match1, group.match2];
  if (group.winnersMatch) matches.push(group.winnersMatch);
  if (group.losersMatch) matches.push(group.losersMatch);
  if (group.deciderMatch) matches.push(group.deciderMatch);
  return matches.filter((m) => !m.played);
}
