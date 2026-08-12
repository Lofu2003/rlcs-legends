// Feste Start-Kader pro Org (User-Wunsch: "echter Startkader" statt freiem
// Draft aus dem leeren Nichts — siehe confirmOrgAndProceed() in renderer.js).
// Jede Org bekommt DETERMINISTISCH (per Org-Namen geseedet, kein Math.random())
// 3 Starter + 1 Sub + 1 Coach + 8 Team-Mitarbeiter zugewiesen — bei jedem
// Programmstart exakt dieselben Personen für dieselbe Org ("feste" Zuordnung,
// keine Zufalls-Neuwürfelung). Namen sind frei erfunden (wie schon die
// Bot-Rollenspieler in bot-teams.js und die Zufalls-Charakternamen in
// character-traits.js) — KEINE echten Personen, anders als der separate,
// recherchierte TEST_PLAYERS-Pool (echte RLCS-Profis) für den freien
// Transfermarkt/Draft-Pool.
//
// Muss NACH character-traits.js (CHARACTER_NATIONS/CHARACTER_AVATARS) und
// pricing.js (calculatePrice) geladen werden, aber VOR organizations.js
// (das generateOrgRoster() beim Aufbau von ORGANIZATIONS aufruft) — siehe
// <script>-Reihenfolge in index.html.

// Die 8 Mitarbeiter-Rollen OHNE Geschäftsführer (der ist immer der selbst
// erstellte Charakter des Spielers, siehe renderer.js ORG_PREVIEW_STAFF_ROLES/
// renderOrgPreview) — einzige Quelle der Wahrheit für diese Liste.
// Bug-Fix/Zusammenlegung (User-Meldung: "Coach und Trainer sind dasselbe,
// eines davon entfernen"): 'Trainer' war früher eine eigene der 9 Rollen hier
// (4 Attribute fitness/trainingsplanung/motivation/geduld, eigener
// Entwicklungsbonus). User-Entscheidung: Coach bleibt (eigener Slot, echte
// Statachsen über rollPlayer(), war schon für den Match-Bonus zuständig) --
// Trainer entfällt komplett, sein Entwicklungsbonus wandert zu Coach (siehe
// coachDevelopmentBonusPct() in renderer.js, vorher trainerDevelopmentBonusPct()).
const ORG_ROSTER_STAFF_ROLES = [
  'Scout', 'Analyst', 'Finanzvorstand', 'Anwalt',
  'Event-Manager', 'PR-Manager', 'Psychologe', 'Physiotherapeut',
];

// Personal-Seite (Runde: "Personal"-Dashboard): jede der 8 Rollen bekommt ihre
// EIGENEN, thematisch passenden Fähigkeits-Attribute statt der 6 Spieler-
// Statachsen (mechanics/gameSense/... würden für einen Anwalt keinen Sinn
// ergeben) -- analog zu STAT_LABELS/PLAYER_STAT_KEYS bei Spielern, aber
// rollenspezifisch. "Coach" (roster.coach) ist NICHT hier drin -- der wird
// weiterhin über rollPlayer() erzeugt und hat schon echte Statachsen (siehe
// resolvePersonByIdentity() in renderer.js, Rolle 'Coach' wird dort separat
// behandelt). Werte 45-95, gleiche Skala wie Spieler-Stats.
const STAFF_ROLE_ATTRIBUTES = {
  'Scout': ['talentgespuer', 'netzwerk', 'datenanalyse', 'verhandlung'],
  'Analyst': ['datenanalyse', 'gegnervorbereitung', 'praezision', 'kommunikation'],
  'Finanzvorstand': ['verhandlung', 'budgetplanung', 'risikomanagement', 'marktkenntnis'],
  'Anwalt': ['vertragswissen', 'verhandlung', 'diskretion', 'reaktionsschnelligkeit'],
  'Event-Manager': ['organisation', 'kreativitaet', 'netzwerk', 'stressresistenz'],
  'PR-Manager': ['kommunikation', 'kreativitaet', 'netzwerk', 'krisenmanagement'],
  'Psychologe': ['empathie', 'kommunikation', 'erfahrung', 'diskretion'],
  'Physiotherapeut': ['medizinwissen', 'praezision', 'erfahrung', 'geduld'],
};
const STAFF_ATTRIBUTE_LABELS = {
  geduld: 'Geduld',
  talentgespuer: 'Talentgespür', netzwerk: 'Netzwerk', datenanalyse: 'Datenanalyse', verhandlung: 'Verhandlungsgeschick',
  gegnervorbereitung: 'Gegner-Vorbereitung', praezision: 'Präzision', kommunikation: 'Kommunikation',
  budgetplanung: 'Budgetplanung', risikomanagement: 'Risikomanagement', marktkenntnis: 'Marktkenntnis',
  vertragswissen: 'Vertragswissen', diskretion: 'Diskretion', reaktionsschnelligkeit: 'Reaktionsschnelligkeit',
  organisation: 'Organisation', kreativitaet: 'Kreativität', stressresistenz: 'Stressresistenz',
  krisenmanagement: 'Krisenmanagement', empathie: 'Empathie', erfahrung: 'Erfahrung', medizinwissen: 'Medizinwissen',
};

// Streut die rollenspezifischen Attribute um targetOverall (gleiches Prinzip
// wie rollPlayer()s Statachsen-Streuung um targetOverall, nur mit größerer
// Spanne ±8 statt ±4, da hier nur 4 statt 6 Achsen gemittelt werden). rng ist
// austauschbar (echte Org-Generierung nutzt die deterministische Seed-Funktion,
// Bot-Ersatz/Free-Agent-Hydration nutzen Math.random, siehe Aufrufstellen).
function generateStaffAttributes(role, targetOverall, rng) {
  const keys = STAFF_ROLE_ATTRIBUTES[role];
  if (!keys) return {};
  const attrs = {};
  keys.forEach((key) => {
    const v = targetOverall + (rng() * 2 - 1) * 8;
    attrs[key] = Math.max(45, Math.min(95, Math.round(v)));
  });
  return attrs;
}

const ROSTER_NICK_PREFIXES = [
  'Ruby', 'Shadow', 'Nova', 'Frost', 'Blaze', 'Zero', 'Volt', 'Echo', 'Phantom', 'Apex',
  'Nitro', 'Cobalt', 'Ember', 'Rogue', 'Vertex', 'Onyx', 'Cipher', 'Drift', 'Lunar', 'Static',
  'Crimson', 'Glacier', 'Havoc', 'Iron',
];
const ROSTER_NICK_SUFFIXES = [
  'Ghost', 'Strike', 'Wolf', 'Storm', 'King', 'Prime', 'Rex', 'Byte', 'Falcon', 'Nova',
  'Blade', 'Reign', 'Fury', 'Pulse', 'Shift', 'Wing', 'Cross', 'Flare', 'Grip', 'Dash',
  'Vortex', 'Spark', 'Ridge', 'Talon',
];
const ROSTER_STAFF_FIRST_NAMES_M = [
  'Samuel', 'Lukas', 'Finn', 'Paul', 'Jonas', 'Max', 'Leon', 'Tim', 'Elias', 'Noah',
  'David', 'Simon', 'Felix', 'Jan', 'Marco',
];
const ROSTER_STAFF_FIRST_NAMES_F = [
  'Sophie', 'Marie', 'Laura', 'Emma', 'Julia', 'Lena', 'Anna', 'Nina', 'Mia', 'Lea',
  'Sarah', 'Clara', 'Hannah', 'Vera', 'Nora',
];
const ROSTER_STAFF_LAST_NAMES = [
  'Torres', 'Weber', 'Hoffmann', 'Berger', 'Kessler', 'Nilsson', 'Dubois', 'Rossi', 'Novak', 'Andersen',
  'Keller', 'Fischer', 'Moreau', 'Larsen', 'Bianchi',
];

