// Bot Ecosystem V17, Phase 17 (Duration vs Affordability) / 18 (Chronic
// Vacancy Study) / 19-20 (Coach vs Non-Coach) / 21 (Option Limit) / 22 (Role
// Order Starvation) / 23 (Multi-Vacancy Orgs).
const { loadRun, round, mean } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv17_V17-BASE-' + s + '.json') }));
const ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];

let allEntries = [];
runs.forEach(({ seed, data }) => { (data.staffHireTraceLog || []).forEach((e) => allEntries.push({ ...e, seed })); });

console.log('=== PHASE 17: Vacancy Duration vs. Affordability ===');
{
  const groups = { '0-2': [], '3-5': [], '6-10': [], '11-20': [], '21+': [] };
  allEntries.forEach((e) => {
    const g = e.vacancyDuration <= 2 ? '0-2' : e.vacancyDuration <= 5 ? '3-5' : e.vacancyDuration <= 10 ? '6-10' : e.vacancyDuration <= 20 ? '11-20' : '21+';
    groups[g].push(e);
  });
  Object.entries(groups).forEach(([g, arr]) => {
    if (!arr.length) return;
    const hireOptionRate = round(100 * arr.filter((e) => e.hireStaffCreated).length / arr.length, 1);
    const priorityGateRate = round(100 * arr.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE').length / arr.length, 1);
    console.log(g + ' Saisons (n=' + arr.length + '): Ø-Budget=' + round(mean(arr.map((e) => e.budget))) + ' Ø-PoolGroesse=' + round(mean(arr.map((e) => e.staffPoolSize)), 1) + ' Hire-Option-Rate=' + hireOptionRate + '% ROLE_PRIORITY_GATE-Rate=' + priorityGateRate + '%');
  });
}

console.log('\n=== PHASE 18: Chronic Vacancy Study (Episoden >=10 Saisons) ===');
{
  let chronicEpisodes = [];
  runs.forEach(({ seed, data }) => (data.staffVacancyLog || []).filter((v) => v.duration >= 10).forEach((v) => chronicEpisodes.push({ seed, ...v })));
  console.log('n chronische Episoden (>=10 Saisons)=' + chronicEpisodes.length + ' (Ziel >=500)');
  // Lifecycle-Zusammenfassung fuer die ersten paar Beispiele
  const examples = chronicEpisodes.slice(0, 5).map(({ seed, org, role, startSeason, endSeason }) => {
    const data = runs.find((r) => r.seed === seed).data;
    const lifecycle = [];
    for (let s = startSeason; s <= endSeason; s++) {
      const entry = (data.staffHireTraceLog || []).find((e) => e.org === org && e.role === role && e.season === s);
      lifecycle.push('S' + s + '=' + (entry ? entry.reasonCode : '?'));
    }
    return seed + '/' + org + '/' + role + ' (' + startSeason + '-' + endSeason + '): ' + lifecycle.join(', ');
  });
  console.log('Beispiele:\n  ' + examples.join('\n  '));
  // Aggregierte Reason-Verteilung INNERHALB chronischer Episoden
  const reasonCounts = {};
  let totalYears = 0;
  chronicEpisodes.forEach(({ seed, org, role, startSeason, endSeason }) => {
    const data = runs.find((r) => r.seed === seed).data;
    for (let s = startSeason; s <= endSeason; s++) {
      const entry = (data.staffHireTraceLog || []).find((e) => e.org === org && e.role === role && e.season === s);
      if (entry) { reasonCounts[entry.reasonCode] = (reasonCounts[entry.reasonCode] || 0) + 1; totalYears++; }
    }
  });
  console.log('Reason-Verteilung ueber ALLE Jahre chronischer Episoden (n=' + totalYears + '): ' + JSON.stringify(Object.fromEntries(Object.entries(reasonCounts).map(([k, v]) => [k, round(100 * v / totalYears, 1) + '%']))));
}

console.log('\n=== PHASE 19/20: Coach vs. Non-Coach -- Root Cause Vergleich ===');
{
  const coach = allEntries.filter((e) => e.role === 'Coach');
  const nonCoach = allEntries.filter((e) => e.role !== 'Coach');
  const rate = (arr, reason) => round(100 * arr.filter((e) => e.reasonCode === reason).length / arr.length, 1);
  ['ROLE_PRIORITY_GATE', 'MARKET_EMPTY', 'BUDGET_GATE', 'RESERVE_GATE', 'NO_AFFORDABLE_CANDIDATE'].forEach((reason) => {
    console.log('  ' + reason + ': Coach=' + rate(coach, reason) + '% NonCoach=' + rate(nonCoach, reason) + '%');
  });
}

console.log('\n=== PHASE 21: Option Limit -- direkt = ROLE_PRIORITY_GATE-Anteil (bereits oben quantifiziert) ===');
{
  const rate = round(100 * allEntries.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE').length / allEntries.length, 1);
  console.log('ROLE_PRIORITY_GATE-Anteil an ALLEN Vacancy-Decision-Events: ' + rate + '%');
}

console.log('\n=== PHASE 22: Role Order Starvation -- blockiert vakanter Coach andere Rollen? ===');
{
  // Fuer Org-Saison-Kombinationen mit Coach UND mind. 1 weiterer Rolle vakant:
  // wie oft ist die NICHT-Coach-Rolle ROLE_PRIORITY_GATE (Coach gewinnt immer)?
  const byOrgSeason = {};
  allEntries.forEach((e) => { const key = e.seed + '::' + e.org + '::' + e.season; (byOrgSeason[key] = byOrgSeason[key] || []).push(e); });
  let coachVacantMultiRole = 0, nonCoachStarvedWhenCoachVacant = 0;
  let coachFilledMultiRole = 0, nonCoachStarvedWhenCoachFilled = 0;
  Object.values(byOrgSeason).forEach((entries) => {
    const coachEntry = entries.find((e) => e.role === 'Coach');
    const nonCoachEntries = entries.filter((e) => e.role !== 'Coach');
    if (nonCoachEntries.length === 0) return;
    if (coachEntry) {
      coachVacantMultiRole += nonCoachEntries.length;
      nonCoachStarvedWhenCoachVacant += nonCoachEntries.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE').length;
    } else {
      coachFilledMultiRole += nonCoachEntries.length;
      nonCoachStarvedWhenCoachFilled += nonCoachEntries.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE').length;
    }
  });
  console.log('Nicht-Coach-Rolle ROLE_PRIORITY_GATE-Rate WENN Coach GLEICHZEITIG vakant: ' + round(100 * nonCoachStarvedWhenCoachVacant / coachVacantMultiRole, 1) + '% (n=' + coachVacantMultiRole + ')');
  console.log('Nicht-Coach-Rolle ROLE_PRIORITY_GATE-Rate WENN Coach besetzt: ' + round(100 * nonCoachStarvedWhenCoachFilled / coachFilledMultiRole, 1) + '% (n=' + coachFilledMultiRole + ')');
}

console.log('\n=== PHASE 23: Multi-Vacancy Orgs -- Vakanzanzahl vs. Dauer/Starvation ===');
{
  const byOrgSeason = {};
  allEntries.forEach((e) => { const key = e.seed + '::' + e.org + '::' + e.season; (byOrgSeason[key] = byOrgSeason[key] || []).push(e); });
  const byCount = { '1': [], '2': [], '3': [], '4+': [] };
  Object.values(byOrgSeason).forEach((entries) => {
    const n = entries.length;
    const g = n === 1 ? '1' : n === 2 ? '2' : n === 3 ? '3' : '4+';
    entries.forEach((e) => byCount[g].push(e));
  });
  Object.entries(byCount).forEach(([g, arr]) => {
    if (!arr.length) return;
    console.log('Gleichzeitige Vakanzen=' + g + ' (n Events=' + arr.length + '): Ø-Dauer=' + round(mean(arr.map((e) => e.vacancyDuration)), 1) + ' ROLE_PRIORITY_GATE-Rate=' + round(100 * arr.filter((e) => e.reasonCode === 'ROLE_PRIORITY_GATE').length / arr.length, 1) + '% Hire-Rate=' + round(100 * arr.filter((e) => e.hireStaffCreated).length / arr.length, 1) + '%');
  });
}
