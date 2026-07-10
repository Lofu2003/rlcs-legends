// Organisationen — echte RLCS-Orgas (aktuell + historisch), verifiziert über
// Liquipedia (Portal:Teams, Team-Einzelseiten, RLCS-History-Seite), nicht aus
// dem Gedächtnis geraten. Strength/Budget/Pros/Cons sind reine Spielwerte für
// das Balancing, KEINE echte Einschätzung der realen Organisationen (siehe
// Disclaimer im Hauptmenü/KONZEPT.md).
//
// User-Wunsch: statt zufälliger Zuweisung wählt man seine Org jetzt selbst aus
// einem Menü (siehe renderer.js goToOrgSelection()). Eine gewählte Org darf
// danach kein Bot-Team mehr tragen (siehe data/bot-teams.js).
//
// Budget-Formel: 650 (Basis bei Stärke 84) + (Stärke - 84) * 15, auf 10er gerundet.
// Match-Bonus:   (Stärke - 84) * 0.4 Prozentpunkte.

function computeOrgBudget(strength) {
  return Math.round((650 + (strength - 84) * 15) / 10) * 10;
}

function computeMatchBonusPct(strength) {
  return Math.round((strength - 84) * 0.4 * 10) / 10;
}

// pros/cons: mehrere Formulierungen pro Org — eine davon wird bei der Auswahl
// zufällig fest gewählt, damit sich dieselbe Org nicht bei jeder Karriere
// exakt gleich anfühlt.
const STRONG_ORG_PROS = [
  'Top-Trainingszentrum, große Sponsoren — maximales Budget.',
  'Modernste Analyse-Tools und ein Weltklasse-Trainerstab.',
  'Eine der prestigeträchtigsten Organisationen der Szene.',
];
const STRONG_ORG_CONS = [
  'Hoher Erwartungsdruck von Fans und Management.',
  'Jede Enttäuschung wird sofort in den Medien zerrissen.',
  'Ungeduldiges Management — Geduld ist hier Mangelware.',
];
const MID_ORG_PROS = [
  'Solides Budget, erfahrene Organisationsstruktur.',
  'Ruhige Hand im Management, wenig Panik bei Rückschlägen.',
  'Gutes Standing bei Sponsoren — verlässliche Finanzierung.',
];
const MID_ORG_CONS = [
  'Etwas konservative Kaderplanung erwartet.',
  'Wenig Toleranz für riskante Experimente im Draft.',
  'Bürokratische Abläufe bremsen schnelle Entscheidungen.',
];
const BALANCED_ORG_PROS = [
  'Ausgeglichene Ausstattung, keine besonderen Nachteile.',
  'Stabiles Umfeld ohne große Altlasten.',
  'Weder Druck von oben noch Budgetsorgen — solides Mittelfeld.',
];
const BALANCED_ORG_CONS = [
  'Keine besonderen Vorteile — Mittelmaß.',
  'Nichts, was dich von der Konkurrenz abhebt.',
  'Durchschnittlich in fast jeder Hinsicht.',
];
const UNDERDOG_ORG_PROS = [
  'Junge, hungrige Organisation mit Aufstiegsambitionen.',
  'Flexibles Management, offen für ungewöhnliche Kaderideen.',
  'Wachsende Fanbase, die an einen Aufstieg glaubt.',
];
const UNDERDOG_ORG_CONS = [
  'Eingeschränktes Budget für den Kader.',
  'Wenig Erfahrung im Umgang mit Drucksituationen.',
  'Noch kein etablierter Name auf höchstem Niveau.',
];
const LEGACY_ORG_PROS = [
  'Traditionsreicher Name mit langer RLCS-Geschichte.',
  'Erfahrene Strukturen aus vergangenen goldenen Zeiten.',
  'Loyale, altgediente Fanbase steht hinter der Organisation.',
];
const LEGACY_ORG_CONS = [
  'Seit Jahren nicht mehr an der absoluten Spitze.',
  'Muss sich den Ruf vergangener Erfolge erst zurückerarbeiten.',
  'Knappere Budgets als in den besten Jahren der Organisation.',
];