// Echte/verifizierte Spieler- und Team-Mitarbeiter-Namen pro Org, aus der
// vom User bereitgestellten Datenbank (datenbank-spieler-rlcs-legend-v2.txt)
// -- ersetzt die zuvor rein zufällig erzeugten Fantasienamen für Starter/Coach/
// die 7 in der Datenbank vorhandenen Mitarbeiter-Rollen. "Analyst" kommt in
// der Datenbank NICHT vor -- bleibt für diese Rolle weiterhin prozedural
// generiert (siehe generateOrgRoster() unten). Sub-Spieler (4.
// Kaderspieler) hat ebenfalls kein DB-Äquivalent (nur 3 "Spieler" pro Team in
// der Datenbank) und bleibt daher auch weiterhin prozedural generiert.
// Geschäftsführer aus der Datenbank wird bewusst NICHT übernommen -- diese Rolle
// ist im Spiel immer der selbst erstellte Charakter des Spielers (siehe
// ORG_PREVIEW_STAFF_ROLES/renderOrgPreview() in renderer.js).
const ORG_REAL_ROSTER_NAMES = {
  "25 Shot Club": { players: ["Sypical", "Chicago", "Caard"], coach: "Jahzo", staff: { "Finanzvorstand": "Gabriel Hernandez", "PR-Manager": "Sven Miller", "Psychologe": "Dominik Smith", "Scout": "Morgan Taylor", "Anwalt": "Francis Dupont", "Event-Manager": "Chris Jones", "Physiotherapeut": "Gabriel Martinez" } },
  "445": { players: ["Chronic", "caleb", "Metsanauris"], coach: "Jahzo", staff: { "Finanzvorstand": "Chris Smith", "PR-Manager": "Francis Anderson", "Psychologe": "Pierre Taylor", "Scout": "Dominik Smith", "Anwalt": "Sven Martinez", "Event-Manager": "Arthur Jones", "Physiotherapeut": "Dominik Williams" } },
  "77Blocks": { players: ["Caard", "Sypical", "Dread"], coach: "Satthew", staff: { "Finanzvorstand": "Lucas Müller", "PR-Manager": "Skyler Anderson", "Psychologe": "Jamie Lopez", "Scout": "Chris Smith", "Anwalt": "Morgan Miller", "Event-Manager": "Arthur Hernandez", "Physiotherapeut": "Casey Silva" } },
  "BS+COMPETITION": { players: ["Retals", "Archie", "kaka"], coach: "Chrome", staff: { "Finanzvorstand": "Chris Lopez", "PR-Manager": "Dominik Garcia", "Psychologe": "Lucas Dupont", "Scout": "Sven Davis", "Anwalt": "Alex Dupont", "Event-Manager": "Gabriel Thomas", "Physiotherapeut": "Skyler Thomas" } },
  "BTF Esports": { players: ["BeastMode", "MajicBear", "Caard"], coach: "Chrome", staff: { "Finanzvorstand": "Arthur Johnson", "PR-Manager": "Ryan Taylor", "Psychologe": "Sam Garcia", "Scout": "Robin Wilson", "Anwalt": "Alex Miller", "Event-Manager": "Gabriel Thomas", "Physiotherapeut": "Taylor Lopez" } },
  "Bonk!": { players: ["Retals", "Superlachie", "Atow"], coach: "Fireburner", staff: { "Finanzvorstand": "Casey Müller", "PR-Manager": "Taylor Brown", "Psychologe": "Sven Davis", "Scout": "Chris Johnson", "Anwalt": "Arthur Williams", "Event-Manager": "David Gonzalez", "Physiotherapeut": "Jamie Davis" } },
  "Canterbury-Bankstown Bulldogs": { players: ["carca", "kamz", "Satthew"], coach: "Sizz", staff: { "Finanzvorstand": "Jordan Davis", "PR-Manager": "Dominik Martinez", "Psychologe": "David Müller", "Scout": "Marc Thomas", "Anwalt": "Chris Lopez", "Event-Manager": "Marc Lopez", "Physiotherapeut": "Taylor Hernandez" } },
  "Chiefs Esports Club": { players: ["Metsanauris", "Torsos", "carca"], coach: "Ferra", staff: { "Finanzvorstand": "Dominik Jones", "PR-Manager": "Jamie Martinez", "Psychologe": "Arthur Rodriguez", "Scout": "Skyler Rodriguez", "Anwalt": "Lucas Silva", "Event-Manager": "Robin Brown", "Physiotherapeut": "Robin Hernandez" } },
  "Cloud9": { players: ["Torsos", "Metsanauris", "kamz"], coach: "Jahzo", staff: { "Finanzvorstand": "Francis Jones", "PR-Manager": "Jordan Smith", "Psychologe": "Ryan Smith", "Scout": "Casey Johnson", "Anwalt": "Chris Thomas", "Event-Manager": "Lucas Garcia", "Physiotherapeut": "Morgan Taylor" } },
  "Complexity Gaming": { players: ["Joreuz", "Retals", "caleb"], coach: "RawGregory", staff: { "Finanzvorstand": "Gabriel Müller", "PR-Manager": "Sam Müller", "Psychologe": "Ryan Thomas", "Scout": "Pierre Smith", "Anwalt": "Arthur Miller", "Event-Manager": "David Jones", "Physiotherapeut": "Jamie Lopez" } },
  "Dangerous Esports Club": { players: ["Turo", "AppJack", "Amphis"], coach: "Eversax", staff: { "Finanzvorstand": "Morgan Davis", "PR-Manager": "Ryan Thomas", "Psychologe": "Dominik Dupont", "Scout": "Morgan Thomas", "Anwalt": "Gabriel Martinez", "Event-Manager": "Dominik Johnson", "Physiotherapeut": "Marc Rodriguez" } },
  "Death Cloud Esports": { players: ["Comm", "EyeIgnite", "Scream"], coach: "Ferra", staff: { "Finanzvorstand": "David Anderson", "PR-Manager": "Pierre Dupont", "Psychologe": "Jamie Jones", "Scout": "Sven Silva", "Anwalt": "Lucas Williams", "Event-Manager": "Alex Müller", "Physiotherapeut": "Jordan Miller" } },
  "Deleted Gaming": { players: ["N1tro", "Remkoe", "Archie"], coach: "Eversax", staff: { "Finanzvorstand": "Pierre Jones", "PR-Manager": "Gabriel Johnson", "Psychologe": "Lucas Garcia", "Scout": "Skyler Smith", "Anwalt": "Jamie Anderson", "Event-Manager": "Sam Lopez", "Physiotherapeut": "Gabriel Miller" } },
  "Dignitas": { players: ["crr", "caleb", "noly"], coach: "Satthew", staff: { "Finanzvorstand": "Casey Martinez", "PR-Manager": "Gabriel Jones", "Psychologe": "Pierre Dupont", "Scout": "Gabriel Thomas", "Anwalt": "Skyler Brown", "Event-Manager": "Casey Garcia", "Physiotherapeut": "Taylor Miller" } },
  "Endpoint": { players: ["Metsanauris", "Remkoe", "kamz"], coach: "Chrome", staff: { "Finanzvorstand": "Gabriel Müller", "PR-Manager": "Taylor Thomas", "Psychologe": "Sam Jones", "Scout": "Arthur Hernandez", "Anwalt": "Marc Martinez", "Event-Manager": "Lucas Miller", "Physiotherapeut": "Jamie Thomas" } },
  "Enisorail": { players: ["Markydooda", "CaioTG1", "Hntr"], coach: "Jahzo", staff: { "Finanzvorstand": "Francis Rodriguez", "PR-Manager": "Casey Silva", "Psychologe": "Skyler Brown", "Scout": "Pierre Johnson", "Anwalt": "Morgan Gonzalez", "Event-Manager": "Gabriel Thomas", "Physiotherapeut": "Gabriel Taylor" } },
  "Envy": { players: ["Rizzo", "carca", "ayyjayy"], coach: "Ferra", staff: { "Finanzvorstand": "Jamie Brown", "PR-Manager": "Robin Gonzalez", "Psychologe": "Arthur Garcia", "Scout": "Chris Thomas", "Anwalt": "Dominik Rodriguez", "Event-Manager": "Jamie Müller", "Physiotherapeut": "Sam Rodriguez" } },
  "Evil Geniuses": { players: ["crr", "Firstkiller", "N1tro"], coach: "RawGregory", staff: { "Finanzvorstand": "Morgan Lopez", "PR-Manager": "Morgan Johnson", "Psychologe": "Lucas Müller", "Scout": "Ryan Müller", "Anwalt": "Jordan Davis", "Event-Manager": "Marc Martinez", "Physiotherapeut": "Skyler Müller" } },
  "FIZ6 Gaming": { players: ["Caard", "hockser", "caleb"], coach: "Chrome", staff: { "Finanzvorstand": "Francis Wilson", "PR-Manager": "Jamie Lopez", "Psychologe": "Jordan Müller", "Scout": "Jamie Dupont", "Anwalt": "Pierre Taylor", "Event-Manager": "Lucas Thomas", "Physiotherapeut": "Casey Wilson" } },
  "FURIA": { players: ["yanxnz", "Lostt", "Drufinho"], coach: "Kairos", staff: { "Finanzvorstand": "Roberto Silva", "PR-Manager": "Camila Souza", "Psychologe": "Dr. Fernando Costa", "Scout": "Lucas Oliveira", "Anwalt": "Santos & Partners", "Event-Manager": "Beatriz Lima", "Physiotherapeut": "Ricardo Mendes" } },
  "FUT Esports": { players: ["Superlachie", "Rizzo", "hockser"], coach: "Sizz", staff: { "Finanzvorstand": "Chris Jones", "PR-Manager": "Sam Davis", "Psychologe": "Gabriel Anderson", "Scout": "Gabriel Jones", "Anwalt": "Sam Müller", "Event-Manager": "Robin Davis", "Physiotherapeut": "Sam Wilson" } },
  "Five Fears": { players: ["Fever", "Firstkiller", "Cheese"], coach: "Eversax", staff: { "Finanzvorstand": "Arthur Davis", "PR-Manager": "Chris Garcia", "Psychologe": "Gabriel Garcia", "Scout": "Chris Taylor", "Anwalt": "Francis Davis", "Event-Manager": "Pierre Wilson", "Physiotherapeut": "Dominik Thomas" } },
  "FlipSid3 Tactics": { players: ["Satthew", "Comm", "AppJack"], coach: "Sizz", staff: { "Finanzvorstand": "Morgan Johnson", "PR-Manager": "Francis Martinez", "Psychologe": "Dominik Martinez", "Scout": "Arthur Johnson", "Anwalt": "Chris Williams", "Event-Manager": "Marc Johnson", "Physiotherapeut": "Alex Smith" } },
  "G2 Esports": { players: ["Acronik", "Atow", "Oaly"], coach: "Fireburner", staff: { "Finanzvorstand": "David Rodriguez", "PR-Manager": "Robin Davis", "Psychologe": "Morgan Davis", "Scout": "David Miller", "Anwalt": "Arthur Müller", "Event-Manager": "Sam Davis", "Physiotherapeut": "Robin Silva" } },
  "GameWard": { players: ["M1k3rules", "Bananahead", "Torsos"], coach: "RawGregory", staff: { "Finanzvorstand": "Jordan Jones", "PR-Manager": "Pierre Müller", "Psychologe": "Ryan Miller", "Scout": "Taylor Garcia", "Anwalt": "Robin Silva", "Event-Manager": "David Hernandez", "Physiotherapeut": "Taylor Martinez" } },
  "Gen.G Mobil1 Racing": { players: ["hockser", "BeastMode", "Firstkiller"], coach: "Ferra", staff: { "Finanzvorstand": "Jordan Smith", "PR-Manager": "Ryan Jones", "Psychologe": "Arthur Brown", "Scout": "Casey Lopez", "Anwalt": "Alex Williams", "Event-Manager": "Robin Garcia", "Physiotherapeut": "Ryan Davis" } },
  "Gentle Mates": { players: ["Superlachie", "AppJack", "crr"], coach: "Sizz", staff: { "Finanzvorstand": "Chris Miller", "PR-Manager": "Sven Davis", "Psychologe": "Jamie Anderson", "Scout": "Ryan Hernandez", "Anwalt": "Morgan Taylor", "Event-Manager": "Dominik Anderson", "Physiotherapeut": "Jamie Miller" } },
  "Ghost Gaming": { players: ["reysbull", "noly", "Allushin"], coach: "Fireburner", staff: { "Finanzvorstand": "Alex Lopez", "PR-Manager": "Sven Johnson", "Psychologe": "Ryan Hernandez", "Scout": "Jordan Johnson", "Anwalt": "Arthur Davis", "Event-Manager": "Marc Martinez", "Physiotherapeut": "Morgan Lopez" } },
  "God Speed": { players: ["AppJack", "Archie", "crr"], coach: "Jahzo", staff: { "Finanzvorstand": "Dominik Taylor", "PR-Manager": "Gabriel Davis", "Psychologe": "Gabriel Miller", "Scout": "Alex Rodriguez", "Anwalt": "Chris Hernandez", "Event-Manager": "Alex Taylor", "Physiotherapeut": "Skyler Thomas" } },
  "Godalions": { players: ["Bananahead", "caleb", "kaka"], coach: "Fireburner", staff: { "Finanzvorstand": "Sam Rodriguez", "PR-Manager": "Casey Gonzalez", "Psychologe": "Lucas Silva", "Scout": "Jamie Smith", "Anwalt": "Robin Taylor", "Event-Manager": "Robin Lopez", "Physiotherapeut": "Sven Taylor" } },
  "GracesBlaze": { players: ["Cheese", "Superlachie", "Metsanauris"], coach: "Ferra", staff: { "Finanzvorstand": "Gabriel Miller", "PR-Manager": "Alex Martinez", "Psychologe": "Alex Thomas", "Scout": "Pierre Gonzalez", "Anwalt": "Casey Taylor", "Event-Manager": "Casey Brown", "Physiotherapeut": "Taylor Silva" } },
  "GriddyGoose": { players: ["Sypical", "N1tro", "Amphis"], coach: "Sizz", staff: { "Finanzvorstand": "Taylor Müller", "PR-Manager": "David Johnson", "Psychologe": "Lucas Taylor", "Scout": "Sam Smith", "Anwalt": "Ryan Johnson", "Event-Manager": "Chris Miller", "Physiotherapeut": "Jamie Silva" } },
  "Infamous": { players: ["Lj", "Acronik", "Daniel"], coach: "Eversax", staff: { "Finanzvorstand": "Morgan Smith", "PR-Manager": "Lucas Taylor", "Psychologe": "Jamie Müller", "Scout": "Jamie Miller", "Anwalt": "Sam Jones", "Event-Manager": "Gabriel Brown", "Physiotherapeut": "Chris Anderson" } },
  "Jungle Juicers": { players: ["caleb", "Lj", "EyeIgnite"], coach: "Chrome", staff: { "Finanzvorstand": "Jordan Jones", "PR-Manager": "Lucas Wilson", "Psychologe": "Francis Rodriguez", "Scout": "Dominik Hernandez", "Anwalt": "Pierre Müller", "Event-Manager": "Sam Davis", "Physiotherapeut": "Arthur Martinez" } },
  "KINOTROPE gaming": { players: ["Amphis", "Archie", "Evoh"], coach: "Satthew", staff: { "Finanzvorstand": "Arthur Jones", "PR-Manager": "Lucas Johnson", "Psychologe": "Marc Anderson", "Scout": "Lucas Taylor", "Anwalt": "Arthur Lopez", "Event-Manager": "David Lopez", "Physiotherapeut": "Casey Garcia" } },
  "Karmine Corp": { players: ["vatira", "Atow", "Rise"], coach: "Ferra", staff: { "Finanzvorstand": "Amine M'Barek", "PR-Manager": "Sophie Lefebvre", "Psychologe": "Jean-Luc Dubois", "Scout": "Thomas Petit", "Anwalt": "Cabinet Avocat Paris", "Event-Manager": "Lucas Bernard", "Physiotherapeut": "Marie Curie" } },
  "Kings of Urban": { players: ["Acronik", "CaioTG1", "Oski"], coach: "Satthew", staff: { "Finanzvorstand": "Jamie Johnson", "PR-Manager": "Sven Miller", "Psychologe": "Jordan Anderson", "Scout": "Sven Anderson", "Anwalt": "Jordan Rodriguez", "Event-Manager": "Marc Davis", "Physiotherapeut": "Sven Johnson" } },
  "L'antique Esport": { players: ["Superlachie", "crr", "CaioTG1"], coach: "Chrome", staff: { "Finanzvorstand": "Jamie Anderson", "PR-Manager": "Robin Johnson", "Psychologe": "Sven Wilson", "Scout": "Alex Rodriguez", "Anwalt": "Morgan Brown", "Event-Manager": "David Brown", "Physiotherapeut": "Taylor Johnson" } },
  "Lilmix": { players: ["CaioTG1", "Superlachie", "crr"], coach: "Jahzo", staff: { "Finanzvorstand": "Francis Anderson", "PR-Manager": "Sam Martinez", "Psychologe": "Arthur Garcia", "Scout": "Taylor Silva", "Anwalt": "Francis Davis", "Event-Manager": "Taylor Brown", "Physiotherapeut": "Marc Müller" } },
  "Lotus 8 Esports": { players: ["kaka", "Caard", "Fever"], coach: "RawGregory", staff: { "Finanzvorstand": "Morgan Taylor", "PR-Manager": "Lucas Müller", "Psychologe": "Francis Jones", "Scout": "Pierre Miller", "Anwalt": "Casey Anderson", "Event-Manager": "Jamie Gonzalez", "Physiotherapeut": "Francis Thomas" } },
  "M80": { players: ["Atow", "Dread", "Joyo"], coach: "Ferra", staff: { "Finanzvorstand": "Chris Miller", "PR-Manager": "Gabriel Müller", "Psychologe": "Arthur Hernandez", "Scout": "Sam Wilson", "Anwalt": "Alex Hernandez", "Event-Manager": "Chris Hernandez", "Physiotherapeut": "Lucas Johnson" } },
  "MIBR": { players: ["Arsenal", "Markydooda", "BeastMode"], coach: "Jahzo", staff: { "Finanzvorstand": "Arthur Miller", "PR-Manager": "Gabriel Brown", "Psychologe": "Jordan Jones", "Scout": "Sam Jones", "Anwalt": "Dominik Garcia", "Event-Manager": "Francis Williams", "Physiotherapeut": "Francis Brown" } },
  "Manchester City Esports": { players: ["Cheese", "Evoh", "Retals"], coach: "RawGregory", staff: { "Finanzvorstand": "Robin Müller", "PR-Manager": "Jordan Davis", "Psychologe": "Skyler Dupont", "Scout": "Gabriel Davis", "Anwalt": "David Martinez", "Event-Manager": "Taylor Garcia", "Physiotherapeut": "Casey Anderson" } },
  "Mock-It Esports": { players: ["Kuxir97", "Oaly", "Oski"], coach: "Fireburner", staff: { "Finanzvorstand": "Sven Anderson", "PR-Manager": "Dominik Jones", "Psychologe": "Ryan Davis", "Scout": "Lucas Rodriguez", "Anwalt": "Arthur Brown", "Event-Manager": "Skyler Martinez", "Physiotherapeut": "Sam Brown" } },
  "Moist Esports": { players: ["JKnaps", "Chronic", "Rizzo"], coach: "Eversax", staff: { "Finanzvorstand": "Lucas Smith", "PR-Manager": "Jamie Jones", "Psychologe": "Casey Miller", "Scout": "David Anderson", "Anwalt": "Sven Anderson", "Event-Manager": "Francis Lopez", "Physiotherapeut": "Jamie Garcia" } },
  "NORTHSTAR": { players: ["kaka", "N1tro", "Fever"], coach: "Satthew", staff: { "Finanzvorstand": "Robin Williams", "PR-Manager": "David Rodriguez", "Psychologe": "Sam Hernandez", "Scout": "Sven Taylor", "Anwalt": "Arthur Miller", "Event-Manager": "Chris Dupont", "Physiotherapeut": "Jamie Miller" } },
  "NOVO Esports": { players: ["Amphis", "gReazymeister", "MajicBear"], coach: "Fireburner", staff: { "Finanzvorstand": "Taylor Miller", "PR-Manager": "Alex Taylor", "Psychologe": "Casey Thomas", "Scout": "Morgan Dupont", "Anwalt": "Sam Wilson", "Event-Manager": "Dominik Gonzalez", "Physiotherapeut": "Dominik Rodriguez" } },
  "NRG": { players: ["GarrettG", "Justin", "Mist"], coach: "Fireburner", staff: { "Finanzvorstand": "Sarah Jenkins", "PR-Manager": "Mike Peterson", "Psychologe": "Dr. David Brown", "Scout": "Jason Smith", "Anwalt": "Sterling & Co.", "Event-Manager": "Rachel Green", "Physiotherapeut": "Tom Williams" } },
  "NTX Esports": { players: ["Retals", "noly", "Fever"], coach: "RawGregory", staff: { "Finanzvorstand": "Morgan Miller", "PR-Manager": "Alex Miller", "Psychologe": "Robin Miller", "Scout": "Arthur Wilson", "Anwalt": "Taylor Wilson", "Event-Manager": "Skyler Brown", "Physiotherapeut": "Robin Williams" } },
  "Next2Nu Esports": { players: ["Daniel", "BeastMode", "JKnaps"], coach: "Chrome", staff: { "Finanzvorstand": "Dominik Lopez", "PR-Manager": "Casey Miller", "Psychologe": "Jordan Dupont", "Scout": "Dominik Martinez", "Anwalt": "Jordan Smith", "Event-Manager": "Sam Gonzalez", "Physiotherapeut": "Robin Thomas" } },
  "Ninjas in Pyjamas": { players: ["Chronic", "N1tro", "caleb"], coach: "Sizz", staff: { "Finanzvorstand": "Dominik Davis", "PR-Manager": "Morgan Lopez", "Psychologe": "Pierre Anderson", "Scout": "Dominik Thomas", "Anwalt": "Sam Hernandez", "Event-Manager": "Lucas Williams", "Physiotherapeut": "Skyler Martinez" } },
  "Northern Gaming": { players: ["Maestro", "Cheese", "Acronik"], coach: "Sizz", staff: { "Finanzvorstand": "Ryan Silva", "PR-Manager": "Sven Taylor", "Psychologe": "Casey Brown", "Scout": "Chris Taylor", "Anwalt": "Lucas Taylor", "Event-Manager": "Casey Müller", "Physiotherapeut": "Lucas Jones" } },
  "Nova Esports": { players: ["Hntr", "Fever", "Metsanauris"], coach: "Satthew", staff: { "Finanzvorstand": "Taylor Anderson", "PR-Manager": "Marc Wilson", "Psychologe": "Morgan Garcia", "Scout": "Jamie Davis", "Anwalt": "Lucas Dupont", "Event-Manager": "Casey Martinez", "Physiotherapeut": "Sam Martinez" } },
  "NuTorious": { players: ["Superlachie", "JKnaps", "BeastMode"], coach: "Fireburner", staff: { "Finanzvorstand": "Pierre Anderson", "PR-Manager": "Pierre Jones", "Psychologe": "Lucas Miller", "Scout": "Chris Johnson", "Anwalt": "Jordan Miller", "Event-Manager": "Chris Silva", "Physiotherapeut": "Arthur Johnson" } },
  "OpTic Gaming": { players: ["N1tro", "Kuxir97", "Metsanauris"], coach: "RawGregory", staff: { "Finanzvorstand": "Alex Williams", "PR-Manager": "Marc Martinez", "Psychologe": "Skyler Garcia", "Scout": "Ryan Taylor", "Anwalt": "David Brown", "Event-Manager": "Taylor Dupont", "Physiotherapeut": "Morgan Lopez" } },
  "Overlooked": { players: ["Maestro", "N1tro", "Cheese"], coach: "Sizz", staff: { "Finanzvorstand": "Francis Brown", "PR-Manager": "Lucas Jones", "Psychologe": "Chris Rodriguez", "Scout": "Jordan Martinez", "Anwalt": "Ryan Silva", "Event-Manager": "Sam Brown", "Physiotherapeut": "Jordan Davis" } },
  "PSG Esports": { players: ["Retals", "Superlachie", "crr"], coach: "Chrome", staff: { "Finanzvorstand": "Marc Davis", "PR-Manager": "Dominik Silva", "Psychologe": "Taylor Gonzalez", "Scout": "Casey Smith", "Anwalt": "Dominik Jones", "Event-Manager": "Skyler Davis", "Physiotherapeut": "Gabriel Thomas" } },
  "PWR": { players: ["caleb", "Atow", "Comm"], coach: "Satthew", staff: { "Finanzvorstand": "Sam Jones", "PR-Manager": "Jamie Williams", "Psychologe": "Arthur Miller", "Scout": "Morgan Silva", "Anwalt": "Taylor Garcia", "Event-Manager": "Chris Anderson", "Physiotherapeut": "Skyler Miller" } },
  "Pioneers": { players: ["hockser", "Amphis", "kaka"], coach: "Fireburner", staff: { "Finanzvorstand": "Taylor Johnson", "PR-Manager": "Dominik Johnson", "Psychologe": "Sam Hernandez", "Scout": "Robin Anderson", "Anwalt": "Sven Müller", "Event-Manager": "Sven Martinez", "Physiotherapeut": "Gabriel Martinez" } },
  "R8 Esports": { players: ["Bananahead", "Evoh", "Sypical"], coach: "Eversax", staff: { "Finanzvorstand": "Chris Hernandez", "PR-Manager": "Sven Hernandez", "Psychologe": "Jordan Silva", "Scout": "Dominik Davis", "Anwalt": "Casey Brown", "Event-Manager": "Arthur Lopez", "Physiotherapeut": "Sven Williams" } },
  "Renegades": { players: ["Allushin", "reysbull", "gReazymeister"], coach: "Chrome", staff: { "Finanzvorstand": "Skyler Müller", "PR-Manager": "Dominik Rodriguez", "Psychologe": "Alex Johnson", "Scout": "Jordan Johnson", "Anwalt": "Casey Rodriguez", "Event-Manager": "Dominik Thomas", "Physiotherapeut": "Pierre Johnson" } },
  "Revelation": { players: ["Caard", "Joyo", "Dread"], coach: "Jahzo", staff: { "Finanzvorstand": "David Smith", "PR-Manager": "Dominik Wilson", "Psychologe": "Casey Brown", "Scout": "Jordan Müller", "Anwalt": "David Taylor", "Event-Manager": "Jamie Anderson", "Physiotherapeut": "Chris Hernandez" } },
  "Rogue": { players: ["Scream", "Chicago", "Comm"], coach: "Chrome", staff: { "Finanzvorstand": "Arthur Thomas", "PR-Manager": "Taylor Hernandez", "Psychologe": "Chris Wilson", "Scout": "Jamie Williams", "Anwalt": "Robin Jones", "Event-Manager": "Marc Miller", "Physiotherapeut": "Skyler Brown" } },
  "Selfless Gaming": { players: ["Chicago", "CaioTG1", "Fever"], coach: "Chrome", staff: { "Finanzvorstand": "Dominik Thomas", "PR-Manager": "David Anderson", "Psychologe": "Skyler Gonzalez", "Scout": "Lucas Williams", "Anwalt": "Morgan Johnson", "Event-Manager": "Morgan Anderson", "Physiotherapeut": "Marc Müller" } },
  "Shopify Rebellion": { players: ["2Piece", "Paarth", "LJ"], coach: "Memory", staff: { "Finanzvorstand": "Jessica Wong", "PR-Manager": "David Miller", "Psychologe": "Elena Rossi", "Scout": "Ryan O'Connor", "Anwalt": "Legal Rebels", "Event-Manager": "Sarah Jenkins", "Physiotherapeut": "Mark Henderson" } },
  "Spacestation Gaming": { players: ["Sypical", "Daniel", "MajicBear"], coach: "Ferra", staff: { "Finanzvorstand": "Pierre Davis", "PR-Manager": "Alex Silva", "Psychologe": "Jamie Jones", "Scout": "Casey Thomas", "Anwalt": "Sam Gonzalez", "Event-Manager": "Arthur Johnson", "Physiotherapeut": "David Anderson" } },
  "Splyce": { players: ["Superlachie", "MajicBear", "Kuxir97"], coach: "Eversax", staff: { "Finanzvorstand": "Chris Miller", "PR-Manager": "Pierre Jones", "Psychologe": "Taylor Gonzalez", "Scout": "Lucas Taylor", "Anwalt": "Sven Anderson", "Event-Manager": "Arthur Brown", "Physiotherapeut": "Pierre Dupont" } },
  "Str1ve eSports": { players: ["Maestro", "Oski", "kaka"], coach: "Sizz", staff: { "Finanzvorstand": "David Rodriguez", "PR-Manager": "Marc Silva", "Psychologe": "Sam Williams", "Scout": "Lucas Wilson", "Anwalt": "Sven Dupont", "Event-Manager": "Lucas Rodriguez", "Physiotherapeut": "Sven Müller" } },
  "Sunset": { players: ["Joreuz", "Fever", "Allushin"], coach: "Eversax", staff: { "Finanzvorstand": "Skyler Johnson", "PR-Manager": "Arthur Garcia", "Psychologe": "Chris Smith", "Scout": "Alex Rodriguez", "Anwalt": "Gabriel Davis", "Event-Manager": "Morgan Garcia", "Physiotherapeut": "Taylor Hernandez" } },
  "TSM": { players: ["crr", "Satthew", "gReazymeister"], coach: "Sizz", staff: { "Finanzvorstand": "Morgan Hernandez", "PR-Manager": "Dominik Martinez", "Psychologe": "Marc Garcia", "Scout": "Chris Anderson", "Anwalt": "Robin Silva", "Event-Manager": "Sven Williams", "Physiotherapeut": "Alex Garcia" } },
  "Team BSK": { players: ["Cheese", "noly", "Oaly"], coach: "Fireburner", staff: { "Finanzvorstand": "Robin Rodriguez", "PR-Manager": "Taylor Rodriguez", "Psychologe": "Robin Jones", "Scout": "Chris Garcia", "Anwalt": "Casey Johnson", "Event-Manager": "Jordan Miller", "Physiotherapeut": "Pierre Hernandez" } },
  "Team Falcons": { players: ["Trk511", "Ahmad", "Rw9"], coach: "Senzo", staff: { "Finanzvorstand": "Khalid Mansour", "PR-Manager": "Fatima Al-Farsi", "Psychologe": "Omar Hassan", "Scout": "Ibrahim Zaid", "Anwalt": "Riyadh Law Firm", "Event-Manager": "Layla Nasser", "Physiotherapeut": "Youssef Ali" } },
  "Team Secret": { players: ["Maestro", "Amphis", "Comm"], coach: "Fireburner", staff: { "Finanzvorstand": "David Gonzalez", "PR-Manager": "Dominik Müller", "Psychologe": "Dominik Smith", "Scout": "Skyler Lopez", "Anwalt": "Sven Anderson", "Event-Manager": "Taylor Brown", "Physiotherapeut": "Ryan Müller" } },
  "Team Silenced": { players: ["Daniel", "Remkoe", "Amphis"], coach: "RawGregory", staff: { "Finanzvorstand": "Casey Rodriguez", "PR-Manager": "Sven Williams", "Psychologe": "Sam Taylor", "Scout": "Casey Dupont", "Anwalt": "Skyler Johnson", "Event-Manager": "Taylor Martinez", "Physiotherapeut": "Francis Silva" } },
  "Team Vision": { players: ["Oaly", "crr", "Rizzo"], coach: "Ferra", staff: { "Finanzvorstand": "Casey Dupont", "PR-Manager": "Lucas Jones", "Psychologe": "Gabriel Taylor", "Scout": "Robin Smith", "Anwalt": "Robin Williams", "Event-Manager": "Ryan Rodriguez", "Physiotherapeut": "Robin Garcia" } },
  "Team Vitality": { players: ["zen", "ExoTiiK", "stizzy"], coach: "Eversax", staff: { "Finanzvorstand": "Sonia Manueco", "PR-Manager": "Sarah Mittelette", "Psychologe": "Edgar Chekera", "Scout": "Marc-Antoine Dupont", "Anwalt": "Levine Keszler", "Event-Manager": "Anne Banschbach", "Physiotherapeut": "Ghais „Hyyperio“ Moulai" } },
  "The Bricks": { players: ["Fever", "Cheese", "kamz"], coach: "Jahzo", staff: { "Finanzvorstand": "Chris Brown", "PR-Manager": "Casey Gonzalez", "Psychologe": "Francis Anderson", "Scout": "Lucas Anderson", "Anwalt": "Pierre Dupont", "Event-Manager": "Jamie Martinez", "Physiotherapeut": "Marc Hernandez" } },
  "Twisted Minds": { players: ["Hntr", "Kuxir97", "Scream"], coach: "Satthew", staff: { "Finanzvorstand": "Casey Williams", "PR-Manager": "Sven Smith", "Psychologe": "Robin Hernandez", "Scout": "Skyler Williams", "Anwalt": "Dominik Müller", "Event-Manager": "Casey Brown", "Physiotherapeut": "Francis Miller" } },
  "Unreal Nightmare": { players: ["crr", "Comm", "EyeIgnite"], coach: "Fireburner", staff: { "Finanzvorstand": "Lucas Smith", "PR-Manager": "David Martinez", "Psychologe": "Chris Gonzalez", "Scout": "Sam Dupont", "Anwalt": "Pierre Johnson", "Event-Manager": "Taylor Garcia", "Physiotherapeut": "Dominik Taylor" } },
  "Virtus.pro": { players: ["gReazymeister", "Fever", "Lj"], coach: "Jahzo", staff: { "Finanzvorstand": "Jamie Wilson", "PR-Manager": "Sam Jones", "Psychologe": "Casey Brown", "Scout": "Alex Müller", "Anwalt": "David Taylor", "Event-Manager": "Lucas Hernandez", "Physiotherapeut": "Dominik Gonzalez" } },
  "WIP Esports": { players: ["Maestro", "Turo", "hockser"], coach: "Sizz", staff: { "Finanzvorstand": "Lucas Martinez", "PR-Manager": "Chris Davis", "Psychologe": "Robin Garcia", "Scout": "Taylor Gonzalez", "Anwalt": "Sam Dupont", "Event-Manager": "Sven Silva", "Physiotherapeut": "Taylor Anderson" } },
  "WOO": { players: ["Satthew", "JKnaps", "Chicago"], coach: "Jahzo", staff: { "Finanzvorstand": "Francis Silva", "PR-Manager": "Taylor Gonzalez", "Psychologe": "Chris Rodriguez", "Scout": "Chris Garcia", "Anwalt": "Sven Anderson", "Event-Manager": "Pierre Garcia", "Physiotherapeut": "Morgan Garcia" } },
  "WYLDE": { players: ["BeastMode", "crr", "Torsos"], coach: "Jahzo", staff: { "Finanzvorstand": "Chris Brown", "PR-Manager": "Casey Rodriguez", "Psychologe": "Jamie Smith", "Scout": "Skyler Müller", "Anwalt": "Arthur Miller", "Event-Manager": "David Silva", "Physiotherapeut": "Gabriel Miller" } },
  "We Dem Girlz": { players: ["Scream", "MajicBear", "noly"], coach: "Satthew", staff: { "Finanzvorstand": "Marc Lopez", "PR-Manager": "Jordan Taylor", "Psychologe": "David Smith", "Scout": "Arthur Anderson", "Anwalt": "Alex Smith", "Event-Manager": "Arthur Miller", "Physiotherapeut": "Marc Hernandez" } },
  "Wildcard": { players: ["ayyjayy", "kamz", "Torsos"], coach: "Ferra", staff: { "Finanzvorstand": "Alex Davis", "PR-Manager": "Skyler Williams", "Psychologe": "Arthur Hernandez", "Scout": "Chris Dupont", "Anwalt": "Arthur Müller", "Event-Manager": "Gabriel Anderson", "Physiotherapeut": "Sven Johnson" } },
  "Zookeepers": { players: ["kamz", "N1tro", "Chronic"], coach: "Chrome", staff: { "Finanzvorstand": "Dominik Hernandez", "PR-Manager": "Robin Williams", "Psychologe": "Jamie Davis", "Scout": "Jordan Johnson", "Anwalt": "Pierre Müller", "Event-Manager": "Skyler Lopez", "Physiotherapeut": "David Taylor" } },
  "iBUYPOWER": { players: ["Turo", "reysbull", "N1tro"], coach: "RawGregory", staff: { "Finanzvorstand": "Chris Brown", "PR-Manager": "Sam Wilson", "Psychologe": "Jordan Lopez", "Scout": "Marc Hernandez", "Anwalt": "Gabriel Müller", "Event-Manager": "Jamie Smith", "Physiotherapeut": "Skyler Smith" } },
};

