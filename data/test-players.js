// Test-Spieler-Pool — gleiche Stat-Achsen wie rocket-sim (Mechanics, Game Sense, Speed,
// Shooting, Defending, Boost Management). Preis wird aus dem Overall-Wert abgeleitet
// (fürs Budget-Cap-Draften in einem späteren Schritt).

// Als globale Variable definiert (kein CommonJS module.exports) — der Renderer-Prozess
// läuft mit nodeIntegration:false wie eine normale Webseite und lädt diese Datei per
// <script src="...">, nicht per require().
const TEST_PLAYERS = [
  { name: 'Nova',    overall: 82, mechanics: 85, gameSense: 80, speed: 83, shooting: 84, defending: 78, boostMgmt: 80 },
  { name: 'Kestrel', overall: 79, mechanics: 81, gameSense: 77, speed: 80, shooting: 76, defending: 82, boostMgmt: 79 },
  { name: 'Vex',     overall: 75, mechanics: 74, gameSense: 79, speed: 72, shooting: 78, defending: 70, boostMgmt: 76 },
  { name: 'Halo',    overall: 88, mechanics: 90, gameSense: 87, speed: 85, shooting: 91, defending: 84, boostMgmt: 88 },
  { name: 'Ember',   overall: 70, mechanics: 68, gameSense: 73, speed: 71, shooting: 65, defending: 74, boostMgmt: 69 },
  { name: 'Onyx',    overall: 77, mechanics: 76, gameSense: 75, speed: 79, shooting: 74, defending: 80, boostMgmt: 73 },
  { name: 'Piston',  overall: 73, mechanics: 72, gameSense: 70, speed: 76, shooting: 71, defending: 68, boostMgmt: 75 },
  { name: 'Ridge',   overall: 80, mechanics: 78, gameSense: 82, speed: 77, shooting: 79, defending: 85, boostMgmt: 78 },
  { name: 'Sable',   overall: 66, mechanics: 64, gameSense: 68, speed: 65, shooting: 62, defending: 70, boostMgmt: 67 },
  { name: 'Talon',   overall: 85, mechanics: 87, gameSense: 83, speed: 88, shooting: 86, defending: 79, boostMgmt: 82 },
  { name: 'Wraith',  overall: 71, mechanics: 70, gameSense: 72, speed: 69, shooting: 68, defending: 75, boostMgmt: 71 },
  { name: 'Zephyr',  overall: 76, mechanics: 75, gameSense: 74, speed: 78, shooting: 77, defending: 72, boostMgmt: 74 },
];
