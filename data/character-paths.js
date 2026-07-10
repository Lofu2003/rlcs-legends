// Charakter-Wege: frei erfundene Hintergrundgeschichten (keine echten Personen,
// daher keine Recherche nötig wie bei Spielern/Coaches/Orgas) — jede gibt einen
// klaren spielmechanischen Effekt (Bonus, Malus oder bewusst gar keinen), der in
// bereits bestehende Systeme eingreift statt nur Flavourtext zu sein:
//   budgetMultiplier      -> wirkt auf das Startbudget (assignedOrg.budget)
//   developmentBonus      -> zusätzlicher Stat-Drift pro Saison (developPlayer)
//   seasonIncomeBonus     -> Cr-Bonus pro Saison (calculateSeasonIncome)
//   frustrationMultiplier -> wirkt auf den Frust-Zuwachs bei Verhandlungen
const CHARACTER_PATHS = [
  {
    id: 'ex-pro',
    title: 'Ex-Profispieler',
    description: 'Du warst selbst jahrelang im Wettkampf-Modus unterwegs. Du erkennst Talent auf den ersten Blick.',
    effectLabel: 'Bonus: Spieler entwickeln sich zwischen den Saisons etwas schneller.',
    budgetMultiplier: 1.0,
    developmentBonus: 1,
    seasonIncomeBonus: 0,
    frustrationMultiplier: 1.0,
  },
  {
    id: 'investor',
    title: 'Investor',
    description: 'Du kommst aus der Business-Welt und bringst dein eigenes Kapital mit in die Organisation.',
    effectLabel: 'Bonus: +10% Startbudget.',
    budgetMultiplier: 1.1,
    developmentBonus: 0,
    seasonIncomeBonus: 0,
    frustrationMultiplier: 1.0,
  },
  {
    id: 'streamer',
    title: 'Streamer / Content Creator',
    description: 'Deine Community verfolgt jeden Schritt mit. Sponsoren lieben deine Reichweite.',
    effectLabel: 'Bonus: zusätzliches Sponsoring-Einkommen pro Saison.',
    budgetMultiplier: 1.0,
    developmentBonus: 0,
    seasonIncomeBonus: 80,
    frustrationMultiplier: 1.0,
  },
  {
    id: 'ex-coach',
    title: 'Ex-Coach',
    description: 'Du hast früher selbst ein kleines Team gecoacht und kennst die Sprache der Verhandlungsführung.',
    effectLabel: 'Bonus: Verhandlungen mit Bot-Orgas bauen langsamer Frust auf.',
    budgetMultiplier: 1.0,
    developmentBonus: 0,
    seasonIncomeBonus: 0,
    frustrationMultiplier: 0.75,
  },
  {
    id: 'newcomer',
    title: 'Quereinsteiger',
    description: 'Kein Vorwissen, keine Kontakte — du fängst wirklich bei null an.',
    effectLabel: 'Neutral: keine Boni, keine Mali.',
    budgetMultiplier: 1.0,
    developmentBonus: 0,
    seasonIncomeBonus: 0,
    frustrationMultiplier: 1.0,
  },
  {
    id: 'gambler',
    title: 'Glücksspieler',
    description: 'Du hast dein letztes Geld in diese Chance gesteckt. Ein riskanter Start ohne Sicherheitsnetz.',
    effectLabel: 'Malus: -15% Startbudget.',
    budgetMultiplier: 0.85,
    developmentBonus: 0,
    seasonIncomeBonus: 0,
    frustrationMultiplier: 1.0,
  },
];

function findCharacterPath(id) {
  return CHARACTER_PATHS.find((p) => p.id === id) || null;
}