// Echte Nationalitäten für Spieler aus ORG_REAL_ROSTER_NAMES (User-Datei
// `rocket_league_spieler_nationalitaeten.txt`, 74 Spieler-Nicknames -> Land).
// Nur Spieler-Rollen (Starter/Sub), keine Mitarbeiter -- die Datei enthielt
// nur Spieler-Gamertags. Namen, die hier NICHT vorkommen (Sub-Slots ohne
// DB-Eintrag, alle prozeduralen Namen), bekommen weiterhin eine zufällige
// Nation wie bisher. "Oski" hatte in der Quelle eine Doppel-Nationalität
// ("Polen / Großbritannien") -- da das Datenmodell nur ein Land pro Spieler
// kennt, wurde die zuerst genannte (Polen) übernommen.
// Bug-Fix (Audit Runde 4, Datendateien-Agent): "LJ" (Shopify Rebellion) und
// "Lj" (Infamous/Jungle Juicers/Virtus.pro) bezeichnen denselben Spieler,
// aber der Lookup unten (rollPlayer(), case-sensitive) fand nur die
// Großschreibung -- die drei zuletzt genannten Orgs bekamen dadurch für ihn
// bisher eine zufällige statt der recherchierten echten Nationalität. Beide
// Schreibweisen jetzt als eigener Key hinterlegt, statt den Lookup selbst
// case-insensitive zu machen (kleinerer, risikoärmerer Fix).
const REAL_PLAYER_NATIONS = {
  "2Piece": "US", "Acronik": "PT", "Ahmad": "SA", "Allushin": "CA", "Amphis": "AU",
  "AppJack": "GB", "Archie": "GB", "Arsenal": "US", "Atow": "BE", "ayyjayy": "US",
  "Bananahead": "AU", "BeastMode": "US", "Caard": "BR", "CaioTG1": "BR", "caleb": "AU",
  "carca": "AU", "Cheese": "US", "Chicago": "US", "Chronic": "US", "Comm": "US",
  "crr": "ES", "Daniel": "US", "Dread": "NZ", "Drufinho": "BR", "Eversax": "BE",
  "Evoh": "US", "ExoTiiK": "FR", "EyeIgnite": "GB", "Ferra": "FR", "Fever": "AU",
  "Firstkiller": "US", "GarrettG": "US", "gReazymeister": "NO", "Hntr": "AU", "hockser": "US",
  "JKnaps": "CA", "Joreuz": "NL", "Joyo": "GB", "Justin": "US", "kaka": "AU",
  "kamz": "NZ", "Kuxir97": "IT", "LJ": "US", "Lj": "US", "Lostt": "BR",
  "M1k3rules": "GB", "Maestro": "DK", "MajicBear": "US", "Markydooda": "GB", "Metsanauris": "FI",
  "Mist": "US", "N1tro": "US", "noly": "GB", "Oaly": "NL", "Oski": "PL",
  "Paarth": "US", "Remkoe": "NL", "Retals": "US", "reysbull": "CL", "Rise": "GB",
  "Rizzo": "US", "Rw9": "SA", "Satthew": "US", "Scream": "FR",
  "stizzy": "ES", "Superlachie": "AU", "Sypical": "US", "Torsos": "NZ", "Trk511": "SA",
  "Turo": "US", "vatira": "FR", "yanxnz": "BR", "zen": "FR",
};

