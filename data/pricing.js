// Preis-Berechnung fürs Budget-Cap-Draften — rein aus dem Overall-Wert abgeleitet.
// Exponentiell statt linear: Elite-Spieler sollen unverhältnismäßig teuer sein,
// damit das Budget zu echten Kompromissen zwingt (1-2 Stars + günstige Rolle-
// Spieler vs. 5 solide Mittelklasse-Spieler), statt dass selbst die stärkste Org
// sich sofort einen Elite-Kader zusammenkauft. Kurven-Basis-Historie: 1.13 ->
// 1.15 -> 1.18 ("Preise deutlich anheben, mehrere Saisons nötig") — die
// exponentielle FORM ist unverändert, nur die Einheit wurde von der fiktiven
// "Cr"-Währung auf echte Euro umgestellt (User-Wunsch: "Millionen-Bereich
// möglich"). Bei 1.18 kostet ein 90-Overall-Spieler ~1.435.000 €, ein
// kompletter Elite-Kader (3x90 + Sub/Coach 85) liegt bei ~5.500.000 €, während
// eine realistische Saison-1-Startaufstellung (~75/70er Overall) nur ~460.000 €
// wert ist — das Verhältnis zum Saison-Einkommen (siehe calculateSeasonIncome()
// in renderer.js) bleibt exakt wie vorher (grob 8-12 Saisons bis zum Top-Kader).
function calculatePrice(overall) {
  const raw = 10000 * Math.pow(1.18, overall - 60);
  return Math.round(raw / 1000) * 1000;
}

// ── Marktwert-Modell V8 (Masterprompt "Market Value + Generational Mobility",
// Phase 1-2) ─────────────────────────────────────────────────────────────
// calculatePrice(overall) bleibt ABSICHTLICH unveraendert -- sie ist die
// Basis fuer Gehalt/Kaderwert/Board-Budget (siehe orgRosterMarketValue() in
// diesem File und monthlyBoardBudgetAmount() in renderer.js), und genau
// DIESE Verwendungen sollen laut Auftrag NICHT auch noch Potential
// einpreisen (Phase 3.1: sonst wird Potential doppelt belohnt -- einmal im
// Transferwert, ein zweites Mal automatisch im Board-Budget, das denselben
// Kaderwert-Term nutzt). Neue, GETRENNTE Funktion nur fuer den tatsaechlich
// GEZAHLTEN/GEFORDERTEN Transferpreis (Verhandlungen, Kaufentscheidungen,
// Scouting-Anzeige, Verkaufserloes) -- diese Aufrufstellen werden gezielt
// von calculatePrice() auf calculatePlayerTransferValue() umgestellt, alle
// anderen (Kaderwert/Board-Budget/Investitionsspielraum) bleiben unveraendert
// bei calculatePrice(), um den in Root-Cause #4 beschriebenen Verstaerker-
// Kreislauf (Staerke->Kaderwert->Geld->Staerke) nicht zusaetzlich zu
// verschaerfen.
//
// Formel-Prinzip (Auftragsabschnitt 1.8, Struktur selbst gewaehlt):
// BaseValue(aktueller Overall, calculatePrice() unveraendert)
//   x (1 + PotentialPraemie), PotentialPraemie = f(Luecke) x Altersfaktor.
// Diminishing Returns ueber Wurzelfunktion (nicht linear) -- die ersten paar
// Luecke-Punkte zaehlen spuerbar, weitere immer weniger, mit hartem Deckel
// (POTENTIAL_VALUE_MAX_BONUS). Da calculatePrice() selbst exponentiell in
// Overall ist (Basis(90) waere >100x Basis(30)), kann selbst der maximale
// Bonus einen schwachen Spieler NIEMALS teurer machen als einen echten Star
// (Auftragsabschnitt 1.6) -- das ergibt sich automatisch aus der Kurvenform,
// nicht aus einer expliziten Sonderregel. Altersfaktor sorgt dafuer, dass
// Potential bei einem 30-Jaehrigen (wird es realistisch nie mehr ausschoepfen)
// kaum noch etwas wert ist, bei einem 18-Jaehrigen aber voll zaehlt
// (Auftragsabschnitt 1.7). TRANSFER_VALUE_MIN verhindert den bestehenden
// Rundungs-Nulleffekt von calculatePrice() bei <=44 Overall (ein junges
// Talent mit niedrigem aktuellem Overall soll nie buchstaeblich "0 EUR" wert
// sein, das ist realitaetsfremd fuer einen Manager-Simulator).
const TRANSFER_VALUE_MIN = 5000;
const POTENTIAL_VALUE_PER_SQRT_GAP = 0.09;
const POTENTIAL_VALUE_MAX_BONUS = 1.1;
function transferValueAgeFactor(age) {
  const safeAge = typeof age === 'number' && !Number.isNaN(age) ? age : 25;
  if (safeAge <= 20) return 1.0;
  if (safeAge <= 24) return 0.75;
  if (safeAge <= 28) return 0.4;
  return 0.1;
}
function calculatePlayerTransferValue(person) {
  if (!person) return TRANSFER_VALUE_MIN;
  const overall = typeof person.overall === 'number' ? person.overall : 45;
  const potential = typeof person.potential === 'number' ? person.potential : overall;
  const base = calculatePrice(overall);
  const gap = Math.max(0, potential - overall);
  const rawBonus = Math.min(POTENTIAL_VALUE_MAX_BONUS, Math.sqrt(gap) * POTENTIAL_VALUE_PER_SQRT_GAP);
  const bonus = rawBonus * transferValueAgeFactor(person.age);
  const value = Math.max(TRANSFER_VALUE_MIN, base) * (1 + bonus);
  return Math.round(value / 1000) * 1000;
}

// Gehalts-Erwartung (Auftragsabschnitt Phase 2): bewusst EIGENSTAENDIG von
// calculatePlayerTransferValue() -- ein Gehalt soll ueberwiegend die
// AKTUELLE Leistung/Rolle beloehnen, nicht die spekulative Zukunft (die
// gehoert in den TRANSFERPREIS, den der Verein einmalig zahlt, nicht ins
// laufende Gehalt). Deshalb nur ein kleiner Bruchteil der Potential-Praemie
// (POTENTIAL_SALARY_FRACTION), nicht die volle Transferwert-Praemie.
const PLAYER_SALARY_PCT_OF_TRANSFER_VALUE = 0.02; // identisch zur bisherigen 2%-Regel, nur jetzt auf Basis calculatePrice() (s.u.), nicht des vollen Transferwerts
const PLAYER_SALARY_MIN_VALUE = 1000;
const POTENTIAL_SALARY_FRACTION = 0.18; // Gehalt bekommt nur ~18% der vollen Transferwert-Potential-Praemie
function calculateSalaryExpectation(person) {
  if (!person) return PLAYER_SALARY_MIN_VALUE;
  const overall = typeof person.overall === 'number' ? person.overall : 45;
  const potential = typeof person.potential === 'number' ? person.potential : overall;
  const base = calculatePrice(overall);
  const gap = Math.max(0, potential - overall);
  const rawBonus = Math.min(POTENTIAL_VALUE_MAX_BONUS, Math.sqrt(gap) * POTENTIAL_VALUE_PER_SQRT_GAP);
  const bonus = rawBonus * transferValueAgeFactor(person.age) * POTENTIAL_SALARY_FRACTION;
  const value = Math.max(TRANSFER_VALUE_MIN, base) * (1 + bonus);
  return Math.max(PLAYER_SALARY_MIN_VALUE, Math.round(value * PLAYER_SALARY_PCT_OF_TRANSFER_VALUE / 100) * 100);
}
