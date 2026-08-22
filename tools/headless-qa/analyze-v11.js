// Bot Ecosystem V11 -- Generational Realism, Stat Inflation & Career
// Dynamics. Phase 3-21, 30-40: reine Post-hoc-Auswertung ueber die 3
// PRE-FIX-Laeufe (V11-BASE-A/B/C, V10-Code als Baseline, KEINE Gameplay-
// Aenderung).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv11_V11-BASE-A.json'), B: loadRun('_auditv11_V11-BASE-B.json'), C: loadRun('_auditv11_V11-BASE-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p25: percentile(s, 0.25), p75: percentile(s, 0.75), p90: percentile(s, 0.9), p95: percentile(s, 0.95), p99: percentile(s, 0.99), n: s.length };
}
function bucketize(nums, field) {
  const buckets = { u50: 0, b50: 0, b60: 0, b70: 0, b80: 0, b90: 0, b95: 0, p99: 0 };
  nums.forEach((v) => {
    if (v < 50) buckets.u50++; else if (v < 60) buckets.b50++; else if (v < 70) buckets.b60++; else if (v < 80) buckets.b70++;
    else if (v < 90) buckets.b80++; else if (v < 95) buckets.b90++; else if (v < 99) buckets.b95++; else buckets.p99++;
  });
  return buckets;
}

const distAt = {}; // pooled overall/potential arrays per checkpoint
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
CHECKPOINTS.forEach((season) => {
  const overalls = [], potentials = [];
  Object.values(runs).forEach((d) => {
    const snap = d.distributionSnapshots.find((s) => s.season === season);
    if (snap) snap.players.forEach((p) => { overalls.push(p.overall); potentials.push(p.potential); });
  });
  distAt[season] = { overalls, potentials };
});

// ============================================================
// PHASE 3 -- Player Overall Distribution (Buckets + Perzentile).
// ============================================================
console.log('=== PHASE 3: Player Overall Distribution (gepoolt, 3 Laeufe) ===');
CHECKPOINTS.forEach((season) => {
  const ov = distAt[season].overalls;
  if (!ov.length) return;
  console.log('S' + season + ' Buckets:', JSON.stringify(bucketize(ov)), 'Stats:', JSON.stringify(distStats(ov)));
});

// ============================================================
// PHASE 4 -- Potential Distribution.
// ============================================================
console.log('\n=== PHASE 4: Potential Distribution (gepoolt, 3 Laeufe) ===');
CHECKPOINTS.forEach((season) => {
  const pt = distAt[season].potentials;
  if (!pt.length) return;
  console.log('S' + season + ' Buckets:', JSON.stringify(bucketize(pt)), 'Stats:', JSON.stringify(distStats(pt)));
});
console.log('\nPotential=99 Anteil je Checkpoint:');
CHECKPOINTS.forEach((season) => {
  const pt = distAt[season].potentials;
  if (!pt.length) return;
  console.log('S' + season + ':', round(100 * pt.filter((v) => v >= 99).length / pt.length, 1) + '%');
});

// ============================================================
// PHASE 5/6 -- Generation Quality (nach creationReason).
// ============================================================
console.log('\n=== PHASE 5/6: Generation Quality nach creationReason (gepoolt) ===');
const allGen = [];
Object.values(runs).forEach((d) => allGen.push(...d.generationLog));
const byReason = {};
allGen.forEach((g) => { if (!byReason[g.creationReason]) byReason[g.creationReason] = []; byReason[g.creationReason].push(g); });
Object.entries(byReason).forEach(([reason, list]) => {
  const overalls = list.map((g) => g.overall), potentials = list.map((g) => g.potential), gaps = list.map((g) => g.potential - g.overall), ages = list.map((g) => g.age);
  console.log(reason + ' (n=' + list.length + '): avgOverall=' + round(overalls.reduce((a, b) => a + b, 0) / list.length, 1) + ' avgPotential=' + round(potentials.reduce((a, b) => a + b, 0) / list.length, 1) + ' avgGap=' + round(gaps.reduce((a, b) => a + b, 0) / list.length, 1) + ' avgAge=' + round(ages.reduce((a, b) => a + b, 0) / list.length, 1));
});
console.log('\nWerden spaetere Generationen systematisch staerker? (RETIREMENT_REPLACEMENT, avgPotential nach Geburts-Saisons-Dekade)');
const rr = byReason['RETIREMENT_REPLACEMENT'] || [];
const decades = {};
rr.forEach((g) => { const d = Math.floor(g.birthSeason / 10) * 10; if (!decades[d]) decades[d] = []; decades[d].push(g.potential); });
Object.keys(decades).sort((a, b) => a - b).forEach((d) => { const arr = decades[d]; console.log('Saisons ' + d + '-' + (Number(d) + 9) + ' (n=' + arr.length + '): avgPotential=' + round(arr.reduce((a, b) => a + b, 0) / arr.length, 1)); });

