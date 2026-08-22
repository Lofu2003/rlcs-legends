// Bot Ecosystem V13, Phase 5-11 -- Monte-Carlo-Formeltest von
// rollPotentialForOverall() (data/org-rosters.js). Reiner Funktionsaufruf,
// KEINE Simulation noetig -- laedt die Funktion direkt aus der Datei.
const fs = require('fs');
const path = require('path');

// rollPotentialForOverall() 1:1 aus data/org-rosters.js kopiert (reine,
// stabile Funktion, keine Browser-/VM-Abhaengigkeit). QA-Telemetrie-Zeilen
// (qaRawPotentialLog) weggelassen, Formel selbst UNVERAENDERT.
function rollPotentialForOverall(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13);
  const headroom = 4 + ageFactor * 26 + (rng() * 2 - 1) * 5;
  const raw = safeOverall + Math.max(minHeadroom || 5, headroom);
  const clamped = Math.max(safeOverall, Math.min(99, Math.round(raw)));
  return { raw, clamped };
}

function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
function percentile(sortedArr, p) { if (!sortedArr.length) return 0; const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length))); return sortedArr[idx]; }

// ============================================================
// PHASE 5 -- Formel-Zerlegung (dokumentiert, siehe Kommentar oben):
// rawPotential = overall + max(minHeadroom, 4 + ageFactor*26 + noise(-5..+5))
// ageFactor = max(0, (27-age)/13) -- linear fallend von ~0.77 (Alter 17) auf 0 (Alter >=27)
// KEINE Sterne (`stars`), KEIN direkter "Potential Gap"-Term als Eingabe --
// stars/Ziel-Overall fliessen NUR indirekt ueber `overall` (den bereits
// gewuerfelten Statachsen-Durchschnitt) ein, nicht als eigener Formel-Parameter.
// ============================================================
console.log('=== PHASE 5: Formel-Parameter ===');
console.log('rawPotential = overall + max(minHeadroom, 4 + ageFactor*26 + noise(-5,+5))');
console.log('ageFactor(age) = max(0, (27-age)/13)');
console.log('minHeadroom: 5 (Spieler-Standardpfad), 9 (Personal), variable Aufrufer-Werte sonst');
console.log('KEINE explizite "stars"- oder "potentialGap"-Eingabe in dieser Funktion -- nur `overall` (bereits von stars abgeleitet) und `age`.');

// ============================================================
// PHASE 6 -- Monte-Carlo-Testmatrix (>=100.000 Samples gesamt).
// ============================================================
console.log('\n=== PHASE 6: Monte-Carlo-Formeltest ===');
const overalls = [40, 50, 60, 70, 80, 85, 90, 95];
const ages = [18, 20, 22, 25, 28, 30];
const SAMPLES_PER_COMBO = 1000; // 8*6*1000 = 48.000 -- plus Phase 7/8 Zusatzlaeufe > 100.000 gesamt
let totalSamples = 0;
const matrixResults = [];
overalls.forEach((ov) => {
  ages.forEach((age) => {
    const raws = [];
    for (let i = 0; i < SAMPLES_PER_COMBO; i++) {
      raws.push(rollPotentialForOverall(ov, age, Math.random, 5).clamped);
      totalSamples++;
    }
    raws.sort((a, b) => a - b);
    const mean = round(raws.reduce((a, b) => a + b, 0) / raws.length, 2);
    const pct99 = round(100 * raws.filter((v) => v === 99).length / raws.length, 1);
    const pct98 = round(100 * raws.filter((v) => v >= 98).length / raws.length, 1);
    const pct95 = round(100 * raws.filter((v) => v >= 95).length / raws.length, 1);
    matrixResults.push({ overall: ov, age, mean, median: percentile(raws, 0.5), p10: percentile(raws, 0.1), p90: percentile(raws, 0.9), p99val: percentile(raws, 0.99), pct95, pct98, pct99 });
  });
});
matrixResults.forEach((r) => console.log('Overall=' + r.overall + ' Alter=' + r.age + ': mean=' + r.mean + ' median=' + r.median + ' p10=' + r.p10 + ' p90=' + r.p90 + ' %95+=' + r.pct95 + '% %98+=' + r.pct98 + '% %99=' + r.pct99 + '%'));

