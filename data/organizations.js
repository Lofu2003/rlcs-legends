// Organisationen — werden dem Spieler zufällig zugewiesen (nicht wählbar).
// Stärke (0-100) bestimmt Budget UND einen späteren Match-Bonus/-Malus
// (matchBonusPct wird erst in der Match-Simulation ausgewertet, noch nicht aktiv).
//
// Budget-Formel: 650 (Basis bei Stärke 84) + (Stärke - 84) * 15, auf 10er gerundet.
// Match-Bonus:   (Stärke - 84) * 0.4 Prozentpunkte.

function computeOrgBudget(strength) {
  return Math.round((650 + (strength - 84) * 15) / 10) * 10;
}

function computeMatchBonusPct(strength) {
  return Math.round((strength - 84) * 0.4 * 10) / 10;
}

const ORGANIZATIONS_RAW = [
  {
    name: 'Vertex Esports',
    strength: 95,
    pro: 'Top-Trainingszentrum, große Sponsoren — maximales Budget.',
    con: 'Hoher Erwartungsdruck von Fans und Management.',
  },
  {
    name: 'Solace United',
    strength: 90,
    pro: 'Solides Budget, erfahrene Organisationsstruktur.',
    con: 'Etwas konservative Kaderplanung erwartet.',
  },
  {
    name: 'Ironclad Gaming',
    strength: 84,
    pro: 'Ausgeglichene Ausstattung, keine besonderen Nachteile.',
    con: 'Keine besonderen Vorteile — Mittelmaß.',
  },
  {
    name: 'Nimbus Rivals',
    strength: 78,
    pro: 'Junge, hungrige Organisation mit Aufstiegsambitionen.',
    con: 'Eingeschränktes Budget für den Kader.',
  },
  {
    name: 'Fracture Point',
    strength: 72,
    pro: 'Kleine Organisation — großer Underdog-Bonus im Narrativ.',
    con: 'Knappes Budget, wenig Spielraum für Stars.',
  },
  {
    name: 'Starline Underdogs',
    strength: 66,
    pro: 'Nichts zu verlieren — jede Überraschung zählt doppelt.',
    con: 'Sehr knappes Budget, schwierigster Start.',
  },
];

const ORGANIZATIONS = ORGANIZATIONS_RAW.map((org) => ({
  ...org,
  budget: computeOrgBudget(org.strength),
  matchBonusPct: computeMatchBonusPct(org.strength),
}));

function assignRandomOrg() {
  return ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
}
