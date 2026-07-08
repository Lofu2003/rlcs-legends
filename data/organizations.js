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

// pros/cons: mehrere Formulierungen pro Org — eine davon wird bei der Zuweisung
// (assignRandomOrg()) zufällig fest gewählt, damit dieselbe Org sich nicht bei
// jedem "Neues Spiel" gleich anfühlt, auch wenn man ihr öfter zugelost wird.
const ORGANIZATIONS_RAW = [
  {
    name: 'Vertex Esports',
    strength: 95,
    pros: [
      'Top-Trainingszentrum, große Sponsoren — maximales Budget.',
      'Modernste Analyse-Tools und ein Weltklasse-Trainerstab.',
      'Die Organisation mit dem größten Prestige der Liga.',
    ],
    cons: [
      'Hoher Erwartungsdruck von Fans und Management.',
      'Jede Enttäuschung wird sofort in den Medien zerrissen.',
      'Ungeduldiges Management — Geduld ist hier Mangelware.',
    ],
  },
  {
    name: 'Solace United',
    strength: 90,
    pros: [
      'Solides Budget, erfahrene Organisationsstruktur.',
      'Ruhige Hand im Management, wenig Panik bei Rückschlägen.',
      'Gutes Standing bei Sponsoren — verlässliche Finanzierung.',
    ],
    cons: [
      'Etwas konservative Kaderplanung erwartet.',
      'Wenig Toleranz für riskante Experimente im Draft.',
      'Bürokratische Abläufe bremsen schnelle Entscheidungen.',
    ],
  },
  {
    name: 'Ironclad Gaming',
    strength: 84,
    pros: [
      'Ausgeglichene Ausstattung, keine besonderen Nachteile.',
      'Stabiles Umfeld ohne große Altlasten.',
      'Weder Druck von oben noch Budgetsorgen — solides Mittelfeld.',
    ],
    cons: [
      'Keine besonderen Vorteile — Mittelmaß.',
      'Nichts, was dich von der Konkurrenz abhebt.',
      'Durchschnittlich in fast jeder Hinsicht.',
    ],
  },
  {
    name: 'Nimbus Rivals',
    strength: 78,
    pros: [
      'Junge, hungrige Organisation mit Aufstiegsambitionen.',
      'Flexibles Management, offen für ungewöhnliche Kaderideen.',
      'Wachsende Fanbase, die an einen Aufstieg glaubt.',
    ],
    cons: [
      'Eingeschränktes Budget für den Kader.',
      'Wenig Erfahrung im Umgang mit Drucksituationen.',
      'Noch kein etablierter Name in der Szene.',
    ],
  },
  {
    name: 'Fracture Point',
    strength: 72,
    pros: [
      'Kleine Organisation — großer Underdog-Bonus im Narrativ.',
      'Niemand erwartet hier etwas — Freiheit, Risiken einzugehen.',
      'Eng verschworene Truppe ohne internen Konkurrenzdruck.',
    ],
    cons: [
      'Knappes Budget, wenig Spielraum für Stars.',
      'Kaum Rücklagen für Fehlentscheidungen im Draft.',
      'Muss sich jede Aufmerksamkeit hart erarbeiten.',
    ],
  },
  {
    name: 'Starline Underdogs',
    strength: 66,
    pros: [
      'Nichts zu verlieren — jede Überraschung zählt doppelt.',
      'Reinste Außenseiter-Story — jeder Sieg wird gefeiert.',
      'Kompromisslose Experimentierfreude, da ohnehin nichts erwartet wird.',
    ],
    cons: [
      'Sehr knappes Budget, schwierigster Start.',
      'Praktisch keine finanzielle Rückendeckung.',
      'Muss von Anfang an über die eigenen Verhältnisse hinauswachsen.',
    ],
  },
];

const ORGANIZATIONS = ORGANIZATIONS_RAW.map((org) => ({
  ...org,
  budget: computeOrgBudget(org.strength),
  matchBonusPct: computeMatchBonusPct(org.strength),
}));

function pickRandomOrgFlavor(list) { return list[Math.floor(Math.random() * list.length)]; }

function assignRandomOrg() {
  const org = ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
  return {
    ...org,
    pro: pickRandomOrgFlavor(org.pros),
    con: pickRandomOrgFlavor(org.cons),
  };
}
