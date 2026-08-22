// Bot Ecosystem V10 -- Relative Power, Competitive Ladder & Economic Scale.
// Phase 4-34, 36: reine Post-hoc-Auswertung ueber die 3 PRE-FIX-Laeufe
// (V10-BASE-A/B/C, V9-Code als Baseline, KEINE Gameplay-Aenderung).
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv10_V10-BASE-A.json'), B: loadRun('_auditv10_V10-BASE-B.json'), C: loadRun('_auditv10_V10-BASE-C.json') };

// calculatePrice() 1:1 aus data/pricing.js kopiert (reine, stabile Funktion,
// keine Browser-/VM-Abhaengigkeit) -- fuer Phase 31-33 (Marktzugang).
function calculatePrice(overall) {
  const raw = 10000 * Math.pow(1.18, overall - 60);
  return Math.round(raw / 1000) * 1000;
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length)));
  return sortedArr[idx];
}
function stats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return {
    p1: percentile(s, 0.01), p5: percentile(s, 0.05), p10: percentile(s, 0.10), p25: percentile(s, 0.25),
    median: percentile(s, 0.50), p75: percentile(s, 0.75), p90: percentile(s, 0.90), p95: percentile(s, 0.95), p99: percentile(s, 0.99),
    max: s.length ? s[s.length - 1] : 0, n: s.length,
  };
}
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

const powerAt = {}; // powerAt[season] = pooled rows across A/B/C
CHECKS: for (const season of [0, 1, 2, 3, 5, 10, 15, 20]) {
  const rows = [];
  Object.values(runs).forEach((d) => {
    const snap = d.powerSnapshots.find((p) => p.season === season);
    if (snap) rows.push(...snap.rows);
  });
  powerAt[season] = rows;
}

// ============================================================
// PHASE 6/10 -- Distribution over Time (Strength/Overall/Potential), gepoolt
// ueber 3 Laeufe. Phase 10 (Generation Inflation) faellt hierunter: waeren
// spaetere Generationen systematisch besser, wuerde sich das direkt als
// Aufwaertstrend der POPULATIONSWEITEN Perzentile zeigen (siehe Methodik-
// Hinweis im Report) -- keine separate Generations-Tag-Instrumentierung noetig.
// ============================================================
console.log('=== PHASE 6/10: Distribution over Time (gepoolt, 3 Laeufe) ===');
const distByCheckpoint = {};
[0, 1, 2, 3, 5, 10, 15, 20].forEach((season) => {
  const rows = powerAt[season];
  distByCheckpoint[season] = {
    strength: stats(rows.map((r) => r.strength)),
    avgStarterOverall: stats(rows.map((r) => r.avgStarterOverall)),
    avgPotential: stats(rows.map((r) => r.avgPotential)),
  };
  console.log('S' + season + ' strength:', JSON.stringify(distByCheckpoint[season].strength));
  console.log('S' + season + ' avgStarterOverall:', JSON.stringify(distByCheckpoint[season].avgStarterOverall));
});

// ============================================================
// PHASE 5/8 -- Global Power Inflation / Compression: Top/Mid/Bottom-Drittel
// (nach S0-Rang) ueber Zeit.
// ============================================================
console.log('\n=== PHASE 5/8: Power Inflation / Compression nach Tier (S0-Rang-basiert) ===');
const tierMaps = {}; // tierMaps[runKey] = Map(orgName -> tier)
Object.entries(runs).forEach(([k, d]) => {
  const s0 = d.powerSnapshots.find((p) => p.season === 0);
  const sorted = [...s0.rows].sort((a, b) => b.strength - a.strength);
  const n = sorted.length;
  const map = new Map();
  sorted.forEach((r, i) => {
    const tier = i < n / 3 ? 'top' : (i < 2 * n / 3 ? 'mid' : 'bottom');
    map.set(r.name, tier);
  });
  tierMaps[k] = map;
});
const tierTrend = { top: {}, mid: {}, bottom: {} };
[0, 1, 2, 3, 5, 10, 15, 20].forEach((season) => {
  const byTier = { top: [], mid: [], bottom: [] };
  Object.entries(runs).forEach(([k, d]) => {
    const snap = d.powerSnapshots.find((p) => p.season === season);
    if (!snap) return;
    snap.rows.forEach((r) => { const t = tierMaps[k].get(r.name); if (t) byTier[t].push(r.avgStarterOverall); });
  });
  ['top', 'mid', 'bottom'].forEach((t) => { tierTrend[t][season] = round(byTier[t].reduce((a, b) => a + b, 0) / (byTier[t].length || 1), 1); });
});
console.log('Top-Drittel avgStarterOverall je Saison:', JSON.stringify(tierTrend.top));
console.log('Mid-Drittel avgStarterOverall je Saison:', JSON.stringify(tierTrend.mid));
console.log('Bottom-Drittel avgStarterOverall je Saison:', JSON.stringify(tierTrend.bottom));
console.log('Kompressions-Check: Differenz Top-Bottom S0 vs S20:', round(tierTrend.top[0] - tierTrend.bottom[0], 1), 'vs', round(tierTrend.top[20] - tierTrend.bottom[20], 1));

