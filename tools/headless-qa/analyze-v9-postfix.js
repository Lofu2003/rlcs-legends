// Bot Ecosystem V9 -- Phase 31-39 Analyse ueber die 3 POST-FIX-Laeufe
// (V9-POST-A/B/C, 3 NEUE Seeds, 20 Saisons, mit dem Root-Cause-#1-Fix
// "sellDisplacedRosterPlayer()" aktiv). Reine Post-hoc-Auswertung.
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv9_V9-POST-A.json'), B: loadRun('_auditv9_V9-POST-B.json'), C: loadRun('_auditv9_V9-POST-C.json') };

function bucketOfRank(rank) {
  if (rank === 1) return 'Champion';
  if (rank <= 10) return 'Top10';
  if (rank <= 30) return 'Top30';
  if (rank <= 50) return 'Top50';
  if (rank <= 100) return 'Top100';
  if (rank <= 200) return 'Midfield'; // 101-200 als "Mittelfeld" (Auftrag listet Midfield zwischen Top200 und Top100)
  if (rank <= 250) return 'Top250';
  if (rank <= 300) return 'Top300';
  if (rank <= 350) return 'Top350';
  if (rank <= 400) return 'Top400';
  return 'Below400';
}

// ============================================================
// PHASE 31/32 -- Bottom Mobility (30 Bottom10-Org-Faelle, BESTER je
// erreichter Rang ueber 20 Saisons -- KEINE erzwungene Erfolgsquote, reines
// Messergebnis).
// ============================================================
console.log('=== PHASE 31/32: Bottom Mobility (30 Bottom10-Org-Faelle, POST-FIX) ===');
const bucketCounts = {};
let bestRanks = [];
Object.entries(runs).forEach(([k, d]) => {
  d.setup.bottom10.forEach((orgName) => {
    let bestRank = 999;
    d.seasonSnapshots.forEach((s) => { if (s.orgs[orgName] && s.orgs[orgName].rank < bestRank) bestRank = s.orgs[orgName].rank; });
    bestRanks.push({ run: k, org: orgName, bestRank });
    const bucket = bucketOfRank(bestRank);
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
  });
});
console.log('Bucket-Verteilung (bester je erreichter Rang, 30 Faelle):', JSON.stringify(bucketCounts));
bestRanks.sort((a, b) => a.bestRank - b.bestRank);
console.log('Top5 beste Faelle:', JSON.stringify(bestRanks.slice(0, 5)));
console.log('WICHTIG: keine Erfolgsquote erzwungen -- dies ist das reine Messergebnis, auch wenn 0 Faelle einen Bucket erreichen.');

// ============================================================
// PHASE 33/34 -- Underdog Case Studies (3 beste + 3 schlechteste
// urspruengliche Bottom-Orgs, Zeitlinie S0/S5/S10/S15/S20).
// ============================================================
console.log('\n=== PHASE 33/34: Case Studies (beste 3 / schlechteste 3 Bottom10-Faelle) ===');
function timeline(run, orgName) {
  const d = runs[run];
  return [0, 5, 10, 15, 20].map((sn) => {
    const s = d.seasonSnapshots[sn];
    const o = s.orgs[orgName];
    if (!o) return { season: sn, missing: true };
    return { season: sn, rank: o.rank, strength: o.strength, budget: o.budget, avgOverall: o.avgOverall, avgPotential: o.avgPotential, hasCoach: o.hasCoach, coachOverall: o.coachOverall, majorsWon: o.majorsWon, worldsWon: o.worldsWon };
  });
}
const best3 = bestRanks.slice(0, 3);
const worst3 = [...bestRanks].sort((a, b) => b.bestRank - a.bestRank).slice(0, 3);
console.log('BESTE 3:');
best3.forEach((c) => console.log(' ' + c.run + '/' + c.org + ' (bestRank=' + c.bestRank + '):', JSON.stringify(timeline(c.run, c.org))));
console.log('SCHLECHTESTE 3:');
worst3.forEach((c) => console.log(' ' + c.run + '/' + c.org + ' (bestRank=' + c.bestRank + '):', JSON.stringify(timeline(c.run, c.org))));

