// Bot Ecosystem V8 -- Pflicht-Test "20 gematchte Org-Paare, kontrollierte
// Insolvenz" (Anti-Exploit-Recovery-Test, in V7 optional/uebersprungen, in
// V8 laut Auftrag PFLICHT). Ziel: bestaetigen, dass eine erzwungene
// Insolvenz (a) ECHTE, nicht-triviale Konsequenzen hat (kein Exploit, bei
// dem sich absichtliche Pleite lohnt/keinen Nachteil bringt) UND (b) keine
// dauerhaft unausweichliche Todesspirale ist (der Kader kann sich ueber
// mehrere Saisons hinweg wieder berappeln, OHNE kuenstliche Catch-Up-Boni --
// rein durch die normalen Bot-Entscheidungsmechanismen).
// Nutzung: node matched-pair-test.js <seed> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'PAIRTEST-A';
const OUT_FILE = process.argv[3] || path.join(__dirname, '_pairtest_' + SEED + '.json');
const PAIR_COUNT = 20;
const RECOVERY_SEASONS = 6;
const FORCED_NEGATIVE_BUDGET = -150000;

function setupPairsFn(pairCount, forcedBudget) {
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  // Gleichmaessig ueber das gesamte Staerke-Spektrum verteilte, benachbarte
  // (= aehnlichste verfuegbare) Paare -- nicht nur eine Tier-Nische, damit
  // der Test etwas ueber Bottom UND Mid UND Top aussagt.
  const step = Math.floor(sorted.length / (pairCount * 2));
  const pairs = [];
  for (let i = 0; i < pairCount; i++) {
    const idxA = i * step * 2;
    const idxB = idxA + 1;
    if (idxB >= sorted.length) break;
    const a = sorted[idxA];
    const b = sorted[idxB];
    pairs.push({
      testOrg: a.name, controlOrg: b.name,
      startStrengthTest: a.strength, startStrengthControl: b.strength,
      startBudgetTest: Math.round(a.budget), startBudgetControl: Math.round(b.budget),
    });
  }
  // Intervention: TEST-Org wird kontrolliert insolvent gemacht (Budget stark
  // negativ) -- KEINE weitere Manipulation (kein Kader-Downgrade, kein
  // financeStatus-Direktschreiben), der Rest des Systems reagiert von allein
  // (naechster botFinanceStatus()-Aufruf im Tages-Loop liest das negative
  // Budget und stuft die Org korrekt als INSOLVENT ein).
  pairs.forEach((p) => {
    const org = findOrgByName(p.testOrg);
    org.budget = forcedBudget;
  });
  return pairs;
}

function snapshotPairsFn(pairs, seasonLabel) {
  return pairs.map((p) => {
    const t = findOrgByName(p.testOrg);
    const c = findOrgByName(p.controlOrg);
    const snap = (o) => ({
      strength: o.strength, budget: Math.round(o.budget), financeStatus: o.financeStatus,
      rosterValue: typeof orgRosterMarketValue === 'function' ? Math.round(orgRosterMarketValue(o.roster)) : null,
    });
    return { testOrg: p.testOrg, controlOrg: p.controlOrg, label: seasonLabel, test: snap(t), control: snap(c) };
  });
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();

  // Erst 2 Saisons organisch laufen lassen, damit Staerke/Budget bereits
  // natuerliche Streuung haben (kein reiner S0-Weltgen-Zustand) -- danach
  // Paare bilden und die kontrollierte Insolvenz auslösen.
  console.log('[' + SEED + '] Baue 2-Saison-Ausgangszustand auf...');
  for (let s = 0; s < 2; s++) {
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
  }

  const pairs = game.run(setupPairsFn, PAIR_COUNT, FORCED_NEGATIVE_BUDGET);
  console.log('[' + SEED + '] Paare gebildet:', pairs.length, 'Intervention: TEST-Org-Budget =', FORCED_NEGATIVE_BUDGET);

  const out = { seed: SEED, pairCount: pairs.length, recoverySeasons: RECOVERY_SEASONS, forcedNegativeBudget: FORCED_NEGATIVE_BUDGET, pairs, snapshots: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const s0 = game.run(snapshotPairsFn, pairs, 'S0_afterIntervention');
  out.snapshots.push(s0);
  flush();

  for (let season = 1; season <= RECOVERY_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    const snap = game.run(snapshotPairsFn, pairs, 'S' + season);
    out.snapshots.push(snap);
    const ms = Date.now() - t0;
    const stillInsolvent = snap.filter((r) => r.test.financeStatus === 'INSOLVENT').length;
    console.log('[' + SEED + '] Season', season, 'done in', ms, 'ms. TEST-Orgs noch insolvent:', stillInsolvent + '/' + pairs.length);
    flush();
  }

  // Aggregierte Auswertung.
  const last = out.snapshots[out.snapshots.length - 1];
  const first = out.snapshots[0];
  const summary = last.map((r, i) => {
    const f = first[i];
    return {
      testOrg: r.testOrg, controlOrg: r.controlOrg,
      testStrengthDelta: r.test.strength - f.test.strength, controlStrengthDelta: r.control.strength - f.control.strength,
      testFinalFinanceStatus: r.test.financeStatus, controlFinalFinanceStatus: r.control.financeStatus,
      testRecoveredFromInsolvency: r.test.financeStatus !== 'INSOLVENT' && r.test.financeStatus !== 'CRITICAL',
      testBudgetFinal: r.test.budget, controlBudgetFinal: r.control.budget,
    };
  });
  out.summary = summary;
  out.summaryAggregate = {
    avgTestStrengthDelta: Math.round(summary.reduce((s, r) => s + r.testStrengthDelta, 0) / summary.length * 10) / 10,
    avgControlStrengthDelta: Math.round(summary.reduce((s, r) => s + r.controlStrengthDelta, 0) / summary.length * 10) / 10,
    testRecoveredCount: summary.filter((r) => r.testRecoveredFromInsolvency).length,
    testStillDistressedCount: summary.filter((r) => !r.testRecoveredFromInsolvency).length,
    testOutperformedControlCount: summary.filter((r) => r.testStrengthDelta > r.controlStrengthDelta).length,
  };

  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors;
  flush();
  console.log('[' + SEED + '] PAIRTEST DONE in', out.durationMs, 'ms. pageErrors:', game.pageErrors.length);
  console.log('[' + SEED + '] Summary:', JSON.stringify(out.summaryAggregate));
})().catch((err) => { console.error('[' + SEED + '] PAIRTEST FAILED:', err); process.exit(1); });
