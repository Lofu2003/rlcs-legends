// Strategien-Datenbank. Rocket-League-passende Spielstile (NICHT CS-artige
// Bombsite-/Map-Taktiken wie im generischen Referenz-Screenshot, siehe
// Kopfkommentare in data/shop-items.js/data/sponsors.js für dieselbe bereits
// etablierte Begründung: erfundene Attribute ohne Entsprechung im echten
// Spiel werden bewusst vermieden). statRequirements verwenden ausschließlich
// die 6 ECHTEN Spieler-Statachsen (mechanics/gameSense/speed/shooting/
// defending/boostMgmt, siehe ROSTER_STAT_KEYS in org-rosters.js) -- jeder
// Spieler hat hier bereits individuell unterschiedliche Werte (rollPlayer()),
// die Strategie-Eignung eines Teams ergibt sich also automatisch aus den
// echten, individuellen Spielerwerten der 3 Starter, kein neues Attribut-
// system nötig.
//
// modifiers: acht taktische Dimensionen (offense/defense/tempo/pressing/
// possession/rotation/counter/boost), grob -30..+30, aus der Spielstil-
// Beschreibung abgeleitet. Werden von renderer.js zu EINEM Netto-Prozent-
// Bonus verrechnet (strategyBaseNetPct()) und fließen über den bereits
// bestehenden orgMatchBonusPct-Kanal (wie Team-Chemie/Traits/Ausrüstung) in
// die auditierte match.js-Engine ein -- keine Match-Phasen-Engine vorhanden,
// deshalb kein Eingriff in match.js selbst, siehe Kommentar bei
// computeActiveStrategyMatchBonusPct() in renderer.js.
//
// riskLevel (1-5) bestimmt riskVariance (Streuung der Gaussian-Zufallszahl,
// die den tatsächlichen Bonus pro Serie bestimmt) -- eine riskantere
// Strategie hat denselben ERWARTUNGSWERT-Charakter, aber deutlich mehr
// Schwankung nach oben UND unten ("Risiko" ist damit echt simulationswirksam,
// nicht nur Text).
//
// counters: Liste von Strategie-IDs, gegen die diese Strategie einen kleinen
// Bonus bekommt (siehe counterPlayAdjustmentPct() in renderer.js) -- bewusst
// klein (+/-3%), KEIN "Strategie A schlägt Strategie B automatisch".
const STRATEGIES = [
  {
    id: 'balanced',
    name: 'Ausgewogen',
    category: 'balanciert',
    emoji: '⚖️',
    color: 'hsl(220, 15%, 40%)',
    playstyle: 'Ausgeglichene Offensive und Defensive ohne Extreme.',
    description: 'Stabile Rotationen und konstante Leistung -- kein ausgeprägter Spielstil, dafür wenig Angriffsfläche.',
    pros: ['Stabile Rotationen', 'Geringe Fehleranfälligkeit', 'Gute Anpassbarkeit', 'Konstante Performance'],
    cons: ['Keine extreme Stärke', 'Weniger Druck als aggressive Strategien', 'Schwächeres Konterspiel'],
    riskLevel: 2, riskLabel: 'NIEDRIG',
    modifiers: { offense: 8, defense: 8, tempo: 5, pressing: 5, possession: 5, rotation: 12, counter: 5, boost: 5 },
    statRequirements: { mechanics: 0.25, gameSense: 0.25, speed: 0.25, boostMgmt: 0.25 },
    counters: [],
    suitedFor: 'Teams ohne extrem ausgeprägten Spielstil.',
  },
  {
    id: 'aggressive-pressing',
    name: 'Aggressives Pressing',
    category: 'pressing',
    emoji: '🔥',
    color: 'hsl(9, 65%, 42%)',
    playstyle: 'Sehr hoher Druck auf den Gegner -- nach Ballverlust wird sofort wieder Druck aufgebaut.',
    description: 'Hoher Druck auf den Ball, schnelle Challenges und frühe Rückeroberung nach Ballverlust.',
    pros: ['Mehr Ballrückgewinnungen im gegnerischen Drittel', 'Mehr Torchancen', 'Höheres Spieltempo', 'Gegner hat weniger Zeit'],
    cons: ['Höhere Boost-Kosten', 'Riskantere Challenges', 'Größere Lücken bei schlechtem Timing', 'Anfälliger für schnelle Konter'],
    riskLevel: 5, riskLabel: 'HOCH',
    modifiers: { offense: 22, defense: -12, tempo: 20, pressing: 32, possession: -15, rotation: -15, counter: -18, boost: -15 },
    statRequirements: { mechanics: 0.3, speed: 0.3, gameSense: 0.25, boostMgmt: 0.15 },
    counters: ['possession'],
    suitedFor: 'Teams mit hoher Mechanik, Geschwindigkeit und Spielverständnis.',
  },
  {
    id: 'possession',
    name: 'Ballbesitz / Control',
    category: 'ballbesitz',
    emoji: '🎯',
    color: 'hsl(210, 55%, 42%)',
    playstyle: 'Das Team versucht, Ballbesitz zu halten -- Spieler vermeiden unnötige Challenges.',
    description: 'Kontrollierter Spielaufbau, Ballbesitz wird gehalten statt riskiert -- Angriffe werden sauber vorbereitet.',
    pros: ['Bessere Ballkontrolle', 'Weniger unnötige Ballverluste', 'Bessere Angriffsvorbereitung', 'Geringere Konteranfälligkeit'],
    cons: ['Weniger direktes Spiel', 'Langsamere Angriffe', 'Kann bei zu passivem Spiel Torchancen kosten'],
    riskLevel: 2, riskLabel: 'NIEDRIG-MITTEL',
    modifiers: { offense: 8, defense: 12, tempo: -12, pressing: -10, possession: 28, rotation: 10, counter: 15, boost: 8 },
    statRequirements: { mechanics: 0.3, gameSense: 0.35, boostMgmt: 0.2, defending: 0.15 },
    counters: ['counter', 'defensive-wall'],
    suitedFor: 'Teams mit hohem Spielverständnis und sauberer Mechanik.',
  },
  {
    id: 'counter',
    name: 'Konterspiel',
    category: 'konter',
    emoji: '⚡',
    color: 'hsl(45, 65%, 42%)',
    playstyle: 'Das Team zieht sich etwas zurück und wartet auf Fehler des Gegners -- nach Ballgewinn wird sofort umgeschaltet.',
    description: 'Kontrolliertes Abwarten, dann schnelles Umschalten -- lebt von den Fehlern und der Übermotivation des Gegners.',
    pros: ['Starke Konter', 'Hohe Chancen nach gegnerischen Fehlern', 'Geringeres Risiko bei eigenem Ballverlust', 'Gute Effizienz'],
    cons: ['Weniger Ballbesitz', 'Weniger eigene Kontrolle', 'Schwierig gegen sehr defensive Gegner'],
    riskLevel: 3, riskLabel: 'MITTEL',
    modifiers: { offense: 15, defense: 10, tempo: 5, pressing: -15, possession: -18, rotation: 5, counter: 25, boost: 5 },
    statRequirements: { speed: 0.3, gameSense: 0.3, shooting: 0.25, defending: 0.15 },
    counters: ['aggressive-pressing'],
    suitedFor: 'Teams mit guter Geschwindigkeit und kaltblütigem Abschluss.',
  },
  {
    id: 'fast-rotations',
    name: 'High Speed / Fast Rotations',
    category: 'offensiv',
    emoji: '💨',
    color: 'hsl(190, 60%, 42%)',
    playstyle: 'Extrem schnelle Rotationen und hohes Spieltempo.',
    description: 'Ununterbrochene, schnelle Rotationen -- das Team ist ständig in Bewegung und hält den Gegner unter Dauerdruck.',
    pros: ['Schnellere Unterstützung', 'Höhere Dynamik', 'Mehr Druck', 'Schnellere Transition'],
    cons: ['Hoher Boost-Verbrauch', 'Höhere Fehlerquote', 'Schlechtes Timing zerstört Rotationen', 'Besonders anspruchsvoll'],
    riskLevel: 5, riskLabel: 'HOCH',
    modifiers: { offense: 15, defense: -5, tempo: 28, pressing: 15, possession: 0, rotation: -18, counter: 8, boost: -22 },
    statRequirements: { speed: 0.35, boostMgmt: 0.3, gameSense: 0.2, mechanics: 0.15 },
    counters: [],
    suitedFor: 'Teams mit hoher Geschwindigkeit und gutem Boost-Management.',
  },
  {
    id: 'defensive-wall',
    name: 'Defensive Wall',
    category: 'defensiv',
    emoji: '🛡️',
    color: 'hsl(215, 30%, 38%)',
    playstyle: 'Defensive Priorität -- das Team hält sich stärker zurück und schützt das eigene Tor.',
    description: 'Kompakte Defensivformation, das eigene Tor wird konsequent geschützt -- Sicherheit vor Risiko.',
    pros: ['Weniger Gegentore', 'Stabilere Defensive', 'Höhere Save-Wahrscheinlichkeit', 'Geringere Konteranfälligkeit'],
    cons: ['Weniger Torchancen', 'Weniger Druck', 'Gegner bekommt mehr Ballbesitz'],
    riskLevel: 1, riskLabel: 'SEHR NIEDRIG',
    modifiers: { offense: -15, defense: 28, tempo: -10, pressing: -15, possession: -5, rotation: 15, counter: 10, boost: 12 },
    statRequirements: { defending: 0.4, gameSense: 0.3, boostMgmt: 0.15, speed: 0.15 },
    counters: [],
    suitedFor: 'Teams mit starker Verteidigung und gutem Spielverständnis, besonders bei Führung.',
  },
  {
    id: 'disruption',
    name: 'Demo / Disruption',
    category: 'pressing',
    emoji: '💥',
    color: 'hsl(280, 45%, 42%)',
    playstyle: 'Gezielte Demos/Bumps und Störung des gegnerischen Aufbaus.',
    description: 'Bewusstes Stören der gegnerischen Rotation durch aggressive Positionierung -- erzeugt Chaos und erzwingt Fehler.',
    pros: ['Gegnerische Rotation wird gestört', 'Gegner verliert kurzzeitig einen Spieler', 'Erzeugt Chaos', 'Kann Torchancen erzwingen'],
    cons: ['Spieler verlassen teilweise ihre Position', 'Rotationen werden riskanter', 'Fehlschläge erzeugen Räume', 'Benötigt gutes Timing'],
    riskLevel: 5, riskLabel: 'HOCH',
    modifiers: { offense: 12, defense: -8, tempo: 10, pressing: 20, possession: -10, rotation: -15, counter: 5, boost: -10 },
    statRequirements: { speed: 0.3, gameSense: 0.3, defending: 0.25, mechanics: 0.15 },
    counters: [],
    suitedFor: 'Teams mit guter Geschwindigkeit und Spielverständnis für präzises Timing.',
  },
  {
    id: 'mechanical',
    name: 'Air Control / Mechanical Play',
    category: 'offensiv',
    emoji: '🌀',
    color: 'hsl(320, 55%, 42%)',
    playstyle: 'Mechanisch starke Spieler sollen ihre individuellen Fähigkeiten stärker ausspielen.',
    description: 'Individuelle Mechanik-Stärke wird gezielt eingesetzt -- Freiraum für Air Dribbles, Flicks und kreative Einzelaktionen.',
    pros: ['Höhere individuelle Playmaking-Chancen', 'Stärkere Ballkontrolle', 'Mehr kreative Offensivaktionen'],
    cons: ['Höhere Fehlerwahrscheinlichkeit bei schwächeren Spielern', 'Weniger abgesichert', 'Stark abhängig von individueller Mechanik'],
    riskLevel: 4, riskLabel: 'MITTEL-HOCH',
    modifiers: { offense: 20, defense: -5, tempo: 8, pressing: 5, possession: 8, rotation: -10, counter: 5, boost: 0 },
    statRequirements: { mechanics: 0.45, shooting: 0.25, gameSense: 0.3 },
    counters: [],
    suitedFor: 'Teams mit mechanisch außergewöhnlich starken Spielern.',
  },
];

// riskVariance zentral aus riskLevel abgeleitet statt bei jeder Strategie
// einzeln getippt (0.4 [Level 1] bis 2.4 [Level 5], siehe Kopfkommentar).
STRATEGIES.forEach((s) => { s.riskVariance = 0.4 + s.riskLevel * 0.4; });

const STRATEGY_CATEGORIES = [
  { id: 'all', label: 'ALLE' },
  { id: 'offensiv', label: 'OFFENSIV' },
  { id: 'defensiv', label: 'DEFENSIV' },
  { id: 'balanciert', label: 'BALANCIERT' },
  { id: 'konter', label: 'KONTER' },
  { id: 'ballbesitz', label: 'BALLBESITZ' },
  { id: 'pressing', label: 'PRESSING' },
];

const STRATEGY_MODIFIER_LABELS = {
  offense: 'Offensive', defense: 'Defensive', tempo: 'Tempo', pressing: 'Pressing',
  possession: 'Ballbesitz', rotation: 'Rotation', counter: 'Konter', boost: 'Boost-Effizienz',
};