// ============================================================
// PHASE 7/8 -- Retirement Replacement Root Cause + Korrelation.
// ============================================================
console.log('\n=== PHASE 7/8: Retirement -> Replacement Korrelation ===');
const allRet = [];
Object.values(runs).forEach((d) => allRet.push(...d.retirementLog));
console.log('Gesamt Retirements (gepoolt):', allRet.length);
// Fuer jedes Retirement: das NAECHSTE RETIREMENT_REPLACEMENT-Event derselben
// Org+Rolle NACH diesem Saison-Zeitpunkt ist der Ersatz (ueber genId der
// Generation-Log-Eintraege verknuepfbar -- retirementLog selbst enthaelt
// bereits birthSeason/creationReason/peakOverall/peakAge DES VORGAENGERS
// direkt, s. renderer.js-Hook). Fuer die Korrelation matchen wir stattdessen
// zeitlich: Ersatz = generationLog-Eintrag mit creationReason=
// RETIREMENT_REPLACEMENT, gleiche Org+Rolle, gleiche birthSeason wie das
// Retirement (beide Events laufen im selben Funktionsaufruf).
const genByOrgRoleSeason = new Map();
allGen.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT').forEach((g) => {
  const key = g.org + '::' + g.role + '::' + g.birthSeason;
  if (!genByOrgRoleSeason.has(key)) genByOrgRoleSeason.set(key, []);
  genByOrgRoleSeason.get(key).push(g);
});
const pairs = [];
allRet.forEach((r) => {
  const key = r.orgName + '::' + r.role + '::' + r.season;
  const candidates = genByOrgRoleSeason.get(key);
  if (candidates && candidates.length) {
    const repl = candidates.shift();
    pairs.push({ retiredOverall: r.overall, retiredPotential: r.potential, replOverall: repl.overall, replPotential: repl.potential });
  }
});
console.log('Gematchte Retirement->Replacement-Paare:', pairs.length);
// Bucket-Analyse: fuer Retiree-Overall-Baender, durchschnittliches Replacement-Potential.
[[45, 55, '50'], [55, 65, '60'], [65, 75, '70'], [75, 85, '80'], [85, 92, '90'], [92, 97, '95'], [97, 100, '99']].forEach(([lo, hi, label]) => {
  const sel = pairs.filter((p) => p.retiredOverall >= lo && p.retiredOverall < hi);
  if (!sel.length) { console.log('Retiree-Overall ~' + label + ': n=0'); return; }
  console.log('Retiree-Overall ~' + label + ' (n=' + sel.length + '): avgReplacementPotential=' + round(sel.reduce((s, p) => s + p.replPotential, 0) / sel.length, 1) + ' avgReplacementOverall=' + round(sel.reduce((s, p) => s + p.replOverall, 0) / sel.length, 1));
});
// Pearson-Korrelation Retired-Overall vs Replacement-Potential.
function pearson(xs, ys) {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2 || 1);
}
if (pairs.length > 10) console.log('Pearson-Korrelation (Retired Overall vs Replacement Potential):', round(pearson(pairs.map((p) => p.retiredOverall), pairs.map((p) => p.replPotential)), 3));
if (pairs.length > 10) console.log('Pearson-Korrelation (Retired Overall vs Replacement Overall):', round(pearson(pairs.map((p) => p.retiredOverall), pairs.map((p) => p.replOverall)), 3));

