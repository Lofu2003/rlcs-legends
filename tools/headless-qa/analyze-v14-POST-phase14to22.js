// Bot Ecosystem V14, Phase 14 (Budget Utilization) / 15 (Unused Wealth) /
// 17 (Staff AI) / 18 (Coach Replacement) / 19 (Scout Effect, empirische
// Zusatzpruefung zum Code-Beweis) / 21+22 (Reputation/Success Compounding --
// nur wenn `reputation`-Feld im Snapshot vorhanden, siehe renderer.js-
// Erweiterung; graceful skip bei aelteren Laeufen ohne das Feld).
// Phase 16 (Overspending) bewusst NICHT hier -- Code-Beweis (Preis ist IMMER
// calculatePlayerTransferValue()*(1-Rabatt), niemals ein Aufschlag, siehe
// alle Kaufpfade) genuegt, keine Simulation noetig, siehe Abschlussbericht.
// Phase 20 (Org Identity) ist Synthese aus Phase 5/21/22/28, kein eigenes Skript.
const { loadRun, round, mean, pearson, findSnap, rowByName } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv14_V14-POST-' + s + '.json') }));

console.log('=== PHASE 14: Budget Utilization -- Staerke/Kaufkraft nach Rang-Tier (S50, gepoolt) ===');
{
  const tiers = { 'Top50': [], '51-150': [], '151-300': [], '301+': [] };
  runs.forEach(({ data }) => {
    const snap = findSnap(data, data.targetSeasons === 100 ? 50 : data.targetSeasons);
    if (!snap) return;
    snap.rows.forEach((r) => {
      if (r.name === data.setup.assignedOrgName) return;
      const tier = r.rank <= 50 ? 'Top50' : r.rank <= 150 ? '51-150' : r.rank <= 300 ? '151-300' : '301+';
      tiers[tier].push(r);
    });
  });
  Object.entries(tiers).forEach(([tier, rows]) => {
    const ratio = rows.map((r) => r.budget > 0 ? r.strength / (r.budget / 1e6) : null).filter((v) => v !== null);
    console.log(tier + ': n=' + rows.length + ' Ø-Staerke=' + round(mean(rows.map((r) => r.strength)), 1) + ' Ø-Budget=' + round(mean(rows.map((r) => r.budget))) + ' Ø-Staerke-pro-Mio-Budget=' + round(mean(ratio), 2));
  });
}

console.log('\n=== PHASE 15: Unused Wealth -- schwacher Kader + grosses Budget gleichzeitig (alle Checkpoints, Ziel >=100 Faelle) ===');
{
  const cases = [];
  runs.forEach(({ seed, data }) => {
    [10, 20, 30, 40, 50].forEach((season) => {
      const snap = findSnap(data, season);
      if (!snap) return;
      const budgets = snap.rows.map((r) => r.budget).sort((a, b) => a - b);
      const strengths = snap.rows.map((r) => r.strength).sort((a, b) => a - b);
      const budgetP75 = budgets[Math.floor(budgets.length * 0.75)];
      const strengthP25 = strengths[Math.floor(strengths.length * 0.25)];
      snap.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName) return;
        if (r.budget >= budgetP75 && r.strength <= strengthP25) cases.push({ seed, season, name: r.name, budget: r.budget, strength: r.strength, investBudget: r.investBudget });
      });
    });
  });
  console.log('Faelle (schwacher Kader trotz Top-25%-Budget): ' + cases.length);
  if (cases.length) {
    console.log('Ø-investBudget (tatsaechlich verfuegbar fuer Kaeufe) dieser Faelle: ' + round(mean(cases.map((c) => c.investBudget))));
    console.log('Beispiele: ' + cases.slice(0, 5).map((c) => c.seed + '/S' + c.season + '/' + c.name + ' (Staerke=' + c.strength + ', Budget=' + Math.round(c.budget) + ')').join(' | '));
  }
}

console.log('\n=== PHASE 17: Staff AI -- Korrelation Personal-Qualitaet <-> Rang (S50, gepoolt) ===');
{
  const staffQ = [], ranks = [];
  runs.forEach(({ data }) => {
    const snap = findSnap(data, data.targetSeasons === 100 ? 50 : data.targetSeasons);
    if (!snap) return;
    snap.rows.forEach((r) => { if (r.name !== data.setup.assignedOrgName && r.staffQuality > 0) { staffQ.push(r.staffQuality); ranks.push(r.rank); } });
  });
  console.log('n=' + staffQ.length + ' Korrelation staffQuality<->rank (negativ=bessere Personalqualitaet -> besserer/niedrigerer Rang, wie erwartet): ' + pearson(staffQ, ranks));
}

