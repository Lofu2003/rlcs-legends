const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, '_audit_SEED-A.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const snaps = d.seasonSnapshots;
const last = snaps[snaps.length - 1];
console.log('=== SEED', d.seed, '| Snapshots:', snaps.length, '(S0..S' + (snaps.length - 1) + ') ===\n');

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2 || 1);
}

// --- 1. MOBILITY (bottom10/mid10/top10) ---
console.log('--- MOBILITY ---');
['bottom10', 'mid10', 'top10'].forEach((cohortKey) => {
  const names = d.setup[cohortKey];
  console.log('\n' + cohortKey.toUpperCase() + ':');
  names.forEach((name) => {
    const ranks = snaps.map((s) => s.orgs[name] && s.orgs[name].rank).filter((r) => r != null);
    const strengths = snaps.map((s) => s.orgs[name] && s.orgs[name].strength).filter((r) => r != null);
    if (!ranks.length) { console.log(' ', name, '-- keine Daten'); return; }
    const bestRank = Math.min(...ranks);
    const worstRank = Math.max(...ranks);
    const finalRank = ranks[ranks.length - 1];
    const finalStrength = strengths[strengths.length - 1];
    const reached = { top400: bestRank <= 400, top300: bestRank <= 300, top200: bestRank <= 200, midfield: bestRank <= 227, top100: bestRank <= 100, top50: bestRank <= 50, top30: bestRank <= 30, top10: bestRank <= 10, top5: bestRank <= 5 };
    console.log(' ', name, 'startStr=' + strengths[0], 'endStr=' + finalStrength, 'bestRank=' + bestRank, 'worstRank=' + worstRank, 'finalRank=' + finalRank,
      'reached=' + Object.entries(reached).filter(([, v]) => v).map(([k]) => k).join(',') || 'none');
  });
});

// --- 2. FINANCIAL POVERTY TRAP ---
console.log('\n--- FINANCIAL POVERTY TRAP (Bottom-10) ---');
d.setup.bottom10.forEach((name) => {
  const statuses = snaps.map((s) => s.orgs[name] && s.orgs[name].financeStatus);
  const everInsolvent = statuses.includes('INSOLVENT');
  const everCritical = statuses.includes('CRITICAL');
  const finalStatus = statuses[statuses.length - 1];
  console.log(' ', name, 'finalStatus=' + finalStatus, 'everInsolvent=' + everInsolvent, 'everCritical=' + everCritical, 'history=' + statuses.join('>'));
});

// --- 3. DYNASTY / TOP10 RETENTION ---
console.log('\n--- DYNASTY / TOP-10 RETENTION ---');
const allOrgsLast = Object.keys(last.orgs);
// aktuelle Top10-by-strength ueber ALLE getrackten Cohort-Orgs (nur Naeherung, da nicht alle 454 pro Snapshot gespeichert -- nutzt rank-Feld direkt).
const currentTop10ByRank = [...d.setup.bottom10, ...d.setup.mid10, ...d.setup.top10]
  .map((name) => ({ name, rank: last.orgs[name] && last.orgs[name].rank }))
  .filter((o) => o.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 10).map((o) => o.name);
const originalTop10StillTop10 = d.setup.top10.filter((n) => currentTop10ByRank.includes(n)).length;
console.log('Original Top10 noch in aktuellem Top10 (Naeherung, nur unter getrackten Cohort-Orgs):', originalTop10StillTop10, '/ 10');
d.setup.top10.forEach((name) => {
  const majors = last.orgs[name] ? last.orgs[name].majorsWon : 0;
  const worlds = last.orgs[name] ? last.orgs[name].worldsWon : 0;
  console.log(' ', name, 'majorsWon=' + majors, 'worldsWon=' + worlds, 'finalRank=' + (last.orgs[name] && last.orgs[name].rank));
});

// --- 4. TALENT ---
console.log('\n--- TALENT JOURNEYS ---');
['bottomTalents', 'midTalents', 'topTalents'].forEach((key) => {
  console.log('\n' + key + ':');
  d.setup[key].forEach((t) => {
    const journey = snaps.map((s) => {
      const found = (s.talents || []).find((x) => x.name === t.name);
      return found ? (found.retiredOrGone ? 'GONE' : found.org + '(' + found.overall + ')') : '?';
    });
    console.log('  ', t.name, 'start=' + t.org + '(' + t.overall + '->pot' + t.potential + ')', 'journey=' + journey.join(' -> '));
  });
});
console.log('\nTalent Concentration (letzter Snapshot):', JSON.stringify(last.talentConcentration));
console.log('Talent Concentration (S0):', JSON.stringify(snaps[0].talentConcentration));