// ============================================================
// PHASE 9 -- Organization Quality vs Talent Quality.
// ============================================================
console.log('\n=== PHASE 9: Bindung an Org-Tier vs Zufall (RETIREMENT_REPLACEMENT nach S0-Org-Tier) ===');
const tierMaps = {};
Object.entries(runs).forEach(([k, d]) => {
  const s0 = d.powerSnapshots.find((p) => p.season === 0);
  const sorted = [...s0.rows].sort((a, b) => b.strength - a.strength);
  const n = sorted.length; const map = new Map();
  sorted.forEach((r, i) => map.set(r.name, i < n / 3 ? 'top' : (i < 2 * n / 3 ? 'mid' : 'bottom')));
  tierMaps[k] = map;
});
const byTierGen = { top: [], mid: [], bottom: [] };
Object.entries(runs).forEach(([k, d]) => {
  d.generationLog.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT').forEach((g) => {
    const t = tierMaps[k].get(g.org); if (t) byTierGen[t].push(g.potential);
  });
});
['top', 'mid', 'bottom'].forEach((t) => { const arr = byTierGen[t]; console.log(t + ' (n=' + arr.length + '): avgReplacementPotential=' + round(arr.reduce((a, b) => a + b, 0) / (arr.length || 1), 1)); });
console.log('(Falls die 3 Werte nah beieinander liegen: Potential-Zuteilung ist weitgehend Org-unabhaengig/zufaellig -- wie vom Design-Ziel Phase 10 gefordert.)');

// ============================================================
// PHASE 11 -- Global Talent Distribution (S0, datenbasierte Grenzen).
// ============================================================
console.log('\n=== PHASE 11: Global Talent Distribution (S0-Potential-Perzentile) ===');
console.log(JSON.stringify(distStats(distAt[0].potentials)));

// ============================================================
// PHASE 12/13 -- Superstar Rarity & Supply (95+/99 Potential, Generation vs Retirement pro Saison).
// ============================================================
console.log('\n=== PHASE 12/13: Superstar Supply vs Retirement (95+/99 Potential, pro Saison) ===');
const genPerSeason = {}, retPerSeason = {};
allGen.filter((g) => g.creationReason !== 'INITIAL').forEach((g) => {
  if (!genPerSeason[g.birthSeason]) genPerSeason[g.birthSeason] = { p95: 0, p99: 0, total: 0 };
  genPerSeason[g.birthSeason].total++;
  if (g.potential >= 95) genPerSeason[g.birthSeason].p95++;
  if (g.potential >= 99) genPerSeason[g.birthSeason].p99++;
});
allRet.forEach((r) => {
  if (!retPerSeason[r.season]) retPerSeason[r.season] = { p95: 0, p99: 0, total: 0 };
  retPerSeason[r.season].total++;
  if (r.potential >= 95) retPerSeason[r.season].p95++;
  if (r.potential >= 99) retPerSeason[r.season].p99++;
});
const totalGen95 = Object.values(genPerSeason).reduce((s, v) => s + v.p95, 0);
const totalGen99 = Object.values(genPerSeason).reduce((s, v) => s + v.p99, 0);
const totalRet95 = Object.values(retPerSeason).reduce((s, v) => s + v.p95, 0);
const totalRet99 = Object.values(retPerSeason).reduce((s, v) => s + v.p99, 0);
console.log('Neu erzeugt (nicht INITIAL) mit Potential>=95:', totalGen95, ' >=99:', totalGen99);
console.log('In Rente gegangen mit Potential>=95:', totalRet95, ' >=99:', totalRet99);
console.log('Netto-Elite-Bilanz (95+):', totalGen95 - totalRet95, ' (99):', totalGen99 - totalRet99, '-- positiv = Elite-Inflation');

