// Preis-Berechnung fürs Budget-Cap-Draften — rein aus dem Overall-Wert abgeleitet.
// Exponentiell statt linear: Elite-Spieler sollen unverhältnismäßig teuer sein,
// damit das Budget zu echten Kompromissen zwingt (2 Stars + 4 Günstige vs.
// 6 solide Mittelklasse-Spieler), statt dass jeder einfach die besten 6 nimmt.
function calculatePrice(overall) {
  const raw = 10 * Math.pow(1.13, overall - 60);
  return Math.round(raw / 5) * 5;
}
