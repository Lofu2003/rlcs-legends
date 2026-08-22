// Bot Ecosystem V15, Phase 7 (Age Planning) / Phase 8 (Succession Planning,
// Pre/Post-Retirement-Kadervergleich). Code-Beweis fuer Phase 7 (siehe unten)
// + empirische Staerke-Vorher/Nachher-Messung aus powerSnapshots+retirementLog.
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-BASE-' + s + '.json') }));

console.log('=== PHASE 7: Age Planning -- Code-Beweis ===');
console.log('scoreBotTransferCandidate()/scoreBotBuyFreeAgent()/scoreBotToBotTransferCandidate()');
console.log('(renderer.js) vergleichen ausschliesslich candidate.overall gegen weakest.person.overall');
console.log('(+ Potential/Alters-RABATT beim KANDIDATEN fuer REBUILD/DEEP_REBUILD, siehe V7-Fix) --');
console.log('KEINE dieser Funktionen liest je das ALTER der EIGENEN Starter, um eine bevorstehende');
console.log('Verrentung vorherzusehen. Ein 39-jaehriger 95-Overall-Starter (Beispiel aus dem Auftrag)');
console.log('wird buchstaeblich identisch behandelt wie ein 22-jaehriger 95-Overall-Starter -- BEIDE');
console.log('gelten als "kein Roster Need" (kein Kandidat schlaegt ihn), bis er tatsaechlich abgeht.');
console.log('Kein proaktives Succession Planning existiert -- korrekt dokumentiert, nicht erfunden.');

console.log('\n=== PHASE 8: Wie stark faellt die Kaderstaerke NACH einer Verrentung (Ueberraschungs-Proxy)? ===');
{
  // "Ueberraschung" operationalisiert als: Staerke der Org EINE Saison NACH
  // der Verrentung vs. EINE Saison DAVOR (der V14-Fix liefert IMMER sofort
  // einen Ersatz -- kein Roster-Leerstand -- die Frage ist die QUALITAETS-
  // Delle, nicht Abwesenheit).
  const deltas = [];
  const byOrgStrengthTier = { weak: [], mid: [], strong: [] };
  runs.forEach(({ data }) => {
    data.retirementLog.forEach((ret) => {
      const before = findSnap(data, Math.max(0, ret.season - 1));
      const after = findSnap(data, Math.min(data.targetSeasons, ret.season + 1));
      if (!before || !after) return;
      const rBefore = rowByName(before, ret.orgName), rAfter = rowByName(after, ret.orgName);
      if (!rBefore || !rAfter) return;
      const delta = rAfter.strength - rBefore.strength;
      deltas.push(delta);
      const tier = ret.orgStrength >= 70 ? 'strong' : ret.orgStrength >= 35 ? 'mid' : 'weak';
      byOrgStrengthTier[tier].push(delta);
    });
  });
  console.log('n Verrentungen mit Vorher/Nachher-Snapshot=' + deltas.length);
  console.log('Ø-Staerke-Delta (Saison davor -> Saison danach)=' + round(mean(deltas), 2));
  console.log('Negative Deltas (Kader wird schwaecher trotz sofortigem Ersatz): ' + deltas.filter((d) => d < 0).length + ' (' + round(100 * deltas.filter((d) => d < 0).length / deltas.length, 1) + '%)');
  Object.entries(byOrgStrengthTier).forEach(([tier, arr]) => {
    console.log('  ' + tier + '-Orgs (n=' + arr.length + '): Ø-Delta=' + round(mean(arr), 2) + ' negativ in ' + round(100 * arr.filter((d) => d < 0).length / (arr.length || 1), 1) + '% der Faelle');
  });
}
