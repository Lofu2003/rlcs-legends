// ── Turnier-Kalender-Konfiguration (Runde 43, komplett neu strukturiert in
// Runde 45 für echte RLCS-1:1-Fidelity) ───────────────────────────────────
// Rein darstellungsbezogene Daten für die "Turniere"-Dashboard-Seite --
// die eigentliche BRACKET-Turnier-SIMULATION (tournament.js/season.js,
// "Turnier starten"-Button auf dem alten Draft-Screen) ist ein separates,
// älteres System mit eigener, noch nicht überarbeiteter 3-Open-Struktur --
// User-Vorgabe explizit: "Turnier Simulation selbst Bracket etc machen wir
// nachher", deshalb bewusst NICHT angefasst. Diese Datei + die
// Region-/Anmelde-Logik in renderer.js bilden die NEUE, echte RLCS-Struktur
// nur als Kalender/Anmeldung/Teilnehmerfeld ab.
//
// Struktur 1:1 nach dem echten RLCS 2026 (per WebSearch verifiziert gegen
// rocketleague.com/liquipedia, Juli 2026 -- siehe Quellen in der
// Gesprächs-/Memory-Dokumentation dieser Runde):
// - 2 Splits pro Saison, je 3 Online-Opens (Open 1-3 -> Major 1,
//   Open 4-6 -> Major 2) -- 6 Opens gesamt, durchgehend nummeriert (nicht
//   pro Split neu bei 1 startend, echtes RLCS zählt sie 1-6 durch).
// - Danach regionale Last-Chance-Qualifier (online) und die World
//   Championship (LAN, 16 Teams per Saison-Punkte + 4 aus dem LCQ, echte
//   2026-Zahl -- bisher stand hier nur 12+4, siehe [[rlcs-legends-project]]
//   Runde 45 für den Konstanten-Abgleich, season.js selbst bewusst NICHT
//   angefasst, siehe oben).
// Echte 2026-Eckdaten zum Vergleich: Major 1 Boston 19.-22.02., Major 2
// Paris 20.-24.05., World Championship Fort Worth 15.-20.09. -- unsere
// komprimierte Version (Karriere startet immer 01.01., siehe careerDate)
// bildet dieselbe REIHENFOLGE UND denselben Rhythmus (Opens -> Major ->
// Opens -> Major -> LCQ -> Worlds) auf Jan-Okt ab, nicht exakt dieselben
// Kalenderwochen -- disclosed Kompression, siehe Rückmeldung an den User.
//
// Jedes Event durchläuft 4 Phasen (Tage pro Phase siehe unten):
// Anmeldung -> Qualifikation -> Start (Playoffs) -> Finale.
// Runde 94, User-Korrektur ("Open Qualifier soll nur 3 Tage laufen statt 7,
// Open 1-6 ebenfalls 3, Major 5, LCQ 4, Worlds 3" + explizite Tag-für-Tag-
// Stage-Zuordnung): `qualification`+`start`+`finals` bilden jetzt zusammen
// GENAU eine Tag-pro-Stage-Enthüllung ab (siehe renderTournamentFormatTabs()/
// revealedStepCount() in renderer.js) -- `start` ist dabei bewusst auf 0
// Tage gesetzt (keine eigene Zwischenphase mehr), `finals` ist immer der
// EINE letzte Enthüllungstag (Playoffs/Finale), `qualification` deckt alle
// vorherigen Stages ab (StageAnzahl - 1 Tage). Disclosed Annahme: "3/5/4/3
// Tage" wurde als reine Qualifikation+Start+Finale-Spanne interpretiert
// (Anmeldung bleibt als eigener, zusätzlicher Tag davor bestehen) --
// User-Korrektur willkommen, falls die Anmeldung mitgezählt werden sollte.
// Runde 99, User-Vorgabe ("ein Tag nach der Anmeldung, wo nicht gespielt,
// sondern nur die Teams im Bracket/Swiss zugewiesen werden -- ein Tag später
// wird dann gespielt"): die `start`-Phase (vorher IMMER 0 Tage, siehe
// Kommentar an TOURNAMENT_EVENT_DEFS unten) wandert von "nach der
// Qualifikation" auf "direkt nach der Anmeldung" und bekommt jetzt bei jedem
// Event genau 1 Tag -- der neue Auslosungstag. Die eigentliche Instant-
// Simulation läuft weiterhin komplett am Tag NACH der Anmeldung
// (tournamentResolutionTriggerDate() in renderer.js, unverändert), sie fällt
// jetzt also auf den ERSTEN Tag DIESER Phase -- revealedStepCount() (siehe
// dort) verankert sich unverändert an qualification.start, das durch diesen
// eingeschobenen Tag automatisch 1 Tag später liegt. Ergebnis: am
// Auslosungstag selbst existiert das Ergebnis intern schon (Instant-
// Philosophie), revealedStepCount() liefert dort aber 0 -- renderer.js zeigt
// an diesem einen Tag nur die feststehenden STARTPAARUNGEN der ersten Stage
// (Bracket/Swiss-Runde-1/Gruppenzuteilung), noch ganz ohne Ergebnis (siehe
// fillStageAssignmentOnly()).
// Runde 103, User-Vorgabe ("bei Swiss soll jede interne Runde ihren eigenen
// Kalendertag bekommen, nicht alles auf einmal"): jede Swiss-Stage (Open 1-6/
// LCQ/Worlds) braucht jetzt SWISS_REVEAL_ROUNDS (5, siehe renderer.js) statt
// nur 1 Tag -- `qualification` ist deshalb bei allen Events mit Swiss-Stage
// entsprechend gewachsen (Open 1-6: 2->6 [5 Swiss-Runden + 1 Gruppenphase-
// Tag], LCQ: 3->7 [1 Vorrunde + 5 Swiss-Runden + 1 Gruppenphase-Tag], Worlds:
// 2->6 [1 Play-In-Tag + 5 Swiss-Runden]) -- das VERLÄNGERT diese Turniere
// entsprechend um 4 Kalendertage, eine direkte, notwendige Folge des Wunsches
// nach echter Tag-für-Tag-Swiss-Enthüllung (steht in Spannung zur Runde-94-
// Kalender-Kompression, aber explizit vom User so gewollt). Major/open0
// bleiben unverändert (kein Swiss-Format).
const TOURNAMENT_PHASE_KEYS = ['registration', 'start', 'qualification', 'finals'];
// `transferWindow` ist KEIN echter Turnier-Phasenschlüssel (nicht Teil von
// TOURNAMENT_PHASE_KEYS/TOURNAMENT_EVENT_DEFS) -- Runde 101, User-Vorgabe
// ("Transferphase soll auch im Kalender eingezeichnet sein"): renderer.js'
// tournamentPhaseMapForMonth() trägt das Transferfenster (siehe
// TRANSFER_WINDOW_START/END_MONTH_DAY unten) separat in dieselbe Balken-/
// Label-Anzeige ein, die die echten Turnierphasen schon nutzen -- braucht
// dafür nur denselben Label-/Icon-Lookup-Schlüssel.
const TOURNAMENT_PHASE_LABELS = {
  registration: 'Anmeldung', start: 'Auslosung', qualification: 'Qualifikation', finals: 'Finale',
  transferWindow: 'Transferfenster',
};
const TOURNAMENT_PHASE_ICONS = {
  registration: '📝', start: '🎲', qualification: '⏳', finals: '🏆',
  transferWindow: '💰',
};

