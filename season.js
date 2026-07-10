// Mehrstufige RLCS-Saison-Struktur: 3 Open Qualifier -> Major (bei genug Punkten)
// -> Last Chance Qualifier ODER Direkt-Qualifikation -> Weltmeisterschaft.
// Reine Zustands-/Ablauflogik ohne DOM, analog zu tournament.js — nutzt dessen
// Engines (Doppel-K.O., Swiss, GSL, Playoffs) als Bausteine für jede Stufe.
//
// Feldgrößen (siehe Memory "Nachtrag-Runde 14" für die Begründung der
// Komprimierung ggü. echtem RLCS):
//   Open Qualifier (3x/Saison): 32 Teams -> Doppel-K.O. -> Top16 -> Swiss (Top8)
//     -> GSL 2x4er-Gruppen (Top4) -> Playoffs (Halbfinale+Finale, Bo7) -> Champion
//   Major: Top16 nach Open-Punkten -> Swiss (Top8) -> Playoffs (Top8, Bo7) -> Champion
//   Weltmeisterschaft: Top12 direkt qualifiziert + Top4 aus LCQ (8 Teams, Einzel-K.O.)
//     = 16 Teams -> GSL 4x4er-Gruppen (Top8) -> Playoffs (Top8, Bo7) -> Weltmeister

const OPEN_BRACKET_SIZE = 32;
const OPEN_BRACKET_CUTOFF = 16;   // nach Doppel-K.O.
const OPEN_SWISS_CUTOFF = 8;      // nach Swiss
const OPEN_GSL_CUTOFF = 4;        // nach GSL -> Halbfinale+Finale

const MAJOR_SIZE = 16;
const MAJOR_SWISS_CUTOFF = 8;

const WORLDS_DIRECT_QUALIFIERS = 12;
const WORLDS_LCQ_SIZE = 8;        // nimmt Ränge 13-20 der Saison-Punkte
const WORLDS_LCQ_SPOTS = 4;       // wie viele aus dem LCQ noch reinkommen
const WORLDS_SIZE = 16;           // 12 direkt + 4 aus LCQ
const WORLDS_GSL_CUTOFF = 8;

// Punkte-Tabellen (reine Spielwerte fürs Balancing, keine echten RLCS-Punkte).
const OPEN_POINTS = { champion: 100, runnerUp: 80, semifinalLoss: 60, gslElim: 35, swissElim: 15, bracketElim: 5 };
const MAJOR_POINTS = { champion: 300, runnerUp: 220, semifinalLoss: 160, quarterfinalLoss: 100, swissElim: 40 };

function initSeasonPoints(teams) {
  const points = {};
  teams.forEach((t) => { points[t.id] = 0; });
  return points;
}

function addPoints(pointsTable, teamId, amount) {
  pointsTable[teamId] = (pointsTable[teamId] || 0) + amount;
}

function rankTeamsByPoints(teams, pointsTable) {
  return teams.slice().sort((a, b) => (pointsTable[b.id] || 0) - (pointsTable[a.id] || 0));
}

// ── Ein einzelner Open Qualifier: Doppel-K.O. -> Swiss -> GSL -> Playoffs ───
function createOpenQualifier(teams) {
  return {
    stage: 'bracket', // 'bracket' -> 'swiss' -> 'gsl' -> 'playoffs' -> 'done'
    bracket: createDoubleElimEngine(teams),
    swiss: null,
    swissRound: 0,
    gslGroups: null,
    playoffs: null,
    champion: null,
    placements: {}, // teamId -> 'champion'|'runnerUp'|'semifinalLoss'|'gslElim'|'swissElim'|'bracketElim'
  };
}

function awardOpenPlacementPoints(open, pointsTable) {
  Object.keys(open.placements).forEach((teamId) => {
    addPoints(pointsTable, teamId, OPEN_POINTS[open.placements[teamId]] || 0);
  });
}

// Nach Abschluss der Doppel-K.O.-Stufe: eliminierte Teams bekommen 'bracketElim',
// die 16 Überlebenden gehen in die Swiss-Stufe.
function finalizeOpenBracketStage(open) {
  open.bracket.eliminated.forEach((t) => { open.placements[t.id] = 'bracketElim'; });
  open.swiss = createSwissEngine(open.bracket.qualified);
  pairRound(open.swiss, 1, SWISS_BEST_OF);
  open.stage = 'swiss';
}

function finalizeOpenSwissStage(open) {
  open.swiss.eliminated.forEach((t) => { open.placements[t.id] = 'swissElim'; });
  const top8 = rankQualifiedTeams(open.swiss.qualified);
  // GSL: 2 Mini-Gruppen à 4 (Top8 -> Top4). Seeding 1-4 in Gruppe A, 5-8 in Gruppe B,
  // jeweils 1v4/2v3 innerhalb der Gruppe (Standard-GSL-Seeding).
  const groupA = [top8[0], top8[3], top8[2], top8[1]]; // 1,4,3,2 -> match1=1v4, match2=3v2
  const groupB = [top8[4], top8[7], top8[6], top8[5]]; // 5,8,7,6
  open.gslGroups = [createGslGroup(groupA, SWISS_BEST_OF), createGslGroup(groupB, SWISS_BEST_OF)];
  open.stage = 'gsl';
}

