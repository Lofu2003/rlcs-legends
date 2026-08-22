// Bot Ecosystem V16, Phase 27 (Retirement Exposure) / 28 (Elite Age
// Structure) / 29 (Retirement Shock S+1/+2/+3) / 30 (Succession
// Opportunities, Naeherung -- siehe Disclaimer im Log).
const { loadRun, round, mean, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv16_V16-POST-' + s + '.json') }));

function ageBucket(age) {
  if (age < 30) return '<30';
  if (age <= 33) return '30-33';
  if (age <= 36) return '34-36';
  if (age <= 38) return '37-38';
  return '39+';
}

console.log('=== PHASE 27: Retirement Exposure -- Altersverteilung der Starter ueber die Zeit (gepoolt) ===');
{
  [0, 10, 20, 30, 40, 50].forEach((season) => {
    const buckets = { '<30': 0, '30-33': 0, '34-36': 0, '37-38': 0, '39+': 0 };
    let total = 0;
    runs.forEach(({ data }) => {
      const snap = data.distributionSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons));
      if (!snap) return;
      snap.players.forEach((p) => { if (p.age !== null) { buckets[ageBucket(p.age)]++; total++; } });
    });
    console.log('S' + season + ' (n=' + total + '): ' + Object.entries(buckets).map(([b, c]) => b + '=' + round(100 * c / total, 1) + '%').join(', '));
  });
}

console.log('\n=== PHASE 28: Elite Age Structure -- Top10 vs Top50 vs Mid vs Bottom (aktueller Rang, Overall/Alter) ===');
{
  [10, 30, 50].forEach((season) => {
    const tiers = { Top10: [], Top50: [], Mid: [], Bottom: [] };
    runs.forEach(({ data }) => {
      const powerSnap = findSnap(data, Math.min(season, data.targetSeasons));
      const distSnap = data.distributionSnapshots.find((s) => s.season === Math.min(season, data.targetSeasons));
      if (!powerSnap || !distSnap) return;
      const rankByOrg = {};
      powerSnap.rows.forEach((r) => { rankByOrg[r.name] = r.rank; });
      distSnap.players.forEach((p) => {
        const rank = rankByOrg[p.org];
        if (!rank) return;
        const tier = rank <= 10 ? 'Top10' : rank <= 50 ? 'Top50' : rank <= 300 ? 'Mid' : 'Bottom';
        tiers[tier].push(p);
      });
    });
    console.log('S' + season + ':');
    Object.entries(tiers).forEach(([tier, players]) => {
      if (!players.length) return;
      console.log('  ' + tier + ' (n=' + players.length + '): Ø-Alter=' + round(mean(players.map((p) => p.age)), 1) + ' Ø-Overall=' + round(mean(players.map((p) => p.overall)), 1) + ' Ø-Potential=' + round(mean(players.map((p) => p.potential)), 1));
    });
  });
}

console.log('\n=== PHASE 29: Retirement Shock -- Staerke S-1/S/S+1/S+2/S+3, nach Org-Staerke-Tier ===');
{
  const byTier = { weak: [], mid: [], strong: [] };
  runs.forEach(({ data }) => {
    data.retirementLog.forEach((ret) => {
      const s = ret.season;
      const snaps = [-1, 0, 1, 2, 3].map((off) => findSnap(data, Math.max(0, Math.min(data.targetSeasons, s + off))));
      const rows = snaps.map((snap) => snap ? rowByName(snap, ret.orgName) : null);
      if (rows.some((r) => !r)) return;
      const tier = ret.orgStrength >= 70 ? 'strong' : ret.orgStrength >= 35 ? 'mid' : 'weak';
      byTier[tier].push(rows.map((r) => r.strength));
    });
  });
  Object.entries(byTier).forEach(([tier, series]) => {
    if (!series.length) return;
    const avgAt = (i) => round(mean(series.map((s) => s[i])), 2);
    console.log(tier + ' (n=' + series.length + '): S-1=' + avgAt(0) + ' S=' + avgAt(1) + ' S+1=' + avgAt(2) + ' S+2=' + avgAt(3) + ' S+3=' + avgAt(4));
  });
}

console.log('\n=== PHASE 30: Succession Opportunities (Naeherung) ===');
console.log('Disclaimer: exakte "war ein spezifischer juengerer Nachfolger im Markt verfuegbar"-Pruefung');
console.log('braeuchte eine Pro-Saison-Historie der FA-Pool-Einzelspieler (nicht erfasst, nur Restbestand-');
console.log('Anzahl) -- als Naeherung: hatte die Org in den 3 Saisons VOR einer Verrentung eines Spielers');
console.log('Alter>=34 ueberhaupt eine BUY_PLAYER-Kaufoption, hat sie genutzt?');
{
  const highRiskRetirements = [];
  runs.forEach(({ data }) => {
    data.retirementLog.forEach((ret) => { if (ret.age >= 34) highRiskRetirements.push({ data, ret }); });
  });
  console.log('n Verrentungen mit Alter>=34=' + highRiskRetirements.length);
  let hadOptionBefore = 0, usedOptionBefore = 0;
  highRiskRetirements.forEach(({ data, ret }) => {
    const preDecisions = (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.org === ret.orgName && d.season >= ret.season - 3 && d.season < ret.season);
    const hadOption = preDecisions.some((d) => (d.availableOptions || []).some((o) => o.label === 'BUY_PLAYER'));
    const used = preDecisions.some((d) => d.chosenLabel === 'BUY_PLAYER');
    if (hadOption) hadOptionBefore++;
    if (used) usedOptionBefore++;
  });
  console.log('  hatte in den 3 Saisons davor eine Kaufoption: ' + hadOptionBefore + ' (' + round(100 * hadOptionBefore / highRiskRetirements.length, 1) + '%)');
  console.log('  nutzte in dieser Zeit tatsaechlich einen Kauf (aus welchem Grund auch immer, nicht zwingend gezielte Nachfolge): ' + usedOptionBefore + ' (' + round(100 * usedOptionBefore / highRiskRetirements.length, 1) + '%)');
  console.log('  (Kein Beweis fuer/gegen gezielte Nachfolgeplanung -- nur ob generelle Marktaktivitaet stattfand. Siehe Abschlussbericht fuer die Einordnung.)');
}