// ============================================================
// PHASE 35/36 -- Midfield/Top Control Groups (10 Mid-Orgs x 3 Seeds, 10
// Top-Orgs x 3 Seeds) -- duerfen durch den Fix NICHT zerstoert werden.
// ============================================================
console.log('\n=== PHASE 35/36: Control Groups (Mid10/Top10, POST-FIX) ===');
['mid10', 'top10'].forEach((cohortKey) => {
  const label = cohortKey === 'mid10' ? 'MID' : 'TOP';
  let s0Ranks = [], s20Ranks = [], titleCount = 0;
  Object.entries(runs).forEach(([k, d]) => {
    d.setup[cohortKey].forEach((orgName) => {
      const s0 = d.seasonSnapshots[0].orgs[orgName], s20 = d.seasonSnapshots[20].orgs[orgName];
      if (s0) s0Ranks.push(s0.rank);
      if (s20) { s20Ranks.push(s20.rank); if (s20.majorsWon > 0 || s20.worldsWon > 0) titleCount++; }
    });
  });
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  console.log(label + '10 (30 Faelle): avgRank S0=' + avg(s0Ranks) + ' avgRank S20=' + avg(s20Ranks) + ' Faelle mit >=1 Titel bis S20=' + titleCount);
});

// ============================================================
// PHASE 37 -- Top Team Collapse (urspruengliche Top10, Abstieg aus
// Top50/Top100/Mittelfeld innerhalb 20 Saisons).
// ============================================================
console.log('\n=== PHASE 37: Top Team Collapse (urspruengliche Top10, POST-FIX) ===');
let collapseStats = { belowTop50: 0, belowTop100: 0, intoMidfieldOrWorse: 0, total: 0 };
Object.entries(runs).forEach(([k, d]) => {
  d.setup.top10.forEach((orgName) => {
    collapseStats.total++;
    let worstRank = 0;
    d.seasonSnapshots.forEach((s) => { if (s.orgs[orgName] && s.orgs[orgName].rank > worstRank) worstRank = s.orgs[orgName].rank; });
    if (worstRank > 50) collapseStats.belowTop50++;
    if (worstRank > 100) collapseStats.belowTop100++;
    if (worstRank > 200) collapseStats.intoMidfieldOrWorse++;
  });
});
console.log(JSON.stringify(collapseStats));

// ============================================================
// PHASE 38 -- New Elite (Orgs, die S0 NICHT Top50 waren, aber Top10/Top5/#1 erreichen).
// ============================================================
console.log('\n=== PHASE 38: New Elite (POST-FIX) ===');
let newEliteStats = { newTop10: 0, newTop5: 0, newNumber1: 0 };
Object.entries(runs).forEach(([k, d]) => {
  const top50NamesS0 = new Set(d.setup.top50Names0);
  d.seasonSnapshots.forEach((s) => {
    if (!s.top50Snapshot) return;
  });
  const finalTop50 = d.seasonSnapshots[20].top50Snapshot || [];
  finalTop50.slice(0, 10).forEach((name, idx) => {
    if (top50NamesS0.has(name)) return; // war schon S0 in Top50, zaehlt nicht als "neu"
    newEliteStats.newTop10++;
    if (idx < 5) newEliteStats.newTop5++;
    if (idx === 0) newEliteStats.newNumber1++;
  });
});
console.log(JSON.stringify(newEliteStats));

// ============================================================
// PHASE 39 -- Titles (Vollpopulation, S20-Snapshot).
// ============================================================
console.log('\n=== PHASE 39: Titles (Vollpopulation, POST-FIX) ===');
Object.entries(runs).forEach(([k, d]) => {
  const s20 = d.seasonSnapshots[20];
  if (!s20.fullTitles) { console.log(k + ': kein fullTitles-Snapshot bei S20'); return; }
  const withMajor = s20.fullTitles.filter((o) => o.majorsWon > 0).length;
  const withWorlds = s20.fullTitles.filter((o) => o.worldsWon > 0).length;
  const top5Titles = [...s20.fullTitles].sort((a, b) => b.majorsWon - a.majorsWon).slice(0, 5);
  const maxMajors = Math.max(...s20.fullTitles.map((o) => o.majorsWon));
  console.log('Run ' + k + ': eindeutige Major-Gewinner=' + withMajor + ' Worlds-Gewinner=' + withWorlds + ' laengste Major-Serie (Einzelorg)=' + maxMajors + ' Top5:', JSON.stringify(top5Titles.map((o) => o.name + ':' + o.majorsWon + 'M/' + o.worldsWon + 'W')));
});

fs.writeFileSync(path.join(__dirname, '_v9_phase31to39.json'), JSON.stringify({ bucketCounts, bestRanks, collapseStats, newEliteStats }, null, 2));
console.log('\n[Zwischenstand gespeichert: _v9_phase31to39.json]');
