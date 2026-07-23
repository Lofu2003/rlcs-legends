// Charaktererstellung: Trait-Achsen-System (ersetzt das alte, statische
// "6 feste Wege"-System aus character-paths.js). Jede Achse ist ein
// Paar aus zwei EIGENSTÄNDIGEN Polen (z.B. Kommunikation UND Finanzkompetenz,
// nicht "entweder-oder"), je ein Regler von 0-20 -- beide Pole derselben
// Achse können gleichzeitig > 0 sein. Ein gemeinsamer Punkte-Pool begrenzt,
// wie weit ALLE Pole zusammen (12 Stück, 6 Achsen × 2 Pole) ausgereizt werden
// können (siehe CHARACTER_POINT_POOL) — echte Trade-off-Entscheidung über den
// gesamten Charakter, nicht pro Achse.
//
// Jeder Pol trägt (linear skaliert mit Reglerwert/20) zu genau den
// bestehenden Spielmechanik-Hooks bei, die vorher von character-paths.js
// bedient wurden (budgetMultiplier/developmentBonus/seasonIncomeBonus/
// frustrationMultiplier), plus einem neuen Hook (matchBonusPct), der sich
// wie der Org-/Coach-Bonus in match.js einreiht (siehe renderer.js, Aufruf
// von simulateMatch()).
const CHARACTER_POINT_POOL = 24;

const CHARACTER_TRAIT_AXES = [
  {
    id: 'kommunikation-finanzkompetenz',
    leftLabel: 'KOMMUNIKATION',
    rightLabel: 'FINANZKOMPETENZ',
    left: { frustrationMultiplier: -0.25 }, // ruhigere, sanftere Verhandlungen
    right: { budgetMultiplier: 0.15 }, // besseres Verhandlungsgeschick bei der Org-Übernahme
  },
  {
    id: 'produktivitaet-stressresistenz',
    leftLabel: 'PRODUKTIVITÄT',
    rightLabel: 'STRESSRESISTENZ',
    left: { developmentBonus: 3 }, // effizientere Trainingspläne
    right: { matchBonusPct: 4 }, // Team bleibt unter Druck stabiler
  },
  {
    id: 'delegation-oeffentliches-bild',
    leftLabel: 'DELEGATION',
    rightLabel: 'ÖFFENTLICHES BILD',
    left: { developmentBonus: 2 }, // delegiert Trainingsarbeit an die Coaches
    right: { seasonIncomeBonus: 100000 }, // zieht Sponsoren an
  },
  {
    id: 'fuehrung-vision',
    leftLabel: 'FÜHRUNG',
    rightLabel: 'VISION',
    left: { matchBonusPct: 5 }, // motiviert das Team direkt im Match
    right: { seasonIncomeBonus: 60000 }, // langfristige strategische Investoren
  },
  {
    id: 'moral-loyalitaet',
    leftLabel: 'MORAL',
    rightLabel: 'LOYALITÄT',
    left: { frustrationMultiplier: -0.15 }, // hält die Stimmung in Verhandlungen sachlich
    right: { budgetMultiplier: 0.05 }, // treue, langfristige Partner
  },
  {
    id: 'konfliktneigung-immunitaet',
    leftLabel: 'KONFLIKTNEIGUNG',
    rightLabel: 'IMMUNITÄT',
    left: { frustrationMultiplier: 0.35 }, // Malus: eckt an, Verhandlungen eskalieren schneller
    right: { frustrationMultiplier: -0.2 }, // bleibt immun gegen Reibungen
  },
];

// Reine Berechnung ohne DOM-Zugriff, wie vorher findCharacterPath() — wird an
// jeder Verbraucherstelle frisch aufgerufen (Budget-Zuweisung, Spielerent-
// wicklung, Saison-Einkommen, Verhandlungs-Frust, Match-Bonus), nie gecacht.
function computeCharacterEffects(traits) {
  const t = traits || {};
  let budgetMultiplier = 1;
  let developmentBonus = 0;
  let seasonIncomeBonus = 0;
  let frustrationMultiplier = 1;
  let matchBonusPct = 0;

  function applyPole(pole, frac) {
    if (!pole) return;
    if (pole.budgetMultiplier) budgetMultiplier += pole.budgetMultiplier * frac;
    if (pole.developmentBonus) developmentBonus += pole.developmentBonus * frac;
    if (pole.seasonIncomeBonus) seasonIncomeBonus += pole.seasonIncomeBonus * frac;
    if (pole.frustrationMultiplier) frustrationMultiplier += pole.frustrationMultiplier * frac;
    if (pole.matchBonusPct) matchBonusPct += pole.matchBonusPct * frac;
  }

  // entry ist normalerweise { left, right }. Alte Speicherstände (vor dem
  // Umbau auf zwei unabhängige Pole) hatten hier eine einzelne signierte
  // Zahl -- ".left"/".right" darauf ist sicheres undefined (kein Crash),
  // wirkt also einfach wie "0 Punkte investiert" statt eine Migration zu
  // brauchen.
  CHARACTER_TRAIT_AXES.forEach((axis) => {
    const entry = t[axis.id];
    const leftVal = (entry && entry.left) || 0;
    const rightVal = (entry && entry.right) || 0;
    if (leftVal > 0) applyPole(axis.left, leftVal / 20);
    if (rightVal > 0) applyPole(axis.right, rightVal / 20);
  });

  return {
    budgetMultiplier,
    developmentBonus: Math.round(developmentBonus),
    seasonIncomeBonus: Math.round(seasonIncomeBonus),
    frustrationMultiplier: Math.max(0.3, frustrationMultiplier),
    matchBonusPct,
  };
}

