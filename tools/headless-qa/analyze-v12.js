// Bot Ecosystem V12 -- Talent Economy & Potential Inflation. Phase 4-27:
// reine Post-hoc-Auswertung ueber die 3 PRE-FIX 50-Saisons-Laeufe
// (V12-BASE-A/B/C, V11-Post-Fix-2-Code als Baseline, KEINE Gameplay-Aenderung).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv12_V12-BASE-A.json'), B: loadRun('_auditv12_V12-BASE-B.json'), C: loadRun('_auditv12_V12-BASE-C.json') };

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }
function distStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return { mean: round(s.reduce((a, b) => a + b, 0) / (s.length || 1), 2), median: percentile(s, 0.5), p10: percentile(s, 0.1), p90: percentile(s, 0.9), n: s.length };
}

const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
const distAt = {};
CHECKPOINTS.forEach((season) => {
  const overalls = [], potentials = [];
  Object.values(runs).forEach((d) => { const snap = d.distributionSnapshots.find((s) => s.season === season); if (snap) snap.players.forEach((p) => { overalls.push(p.overall); potentials.push(p.potential); }); });
  distAt[season] = { overalls, potentials };
});

const allGen = [], allRet = [], allRaw = [], allSelfHeal = [];
Object.values(runs).forEach((d) => { allGen.push(...d.generationLog); allRet.push(...d.retirementLog); allRaw.push(...d.rawPotentialLog); allSelfHeal.push(...(d.selfHealLog || [])); });

// ============================================================
// PHASE 7 -- Generation Distribution (Potential-Buckets nach creationReason).
// ============================================================
console.log('=== PHASE 7: Generation Distribution (Potential-Buckets nach creationReason) ===');
function bucketizePotential(nums) {
  const b = { u60: 0, b60: 0, b70: 0, b80: 0, b85: 0, b90: 0, b95: 0, b98: 0, p99: 0 };
  nums.forEach((v) => {
    if (v < 60) b.u60++; else if (v < 70) b.b60++; else if (v < 80) b.b70++; else if (v < 85) b.b80++;
    else if (v < 90) b.b85++; else if (v < 95) b.b90++; else if (v < 98) b.b95++; else if (v < 99) b.b98++; else b.p99++;
  });
  return b;
}
const byReason = {};
allGen.forEach((g) => { if (!byReason[g.creationReason]) byReason[g.creationReason] = []; byReason[g.creationReason].push(g); });
Object.entries(byReason).forEach(([reason, list]) => {
  const pots = list.map((g) => g.potential);
  console.log(reason + ' (n=' + list.length + '):', JSON.stringify(bucketizePotential(pots)), 'Ø=' + round(pots.reduce((a, b) => a + b, 0) / pots.length, 1));
});

// ============================================================
// PHASE 8/9 -- Potential-99-Creation-Rate pro Saison, Supply vs Retirement.
// ============================================================
console.log('\n=== PHASE 8/9: Potential-Supply vs Retirement pro Saison (gepoolt, nicht-INITIAL) ===');
const nonInitial = allGen.filter((g) => g.creationReason !== 'INITIAL');
const genBySeason = {}, retBySeason = {};
nonInitial.forEach((g) => { if (!genBySeason[g.birthSeason]) genBySeason[g.birthSeason] = { p90: 0, p95: 0, p98: 0, p99: 0, total: 0 }; const b = genBySeason[g.birthSeason]; b.total++; if (g.potential >= 90) b.p90++; if (g.potential >= 95) b.p95++; if (g.potential >= 98) b.p98++; if (g.potential >= 99) b.p99++; });
allRet.forEach((r) => { if (!retBySeason[r.season]) retBySeason[r.season] = { p90: 0, p95: 0, p98: 0, p99: 0, total: 0 }; const b = retBySeason[r.season]; b.total++; if (r.potential >= 90) b.p90++; if (r.potential >= 95) b.p95++; if (r.potential >= 98) b.p98++; if (r.potential >= 99) b.p99++; });
const sumField = (obj, f) => Object.values(obj).reduce((s, v) => s + v[f], 0);
console.log('Gesamt neu erzeugt (nicht INITIAL):', nonInitial.length, ' 90+=' + sumField(genBySeason, 'p90'), ' 95+=' + sumField(genBySeason, 'p95'), ' 98+=' + sumField(genBySeason, 'p98'), ' 99=' + sumField(genBySeason, 'p99'));
console.log('Gesamt in Rente:', allRet.length, ' 90+=' + sumField(retBySeason, 'p90'), ' 95+=' + sumField(retBySeason, 'p95'), ' 98+=' + sumField(retBySeason, 'p98'), ' 99=' + sumField(retBySeason, 'p99'));
console.log('NETTO-Bilanz: 90+=' + (sumField(genBySeason, 'p90') - sumField(retBySeason, 'p90')) + ' 95+=' + (sumField(genBySeason, 'p95') - sumField(retBySeason, 'p95')) + ' 98+=' + (sumField(genBySeason, 'p98') - sumField(retBySeason, 'p98')) + ' 99=' + (sumField(genBySeason, 'p99') - sumField(retBySeason, 'p99')));