function finalizeOpenGslStage(open) {
  open.gslGroups.forEach((g) => { g.eliminated.forEach((t) => { open.placements[t.id] = 'gslElim'; }); });
  const qualifiers = [...open.gslGroups[0].qualified, ...open.gslGroups[1].qualified];
  const seeded = rankByDiff(qualifiers); // grobe Seeding-Grundlage für die 4 Halbfinal-Teams
  open.playoffs = buildPlayoffSemifinalsOnly(seeded, PLAYOFF_BEST_OF);
  open.stage = 'playoffs';
}

function finalizeOpenPlayoffStage(open) {
  const { sf1, sf2 } = open.playoffs;
  const finalists = [winnerOf(open.bracket.allTeams, sf1), winnerOf(open.bracket.allTeams, sf2)];
  const semiLosers = [loserOf(open.bracket.allTeams, sf1), loserOf(open.bracket.allTeams, sf2)];
  semiLosers.forEach((t) => { open.placements[t.id] = 'semifinalLoss'; });
  open.playoffs.final = createSeriesMatch(finalists[0], finalists[1], PLAYOFF_BEST_OF);
}

function finalizeOpenChampion(open) {
  const champion = winnerOf(open.bracket.allTeams, open.playoffs.final);
  const runnerUp = loserOf(open.bracket.allTeams, open.playoffs.final);
  open.placements[champion.id] = 'champion';
  open.placements[runnerUp.id] = 'runnerUp';
  open.champion = champion;
  open.stage = 'done';
}

// ── Major: Swiss(16->8) -> Playoffs(8) — beides bestehende Engines ──────────
function createMajor(teams) {
  const swiss = createSwissEngine(teams);
  pairRound(swiss, 1, SWISS_BEST_OF);
  return { stage: 'swiss', swiss, allTeams: teams, playoffs: null, champion: null, placements: {} };
}

function finalizeMajorSwissStage(major) {
  major.swiss.eliminated.forEach((t) => { major.placements[t.id] = 'swissElim'; });
  const seeded = rankQualifiedTeams(major.swiss.qualified);
  major.playoffs = buildPlayoffQuarterfinals(seeded, PLAYOFF_BEST_OF);
  major.stage = 'playoffs-quarter';
}

function finalizeMajorQuarterfinals(major) {
  const { qf1, qf2, qf3, qf4 } = major.playoffs;
  [qf1, qf2, qf3, qf4].forEach((m) => { major.placements[loserOf(major.allTeams, m).id] = 'quarterfinalLoss'; });
  major.playoffs.sf1 = createSeriesMatch(winnerOf(major.allTeams, qf1), winnerOf(major.allTeams, qf2), PLAYOFF_BEST_OF);
  major.playoffs.sf2 = createSeriesMatch(winnerOf(major.allTeams, qf3), winnerOf(major.allTeams, qf4), PLAYOFF_BEST_OF);
  major.stage = 'playoffs-semi';
}

function finalizeMajorSemifinals(major) {
  const { sf1, sf2 } = major.playoffs;
  [sf1, sf2].forEach((m) => { major.placements[loserOf(major.allTeams, m).id] = 'semifinalLoss'; });
  major.playoffs.final = createSeriesMatch(winnerOf(major.allTeams, sf1), winnerOf(major.allTeams, sf2), PLAYOFF_BEST_OF);
  major.stage = 'playoffs-final';
}

function finalizeMajorChampion(major) {
  const champion = winnerOf(major.allTeams, major.playoffs.final);
  const runnerUp = loserOf(major.allTeams, major.playoffs.final);
  major.placements[champion.id] = 'champion';
  major.placements[runnerUp.id] = 'runnerUp';
  major.champion = champion;
  major.stage = 'done';
}

function awardMajorPlacementPoints(major, pointsTable) {
  Object.keys(major.placements).forEach((teamId) => {
    addPoints(pointsTable, teamId, MAJOR_POINTS[major.placements[teamId]] || 0);
  });
}

// ── Weltmeisterschaft-Qualifikation: Direkt oder Last Chance Qualifier ──────
// rankedByseasonPoints: ALLE Teams, die im Major waren, sortiert nach
// Saison-Punkten (Opens + Major zusammen).
function determineWorldsQualification(rankedBySeasonPoints) {
  const direct = rankedBySeasonPoints.slice(0, WORLDS_DIRECT_QUALIFIERS);
  const lcqPool = rankedBySeasonPoints.slice(WORLDS_DIRECT_QUALIFIERS, WORLDS_DIRECT_QUALIFIERS + WORLDS_LCQ_SIZE);
  return { direct, lcqPool };
}