// ============================================================
// PHASE 14/15 -- Career Arc + Peak Age.
// ============================================================
console.log('\n=== PHASE 14/15: Career Arc + Peak Age (aus retirementLog, n=' + allRet.length + ') ===');
const withPeak = allRet.filter((r) => r.peakOverall !== undefined && r.peakAge !== undefined && r.birthSeason !== undefined);
console.log('Faelle mit vollstaendigen Karrieredaten (Geburt UND Rente beide QA-getaggt):', withPeak.length);
if (withPeak.length > 20) {
  console.log('Peak-Age Verteilung:', JSON.stringify(distStats(withPeak.map((r) => r.peakAge))));
  console.log('Peak-Overall Verteilung:', JSON.stringify(distStats(withPeak.map((r) => r.peakOverall))));
  console.log('Karrierelaenge (Saisons, Rente-Saison minus Geburts-Saison):', JSON.stringify(distStats(withPeak.map((r) => r.season - r.birthSeason))));
  console.log('Rente-Overall vs Peak-Overall (Anteil, die GENAU bei Rente auf Career-High sind):', round(100 * withPeak.filter((r) => r.overall >= r.peakOverall).length / withPeak.length, 1) + '%');
}

// ============================================================
// PHASE 16/17 -- Natural Decline + Old Player Behavior.
// ============================================================
console.log('\n=== PHASE 16: Overall nach Alter (Vollpopulation, letzter Checkpoint je Lauf) ===');
const ageOverall = {};
Object.values(runs).forEach((d) => {
  const lastSnap = d.distributionSnapshots[d.distributionSnapshots.length - 1];
  lastSnap.players.forEach((p) => { if (p.age === null) return; if (!ageOverall[p.age]) ageOverall[p.age] = []; ageOverall[p.age].push(p.overall); });
});
[20, 22, 25, 28, 30, 32, 34, 36, 38, 40].forEach((age) => {
  const arr = ageOverall[age] || [];
  console.log('Alter ' + age + ' (n=' + arr.length + '): avgOverall=' + (arr.length ? round(arr.reduce((a, b) => a + b, 0) / arr.length, 1) : 'n/a'));
});
console.log('\n=== PHASE 17: Anteil auf Career-High bei hohem Alter (aus retirementLog) ===');
[35, 37, 39].forEach((minAge) => {
  const sel = withPeak.filter((r) => r.age >= minAge);
  if (!sel.length) { console.log(minAge + '+: n=0'); return; }
  const onHigh = sel.filter((r) => r.overall >= r.peakOverall).length;
  console.log(minAge + '+ (n=' + sel.length + '): ' + round(100 * onHigh / sel.length, 1) + '% auf Career-High bei Renteneintritt');
});

// ============================================================
// PHASE 21 -- Potential Realization.
// ============================================================
console.log('\n=== PHASE 21: Potential Realization (aus retirementLog, Overall/Potential-Verhaeltnis bei Rente) ===');
if (withPeak.length > 20) {
  const ratios = withPeak.map((r) => r.overall / (r.potential || r.overall || 1));
  [0.5, 0.75, 0.9, 0.95, 1.0].forEach((thresh) => {
    console.log('>= ' + Math.round(thresh * 100) + '% des Potentials erreicht:', round(100 * ratios.filter((r) => r >= thresh).length / ratios.length, 1) + '%');
  });
}

// ============================================================
// PHASE 30/31 -- Staff Distribution & Saturation.
// ============================================================
console.log('\n=== PHASE 30/31: Staff Distribution nach Rolle (S0/S10/S20/S30/S50) ===');
[0, 10, 20, 30, 50].forEach((season) => {
  const byRole = {};
  Object.values(runs).forEach((d) => {
    const snap = d.staffSnapshots.find((s) => s.season === season);
    if (!snap) return;
    snap.rows.forEach((r) => { if (!byRole[r.role]) byRole[r.role] = []; byRole[r.role].push(r.overall); });
  });
  const summary = {};
  Object.entries(byRole).forEach(([role, arr]) => {
    summary[role] = { n: arr.length, avg: round(arr.reduce((a, b) => a + b, 0) / arr.length, 1), pct90: round(100 * arr.filter((v) => v >= 90).length / arr.length, 1), pct95: round(100 * arr.filter((v) => v >= 95).length / arr.length, 1), pct99: round(100 * arr.filter((v) => v >= 99).length / arr.length, 1) };
  });
  console.log('S' + season + ':', JSON.stringify(summary));
});