// ============================================================
// PHASE 7/53 -- Stat Cap Saturation (Overall 90+/95+/98+/99), nach Tier.
// ============================================================
console.log('\n=== PHASE 7/53: Stat Cap Saturation (Overall), gepoolt nach Tier ===');
[0, 5, 10, 15, 20].forEach((season) => {
  const byTier = { top: { n: 0, p90: 0, p95: 0, p98: 0, p99: 0 }, mid: { n: 0, p90: 0, p95: 0, p98: 0, p99: 0 }, bottom: { n: 0, p90: 0, p95: 0, p98: 0, p99: 0 } };
  Object.entries(runs).forEach(([k, d]) => {
    const snap = d.powerSnapshots.find((p) => p.season === season);
    if (!snap) return;
    snap.rows.forEach((r) => {
      const t = tierMaps[k].get(r.name); if (!t) return;
      byTier[t].n += r.activePlayerCount;
      byTier[t].p90 += r.statCap.p90; byTier[t].p95 += r.statCap.p95; byTier[t].p98 += r.statCap.p98; byTier[t].p99 += r.statCap.p99;
    });
  });
  const pct = (t) => ({ n: byTier[t].n, pct90: round(100 * byTier[t].p90 / byTier[t].n, 1), pct95: round(100 * byTier[t].p95 / byTier[t].n, 1), pct98: round(100 * byTier[t].p98 / byTier[t].n, 1), pct99: round(100 * byTier[t].p99 / byTier[t].n, 1) });
  console.log('S' + season + ' top:', JSON.stringify(pct('top')), 'mid:', JSON.stringify(pct('mid')), 'bottom:', JSON.stringify(pct('bottom')));
});

// ============================================================
// PHASE 9 -- Potential Saturation (90+/95+/99), Vollpopulation.
// ============================================================
console.log('\n=== PHASE 9: Potential Saturation, Vollpopulation ===');
[0, 5, 10, 15, 20].forEach((season) => {
  const rows = powerAt[season];
  let n = 0, p90 = 0, p95 = 0, p99 = 0;
  rows.forEach((r) => { n += r.activePlayerCount; p90 += r.potentialCap.p90; p95 += r.potentialCap.p95; p99 += r.potentialCap.p99; });
  console.log('S' + season + ':', JSON.stringify({ n, pct90: round(100 * p90 / n, 1), pct95: round(100 * p95 / n, 1), pct99: round(100 * p99 / n, 1) }));
});

// ============================================================
// PHASE 4 -- Case Studies: Bottom10-Orgs mit grossem Overall-Wachstum aber
// kleinem Rang-Fortschritt (S0 vs S20). "Wo verschwindet der Fortschritt?"
// ============================================================
console.log('\n=== PHASE 4: Case Studies (Bottom10, grosses Overall-Wachstum, S0 vs S20) ===');
const cases = [];
Object.entries(runs).forEach(([k, d]) => {
  const s0 = d.powerSnapshots.find((p) => p.season === 0);
  const s20 = d.powerSnapshots.find((p) => p.season === 20);
  d.setup.bottom10.forEach((name) => {
    const r0 = s0.rows.find((r) => r.name === name);
    const r20 = s20 && s20.rows.find((r) => r.name === name);
    if (!r0 || !r20) return;
    cases.push({
      run: k, org: name,
      overallGrowth: round(r20.avgStarterOverall - r0.avgStarterOverall, 1),
      rankGain: r0.rank - r20.rank, // positiv = besser geworden
      rank0: r0.rank, rank20: r20.rank,
      strength0: r0.strength, strength20: r20.strength,
      teamBonus0: round(r0.teamBonusPct, 1), teamBonus20: round(r20.teamBonusPct, 1),
      budget0: r0.budget, budget20: r20.budget,
      coach0: r0.coachOverall, coach20: r20.coachOverall,
    });
  });
});
cases.sort((a, b) => b.overallGrowth - a.overallGrowth);
console.log('Top 10 nach Overall-Wachstum:');
cases.slice(0, 10).forEach((c) => console.log(' ', JSON.stringify(c)));
const avgGrowth = round(cases.reduce((s, c) => s + c.overallGrowth, 0) / cases.length, 1);
const avgRankGain = round(cases.reduce((s, c) => s + c.rankGain, 0) / cases.length, 1);
console.log('Bottom10-Kohorte (30 Faelle) Durchschnitt: Overall-Wachstum=' + avgGrowth + ' Rang-Gewinn=' + avgRankGain);