// `points` ist ein reiner Anzeige-Wert (max. erreichbare "Punkte"-Zahl für
// die Liste) -- keine echte Verzahnung mit der (bewusst unangetasteten)
// season.js-Punktetabelle, siehe Kopfkommentar. `prizeMin` (Runde 45-101,
// eine frei geschätzte Preisgeld-Untergrenze) ist Runde 102 komplett
// ENTFALLEN: der angezeigte Turnier-Gesamtpreispool wird jetzt direkt aus
// OPEN_PRIZE_TABLE/MAJOR_PRIZE_TABLE/WORLDS_PRIZE_TABLE aufsummiert (siehe
// tournamentEventPrize() in renderer.js) -- User-Vorgabe: "Gesamtpreisgeld
// muss passend zur Preisgeld-Platzierungsverteilung übereinstimmen". open0
// (isSeasonGate, kein echter Sieger) und lcq (User: "hat kein Preisgeld,
// entfernen") haben bewusst KEINE Tabelle -> Preisgeld automatisch 0.
// `phases.qualification` muss bei jedem Format mindestens
// totalRevealStepsForEvent()-1 Tage bieten (der letzte Enthüllungsschritt
// liegt in `finals`, siehe tournamentResolutionTriggerDate()/
// revealedStepCount() in renderer.js) -- Runde 105, User-Vorgabe ("nach jeder
// Stage-Übergabe ein Auslosungstag, nicht nur am Anfang"): jede Stage NACH
// der ersten bekommt jetzt einen zusätzlichen Auslosungstag VOR ihrer eigenen
// Enthüllung (buildStageStepPlan()) -- Open 1-6 (Swiss->Gruppenphase->
// Playoffs, 2 spätere Stages) 6->8, LCQ (Info->Swiss->Gruppenphase->
// Playoffs, 3 spätere Stages, wobei Info keine eigene Stage zählt) 7->10,
// Major (Gruppenphase->Playoffs, 1 spätere Stage, eigenes groupRevealCount-
// System) 4->5. Worlds (Play-In->Gruppenphase->Playoffs) brauchte KEINE
// Erhöhung -- hatte schon vorher genug Kalender-Puffer (6 Tage bei nur 5
// tatsächlich benötigten), ein Überbleibsel der alten Vor-Runde-79/80-Swiss-
// Berechnung, das harmlos ungenutzt blieb.
const TOURNAMENT_EVENT_DEFS = [
  // Runde 79, User-Vorgabe: neues Saison-ERÖFFNUNGSTURNIER im Januar (bisher
  // bewusst turnierfrei, siehe TOURNAMENT_EVENT_END_MONTH-Kommentar -- diese
  // Entscheidung wird hiermit explizit AUFGEHOBEN, User-Wunsch). KEINE
  // Slot-Grenze -- jede Org der Region nimmt teil (Anmeldung durch den
  // Spieler weiterhin nötig für das eigene Team, alle Bot-Orgs gelten als
  // automatisch angemeldet). Funktioniert als SAISON-ZUGANGSTOR (Runde 92,
  // komplett umgebaut -- vorher nur ein Konzept ohne eigene Simulation):
  // reines Doppel-K.o. (2 Niederlagen = raus), gestoppt sobald noch genau 32
  // Teams pro Region übrig sind (siehe simulateOpenQualifierBracket() in
  // renderer.js) -- KEIN Swiss/Gruppenphase/Playoffs, KEIN Turniersieger,
  // KEINE Saison-Punkte (points:0, siehe pointsTableForEvent()). Diese 32
  // dürfen an Open 1-6/Major 1-2/Weltmeisterschaft dieser Saison teilnehmen --
  // alle anderen sind für den Rest der Saison komplett gesperrt und können
  // sich erst beim Last-Chance-Qualifier (falls dort regional zugelassen)
  // wieder anmelden.
  { key: 'open0', eventType: 'open', openIndex: -1, split: 0, label: 'Open Qualifier', tierLabel: 'Tier 3', stars: 1,
    format: 'Online', color: '#8a91a8', icon: '🌐', points: 0,
    unlimitedSlots: true, isSeasonGate: true,
    phases: { registration: 1, qualification: 2, start: 1, finals: 1 } },
  { key: 'open1', eventType: 'open', openIndex: 0, split: 1, label: 'Open 1', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e05c5c', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'open2', eventType: 'open', openIndex: 1, split: 1, label: 'Open 2', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e8a23e', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'open3', eventType: 'open', openIndex: 2, split: 1, label: 'Open 3', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e8c23e', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'major1', eventType: 'major', split: 1, label: 'Major 1', tierLabel: 'Tier 1', stars: 4,
    format: 'LAN', color: '#4f8cf7', icon: '🎯', points: 300,
    phases: { registration: 1, qualification: 5, start: 1, finals: 1 } },
  { key: 'open4', eventType: 'open', openIndex: 3, split: 2, label: 'Open 4', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e05c5c', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'open5', eventType: 'open', openIndex: 4, split: 2, label: 'Open 5', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e8a23e', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'open6', eventType: 'open', openIndex: 5, split: 2, label: 'Open 6', tierLabel: 'Tier 2', stars: 2,
    format: 'Online', color: '#e8c23e', icon: '🌐', points: 100,
    phases: { registration: 1, qualification: 8, start: 1, finals: 1 } },
  { key: 'major2', eventType: 'major', split: 2, label: 'Major 2', tierLabel: 'Tier 1', stars: 4,
    format: 'LAN', color: '#4f8cf7', icon: '🎯', points: 300,
    phases: { registration: 1, qualification: 5, start: 1, finals: 1 } },
  { key: 'lcq', eventType: 'lcq', label: 'Last Chance Qualifier', tierLabel: 'Tier 1', stars: 3,
    format: 'Online', color: '#a05cf7', icon: '⚔️', points: 60,
    phases: { registration: 1, qualification: 10, start: 1, finals: 1 } },
  { key: 'worlds', eventType: 'worlds', label: 'World Championship', tierLabel: 'Tier 1', stars: 5,
    format: 'LAN', color: '#3ecf72', icon: '🏆', points: 500,
    phases: { registration: 1, qualification: 6, start: 1, finals: 1 } },
];

