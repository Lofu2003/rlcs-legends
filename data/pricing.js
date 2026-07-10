// Preis-Berechnung fürs Budget-Cap-Draften — rein aus dem Overall-Wert abgeleitet.
// Exponentiell statt linear: Elite-Spieler sollen unverhältnismäßig teuer sein,
// damit das Budget zu echten Kompromissen zwingt (1-2 Stars + günstige Rolle-
// Spieler vs. 5 solide Mittelklasse-Spieler), statt dass selbst die stärkste Org
// sich sofort einen Elite-Kader zusammenkauft. Basis-Historie: 1.13 -> 1.15
// (Runde 1, "man muss sich hochkämpfen") -> 1.18 (Runde 2, "Preise deutlich
// anheben, mehrere Saisons nötig"). Bei 1.18 kostet ein 90-Overall-Spieler
// ~1435 Cr statt ~660 Cr (Basis 1.15) — ein kompletter Elite-Kader (3x90 +
// Sub/Coach 85) liegt bei ~5500 Cr, während eine realistische Saison-1-
// Startaufstellung (~75/70er Overall) nur ~460 Cr wert ist. Bei typischem
// Saison-Einkommen von 350-550 Cr (siehe calculateSeasonIncome() in
// renderer.js) sind das grob 8-12 Saisons bis zum Top-Kader — ein echtes
// Karriereziel, kein Zwischenstand nach 2-3 Saisons.
function calculatePrice(overall) {
  const raw = 10 * Math.pow(1.18, overall - 60);
  return Math.round(raw / 5) * 5;
}