// ============================================================
// PHASE 34 -- Warum ist Overall 80 immer noch Rang ~400? Durchschnittliches
// avgStarterOverall je Rang-Eimer bei S20, Vollpopulation.
// ============================================================
console.log('\n=== PHASE 34: Overall nach Rang-Eimer (S20, Vollpopulation) ===');
function rankBucketAvg(rows, loRank, hiRank) {
  const sel = rows.filter((r) => r.rank >= loRank && r.rank <= hiRank);
  return { n: sel.length, avgOverall: round(sel.reduce((s, r) => s + r.avgStarterOverall, 0) / (sel.length || 1), 1), avgStrength: round(sel.reduce((s, r) => s + r.strength, 0) / (sel.length || 1), 1) };
}
const s20rows = powerAt[20];
[[391, 410, 'Rang ~400'], [291, 310, 'Rang ~300'], [191, 210, 'Rang ~200'], [91, 110, 'Rang ~100'], [41, 60, 'Rang ~50'], [1, 10, 'Rang 1-10'], [1, 1, 'Rang 1']].forEach(([lo, hi, label]) => {
  console.log(label + ':', JSON.stringify(rankBucketAvg(s20rows, lo, hi)));
});

// ============================================================
// PHASE 11 -- Development Speed: Wachstumsrate von avgStarterOverall JE
// AKTUELLEM NIVEAU-BAND (Org-Aggregat-Naeherung, siehe Methodik-Hinweis
// Report -- keine Einzelspieler-Longitudinal-Daten in dieser Instrumentierung
// erfasst). Bucket = Overall-Band am INTERVALL-START, gemessen ueber alle
// 8 Checkpoint-Intervalle x 454 Orgs x 3 Laeufe.
// ============================================================
console.log('\n=== PHASE 11: Development Speed nach Overall-Band (Org-Aggregat-Naeherung) ===');
const bandDeltas = { '50-60': [], '60-70': [], '70-80': [], '80-90': [], '90-99': [] };
const seq = [0, 1, 2, 3, 5, 10, 15, 20];
Object.values(runs).forEach((d) => {
  for (let i = 0; i < seq.length - 1; i++) {
    const s1 = d.powerSnapshots.find((p) => p.season === seq[i]);
    const s2 = d.powerSnapshots.find((p) => p.season === seq[i + 1]);
    if (!s1 || !s2) continue;
    const seasonsGap = seq[i + 1] - seq[i];
    s1.rows.forEach((r1) => {
      const r2 = s2.rows.find((r) => r.name === r1.name);
      if (!r2) return;
      const ov = r1.avgStarterOverall;
      const ratePerSeason = (r2.avgStarterOverall - r1.avgStarterOverall) / seasonsGap;
      let band = null;
      if (ov >= 50 && ov < 60) band = '50-60'; else if (ov >= 60 && ov < 70) band = '60-70'; else if (ov >= 70 && ov < 80) band = '70-80'; else if (ov >= 80 && ov < 90) band = '80-90'; else if (ov >= 90 && ov <= 99) band = '90-99';
      if (band) bandDeltas[band].push(ratePerSeason);
    });
  }
});
Object.keys(bandDeltas).forEach((band) => {
  const arr = bandDeltas[band];
  console.log(band + ': n=' + arr.length + ' avgWachstum/Saison=' + round(arr.reduce((a, b) => a + b, 0) / (arr.length || 1), 3));
});

