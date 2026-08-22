// Bot Ecosystem V14, Phase 23 (Failure Recovery) / 24 (Comeback Rate) /
// 25 (New Elite Survival) / 26 (Dynasty Length, JAEHRLICHE Granularitaet) /
// 27 (Champion Diversity, nur V14-BASE-F -- einziger Seed mit Champion-Log,
// da die Instrumentierung erst waehrend dieser Runde dazukam, siehe
// Abschlussbericht) / 28 (Rank Autocorrelation) / 29 (Randomness vs Skill,
// nutzt die V14-ID-*-Identical-Start-Laeufe als "Randomness-only"-Baseline).
const { loadRun, round, mean, pearson, stddev, findSnap, rowByName } = require('./v14-lib');
const fs = require('fs'), path = require('path');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv14_V14-POST-' + s + '.json') }));

console.log('=== PHASE 23: Failure Recovery -- 2 schlechte Saisons in Folge (Winrate<40%), vorher Top50: Erholung? ===');
{
  let cases = 0, recoveredWithin10 = 0;
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      for (let s = 2; s <= data.targetSeasons - 10; s++) {
        const rPrev = rowByName(findSnap(data, s - 2), name);
        const r1 = rowByName(findSnap(data, s - 1), name), r2 = rowByName(findSnap(data, s), name);
        if (!rPrev || !r1 || !r2 || rPrev.rank > 50) continue;
        const wp1 = (r1.wins + r1.losses) > 0 ? r1.wins / (r1.wins + r1.losses) : null; // kumulativ, als Naeherung fuer "Form bis S s-1"
        if (wp1 === null) continue;
        // Season-over-Season-Winrate ueber careerWinLossTally-Deltas:
        const rPrevPrev = rowByName(findSnap(data, s - 3), name);
        if (!rPrevPrev) continue;
        const seasonWP = (a, b) => { const dw = b.wins - a.wins, dl = b.losses - a.losses; return (dw + dl) > 0 ? dw / (dw + dl) : null; };
        const wpA = seasonWP(rPrevPrev, rPrev), wpB = seasonWP(rPrev, r1);
        if (wpA === null || wpB === null || wpA >= 0.4 || wpB >= 0.4) continue;
        cases++;
        const rFuture = rowByName(findSnap(data, Math.min(data.targetSeasons, s + 10)), name);
        if (rFuture && rFuture.rank <= 50) recoveredWithin10++;
      }
    });
  });
  console.log('Faelle (2 schlechte Saisons in Folge, vorher Top50): ' + cases + ' | Erholung auf Top50 binnen 10 Saisons: ' + recoveredWithin10 + '/' + cases + (cases ? ' (' + round(100 * recoveredWithin10 / cases, 1) + '%)' : ''));
}

console.log('\n=== PHASE 24: Comeback Rate -- Top50 faellt unter Rang150, Rueckkehr binnen 5/10/20 Saisons ===');
{
  let cases = 0; const back5 = { c: 0 }, back10 = { c: 0 }, back20 = { c: 0 };
  runs.forEach(({ data }) => {
    data.setup.allBotNames.forEach((name) => {
      let wasTop50Season = null;
      for (let s = 1; s <= data.targetSeasons; s++) {
        const rPrev = rowByName(findSnap(data, s - 1), name), rNow = rowByName(findSnap(data, s), name);
        if (!rPrev || !rNow) continue;
        if (rPrev.rank <= 50 && rNow.rank > 150) {
          cases++;
          const check = (k) => { const r = rowByName(findSnap(data, Math.min(data.targetSeasons, s + k)), name); return r && r.rank <= 50; };
          if (check(5)) back5.c++;
          if (check(10)) back10.c++;
          if (check(20)) back20.c++;
        }
      }
    });
  });
  console.log('Faelle (Top50 -> unter Rang150 innerhalb 1 Saison): ' + cases);
  console.log('Rueckkehr Top50 binnen 5 Saisons: ' + back5.c + '/' + cases + (cases ? ' (' + round(100 * back5.c / cases, 1) + '%)' : ''));
  console.log('Rueckkehr Top50 binnen 10 Saisons: ' + back10.c + '/' + cases + (cases ? ' (' + round(100 * back10.c / cases, 1) + '%)' : ''));
  console.log('Rueckkehr Top50 binnen 20 Saisons: ' + back20.c + '/' + cases + (cases ? ' (' + round(100 * back20.c / cases, 1) + '%)' : ''));
}

console.log('\n=== PHASE 25: New Elite Survival -- wie lange bleiben NEUE Top10-Orgs in Top10? ===');
{
  const survivalLengths = [];
  runs.forEach(({ data }) => {
    const names = data.setup.allBotNames;
    for (let s = 1; s <= data.targetSeasons; s++) {
      const snapPrev = findSnap(data, s - 1), snapNow = findSnap(data, s);
      if (!snapPrev || !snapNow) continue;
      names.forEach((name) => {
        const rPrev = rowByName(snapPrev, name), rNow = rowByName(snapNow, name);
        if (!rPrev || !rNow) return;
        if (rPrev.rank > 10 && rNow.rank <= 10) { // Neueintritt in Top10
          let streak = 0;
          for (let k = s; k <= data.targetSeasons; k++) { const r = rowByName(findSnap(data, k), name); if (r && r.rank <= 10) streak++; else break; }
          survivalLengths.push(streak);
        }
      });
    }
  });
  console.log('n Neueintritte in Top10=' + survivalLengths.length + ' Ø-Verweildauer(Saisons)=' + round(mean(survivalLengths), 2) + ' Median=' + [...survivalLengths].sort((a, b) => a - b)[Math.floor(survivalLengths.length / 2)]);
  console.log('Verteilung: 1 Saison=' + survivalLengths.filter((v) => v === 1).length + ', 2-5=' + survivalLengths.filter((v) => v >= 2 && v <= 5).length + ', 6-10=' + survivalLengths.filter((v) => v >= 6 && v <= 10).length + ', >10=' + survivalLengths.filter((v) => v > 10).length);
}

