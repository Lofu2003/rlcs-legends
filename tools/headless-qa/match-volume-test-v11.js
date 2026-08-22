// Bot Ecosystem V11, Phase 23/24 -- Counterfactual Match Volume Test.
// Identische Start-Roster (5 Testorgs, 0/5/15/30/50 forcierte Serien),
// KEIN Season-Batch-Wachstum (batchDevelopBotPersonForSeason laeuft nur am
// echten Saisonende) -- isoliert dadurch sauber NUR den match-getriebenen
// Entwicklungsanteil (applyPlayerDevelopmentForGame(), ueber
// simulateBotSeries() direkt ausgeloest), wie von Phase 23 verlangt
// ("AUSSCHLIESSLICH durch Matchteilnahme"). Nutzung: node match-volume-test-v11.js <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const OUT_FILE = process.argv[2] || path.join(__dirname, '_matchvolume_v11.json');
const GROUPS = [0, 5, 15, 30, 50];
const ORGS_PER_GROUP = 6;

function setupFn(groups, orgsPerGroup) {
  botEconomyDebugTelemetryEnabled = true;
  // Nutzt bestehende Bot-Orgs mit AEHNLICHER Ausgangsstaerke (mittleres
  // Drittel, um Deckeneffekte oben/unten zu vermeiden) statt neue Test-Orgs
  // zu erfinden -- 6 Orgs je Gruppe, Start-Overall auf denselben Wert
  // ueberschrieben (identischer Ausgangszustand ueber alle Gruppen).
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster && o.roster.starters && o.roster.starters.length >= 3);
  const sorted = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const midStart = Math.floor(sorted.length / 2) - Math.floor((groups.length * orgsPerGroup) / 2);
  const pool = sorted.slice(midStart, midStart + groups.length * orgsPerGroup);
  const FIXED_OVERALL = 70;
  pool.forEach((org) => {
    [...org.roster.starters, org.roster.sub].filter(Boolean).forEach((p) => {
      ROSTER_STAT_KEYS.forEach((k) => { p[k] = FIXED_OVERALL; });
      p.overall = FIXED_OVERALL;
      p.potential = 99; // kein Deckel-Interferenz -- reiner Wachstumsraten-Vergleich
      p.age = 22;
    });
    org.strength = computeOrgStrengthFromRoster(org.roster);
  });
  const result = {};
  groups.forEach((g, gi) => {
    result['g' + g] = pool.slice(gi * orgsPerGroup, (gi + 1) * orgsPerGroup).map((o) => o.name);
  });
  return { groups: result, fixedOverall: FIXED_OVERALL };
}

function snapshotFn(orgNames) {
  return orgNames.map((name) => {
    const o = findOrgByName(name);
    const overalls = [...o.roster.starters, o.roster.sub].filter(Boolean).map((p) => p.overall);
    return { org: name, avgOverall: overalls.reduce((a, b) => a + b, 0) / overalls.length };
  });
}

// Forciert `count` Best-of-5-Serien fuer jede Org der Gruppe -- Gegner
// rotiert INNERHALB derselben Gruppe (6 Orgs, Round-Robin), damit alle
// Gruppen exakt denselben Gegner-Staerke-Kontext haben (identische Gruppen-
// Zusammensetzung), nur die Serienzahl unterscheidet sich.
function forceMatchesFn(orgNames, count) {
  if (count === 0) return;
  const orgs = orgNames.map((n) => findOrgByName(n));
  let matchesPlayed = 0;
  let i = 0;
  while (matchesPlayed < count * orgs.length) {
    const a = orgs[i % orgs.length];
    const b = orgs[(i + 1) % orgs.length];
    simulateBotSeries(a, b, 5);
    matchesPlayed += 2; // beide Seiten bekommen +1 Serie
    i++;
  }
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: 'V11-MATCHVOL' });
  game.initHeadlessCareer();
  const setup = game.run(setupFn, GROUPS, ORGS_PER_GROUP);
  console.log('Setup done:', JSON.stringify(setup));

  const before = {};
  GROUPS.forEach((g) => { before['g' + g] = game.run(snapshotFn, setup.groups['g' + g]); });

  GROUPS.forEach((g) => {
    console.log('Forcing', g, 'series per org for group g' + g + '...');
    game.run(forceMatchesFn, setup.groups['g' + g], g);
  });

  const after = {};
  GROUPS.forEach((g) => { after['g' + g] = game.run(snapshotFn, setup.groups['g' + g]); });

  const summary = GROUPS.map((g) => {
    const b = before['g' + g], a = after['g' + g];
    const avgBefore = b.reduce((s, r) => s + r.avgOverall, 0) / b.length;
    const avgAfter = a.reduce((s, r) => s + r.avgOverall, 0) / a.length;
    return { group: 'g' + g, seriesForced: g, avgOverallBefore: Math.round(avgBefore * 100) / 100, avgOverallAfter: Math.round(avgAfter * 100) / 100, gain: Math.round((avgAfter - avgBefore) * 100) / 100 };
  });

  const out = { setup, before, after, summary, durationMs: Date.now() - t0all, pageErrors: game.pageErrors };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log('MATCH VOLUME TEST DONE in', out.durationMs, 'ms. Summary:', JSON.stringify(summary));
})().catch((err) => { console.error('MATCH VOLUME TEST FAILED:', err); process.exit(1); });