// ============================================================
// PHASE 12 -- League-Wide Development: Overall-Punkte-Gewinn/Saison (Mean/
// Median/P90), Vollpopulation.
// ============================================================
console.log('\n=== PHASE 12: League-Wide Development pro Saison (Vollpopulation) ===');
for (let i = 0; i < seq.length - 1; i++) {
  const deltas = [];
  Object.values(runs).forEach((d) => {
    const s1 = d.powerSnapshots.find((p) => p.season === seq[i]);
    const s2 = d.powerSnapshots.find((p) => p.season === seq[i + 1]);
    if (!s1 || !s2) return;
    const gap = seq[i + 1] - seq[i];
    s1.rows.forEach((r1) => {
      const r2 = s2.rows.find((r) => r.name === r1.name);
      if (r2) deltas.push((r2.avgStarterOverall - r1.avgStarterOverall) / gap);
    });
  });
  deltas.sort((a, b) => a - b);
  console.log('S' + seq[i] + '->S' + seq[i + 1] + ': mean=' + round(deltas.reduce((a, b) => a + b, 0) / deltas.length, 2) + ' median=' + round(percentile(deltas, 0.5), 2) + ' p90=' + round(percentile(deltas, 0.9), 2));
}

// ============================================================
// PHASE 14/48 -- Strength Percentile Mobility (Bottom10-Kohorte).
// ============================================================
console.log('\n=== PHASE 14/48: Strength Percentile Mobility (Bottom10, 30 Faelle) ===');
function percentileRank(rows, name) {
  const sorted = [...rows].sort((a, b) => a.strength - b.strength);
  const idx = sorted.findIndex((r) => r.name === name);
  return idx === -1 ? null : round(100 * idx / (sorted.length - 1), 1);
}
const percMobility = [];
Object.entries(runs).forEach(([k, d]) => {
  d.setup.bottom10.forEach((name) => {
    const row = { run: k, org: name };
    [0, 5, 10, 15, 20].forEach((season) => {
      const snap = d.powerSnapshots.find((p) => p.season === season);
      row['pctile_S' + season] = snap ? percentileRank(snap.rows, name) : null;
    });
    percMobility.push(row);
  });
});
const avgPctile = {};
[0, 5, 10, 15, 20].forEach((season) => { avgPctile[season] = round(percMobility.reduce((s, r) => s + (r['pctile_S' + season] || 0), 0) / percMobility.length, 1); });
console.log('Bottom10 Ø Strength-Perzentil je Saison:', JSON.stringify(avgPctile));
console.log('(0 = schwaechste Org der Liga, 100 = staerkste)');

// ============================================================
// PHASE 20/21 -- Match Volume & Reward per Match, nach Tier.
// ============================================================
console.log('\n=== PHASE 20/21: Match Volume & Reward per Match, nach Tier ===');
const volByTier = { top: { series: 0, prize: 0, orgs: 0 }, mid: { series: 0, prize: 0, orgs: 0 }, bottom: { series: 0, prize: 0, orgs: 0 } };
Object.entries(runs).forEach(([k, d]) => {
  const cohortByTier = { top: d.setup.top10, mid: d.setup.mid10, bottom: d.setup.bottom10 };
  Object.entries(cohortByTier).forEach(([tier, names]) => {
    names.forEach((name) => {
      let seriesSum = 0, prizeSum = 0;
      d.seasonLite.slice(1).forEach((lite) => {
        const row = lite.rows[name];
        if (!row) return;
        seriesSum += row.seriesThisSeason || 0;
        prizeSum += (row.incomeThisSeason && row.incomeThisSeason.tournament_prize) || 0;
      });
      volByTier[tier].series += seriesSum; volByTier[tier].prize += prizeSum; volByTier[tier].orgs++;
    });
  });
});
['top', 'mid', 'bottom'].forEach((t) => {
  const v = volByTier[t];
  console.log(t + ': ØSerien/Saison=' + round(v.series / v.orgs / TARGET_SEASONS_SAFE(runs), 1) + ' ØPreisgeld gesamt=' + round(v.prize / v.orgs, 0) + ' ØPreisgeld/Serie=' + round(v.prize / (v.series || 1), 0));
});
function TARGET_SEASONS_SAFE(rr) { return Object.values(rr)[0].targetSeasons; }