// mulberry32 — kleiner deterministischer PRNG (kein Math.random()), damit
// dieselbe Org bei jedem Programmstart exakt denselben Kader bekommt.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Fester Karriere-Startanker (Runde 117, für Vertragsdaten) -- dieselbe
// Konstante wie das `careerDate = careerDate || '2026-01-01'` in
// confirmOrgAndProceed()/goToDashboard() (renderer.js). ORGANIZATIONS wird
// beim App-Start gebaut, BEVOR irgendeine Karriere (und damit ein echtes
// careerDate) existiert -- Verträge werden deshalb hier relativ zu diesem
// festen Datum berechnet, nicht relativ zum (noch nicht existierenden)
// tatsächlichen Karrieredatum. Absolute Daten (nicht nur ein Monats-Offset)
// werden bewusst direkt hier gespeichert, damit dieselbe addMonthsToDateStr()-
// Logik auch zur LAUFZEIT (renderer.js, Spieler-/Personal-Verpflichtung,
// siehe rollReplacementPerson() unten) mit dem dann echten `careerDate` als
// Anker wiederverwendet werden kann, ohne zwei unterschiedliche Datenformen
// (Offset vs. absolut) im selben Feld zu vermischen.
const ROSTER_CAREER_EPOCH = '2026-01-01';
function addMonthsToDateStr(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(newY, newM, 0)).getUTCDate();
  const newD = Math.min(d, daysInMonth);
  return newY + '-' + String(newM).padStart(2, '0') + '-' + String(newD).padStart(2, '0');
}

