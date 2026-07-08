// Test-Coach-Pool. Eigene Stat-Achsen (anders als Spieler): Taktik, Teamgeist,
// Entwicklung. "overall" ist der Durchschnitt und wird für Preis/Tier verwendet,
// genau wie bei Spielern (gleiche calculatePrice()-Funktion, siehe pricing.js).
const TEST_COACHES = [
  { name: 'Coach Silva',     taktik: 88, teamgeist: 80, entwicklung: 84 },
  { name: 'Coach Reyes',     taktik: 75, teamgeist: 85, entwicklung: 70 },
  { name: 'Coach Voss',      taktik: 82, teamgeist: 74, entwicklung: 79 },
  { name: 'Coach Lindqvist', taktik: 68, teamgeist: 72, entwicklung: 66 },
  { name: 'Coach Osei',      taktik: 79, teamgeist: 90, entwicklung: 81 },
  { name: 'Coach Tanaka',    taktik: 71, teamgeist: 66, entwicklung: 73 },
].map((c) => ({
  ...c,
  overall: Math.round((c.taktik + c.teamgeist + c.entwicklung) / 3),
}));
