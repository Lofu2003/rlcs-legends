// Bot Ecosystem V15, Phase 12 (Staff Hiring, alle 7 Rollen) / Phase 13
// (Coach-Refill Root Cause) / Phase 14 (Staff Priority) / Phase 15 (Staff
// Quality vs. Finanzkraft) / Phase 16 (Scout Intelligence).
const { loadRun, round, mean, pearson, findSnap } = require('./v14-lib');

const SEEDS = ['A', 'B', 'C', 'D', 'E'];
const runs = SEEDS.map((s) => ({ seed: s, data: loadRun('_auditv15_V15-BASE-' + s + '.json') }));
const STAFF_ROLES = ['Coach', 'Scout', 'Analyst', 'Psychologe', 'Finanzvorstand', 'PR-Manager', 'Physiotherapeut'];

console.log('=== PHASE 12: Personalvakanz -- Zeit bis Nachbesetzung, ALLE 7 Rollen (STAFF_VACATE/STAFF_DOWNSIZE -> naechste Anstellung derselben Rolle) ===');
{
  STAFF_ROLES.forEach((role) => {
    const gaps = [];
    runs.forEach(({ data }) => {
      const vacates = data.transferLog.filter((t) => t.info && t.info.role === role && t.info.reason === 'STAFF_VACATE');
      const hires = data.transferLog.filter((t) => t.info && t.info.role === role && t.to !== 'Free Agent');
      vacates.forEach((v) => {
        const nextHire = hires.filter((h) => h.to === v.from && h.season >= v.season).sort((a, b) => a.season - b.season)[0];
        if (nextHire) gaps.push(nextHire.season - v.season);
      });
    });
    console.log(role + ': n Vakanzen mit Nachbesetzung=' + gaps.length + ' Ø-Saisons-bis-Nachbesetzung=' + (gaps.length ? round(mean(gaps), 2) : 'n/a'));
  });
}

console.log('\n=== PHASE 13: Coach-Refill Root Cause -- verliert HIRE_STAFF systematisch gegen BUY_PLAYER? ===');
{
  // Hypothese (Code-Lesung scoreBotStaffRecoveryHire()): score ist EIN FESTER
  // Wert (75 fuer Coach, 55 fuer die 6 anderen Rollen) -- steigt NICHT mit der
  // Vakanzdauer. BUY_PLAYER-Score (gain*3*goalMult) kann das dauerhaft
  // uebertreffen, solange noch IRGENDEIN Roster-Upgrade verfuegbar ist.
  let coachVacantDecisions = 0, hireStaffOfferedButLost = 0, noHireStaffOffered = 0;
  const hireScores = [], buyScoresWhenBothPresent = [];
  runs.forEach(({ data }) => {
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY' && d.coachOverall === null).forEach((d) => {
      coachVacantDecisions++;
      const hireOpt = (d.availableOptions || []).find((o) => o.label === 'HIRE_STAFF');
      const buyOpt = (d.availableOptions || []).find((o) => o.label === 'BUY_PLAYER');
      if (!hireOpt) { noHireStaffOffered++; return; }
      hireScores.push(hireOpt.score);
      if (d.chosenLabel !== 'HIRE_STAFF') {
        hireStaffOfferedButLost++;
        if (buyOpt) buyScoresWhenBothPresent.push(buyOpt.score);
      }
    });
  });
  console.log('n Saison-Entscheidungen MIT vakantem Coach=' + coachVacantDecisions);
  console.log('  davon OHNE jede HIRE_STAFF-Option (Kandidatenfunktion lieferte null -- z.B. Pool/Budget-Gate): ' + noHireStaffOffered + ' (' + round(100 * noHireStaffOffered / coachVacantDecisions, 1) + '%)');
  console.log('  davon MIT HIRE_STAFF-Option, aber etwas anderes gewaehlt: ' + hireStaffOfferedButLost + '/' + (coachVacantDecisions - noHireStaffOffered) + ' (' + round(100 * hireStaffOfferedButLost / (coachVacantDecisions - noHireStaffOffered || 1), 1) + '%)');
  console.log('  Ø-HIRE_STAFF-Score wenn angeboten=' + round(mean(hireScores), 2) + ' (Code-Konstante: 75 fuer Coach -- Streuung nur durch Recovery-Kontext-Bonus)');
  console.log('  Ø-Score des tatsaechlichen Gewinners, wenn HIRE_STAFF verlor UND BUY_PLAYER dabei war=' + round(mean(buyScoresWhenBothPresent), 2) + ' (n=' + buyScoresWhenBothPresent.length + ')');
}