// Austragungsorte für die LAN-Events (Major/Weltmeisterschaft) -- Open
// Qualifier/LCQ sind wie im echten RLCS online. Ländercodes spiegeln
// CHARACTER_NATIONS (data/character-traits.js) für die bestehenden
// assets/flags/<code>.svg-Flaggen.
const TOURNAMENT_HOST_LOCATIONS = [
  { country: 'SA', city: 'Riyadh' }, { country: 'BE', city: 'Brüssel' }, { country: 'CA', city: 'Vancouver' },
  { country: 'DE', city: 'Köln' }, { country: 'US', city: 'Las Vegas' }, { country: 'GB', city: 'London' },
  { country: 'FR', city: 'Paris' }, { country: 'KR', city: 'Seoul' }, { country: 'JP', city: 'Tokio' },
  { country: 'SE', city: 'Stockholm' },
];

// Monats-Anker pro Event (Runde 46, User-Korrektur zu Runde 45): jedes
// Event endet am LETZTEN Tag seines Monats (statt am 1. zu starten -- die
// Finale-Phase fällt dadurch auf den Monatsletzten, der Rest der Phasen
// zählt von dort rückwärts). Reihenfolge/Rhythmus bleibt exakt wie im
// echten RLCS: Open Qualifier (Saison-Zugangstor) -> 3 Opens -> Major -> 3
// Opens -> Major -> LCQ -> Worlds, je 1 Monat pro Event. Runde 79, User-
// Vorgabe: das neue Saison-Zugangsturnier (`open0`) belegt jetzt Januar --
// hebt die Runde-46-Entscheidung "Januar bleibt turnierfrei" bewusst auf.
// Dezember bleibt weiterhin als Season-Pause vor der nächsten Saison frei.
const TOURNAMENT_EVENT_END_MONTH = {
  open0: 1, open1: 2, open2: 3, open3: 4, major1: 5,
  open4: 6, open5: 7, open6: 8, major2: 9,
  lcq: 10, worlds: 11,
};
const TOURNAMENT_SEASON_1_YEAR = 2026; // deckt sich mit careerDate-Start (siehe renderer.js)