console.log('\n=== PHASE 18: Coach Replacement -- Zeit bis Nachbesetzung nach Vakanz/Downsize (STAFF_VACATE/STAFF_DOWNSIZE, gepoolt) ===');
{
  const gaps = [];
  runs.forEach(({ data }) => {
    const vacates = data.transferLog.filter((t) => t.info && t.info.role === 'Coach' && (t.info.reason === 'STAFF_VACATE'));
    const hires = data.transferLog.filter((t) => t.info && t.info.role === 'Coach' && t.to !== 'Free Agent');
    vacates.forEach((v) => {
      const nextHire = hires.filter((h) => h.to === v.from && h.season >= v.season).sort((a, b) => a.season - b.season)[0];
      if (nextHire) gaps.push(nextHire.season - v.season);
    });
  });
  console.log('n Vakanzen mit gefundener Nachbesetzung=' + gaps.length + ' Ø-Saisons-bis-Nachbesetzung=' + round(mean(gaps), 2));
  console.log('(0 = noch in derselben Saison nachbesetzt)');
}

console.log('\n=== PHASE 19: Scout Effect -- empirische Zusatzpruefung (Code-Beweis: botPerceivedOverall()/botScoutingNoiseAmplitude() bereits real genutzt, siehe Abschlussbericht) ===');
{
  const scoutOveralls = [], rationalRates = [];
  runs.forEach(({ data }) => {
    const lastStaffSnap = data.staffSnapshots[data.staffSnapshots.length - 1];
    if (!lastStaffSnap) return;
    const scoutByOrg = {};
    lastStaffSnap.rows.filter((r) => r.role === 'Scout').forEach((r) => { scoutByOrg[r.org] = r.overall; });
    const buysByOrg = {};
    data.transferLog.filter((t) => t.from === 'Free Agent' && t.info && typeof t.info.replacedOverall === 'number').forEach((t) => {
      if (!buysByOrg[t.to]) buysByOrg[t.to] = [];
      buysByOrg[t.to].push(t.info.overall > t.info.replacedOverall);
    });
    Object.entries(buysByOrg).forEach(([org, arr]) => {
      if (arr.length < 3 || !scoutByOrg[org]) return;
      scoutOveralls.push(scoutByOrg[org]);
      rationalRates.push(arr.filter(Boolean).length / arr.length);
    });
  });
  console.log('n Orgs mit Scout+ >=3 FA-Kaeufen=' + scoutOveralls.length + ' Korrelation Scout-Overall<->Kauf-Rationalitaetsrate: ' + pearson(scoutOveralls, rationalRates));
}

console.log('\n=== PHASE 21/22: Reputation & Success Compounding ===');
{
  const fs2 = require('fs'), path2 = require('path');
  let repRuns = runs;
  const repFile = path2.join(__dirname, '_auditv14_V14-POST-REP.json');
  if (fs2.existsSync(repFile)) repRuns = [{ seed: 'REP', data: JSON.parse(fs2.readFileSync(repFile, 'utf8')) }];
  const hasReputation = repRuns.some(({ data }) => { const s = findSnap(data, 0); return s && s.rows[0] && typeof s.rows[0].reputation === 'number'; });
  if (!hasReputation) {
    console.log('`reputation`-Feld nicht in diesen Baseline-Laeufen vorhanden (Instrumentierung kam erst waehrend dieser Runde dazu, siehe Abschlussbericht) -- Mechanismus ist per Code-Beweis dokumentiert (monthlyBoardBudgetAmount() reputationFactor 0.85x-1.15x, computeMonthlyReputationDelta() gilt seit "jetzt generisch" fuer ALLE Orgs inkl. Bots via applyMonthlyBotEconomy()). Empirische Korrelation folgt aus einem separaten Zusatzlauf (siehe V14-REP-* Datei, falls vorhanden).');
  } else {
    const runs = repRuns; // shadow: ab hier nur der REP-Lauf (bzw. Fallback auf A-F)
    const rep = [], budgetGrowthPct = [];
    runs.forEach(({ data }) => {
      const s0 = findSnap(data, 0), sEnd = findSnap(data, data.targetSeasons);
      if (!s0 || !sEnd) return;
      s0.rows.forEach((r0) => {
        const rEnd = rowByName(sEnd, r0.name);
        if (!rEnd || r0.name === data.setup.assignedOrgName || !r0.budget) return;
        rep.push(rEnd.reputation);
        budgetGrowthPct.push((rEnd.budget - r0.budget) / r0.budget);
      });
    });
    console.log('n=' + rep.length + ' Korrelation Reputation(Ende)<->Budget-Wachstum: ' + pearson(rep, budgetGrowthPct));
  }
}