console.log('\n=== PHASE 14: Staff Priority -- steigt die HIRE_STAFF-Chance mit der Vakanzdauer? ===');
{
  // Fuer jede Org mit einer Coach-Vakanz: Vakanzdauer (Saisons seit letztem
  // bekannten coachOverall!=null) vs. ob HIRE_STAFF in DIESER Saison gewaehlt wurde.
  const byDurationBucket = { '1': [], '2-3': [], '4-7': [], '8+': [] };
  runs.forEach(({ data }) => {
    const byOrg = {};
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').sort((a, b) => a.season - b.season).forEach((d) => {
      if (!byOrg[d.org]) byOrg[d.org] = { vacantSince: null };
      const st = byOrg[d.org];
      if (d.coachOverall === null) {
        if (st.vacantSince === null) st.vacantSince = d.season;
        const duration = d.season - st.vacantSince + 1;
        const bucket = duration === 1 ? '1' : duration <= 3 ? '2-3' : duration <= 7 ? '4-7' : '8+';
        byDurationBucket[bucket].push(d.chosenLabel === 'HIRE_STAFF');
      } else {
        st.vacantSince = null;
      }
    });
  });
  Object.entries(byDurationBucket).forEach(([b, arr]) => {
    if (!arr.length) { console.log('Vakanzdauer ' + b + ' Saisons: n=0'); return; }
    console.log('Vakanzdauer ' + b + ' Saisons: n=' + arr.length + ' HIRE_STAFF gewaehlt=' + round(100 * arr.filter(Boolean).length / arr.length, 1) + '%');
  });
}

console.log('\n=== PHASE 15: Staff Quality vs. Finanzkraft -- reiche Org mit schwachem Coach? ===');
{
  let cases = 0, total = 0;
  runs.forEach(({ data }) => {
    const snap50 = findSnap(data, data.targetSeasons);
    if (!snap50) return;
    snap50.rows.forEach((r) => {
      if (r.name === data.setup.assignedOrgName || r.coachOverall === null) return;
      total++;
      if (r.budget > 100000000 && r.coachOverall < 60) cases++;
    });
  });
  console.log('n Orgs mit Coach bei Saisonende=' + total + ' -- reich (>100Mio Budget) UND schwacher Coach (<60 Overall): ' + cases + ' (' + round(100 * cases / total, 1) + '%)');
}

console.log('\n=== PHASE 16: Scout Intelligence (Code-Beweis + empirische Zusatzpruefung) ===');
console.log('botPerceivedOverall()/botScoutingNoiseAmplitude() (renderer.js) sind real genutzt an 2');
console.log('Aufrufstellen (Bot-zu-Bot-Kaufbewertung) -- Scout-Overall daempft die Bewertungs-');
console.log('Unsicherheit von +/-12 (kein Scout) auf +/-1 (Elite-Scout). Rein empirisch, gepoolt:');
{
  const scoutOveralls = [], buyRates = [];
  runs.forEach(({ data }) => {
    const lastStaffSnap = data.staffSnapshots[data.staffSnapshots.length - 1];
    if (!lastStaffSnap) return;
    const scoutByOrg = {};
    lastStaffSnap.rows.filter((r) => r.role === 'Scout').forEach((r) => { scoutByOrg[r.org] = r.overall; });
    const buyDecisionsByOrg = {};
    (data.decisionLog || []).filter((d) => d.decisionType === 'SEASONAL_ECONOMY').forEach((d) => {
      if (!buyDecisionsByOrg[d.org]) buyDecisionsByOrg[d.org] = [];
      buyDecisionsByOrg[d.org].push(d.chosenLabel === 'BUY_PLAYER');
    });
    Object.entries(buyDecisionsByOrg).forEach(([org, arr]) => {
      if (arr.length < 5 || !scoutByOrg[org]) return;
      scoutOveralls.push(scoutByOrg[org]);
      buyRates.push(arr.filter(Boolean).length / arr.length);
    });
  });
  console.log('n Orgs mit Scout + >=5 Saison-Entscheidungen=' + scoutOveralls.length + ' Korrelation Scout-Overall<->BUY_PLAYER-Rate=' + pearson(scoutOveralls, buyRates));
}