// ── Regionen-Slots + Qualifikations-Zahlen (Runde 45, reine REGEL-DATEN) ──
// Per WebSearch gegen den echten RLCS-2026-Kalender verifiziert (Juli 2026,
// rocketleague.com/liquipedia). Bewusst NUR Daten, NOCH NICHT an eine echte
// Punkte-Berechnung/Tabelle angebunden -- User-Vorgabe: "Tabelle... machen
// wir später" und "Turnier Simulation selbst... machen wir nachher". Diese
// Konstanten dokumentieren die Zielregeln, damit eine spätere Runde sie nur
// noch verdrahten muss, statt sie neu recherchieren zu müssen.
//
// Major-Slots pro Region (16 Teams gesamt) -- Runde 79: vom User in der
// ausführlichen Saison-Spezifikation explizit BESTÄTIGT (vorher disclosed
// als plausible Verteilung, jetzt keine Annahme mehr): EU 5, NA 4, SAM 2,
// MENA 2, APAC 1, OCE 1, SSA 1 -- Platz 1 bis N der jeweiligen Region in
// der Open-Punkte-Jahrestabelle (siehe OPEN_POINTS_TABLE) ziehen ein.
const MAJOR_REGION_SLOTS = { EU: 5, NA: 4, SAM: 2, MENA: 2, APAC: 1, OCE: 1, SSA: 1 };

