// Bot Ecosystem V15, Phase 3 (Player Buy Intelligence, >=5000 Kaufentscheidungen)
// / Phase 4 (Opportunity Cost, >=5000 NICHT getaetigte Verbesserungen) /
// Phase 6 (Roster Need Detection). Nutzt qaBotDecisionLog (SEASONAL_ECONOMY)
// aus allen 5 V15-BASE-Seeds.
const { loadRun, round, mean } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-POST-' + s + '.json') }));

console.log('=== PHASE 3: Player Buy Intelligence (SEASONAL_ECONOMY, chosenLabel=BUY_PLAYER) ===');
{
  const buys = [];
  runs.forEach(({ data }) => (data.decisionLog || []).forEach((d) => { if (d.decisionType === 'SEASONAL_ECONOMY' && d.chosenLabel === 'BUY_PLAYER') buys.push(d); }));
  console.log('n=' + buys.length + ' (Ziel >=5000)');
  // Erkennt Bot seinen schwaechsten Spieler? -- reason-String hat Form
  // "Ersetzt schwächsten Spieler (X) durch Y (Z), Ziel: GOAL." -- IMMER, da
  // scoreBotTransferCandidate() strukturell NUR den weakest-Slot vergleicht
  // (Code-Beweis, siehe Abschlussbericht) -- empirische Gegenprobe hier:
  const targetsWeakest = buys.filter((d) => d.reason && d.reason.indexOf('Ersetzt schwächsten Spieler') === 0).length;
  console.log('Kauf zielt strukturell auf den schwaechsten Slot: ' + targetsWeakest + '/' + buys.length + ' (' + round(100 * targetsWeakest / buys.length, 1) + '%)');
  console.log('Ø-Budget bei Kauf=' + round(mean(buys.map((d) => d.budget))) + ' Ø-orgStrength=' + round(mean(buys.map((d) => d.orgStrength)), 1));
  const byFinance = {};
  buys.forEach((d) => { byFinance[d.financeStatus] = (byFinance[d.financeStatus] || 0) + 1; });
  console.log('Nach Finanzstatus: ' + JSON.stringify(byFinance));
}

console.log('\n=== PHASE 4: Opportunity Cost -- BUY_PLAYER war verfuegbar, wurde aber NICHT gewaehlt ===');
{
  const passedOver = [];
  runs.forEach(({ data }) => (data.decisionLog || []).forEach((d) => {
    if (d.decisionType !== 'SEASONAL_ECONOMY') return;
    const buyOpt = (d.availableOptions || []).find((o) => o.label === 'BUY_PLAYER');
    if (buyOpt && d.chosenLabel !== 'BUY_PLAYER') passedOver.push({ ...d, buyScore: buyOpt.score });
  }));
  console.log('n=' + passedOver.length + ' (Ziel >=5000) -- BUY_PLAYER verfuegbar, aber etwas anderes gewaehlt');
  const byChosen = {};
  passedOver.forEach((d) => { byChosen[d.chosenLabel] = (byChosen[d.chosenLabel] || 0) + 1; });
  console.log('Stattdessen gewaehlt: ' + JSON.stringify(byChosen));
  // Wie knapp war die Entscheidung? (BUY_PLAYER-Score vs. gewaehlter Score)
  const margins = passedOver.map((d) => d.chosenScore - d.buyScore);
  console.log('Ø-Score-Vorsprung des Gewinners gegenueber BUY_PLAYER=' + round(mean(margins), 2) + ' (negativ waere ein Bug -- Gewinner MUSS score >= BUY_PLAYER haben)');
  console.log('Faelle mit negativem Vorsprung (Bug-Kandidat): ' + margins.filter((m) => m < 0).length);
}

console.log('\n=== PHASE 6: Roster Need Detection -- landen Upgrades an der richtigen Stelle? ===');
{
  // Da scoreBotTransferCandidate()/scoreBotBuyFreeAgent() strukturell IMMER
  // den aktuell schwaechsten Slot ersetzen (Code-Beweis, siehe Phase 3), ist
  // "falsche Stelle" strukturell ausgeschlossen -- die einzige offene Frage
  // ist, ob der SCHWAECHSTE Slot regelmaessig VOM DURCHSCHNITT ausreichend
  // abweicht, um ueberhaupt Handlungsbedarf zu signalisieren.
  const gaps = [];
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.weakestStarterOverall > 0).forEach((d) => {
    gaps.push(d.rosterAvgOverall - d.weakestStarterOverall);
  }));
  console.log('n=' + gaps.length + ' Ø-Gap(Kaderschnitt-schwaechster Slot)=' + round(mean(gaps), 2));
  console.log('Gap>=10 (deutliche Schwachstelle): ' + gaps.filter((g) => g >= 10).length + ' (' + round(100 * gaps.filter((g) => g >= 10).length / gaps.length, 1) + '%)');
  console.log('Gap<3 (ausgeglichener Kader, wenig Handlungsbedarf): ' + gaps.filter((g) => g < 3).length + ' (' + round(100 * gaps.filter((g) => g < 3).length / gaps.length, 1) + '%)');
}
