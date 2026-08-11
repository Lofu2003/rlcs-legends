// Shop-Produktdatenbank. Deterministisch prozedural generiert (gleiches Muster
// wie SPONSORS in sponsors.js / ORG_REAL_ROSTER_NAMES in org-rosters.js: fester
// mulberry32-Seed pro Item-Index, keine echten Marken) -- so bleibt der Katalog
// bei jedem Spielstart identisch UND lässt sich beliebig erweitern, indem man
// SHOP_CATEGORIES ergänzt oder ITEMS_PER_CATEGORY erhöht, ohne die UI-Logik in
// renderer.js anzufassen (die iteriert nur über SHOP_ITEMS).
//
// statBonuses verwenden bewusst dieselben 6 Statachsen wie die Spielerdatenbank
// (siehe ROSTER_STAT_KEYS in org-rosters.js / PLAYER_STAT_KEYS in renderer.js:
// mechanics/gameSense/speed/shooting/defending/boostMgmt) -- KEINE erfundenen
// Business-Sim-Attribute ("Fähigkeit"/"Teamarbeit"/...) wie im generischen
// Referenz-Screenshot, da diese in einem Rocket-League-Manager keine Entsprechung
// hätten. Jede Kategorie ist thematisch 1-2 Statachsen zugeordnet (Tastatur/Maus/
// PC -> Mechanik+Tempo, Headset -> Spielverständnis+Verteidigung/Calls, Monitor ->
// Tempo+Spielverständnis, Tisch/Stuhl/Getränke -> Boost-Management als
// Ausdauer-/Energie-Anlehnung).
//
// Balancing: SHOP_EQUIPMENT_STAT_CAP (renderer.js) deckelt die SUMME aller
// gleichzeitig ausgerüsteten Boni pro Statachse hart, unabhängig vom Katalog --
// selbst wenn hier künftig weitere/stärkere Items ergänzt werden, kann eine Stat-
// achse nie unbegrenzt wachsen.

const SHOP_STAT_KEYS = ['mechanics', 'gameSense', 'speed', 'shooting', 'defending', 'boostMgmt'];

const SHOP_STAT_LABELS_FULL = {
  mechanics: 'Mechanik',
  gameSense: 'Spielverständnis',
  speed: 'Geschwindigkeit',
  shooting: 'Abschluss',
  defending: 'Verteidigung',
  boostMgmt: 'Boost-Management',
};

// id = Tab-/Filter-Wert (data-shop-tab). label = Anzeige. statFocus = welche
// Statachsen diese Kategorie thematisch beeinflusst. emoji/color = Platzhalter-
// "Bild" analog zu SPONSORS' s.emoji/s.color (kein echtes Bild-Asset im Projekt
// vorhanden, siehe Architektur-Recherche -- gleiches, bereits im Spiel etablierte
// Muster statt neuer Asset-Pipeline).
const SHOP_CATEGORIES = [
  { id: 'tastaturen', label: 'Tastaturen', emoji: '⌨️', statFocus: ['mechanics', 'speed'],
    prefixes: ['MechStorm', 'IronType', 'Keytide', 'ClickForge', 'RapidKey', 'ZeroLag'],
    suffixes: ['X9', '100', 'FX2', 'Z7', 'Pro', 'R4'] },
  { id: 'maeuse', label: 'Mäuse', emoji: '🖱️', statFocus: ['mechanics', 'shooting'],
    prefixes: ['SwiftGlide', 'PulseClick', 'NanoTrack', 'VoidSensor', 'GripFlex', 'CoreAim'],
    suffixes: ['M3', 'Air', 'Pro2', 'X1', 'Zero', 'Edge'] },
  { id: 'mauspads', label: 'Mauspads', emoji: '🟫', statFocus: ['mechanics'],
    prefixes: ['SteadySurface', 'GlideZone', 'GripMat', 'FlowPad', 'PureGlide', 'FirmBase'],
    suffixes: ['XL', 'Speed', 'Control', 'Pro', 'Mid', 'Edge'] },
  { id: 'kopfhoerer', label: 'Kopfhörer', emoji: '🎧', statFocus: ['gameSense', 'defending'],
    prefixes: ['ClearComm', 'EchoSound', 'VoxLink', 'SonicWave', 'CallClear', 'DeepFocus'],
    suffixes: ['7.1', 'Pro', 'X2', 'Elite', 'Max', 'Studio'] },
  { id: 'pcs', label: 'PCs', emoji: '🖥️', statFocus: ['mechanics', 'speed'],
    prefixes: ['ForgeCore', 'ApexTower', 'NovaRig', 'VortexBox', 'PrimeStation', 'HyperCore'],
    suffixes: ['i9', 'RTX', 'Ultra', 'Prime', 'X', 'Elite'] },
  { id: 'monitore', label: 'Monitore', emoji: '📺', statFocus: ['speed', 'gameSense'],
    prefixes: ['ClearView', 'RapidFrame', 'PixelEdge', 'FlowScreen', 'SharpSight', 'WideAngle'],
    suffixes: ['240Hz', 'QHD', 'Curve', 'Fast', 'Pro', 'Vision'] },
  { id: 'tische', label: 'Tische', emoji: '📐', statFocus: ['boostMgmt', 'gameSense'],
    prefixes: ['SteadyDesk', 'FlexFrame', 'ErgoBase', 'ProSetup', 'CleanLine', 'WorkFrame'],
    suffixes: ['Standing', 'Compact', 'XL', 'Elite', 'Pro', 'Studio'] },
  { id: 'stuehle', label: 'Stühle', emoji: '🪑', statFocus: ['boostMgmt', 'defending'],
    prefixes: ['ComfortCore', 'ErgoThrone', 'FlexSeat', 'ProRest', 'SteadyBack', 'LongSession'],
    suffixes: ['Pro', 'Elite', 'Max', 'X', 'Comfort', 'Studio'] },
  { id: 'getraenke', label: 'Getränke', emoji: '🥤', statFocus: ['boostMgmt', 'speed'],
    prefixes: ['VoltRush', 'PulseFuel', 'ZenithBoost', 'HyperCharge', 'ClearFocus', 'RapidEnergy'],
    suffixes: ['Zero', 'Max', 'Original', 'Extra', 'Pro', 'Blue'] },
];