// Weltmeisterschaft: 20 Teams gesamt -- 16 über die Saison-Punkte (über
// beide Splits/alle Regionen hinweg), 4 über den Last-Chance-Qualifier.
// (Das aktuell noch aktive, separate ALTE Simulationssystem in season.js
// hat hier weiterhin WORLDS_DIRECT_QUALIFIERS=12/WORLDS_SIZE=16 stehen --
// bewusst NICHT angefasst, siehe Kopfkommentar dieser Datei.)
const WORLDS_DIRECT_QUALIFIER_COUNT = 16;
const WORLDS_LCQ_QUALIFIER_COUNT = 4;
const WORLDS_TOTAL_TEAMS = WORLDS_DIRECT_QUALIFIER_COUNT + WORLDS_LCQ_QUALIFIER_COUNT;

// ── Punkte-Systeme (Runde 79, komplette User-Spezifikation) ───────────────
// Reine REGEL-DATEN, noch NICHT an eine echte Punkte-Berechnung angebunden
// (siehe Kopfkommentar dieser Datei -- "Turnier-Simulation selbst machen
// wir nachher" gilt unverändert: es gibt noch keine Bracket-Ergebnis-
// Engine für die NEUE Dashboard-Turnierstruktur, nur die Regel-Tabellen
// hier). Jeder Eintrag: Platzierungs-Bereich (inklusiv), die Runde/den
// Record, bei dem ein Team dort ausscheidet, und die Punktzahl.
//
// Open-Format (Runde 92: gilt NUR noch für Open 1-6 -- der Open Qualifier
// (open0) hat sein eigenes, separates Doppel-K.o.-System ohne Punkte, siehe
// simulateOpenQualifierBracket() in renderer.js). Struktur: Swiss(32) ->
// Gruppenphase/GSL(16) -> Playoffs(8). Die "17+"-Zeile ist ein reines
// Sicherheitsnetz für den (nach Runde 92 eigentlich unerreichbaren) Fall,
// dass das Feld doch einmal über 32 hinausgeht.
const OPEN_POINTS_TABLE = [
  { minPlace: 17, maxPlace: null, stage: 'Open Qualifiers (Doppel-K.o.)', record: null, points: 0 },
  { minPlace: 15, maxPlace: 16, stage: 'Swiss Stage', record: '0-3', points: 0 },
  { minPlace: 12, maxPlace: 14, stage: 'Swiss Stage', record: '1-3', points: 1 },
  { minPlace: 9, maxPlace: 11, stage: 'Swiss Stage', record: '2-3', points: 2 },
  { minPlace: 5, maxPlace: 8, stage: 'Gruppenphase / GSL', record: null, points: 4 },
  { minPlace: 3, maxPlace: 4, stage: 'Halbfinale verloren (Playoffs)', record: null, points: 7 },
  { minPlace: 2, maxPlace: 2, stage: 'Finale verloren (Playoffs)', record: null, points: 10 },
  { minPlace: 1, maxPlace: 1, stage: 'Turniersieger (Playoffs)', record: null, points: 15 },
];

