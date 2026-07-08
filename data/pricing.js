// Preis-Berechnung fürs Budget-Cap-Draften — rein aus dem Overall-Wert abgeleitet.
// Exponentiell statt linear: Elite-Spieler sollen unverhältnismäßig teuer sein,
// damit das Budget zu echten Kompromissen zwingt (1-2 Stars + günstige Rolle-
// Spieler vs. 5 solide Mittelklasse-Spieler), statt dass selbst die stärkste Org
// sich sofort einen Elite-Kader zusammenkauft. Basis bewusst von 1.13 auf 1.15
// angehoben (User-Wunsch: "man muss sich hochkämpfen") — selbst das Top-Budget
// (~820 Cr bei stärkster Org) reicht bei Saison 1 nur für EINEN Elite-Spieler
// (88 Overall ≈ 500 Cr) plus günstige Rollenspieler, nicht für einen kompletten
// Star-Kader. Über mehrere erfolgreiche Saisons (Kaderwert + Einkommen wachsen
// zusammen, siehe calculateSeasonIncome() in renderer.js) wird ein Star-Kader
// erst nach und nach erreichbar.
function calculatePrice(overall) {
  const raw = 10 * Math.pow(1.15, overall - 60);
  return Math.round(raw / 5) * 5;
}