// Basecamp-Level-Stammdaten (Hero-Anzeige auf der neuen Basecamp-Seite +
// eigene Statboni/Team-Chemie-Bonus, GENAU wie Equipment -- "Basecamp ist
// selbst Teil des Bonus-Systems", siehe equipmentStatBonuses()/
// basecampChemistryBonusPct() in renderer.js). Level 1 ist der kostenlose
// Startzustand (kein Kauf-Item, siehe basecampSteps unten -- die 4
// Ausbaustufen dort erhöhen genau dieses Level). Bonuswerte bewusst deutlich
// kleiner als die stärksten Einzel-Equipment-Items (Tier 5 = +9/Achse) --
// Basecamp soll ein spürbarer, aber kein dominanter Beitrag zum Gesamtbonus
// sein, da es (anders als Equipment) nie "gewechselt", nur graduell
// ausgebaut wird.
const BASECAMP_LEVELS = [
  { level: 1, name: 'Improvisierte Garage', type: 'GARAGE', stars: 1, statBonuses: {}, chemistryBonusPct: 0, color: 'hsl(220, 18%, 30%)' },
  { level: 2, name: 'Training Garage', type: 'BOOTCAMP', stars: 2, statBonuses: { mechanics: 1, gameSense: 1 }, chemistryBonusPct: 1, color: 'hsl(150, 32%, 30%)' },
  { level: 3, name: 'Pro Trainingscenter', type: 'TRAININGSCENTER', stars: 3, statBonuses: { mechanics: 2, gameSense: 2, boostMgmt: 1 }, chemistryBonusPct: 2, color: 'hsl(150, 38%, 32%)' },
  { level: 4, name: 'Elite Akademie', type: 'AKADEMIE', stars: 4, statBonuses: { mechanics: 3, gameSense: 3, speed: 2, boostMgmt: 2 }, chemistryBonusPct: 3, color: 'hsl(150, 44%, 34%)' },
  { level: 5, name: 'Championship Facility', type: 'ELITE-BASIS', stars: 5, statBonuses: { mechanics: 4, gameSense: 4, speed: 3, shooting: 2, defending: 2, boostMgmt: 3 }, chemistryBonusPct: 4, color: 'hsl(150, 50%, 36%)' },
];
function basecampLevelData(level) {
  return BASECAMP_LEVELS[Math.max(0, Math.min(BASECAMP_LEVELS.length - 1, (level || 1) - 1))];
}