// Major-Format (16 Teams). Runde 80, User-Korrektur (echte RLCS-2026-
// Recherche): die Runde-79-Annahme "Major startet direkt mit einer echten
// Swiss Stage" war FALSCH -- das Schweizer System wurde bei den Majors 2026
// komplett abgeschafft. Echtes Format: 4 Round-Robin-Gruppen à 4 Teams
// (jeder gegen jeden, Bo5), siehe WORLDS_MAJOR_GROUP_STAGE_FORMAT unten.
// Die Platzierungs-Bänder (15.-16./12.-14./9.-11.) bleiben zahlenmäßig
// bestehen (2+3+3 = 8 nicht qualifizierte Teams, deckt sich mit "Top 2 von
// 4 Gruppen = 8 ziehen bei Major 1 weiter"), der `record`-Wert (z.B. "0-3")
// war aber ein Swiss-Artefakt und wurde entfernt, da eine Round-Robin-
// Gruppenplatzierung keinen sinnvollen W-L-"Badge" in dieser Form hat.
// Die Punkte-WERTE selbst bleiben unverändert (User hat nur das Format
// korrigiert, keine neue Punkteverteilung vorgegeben). Runde 79, User-
// Korrektur: 2. Platz gibt 20 Punkte (nicht wie ursprünglich angegeben 14,
// das war ein Tippfehler -- vom User im Nachgang bestätigt: "2. Platz 20
// Punkte, 3.-4. Platz 14 Punkte").
const MAJOR_POINTS_TABLE = [
  { minPlace: 15, maxPlace: 16, stage: 'Gruppenphase (Round-Robin)', record: null, points: 0 },
  { minPlace: 12, maxPlace: 14, stage: 'Gruppenphase (Round-Robin)', record: null, points: 2 },
  { minPlace: 9, maxPlace: 11, stage: 'Gruppenphase (Round-Robin)', record: null, points: 4 },
  { minPlace: 5, maxPlace: 8, stage: 'Viertelfinale verloren (Playoffs)', record: null, points: 8 },
  { minPlace: 3, maxPlace: 4, stage: 'Halbfinale verloren (Playoffs)', record: null, points: 14 },
  { minPlace: 2, maxPlace: 2, stage: 'Finale verloren (Playoffs)', record: null, points: 20 },
  { minPlace: 1, maxPlace: 1, stage: 'Major-Sieger (Playoffs)', record: null, points: 30 },
];

// ── Preisgeld-Platzierungstabellen (Runde 102, komplette User-Vorgabe) ────
// Ersetzt den bisherigen Runde-101-Platzhalter ("nur der komplette
// Turniersieg zahlt den vollen Pool aus") -- jetzt bekommt JEDE Platzierung
// einen eigenen Anteil, analog zu OPEN_POINTS_TABLE/MAJOR_POINTS_TABLE, aber
// in echtem Geld statt Saison-Punkten. `place`-Werte in den `placements`-
// Arrays der resolveXxxEvent()-Funktionen (renderer.js) sind bewusst TIER-
// ANKER, keine eindeutigen Einzelränge (z.B. "place:9" für JEDEN Platz
// 9-11/9-12, siehe dortiger Kommentar) -- die Bänder hier sind absichtlich
// so gewählt, dass jeder bereits vorhandene Anker-Wert unverändert in genau
// EIN Preisgeld-Band fällt (Open: 1/2/3/5/9/12/15 -- deckt sich exakt mit
// OPEN_POINTS_TABLE; Major: 1/2/3/5/9/12/15 -- die alten 9-11/12-14-Anker
// fallen beide in die hier gröber zusammengefasste 9-12-Preisgeld-Stufe, was
// bewusst so ist, der User hat für Preisgeld weniger/breitere Stufen
// vorgegeben als fürs Punktesystem). Beträge sind Saison-1-Basiswerte --
// skalieren wie `event.prize` über denselben Wachstumsfaktor
// (tournamentEventPrize()), siehe prizeAmountForPlacement() in renderer.js.
const OPEN_PRIZE_TABLE = [
  { minPlace: 1, maxPlace: 1, amount: 21000 },
  { minPlace: 2, maxPlace: 2, amount: 12000 },
  { minPlace: 3, maxPlace: 4, amount: 6000 },
  { minPlace: 5, maxPlace: 8, amount: 3600 },
  { minPlace: 9, maxPlace: 11, amount: 1800 },
  { minPlace: 12, maxPlace: 14, amount: 1200 },
  { minPlace: 15, maxPlace: 16, amount: 900 },
];
const MAJOR_PRIZE_TABLE = [
  { minPlace: 1, maxPlace: 1, amount: 75000 },
  { minPlace: 2, maxPlace: 2, amount: 45000 },
  { minPlace: 3, maxPlace: 4, amount: 27000 },
  { minPlace: 5, maxPlace: 8, amount: 12000 },
  { minPlace: 9, maxPlace: 12, amount: 6000 },
  { minPlace: 13, maxPlace: 16, amount: 3000 },
];
// Worlds-`placements` (renderer.js resolveWorldsEvent()) ist NEU (gab es vorher
// nicht, Worlds hatte bisher nur championName/runnerUpName/...-Einzelfelder,
// kein volles Punkte-/Preisgeld-System, s. dortiger Kommentar) -- Tier-Anker
// 1/2/3/5/9/13/17, exakt auf diese 7 Bänder abgestimmt.
const WORLDS_PRIZE_TABLE = [
  { minPlace: 1, maxPlace: 1, amount: 300000 },
  { minPlace: 2, maxPlace: 2, amount: 150000 },
  { minPlace: 3, maxPlace: 4, amount: 90000 },
  { minPlace: 5, maxPlace: 8, amount: 45000 },
  { minPlace: 9, maxPlace: 12, amount: 24000 },
  { minPlace: 13, maxPlace: 16, amount: 12000 },
  { minPlace: 17, maxPlace: 20, amount: 6000 },
];