// ============================================================
// PHASE 23/24 -- Economic Scale & Money Source Share (kumulativ S0-S20), nach
// Tier (Bottom10/Mid10/Top10-Kohorte).
// ============================================================
console.log('\n=== PHASE 23/24: Economic Scale & Money Source Share (kumulativ, Kohorten) ===');
const incomeByTier = { top: {}, mid: {}, bottom: {} };
Object.entries(runs).forEach(([k, d]) => {
  const cohortByTier = { top: d.setup.top10, mid: d.setup.mid10, bottom: d.setup.bottom10 };
  const s20 = d.powerSnapshots.find((p) => p.season === 20);
  Object.entries(cohortByTier).forEach(([tier, names]) => {
    names.forEach((name) => {
      const row = s20 && s20.rows.find((r) => r.name === name);
      if (!row) return;
      Object.entries(row.income).forEach(([cat, amt]) => {
        incomeByTier[tier][cat] = (incomeByTier[tier][cat] || 0) + amt;
      });
      incomeByTier[tier]._orgCount = (incomeByTier[tier]._orgCount || 0) + 1;
    });
  });
});
['top', 'mid', 'bottom'].forEach((t) => {
  const cats = { ...incomeByTier[t] };
  const orgCount = cats._orgCount; delete cats._orgCount;
  const totalPositive = Object.values(cats).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const shares = {};
  Object.entries(cats).forEach(([cat, amt]) => { if (amt > 0) shares[cat] = round(100 * amt / totalPositive, 1); });
  console.log(t + ' (n=' + orgCount + ' Org-Faelle) kumulative Kategorien (Ø je Org):');
  Object.entries(cats).forEach(([cat, amt]) => console.log('  ' + cat + ': Ø' + round(amt / orgCount, 0) + ' (Anteil an Bruttoeinnahmen: ' + (shares[cat] !== undefined ? shares[cat] + '%' : '-') + ')'));
});

// ============================================================
// PHASE 25/26 -- Compounding Coefficient (Strength -> Folgeeinkommen) und
// Wealth -> Strength (Budget -> Folge-Strength), datenbasiert ueber
// Dezil-Buckets der Vollpopulation, S0->S5.
// ============================================================
console.log('\n=== PHASE 25: Compounding Coefficient (Strength(S0) -> kumulatives Einkommen S0-S5) ===');
// Bug-Fix (nach Sichtung des Erstlaufs): seasonLite enthaelt NUR die 30
// Kohorten-Orgs (bottom10/mid10/top10) -- fuer die uebrigen 424 Orgs blieb
// `row` undefined, Dezile mit ueberwiegend Nicht-Kohorten-Orgs zeigten
// faelschlich 0 Einkommen. Fix: nutzt stattdessen die kumulativen
// `income`-Kategorien direkt aus den Power-Snapshots (ALLE 454 Orgs,
// S0 und S5 vorhanden) -- Differenz S5-S0 der positiven Kategorien.
{
  const rows = [];
  Object.entries(runs).forEach(([k, d]) => {
    const s0 = d.powerSnapshots.find((p) => p.season === 0);
    const s5 = d.powerSnapshots.find((p) => p.season === 5);
    s0.rows.forEach((r0) => {
      const r5 = s5.rows.find((r) => r.name === r0.name);
      if (!r5) return;
      let incomeSum = 0;
      Object.keys(r5.income || {}).forEach((cat) => {
        const delta = (r5.income[cat] || 0) - (r0.income[cat] || 0);
        if (delta > 0) incomeSum += delta;
      });
      rows.push({ strength0: r0.strength, incomeS0toS5: incomeSum });
    });
  });
  rows.sort((a, b) => a.strength0 - b.strength0);
  const n = rows.length, decileSize = Math.floor(n / 10);
  for (let dcl = 0; dcl < 10; dcl++) {
    const slice = rows.slice(dcl * decileSize, dcl === 9 ? n : (dcl + 1) * decileSize);
    const avgStrength = round(slice.reduce((s, r) => s + r.strength0, 0) / slice.length, 1);
    const avgIncome = round(slice.reduce((s, r) => s + r.incomeS0toS5, 0) / slice.length, 0);
    console.log('Strength-Dezil ' + (dcl + 1) + ' (ØStrength=' + avgStrength + '): ØEinkommen S0-S5=' + avgIncome);
  }
}
console.log('\n=== PHASE 26: Wealth -> Strength (Budget(S0)-Dezil -> Strength-Zuwachs S0->S5) ===');
{
  const rows = [];
  Object.entries(runs).forEach(([k, d]) => {
    const s0 = d.powerSnapshots.find((p) => p.season === 0);
    const s5 = d.powerSnapshots.find((p) => p.season === 5);
    s0.rows.forEach((r0) => {
      const r5 = s5.rows.find((r) => r.name === r0.name);
      if (r5) rows.push({ budget0: r0.budget, strengthGain: r5.strength - r0.strength });
    });
  });
  rows.sort((a, b) => a.budget0 - b.budget0);
  const n = rows.length, decileSize = Math.floor(n / 10);
  for (let dcl = 0; dcl < 10; dcl++) {
    const slice = rows.slice(dcl * decileSize, dcl === 9 ? n : (dcl + 1) * decileSize);
    const avgBudget = round(slice.reduce((s, r) => s + r.budget0, 0) / slice.length, 0);
    const avgGain = round(slice.reduce((s, r) => s + r.strengthGain, 0) / slice.length, 2);
    console.log('Budget-Dezil ' + (dcl + 1) + ' (ØBudget=' + avgBudget + '): ØStrength-Zuwachs S0->S5=' + avgGain);
  }
}