// --- 5. ECONOMY ---
console.log('\n--- ECONOMY TREND ---');
snaps.forEach((s) => {
  console.log(' ', s.label, 'median=' + s.economy.p50, 'mean=' + s.economy.mean, 'p90=' + s.economy.p90, 'p99=' + s.economy.p99, 'max=' + s.economy.max,
    'gini=' + s.economy.gini, 'insolvent=' + s.economy.insolventCount, 'totalMoneySupply=' + s.economy.totalMoneySupply,
    '>25M=' + s.economy.wealthTiers.over25M, '>50M=' + s.economy.wealthTiers.over50M, '>100M=' + s.economy.wealthTiers.over100M, '>250M=' + s.economy.wealthTiers.over250M, '>500M=' + s.economy.wealthTiers.over500M);
});
const medianGrowth = snaps.length > 1 ? Math.pow(snaps[snaps.length - 1].economy.p50 / snaps[0].economy.p50, 1 / (snaps.length - 1)) - 1 : 0;
console.log('Median-Wachstum pro Saison (geometrisch):', Math.round(medianGrowth * 1000) / 10, '%');

// Board-Compounding-Korrelation: rosterValue(S_n) vs budget(S_n) UND vs budget(S_n+1)-budget(S_n) (Wachstum).
console.log('\n--- BOARD COMPOUNDING ---');
const pairsRVvsBudget = [];
const pairsRVvsGrowth = [];
for (let i = 0; i < snaps.length; i++) {
  const sample = snaps[i].rosterValueVsBudgetSample || [];
  sample.forEach((o) => { if (Number.isFinite(o.rosterValue) && Number.isFinite(o.budget)) pairsRVvsBudget.push([o.rosterValue, o.budget]); });
  if (i < snaps.length - 1) {
    const nextSample = snaps[i + 1].rosterValueVsBudgetSample || [];
    const nextByName = new Map(nextSample.map((o) => [o.name, o.budget]));
    sample.forEach((o) => {
      const nextBudget = nextByName.get(o.name);
      if (Number.isFinite(o.rosterValue) && Number.isFinite(o.budget) && Number.isFinite(nextBudget)) {
        pairsRVvsGrowth.push([o.rosterValue, nextBudget - o.budget]);
      }
    });
  }
}
if (pairsRVvsBudget.length > 5) {
  const corr1 = pearson(pairsRVvsBudget.map((p) => p[0]), pairsRVvsBudget.map((p) => p[1]));
  console.log('Korrelation RosterValue(Sn) vs Budget(Sn):', Math.round(corr1 * 1000) / 1000, '(n=' + pairsRVvsBudget.length + ')');
}
if (pairsRVvsGrowth.length > 5) {
  const corr2 = pearson(pairsRVvsGrowth.map((p) => p[0]), pairsRVvsGrowth.map((p) => p[1]));
  console.log('Korrelation RosterValue(Sn) vs Budget-Wachstum(Sn->Sn+1):', Math.round(corr2 * 1000) / 1000, '(n=' + pairsRVvsGrowth.length + ')');
}

// --- 6. STAFF MARKET ---
console.log('\n--- STAFF MARKET TREND (pro Rolle) ---');
const roles = Object.keys(last.staffMarket);
roles.forEach((role) => {
  const trend = snaps.map((s) => s.staffMarket[role].employed + '/' + s.staffMarket[role].totalOrgs);
  const availTrend = snaps.map((s) => s.staffMarket[role].availableFreeAgents);
  console.log(' ', role, 'employed:', trend.join(' -> '));
  console.log('     available pool:', availTrend.join(' -> '));
});

// --- 7. TRANSFER MARKET ---
console.log('\n--- TRANSFER MARKET TREND ---');
snaps.forEach((s) => {
  console.log(' ', s.label, JSON.stringify(s.transferMarket));
});

// --- 8. SAVE/LOAD ---
console.log('\n--- SAVE/LOAD CHECKS ---');
d.saveLoadChecks.forEach((c) => {
  console.log(' Season', c.season, ':', c.identical ? 'PASS' : 'FAIL');
  if (!c.identical) {
    const diffs = [];
    c.before.forEach((b, i) => {
      const a = c.after[i];
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ name: b.name, before: b, after: a });
    });
    console.log('   Abweichungen:', diffs.length, JSON.stringify(diffs));
  }
});

// --- ANTI-EXPLOIT (grobe Naeherung ueber Cohort-Orgs) ---
console.log('\n--- ANTI-EXPLOIT (Cohort-Naeherung) ---');
const cohortAll = [...d.setup.bottom10, ...d.setup.mid10, ...d.setup.top10];
const everInsolventGroup = [];
const neverInsolventGroup = [];
cohortAll.forEach((name) => {
  const statuses = snaps.map((s) => s.orgs[name] && s.orgs[name].financeStatus);
  const ever = statuses.includes('INSOLVENT');
  const startStrength = snaps[0].orgs[name] && snaps[0].orgs[name].strength;
  const endStrength = last.orgs[name] && last.orgs[name].strength;
  (ever ? everInsolventGroup : neverInsolventGroup).push({ name, startStrength, endStrength, growth: endStrength - startStrength });
});
const avgGrowth = (arr) => arr.length ? Math.round(arr.reduce((s, o) => s + o.growth, 0) / arr.length * 10) / 10 : null;
console.log('Jemals insolvent (n=' + everInsolventGroup.length + '), durchschnittliches Staerke-Wachstum:', avgGrowth(everInsolventGroup));
console.log('Nie insolvent (n=' + neverInsolventGroup.length + '), durchschnittliches Staerke-Wachstum:', avgGrowth(neverInsolventGroup));

console.log('\n=== ENDE ANALYSE ===');