// Neutrale Trait-Werte (beide Pole jeder Achse auf 0) -- Default beim Start
// der Charaktererstellung UND Fallback beim Laden alter Speicherstände, die
// das Trait-System noch nicht kannten.
function defaultCharacterTraits() {
  const traits = {};
  CHARACTER_TRAIT_AXES.forEach((axis) => { traits[axis.id] = { left: 0, right: 0 }; });
  return traits;
}

// Nationen-Auswahl (rein kosmetisch, wie vorher die Region) -- Länder mit
// Bezug zum Rocket-League-Esport. Flaggen als echte SVG-Dateien
// (assets/flags/<code>.svg, aus dem MIT-lizenzierten "flag-icons"-Paket
// übernommen) statt Unicode-Flaggen-Emoji: Electrons Chromium-Build shaped
// die aus zwei Regional-Indicator-Zeichen zusammengesetzten Flaggen-Emoji
// auf diesem System nicht zu echten Flaggen-Glyphen (zeigt stattdessen nur
// den zweistelligen Ländercode als Text) -- das betrifft ALLE Textknoten,
// nicht nur natives <select>, daher hilft auch kein Wechsel auf ein
// Custom-Dropdown allein.
const CHARACTER_NATIONS = [
  { code: 'DE', name: 'Deutschland' },
  { code: 'FR', name: 'Frankreich' },
  { code: 'GB', name: 'Vereinigtes Königreich' },
  { code: 'ES', name: 'Spanien' },
  { code: 'NL', name: 'Niederlande' },
  { code: 'BE', name: 'Belgien' },
  { code: 'SE', name: 'Schweden' },
  { code: 'NO', name: 'Norwegen' },
  { code: 'DK', name: 'Dänemark' },
  { code: 'PL', name: 'Polen' },
  { code: 'FI', name: 'Finnland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italien' },
  { code: 'AT', name: 'Österreich' },
  { code: 'CH', name: 'Schweiz' },
  { code: 'US', name: 'USA' },
  { code: 'CA', name: 'Kanada' },
  { code: 'MX', name: 'Mexiko' },
  { code: 'BR', name: 'Brasilien' },
  { code: 'AR', name: 'Argentinien' },
  { code: 'CL', name: 'Chile' },
  { code: 'SA', name: 'Saudi-Arabien' },
  { code: 'MA', name: 'Marokko' },
  { code: 'EG', name: 'Ägypten' },
  { code: 'AU', name: 'Australien' },
  { code: 'NZ', name: 'Neuseeland' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'Südkorea' },
  { code: 'ZA', name: 'Südafrika' },
];

// Avatar-Presets (rein kosmetisch): Emoji-Badges statt echtem Foto-Upload --
// kein Datei-/Bildverarbeitungs-Subsystem nötig, konsistent mit den Emoji-
// Icons, die im Rest der App bereits überall verwendet werden (Menü, Org-
// Auswahl, Modus-Auswahl usw.).
const CHARACTER_AVATARS = [
  { id: 'm1', gender: 'M', emoji: '🧑‍💼', color: '#3a5bff' },
  { id: 'm2', gender: 'M', emoji: '👨‍💼', color: '#2a9d8f' },
  { id: 'm3', gender: 'M', emoji: '🧔', color: '#e07a5f' },
  { id: 'm4', gender: 'M', emoji: '👨🏾‍💼', color: '#f4a261' },
  { id: 'm5', gender: 'M', emoji: '👨🏻‍💻', color: '#6f8bff' },
  { id: 'f1', gender: 'F', emoji: '👩‍💼', color: '#ff5a8c' },
  { id: 'f2', gender: 'F', emoji: '👩🏽‍💼', color: '#c77dff' },
  { id: 'f3', gender: 'F', emoji: '👩🏻‍💻', color: '#4cc9f0' },
  { id: 'f4', gender: 'F', emoji: '👩🏾‍🦱', color: '#ffb703' },
  { id: 'f5', gender: 'F', emoji: '👩‍🦰', color: '#80ed99' },
];

// Namenspools für "Alles zufällig"/"Manager auswählen" -- frei erfunden
// (wie schon bei den bisherigen Charakter-Wegen), keine echten Personen.
const CHARACTER_RANDOM_FIRST_NAMES_M = ['Samuel', 'Lukas', 'Finn', 'Paul', 'Jonas', 'Max', 'Leon', 'Tim', 'Elias', 'Noah'];
const CHARACTER_RANDOM_FIRST_NAMES_F = ['Sophie', 'Marie', 'Laura', 'Emma', 'Julia', 'Lena', 'Anna', 'Nina', 'Mia', 'Lea'];
const CHARACTER_RANDOM_LAST_NAMES = ['Torres', 'Weber', 'Hoffmann', 'Berger', 'Kessler', 'Nilsson', 'Dubois', 'Rossi', 'Novak', 'Andersen'];
const CHARACTER_RANDOM_NICK_PREFIXES = ['Ruby', 'Shadow', 'Nova', 'Frost', 'Blaze', 'Zero', 'Volt', 'Echo', 'Phantom', 'Apex'];
const CHARACTER_RANDOM_NICK_SUFFIXES = ['Ghost', 'Strike', 'Wolf', 'Storm', 'King', 'Prime', 'Rex', 'Byte', 'Falcon', 'Nova'];