// ============================================================
// PHASE 31/32/33 -- Market Access / Meaningful Upgrade Access / Diminishing
// Returns: kann eine Org sich einen +1/+3/+5/+10-Overall-Upgrade (ggue.
// eigenem ØStarter-Overall) ueberhaupt leisten (investBudget vs.
// calculatePrice(avgOverall+N))?
// ============================================================
console.log('\n=== PHASE 31/32/33: Meaningful Upgrade Access nach Tier (S0/S10/S20) ===');
[0, 10, 20].forEach((season) => {
  const byTier = { top: { n: 0, aff1: 0, aff3: 0, aff5: 0, aff10: 0 }, mid: { n: 0, aff1: 0, aff3: 0, aff5: 0, aff10: 0 }, bottom: { n: 0, aff1: 0, aff3: 0, aff5: 0, aff10: 0 } };
  Object.entries(runs).forEach(([k, d]) => {
    const snap = d.powerSnapshots.find((p) => p.season === season);
    if (!snap) return;
    snap.rows.forEach((r) => {
      const t = tierMaps[k].get(r.name); if (!t) return;
      byTier[t].n++;
      [1, 3, 5, 10].forEach((up) => {
        const cost = calculatePrice(Math.min(99, Math.round(r.avgStarterOverall) + up));
        if (r.investBudget >= cost) byTier[t]['aff' + up]++;
      });
    });
  });
  ['top', 'mid', 'bottom'].forEach((t) => {
    const v = byTier[t];
    console.log('S' + season + ' ' + t + ': +1=' + round(100 * v.aff1 / v.n, 1) + '% +3=' + round(100 * v.aff3 / v.n, 1) + '% +5=' + round(100 * v.aff5 / v.n, 1) + '% +10=' + round(100 * v.aff10 / v.n, 1) + '%');
  });
});

// ============================================================
// ZUSATZ-BEFUND (aus Phase-34-Daten abgeleitet): avgStarterOverall
// differenziert Rang~300 und Rang~1 kaum noch (94 vs 98.7), avgStrength aber
// stark (77.9 vs 100) -- da org.strength ALLE Personen (Starter+Sub+Coach+
// Personal) mittelt, koennte der Rest-Unterschied vom Coach/Personal
// stammen, NICHT mehr vom Spieler-Overall. Direkt nachpruefen.
// ============================================================
console.log('\n=== ZUSATZ: Coach-Overall nach Rang-Eimer (S20) -- prueft "Coach/Personal-Luecke"-Hypothese ===');
function rankBucketCoach(rows, loRank, hiRank) {
  const sel = rows.filter((r) => r.rank >= loRank && r.rank <= hiRank && typeof r.coachOverall === 'number');
  return { n: sel.length, avgCoachOverall: round(sel.reduce((s, r) => s + r.coachOverall, 0) / (sel.length || 1), 1), pctHasCoach: round(100 * sel.length / rows.filter((r) => r.rank >= loRank && r.rank <= hiRank).length, 1) };
}
[[391, 410, 'Rang ~400'], [291, 310, 'Rang ~300'], [191, 210, 'Rang ~200'], [91, 110, 'Rang ~100'], [41, 60, 'Rang ~50'], [1, 10, 'Rang 1-10']].forEach(([lo, hi, label]) => {
  console.log(label + ':', JSON.stringify(rankBucketCoach(s20rows, lo, hi)));
});
console.log('(vgl. Phase 34: avgOverall/avgStrength je Rang-Eimer)');

fs.writeFileSync(path.join(__dirname, '_v10_phase4to33.json'), JSON.stringify({ distByCheckpoint, tierTrend, cases: cases.slice(0, 15), avgGrowth, avgRankGain, percMobility: percMobility.slice(0, 6), avgPctile }, null, 2));
console.log('\n[Zwischenstand gespeichert: _v10_phase4to33.json]');