// Runde 80, User-Korrektur (ersetzt die Runde-79-Fehlannahme "Major/Worlds
// nutzen eine echte Swiss Stage"): laut echter RLCS-2026-Recherche des
// Users wurde das Schweizer System bei Majors UND Weltmeisterschaft
// abgeschafft. Beide nutzen für ihre 16-Team-Gruppenphase jetzt wieder
// 4 Round-Robin-Gruppen à 4 Teams (jeder gegen jeden, Bo5) -- exakt die
// Struktur, die schon vor Runde 79 gebaut war (tournamentRoundRobinGroupHtml()
// in renderer.js, nie entfernt, nur zwischenzeitlich nicht mehr aufgerufen).
// Top 2 pro Gruppe (8 Teams) ziehen bei Major 1 & Worlds in die Playoffs
// ein, Top 3 pro Gruppe (12 Teams) bei Major 2 -- siehe tournamentFormatInfo().
const WORLDS_MAJOR_GROUP_STAGE_FORMAT = 'roundRobin';

// ── Last-Chance-Qualifier: regionale Teilnahme-Bänder (Runde 79) ──────────
// NUR EU/NA/SAM/MENA haben überhaupt einen LCQ -- OCE/APAC/SSA schicken
// ihre Top-Teams direkt zur WM und haben keinen LCQ-Weg (0 Slots). Plätze
// oberhalb `autoQualifyTop` fahren direkt zur WM, Plätze im Bereich
// `lcqRangeStart`-`lcqRangeEnd` (aus der Jahres-Punktetabelle, die erst in
// Statistiken gebaut wird, siehe User-Hinweis) spielen im regionalen LCQ,
// alles darunter ist für die Saison raus. Summe LCQ-Teilnehmer über alle
// Regionen: (12-4)+(12-4)+(6-2)+(6-2) = 24 -- deckt sich exakt mit der
// User-Angabe "insgesamt 24 Teams kämpfen im Last Chance Quali".
const LCQ_ELIGIBILITY_BANDS = {
  EU: { autoQualifyTop: 4, lcqRangeStart: 5, lcqRangeEnd: 12 },
  NA: { autoQualifyTop: 4, lcqRangeStart: 5, lcqRangeEnd: 12 },
  SAM: { autoQualifyTop: 2, lcqRangeStart: 3, lcqRangeEnd: 6 },
  MENA: { autoQualifyTop: 2, lcqRangeStart: 3, lcqRangeEnd: 6 },
  OCE: { autoQualifyTop: 2, lcqRangeStart: null, lcqRangeEnd: null },
  APAC: { autoQualifyTop: 1, lcqRangeStart: null, lcqRangeEnd: null },
  SSA: { autoQualifyTop: 1, lcqRangeStart: null, lcqRangeEnd: null },
};
// Regionen, die überhaupt einen eigenen LCQ austragen (reine Komfort-Liste,
// abgeleitet aus LCQ_ELIGIBILITY_BANDS, wo lcqRangeStart gesetzt ist).
const LCQ_REGIONS = Object.keys(LCQ_ELIGIBILITY_BANDS).filter((r) => LCQ_ELIGIBILITY_BANDS[r].lcqRangeStart !== null);

