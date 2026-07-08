# RLCS Legends — Konzept (Arbeitstitel)

## Ausgangspunkt: was draftrlcs.app ist

Fantasy-Roster-Spiel für RLCS-Esports: Du baust aus echten Pro-Spielern ein 6er-Roster,
bekommst Ratings (1v1/2v2/3v3) und einen "Projected Score". Drumherum: Daily Challenges
(Showmatch, Blind Rank, Higher/Lower), Party-Games (Bidding Wars, Speed Rating, Stat
Duel, Guess Who), Progressionsmodi (Zero to Hero, Karriere), Multiplayer-Live-Draft,
Sammelkarten mit Fusion (Foil/Gold/Diamond).

**Wo es schwächelt (dein eigenes Urteil aus einer früheren Planungsnotiz):** wird schnell
langweilig, zu wenig Abwechslung, keine eigenen Spieler. Der tiefere Grund: das Ergebnis
eines Drafts ist am Ende **eine Zahl**. Du baust ein Roster, siehst ein "Projected Rating"
— aber nichts *passiert* wirklich. Kein Nervenkitzel, kein Match, kein Moment.

## Die Kernidee: von der Zahl zum Erlebnis

> draftrlcs.app: Du baust ein Team → du bekommst eine Projektions-Zahl.
> RLCS Legends: Du baust ein Team → **du siehst es tatsächlich spielen.**

Das ist der zentrale Hebel, der aus einem soliden Fantasy-Draft-Spiel ein wirklich
mitreißendes Spiel macht. Wir haben in diesem Account bereits eine funktionierende
2D-Match-Engine gebaut (`rocket-sim`): Rollen-Rotation, stat-basierte Duelle, xG-Schuss-
system, Aerials, Team-Taktik-Identität, Spielstand-Kontext-KI. Diese Engine (oder ein
daraus abgeleiteter, leichterer Simulationskern) kann als Herzstück von RLCS Legends
dienen: dein gedraftetes Team spielt **echte, unterschiedliche, nachvollziehbare Matches**
statt nur eine Rating-Zahl auszuspucken.

Das ist der Unterschied zwischen "ich habe eine gute Tabelle gebaut" und "ich habe mein
Team gebaut, zugeschaut wie es im Halbfinale knapp gewinnt, und will sofort die nächste
Saison spielen."

## Weitere Unterscheidungsmerkmale ggü. dem Original

1. **Echte Match-Simulation statt reiner Projektion** (siehe oben — der Haupthebel)
2. **Custom-Spieler-Erstellung & -Entwicklung** — zurückgestellt für später, siehe
   Entscheidungen unten
3. **Saison-Kontinuität statt Einzel-Draft** — dein Roster existiert über mehrere
   Turniere hinweg, Spieler werden besser/schlechter, es gibt eine Geschichte
4. **Rivalitäten & Momente** — bestimmte Matches/Gegner bekommen erzählerisches Gewicht
   (Finale, Grudge Match, Comeback-Story), statt jede Runde identisch anonym zu spielen

## Kern-Loop (erste spielbare Schleife, v1)

1. **Test-Spieler-Pool** ansehen — Stats auf denselben Achsen wie in rocket-sim:
   Mechanics, Game Sense, Speed, Shooting, Defending, Boost Management
2. **Draften**: 6 Athleten per Budget-Cap-Draft auswählen (festes Budget, jeder Spieler
   kostet Punkte basierend auf seinen Stats — bessere Spieler sind teurer)
3. **Team-Rating**: nicht nur Stat-Summe — Rollen-Fit zählt (hat das Team einen klaren
   Attacker/Second/Keeper-Mix, passt die Taktik-Identität zusammen?)
4. **Turnier**: Swiss-Stage + Playoffs — Matches werden als **Text-Ticker** simuliert
   ("23:14 — Torschuss von X, daneben"), kein visuelles Echtzeit-Match in v1
5. **Ergebnis fließt zurück**: Season-Fortschritt, Ranglisten, Spieler-Entwicklung

## Entschiedene Punkte (v1-Scope)

- **Match-Simulation:** Text-Ticker (Ereignis-Log), kein visuelles Echtzeit-Match — das
  kann später nachgerüstet werden, wenn der Kern-Loop steht
- **Draft-Modus:** Budget-Cap-Draft — festes Budget, Spieler-Preis wird aus den Stats
  abgeleitet (bessere Spieler kosten mehr)
- **Custom-Spieler:** vorerst weggelassen, kommt erst nach dem Kern-Loop dran
- **Datenbasis:** Test-Pool (ähnlich `TEST_PLAYERS` aus rocket-sim), keine echten
  RLCS-Pro-Daten in v1

## Modi — priorisiert, nicht alles in Version 1

- **Kern (v1):** Draft + simulierte Saison (Swiss + Playoffs), Text-Ticker
- **Später:** Custom-Spieler, Daily Challenges, Party-Games, Zero-to-Hero,
  Multiplayer-Live-Draft, Sammelkarten mit Fusion, visuelle Match-Simulation

## Technischer Rahmen

- **Electron**, wie das bestehende RLM26 — gleiches Tooling, kein neuer Stack zu lernen
- Eigenständiger, neuer Ordner (`Desktop/rlcs-legends`) — RLM26 bleibt komplett unangetastet
- Spieler-Datenmodell kompatibel zu rocket-sim (Mechanics/GameSense/Speed/Shooting/
  Defending/BoostMgmt)

## Arbeitsweise

Immer nur EIN Teilschritt gleichzeitig — jeden Schritt fertigstellen und besprechen,
bevor der nächste beginnt. Keine parallelen Baustellen.
