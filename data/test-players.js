// Spieler-Pool — echte RLCS-Profispieler-Namen (verifiziert über Liquipedia/
// aktuelle RLCS-2025-Rosters, nicht aus dem Gedächtnis geraten), gleiche
// Stat-Achsen wie rocket-sim (Mechanics, Game Sense, Speed, Shooting,
// Defending, Boost Management). Preis wird aus dem Overall-Wert abgeleitet.
//
// Overall/Stats sind ab jetzt an der REALEN kompetitiven Reputation jedes
// Spielers ausgerichtet (recherchiert über Liquipedia-Achievements, RLCS-
// Ergebnisse, Weltmeister-/Major-Titel, aktueller vs. vergangener Status —
// nicht geraten): GOAT-/Legenden-Tier (mehrfache Weltmeister, z.B. Kaydop,
// Turbopolsa, GarrettG) liegt bei 96-99, aktuelle Top-Spieler (z.B. zen,
// Vatira, M0nkey M00n) bei 90-96, solide Profis mit LAN-/Major-Erfahrung bei
// 76-88, weniger bekannte/regionale Spieler bei 65-73. Absolute Zahlen bleiben
// trotzdem Spielwerte fürs Balancing, keine offizielle Bewertung durch
// Psyonix/Epic Games o.ä. RLCS Legends ist ein inoffizielles Fan-Projekt ohne
// Verbindung zu den genannten Spielern/Organisationen (siehe KONZEPT.md).
//
// Als globale Variable definiert (kein CommonJS module.exports) — der Renderer-
// Prozess läuft mit nodeIntegration:false wie eine normale Webseite und lädt
// diese Datei per <script src="...">, nicht per require().
const TEST_PLAYERS = [
  // ── Legenden-Tier (mehrfache Weltmeister, GOAT-Diskussion) ────────────────
  { name: "Kaydop", overall: 98, mechanics: 96, gameSense: 99, speed: 97, shooting: 97, defending: 98, boostMgmt: 99 },
  { name: "Turbopolsa", overall: 97, mechanics: 94, gameSense: 98, speed: 94, shooting: 96, defending: 98, boostMgmt: 99 },
  { name: "GarrettG", overall: 97, mechanics: 99, gameSense: 95, speed: 96, shooting: 98, defending: 95, boostMgmt: 96 },
  { name: "ViolentPanda", overall: 96, mechanics: 98, gameSense: 94, speed: 96, shooting: 98, defending: 93, boostMgmt: 95 },
  { name: "Fairy Peak!", overall: 94, mechanics: 92, gameSense: 97, speed: 92, shooting: 90, defending: 98, boostMgmt: 95 },
  { name: "justin.", overall: 96, mechanics: 95, gameSense: 97, speed: 95, shooting: 96, defending: 96, boostMgmt: 97 },

  // ── Aktuelle Top-Spieler (Worlds-/Major-Champions der letzten Saisons) ────
  { name: "Vatira", overall: 96, mechanics: 99, gameSense: 95, speed: 96, shooting: 97, defending: 93, boostMgmt: 96 },
  { name: "M0nkey M00n", overall: 95, mechanics: 94, gameSense: 96, speed: 93, shooting: 91, defending: 99, boostMgmt: 97 },
  { name: "zen", overall: 95, mechanics: 98, gameSense: 92, speed: 95, shooting: 97, defending: 91, boostMgmt: 97 },
  { name: "BeastMode", overall: 93, mechanics: 94, gameSense: 91, speed: 95, shooting: 96, defending: 89, boostMgmt: 93 },
  { name: "Atomic", overall: 93, mechanics: 92, gameSense: 93, speed: 94, shooting: 92, defending: 93, boostMgmt: 94 },
  { name: "Daniel", overall: 92, mechanics: 90, gameSense: 93, speed: 95, shooting: 94, defending: 90, boostMgmt: 90 },
  { name: "dralii", overall: 92, mechanics: 96, gameSense: 89, speed: 93, shooting: 94, defending: 88, boostMgmt: 92 },
  { name: "ExoTiiK", overall: 91, mechanics: 90, gameSense: 92, speed: 89, shooting: 91, defending: 92, boostMgmt: 92 },
  { name: "Atow.", overall: 90, mechanics: 91, gameSense: 90, speed: 89, shooting: 92, defending: 88, boostMgmt: 90 },
  { name: "Nwpo", overall: 90, mechanics: 95, gameSense: 86, speed: 92, shooting: 94, defending: 84, boostMgmt: 89 },

  // ── Solide Profis (LAN-/Major-Erfahrung, respektiert, nicht Top-of-the-food-chain) ──
  { name: "Archie", overall: 86, mechanics: 88, gameSense: 86, speed: 84, shooting: 85, defending: 87, boostMgmt: 86 },
  { name: "Joyo", overall: 85, mechanics: 86, gameSense: 85, speed: 83, shooting: 84, defending: 86, boostMgmt: 86 },
  { name: "Firstkiller", overall: 84, mechanics: 85, gameSense: 83, speed: 80, shooting: 88, defending: 83, boostMgmt: 85 },
  { name: "DRUFINHO", overall: 83, mechanics: 84, gameSense: 82, speed: 83, shooting: 82, defending: 84, boostMgmt: 83 },
  { name: "Amphis", overall: 83, mechanics: 82, gameSense: 81, speed: 84, shooting: 85, defending: 81, boostMgmt: 85 },
  { name: "ApparentlyJack", overall: 82, mechanics: 81, gameSense: 82, speed: 85, shooting: 80, defending: 82, boostMgmt: 82 },
  { name: "Joreuz", overall: 82, mechanics: 80, gameSense: 83, speed: 84, shooting: 80, defending: 83, boostMgmt: 82 },
  { name: "stizzy", overall: 81, mechanics: 79, gameSense: 81, speed: 82, shooting: 85, defending: 79, boostMgmt: 80 },
  { name: "Fever", overall: 81, mechanics: 79, gameSense: 84, speed: 80, shooting: 83, defending: 80, boostMgmt: 80 },
  { name: "Lj", overall: 80, mechanics: 78, gameSense: 80, speed: 83, shooting: 79, defending: 81, boostMgmt: 79 },
  { name: "CHEESE.", overall: 80, mechanics: 80, gameSense: 79, speed: 81, shooting: 80, defending: 78, boostMgmt: 82 },
  { name: "MaJicBear", overall: 80, mechanics: 81, gameSense: 82, speed: 79, shooting: 78, defending: 81, boostMgmt: 79 },
  { name: "Lostt", overall: 80, mechanics: 79, gameSense: 80, speed: 81, shooting: 82, defending: 77, boostMgmt: 81 },
  { name: "Superlachie", overall: 79, mechanics: 77, gameSense: 79, speed: 82, shooting: 80, defending: 77, boostMgmt: 79 },
  { name: "Torsos", overall: 79, mechanics: 78, gameSense: 80, speed: 77, shooting: 79, defending: 81, boostMgmt: 79 },
  { name: "Chronic", overall: 78, mechanics: 76, gameSense: 78, speed: 80, shooting: 79, defending: 76, boostMgmt: 79 },
  { name: "AtomiK", overall: 78, mechanics: 80, gameSense: 77, speed: 78, shooting: 78, defending: 76, boostMgmt: 79 },
  { name: "rise.", overall: 78, mechanics: 77, gameSense: 78, speed: 77, shooting: 78, defending: 79, boostMgmt: 79 },
  { name: "Catalysm", overall: 78, mechanics: 76, gameSense: 77, speed: 79, shooting: 80, defending: 77, boostMgmt: 79 },
  { name: "kaka", overall: 77, mechanics: 75, gameSense: 77, speed: 78, shooting: 77, defending: 76, boostMgmt: 79 },
  { name: "bananahead", overall: 77, mechanics: 76, gameSense: 78, speed: 76, shooting: 77, defending: 77, boostMgmt: 78 },
  { name: "yANXNZ", overall: 77, mechanics: 75, gameSense: 79, speed: 76, shooting: 79, defending: 76, boostMgmt: 77 },
  { name: "Motta", overall: 76, mechanics: 76, gameSense: 77, speed: 75, shooting: 78, defending: 74, boostMgmt: 76 },
  { name: "Trk511", overall: 76, mechanics: 78, gameSense: 74, speed: 73, shooting: 75, defending: 77, boostMgmt: 79 },
  { name: "Rw9", overall: 76, mechanics: 74, gameSense: 76, speed: 73, shooting: 78, defending: 79, boostMgmt: 76 },

  // ── Regionale/weniger bekannte Spieler (reale Karrieren, begrenzte Top-Erfolge) ──
  { name: "Kiileerrz", overall: 73, mechanics: 74, gameSense: 70, speed: 72, shooting: 75, defending: 72, boostMgmt: 75 },
  { name: "kofyr", overall: 72, mechanics: 68, gameSense: 75, speed: 74, shooting: 70, defending: 75, boostMgmt: 70 },
  { name: "Scrzbbles", overall: 71, mechanics: 68, gameSense: 69, speed: 70, shooting: 73, defending: 73, boostMgmt: 73 },
  { name: "oaly.", overall: 70, mechanics: 68, gameSense: 70, speed: 69, shooting: 72, defending: 70, boostMgmt: 71 },
  { name: "reveal", overall: 69, mechanics: 71, gameSense: 67, speed: 70, shooting: 68, defending: 70, boostMgmt: 68 },
  { name: "kv1", overall: 68, mechanics: 67, gameSense: 70, speed: 65, shooting: 69, defending: 67, boostMgmt: 70 },
  { name: "swiftt", overall: 67, mechanics: 66, gameSense: 65, speed: 66, shooting: 72, defending: 65, boostMgmt: 68 },
];
