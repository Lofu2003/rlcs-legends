// Bot Ecosystem V13, Phase 20-22 -- Fix-Prototyp + Vorher/Nachher-Vergleich,
// rein am isolierten Generator (kein renderer.js-Edit noetig fuer diesen Test).
function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

function rollPotentialForOverall_OLD(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13);
  const headroom = 4 + ageFactor * 26 + (rng() * 2 - 1) * 5;
  return Math.max(safeOverall, Math.min(99, Math.round(safeOverall + Math.max(minHeadroom || 5, headroom))));
}

// V13-Fix-Prototyp: headroom skaliert zusaetzlich mit dem tatsaechlich noch
// verbleibenden Raum bis zum Deckel (roomLeft/30, gedeckelt bei 1) -- bei
// niedrigem/mittlerem Overall (roomLeft>=30, d.h. Overall<=69) UNVERAENDERT
// (proximityFactor=1), erst darueber zunehmend gedaempft. EIN einzelner
// multiplikativer Term, kein neues Konzept.
function rollPotentialForOverall_NEW(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13);
  const wantedHeadroom = Math.max(minHeadroom || 5, 4 + ageFactor * 26 + (rng() * 2 - 1) * 5);
  const roomLeft = Math.max(0, 99 - safeOverall);
  const proximityFactor = Math.min(1, roomLeft / 30);
  const headroom = wantedHeadroom * proximityFactor;
  return Math.max(safeOverall, Math.min(99, Math.round(safeOverall + headroom)));
}

function testFn(fn, label) {
  console.log('\n--- ' + label + ' ---');
  console.log('Overall -> Potential99-Wahrscheinlichkeit (Alter 18-30 gepoolt, 5000 Samples):');
  [40, 50, 60, 70, 80, 85, 90, 95, 99].forEach((ov) => {
    const raws = [];
    for (let i = 0; i < 5000; i++) {
      const age = 18 + Math.floor(Math.random() * 13);
      raws.push(fn(ov, age, Math.random, 5));
    }
    const pct99 = round(100 * raws.filter((v) => v === 99).length / raws.length, 1);
    const mean = round(raws.reduce((a, b) => a + b, 0) / raws.length, 1);
    console.log('  Overall ' + ov + ' -> Potential99: ' + pct99 + '% (Ø Potential=' + mean + ')');
  });
  console.log('Overall 85-99 gepoolt (10.000 Samples):');
  {
    const raws = [];
    for (let i = 0; i < 10000; i++) {
      const ov = 85 + Math.random() * 14;
      const age = 18 + Math.floor(Math.random() * 13);
      raws.push(fn(ov, age, Math.random, 5));
    }
    console.log('  Potential99-Rate = ' + round(100 * raws.filter((v) => v === 99).length / raws.length, 1) + '%');
  }
  console.log('Niedriger/mittlerer Overall UNVERAENDERT? (Overall 40-60, 5000 Samples je Wert):');
  [40, 50, 60].forEach((ov) => {
    const raws = [];
    for (let i = 0; i < 5000; i++) {
      const age = 18 + Math.floor(Math.random() * 13);
      raws.push(fn(ov, age, Math.random, 5));
    }
    console.log('  Overall ' + ov + ': Ø Potential=' + round(raws.reduce((a, b) => a + b, 0) / raws.length, 2));
  });
}

// V13-Fix-Retune (Erstversion NEW oben ergab bei realer Simulation 0.0%
// Potential99 bei S50 -- Ueberkorrektur, verletzt Phase 28 "99 muss moeglich
// bleiben"). Wurzel-gedaempfte Variante: haelt roomLeft/30 als Basis, zieht
// aber die Quadratwurzel, was den Faktor bei mittlerem roomLeft (Overall
// 85-95) deutlich anhebt, bei roomLeft>=30 (Overall<=69) weiterhin exakt 1
// bleibt (sqrt(1)=1) und erst bei roomLeft=0 (Overall=99, trivial) auf 0 faellt.
function rollPotentialForOverall_NEW2(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13);
  const wantedHeadroom = Math.max(minHeadroom || 5, 4 + ageFactor * 26 + (rng() * 2 - 1) * 5);
  const roomLeft = Math.max(0, 99 - safeOverall);
  const proximityFactor = Math.sqrt(Math.min(1, roomLeft / 30));
  const headroom = wantedHeadroom * proximityFactor;
  return Math.max(safeOverall, Math.min(99, Math.round(safeOverall + headroom)));
}

function rollPotentialForOverall_NEW3(overall, age, rng, minHeadroom) {
  const safeAge = (typeof age === 'number' && !Number.isNaN(age)) ? age : 26;
  const safeOverall = (typeof overall === 'number' && !Number.isNaN(overall)) ? overall : 45;
  const ageFactor = Math.max(0, (27 - safeAge) / 13);
  const wantedHeadroom = Math.max(minHeadroom || 5, 4 + ageFactor * 26 + (rng() * 2 - 1) * 5);
  const roomLeft = Math.max(0, 99 - safeOverall);
  const proximityFactor = Math.pow(Math.min(1, roomLeft / 30), 0.65);
  const headroom = wantedHeadroom * proximityFactor;
  return Math.max(safeOverall, Math.min(99, Math.round(safeOverall + headroom)));
}

testFn(rollPotentialForOverall_OLD, 'ALT (V12)');
testFn(rollPotentialForOverall_NEW, 'NEU (V13-Fix-Prototyp v1, zu aggressiv)');
testFn(rollPotentialForOverall_NEW2, 'NEU (V13-Fix-Retune v2, sqrt-gedaempft, zu weich)');
testFn(rollPotentialForOverall_NEW3, 'NEU (V13-Fix-Retune v3, exponent 0.65)');