// ============================================================
// PHASE 7 -- 99-Probability-Curve nach Starting Overall (Alter gepoolt 18-30 gleichverteilt).
// ============================================================
console.log('\n=== PHASE 7: Overall -> Potential99-Wahrscheinlichkeit (Alter gepoolt) ===');
[40, 50, 60, 70, 80, 85, 90, 95, 99].forEach((ov) => {
  const raws = [];
  for (let i = 0; i < 5000; i++) {
    const age = 18 + Math.floor(Math.random() * 13); // 18-30 gleichverteilt
    raws.push(rollPotentialForOverall(ov, age, Math.random, 5).clamped);
    totalSamples++;
  }
  const pct99 = round(100 * raws.filter((v) => v === 99).length / raws.length, 1);
  console.log('Overall ' + ov + ' -> Potential99: ' + pct99 + '%');
});

// ============================================================
// PHASE 8 -- Youth Headroom Isolation: identischer Overall=80, nur Alter variiert.
// ============================================================
console.log('\n=== PHASE 8: Youth Headroom (Overall=80 fix, 10.000 Samples je Alter) ===');
[18, 20, 22, 25, 28, 30].forEach((age) => {
  const raws = [];
  const rawUnclamped = [];
  for (let i = 0; i < 10000; i++) {
    const r = rollPotentialForOverall(80, age, Math.random, 5);
    raws.push(r.clamped);
    rawUnclamped.push(r.raw);
    totalSamples++;
  }
  const meanRaw = round(rawUnclamped.reduce((a, b) => a + b, 0) / rawUnclamped.length, 2);
  const pct99 = round(100 * raws.filter((v) => v === 99).length / raws.length, 1);
  console.log('Alter ' + age + ': ØrawPotential(unclamped)=' + meanRaw + ' ØclampedPotential=' + round(raws.reduce((a, b) => a + b, 0) / raws.length, 2) + ' %99=' + pct99 + '%');
});

// ============================================================
// PHASE 9 -- Potential Gap Distribution (Potential - Overall), nach Overall-Gruppe.
// ============================================================
console.log('\n=== PHASE 9: Potential-Gap-Verteilung nach Overall-Gruppe (Alter 18-30 gepoolt, 10.000 je Gruppe) ===');
[[40, 55, '40-54'], [55, 65, '55-64'], [65, 75, '65-74'], [75, 85, '75-84'], [85, 95, '85-94'], [95, 100, '95-99']].forEach(([lo, hi, label]) => {
  const gapBuckets = { g0_2: 0, g3_5: 0, g6_10: 0, g11_15: 0, g16_20: 0, g21_30: 0, g31p: 0 };
  for (let i = 0; i < 10000; i++) {
    const ov = lo + Math.random() * (hi - lo);
    const age = 18 + Math.floor(Math.random() * 13);
    const r = rollPotentialForOverall(ov, age, Math.random, 5);
    const gap = r.clamped - ov;
    if (gap <= 2) gapBuckets.g0_2++; else if (gap <= 5) gapBuckets.g3_5++; else if (gap <= 10) gapBuckets.g6_10++;
    else if (gap <= 15) gapBuckets.g11_15++; else if (gap <= 20) gapBuckets.g16_20++; else if (gap <= 30) gapBuckets.g21_30++; else gapBuckets.g31p++;
    totalSamples++;
  }
  console.log('Overall ' + label + ':', JSON.stringify(gapBuckets));
});

// ============================================================
// PHASE 10 -- High-Overall-Problem: ist Potential99 bei Overall>85 fast unvermeidbar?
// ============================================================
console.log('\n=== PHASE 10: High-Overall-Problem (Overall 85-99, Alter 18-30 gepoolt, 10.000 Samples) ===');
{
  const raws = [];
  for (let i = 0; i < 10000; i++) {
    const ov = 85 + Math.random() * 14;
    const age = 18 + Math.floor(Math.random() * 13);
    raws.push(rollPotentialForOverall(ov, age, Math.random, 5).clamped);
    totalSamples++;
  }
  const pct99 = round(100 * raws.filter((v) => v === 99).length / raws.length, 1);
  console.log('Overall 85-99 (gepoolt): Potential99-Rate = ' + pct99 + '%');
}

console.log('\nGesamt-Samples in diesem Testlauf:', totalSamples, '(Anforderung: >=100.000)');