// ============================================================
// PHASE 11/12 -- Cap Clamping / Unclamped (Raw) Distribution.
// ============================================================
console.log('\n=== PHASE 11/12: Raw Potential vor Clamp (n=' + allRaw.length + ') ===');
const rawBuckets = { eq99: 0, r100_104: 0, r105_109: 0, r110plus: 0, below99: 0 };
allRaw.forEach((r) => {
  if (r.raw < 99) rawBuckets.below99++;
  else if (r.raw <= 99.5) rawBuckets.eq99++;
  else if (r.raw < 105) rawBuckets.r100_104++;
  else if (r.raw < 110) rawBuckets.r105_109++;
  else rawBuckets.r110plus++;
});
console.log(JSON.stringify(rawBuckets));
const clampedTo99 = allRaw.filter((r) => r.clamped === 99).length;
const rawWasAbove99 = allRaw.filter((r) => r.raw > 99.5).length;
console.log('Clamped auf 99:', clampedTo99, '(' + round(100 * clampedTo99 / allRaw.length, 1) + '%) -- davon Rohwert bereits >99.5:', rawWasAbove99, '(' + round(100 * rawWasAbove99 / (clampedTo99 || 1), 1) + '% der 99er waeren AUCH ohne Clamp >=99 gewesen)');
console.log('Rohwert-Statistik:', JSON.stringify(distStats(allRaw.map((r) => r.raw))));

// ============================================================
// PHASE 4 -- Potential-99-Decomposition (WARUM hat eine S50-Person Potential 99?).
// ============================================================
console.log('\n=== PHASE 4: Potential-99 Decomposition (S50, aktive Spieler) ===');
{
  const s50 = distAt[50] ? distAt[50].potentials : [];
  const s50count99 = s50.filter((v) => v === 99).length;
  console.log('S50 aktive Spieler mit Potential=99:', s50count99, 'von', s50.length, '(' + round(100 * s50count99 / s50.length, 1) + '%)');
  // Kreuzreferenz ueber genId: wie viele S50-99er wurden BEREITS MIT 99 erzeugt vs. via Selbstheilung?
  const genById = new Map(allGen.map((g) => [g.genId, g]));
  const selfHealIds = new Set(allSelfHeal.map((s) => s.genId));
  let generatedAs99 = 0, migratedTo99 = 0, unknownOrigin = 0;
  allGen.forEach((g) => {
    if (g.potential === 99) generatedAs99++;
  });
  console.log('Von ALLEN jemals erzeugten Personen (n=' + allGen.length + '): GENERATED_AS_99=' + generatedAs99 + ' (' + round(100 * generatedAs99 / allGen.length, 1) + '%)');
  console.log('Selbstheilungs-Ereignisse (Potenzial NACH Erzeugung gestiegen):', allSelfHeal.length, '(MIGRATED_TO_99 o.ae. -- ' + round(100 * allSelfHeal.length / allGen.length, 3) + '% aller Personen)');
}