const ROSTER_STAT_KEYS = ['mechanics', 'gameSense', 'speed', 'shooting', 'defending', 'boostMgmt'];

// 0-5-Sterne-Darstellung (0.5er-Schritte) aus dem Overall-Wert (~45-95er
// Spanne) -- dieselbe Formel-Idee wie orgStarRating() in organizations.js,
// nur auf die Spieler/Mitarbeiter-Overall-Spanne skaliert statt auf 0-100.
// Bug-Fix (User-Meldung: "bei potential steht noch nan"): Math.max/Math.min
// geben bei JEDEM NaN-Argument selbst NaN zurück (JS-Spezifikum) -- ein
// undefined/NaN `overall` (z.B. eine Person mit unvollständigen Daten) machte
// bisher JEDE nachgelagerte Sterne-/Potenzial-Anzeige (npcStarRating() UND
// darauf aufbauend scoutingPotentialStars()) unbrauchbar, statt einen
// erkennbaren, klaren Wert zu zeigen.
function npcStarRating(overall) {
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  return Math.max(0.5, Math.min(5, Math.round(((safeOverall - 45) / 50) * 5 * 2) / 2));
}

// Kehrwert von npcStarRating() -- rechnet eine GEWÜNSCHTE Sterne-Bewertung
// zurück in den Overall-Wert, der genau diese Bewertung ergibt.
function starsToOverall(stars) {
  return Math.round(45 + stars * 10);
}

// Masterprompt-Feature (Alterung/Entwicklung): "Potenzial" war bisher NUR
// eine reine Anzeige-Projektion (scoutingPotentialStars() in renderer.js,
// wirkte NIE auf die tatsächliche Entwicklungs-Obergrenze). Jetzt ein ECHTES,
// beim Erzeugen einmalig gewürfeltes und dauerhaft gespeichertes Feld --
// dasselbe Overall-Skala (45-99) wie `overall` selbst, damit
// applyPlayerStatDelta()/applyStaffStatDelta() (renderer.js) es direkt als
// harten Pro-Person-Deckel verwenden können ("Potenzial ist das absolute
// Maximum"). Jüngere Personen bekommen mehr Kopfraum als ältere, IMMER
// mindestens `minHeadroom` über dem aktuellen Overall -- das verhindert, dass
// eine einzelne, um den Overall gestreute Statachse (±4 bei Spielern, ±8 bei
// Mitarbeitern) das Potenzial durch Zufall gleich beim Erzeugen überschreitet.
function rollPotentialForOverall(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13); // ~0 ab 27, ~0.77 bei 17 (jüngstes Spieler-Alter)
  const headroom = 4 + ageFactor * 26 + (rng() * 2 - 1) * 5;
  return Math.max(safeOverall, Math.min(99, Math.round(safeOverall + Math.max(minHeadroom || 5, headroom))));
}

