// Bot Ecosystem V17, Fix-1-Entscheidungshilfe fuer Fix 2 (Staff-Markt-
// Pool-Rescaling). Nutzt den DECIDE-FIX2-Lauf (post-Fix-1-Code, 20 Saisons)
// und vergleicht die reasonCode-Verteilung ueber die Zeit (frueh vs. spaet),
// da frueh vor allem echte Anlauf-Budgetknappheit erwartet wird, waehrend
// MARKET_EMPTY strukturell ueber die Zeit stabil bleiben sollte, wenn es ein
// echter Pool-Groessen-Effekt ist.
const fs = require('fs');
const path = require('path');
const { round, mean } = require('./v14-lib');

const file = process.argv[2] || '_decide_v17_fix2.json';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const entries = data.staffHireTraceLog || [];
console.log('n entries=' + entries.length + ' seasons=' + data.targetSeasons);

console.log('\n=== Reason-Code-Verteilung GESAMT ===');
{
  const counts = {};
  entries.forEach((e) => { counts[e.reasonCode] = (counts[e.reasonCode] || 0) + 1; });
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ': ' + v + ' (' + round(100 * v / entries.length, 1) + '%)'));
  console.log('  hireStaffCreated-Rate=' + round(100 * entries.filter((e) => e.hireStaffCreated).length / entries.length, 2) + '%');
}

console.log('\n=== Reason-Code-Verteilung nach Saisonfenster (fruh S1-5 vs. spat S16-20) ===');
['1-5', '16-20'].forEach((window) => {
  const [lo, hi] = window.split('-').map(Number);
  const windowEntries = entries.filter((e) => e.season >= lo && e.season <= hi);
  if (!windowEntries.length) return;
  const counts = {};
  windowEntries.forEach((e) => { counts[e.reasonCode] = (counts[e.reasonCode] || 0) + 1; });
  console.log('S' + window + ' (n=' + windowEntries.length + '):');
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('    ' + k + ': ' + round(100 * v / windowEntries.length, 1) + '%'));
});

console.log('\n=== MARKET_EMPTY je Rolle (spaete Saisons S11-20, ausgereifte Wirtschaft) ===');
{
  const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];
  ROLES.forEach((role) => {
    const roleEntries = entries.filter((e) => e.role === role && e.season >= 11);
    if (!roleEntries.length) return;
    const marketEmpty = roleEntries.filter((e) => e.reasonCode === 'MARKET_EMPTY').length;
    console.log('  ' + role + ' (n=' + roleEntries.length + '): MARKET_EMPTY=' + round(100 * marketEmpty / roleEntries.length, 1) + '% Ø-PoolGroesse=' + round(mean(roleEntries.map((e) => e.staffPoolSize)), 2));
  });
}

console.log('\n=== OPTION_LIMIT-Anteil (tragbar, aber andere Rolle gewann Tie-Breaker) ===');
{
  const optionLimit = entries.filter((e) => e.reasonCode === 'OPTION_LIMIT').length;
  console.log('  n=' + optionLimit + ' (' + round(100 * optionLimit / entries.length, 2) + '%)');
}

console.log('\n=== Pool-Health spaete Saison (S20 falls vorhanden) ===');
{
  const snap = (data.poolHealthSnapshots || []).find((s) => s.season === Math.min(20, data.targetSeasons));
  if (snap) snap.roles.forEach((r) => console.log('  ' + r.role + ': poolSize=' + r.poolSize + ' priceMedian=' + r.priceMedian));
}