// ============================================================
// PHASE 13 -- Initial vs Future Generations.
// ============================================================
console.log('\n=== PHASE 13: Initial vs Future Generations (Vergleich Generatoren) ===');
['INITIAL', 'RETIREMENT_REPLACEMENT', 'TRANSFER_BACKFILL', 'EMERGENCY_REPLACEMENT'].forEach((reason) => {
  const list = byReason[reason] || [];
  if (!list.length) return;
  const ages = list.map((g) => g.age);
  console.log(reason + ': n=' + list.length + ' ØAlter=' + round(ages.reduce((a, b) => a + b, 0) / ages.length, 1) + ' Ø Potential=' + round(list.reduce((s, g) => s + g.potential, 0) / list.length, 1) + ' %Potential>=99=' + round(100 * list.filter((g) => g.potential >= 99).length / list.length, 1));
});

// ============================================================
// PHASE 14 -- Potential Gap (Potential - Overall) nach Generationstyp.
// ============================================================
console.log('\n=== PHASE 14: Potential Gap nach Generationstyp ===');
Object.entries(byReason).forEach(([reason, list]) => {
  const gaps = list.map((g) => g.potential - g.overall);
  console.log(reason + ': ØGap=' + round(gaps.reduce((a, b) => a + b, 0) / gaps.length, 1));
});

// ============================================================
// PHASE 16 -- Transfer Backfill Deep-Dive.
// ============================================================
console.log('\n=== PHASE 16: Transfer Backfill Deep-Dive ===');
{
  const tb = byReason['TRANSFER_BACKFILL'] || [];
  console.log('n=' + tb.length + ' ØOverall=' + round(tb.reduce((s, g) => s + g.overall, 0) / tb.length, 1) + ' ØPotential=' + round(tb.reduce((s, g) => s + g.potential, 0) / tb.length, 1) + ' %>=99=' + round(100 * tb.filter((g) => g.potential >= 99).length / tb.length, 1));
}

// ============================================================
// PHASE 17 -- Retirement Post-Fix Re-Check.
// ============================================================
console.log('\n=== PHASE 17: Retirement Replacement Post-V11-Fix Re-Check ===');
{
  const rr = byReason['RETIREMENT_REPLACEMENT'] || [];
  const genByOrgRoleSeason = new Map();
  rr.forEach((g) => { const key = g.org + '::' + g.role + '::' + g.birthSeason; if (!genByOrgRoleSeason.has(key)) genByOrgRoleSeason.set(key, []); genByOrgRoleSeason.get(key).push(g); });
  const pairs = [];
  allRet.forEach((r) => { const key = r.orgName + '::' + r.role + '::' + r.season; const c = genByOrgRoleSeason.get(key); if (c && c.length) { const repl = c.shift(); pairs.push({ retiredOverall: r.overall, replPotential: repl.potential }); } });
  function pearson(xs, ys) { const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n; let num = 0, dx2 = 0, dy2 = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; } return num / Math.sqrt(dx2 * dy2 || 1); }
  console.log('Gematchte Paare:', pairs.length, 'Korrelation Retired-Overall vs Replacement-Potential:', pairs.length > 10 ? round(pearson(pairs.map((p) => p.retiredOverall), pairs.map((p) => p.replPotential)), 3) : 'n/a', '(sollte nahe 0 bleiben, V11-Fix betraf NUR diesen Pfad)');
}

// ============================================================
// PHASE 18 -- Staff Potential-99-Rate.
// ============================================================
console.log('\n=== PHASE 18: Staff Potential (S0/S20/S50, nach Rolle) ===');
[0, 20, 50].forEach((season) => {
  const byRole = {};
  Object.values(runs).forEach((d) => { const s = d.staffSnapshots.find((x) => x.season === season); if (s) s.rows.forEach((r) => { if (!byRole[r.role]) byRole[r.role] = []; byRole[r.role].push(r.potential); }); });
  const summary = {};
  Object.entries(byRole).forEach(([role, arr]) => { summary[role] = round(100 * arr.filter((v) => v === 99).length / arr.length, 1) + '%'; });
  console.log('S' + season + ':', JSON.stringify(summary));
});