// ============================================================
// PHASE 32 -- Staff Retirement Replacement (dieselbe Korrelationspruefung wie Phase 7/8, nur Personal-Rollen).
// ============================================================
console.log('\n=== PHASE 32: Staff Retirement -> Replacement Korrelation ===');
const staffRoles = new Set(['Coach', 'Scout', 'Analyst', 'Finanzvorstand', 'PR-Manager', 'Psychologe', 'Physiotherapeut']);
const staffPairs = pairs.length ? [] : []; // placeholder, echte Berechnung unten
const staffRet = allRet.filter((r) => staffRoles.has(r.role));
const staffGenByKey = new Map();
allGen.filter((g) => g.creationReason === 'RETIREMENT_REPLACEMENT' && staffRoles.has(g.role)).forEach((g) => {
  const key = g.org + '::' + g.role + '::' + g.birthSeason;
  if (!staffGenByKey.has(key)) staffGenByKey.set(key, []);
  staffGenByKey.get(key).push(g);
});
const staffPairsReal = [];
staffRet.forEach((r) => {
  const key = r.orgName + '::' + r.role + '::' + r.season;
  const cands = staffGenByKey.get(key);
  if (cands && cands.length) { const repl = cands.shift(); staffPairsReal.push({ retiredOverall: r.overall, replPotential: repl.potential, replOverall: repl.overall }); }
});
console.log('Gematchte Staff-Retirement-Paare:', staffPairsReal.length);
if (staffPairsReal.length > 10) console.log('Pearson-Korrelation (Staff Retired Overall vs Replacement Potential):', round(pearson(staffPairsReal.map((p) => p.retiredOverall), staffPairsReal.map((p) => p.replPotential)), 3));

// ============================================================
// PHASE 36 -- Dynasties (Top1/Top5-Dauer).
// ============================================================
console.log('\n=== PHASE 36: Dynasties (Top1/Top5-Dauer ueber Checkpoints) ===');
Object.entries(runs).forEach(([k, d]) => {
  const rank1PerCheckpoint = d.powerSnapshots.map((s) => { const r1 = [...s.rows].sort((a, b) => a.rank - b.rank)[0]; return { season: s.season, name: r1 ? r1.name : null }; });
  console.log('Run ' + k + ' Rang-1 je Checkpoint:', JSON.stringify(rank1PerCheckpoint.map((r) => r.name)));
  const top5Sets = d.powerSnapshots.map((s) => new Set([...s.rows].sort((a, b) => a.rank - b.rank).slice(0, 5).map((r) => r.name)));
  const allTop5Names = new Set(); top5Sets.forEach((s) => s.forEach((n) => allTop5Names.add(n)));
  const persistence = {};
  allTop5Names.forEach((n) => { persistence[n] = top5Sets.filter((s) => s.has(n)).length; });
  const sortedPersist = Object.entries(persistence).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('Run ' + k + ' laengste Top5-Praesenz (von ' + d.powerSnapshots.length + ' Checkpoints):', JSON.stringify(sortedPersist));
});

// ============================================================
// PHASE 38/39/40 -- New Elite / Bottom Success / Bottom Failure Case Studies.
// ============================================================
console.log('\n=== PHASE 38: New Elite Timelines (Top5 bei S50, war NICHT Top50 bei S0) ===');
Object.entries(runs).forEach(([k, d]) => {
  const s0 = d.powerSnapshots.find((p) => p.season === 0);
  const last = d.powerSnapshots[d.powerSnapshots.length - 1];
  const top50S0 = new Set([...s0.rows].sort((a, b) => a.rank - b.rank).slice(0, 50).map((r) => r.name));
  const top5Last = [...last.rows].sort((a, b) => a.rank - b.rank).slice(0, 5);
  top5Last.forEach((r) => {
    if (top50S0.has(r.name)) return;
    const timeline = d.powerSnapshots.map((s) => { const row = s.rows.find((x) => x.name === r.name); return row ? { season: s.season, rank: row.rank, strength: row.strength, overall: row.avgStarterOverall } : null; }).filter(Boolean);
    console.log('Run ' + k + ' NEUE ELITE ' + r.name + ':', JSON.stringify(timeline));
  });
});