console.log('\n=== PHASE 26: Dynasty Length -- laengste Serie pro Tier, JAEHRLICHE Granularitaet (nicht nur Checkpoints) ===');
{
  runs.forEach(({ seed, data }) => {
    [1, 3, 5, 10, 50].forEach((threshold) => {
      const orgStreak = {}; let best = { org: null, len: 0 };
      for (let s = 0; s <= data.targetSeasons; s++) {
        const snap = findSnap(data, s);
        if (!snap) continue;
        const inTier = new Set(snap.rows.filter((r) => r.rank <= threshold).map((r) => r.name));
        Object.keys(orgStreak).forEach((n) => { if (!inTier.has(n)) orgStreak[n] = 0; });
        inTier.forEach((n) => { orgStreak[n] = (orgStreak[n] || 0) + 1; if (orgStreak[n] > best.len) best = { org: n, len: orgStreak[n] }; });
      }
      console.log('[' + seed + '] Top' + threshold + '-Serie: ' + best.org + ' (' + best.len + ' aufeinanderfolgende Saisons von ' + (data.targetSeasons + 1) + ')');
    });
  });
}

console.log('\n=== PHASE 27: Champion Diversity (POST-FIX, gepoolt ueber alle 5 Seeds A-E -- alle haben championLog) ===');
{
  runs.forEach(({ seed, data }) => {
    const champLog = data.championLog || [];
    if (!champLog.length) { console.log('[' + seed + '] Kein championLog gefunden.'); return; }
    const worlds = champLog.filter((c) => c.eventType === 'worlds').sort((a, b) => a.season - b.season);
    [10, 20, 50].forEach((horizon) => {
      const w = worlds.filter((c) => c.season <= horizon);
      const distinct = new Set(w.map((c) => c.championName));
      console.log('[' + seed + '] Worlds S1-S' + horizon + ': ' + w.length + ' Titel, ' + distinct.size + ' verschiedene Champions (' + round(100 * distinct.size / (w.length || 1), 1) + '% Diversitaet)');
    });
  });
}

console.log('\n=== PHASE 28: Rank/Strength Autocorrelation S0 -> spaeter (gepoolt) ===');
{
  [1, 5, 10, 20, 50].forEach((horizon) => {
    const r0ranks = [], rHranks = [], r0str = [], rHstr = [];
    runs.forEach(({ data }) => {
      if (horizon > data.targetSeasons) return;
      const s0 = findSnap(data, 0), sH = findSnap(data, horizon);
      if (!s0 || !sH) return;
      s0.rows.forEach((r) => {
        if (r.name === data.setup.assignedOrgName) return;
        const rH = rowByName(sH, r.name);
        if (!rH) return;
        r0ranks.push(r.rank); rHranks.push(rH.rank); r0str.push(r.strength); rHstr.push(rH.strength);
      });
    });
    if (!r0ranks.length) return;
    console.log('S0->S' + horizon + ': n=' + r0ranks.length + ' Korrelation(Rank)=' + pearson(r0ranks, rHranks) + ' Korrelation(Strength)=' + pearson(r0str, rHstr));
  });
}

console.log('\n=== PHASE 29: Randomness vs. Skill -- Varianz-Vergleich (Identical-Start-Test als reine RNG-Baseline) ===');
{
  const idFiles = ['A', 'B', 'C'].map((s) => '_v14_identical_V14-ID-' + s + '.json').filter((f) => fs.existsSync(path.join(__dirname, f)));
  if (!idFiles.length) {
    console.log('Keine Identical-Start-Test-Daten verfuegbar (Laeufe noch nicht fertig) -- siehe separate Nachreichung.');
  } else {
    idFiles.forEach((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
      [5, 10, 20].forEach((season) => {
        const snap = d.snapshots.find((s) => s.season === season);
        if (!snap) return;
        const randomOnlyRankStd = stddev(snap.rows.map((r) => r.rank));
        const randomOnlyStrengthStd = stddev(snap.rows.map((r) => r.strength));
        // Populations-Streuung (ALLE Orgs, echte Startunterschiede + RNG) zum Vergleich:
        const baseRun = runs[0].data;
        const baseSnap = findSnap(baseRun, Math.min(season, baseRun.targetSeasons));
        const totalRankStd = baseSnap ? stddev(baseSnap.rows.filter((r) => r.name !== baseRun.setup.assignedOrgName).map((r) => r.rank)) : null;
        const totalStrengthStd = baseSnap ? stddev(baseSnap.rows.filter((r) => r.name !== baseRun.setup.assignedOrgName).map((r) => r.strength)) : null;
        console.log('[' + f + '] S' + season + ': reine-RNG-Streuung(12 identische Orgs) Rank-StdDev=' + randomOnlyRankStd + ' Strength-StdDev=' + randomOnlyStrengthStd + ' | Gesamt-Populations-StdDev (Ref.) Rank=' + totalRankStd + ' Strength=' + totalStrengthStd + ' | RNG-Anteil an Strength-Varianz~=' + (totalStrengthStd ? round(100 * (randomOnlyStrengthStd * randomOnlyStrengthStd) / (totalStrengthStd * totalStrengthStd), 1) + '%' : 'n/a'));
      });
    });
  }
}