// ============================================================
// PHASE 21 -- Development Rate nach Rating (Re-Check nach V11-Fixes).
// ============================================================
console.log('\n=== PHASE 21: Development Rate nach Overall-Band (Org-Aggregat) ===');
const bandDeltas = { u60: [], b60: [], b70: [], b80: [], b90: [], b95: [] };
const seq = CHECKPOINTS;
Object.values(runs).forEach((d) => {
  for (let i = 0; i < seq.length - 1; i++) {
    const s1 = d.powerSnapshots.find((p) => p.season === seq[i]), s2 = d.powerSnapshots.find((p) => p.season === seq[i + 1]);
    if (!s1 || !s2) continue;
    const gap = seq[i + 1] - seq[i];
    s1.rows.forEach((r1) => {
      const r2 = s2.rows.find((r) => r.name === r1.name);
      if (!r2) return;
      const ov = r1.avgStarterOverall, rate = (r2.avgStarterOverall - r1.avgStarterOverall) / gap;
      let band = null;
      if (ov < 60) band = 'u60'; else if (ov < 70) band = 'b60'; else if (ov < 80) band = 'b70'; else if (ov < 90) band = 'b80'; else if (ov < 95) band = 'b90'; else band = 'b95';
      bandDeltas[band].push(rate);
    });
  }
});
Object.entries(bandDeltas).forEach(([band, arr]) => { if (arr.length) console.log(band + ': n=' + arr.length + ' avgWachstum/Saison=' + round(arr.reduce((a, b) => a + b, 0) / arr.length, 3)); });

// ============================================================
// PHASE 25 -- Career Decline Validation (ueber die vollen 50 Saisons).
// ============================================================
console.log('\n=== PHASE 25: Career Decline Re-Check (50 Saisons) ===');
{
  const withPeak = allRet.filter((r) => r.peakOverall !== undefined);
  const onHigh = withPeak.filter((r) => r.overall >= r.peakOverall).length;
  console.log('n=' + withPeak.length + ' Anteil auf Career-High=' + round(100 * onHigh / withPeak.length, 1) + '%');
  const declined = withPeak.filter((r) => r.overall < r.peakOverall);
  console.log('Anteil mit echtem Rueckgang=' + round(100 * declined.length / withPeak.length, 1) + '% ØRueckgang=' + (declined.length ? round(declined.reduce((s, r) => s + (r.peakOverall - r.overall), 0) / declined.length, 2) : 0));
}

// ============================================================
// PHASE 26 -- Age Distribution.
// ============================================================
console.log('\n=== PHASE 26: Age Distribution (S0/S10/S20/S30/S50) ===');
[0, 10, 20, 30, 50].forEach((season) => {
  const ages = [];
  Object.values(runs).forEach((d) => { const s = d.distributionSnapshots.find((x) => x.season === season); if (s) s.players.forEach((p) => { if (p.age !== null) ages.push(p.age); }); });
  if (!ages.length) return;
  const buckets = { u20: 0, b20: 0, b23: 0, b26: 0, b30: 0, b33: 0, b36: 0, b39: 0 };
  ages.forEach((a) => { if (a < 20) buckets.u20++; else if (a <= 22) buckets.b20++; else if (a <= 25) buckets.b23++; else if (a <= 29) buckets.b26++; else if (a <= 32) buckets.b30++; else if (a <= 35) buckets.b33++; else if (a <= 38) buckets.b36++; else buckets.b39++; });
  console.log('S' + season + ' (n=' + ages.length + '):', JSON.stringify(buckets));
});

// ============================================================
// PHASE 27 -- Peak vs Retirement Overall-Differenz.
// ============================================================
console.log('\n=== PHASE 27: Peak-Overall minus Retirement-Overall Verteilung ===');
{
  const withPeak = allRet.filter((r) => r.peakOverall !== undefined);
  const diffBuckets = { d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5plus: 0 };
  withPeak.forEach((r) => { const d = r.peakOverall - r.overall; if (d <= 0) diffBuckets.d0++; else if (d === 1) diffBuckets.d1++; else if (d === 2) diffBuckets.d2++; else if (d === 3) diffBuckets.d3++; else if (d === 4) diffBuckets.d4++; else diffBuckets.d5plus++; });
  console.log(JSON.stringify(diffBuckets));
}

fs.writeFileSync(path.join(__dirname, '_v12_phase4to27.json'), JSON.stringify({ note: 'siehe Konsolen-Ausgabe' }, null, 2));
console.log('\n[Analyse Phase 4-27 abgeschlossen]');