// Weltmeisterschafts-Play-In: die 20 Teams setzen sich zusammen aus den
// WORLDS_DIRECT_QUALIFIER_COUNT (16) besten Teams der Jahres-Punktetabelle
// PLUS den WORLDS_LCQ_QUALIFIER_COUNT (4) regionalen LCQ-Siegern. Davon
// sind aber nur die BESTEN 12 der 16 direkt gesetzt (bye direkt in die
// Swiss Stage) -- die SCHLECHTESTEN 4 der 16 direkt Qualifizierten müssen
// zusammen mit den 4 LCQ-Siegern zuerst durchs Play-In (siehe
// tournamentFormatInfo() 'worlds'.stages[0] in renderer.js).
const WORLDS_DIRECT_SEED_COUNT = 12; // bye direkt in die Swiss Stage
const WORLDS_PLAYIN_FIELD_SIZE = 8; // 4 schwächste Direkt-Qualifizierte + 4 LCQ-Sieger -> Top 4 ziehen in die Swiss Stage ein

// ── Transferfenster (Runde 100, User-Vorgabe: "für spätere Transfer-Logik
// wichtig -- das Transferfenster ist immer nur den ganzen Dezember bis Mitte
// Januar geöffnet, außerhalb des Zeitraums geschlossen, damit während einer
// laufenden Saison kein Spieler und keine KI mitten drin einen neuen Kader
// hat") ─────────────────────────────────────────────────────────────────────
// Reine Kalender-REGEL-DATEN, analog zu den Punkte-Tabellen weiter oben --
// die eigentliche Transfermarkt-Logik/UI ist bewusst noch NICHT angetastet
// (siehe [[rlcs-legends-project]]: "Transferseite" ist eine eigene, spätere
// Baustelle, User-Vorgabe). Das Fenster überspannt den Jahreswechsel (1. Dez.
// bis 15. Jan. des FOLGEJahrs) -- liegt damit sicher zwischen dem Saisonende
// (Weltmeisterschaft, endet im November, siehe TOURNAMENT_EVENT_END_MONTH)
// und der nächsten Saison-Anmeldung (Open Qualifier, endet erst Ende Januar,
// registriert sich also erst NACH Fensterschluss). Auch schon jetzt nutzbar:
// der Schnellvorlauf-Pfeil (renderer.js) behandelt den 1. Dezember als
// "Ereignistag" (Fenster öffnet).
const TRANSFER_WINDOW_START_MONTH_DAY = '12-01'; // 1. Dezember
const TRANSFER_WINDOW_END_MONTH_DAY = '01-15'; // 15. Januar (Folgejahr)

// `dateStr`: volles careerDate ("YYYY-MM-DD"). Vergleicht nur den MM-DD-Teil,
// damit der Jahreswechsel innerhalb des Fensters keine Rolle spielt.
function isTransferWindowOpen(dateStr) {
  const monthDay = dateStr.slice(5);
  return monthDay >= TRANSFER_WINDOW_START_MONTH_DAY || monthDay <= TRANSFER_WINDOW_END_MONTH_DAY;
}

// Runde 101: eigene Farbe fürs Kalender-Balken (renderer.js
// tournamentPhaseMapForMonth()) -- bewusst deutlich von allen
// TOURNAMENT_EVENT_DEFS-Farben unterscheidbar (Gold/Amber statt der
// Turnier-Blau-/Rot-/Grün-Töne), da es kein Turnier, sondern ein
// eigenständiges Kalender-Ereignis ist.
const TRANSFER_WINDOW_COLOR = '#c9a13b';
