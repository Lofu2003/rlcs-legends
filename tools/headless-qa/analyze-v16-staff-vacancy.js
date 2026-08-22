// Bot Ecosystem V16, Phase 13 (Vacancy Lifetime) / 14 (Role Distribution,
// Perzentile) / 15 (Why No Hire Option) / 18 (plausibler Dauer-Bereich) /
// 19 (Staff Quality Decision) / 20 (Staff Replacement schwacher Mitarbeiter).
// Nutzt qaStaffVacancyLog (V16, echte Episoden) statt der V15-Naeherung.
const { loadRun, round, mean, percentile, findSnap } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv16_V16-BASE-' + s + '.json') }));
const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];

console.log('=== PHASE 13/14: Vacancy Lifetime, echte Episoden (Start-/Endsaison), nach Rolle ===');
{
  let totalEpisodes = 0;
  ROLES.forEach((role) => {
    const durations = [];
    runs.forEach(({ data }) => (data.staffVacancyLog || []).filter((v) => v.role === role).forEach((v) => durations.push(v.duration)));
    totalEpisodes += durations.length;
    durations.sort((a, b) => a - b);
    if (!durations.length) { console.log(role + ': n=0'); return; }
    console.log(role + ': n=' + durations.length + ' Ø=' + round(mean(durations), 2) + ' P50=' + percentile(durations, 0.5) + ' P75=' + percentile(durations, 0.75) + ' P90=' + percentile(durations, 0.9) + ' P95=' + percentile(durations, 0.95) + ' Max=' + Math.max(...durations));
  });
  console.log('Gesamt-Episoden (abgeschlossen, alle Rollen)=' + totalEpisodes + ' (Ziel >=10.000 "falls genuegend entstehen" -- siehe Ergebnis)');
  // Offene (nie geschlossene) Vakanzen am Laufende -- eigene Kategorie, nicht in obigen Perzentilen
  let openCount = 0;
  runs.forEach(({ data }) => { openCount += Object.keys(data.openVacanciesAtEnd || {}).length; });
  console.log('Noch offene Vakanzen am Laufende (min. so lange, potenziell laenger): ' + openCount);
}

console.log('\n=== PHASE 15: Why No Hire Option? -- Coach-Vakanz-Entscheidungen ohne HIRE_STAFF-Option ===');
{
  let vacantDecisions = 0, noOption = 0;
  const budgetsAtNoOption = [];
  runs.forEach(({ data }) => (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.coachOverall === null).forEach((d) => {
    vacantDecisions++;
    const hasOpt = (d.availableOptions || []).some((o) => o.label === 'HIRE_STAFF');
    if (!hasOpt) { noOption++; budgetsAtNoOption.push(d.budget); }
  }));
  console.log('n vakante-Coach-Entscheidungen=' + vacantDecisions + ' ohne Option=' + noOption + ' (' + round(100 * noOption / vacantDecisions, 1) + '%)');
  console.log('Ø-Budget in No-Option-Faellen=' + round(mean(budgetsAtNoOption)) + ' (falls hoch: Budget ist NICHT die Ursache -- eher Kandidaten-Pool/Rollen-Konkurrenz)');
}

console.log('\n=== PHASE 18: Plausibler Vakanzdauer-Bereich (aus Daten, nicht willkuerlich) ===');
{
  ROLES.forEach((role) => {
    const durations = [];
    runs.forEach(({ data }) => (data.staffVacancyLog || []).filter((v) => v.role === role).forEach((v) => durations.push(v.duration)));
    if (!durations.length) return;
    durations.sort((a, b) => a - b);
    const over10 = durations.filter((d) => d > 10).length;
    const over20 = durations.filter((d) => d > 20).length;
    console.log(role + ': >10 Saisons=' + round(100 * over10 / durations.length, 1) + '% >20 Saisons=' + round(100 * over20 / durations.length, 1) + '% (n=' + durations.length + ')');
  });
}

console.log('\n=== PHASE 19: Staff Quality Decision -- Preis/Overall/Budget-Verhaeltnis bei Hires ===');
{
  const hires = [];
  runs.forEach(({ data }) => (data.transferLog || []).filter((t) => t.info && ['STAFF_DOWNSIZE', 'STAFF_RECOVERY_HIRE', 'STAFF_VACANCY_FILL'].includes(t.info.reason)).forEach((t) => hires.push(t)));
  console.log('n Hires=' + hires.length + ' (Ziel >=5000)');
  const withOverall = hires.filter((h) => h.info.overall);
  console.log('Ø-Overall des Hires=' + round(mean(withOverall.map((h) => h.info.overall)), 1) + ' Ø-Preis=' + round(mean(hires.map((h) => h.price))));
}

console.log('\n=== PHASE 20: Staff Replacement -- wie lange behaelt eine reiche Org einen schwachen Mitarbeiter? ===');
{
  // Fuer jede Org bei S50: Staff-Overall vs. Budget -- reich + durchgehend
  // schwach besetzt (keine Vakanz, aber niedriger Overall) ueber mehrere Checkpoints.
  let persistentWeak = 0, total = 0;
  runs.forEach(({ data }) => {
    const checkpoints = data.staffSnapshots.map((s) => s.season).filter((s) => s >= 20);
    ROLES.forEach((role) => {
      data.setup.allBotNames.forEach((org) => {
        const overalls = checkpoints.map((cp) => {
          const snap = data.staffSnapshots.find((s) => s.season === cp);
          const row = snap.rows.find((r) => r.org === org && r.role === role);
          return row ? row.overall : null;
        }).filter((v) => v !== null);
        if (overalls.length < 2) return;
        total++;
        if (overalls.every((o) => o < 55)) persistentWeak++;
      });
    });
  });
  console.log('n Org-Rolle-Kombinationen mit >=2 spaeten Checkpoints besetzt=' + total + ' durchgehend schwach (<55 Overall, nie ersetzt)=' + persistentWeak + ' (' + round(100 * persistentWeak / total, 2) + '%)');
}