// User-Korrektur (nach einer ersten, falschen Version dieses Systems): NICHT
// die Org-Stärke soll die Sterne der Spieler/Mitarbeiter bestimmen, sondern
// UMGEKEHRT -- jeder Spieler/Mitarbeiter bekommt unabhängig von seiner Org
// eine Sterne-Bewertung, GLEICHMÄSSIG verteilt über 0,5-5 Sterne, und die
// Org-Bewertung ergibt sich danach als Durchschnitt ihres Kaders (siehe
// computeOrgStrengthFromRoster() unten). Zwei getrennte "Ziehungs-Beutel":
// Spieler-Beutel (3 Starter + Sub -- Sub zählt hier als Spieler-Rolle, braucht
// wie die Starter volle Match-Stats) und Mitarbeiter-Beutel (Coach + 8
// Team-Mitarbeiter-Rollen), damit beide Kategorien für sich GLEICHMÄSSIG
// verteilt sind, nicht nur insgesamt.
//
// "Shuffled Bag": pro Auffüllrunde wird EINMAL eine komplette Kopie aller 10
// Sterne-Stufen gemischt (Fisher-Yates) und dann einzeln abgearbeitet -- so
// enthält jede Zehnerrunde garantiert genau eine 0,5-, eine 1-, ..., eine
// 5-Sterne-Ziehung, ohne dass die Gesamtzahl der Ziehungen im Voraus bekannt
// sein muss (bei 87 Orgas x 8 Mitarbeiterrollen = 696 Ziehungen bleiben nur
// 4 der 10 Stufen einmal seltener, der Rest ist exakt gleich oft; bei 87 x 4
// Spieler-Rollen = 348 Ziehungen bleiben nur 2 der 10 Stufen einmal seltener).
const STAR_TIERS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
function makeShuffledBagPicker(seed, tiers) {
  const rng = mulberry32(seed);
  const source = tiers || STAR_TIERS;
  let bag = [];
  return function pick() {
    if (bag.length === 0) {
      bag = source.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
    }
    return bag.pop();
  };
}
// WICHTIG: reines "jede Person unabhängig global aus dem Beutel ziehen" (die
// erste Version) klingt richtig, erzeugt aber statistisch fast IMMER Orgs mit
// mittlerer Stärke: der Durchschnitt aus 14 unabhängig-zufälligen Personen
// pendelt sich laut Zentralem Grenzwertsatz eng um die Mitte ein (in der Praxis
// nur 46-64 von 100 statt 0-100) -- keine Org kann so je wirklich 5 oder 0,5
// Sterne im Schnitt erreichen, obwohl genau DAS Vitality-Beispiel des Nutzers
// verlangt ("5 Sterne WEIL 5-Sterne-Spieler und 4-5-Sterne-Staff, nicht
// umgekehrt"). Lösung: Personen EINER Org müssen miteinander korrelieren
// (gemeinsam stark oder gemeinsam schwach), nicht unabhängig voneinander
// gezogen werden. Dafür bekommt zuerst JEDE der 87 Orgs selbst -- über denselben
// Shuffled-Bag-Trick, jetzt auf Org-Ebene statt Personen-Ebene -- eine
// Ziel-Qualitätsstufe (0,5-5, exakt gleichmäßig über alle Orgas verteilt, 8-9
// Orgs pro Stufe). Alle 14 Kadermitglieder EINER Org streuen dann nur noch
// leicht um DIESE Ziel-Stufe. Die Gesamt-Population aller Spieler/Mitarbeiter
// bleibt dabei weiterhin näherungsweise gleichmäßig (nicht mehr exakt), weil
// die 87 Org-Stufen selbst exakt gleichmäßig sind und die Streuung symmetrisch
// um jede Stufe liegt -- siehe Simulation zur Verifikation.
//
// User-Korrektur (Folgerunde): rein zufällige Org-Stufen ließen auch reale,
// bekannte Top-Orgs (Vitality, Karmine Corp, Falcons) gelegentlich schwach
// werden -- "die großen orgas und bekannten sollen eher die starken orgs
// sein, nicht schwache oder mittlere". Der Streu-Mechanismus selbst
// (rollStarsAround etc.) bleibt exakt wie er ist ("logik kann bleiben wie sie
// ist") -- geändert wird nur, WELCHE Stufe eine Org zugelost bekommt: eine
// kuratierte Liste real bekannter/erfolgreicher Orgas zieht aus einem eigenen
// Beutel, der NUR die drei Top-Stufen (4/4,5/5) enthält, alle übrigen 69
// Orgas ziehen aus einem zweiten Beutel mit den restlichen 7 Stufen
// (0,5-3,5) -- so bleiben die "großen" Orgas garantiert stark, ohne dass eine
// kleine/fiktive Org ihnen zufällig den Rang abläuft.
const BIG_ORG_NAMES = new Set([
  'Team Vitality', 'Karmine Corp', 'Team Falcons', 'G2 Esports', 'Complexity Gaming',
  'NRG', 'Spacestation Gaming', 'FURIA', 'Gen.G Mobil1 Racing', 'Cloud9',
  'Evil Geniuses', 'Dignitas', 'M80', 'Shopify Rebellion', 'Virtus.pro',
  'MIBR', 'Ninjas in Pyjamas', 'TSM',
  // Runde 91: pro Region 2-3 der neu hinzugefügten fiktiven Orgas (siehe
  // organizations.js) als "groß" markiert, damit die 64er-Aufstockung nicht
  // nur 0,5-4-Sterne-Teams bringt, sondern jede Region auch unter den NEUEN
  // Orgas 4,5-5-Sterne-Top-Teams bekommt.
  'Luminous Brigade', 'Krypton Wave', 'Raptor Pack', 'Ashen Force', 'Orbit Force',
  'Comet Dynasty', 'Pulse Collective', 'Basilisk Enclave', 'Cyclone Syndicate', 'Falcon Outfit',
  'Pyre Company', 'Nebula Dynasty', 'Ferox Syndicate', 'Quake Rebels', 'Neon Enclave',
  'Glacier Guild', 'Comet Company', 'Surge Titans', 'Crimson United', 'Talon Guild',
]);
const BIG_ORG_TIERS = [4.5, 5];
const REGULAR_ORG_TIERS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const pickBigOrgTier = makeShuffledBagPicker(0x1c1e2f4a, BIG_ORG_TIERS);
const pickRegularOrgTier = makeShuffledBagPicker(0x9e3711a5, REGULAR_ORG_TIERS);

function clampToStarTier(v) {
  return Math.max(0.5, Math.min(5, Math.round(v * 2) / 2));
}
function rollStarsAround(center, spread, rng) {
  return clampToStarTier(center + (rng() * 2 - 1) * spread);
}

// Org-Bewertung (0-100, dieselbe Skala, die orgStarRating()/orgDifficulty()
// in organizations.js schon vorher erwarteten) ergibt sich jetzt als
// Durchschnitt der Sterne-Bewertungen des GESAMTEN Kaders (3
// Starter + Sub + Coach + 8 Mitarbeiter = 13 Personen) -- "Vitality 5 Sterne,
// weil 5-Sterne-Spieler und 4-5-Sterne-Staff", nicht umgekehrt.
function computeOrgStrengthFromRoster(roster) {
  // .filter(Boolean) -- bei den 87 festen Orgas ist .sub immer gesetzt, bei
  // selbst erstellten Orgas (Organisation erstellen, siehe renderer.js
  // buildCustomOrgFromForm()) kann .sub aber bewusst null sein (kein 4.
  // Spieler in der Free-Agent-Auffüllung).
  // Personal-Seite: gekündigtes Personal wird NICHT aus dem Array entfernt
  // (sonst müssten alle .find((s) => s.role === X)-Aufrufe im Projekt gegen
  // Lücken abgesichert werden), sondern durch { role, vacant: true }
  // ersetzt -- .filter(Boolean) allein würde dieses Objekt fälschlich als
  // besetzt zählen (p.overall wäre undefined -> NaN in der Mittelwertbildung,
  // Stärke der GESAMTEN Org würde NaN). !p.vacant schließt diese Plätze
  // korrekt aus der Stärke-Berechnung aus (kein Personal in der Rolle = kein
  // Beitrag zur Org-Stärke).
  const people = [...roster.starters, roster.sub, roster.coach, ...roster.staff].filter((p) => p && !p.vacant);
  // Bug-Fix (Audit): eine komplett leere Org (Schwierigkeit "Schwer" + "Mit
  // Free Agents auffüllen" deaktiviert bei "Organisation erstellen") hat
  // people.length === 0 -- die Division ergab bisher 0/0 = NaN, was als
  // org.strength gespeichert wurde und u.a. "Stärke NaN" im UI anzeigte und
  // sponsorWillBeAccepted() (jeder Vergleich mit NaN ist immer false) dauerhaft
  // JEDEN Sponsor ablehnen ließ, solange der Kader leer war.
  if (people.length === 0) return 0;
  const avgStars = people.reduce((sum, p) => sum + npcStarRating(p.overall), 0) / people.length;
  return Math.round((avgStars / 5) * 100);
}

