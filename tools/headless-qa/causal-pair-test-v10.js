// Bot Ecosystem V10, Phase 27 -- Causal Pair Test: mindestens 30 Paare mit
// nahezu identischer Ausgangs-Staerke (benachbart in der Staerke-Sortierung,
// gleiches Muster wie matched-pair-test.js aus V8), aber ein Org des Paares
// (TEST) bekommt einen einmaligen, grossen Budget-Schub (+2 Mio EUR) OHNE
// jede weitere Manipulation (kein Kader-Edit, kein Strength-Direktschreiben)
// -- der Rest des Systems (Bot-Kaufentscheidungen etc.) reagiert von allein.
// Frage: wie stark uebersetzt sich Kapital ALLEIN in sportliche Staerke, bei
// sonst gleichem Ausgangspunkt? Nutzung: node causal-pair-test-v10.js <seed> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V10-PAIR-A';
const OUT_FILE = process.argv[3] || path.join(__dirname, '_causalpair_' + SEED + '.json');
const PAIR_COUNT = 30;
const BUDGET_BOOST = 2000000;
const RUN_SEASONS = 5;

function setupPairsFn(pairCount, boost) {
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const step = Math.max(1, Math.floor(sorted.length / (pairCount * 2)));
  const pairs = [];
  for (let i = 0; i < pairCount; i++) {
    const idxA = i * step * 2;
    const idxB = idxA + 1;
    if (idxB >= sorted.length) break;
    const a = sorted[idxA], b = sorted[idxB];
    pairs.push({
      testOrg: a.name, controlOrg: b.name,
      startStrengthTest: a.strength, startStrengthControl: b.strength,
      startBudgetTest: Math.round(a.budget), startBudgetControl: Math.round(b.budget),
    });
  }
  pairs.forEach((p) => { findOrgByName(p.testOrg).budget += boost; });
  return pairs;
}

function snapshotPairsFn(pairs, label) {
  return pairs.map((p) => {
    const t = findOrgByName(p.testOrg), c = findOrgByName(p.controlOrg);
    const snap = (o) => ({ strength: o.strength, budget: Math.round(o.budget), financeStatus: o.financeStatus });
    return { testOrg: p.testOrg, controlOrg: p.controlOrg, label, test: snap(t), control: snap(c) };
  });
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();

  for (let s = 0; s < 2; s++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }

  const pairs = game.run(setupPairsFn, PAIR_COUNT, BUDGET_BOOST);
  console.log('[' + SEED + '] Paare:', pairs.length, 'Budget-Boost TEST:', BUDGET_BOOST);

  const out = { seed: SEED, pairCount: pairs.length, budgetBoost: BUDGET_BOOST, pairs, snapshots: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const s0 = game.run(snapshotPairsFn, pairs, 'S0_afterBoost');
  out.snapshots.push(s0);
  flush();

  for (let season = 1; season <= RUN_SEASONS; season++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const snap = game.run(snapshotPairsFn, pairs, 'S' + season);
    out.snapshots.push(snap);
    console.log('[' + SEED + '] Season', season, 'done.');
    flush();
  }

  const last = out.snapshots[out.snapshots.length - 1];
  const first = out.snapshots[0];
  const summary = last.map((r, i) => {
    const f = first[i];
    return {
      testOrg: r.testOrg, controlOrg: r.controlOrg,
      testStrengthDelta: r.test.strength - f.test.strength, controlStrengthDelta: r.control.strength - f.control.strength,
    };
  });
  out.summary = summary;
  out.summaryAggregate = {
    avgTestStrengthDelta: Math.round(summary.reduce((s, r) => s + r.testStrengthDelta, 0) / summary.length * 100) / 100,
    avgControlStrengthDelta: Math.round(summary.reduce((s, r) => s + r.controlStrengthDelta, 0) / summary.length * 100) / 100,
    testOutperformedControlCount: summary.filter((r) => r.testStrengthDelta > r.controlStrengthDelta).length,
    avgStrengthDeltaDifference: Math.round((summary.reduce((s, r) => s + (r.testStrengthDelta - r.controlStrengthDelta), 0) / summary.length) * 100) / 100,
  };

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] CAUSAL PAIR TEST DONE in', out.durationMs, 'ms. Summary:', JSON.stringify(out.summaryAggregate));
})().catch((err) => { console.error('[' + SEED + '] CAUSAL PAIR TEST FAILED:', err); process.exit(1); });
