// Vereinfachtes Match-Simulationsmodell für den Text-Ticker.
// Prinzip angelehnt an rocket-sim (moment.py): Duelle werden stat-basiert per
// Normalverteilung aufgelöst, der bessere Spieler gewinnt wahrscheinlicher,
// nie garantiert. Kein echtes Physik-/Positions-Modell — reine Ereignis-Erzeugung.

function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Runde 99, User-Meldung ("Simulation optimieren, ein schwächeres Team soll
// gegen ein stärkeres auch verlieren können, aber realistische Gewinnchancen
// behalten -- Bsp. Spieler-EGS 60/80/75 gegen 80/90/75"): mit den alten Werten
// (Rauschen ±15% des Rohwerts, volle 45-95-Statspanne unkomprimiert) verlor
// die schwächere Seite genau dieses Beispiels eine Bo5-Serie in >94% der
// Fälle, ab ~20 Punkten Rückstand praktisch IMMER (Node-Sandbox-Verifikation,
// siehe Session-Historie/Projekt-Memory Runde 99). Ursache: derselbe
// Statvorteil wirkt DREIMAL hintereinander pro Ballbesitz (Duell gewinnen ->
// Torschusschance -> Torchance) -- über ~13 Ballbesitze pro Spiel und bis zu
// 5 Spiele pro Serie potenziert sich das schnell zu einer Beinahe-Sicherheit
// für die stärkere Seite. compressStat() staucht den Abstand jedes Stat-Werts
// zur Skalenmitte (75, siehe starsToOverall() in data/org-rosters.js) auf 45%
// seiner Rohgröße, BEVOR er in eine der drei Chance-Funktionen einfließt --
// die Rangfolge (stärker bleibt stärker) bleibt erhalten, nur die Wucht der
// Wiederholung wird gedämpft. Zusätzlich Rauschen pro Duell von 15% auf 18%
// angehoben. Ergebnis (Grid-Suche, 3000 Serien/Szenario): 10-Punkte-Rückstand
// jetzt ~33% Einzelspiel-/~21% Bo5-Gewinnchance für die schwächere Seite,
// 20 Punkte ~18%/~4%, 30 Punkte ~9%/~0,4%, exakt gleichstarke Teams
// weiterhin ~50/50 -- die stärkere Seite bleibt klarer Favorit, ein Sieg des
// Außenseiters bleibt aber immer real möglich statt praktisch ausgeschlossen.
const MATCH_SIM_STAT_BASELINE = 75;
const MATCH_SIM_STAT_COMPRESSION = 0.45;
function compressStat(val) {
  return MATCH_SIM_STAT_BASELINE + (val - MATCH_SIM_STAT_BASELINE) * MATCH_SIM_STAT_COMPRESSION;
}

function duelStat(p) {
  return p.mechanics * 0.5 + p.speed * 0.3 + p.gameSense * 0.2;
}

function resolveDuel(attValRaw, defValRaw) {
  const attVal = compressStat(attValRaw);
  const defVal = compressStat(defValRaw);
  const att = gaussianRandom(attVal, Math.max(1, Math.abs(attVal) * 0.18));
  const def = gaussianRandom(defVal, Math.max(1, Math.abs(defVal) * 0.18));
  return att > def;
}

function shotOnGoalChance(shootingRaw) {
  const shooting = compressStat(shootingRaw);
  return Math.min(0.60, Math.max(0.12, 0.35 + (shooting - 75) / 100 * 0.5));
}

function goalChance(shootingRaw, bestDefendingRaw) {
  const shooting = compressStat(shootingRaw);
  const bestDefending = compressStat(bestDefendingRaw);
  const base = 0.15 + (shooting / 100) * 0.55;
  const defensePenalty = (bestDefending / 100) * 0.25;
  return Math.min(0.75, Math.max(0.10, base - defensePenalty));
}

function bestDefender(team) {
  return team.slice().sort((a, b) => b.defending - a.defending)[0];
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m + ':' + String(rest).padStart(2, '0');
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Mehrere Formulierungen pro Ereignistyp, zufällig ausgewählt — sonst wirkt der
// Ticker nach wenigen Spielen repetitiv (eine Saison hat schon 20-35 Einzelspiele
// über mehrere Bo5/Bo7-Serien). GOAL_LATE_TEMPLATES kommt nur in der Schlussphase
// der regulären Spielzeit zum Einsatz, für einen zusätzlichen Spannungsmoment.
const DUEL_TEMPLATES = [
  (w, wl) => 'Duell gewonnen von ' + w + ' (' + wl + ')',
  (w, wl) => w + ' setzt sich im Zweikampf durch und sichert den Ball für ' + wl,
  (w, wl) => w + ' gewinnt den 50/50-Ball für ' + wl,
  (w, wl) => 'Starker Challenge von ' + w + ' — ' + wl + ' hat wieder den Ball',
  (w, wl) => w + ' klärt unter Druck für ' + wl,
  (w, wl) => w + ' liest das Spiel perfekt und erobert den Ball für ' + wl,
];

const GOAL_TEMPLATES = [
  (w, wl) => 'TOR! ' + w + ' trifft für ' + wl + '!',
  (w, wl) => w + ' hämmert den Ball rein — TOR für ' + wl + '!',
  (w, wl) => 'Wunderschöner Abschluss von ' + w + '! TOR für ' + wl + '!',
  (w, wl) => w + ' lässt dem Keeper keine Chance — TOR für ' + wl + '!',
  (w, wl) => 'Da ist er drin! ' + w + ' trifft für ' + wl + '!',
  (w, wl) => w + ' verwandelt eiskalt — TOR für ' + wl + '!',
];

const GOAL_LATE_TEMPLATES = [
  (w, wl) => 'IN DER SCHLUSSPHASE! ' + w + ' trifft für ' + wl + '!',
  (w, wl) => 'Was für ein Zeitpunkt! ' + w + ' schlägt kurz vor Schluss zu — TOR für ' + wl + '!',
  (w, wl) => 'Mit der letzten Aktion! ' + w + ' trifft in letzter Sekunde für ' + wl + '!',
];

const SAVE_TEMPLATES = [
  (d, dl, w) => 'PARADE! ' + d + ' (' + dl + ') hält den Schuss von ' + w + '!',
  (d, dl, w) => d + ' wirft sich rein und pariert glänzend gegen ' + w + '!',
  (d, dl, w) => 'Riesenparade von ' + d + ' (' + dl + ')! ' + w + ' fassungslos.',
  (d, dl, w) => d + ' steht goldrichtig und blockt ' + w + ' ab.',
  (d, dl, w) => 'Reflexparade von ' + d + '! ' + w + ' konnte es kaum glauben.',
];

const MISS_TEMPLATES = [
  (w, wl) => 'Schuss von ' + w + ' (' + wl + ') — daneben!',
  (w, wl) => w + ' verzieht knapp — Ball geht über die Latte.',
  (w, wl) => w + ' kommt nicht richtig an den Ball, der Versuch verpufft.',
  (w, wl) => 'Zu unplatziert von ' + w + ' — kein Problem für die Abwehr.',
  (w, wl) => w + ' überhastet den Abschluss und trifft den Ball nur schwach.',
];

const LATE_GAME_THRESHOLD_SECONDS = 20;

// Chance pro Ereignis, dass ein Spieler disconnected (löst den Sub-Zwangswechsel
// aus) — bei ~13 Ereignissen pro Spiel (300s / ~23s Ø) ergibt das eine Chance von
// ca. 1-(1-p)^13 ≈ 33%, dass der Sub überhaupt zum Einsatz kommt. Bewusst nicht
// höher, damit es sich wie ein echter Notfall anfühlt statt einer garantierten Rotation.
const DISCONNECT_CHANCE_PER_EVENT = 0.03;

/**
 * Löst EIN Ballbesitz-Ereignis auf (Duell, ggf. Torschuss/Parade/Fehlschuss).
 * Gibt ein Ereignis-Objekt zurück (ohne time/stepSeconds — die setzt der Aufrufer).
 * isLateGame steuert dramatischere Tor-Formulierungen in der Schlussphase.
 */
function simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct, teamBBonusPct, isLateGame) {
  const playerA = pickRandom(activeTeamA);
  const playerB = pickRandom(teamB);
  const aWins = resolveDuel(duelStat(playerA) * (1 + teamABonusPct), duelStat(playerB) * (1 + teamBBonusPct));
  const winner = aWins ? playerA : playerB;
  const winnerLabel = aWins ? nameA : nameB;
  const winnerTeamTag = aWins ? 'A' : 'B';
  const defendingTeam = aWins ? teamB : activeTeamA;
  const defendingLabel = aWins ? nameB : nameA;
  const defendingTeamTag = aWins ? 'B' : 'A';

  // Nicht jedes gewonnene Duell führt zu einem Torschuss — sonst wirkt es wie
  // Dauerfeuer. Nur ein Teil der Ballgewinne mündet in echten Abschluss.
  const leadsToShot = Math.random() < shotOnGoalChance(winner.shooting);
  if (!leadsToShot) {
    return {
      type: 'duel', team: winnerTeamTag, player: winner.name,
      msg: pickRandom(DUEL_TEMPLATES)(winner.name, winnerLabel),
      scoringTeam: null,
    };
  }

  const defender = bestDefender(defendingTeam);
  const scored = Math.random() < goalChance(winner.shooting, defender.defending);

  if (scored) {
    const templates = isLateGame ? GOAL_LATE_TEMPLATES : GOAL_TEMPLATES;
    return {
      type: 'goal', isGoal: true, team: winnerTeamTag, player: winner.name,
      msg: pickRandom(templates)(winner.name, winnerLabel),
      scoringTeam: winnerTeamTag,
    };
  } else if (Math.random() < 0.55) {
    // Parade: der beste Verteidiger der Gegenseite hält den Schuss
    return {
      type: 'save', team: defendingTeamTag, player: defender.name,
      msg: pickRandom(SAVE_TEMPLATES)(defender.name, defendingLabel, winner.name),
      scoringTeam: null,
    };
  }
  return {
    type: 'miss', team: winnerTeamTag, player: winner.name,
    msg: pickRandom(MISS_TEMPLATES)(winner.name, winnerLabel),
    scoringTeam: null,
  };
}

/**
 * Simuliert ein 3v3-Match und gibt { events, scoreA, scoreB, teamABonusPct } zurück.
 *
 * events: Liste von Ereignissen in absteigender bzw. (in der Verlängerung)
 * aufsteigender Zeit-Reihenfolge. Jedes Ereignis:
 *   { time, msg, team, stepSeconds, type, player, isGoal, isFinal, isOvertime }
 *   - time:        fertig formatierter Anzeige-String ("4:12" bzw. "+0:23" in OT)
 *   - team:        'A' (eigenes Team) oder 'B' (Bot-Gegner) — fürs Einfärben
 *   - stepSeconds: wie viele Spiel-Sekunden seit dem letzten Ereignis vergangen sind
 *   - type:        'duel' | 'goal' | 'miss' | 'save' | 'sub' | 'overtime-start' | 'final'
 *   - player:      Name des hervorzuhebenden Spielers
 *
 * myOptions:
 *   - coach:             Coach-Objekt oder null — Team-A-Bonus/-Malus auf alle Duelle
 *   - sub:               Sub-Spieler-Objekt oder null — Wechsel zur Spielhälfte (nur Team A)
 *   - orgMatchBonusPct:  Bonus/Malus (Prozentpunkte, z.B. +4.4 oder -7.2) aus der
 *                        zugewiesenen Organisation für Team A — kombiniert sich mit dem Coach-Bonus
 *   - coachB/orgMatchBonusPctB: dasselbe, aber für Team B (Runde 119, Team-Chemie
 *                        -- die eigene, gedraftete Org kann in simulateBotSeries()
 *                        positionell sowohl Team A als auch Team B sein, siehe
 *                        ownIsA dort). Beide defaulten auf 0 -- bestehende
 *                        Aufrufe ohne diese Felder verhalten sich exakt wie zuvor.
 */
function simulateMatch(teamA, teamB, nameA, nameB, myOptions) {
  myOptions = myOptions || {};
  const coachBonusFraction = myOptions.coach ? ((myOptions.coach.overall - 75) / 100) * 0.18 : 0;
  const orgBonusFraction = (myOptions.orgMatchBonusPct || 0) / 100;
  const teamABonusPct = coachBonusFraction + orgBonusFraction;
  const coachBonusFractionB = myOptions.coachB ? ((myOptions.coachB.overall - 75) / 100) * 0.18 : 0;
  const orgBonusFractionB = (myOptions.orgMatchBonusPctB || 0) / 100;
  const teamBBonusPct = coachBonusFractionB + orgBonusFractionB;

  let clock = 300; // 5 Minuten Spielzeit
  let scoreA = 0, scoreB = 0;
  const events = [];

  let activeTeamA = teamA.slice();
  let subDone = !myOptions.sub;

  while (clock > 0) {
    const step = 14 + Math.random() * 18; // 14-32 Spiel-Sekunden pro Ereignis
    clock -= step;
    const timeStr = formatClock(clock);

    // Sub kommt nicht mehr zu einem festen Zeitpunkt, sondern nur, wenn ein
    // Spieler "disconnected" — realistischer (Subs sind im echten Spiel reine
    // Notfall-Ersatzspieler) und unvorhersehbar. Kann auch gar nicht passieren.
    if (!subDone && Math.random() < DISCONNECT_CHANCE_PER_EVENT) {
      const outIdx = Math.floor(Math.random() * activeTeamA.length);
      const outPlayer = activeTeamA[outIdx];
      activeTeamA = activeTeamA.slice();
      activeTeamA[outIdx] = myOptions.sub;
      subDone = true;
      events.push({
        time: timeStr, stepSeconds: step, type: 'sub',
        msg: 'DISCONNECT! ' + outPlayer.name + ' (' + nameA + ') verliert die Verbindung — '
          + myOptions.sub.name + ' kommt sofort ins Spiel!',
        team: 'A', player: myOptions.sub.name, subOutName: outPlayer.name,
        subInPlayer: myOptions.sub,
      });
      continue;
    }

    const isLateGame = clock <= LATE_GAME_THRESHOLD_SECONDS;
    const result = simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct, teamBBonusPct, isLateGame);
    if (result.scoringTeam === 'A') scoreA++;
    else if (result.scoringTeam === 'B') scoreB++;
    if (result.scoringTeam) result.msg += '  (' + scoreA + ':' + scoreB + ')';

    events.push({ time: timeStr, stepSeconds: step, ...result });
  }

  // ── Verlängerung bei Gleichstand: Uhr zählt mit "+" hoch, nächstes Tor entscheidet ──
  if (scoreA === scoreB) {
    events.push({
      time: '+0:00', stepSeconds: 3, type: 'overtime-start', isOvertime: true,
      team: null, player: null, msg: 'VERLÄNGERUNG! Nächstes Tor entscheidet.',
    });

    let otSeconds = 0;
    let decided = false;
    while (!decided) {
      const step = 14 + Math.random() * 18;
      otSeconds += step;
      const timeStr = '+' + formatClock(otSeconds);

      const result = simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct, teamBBonusPct, true);
      if (result.scoringTeam === 'A') { scoreA++; decided = true; }
      else if (result.scoringTeam === 'B') { scoreB++; decided = true; }
      if (result.scoringTeam) result.msg += '  (' + scoreA + ':' + scoreB + ')';

      events.push({ time: timeStr, stepSeconds: step, isOvertime: true, ...result });
    }
  }

  events.push({
    time: '0:00', stepSeconds: 8, type: 'final', isFinal: true, team: null, player: null,
    msg: 'SPIELENDE — Endstand ' + scoreA + ':' + scoreB,
  });

  return { events, scoreA, scoreB, teamABonusPct: teamABonusPct * 100, teamBBonusPct: teamBBonusPct * 100 };
}