// Baut den festen Kader einer Org: 3 Starter + 1 Sub + 1 Coach (alle mit den
// echten match.js-Statachsen, damit sie normal ins Turnier einsteigen können)
// + 8 Team-Mitarbeiter (nur Overall/Sterne, keine Match-Stats nötig -- die
// spielen nie mit, siehe Team-Mitarbeiter-Sektion im Org-Vorschau-Panel).
// Namen: wo die Datenbank (ORG_REAL_ROSTER_NAMES) eine echte Person für diese
// Org+Rolle kennt, wird die verwendet -- sonst (Sub, Analyst, oder
// Orgas ohne DB-Eintrag) bleibt es bei der prozeduralen Fantasienamen-Vergabe.
function generateOrgRoster(org) {
  const rng = mulberry32(hashString(org.name));
  const isBigOrg = BIG_ORG_NAMES.has(org.name);
  const orgTier = isBigOrg ? pickBigOrgTier() : pickRegularOrgTier();
  // Große/bekannte Orgas streuen enger um ihre Ziel-Stufe (weniger "Zufalls-
  // Pech" nach unten) -- garantiert zuverlässig LEICHT/4-5 Sterne statt nur
  // im Erwartungswert, ohne den Streu-Mechanismus selbst zu verändern.
  const playerSpread = isBigOrg ? 0.55 : 1.1;
  const staffSpread = isBigOrg ? 0.65 : 1.3;
  const usedNames = new Set();
  const nations = CHARACTER_NATIONS.map((n) => n.code);
  const realNames = ORG_REAL_ROSTER_NAMES[org.name] || null;

  if (realNames) {
    realNames.players.forEach((n) => usedNames.add(n));
    usedNames.add(realNames.coach);
    Object.values(realNames.staff).forEach((n) => usedNames.add(n));
  }

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const pickNation = () => pick(nations);
  const pickAvatarId = () => pick(CHARACTER_AVATARS).id;

  function uniqueNickname() {
    let name;
    let guard = 0;
    do {
      name = pick(ROSTER_NICK_PREFIXES) + pick(ROSTER_NICK_SUFFIXES);
      guard += 1;
    } while (usedNames.has(name) && guard < 40);
    usedNames.add(name);
    return name;
  }
  function uniqueStaffName() {
    let name;
    let guard = 0;
    do {
      const isM = rng() < 0.5;
      name = pick(isM ? ROSTER_STAFF_FIRST_NAMES_M : ROSTER_STAFF_FIRST_NAMES_F) + ' ' + pick(ROSTER_STAFF_LAST_NAMES);
      guard += 1;
    } while (usedNames.has(name) && guard < 40);
    usedNames.add(name);
    return name;
  }

  // Alter (Runde 116, für die Scouting-Seite): deterministisch aus derselben
  // Org-RNG gezogen wie alles andere hier (also stabil über App-Neustarts
  // hinweg, genau wie country/avatarId) -- 17-32, reale Rocket-League-Pro-
  // Altersspanne für Spieler. Wird u.a. für die POTENZIAL-Projektion auf der
  // Scouting-Seite UND (Runde 117) für die tatsächliche Entwicklungsrate
  // gebraucht (siehe scoutingPotentialStars()/playerAgeGrowthFactor() in
  // renderer.js). Team-Mitarbeiter (rollStaff()) sind im Schnitt älter --
  // eigene, weitere Altersspanne.
  const pickPlayerAge = () => Math.round(17 + rng() * 15);
  const pickStaffAge = () => Math.round(24 + rng() * 31);

  // Vertragsbeginn/-ende (Runde 117, User-Vorgabe "Vertragsende und
  // Vertragsbeginn-Logik bauen"): deterministisch relativ zu ROSTER_CAREER_EPOCH
  // ausgewürfelt -- manche Verträge laufen kurz nach Karrierestart schon aus,
  // andere erst in Jahren (0-24 Monate bereits gelaufen, 12-36 Monate
  // Gesamtlaufzeit).
  function rollContractDates() {
    const startOffsetMonths = Math.round(rng() * 24);
    const lengthMonths = Math.round(12 + rng() * 24);
    // Bug-Fix (Audit-Runde): ohne Deckelung konnte startOffsetMonths >
    // lengthMonths herauskommen -- der Vertrag wäre dann schon VOR
    // Karrierestart abgelaufen. checkOwnContractsForWarningsAndExpiry()
    // entfernte die Person dann am ALLERERSTEN Tagfortschritt sofort und OHNE
    // jede Vorwarnung (maybeWarnOwnContractExpiry() überspringt bereits
    // abgelaufene Verträge bewusst, siehe deren daysLeft<0-Check) -- rechnerisch
    // bei ~12,5% aller generierten Personen der Fall, bei 3 Startern also ~33%
    // Chance auf einen sofort verschwindenden Starter direkt zu Karrierebeginn.
    // Mindestens 1 Monat Restlaufzeit ab Epoch erzwungen.
    const safeStartOffsetMonths = Math.min(startOffsetMonths, lengthMonths - 1);
    const contractStart = addMonthsToDateStr(ROSTER_CAREER_EPOCH, -safeStartOffsetMonths);
    const contractEnd = addMonthsToDateStr(contractStart, lengthMonths);
    return { contractStart, contractEnd };
  }

  function rollPlayer(stars, realName) {
    const targetOverall = starsToOverall(stars);
    const stats = {};
    // Einzelne Statachsen leicht um den Ziel-Overall streuen (±4), damit
    // Spieler nicht auf allen 6 Achsen identisch sind -- der DURCHSCHNITT
    // bleibt aber nah am Ziel-Overall (und damit an der Ziel-Sterne-Zahl).
    ROSTER_STAT_KEYS.forEach((key) => {
      const v = targetOverall + (rng() * 2 - 1) * 4;
      stats[key] = Math.max(45, Math.min(95, Math.round(v)));
    });
    const overall = Math.round(ROSTER_STAT_KEYS.reduce((sum, k) => sum + stats[k], 0) / ROSTER_STAT_KEYS.length);
    const age = pickPlayerAge();
    return {
      name: realName || uniqueNickname(),
      country: (realName && REAL_PLAYER_NATIONS[realName]) || pickNation(),
      avatarId: pickAvatarId(),
      age,
      ...rollContractDates(),
      ...stats,
      overall,
      potential: rollPotentialForOverall(overall, age, rng, 5),
    };
  }

  function rollStaff(stars, realName, role) {
    const targetOverall = starsToOverall(stars);
    const attrs = generateStaffAttributes(role, targetOverall, rng);
    // Overall wird -- genau wie bei rollPlayer() -- aus dem tatsächlichen
    // Durchschnitt der (gestreuten) Attribute abgeleitet, nicht 1:1 aus
    // targetOverall übernommen, damit "overall" (Sterne-Anzeige, Org-Stärke,
    // Marktwert) konsistent zu den angezeigten Einzelwerten bleibt.
    const attrKeys = Object.keys(attrs);
    const overall = attrKeys.length > 0
      ? Math.round(attrKeys.reduce((sum, k) => sum + attrs[k], 0) / attrKeys.length)
      : targetOverall;
    const age = pickStaffAge();
    return {
      name: realName || uniqueStaffName(),
      country: pickNation(),
      avatarId: pickAvatarId(),
      age,
      ...rollContractDates(),
      ...attrs,
      overall,
      potential: rollPotentialForOverall(overall, age, rng, 9),
    };
  }

  const starters = [
    rollPlayer(rollStarsAround(orgTier, playerSpread, rng), realNames && realNames.players[0]),
    rollPlayer(rollStarsAround(orgTier, playerSpread, rng), realNames && realNames.players[1]),
    rollPlayer(rollStarsAround(orgTier, playerSpread, rng), realNames && realNames.players[2]),
  ];
  const sub = rollPlayer(rollStarsAround(orgTier, playerSpread, rng)); // kein 4. Spieler in der Datenbank -- bleibt prozedural
  const coach = rollPlayer(rollStarsAround(orgTier, staffSpread, rng), realNames && realNames.coach);
  const staff = ORG_ROSTER_STAFF_ROLES.map((role) => ({
    role,
    ...rollStaff(rollStarsAround(orgTier, staffSpread, rng), realNames && realNames.staff[role], role),
  }));

  // Runde 122, User-Vorgabe: "Reserve"-Kategorie -- separate Sammelstelle für
  // gekaufte, noch nicht in den Starter-/Sub-Slots eingesetzte Spieler (siehe
  // executePlayerSigning()/promoteReservePlayer() in renderer.js). Startet
  // für JEDE Org leer -- bekommt nur bei assignedOrg tatsächlich Einträge
  // (Bot-Orgs "kaufen" nie über Scouting).
  return { starters, sub, coach, staff, reserve: [] };
}

