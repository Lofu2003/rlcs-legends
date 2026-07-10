// Coach-Pool — echte RLCS-Coach-Namen (verifiziert über Liquipedia-Teamseiten:
// Karmine Corp, Team Vitality/Gentle Mates, NRG, Team Falcons, FURIA,
// Spacestation Gaming, Gen.G, Moist Esports, Ninjas in Pyjamas, Endpoint,
// Twisted Minds, Lilmix — nicht aus dem Gedächtnis geraten, siehe
// data/test-players.js für dieselbe Vorgehensweise bei Spielern).
//
// Gleiche Stat-Achsen wie Spieler (Mechanics, Game Sense, Speed, Shooting,
// Defending, Boost Management) statt eigener Coach-Stats — User-Wunsch, damit
// Coach- und Spieler-Overall/Preis direkt vergleichbar sind (calculatePrice()
// ist dieselbe Funktion für beide). "overall" ist der Durchschnitt.
//
// WICHTIG: Reine Spielwerte, keine echte Fähigkeits-Einschätzung dieser
// Personen — siehe Disclaimer im Hauptmenü/KONZEPT.md.
const TEST_COACHES = [
  { name: "Ferra", mechanics: 76, gameSense: 72, speed: 75, shooting: 76, defending: 82, boostMgmt: 70 },
  { name: "Extra", mechanics: 80, gameSense: 79, speed: 77, shooting: 82, defending: 75, boostMgmt: 80 },
  { name: "Eversax", mechanics: 61, gameSense: 60, speed: 59, shooting: 60, defending: 52, boostMgmt: 63 },
  { name: "Satthew", mechanics: 93, gameSense: 85, speed: 81, shooting: 85, defending: 85, boostMgmt: 88 },
  { name: "d7oom-24", mechanics: 61, gameSense: 60, speed: 59, shooting: 53, defending: 59, boostMgmt: 60 },
  { name: "STL", mechanics: 65, gameSense: 73, speed: 78, shooting: 78, defending: 81, boostMgmt: 78 },
  { name: "Xpére", mechanics: 64, gameSense: 59, speed: 55, shooting: 67, defending: 65, boostMgmt: 67 },
  { name: "Chrome", mechanics: 71, gameSense: 65, speed: 76, shooting: 76, defending: 63, boostMgmt: 72 },
  { name: "Sadjunior", mechanics: 90, gameSense: 86, speed: 80, shooting: 79, defending: 82, boostMgmt: 81 },
  { name: "noah", mechanics: 69, gameSense: 81, speed: 72, shooting: 73, defending: 70, boostMgmt: 81 },
  { name: "Prof", mechanics: 95, gameSense: 95, speed: 91, shooting: 85, defending: 84, boostMgmt: 87 },
  { name: "LBP", mechanics: 75, gameSense: 77, speed: 75, shooting: 78, defending: 79, boostMgmt: 77 },
  { name: "fAsi", mechanics: 71, gameSense: 85, speed: 77, shooting: 77, defending: 81, boostMgmt: 79 },
  { name: "Snaski", mechanics: 71, gameSense: 78, speed: 87, shooting: 74, defending: 83, boostMgmt: 82 },
  { name: "Eclipse", mechanics: 85, gameSense: 73, speed: 84, shooting: 85, defending: 79, boostMgmt: 82 },
  { name: "Keda", mechanics: 52, gameSense: 52, speed: 60, shooting: 57, defending: 64, boostMgmt: 54 },
  { name: "ANDYTHEMANDY", mechanics: 77, gameSense: 69, speed: 69, shooting: 73, defending: 73, boostMgmt: 72 },
  { name: "HOSK", mechanics: 87, gameSense: 87, speed: 82, shooting: 85, defending: 87, boostMgmt: 78 },
  { name: "RawGreg", mechanics: 63, gameSense: 72, speed: 71, shooting: 64, defending: 70, boostMgmt: 68 },
  { name: "Kevpert", mechanics: 83, gameSense: 89, speed: 89, shooting: 95, defending: 86, boostMgmt: 84 },
  { name: "BeastBound", mechanics: 57, gameSense: 61, speed: 65, shooting: 60, defending: 64, boostMgmt: 53 },
  { name: "ignaa", mechanics: 75, gameSense: 73, speed: 70, shooting: 67, defending: 72, boostMgmt: 71 },
  { name: "Bunnz", mechanics: 78, gameSense: 86, speed: 81, shooting: 77, defending: 76, boostMgmt: 78 },
  { name: "Lem0naZ", mechanics: 52, gameSense: 52, speed: 57, shooting: 61, defending: 52, boostMgmt: 64 },
].map((c) => ({
  ...c,
  overall: Math.round((c.mechanics + c.gameSense + c.speed + c.shooting + c.defending + c.boostMgmt) / 6),
}));