// 5 Qualitätsstufen. bonus = Punkte je fokussierter Statachse (mousepads
// erhalten nur 1 Statachse, siehe statFocus.length-Verzweigung unten), price =
// Spanne in Euro (Wirtschaft laut ORG_CREATE_DIFFICULTY_BUDGET in renderer.js:
// 30.000 € [Schwer] bis 10.000.000 € [Leicht] Startbudget, Spielertransfers bis
// weit über 1.000.000 € -- Peripherie bleibt bewusst deutlich darunter, damit
// sie ein sinnvoller Zwischenschritt ist statt eines Rundungsfehlers im Budget).
const SHOP_TIERS = [
  { stars: 1, priceMin: 400, priceMax: 900, bonus: 1, requiredBasecampLevel: 1 },
  { stars: 2, priceMin: 1000, priceMax: 2200, bonus: 2, requiredBasecampLevel: 1 },
  { stars: 3, priceMin: 2500, priceMax: 6000, bonus: 4, requiredBasecampLevel: 2 },
  { stars: 4, priceMin: 7000, priceMax: 16000, bonus: 6, requiredBasecampLevel: 3 },
  { stars: 5, priceMin: 18000, priceMax: 40000, bonus: 9, requiredBasecampLevel: 4 },
];
const ITEMS_PER_CATEGORY_TIER_SEQUENCE = [0, 1, 2, 2, 3, 4]; // Index in SHOP_TIERS je Item einer Kategorie (6 Items/Kategorie)

function shopMulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shopHashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function buildShopItems() {
  const items = [];
  SHOP_CATEGORIES.forEach((cat) => {
    ITEMS_PER_CATEGORY_TIER_SEQUENCE.forEach((tierIdx, i) => {
      const tier = SHOP_TIERS[tierIdx];
      const id = cat.id + '-' + (i + 1);
      const rng = shopMulberry32(shopHashString(id));
      const name = cat.prefixes[i % cat.prefixes.length] + ' ' + cat.suffixes[(i * 3 + 1) % cat.suffixes.length];
      const price = Math.round((tier.priceMin + rng() * (tier.priceMax - tier.priceMin)) / 10) * 10;
      const statBonuses = {};
      // mausspads etc. mit nur 1 statFocus-Eintrag bekommen den vollen Bonus auf
      // die eine Achse statt ihn auf mehrere Achsen aufzuteilen (sonst wären
      // Mauspads gegenüber Zwei-Statachsen-Kategorien strukturell benachteiligt).
      cat.statFocus.forEach((stat) => { statBonuses[stat] = tier.bonus; });
      items.push({
        id,
        name,
        category: cat.id,
        type: 'equipment',
        price,
        stars: tier.stars,
        requiredBasecampLevel: tier.requiredBasecampLevel,
        statBonuses,
        emoji: cat.emoji,
        color: 'hsl(' + Math.round(rng() * 360) + ', 55%, 40%)',
      });
    });
  });

  // Basecamp-Kategorie: keine Statboni, sondern sequenzielle Ausbaustufen (siehe
  // basecampLevel in renderer.js). requiredBasecampLevel = Level, das man VORHER
  // erreicht haben muss -- levelValue = Level, das der Kauf freischaltet. Bewusst
  // als eigener type ('basecamp_upgrade'), damit renderer.js Kauf-/Kartenlogik
  // sauber unterscheiden kann (kein "In den Korb"-Mehrfachbesitz, kein Ausrüsten).
  const basecampSteps = [
    { levelValue: 2, price: 50000, label: 'Basecamp-Ausbau Stufe 2' },
    { levelValue: 3, price: 150000, label: 'Basecamp-Ausbau Stufe 3' },
    { levelValue: 4, price: 400000, label: 'Basecamp-Ausbau Stufe 4' },
    { levelValue: 5, price: 900000, label: 'Basecamp-Ausbau Stufe 5' },
  ];
  basecampSteps.forEach((step) => {
    items.push({
      id: 'basecamp-' + step.levelValue,
      name: step.label,
      category: 'basecamp',
      type: 'basecamp_upgrade',
      price: step.price,
      stars: step.levelValue - 1,
      requiredBasecampLevel: step.levelValue - 1,
      levelValue: step.levelValue,
      // Statboni kommen NICHT von diesem Kauf-Item selbst (es wird ja nicht
      // "ausgerüstet"), sondern werden live aus BASECAMP_LEVELS[basecampLevel]
      // gelesen (siehe equipmentStatBonuses() in renderer.js) -- hier nur zur
      // Anzeige in der Kaufkarte dupliziert, damit der Spieler vor dem Kauf
      // sieht, was die Stufe bringt.
      statBonuses: BASECAMP_LEVELS[step.levelValue - 1].statBonuses,
      emoji: '🏕️',
      color: 'hsl(150, 45%, 32%)',
    });
  });

  return items;
}

const SHOP_ITEMS = buildShopItems();
