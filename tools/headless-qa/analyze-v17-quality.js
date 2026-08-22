// Bot Ecosystem V17, Phase 30 (Staff Quality nach Reichtum) / 31 (Value for
// Money -- Overall Gain / Total Cost).
const { loadRun, round, mean, pearson } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-BASE-' + s + '.json') }));

console.log('=== PHASE 30: Staff Quality -- waehlt ein reicher Bot IMMER den billigsten Kandidaten? ===');
{
  const hires = [];
  runs.forEach(({ data }) => (data.transferLog || []).filter((t) => t.info && ['STAFF_DOWNSIZE', 'STAFF_RECOVERY_HIRE', 'STAFF_VACANCY_FILL'].includes(t.info.reason) && t.info.overall).forEach((t) => hires.push(t)));
  console.log('n Hires mit Overall-Info=' + hires.length);
  const buckets = { '<1M': [], '1-50M': [], '50-200M': [], '>200M': [] };
  hires.forEach((h) => {
    const budget = h.info.sellerBudget || h.info.buyerBudget || 0; // je nach Pfad unterschiedlich benannt
    const b = budget < 1e6 ? '<1M' : budget < 5e7 ? '1-50M' : budget < 2e8 ? '50-200M' : '>200M';
    buckets[b].push(h.info.overall);
  });
  Object.entries(buckets).forEach(([b, overalls]) => {
    if (!overalls.length) return;
    console.log(b + ' Budget (n=' + overalls.length + '): Ø-Overall des Hires=' + round(mean(overalls), 1));
  });
  console.log('(Hinweis: Preis-Bucket via sellerBudget/buyerBudget aus qaInfo -- nicht bei jedem Pfad identisch benannt, Naeherung.)');
}

console.log('\n=== PHASE 31: Value for Money -- Overall Gain / Total Cost (nur QA-Analyse) ===');
{
  const hires = [];
  runs.forEach(({ data }) => {
    (data.poolHealthSnapshots || []).forEach((snap) => {
      snap.roles.forEach((r) => {
        if (r.poolSize < 2) return;
        // Grobe Value-for-Money-Naeherung: Overall-Spanne / Preis-Spanne im Pool
        // (kein Trade tatsaechlich ausgefuehrt -- reine Marktstruktur-Beobachtung).
        hires.push({ role: r.role, overallSpread: r.overallP90 - r.overallMin, priceSpread: r.priceP90 - r.priceMin });
      });
    });
  });
  const ratios = hires.filter((h) => h.priceSpread > 0).map((h) => h.overallSpread / (h.priceSpread / 1000));
  console.log('n Pool-Snapshots mit >=2 Kandidaten=' + hires.length + ' Ø-Overall-Gewinn pro 1000EUR Mehrpreis=' + round(mean(ratios), 4));
  console.log('(Cheapest-first-Strategie ignoriert diese Spanne komplett -- ob das eine relevante verpasste Chance ist, haengt davon ab, ob die Spanne bei AFFORDABLEN Kandidaten gross genug ist, siehe Root-Cause-Bericht.)');
}
