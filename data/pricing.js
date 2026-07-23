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