// Baut das volle 8er-LCQ-Feld. Das Major-Feld ist komprimiert (16 statt der
// vollen Teamzahl), deshalb liefert determineWorldsQualification() bei einem
// 16er-Major-Feld nur 4 statt 8 LCQ-Kandidaten (Rang 13-16). Die restlichen
// Plätze werden bewusst als echte "Wildcard"-Chance an die bestplatzierten
// NICHT-Major-Teams aus dem vollen Open-Pool vergeben (Teams, die es zwar
// nicht ins Major geschafft, aber in den Opens gut abgeschnitten haben) —
// entspricht dem realen LCQ-Gedanken ("knapp vorbeigeschrammt"), nur dass die
// Definition von "knapp" wegen der kleineren Feldgröße etwas weiter gefasst
// werden muss.
function buildLcqField(allTeams, majorField, lcqPoolFromMajor, seasonPoints) {
  const nonMajorTeams = allTeams.filter((t) => !majorField.includes(t));
  const wildcardCount = WORLDS_LCQ_SIZE - lcqPoolFromMajor.length;
  const wildcards = rankTeamsByPoints(nonMajorTeams, seasonPoints).slice(0, wildcardCount);
  return [...lcqPoolFromMajor, ...wildcards];
}

// LCQ: einfaches Einzel-K.O. mit 8 Teams (bestehende Playoff-Engine, Top4
// erreichen die WM) — WORLDS_LCQ_SPOTS=4 entspricht den Playoff-Halbfinal-
// Verlierern UND dem Finale (2 Halbfinal-Sieger + 2 Halbfinal-Verlierer? Nein:
// hier zählt "die letzten 4 Teams stehend" = Halbfinal-Teilnehmer, siehe
// finalizeLcqSemifinal()). Bo5 statt Bo7, da LCQ nur ein einziger Tag ist.
function createLastChanceQualifier(teams) {
  const seeded = teams; // bereits nach Punkten sortiert hereingegeben
  return { stage: 'quarter', bracket: buildPlayoffQuarterfinals(seeded, SWISS_BEST_OF), allTeams: teams, qualifiedForWorlds: [] };
}

function finalizeLcqQuarterfinals(lcq) {
  const { qf1, qf2, qf3, qf4 } = lcq.bracket;
  lcq.bracket.sf1 = createSeriesMatch(winnerOf(lcq.allTeams, qf1), winnerOf(lcq.allTeams, qf2), SWISS_BEST_OF);
  lcq.bracket.sf2 = createSeriesMatch(winnerOf(lcq.allTeams, qf3), winnerOf(lcq.allTeams, qf4), SWISS_BEST_OF);
  lcq.stage = 'semi';
}

// Die 4 WORLDS_LCQ_SPOTS werden von den beiden Halbfinal-SIEGERN und den
// beiden Halbfinal-VERLIERERN gestellt (== "die letzten 4 Teams" nach den
// Viertelfinals) — im LCQ zählt nur noch "hast du es unter die letzten 4
// geschafft", nicht mehr Platzierung.
function finalizeLcqSemifinals(lcq) {
  const { sf1, sf2 } = lcq.bracket;
  lcq.qualifiedForWorlds = [
    winnerOf(lcq.allTeams, sf1), loserOf(lcq.allTeams, sf1),
    winnerOf(lcq.allTeams, sf2), loserOf(lcq.allTeams, sf2),
  ];
  lcq.stage = 'done';
}

// ── Weltmeisterschaft: GSL (4x 4er-Gruppen) -> Top8 -> Playoffs (bestehend) ──
function createWorldsGslStage(teams) {
  const groups = [];
  for (let i = 0; i < teams.length; i += 4) {
    groups.push(createGslGroup(teams.slice(i, i + 4), SWISS_BEST_OF));
  }
  return { stage: 'gsl', groups, allTeams: teams, playoffs: null, champion: null };
}

function finalizeWorldsGslStage(worlds) {
  const qualifiers = worlds.groups.flatMap((g) => g.qualified);
  const seeded = rankByDiff(qualifiers);
  worlds.playoffs = buildPlayoffQuarterfinals(seeded, PLAYOFF_BEST_OF);
  worlds.stage = 'playoffs-quarter';
}

function finalizeWorldsQuarterfinals(worlds) {
  const { qf1, qf2, qf3, qf4 } = worlds.playoffs;
  worlds.playoffs.sf1 = createSeriesMatch(winnerOf(worlds.allTeams, qf1), winnerOf(worlds.allTeams, qf2), PLAYOFF_BEST_OF);
  worlds.playoffs.sf2 = createSeriesMatch(winnerOf(worlds.allTeams, qf3), winnerOf(worlds.allTeams, qf4), PLAYOFF_BEST_OF);
  worlds.stage = 'playoffs-semi';
}

function finalizeWorldsSemifinals(worlds) {
  const { sf1, sf2 } = worlds.playoffs;
  worlds.playoffs.final = createSeriesMatch(winnerOf(worlds.allTeams, sf1), winnerOf(worlds.allTeams, sf2), PLAYOFF_BEST_OF);
  worlds.stage = 'playoffs-final';
}

function finalizeWorldsChampion(worlds) {
  worlds.champion = winnerOf(worlds.allTeams, worlds.playoffs.final);
  worlds.stage = 'done';
}