console.log('\n=== PHASE 39: Bottom Success Cases (staerkster Rang-Gewinn, Bottom10-Kohorte) ===');
Object.entries(runs).forEach(([k, d]) => {
  const last = d.powerSnapshots[d.powerSnapshots.length - 1];
  const cases = d.setup.bottom10.map((name) => {
    const s0row = d.powerSnapshots[0].rows.find((r) => r.name === name);
    const lastrow = last.rows.find((r) => r.name === name);
    if (!s0row || !lastrow) return null;
    return { name, rankGain: s0row.rank - lastrow.rank, timeline: d.powerSnapshots.map((s) => { const row = s.rows.find((x) => x.name === name); return row ? { season: s.season, rank: row.rank, strength: row.strength } : null; }).filter(Boolean) };
  }).filter(Boolean);
  cases.sort((a, b) => b.rankGain - a.rankGain);
  console.log('Run ' + k + ' bester Bottom10-Fall:', JSON.stringify(cases[0]));
});

console.log('\n=== PHASE 40: Bottom Failure Cases (schwaechster Rang-Gewinn, Bottom10-Kohorte) ===');
Object.entries(runs).forEach(([k, d]) => {
  const last = d.powerSnapshots[d.powerSnapshots.length - 1];
  const cases = d.setup.bottom10.map((name) => {
    const s0row = d.powerSnapshots[0].rows.find((r) => r.name === name);
    const lastrow = last.rows.find((r) => r.name === name);
    if (!s0row || !lastrow) return null;
    return { name, rankGain: s0row.rank - lastrow.rank };
  }).filter(Boolean);
  cases.sort((a, b) => a.rankGain - b.rankGain);
  console.log('Run ' + k + ' schlechtester Bottom10-Fall:', JSON.stringify(cases[0]));
});

// ============================================================
// COMPETITIVE MOBILITY -- Bottom/Mid/Top S0->S20->S50.
// ============================================================
console.log('\n=== Competitive Mobility: Bottom10/Mid10/Top10 Rang S0->S20->S50 ===');
['bottom10', 'mid10', 'top10'].forEach((cohortKey) => {
  const label = cohortKey.replace('10', '');
  let s0Ranks = [], s20Ranks = [], sLastRanks = [];
  Object.values(runs).forEach((d) => {
    const s0 = d.powerSnapshots.find((p) => p.season === 0);
    const s20 = d.powerSnapshots.find((p) => p.season === 20);
    const last = d.powerSnapshots[d.powerSnapshots.length - 1];
    d.setup[cohortKey].forEach((name) => {
      const r0 = s0.rows.find((r) => r.name === name), r20 = s20 && s20.rows.find((r) => r.name === name), rL = last.rows.find((r) => r.name === name);
      if (r0) s0Ranks.push(r0.rank); if (r20) s20Ranks.push(r20.rank); if (rL) sLastRanks.push(rL.rank);
    });
  });
  const avg = (a) => round(a.reduce((s, v) => s + v, 0) / (a.length || 1), 1);
  console.log(label + ': ØRang S0=' + avg(s0Ranks) + ' S20=' + avg(s20Ranks) + ' S' + CHECKPOINTS[CHECKPOINTS.length - 1] + '=' + avg(sLastRanks));
});

fs.writeFileSync(path.join(__dirname, '_v11_phase3to32.json'), JSON.stringify({ note: 'siehe Konsolen-Ausgabe fuer vollstaendige Werte' }, null, 2));
console.log('\n[Analyse Phase 3-40 abgeschlossen]');