// Eigenständige, WIEDERVERWENDBARE Fassung von rollPlayer()/rollStaff() oben
// (die Originale sind private Closures INNERHALB generateOrgRoster(),
// deterministisch pro Org geseedet) -- für die neue Scouting-
// Verpflichtungs-Mechanik (renderer.js signStaffMember(), Runde 117), die zur
// LAUFZEIT (nicht beim App-Start) einen Ersatz für eine gerade abgeworbene
// Kaderposition braucht, wenn eine verkaufende Org einen Spieler/Mitarbeiter
// verliert. Nutzt bewusst KEINEN deterministischen Seed (echtes Laufzeit-
// Ereignis während einer laufenden Karriere, kein initialer Kaderaufbau) --
// Math.random() ist hier korrekt, genau wie bei anderen Laufzeit-
// Zufallsereignissen im Spiel (Match-Simulation etc.). `contractDateAnchor`
// wird vom Aufrufer übergeben (das ECHTE aktuelle careerDate, das
// renderer.js kennt, org-rosters.js aber nicht) -- der neue Vertrag beginnt
// dadurch realistisch "jetzt", nicht am festen Karriere-Startanker.
// `opts` (Masterprompt-Feature, Runde: Alterung/Ersatzspieler-System,
// optional -- der einzige bestehende Aufrufer, executeStaffSigning() in
// renderer.js, übergibt weiterhin nur die ersten 3 Argumente und verhält sich
// dadurch UNVERÄNDERT): erlaubt dem Karriereende-/Ersatz-System, das
// Potenzial UND die Altersspanne des Ersatzes gezielt zu steuern --
// "gleiche Qualitätsklasse, gleiche Potenzialklasse, aber neue
// Zufallseigenschaften UND jung genug für eine echte Karriereperspektive"
// (Auftrag). Ohne opts bleibt das Verhalten exakt wie zuvor (Potenzial
// organisch aus Overall+Alter, Alterspanne wie gehabt für Coach/Personal).
function rollReplacementPerson(centerStars, role, contractDateAnchor, opts) {
  opts = opts || {};
  const stars = clampToStarTier(centerStars + (Math.random() * 2 - 1) * 1.2);
  const targetOverall = starsToOverall(stars);
  const nations = CHARACTER_NATIONS.map((n) => n.code);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const isCoachRole = role === 'Coach';
  // Masterprompt-Erweiterung: rollReplacementPerson() kannte bisher nur
  // Coach (rollPlayer()-Statachsen) und die 8 STAFF_ROLE_ATTRIBUTES-Rollen --
  // der bisherige einzige Aufrufer (Personal-Abwerbung) übergibt nie
  // 'Starter'/'Sub'/'Reserve'. Das neue Karriereende-System braucht aber
  // GENAU diesen Fall (ein Spieler geht in Rente) -- echte Spielerpositionen
  // bekommen dieselben ROSTER_STAT_KEYS wie Coach, rein additiv, ändert am
  // bestehenden Coach-/Personal-Verhalten nichts.
  const isPlayerLikeRole = isCoachRole || role === 'Starter' || role === 'Sub' || role === 'Reserve';
  const name = isPlayerLikeRole
    ? pick(ROSTER_NICK_PREFIXES) + pick(ROSTER_NICK_SUFFIXES)
    : (Math.random() < 0.5 ? pick(ROSTER_STAFF_FIRST_NAMES_M) : pick(ROSTER_STAFF_FIRST_NAMES_F)) + ' ' + pick(ROSTER_STAFF_LAST_NAMES);
  const defaultAgeMin = isPlayerLikeRole ? 17 : 24;
  const defaultAgeMax = isPlayerLikeRole ? 32 : 55;
  const ageMin = opts.ageMin !== undefined ? opts.ageMin : defaultAgeMin;
  const ageMax = opts.ageMax !== undefined ? opts.ageMax : defaultAgeMax;
  const age = Math.round(ageMin + Math.random() * (ageMax - ageMin));
  const contractStart = contractDateAnchor;
  const contractEnd = addMonthsToDateStr(contractStart, Math.round(12 + Math.random() * 24));
  // Bug-Fix (Personal-Seite, per Live-Test gefunden): ein abgeworbener Coach
  // bekam bisher WEDER die 6 Spieler-Statachsen (rollPlayer()) NOCH
  // rollenspezifische Attribute -- die Person-Info-Seite hätte für einen
  // ersetzten Coach danach gar keine Statachsen mehr angezeigt (hasStats-
  // Check schlägt fehl). Jetzt genau wie beim initialen Kaderaufbau: Coach
  // (und, neu, echte Spielerpositionen) bekommt ROSTER_STAT_KEYS um
  // targetOverall gestreut, die 8 echten Personal-Rollen bekommen ihre
  // STAFF_ROLE_ATTRIBUTES -- Overall wird aus den tatsächlichen Werten
  // abgeleitet (konsistent mit rollStaff()/rollPlayer()).
  let extra = {};
  let overall = targetOverall;
  if (isPlayerLikeRole) {
    ROSTER_STAT_KEYS.forEach((key) => {
      extra[key] = Math.max(45, Math.min(95, Math.round(targetOverall + (Math.random() * 2 - 1) * 4)));
    });
    overall = Math.round(ROSTER_STAT_KEYS.reduce((sum, k) => sum + extra[k], 0) / ROSTER_STAT_KEYS.length);
  } else if (STAFF_ROLE_ATTRIBUTES[role]) {
    extra = generateStaffAttributes(role, targetOverall, Math.random);
    const keys = Object.keys(extra);
    overall = keys.length > 0 ? Math.round(keys.reduce((sum, k) => sum + extra[k], 0) / keys.length) : targetOverall;
  }
  const minHeadroom = isPlayerLikeRole ? 5 : 9;
  // Potenzial-Klasse: wenn der Aufrufer eine ZIEL-Potenzial-Sternebewertung
  // vorgibt (Karriereende-Ersatz), wird direkt um DIESEN Wert gestreut (leichte
  // Zufallsstreuung ±0,6 Sterne, damit der Ersatz nicht exakt identisch
  // wirkt) -- garantiert mindestens overall, sonst (normale Abwerbung ohne
  // Vorgabe) organisch aus Overall+Alter wie beim initialen Kaderaufbau.
  const potential = opts.potentialStars !== undefined
    ? Math.max(overall, Math.min(99, starsToOverall(clampToStarTier(opts.potentialStars + (Math.random() * 2 - 1) * 0.6))))
    : rollPotentialForOverall(overall, age, Math.random, minHeadroom);
  return { name, country: pick(nations), avatarId: pick(CHARACTER_AVATARS).id, age, ...extra, overall, potential, contractStart, contractEnd };
}

// ── Freie Agenten (Runde 120, User-Vorgabe: "bei scouting sollen auch die
// freien personal und spieler angezeigt werden" + "bot team ... nächst
// besseren trade ... den er sich mit seinem budget leisten kann") ──────────
// FREE_AGENT_PLAYERS/FREE_AGENT_STAFF (data/free-agents.js) enthalten nur
// Name+Statwerte -- kein Land/Alter/Avatar, und bewusst KEINEN Vertrag (ein
// "freier" Agent hat per Definition keinen). hydrateFreeAgentIdentity()
// ergänzt Land/Avatar/Alter NUR EINMAL direkt auf dem Pool-Objekt selbst
// (`if (entry.country) return` -- In-Place-Cache), damit dieselbe Person bei
// wiederholten Scouting-Re-Renders (Suche/Filter/Pagination) stabil bleibt,
// statt bei jedem Aufruf neu zu würfeln.
function hydrateFreeAgentIdentity(entry, isPlayerAgeRange, role) {
  if (!entry.country) {
    const nations = CHARACTER_NATIONS.map((n) => n.code);
    entry.country = nations[Math.floor(Math.random() * nations.length)];
    entry.avatarId = CHARACTER_AVATARS[Math.floor(Math.random() * CHARACTER_AVATARS.length)].id;
    entry.age = isPlayerAgeRange ? Math.round(17 + Math.random() * 15) : Math.round(24 + Math.random() * 31);
    // Personal-Seite: freie Mitarbeiter-Agenten (FREE_AGENT_STAFF, data/free-agents.js)
    // haben nur `name`/`overall` (handkuratierte, feste Werte) -- Attribute
    // werden UM das bestehende `overall` gestreut, `overall` selbst bleibt
    // bewusst unangetastet (kuratierte Datenverteilung soll nicht verschoben
    // werden, anders als beim prozeduralen Org-Kader-Aufbau).
    if (role && STAFF_ROLE_ATTRIBUTES[role]) {
      Object.assign(entry, generateStaffAttributes(role, entry.overall, Math.random));
    }
    // Masterprompt-Feature: dieselbe In-Place-Cache-Regel wie Land/Alter/Avatar
    // oben -- Potenzial wird beim ersten Scouting-Aufruf einmalig gewürfelt und
    // bleibt danach stabil (wichtig, weil executePlayerSigning()/signStaffMember()
    // diesen exakten Pool-Eintrag später per Spread kopiert, siehe
    // signFreeAgentPlayer()/signFreeAgentStaff() -- ohne Cache würde jeder
    // Aufruf ein anderes Potenzial würfeln, bevor der Spieler überhaupt
    // verpflichtet wird).
    entry.potential = rollPotentialForOverall(entry.overall, entry.age, Math.random, role && STAFF_ROLE_ATTRIBUTES[role] ? 9 : 5);
  }
  return entry;
}

function freeAgentPlayerPool() {
  return FREE_AGENT_PLAYERS.map((p) => hydrateFreeAgentIdentity(p, true));
}

function freeAgentStaffPool(role) {
  return (FREE_AGENT_STAFF[role] || []).map((p) => hydrateFreeAgentIdentity(p, false, role));
}

// Verwandelt einen Pool-Eintrag beim tatsächlichen Verpflichten in eine
// eigenständige KOPIE mit echtem Vertrag (der Pool-Eintrag selbst bleibt
// unverändert -- Vergeben-Status läuft separat über signedFreeAgentPlayers/
// signedFreeAgentStaff in renderer.js, nicht über eine Mutation hier).
function signFreeAgentPlayer(entry, contractDateAnchor) {
  const contractStart = contractDateAnchor;
  const contractEnd = addMonthsToDateStr(contractStart, Math.round(12 + Math.random() * 24));
  return { ...entry, contractStart, contractEnd };
}
function signFreeAgentStaff(entry, role, contractDateAnchor) {
  const contractStart = contractDateAnchor;
  const contractEnd = addMonthsToDateStr(contractStart, Math.round(12 + Math.random() * 24));
  return { role, ...entry, contractStart, contractEnd };
}

// Bestmöglicher LEISTBARER Kandidat aus `pool` für ein Bot-Team, das gerade
// einen Spieler verkauft hat ("nächst besseren trade ... den er sich mit
// seinem budget leisten kann"). Kein leistbarer Kandidat übrig? Der Kader
// darf trotzdem nicht unvollständig bleiben -- nimmt dann den güns­tigsten
// verfügbaren (leichte Budget-Überschreitung in Kauf, dasselbe Prinzip wie
// rollReplacementPerson() oben, das ebenfalls ohne Budget-Deckelung
// arbeitet).
function bestAffordableFreeAgent(pool, maxPrice) {
  if (pool.length === 0) return null;
  const affordable = pool.filter((p) => calculatePrice(p.overall) <= maxPrice);
  if (affordable.length > 0) {
    return affordable.reduce((best, p) => (p.overall > best.overall ? p : best));
  }
  return pool.reduce((cheapest, p) => (p.overall < cheapest.overall ? p : cheapest));
}

// Aktueller Marktwert eines Kaders (identische Formel wie computeOrgBudget()
// in organizations.js, aber LIVE über den jeweils AKTUELLEN Kader statt nur
// einmalig beim Org-Aufbau) -- Grundlage für orgRemainingBudget().
function orgRosterMarketValue(roster) {
  return roster.starters.reduce((sum, p) => sum + calculatePrice(p.overall), 0)
    + (roster.sub ? calculatePrice(roster.sub.overall) : 0)
    + (roster.coach ? calculatePrice(roster.coach.overall) : 0);
}

// Wie viel "Luft" eine Org unter ihrem FESTEN Gesamtbudget (org.budget, siehe
// computeOrgBudget()) aktuell noch hat -- keine eigene, laufend abschmelzende
// Bot-Kasse (die gibt es im Datenmodell nicht), sondern der Spielraum
// zwischen dem einmal festgelegten Budget-Deckel und dem GERADE aktuellen
// Kaderwert. Verkauft die Org einen Spieler, sinkt der Kaderwert sofort --
// genau dieser freigewordene Spielraum ist es, den sie sich für den
// nächstbesseren Trade "leisten kann".
function orgRemainingBudget(org) {
  return Math.max(0, org.budget - orgRosterMarketValue(org.roster));
}