// name + strength (0-100, reiner Spielwert) — Auswahl an Pro/Con-Pools folgt
// weiter unten aus der Stärke-Kategorie.
const ORGANIZATIONS_RAW = [
  // Aktuell aktive Top-Orgas
  { name: 'Team Vitality', strength: 96 },
  { name: 'Karmine Corp', strength: 94 },
  { name: 'NRG', strength: 93 },
  { name: 'Team Falcons', strength: 91 },
  { name: 'FURIA', strength: 88 },
  { name: 'Gen.G Mobil1 Racing', strength: 87 },
  { name: 'Spacestation Gaming', strength: 85 },
  { name: 'Dignitas', strength: 84 },
  { name: 'Twisted Minds', strength: 83 },
  { name: 'Gentle Mates', strength: 82 },
  { name: 'Ninjas in Pyjamas', strength: 80 },
  { name: 'Moist Esports', strength: 78 },
  { name: 'Endpoint', strength: 77 },
  { name: 'GameWard', strength: 75 },
  { name: 'NOVO Esports', strength: 74 },
  { name: 'The Bricks', strength: 72 },
  { name: 'Lilmix', strength: 70 },
  { name: 'Bonk!', strength: 68 },
  // Historische Orgas (verifiziert über Liquipedia) — seit Jahren ohne
  // aktuellen Spitzenerfolg, aber als Traditionsorgas spielbar.
  { name: 'Cloud9', strength: 79 },
  { name: 'G2 Esports', strength: 76 },
  { name: 'Renegades', strength: 73 },
  { name: 'Rogue', strength: 71 },
  { name: 'Ghost Gaming', strength: 69 },
  { name: 'PSG Esports', strength: 67 },
  { name: 'iBUYPOWER', strength: 66 },
  { name: 'FlipSid3 Tactics', strength: 66 },
  { name: 'Northern Gaming', strength: 66 },
  { name: 'Kings of Urban', strength: 66 },
  { name: 'Mock-It Esports', strength: 66 },
  { name: 'Chiefs Esports Club', strength: 66 },
  { name: 'Evil Geniuses', strength: 74 },
  { name: 'Complexity Gaming', strength: 71 },
  { name: 'Envy', strength: 69 },
  { name: 'OpTic Gaming', strength: 73 },
  { name: 'Splyce', strength: 67 },
  { name: 'Selfless Gaming', strength: 66 },
  { name: 'We Dem Girlz', strength: 66 },
];

function orgFlavorPool(strength) {
  if (strength >= 90) return { pros: STRONG_ORG_PROS, cons: STRONG_ORG_CONS };
  if (strength >= 82) return { pros: MID_ORG_PROS, cons: MID_ORG_CONS };
  if (strength >= 78) return { pros: BALANCED_ORG_PROS, cons: BALANCED_ORG_CONS };
  if (strength >= 72) return { pros: UNDERDOG_ORG_PROS, cons: UNDERDOG_ORG_CONS };
  return { pros: LEGACY_ORG_PROS, cons: LEGACY_ORG_CONS };
}

const ORGANIZATIONS = ORGANIZATIONS_RAW.map((org) => {
  const flavor = orgFlavorPool(org.strength);
  return {
    ...org,
    budget: computeOrgBudget(org.strength),
    matchBonusPct: computeMatchBonusPct(org.strength),
    pros: flavor.pros,
    cons: flavor.cons,
  };
});

function pickRandomOrgFlavor(list) { return list[Math.floor(Math.random() * list.length)]; }

function findOrgByName(name) {
  return ORGANIZATIONS.find((o) => o.name === name) || null;
}

// Baut eine konkrete, fest gewählte Org-Instanz (mit einer festen Pro/Con-
// Zeile) — für die Auswahlmenü-Vorschau UND die finale Bestätigung.
function instantiateOrg(org) {
  return { ...org, pro: pickRandomOrgFlavor(org.pros), con: pickRandomOrgFlavor(org.cons) };
}

// Nicht mehr im Karriere-Modus verwendet (User-Wunsch: Auswahlmenü statt
// Zufalls-Slotmachine) — bleibt für den späteren Randomizer-Challenge-Modus
// erhalten, der genau diese Zufallszuweisung nutzen soll.
function assignRandomOrg() {
  const org = ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
  return instantiateOrg(org);
}
