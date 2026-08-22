// Bot Ecosystem V15, Phase 27 "RNG vs Management" -- Auswertung der 5
// Identical-Start-Laeufe (20 Klone x 5 Seeds x 20 Saisons).
const { round, mean, stddev } = require('./v14-lib');
const fs = require('fs'), path = require('path');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => {
  const f = path.join(__dirname, '_v15_identical_V15-ID-' + s + '.json');
  return fs.existsSync(f) ? { seed: s, data: JSON.parse(fs.readFileSync(f, 'utf8')) } : null;
}).filter(Boolean);

console.log('=== PHASE 27: RNG vs. Management -- Streuung unter 20 identischen Klonen ===');
runs.forEach(({ seed, data }) => {
  console.log('\n[' + seed + '] pageErrors=' + data.pageErrors.length);
  [5, 10, 20].forEach((season) => {
    const snap = data.snapshots.find((s) => s.season === season);
    if (!snap) return;
    console.log('  S' + season + ': Rank-StdDev=' + stddev(snap.rows.map((r) => r.rank)) + ' Strength-StdDev=' + stddev(snap.rows.map((r) => r.strength)) + ' Budget-StdDev=' + round(stddev(snap.rows.map((r) => r.budget)), 0) + ' Range Strength=[' + Math.min(...snap.rows.map((r) => r.strength)) + ',' + Math.max(...snap.rows.map((r) => r.strength)) + ']');
  });
  // Divergenz-Quellen: wie viele Verrentungen/Transfers pro Klon (Streuung
  // DIESER Zahlen selbst ist ein Proxy fuer "wie viel vom Auseinanderdriften
  // kommt aus unterschiedlich GETROFFENEN Gelegenheiten" statt Entscheidungsqualitaet).
  const retByOrg = {}, transByOrg = {};
  (data.retirements || []).forEach((r) => { retByOrg[r.orgName] = (retByOrg[r.orgName] || 0) + 1; });
  (data.transfers || []).forEach((t) => { const org = data.setup.groupNames.includes(t.to) ? t.to : t.from; transByOrg[org] = (transByOrg[org] || 0) + 1; });
  const retCounts = data.setup.groupNames.map((n) => retByOrg[n] || 0);
  const transCounts = data.setup.groupNames.map((n) => transByOrg[n] || 0);
  console.log('  Retirement-Anzahl pro Klon: Ø=' + round(mean(retCounts), 2) + ' StdDev=' + stddev(retCounts) + ' Range=[' + Math.min(...retCounts) + ',' + Math.max(...retCounts) + ']');
  console.log('  Transfer-Anzahl pro Klon: Ø=' + round(mean(transCounts), 2) + ' StdDev=' + stddev(transCounts) + ' Range=[' + Math.min(...transCounts) + ',' + Math.max(...transCounts) + ']');
});

console.log('\n=== Gepoolt ueber alle Seeds: Korrelation Retirement-Anzahl <-> S20-Staerke ===');
{
  const { pearson } = require('./v14-lib');
  const retCountsAll = [], strengthAll = [];
  runs.forEach(({ data }) => {
    const snap20 = data.snapshots.find((s) => s.season === 20);
    if (!snap20) return;
    const retByOrg = {};
    (data.retirements || []).forEach((r) => { retByOrg[r.orgName] = (retByOrg[r.orgName] || 0) + 1; });
    data.setup.groupNames.forEach((name) => {
      const row = snap20.rows.find((r) => r.name === name);
      if (!row) return;
      retCountsAll.push(retByOrg[name] || 0);
      strengthAll.push(row.strength);
    });
  });
  console.log('n=' + retCountsAll.length + ' Korrelation Retirement-Anzahl<->S20-Staerke=' + pearson(retCountsAll, strengthAll) + ' (negativ erwartet: mehr Verrentungen -> mehr Reset-Zyklen -> im Schnitt schwaecher, konsistent mit V14-Root-Cause)');
}
