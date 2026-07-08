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

function duelStat(p) {
  return p.mechanics * 0.5 + p.speed * 0.3 + p.gameSense * 0.2;
}

function resolveDuel(attVal, defVal) {
  const att = gaussianRandom(attVal, Math.max(1, attVal * 0.15));
  const def = gaussianRandom(defVal, Math.max(1, defVal * 0.15));
  return att > def;
}

function shotOnGoalChance(shooting) {
  return Math.min(0.60, Math.max(0.12, 0.35 + (shooting - 75) / 100 * 0.5));
}

function goalChance(shooting, bestDefending) {
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

/**
 * Löst EIN Ballbesitz-Ereignis auf (Duell, ggf. Torschuss/Parade/Fehlschuss).
 * Gibt ein Ereignis-Objekt zurück (ohne time/stepSeconds — die setzt der Aufrufer).
 */
function simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct) {
  const playerA = pickRandom(activeTeamA);
  const playerB = pickRandom(teamB);
  const aWins = resolveDuel(duelStat(playerA) * (1 + teamABonusPct), duelStat(playerB));
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
      msg: 'Duell gewonnen von ' + winner.name + ' (' + winnerLabel + ')',
      scoringTeam: null,
    };
  }

  const defender = bestDefender(defendingTeam);
  const scored = Math.random() < goalChance(winner.shooting, defender.defending);

  if (scored) {
    return {
      type: 'goal', isGoal: true, team: winnerTeamTag, player: winner.name,
      msg: 'TOR! ' + winner.name + ' trifft für ' + winnerLabel + '!',
      scoringTeam: winnerTeamTag,
    };
  } else if (Math.random() < 0.55) {
    // Parade: der beste Verteidiger der Gegenseite hält den Schuss
    return {
      type: 'save', team: defendingTeamTag, player: defender.name,
      msg: 'PARADE! ' + defender.name + ' (' + defendingLabel + ') hält den Schuss von ' + winner.name + '!',
      scoringTeam: null,
    };
  }
  return {
    type: 'miss', team: winnerTeamTag, player: winner.name,
    msg: 'Schuss von ' + winner.name + ' (' + winnerLabel + ') — daneben!',
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
 * myOptions (optional, nur für Team A — das eigene, gedraftete Team):
 *   - coach:            Coach-Objekt oder null — Team-Bonus/-Malus auf alle Duelle
 *   - sub:              Sub-Spieler-Objekt oder null — Wechsel zur Spielhälfte
 *   - orgMatchBonusPct: Bonus/Malus (Prozentpunkte, z.B. +4.4 oder -7.2) aus der
 *                       zugewiesenen Organisation — kombiniert sich mit dem Coach-Bonus
 */
function simulateMatch(teamA, teamB, nameA, nameB, myOptions) {
  myOptions = myOptions || {};
  const coachBonusFraction = myOptions.coach ? ((myOptions.coach.overall - 75) / 100) * 0.18 : 0;
  const orgBonusFraction = (myOptions.orgMatchBonusPct || 0) / 100;
  const teamABonusPct = coachBonusFraction + orgBonusFraction;

  let clock = 300; // 5 Minuten Spielzeit
  let scoreA = 0, scoreB = 0;
  const events = [];

  let activeTeamA = teamA.slice();
  let subDone = !myOptions.sub;
  const subSwapClock = myOptions.sub ? 130 + Math.random() * 40 : null; // zw. 2:10 und 2:50 Restzeit

  while (clock > 0) {
    const step = 14 + Math.random() * 18; // 14-32 Spiel-Sekunden pro Ereignis
    clock -= step;
    const timeStr = formatClock(clock);

    if (!subDone && clock <= subSwapClock) {
      const outIdx = Math.floor(Math.random() * activeTeamA.length);
      const outPlayer = activeTeamA[outIdx];
      activeTeamA = activeTeamA.slice();
      activeTeamA[outIdx] = myOptions.sub;
      subDone = true;
      events.push({
        time: timeStr, stepSeconds: step, type: 'sub',
        msg: 'Wechsel: ' + myOptions.sub.name + ' kommt für ' + outPlayer.name + ' (' + nameA + ')',
        team: 'A', player: myOptions.sub.name, subOutName: outPlayer.name,
        subInPlayer: myOptions.sub,
      });
      continue;
    }

    const result = simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct);
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

      const result = simulatePossession(activeTeamA, teamB, nameA, nameB, teamABonusPct);
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

  return { events, scoreA, scoreB, teamABonusPct: teamABonusPct * 100 };
}
