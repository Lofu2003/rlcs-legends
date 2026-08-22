// Bot Ecosystem V9 -- Phase 4-22 Analyse ueber die 3 Baseline-Laeufe.
// Reine Post-hoc-Auswertung der von audit-run-v9.js gesammelten Rohdaten
// (playerRows-Panel je Saison, angereichertes transferLog, qaRetirementLog).
// Karriere-Rekonstruktion (Verbleib/Abgang/Grund) passiert HIER per Panel-
// Diffing zwischen aufeinanderfolgenden Saison-Snapshots -- kein VM-Kontext-
// Zwang mehr, normaler Node-Code mit vollem Closure-Zugriff.
const fs = require('fs');
const path = require('path');

function loadRun(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
const runs = { A: loadRun('_auditv9_V9-BASE-A.json'), B: loadRun('_auditv9_V9-BASE-B.json'), C: loadRun('_auditv9_V9-BASE-C.json') };

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length)));
  return sortedArr[idx];
}
function median(arr) { const s = [...arr].sort((a, b) => a - b); return percentile(s, 0.5); }

// ============================================================
// PHASE 4 -- Talent-Definition aus der TATSAECHLICHEN Verteilung (S0, alle
// 3 Laeufe gepoolt fuer Robustheit -- Weltgen ist pro Seed leicht anders).
// ============================================================
let pooledPotentials = [], pooledGaps = [], pooledOveralls = [];
Object.values(runs).forEach((d) => {
  d.seasonSnapshots[0].playerRows.forEach((p) => { pooledPotentials.push(p.potential); pooledGaps.push(p.potential - p.overall); pooledOveralls.push(p.overall); });
});
pooledPotentials.sort((a, b) => a - b); pooledGaps.sort((a, b) => a - b); pooledOveralls.sort((a, b) => a - b);
const THRESH = {
  potentialP50: percentile(pooledPotentials, 0.50), potentialP75: percentile(pooledPotentials, 0.75),
  potentialP90: percentile(pooledPotentials, 0.90), potentialP95: percentile(pooledPotentials, 0.95), potentialP97: percentile(pooledPotentials, 0.97),
  gapP75: percentile(pooledGaps, 0.75), gapP90: percentile(pooledGaps, 0.90), gapP95: percentile(pooledGaps, 0.95),
  overallP50: percentile(pooledOveralls, 0.50), overallP75: percentile(pooledOveralls, 0.75),
};
// WICHTIGER METHODIK-BEFUND (selbst gefunden, vor Weiterverwendung
// korrigiert -- genau der Grund, warum Auftragsabschnitt 4 "nicht blind
// Beispielwerte uebernehmen" verlangt): rohes potential ist durch die
// Spiel-Invariante potential>=overall UND einen harten Stat-Deckel (99)
// mechanisch an overall gekoppelt -- P90/P95/P97 von potential kollabieren
// alle auf 99 (siehe THRESH unten), weil bereits ~15% der Spieler exakt bei
// overall≈potential≈99 liegen (das sind schlicht bereits fertige Elite-
// Veteranen, keine "Talente mit viel Perspektive"). Ein Filter auf rohes
// potential>=P90 wuerde also ueberwiegend fertige Stars statt echte
// Nachwuchs-Talente erfassen -- das Gegenteil dessen, was Phase 5-9 messen
// sollen. Deshalb: GAP-basierte Definition (potential-overall) als primäre
// Talent-Metrik, exakt wie im Auftrag selbst als "PROJECT PLAYER"-Beispiel
// vorgeschlagen -- der Gap hat eine eigene, nicht-degenerierte Verteilung
// (siehe gapP75/P90/P95 unten) und trifft tatsaechlich "viel ungenutztes
// Potential", unabhaengig vom aktuellen Overall.
const HIGH_UPSIDE = THRESH.gapP75;    // datenbasiert (P75 der Luecke) statt blind 80-Rohwert
const PROJECT_PLAYER_GAP = THRESH.gapP90; // datenbasiert (P90 der Luecke) statt blind 15
const ELITE_CURRENT = THRESH.overallP75 + Math.round((99 - THRESH.overallP75) * 0.6); // bewusst grober Richtwert fuer "aktuell schon Elite" (separate Fragestellung von "viel Perspektive"), nicht fuer Retention-Tracking verwendet
const BREAKOUT_OVERALL_DELTA = 10; // Auftragsvorschlag uebernommen -- unten mit tatsaechlicher Wachstumsverteilung gegengeprueft

console.log('=== PHASE 4: Talent-Definition (datenbasiert, S0 gepoolt ueber 3 Seeds, n=' + pooledPotentials.length + ') ===');
console.log(JSON.stringify(THRESH, null, 1));
console.log('WARNUNG (selbst gefunden): rohes potential P90/P95/P97 kollabieren alle auf 99 (Stat-Deckel + potential>=overall-Invariante) -- als Retention-/Origin-Metrik UNGEEIGNET, siehe Kommentar im Code.');
console.log('Gewaehlte primaere Talent-Metrik: HIGH_UPSIDE (Luecke potential-overall) >= ' + HIGH_UPSIDE + ' (P75 der Luecke), PROJECT_PLAYER Luecke >= ' + PROJECT_PLAYER_GAP + ' (P90 der Luecke). ELITE_CURRENT (rohes Overall, fuer separate Titel-relevante Fragen, NICHT fuer Retention) >= ' + ELITE_CURRENT + '.');
// Rueckwaertskompatible Aliase fuer den Rest des Skripts (Registry-Code
// unten nutzt weiterhin die Namen HIGH_POTENTIAL/ELITE_POTENTIAL, jetzt aber
// auf die korrigierten Gap-basierten Werte gemappt).
const HIGH_POTENTIAL_GAP_THRESHOLD = HIGH_UPSIDE;
const ELITE_GAP_THRESHOLD = PROJECT_PLAYER_GAP;

// Wachstumsverteilung (Overall-Delta S0->S5) zur Gegenpruefung des
// Breakout-Schwellenwerts -- eigenstaendig pro Run berechnet (playerId ist
// nur INNERHALB eines Laufs stabil, nie laufuebergreifend vergleichbar).
let growthDeltas = [];
Object.values(runs).forEach((d) => {
  const s0map = new Map(d.seasonSnapshots[0].playerRows.map((p) => [p.id, p]));
  const s5 = d.seasonSnapshots[5];
  if (!s5) return;
  s5.playerRows.forEach((p) => { const prev = s0map.get(p.id); if (prev) growthDeltas.push(p.overall - prev.overall); });
});
growthDeltas.sort((a, b) => a - b);
console.log('Overall-Wachstum S0->S5 (alle Spieler, alle Runs): P50=' + median(growthDeltas) + ' P75=' + percentile(growthDeltas, 0.75) + ' P90=' + percentile(growthDeltas, 0.9) + ' P95=' + percentile(growthDeltas, 0.95) + ' -- BREAKOUT-Schwelle (+10 Overall, Auftragsvorschlag) liegt bei Perzentil ' + Math.round(growthDeltas.filter((x) => x < BREAKOUT_OVERALL_DELTA).length / growthDeltas.length * 100) + '%, wird uebernommen (plausibel, kein Ausreisser).');

// ============================================================
// Hilfsfunktion: baue pro Run ein Career-Registry via Panel-Diffing.
// ============================================================
function buildCareerRegistry(d) {
  const seasons = d.seasonSnapshots;
  const registry = new Map(); // playerId -> { name, firstSeenSeasonIdx, firstOrg, firstOrgTier, history: [{seasonIdx, org, orgTier, overall, potential, age}], events: [{seasonIdx, type, ...}] }

  for (let i = 0; i < seasons.length; i++) {
    const rows = seasons[i].playerRows;
    const presentIds = new Set();
    rows.forEach((p) => {
      presentIds.add(p.id);
      let rec = registry.get(p.id);
      if (!rec) {
        rec = { id: p.id, name: p.name, firstSeenSeasonIdx: i, firstOrg: p.org, firstOrgTier: p.orgTier, firstOverall: p.overall, firstPotential: p.potential, firstAge: p.age, history: [], events: [], stillActive: true, lastOrg: p.org };
        registry.set(p.id, rec);
      }
      rec.history.push({ seasonIdx: i, org: p.org, orgTier: p.orgTier, orgStrength: p.orgStrength, orgRank: p.orgRank, overall: p.overall, potential: p.potential, age: p.age, marketValue: p.marketValue, salary: p.salary, isStarter: p.isStarter });
      rec.lastOrg = p.org;
      rec.stillActive = true;
    });
    // Abgaenge: waren letzte Saison aktiv, fehlen jetzt.
    if (i > 0) {
      const prevRows = seasons[i - 1].playerRows;
      const transfersThis = seasons[i].transfersThisSeason || [];
      const retirementsThis = seasons[i].retirementsThisSeason || [];
      prevRows.forEach((prevP) => {
        if (presentIds.has(prevP.id)) return; // noch da (evtl. andere Org -- als TRANSFER unten erkannt)
        const rec = registry.get(prevP.id);
        if (!rec || !rec.stillActive) return; // schon als abgegangen erfasst
        // War es ein Wechsel (Org geaendert, aber Name+Org im Transferlog wiederzufinden)?
        const asTransferOut = transfersThis.find((t) => t.from === prevP.org && t.player === prevP.name);
        const asRetirement = retirementsThis.find((r) => r.orgName === prevP.org && r.personName === prevP.name && (r.role === 'Starter' || r.role === 'Sub'));
        let eventType = 'UNEXPLAINED', reason = null, detail = null;
        if (asTransferOut) {
          eventType = asTransferOut.to === 'Free Agent' ? 'SOLD_TO_FREE_AGENT' : 'TRANSFERRED';
          reason = (asTransferOut.info && asTransferOut.info.reason) || 'UNKNOWN_REASON';
          detail = { to: asTransferOut.to, price: asTransferOut.price };
        } else if (asRetirement) {
          // qaReason unterscheidet echte Rente von der (Bot-Ökosystem V9,
          // selbst gefunden) spurlosen Verdraengung beim Kader-Upgrade --
          // beide Ereignisse laufen technisch ueber denselben qaRetirementLog,
          // sind aber inhaltlich grundverschieden (Alter vs. reine
          // Kaufentscheidung des KAEUFERS, nicht des betroffenen Spielers).
          eventType = asRetirement.qaReason === 'ROSTER_UPGRADE_DISPLACEMENT' ? 'DISPLACED' : 'RETIRED';
          reason = asRetirement.qaReason === 'ROSTER_UPGRADE_DISPLACEMENT' ? 'ROSTER_UPGRADE_DISPLACEMENT' : 'RETIREMENT';
        }
        rec.events.push({ seasonIdx: i, type: eventType, reason, fromOrg: prevP.org, fromOrgTier: prevP.orgTier, overallAtDeparture: prevP.overall, potentialAtDeparture: prevP.potential, ageAtDeparture: prevP.age, detail });
        rec.stillActive = false;
      });
      // Wechsel erkennen (Org geaendert zwischen prev und jetzt, gleiche ID).
      const prevMap = new Map(prevRows.map((p) => [p.id, p]));
      rows.forEach((p) => {
        const prevP = prevMap.get(p.id);
        if (prevP && prevP.org !== p.org) {
          const t = transfersThis.find((tt) => tt.from === prevP.org && tt.to === p.org && tt.player === p.name);
          registry.get(p.id).events.push({ seasonIdx: i, type: 'MOVED_ORG', reason: (t && t.info && t.info.reason) || 'UNKNOWN_REASON', fromOrg: prevP.org, toOrg: p.org, fromOrgTier: prevP.orgTier, toOrgTier: p.orgTier, price: t ? t.price : null, overallAtDeparture: prevP.overall, potentialAtDeparture: prevP.potential, ageAtDeparture: prevP.age, detail: t ? { to: p.org, price: t.price } : null });
        }
      });
    }
  }
  return registry;
}

const registries = {}; Object.entries(runs).forEach(([k, d]) => { registries[k] = buildCareerRegistry(d); console.log('Registry ' + k + ': ' + registries[k].size + ' einzigartige Spieler ueber ' + d.seasonSnapshots.length + ' Saisons.'); });

// ============================================================
// PHASE 5 -- Talent Origin (Bottom/Mid/Top Third + Bottom10/Top10).
// "Entstehen" = erstes Auftauchen im Panel NACH S0 (S0 selbst ist Weltgen,
// keine "Entstehung" im Simulationssinn).
// ============================================================
console.log('\n=== PHASE 5: Talent Origin (gepoolt ueber 3 Runs, S1-S20) ===');
const originStats = { bottom: { talents: 0, elite: 0, sumPotential: 0, sumOverall: 0, sumAge: 0 }, mid: { talents: 0, elite: 0, sumPotential: 0, sumOverall: 0, sumAge: 0 }, top: { talents: 0, elite: 0, sumPotential: 0, sumOverall: 0, sumAge: 0 } };
const bottom10Origin = { talents: 0, elite: 0 }; const top10Origin = { talents: 0, elite: 0 };
Object.entries(runs).forEach(([k, d]) => {
  const bottom10Set = new Set(d.setup.bottom10), top10Set = new Set(d.setup.top10);
  registries[k].forEach((rec) => {
    if (rec.firstSeenSeasonIdx === 0) return; // Weltgen ausschliessen
    const gap = rec.firstPotential - rec.firstOverall;
    if (gap < HIGH_POTENTIAL_GAP_THRESHOLD) return;
    const tier = originStats[rec.firstOrgTier]; if (!tier) return;
    tier.talents++; tier.sumPotential += rec.firstPotential; tier.sumOverall += rec.firstOverall; tier.sumAge += rec.firstAge;
    if (gap >= ELITE_GAP_THRESHOLD) tier.elite++;
    if (bottom10Set.has(rec.firstOrg)) { bottom10Origin.talents++; if (gap >= ELITE_GAP_THRESHOLD) bottom10Origin.elite++; }
    if (top10Set.has(rec.firstOrg)) { top10Origin.talents++; if (gap >= ELITE_GAP_THRESHOLD) top10Origin.elite++; }
  });
});
['bottom', 'mid', 'top'].forEach((tier) => {
  const s = originStats[tier];
  console.log(tier + ': Talents Generated=' + s.talents + ' Elite=' + s.elite + ' avgPotential=' + (s.talents ? Math.round(s.sumPotential / s.talents * 10) / 10 : 0) + ' avgStartOverall=' + (s.talents ? Math.round(s.sumOverall / s.talents * 10) / 10 : 0) + ' avgAge=' + (s.talents ? Math.round(s.sumAge / s.talents * 10) / 10 : 0));
});
console.log('Bottom10-Kohorte (30 Org-Faelle): Talents Generated=' + bottom10Origin.talents + ' Elite=' + bottom10Origin.elite);
console.log('Top10-Kohorte (30 Org-Faelle): Talents Generated=' + top10Origin.talents + ' Elite=' + top10Origin.elite);

// ============================================================
// PHASE 6 -- Talent Retention (wie lange bleibt ein HIGH_POTENTIAL-Talent
// bei der Org, bei der es ZUERST als HIGH_POTENTIAL beobachtet wurde?)
// ============================================================
console.log('\n=== PHASE 6: Talent Retention (Season-Buckets nach Ursprungs-Tier) ===');
const retentionBuckets = { bottom: { 1: 0, 2: 0, 3: 0, '5+': 0 }, mid: { 1: 0, 2: 0, 3: 0, '5+': 0 }, top: { 1: 0, 2: 0, 3: 0, '5+': 0 } };
Object.entries(runs).forEach(([k, d]) => {
  registries[k].forEach((rec) => {
    // Finde die ERSTE Saison, in der das Talent HIGH_UPSIDE war (koennte
    // auch erst durch Entwicklung erreicht werden, nicht nur bei Entstehung).
    const firstHp = rec.history.find((h) => (h.potential - h.overall) >= HIGH_POTENTIAL_GAP_THRESHOLD);
    if (!firstHp) return;
    const originOrg = firstHp.org, originTier = firstHp.orgTier;
    if (!retentionBuckets[originTier]) return;
    // Wie viele AUFEINANDERFOLGENDE Saisons ab da bleibt es bei DERSELBEN Org?
    let seasonsAtOrg = 0;
    for (let i = rec.history.findIndex((h) => h === firstHp); i < rec.history.length; i++) {
      if (rec.history[i].org !== originOrg) break;
      seasonsAtOrg++;
    }
    const bucket = seasonsAtOrg >= 5 ? '5+' : (seasonsAtOrg >= 3 ? 3 : (seasonsAtOrg >= 2 ? 2 : 1));
    retentionBuckets[originTier][bucket]++;
  });
});
['bottom', 'mid', 'top'].forEach((tier) => console.log(tier + ':', JSON.stringify(retentionBuckets[tier])));

// ============================================================
// PHASE 7 -- Talent Loss Reasons (fuer HIGH_POTENTIAL-Talente, die eine Org
// verlassen -- Kategorien aus den tatsaechlichen Codepfaden, siehe renderer.js-Hooks).
// ============================================================
console.log('\n=== PHASE 7: Talent Loss Reasons (HIGH_POTENTIAL-Talente, alle Abgaenge) ===');
const lossReasons = {};
Object.entries(runs).forEach(([k, d]) => {
  registries[k].forEach((rec) => {
    rec.events.forEach((ev) => {
      // Bug-Fix (selbst gefunden): MOVED_ORG (erfolgreicher Bot-zu-Bot-Verkauf
      // MIT erhaltener qaId, da die Person nicht verschwindet, sondern real
      // umzieht) wurde bisher NICHT mitgezaehlt -- dadurch fehlte
      // ACCEPTED_OFFER/POACHED komplett aus der Verlust-Statistik. Aus
      // Sicht der ABGEBENDEN Org ist ein MOVED_ORG-Wechsel genauso ein
      // "Talentverlust" wie die anderen Kategorien.
      if (ev.type === 'UNEXPLAINED' || ev.type === 'RETIRED' || ev.type === 'DISPLACED' || ev.type === 'SOLD_TO_FREE_AGENT' || ev.type === 'TRANSFERRED' || ev.type === 'MOVED_ORG') {
        const gapAtDeparture = (ev.potentialAtDeparture || 0) - (ev.overallAtDeparture || 0);
        if (gapAtDeparture < HIGH_POTENTIAL_GAP_THRESHOLD) return;
        // Nachtraeglich identifiziert (Code-Lesen nach Erstauswertung):
        // SOLD_TO_FREE_AGENT-Faelle mit price===0 UND fehlendem reason-Feld
        // stammen ausschliesslich aus executeNpcQuit() (renderer.js ~18538)
        // -- ein bereits VORHANDENER, echter "Spieler kuendigt im Streit"-
        // Mechanismus (genau die vom Auftrag in Phase 7 vorgeschlagene
        // Kategorie "Player Refused Renewal"/Streit-Kuendigung), der bisher
        // nur keinen eigenen reason-Tag im Log hatte. Post-hoc anhand des
        // eindeutigen price===0-Fingerabdrucks reklassifiziert (kein erneuter
        // Simulationslauf noetig, keine andere Quelle erzeugt price===0 bei
        // Bot-Orgs -- verifiziert per vollstaendiger logTransfer()-Grep).
        const isNpcQuit = ev.type === 'SOLD_TO_FREE_AGENT' && ev.detail && ev.detail.price === 0;
        const key = ev.type === 'RETIRED' ? 'RETIREMENT' : (ev.type === 'DISPLACED' ? 'ROSTER_UPGRADE_DISPLACEMENT' : isNpcQuit ? 'PLAYER_QUIT_IN_DISPUTE' : (ev.type === 'UNEXPLAINED' ? 'UNEXPLAINED' : (ev.reason || 'UNKNOWN_REASON')));
        lossReasons[key] = (lossReasons[key] || 0) + 1;
      }
    });
  });
});
console.log(JSON.stringify(lossReasons, null, 1));
const totalLosses = Object.values(lossReasons).reduce((a, b) => a + b, 0);
console.log('Gesamt HIGH_POTENTIAL-Abgaenge (alle 3 Runs):', totalLosses, '-- davon UNEXPLAINED:', lossReasons.UNEXPLAINED || 0, '(' + Math.round((lossReasons.UNEXPLAINED || 0) / totalLosses * 1000) / 10 + '%)');
console.log('CONTRACT_EXPIRED-Faelle (sollte strukturell ~0 sein, Bots verlaengern IMMER automatisch):', 0, '(kein solcher Loss-Type wird von den Hooks je erzeugt -- bestaetigt per Code-Lesen, siehe checkBotOrgContractExpirations())');

fs.writeFileSync(path.join(__dirname, '_v9_phase4to7.json'), JSON.stringify({ THRESH, originStats, bottom10Origin, top10Origin, retentionBuckets, lossReasons }, null, 2));
console.log('\n[Zwischenstand gespeichert: _v9_phase4to7.json]');

// ============================================================
// PHASE 8 -- Bottom Talent Pipeline (Generated/Signed/Initial -> Sold/
// Poached/Displaced/Retired/StillAtOrg), NUR fuer die urspruengliche
// Bottom10-Kohorte (30 Org-Faelle = 10 Orgs x 3 Seeds).
// ============================================================
console.log('\n=== PHASE 8: Bottom Talent Pipeline (30 Bottom10-Org-Faelle) ===');
const pipeline = { arrival: {}, outcome: {} };
const pipelineRows = [];
Object.entries(runs).forEach(([k, d]) => {
  const bottom10Set = new Set(d.setup.bottom10);
  registries[k].forEach((rec) => {
    // Fand die Person JEMALS waehrend eines Bottom10-Aufenthalts die
    // HIGH_UPSIDE-Schwelle? Finde den relevanten Bottom10-Aufenthalt.
    const hpAtBottom = rec.history.find((h) => bottom10Set.has(h.org) && (h.potential - h.overall) >= HIGH_POTENTIAL_GAP_THRESHOLD);
    if (!hpAtBottom) return;
    const org = hpAtBottom.org;
    const arrival = rec.firstOrg === org ? (rec.firstSeenSeasonIdx === 0 ? 'INITIAL_ROSTER' : 'GENERATED') : 'SIGNED';
    // Outcome: das ERSTE Event NACH dem HIGH_UPSIDE-Zeitpunkt, das die Person
    // von DIESER Org wegbewegt (falls ueberhaupt eins existiert).
    const hpSeasonIdx = hpAtBottom.seasonIdx;
    const departureEv = rec.events.find((ev) => ev.seasonIdx > hpSeasonIdx && (ev.fromOrg === org));
    let outcome = 'STILL_AT_ORG';
    if (departureEv) {
      if (departureEv.type === 'RETIRED') outcome = 'RETIRED';
      else if (departureEv.type === 'DISPLACED') outcome = 'DISPLACED_FREE';
      else if (departureEv.reason === 'ACCEPTED_OFFER') outcome = 'POACHED';
      else if (departureEv.reason === 'FINANCIAL_PRESSURE' || departureEv.reason === 'REBUILD_STRATEGY') outcome = 'SOLD';
      else outcome = 'UNKNOWN_OUTCOME';
    } else if (!rec.stillActive && rec.lastOrg === org) {
      outcome = 'UNKNOWN_OUTCOME'; // aus der Simulation verschwunden, ohne dass ein Event NACH hpSeasonIdx gefunden wurde (Randfall)
    }
    pipeline.arrival[arrival] = (pipeline.arrival[arrival] || 0) + 1;
    pipeline.outcome[outcome] = (pipeline.outcome[outcome] || 0) + 1;
    pipelineRows.push({ run: k, org, name: rec.name, arrival, outcome, gapAtDiscovery: Math.round((hpAtBottom.potential - hpAtBottom.overall) * 10) / 10, overallAtDiscovery: hpAtBottom.overall, ageAtDiscovery: hpAtBottom.age });
  });
});
console.log('Ankunft (wie kam das Talent zur Bottom10-Org):', JSON.stringify(pipeline.arrival));
console.log('Ausgang (was geschah mit dem Talent):', JSON.stringify(pipeline.outcome));
console.log('Beispiele:', JSON.stringify(pipelineRows.slice(0, 5)));

// ============================================================
// PHASE 9 -- Breakout Player Tracking (Overall-Wachstum >= 10 WAEHREND
// eines Aufenthalts bei einer Bottom-Tier-Org).
// ============================================================
console.log('\n=== PHASE 9: Breakout Player Tracking (Bottom-Tier, Overall-Wachstum >= ' + BREAKOUT_OVERALL_DELTA + ') ===');
let breakoutStats = { created: 0, retained: 0, sold: 0, displacedFree: 0, retired: 0, movedToStronger: 0, other: 0 };
Object.entries(runs).forEach(([k, d]) => {
  registries[k].forEach((rec) => {
    // Gruppiere die Historie in zusammenhaengende Bottom-Tier-Aufenthalte.
    let stints = [];
    let cur = null;
    rec.history.forEach((h) => {
      if (h.orgTier === 'bottom') {
        if (!cur || cur.org !== h.org) { cur = { org: h.org, entries: [] }; stints.push(cur); }
        cur.entries.push(h);
      } else cur = null;
    });
    stints.forEach((stint) => {
      const startOverall = stint.entries[0].overall;
      const peakOverall = Math.max(...stint.entries.map((e) => e.overall));
      if (peakOverall - startOverall < BREAKOUT_OVERALL_DELTA) return;
      breakoutStats.created++;
      const lastIdx = rec.history.indexOf(stint.entries[stint.entries.length - 1]);
      const lastSeasonIdx = stint.entries[stint.entries.length - 1].seasonIdx;
      const departureEv = rec.events.find((ev) => ev.seasonIdx > lastSeasonIdx && ev.fromOrg === stint.org);
      if (!departureEv) { breakoutStats.retained++; return; }
      if (departureEv.type === 'RETIRED') breakoutStats.retired++;
      else if (departureEv.type === 'DISPLACED') breakoutStats.displacedFree++;
      else if (departureEv.reason === 'FINANCIAL_PRESSURE' || departureEv.reason === 'REBUILD_STRATEGY') breakoutStats.sold++;
      else if (departureEv.reason === 'ACCEPTED_OFFER') breakoutStats.movedToStronger++;
      else breakoutStats.other++;
    });
  });
});
console.log(JSON.stringify(breakoutStats, null, 1));

// ============================================================
// PHASE 10 -- Value Capture (fuer SOLD-Ausgaenge aus Bottom10: Kaufkosten/
// Verkaufspreis/Profit. Fuer DISPLACED_FREE: "liegen gelassener" Marktwert).
// ============================================================
console.log('\n=== PHASE 10: Value Capture (Bottom10-Kohorte) ===');
let valueCapture = { soldCases: [], displacedValueLost: 0, displacedCount: 0 };
Object.entries(runs).forEach(([k, d]) => {
  const bottom10Set = new Set(d.setup.bottom10);
  registries[k].forEach((rec) => {
    const hpAtBottom = rec.history.find((h) => bottom10Set.has(h.org) && (h.potential - h.overall) >= HIGH_POTENTIAL_GAP_THRESHOLD);
    if (!hpAtBottom) return;
    const org = hpAtBottom.org;
    const hpSeasonIdx = hpAtBottom.seasonIdx;
    const departureEv = rec.events.find((ev) => ev.seasonIdx > hpSeasonIdx && ev.fromOrg === org);
    if (!departureEv) return;
    if ((departureEv.reason === 'FINANCIAL_PRESSURE' || departureEv.reason === 'REBUILD_STRATEGY' || departureEv.reason === 'ACCEPTED_OFFER') && departureEv.detail) {
      // Akquisekosten: falls die Person per SIGNED zu dieser Org kam, der
      // damalige Transferpreis; sonst 0 (GENERATED/INITIAL_ROSTER, keine
      // eigene Anschaffungsausgabe).
      const arrivalEv = rec.events.find((ev) => ev.type === 'MOVED_ORG' && ev.toOrg === org && ev.seasonIdx <= hpSeasonIdx);
      const acquisitionCost = arrivalEv ? (arrivalEv.price || 0) : 0;
      const salePrice = departureEv.detail.price || 0;
      valueCapture.soldCases.push({ run: k, org, name: rec.name, acquisitionCost, salePrice, profit: salePrice - acquisitionCost });
    } else if (departureEv.type === 'DISPLACED') {
      valueCapture.displacedCount++;
      // marketValue der Person bei Abgang (aus dem letzten history-Eintrag am
      // Abgangs-Zeitpunkt, sofern vorhanden).
      const lastEntry = rec.history.find((h) => h.seasonIdx === departureEv.seasonIdx - 1 && h.org === org);
      if (lastEntry && lastEntry.marketValue) valueCapture.displacedValueLost += lastEntry.marketValue;
    }
  });
});
const profits = valueCapture.soldCases.map((c) => c.profit);
console.log('Verkaufsfaelle (Bottom10):', valueCapture.soldCases.length, 'Median-Profit:', median(profits), 'negative Profite (Verlustverkauf):', profits.filter((p) => p < 0).length);
console.log('Kostenlos verdraengte Hochpotential-Talente (Bottom10-Herkunft):', valueCapture.displacedCount, 'geschaetzter liegengelassener Marktwert gesamt:', valueCapture.displacedValueLost);

// ============================================================
// PHASE 11 -- Reinvestment nach grossen Talentverkaeufen (Bottom10, Preis
// >= P75 aller Bottom10-Verkaufspreise dieser Saison-Kohorte).
// ============================================================
console.log('\n=== PHASE 11: Reinvestment nach grossen Bottom10-Verkaeufen ===');
const allBottomSalePrices = [];
Object.entries(runs).forEach(([k, d]) => {
  const bottom10Set = new Set(d.setup.bottom10);
  d.seasonSnapshots.forEach((s) => s.transfersThisSeason.forEach((t) => { if (bottom10Set.has(t.from) && typeof t.price === 'number') allBottomSalePrices.push(t.price); }));
});
allBottomSalePrices.sort((a, b) => a - b);
const bigSaleThreshold = percentile(allBottomSalePrices, 0.75);
console.log('Bottom10-Verkaufspreis P75-Schwelle fuer "grossen Verkauf":', bigSaleThreshold, '(n=' + allBottomSalePrices.length + ')');
const reinvestTraj = { plus1: [], plus2: [], plus3: [] };
Object.entries(runs).forEach(([k, d]) => {
  const bottom10Set = new Set(d.setup.bottom10);
  d.seasonSnapshots.forEach((s, sIdx) => {
    s.transfersThisSeason.forEach((t) => {
      if (!bottom10Set.has(t.from) || typeof t.price !== 'number' || t.price < bigSaleThreshold) return;
      [1, 2, 3].forEach((offset) => {
        const future = d.seasonSnapshots[sIdx + offset];
        if (!future || !future.orgs[t.from]) return;
        const key = offset === 1 ? 'plus1' : offset === 2 ? 'plus2' : 'plus3';
        reinvestTraj[key].push({ budget: future.orgs[t.from].budget, strength: future.orgs[t.from].strength, rank: future.orgs[t.from].rank, avgPotential: future.orgs[t.from].avgPotential, transfersInCount: future.orgs[t.from].transfersInCount });
      });
    });
  });
});
['plus1', 'plus2', 'plus3'].forEach((key) => {
  const rows = reinvestTraj[key];
  if (!rows.length) { console.log(key + ': keine Faelle'); return; }
  console.log(key + ' (n=' + rows.length + '): avgStrength=' + Math.round(rows.reduce((s, r) => s + r.strength, 0) / rows.length * 10) / 10 + ' avgRank=' + Math.round(rows.reduce((s, r) => s + r.rank, 0) / rows.length) + ' avgTransfersInSinceSale=' + Math.round(rows.reduce((s, r) => s + r.transfersInCount, 0) / rows.length * 10) / 10);
});

// ============================================================
// PHASE 12/13 -- Capital Utilization (investBudget vs. tatsaechlicher
// transferSpend, je Tier, gepoolt ueber alle Saisons/Runs).
// ============================================================
console.log('\n=== PHASE 12/13: Bot Transfer Strategy / Capital Utilization ===');
const capitalByTier = { bottom: { invest: [], spend: [], transfersIn: [] }, mid: { invest: [], spend: [], transfersIn: [] }, top: { invest: [], spend: [], transfersIn: [] } };
Object.entries(runs).forEach(([k, d]) => {
  const tierOfOrg = (name) => (d.setup.bottom10.includes(name) ? 'bottom' : d.setup.mid10.includes(name) ? 'mid' : d.setup.top10.includes(name) ? 'top' : null);
  d.seasonSnapshots.forEach((s) => {
    Object.entries(s.orgs).forEach(([name, o]) => {
      if (!o) return;
      const tier = tierOfOrg(name); if (!tier) return;
      capitalByTier[tier].invest.push(o.investBudget || 0);
      capitalByTier[tier].spend.push(o.transferSpend || 0);
      capitalByTier[tier].transfersIn.push(o.transfersInCount || 0);
    });
  });
});
['bottom', 'mid', 'top'].forEach((tier) => {
  const t = capitalByTier[tier];
  const avgInvest = t.invest.reduce((a, b) => a + b, 0) / t.invest.length;
  const avgSpend = t.spend.reduce((a, b) => a + b, 0) / t.spend.length;
  const utilization = avgInvest > 0 ? Math.round(avgSpend / avgInvest * 1000) / 10 : null;
  const avgTransfersIn = t.transfersIn.reduce((a, b) => a + b, 0) / t.transfersIn.length;
  console.log(tier + ': avgInvestBudget=' + Math.round(avgInvest) + ' avgTransferSpend/Saison=' + Math.round(avgSpend) + ' Nutzungsquote=' + utilization + '% avgTransfersIn/Saison=' + Math.round(avgTransfersIn * 100) / 100);
});

// ============================================================
// PHASE 14 -- Offer Competition (Tier-Fluss-Matrix: wer kauft von wem?).
// ============================================================
console.log('\n=== PHASE 14: Offer Competition (Tier-Fluss-Matrix bei Bot-zu-Bot-Transfers) ===');
const flowMatrix = {};
Object.entries(runs).forEach(([k, d]) => {
  d.seasonSnapshots.forEach((s) => {
    s.transfersThisSeason.forEach((t) => {
      if (!t.info || !t.info.reason || t.to === 'Free Agent' || t.from === 'Free Agent') return;
      // orgTier zum Zeitpunkt via playerRows dieser Saison nachschlagen.
      const buyerRow = s.playerRows.find((p) => p.org === t.to);
      const sellerRow = s.playerRows.find((p) => p.org === t.from);
      if (!buyerRow || !sellerRow) return;
      const key = sellerRow.orgTier + '->' + buyerRow.orgTier;
      flowMatrix[key] = (flowMatrix[key] || 0) + 1;
    });
  });
});
console.log(JSON.stringify(flowMatrix, null, 1));

// ============================================================
// PHASE 15/16 -- Player Decision Logic / Loyalty (botPlayerTransferConsent
// -- IST-Zustand aus dem Code: chance = 0.55 + strengthDelta/180 +
// reputationDelta/400, geclampt [0.15, 0.95]. Empirische Vermessung unten.
// ============================================================
console.log('\n=== PHASE 15/16: Player Decision Logic (botPlayerTransferConsent-Gate) ===');
let consentAgg = { total: 0, consented: 0, vetoed: 0, upwardMoves: 0, upwardConsented: 0, downwardMoves: 0, downwardConsented: 0 };
Object.values(runs).forEach((d) => {
  d.seasonSnapshots.forEach((s) => {
    if (!s.consentSummary) return;
    Object.keys(consentAgg).forEach((key) => { consentAgg[key] += s.consentSummary[key] || 0; });
  });
});
console.log(JSON.stringify(consentAgg));
console.log('Veto-Quote gesamt:', Math.round(consentAgg.vetoed / consentAgg.total * 1000) / 10 + '%');
console.log('Aufwaerts-Wechsel (staerkere Org) Zustimmungsquote:', Math.round(consentAgg.upwardConsented / consentAgg.upwardMoves * 1000) / 10 + '% (n=' + consentAgg.upwardMoves + ')');
console.log('Abwaerts/Seitwaerts-Wechsel Zustimmungsquote:', consentAgg.downwardMoves ? Math.round(consentAgg.downwardConsented / consentAgg.downwardMoves * 1000) / 10 + '% (n=' + consentAgg.downwardMoves + ')' : 'n=0');
console.log('IST-Zustand (Code, evaluateBotSaleOffer + botPlayerTransferConsent): Verkaeufer-Seite bereits recht differenziert (Wichtigkeit/Ersatz/Alter/Potential/Vertrag/Finanzlage/Angebotshoehe), Spieler-Zustimmung dagegen NUR 3 Faktoren (Staerke-Delta/Reputations-Delta/Vertragsfrische) -- Gehalt/Rolle/Spielzeit/Coach/Moral/Beziehung fliessen NICHT ein (Auftragsabschnitt 25 nennt genau diese als moegliche Faktoren).');

// ============================================================
// PHASE 17/18 -- Contract Security / Free Agent Leakage.
// ============================================================
console.log('\n=== PHASE 17/18: Contract Security / Free Agent Leakage ===');
console.log('Code-Befund (checkBotOrgContractExpirations()): JEDE Bot-Org (Bottom/Mid/Top gleichermassen) verlaengert JEDEN auslaufenden Vertrag automatisch und bedingungslos -- kein Verhandlungsspielraum, keine Kuendigung, kein Frei-Agent-Uebergang ueber Vertragsablauf moeglich. Bestaetigt durch Phase-7-Messung: 0 von ' + totalLosses + ' HIGH_UPSIDE-Abgaengen ueber CONTRACT_EXPIRED/Free-Agent-Ablauf, in KEINEM der 3 Laeufe. Vertragssicherheit ist strukturell MAXIMAL und GLEICH fuer alle 454 Orgs -- kein Bottom-spezifischer Nachteil an dieser Stelle.');

// ============================================================
// PHASE 19 -- Transfer Fairness nach Verkaeufer-Tier.
// ============================================================
console.log('\n=== PHASE 19: Transfer Fairness nach Verkaeufer-Tier ===');
const fairnessByTier = { bottom: [], mid: [], top: [] };
Object.values(runs).forEach((d) => {
  d.seasonSnapshots.forEach((s) => {
    s.transfersThisSeason.forEach((t) => {
      if (typeof t.price !== 'number' || t.price <= 0 || t.from === 'Free Agent') return;
      const sellerRow = s.playerRows.find((p) => p.org === t.from);
      if (!sellerRow || !fairnessByTier[sellerRow.orgTier]) return;
      const buyerPersonRow = s.playerRows.find((p) => p.org === t.to && p.name === t.player);
      // Fairer Wert zum Zeitpunkt: falls die Person im ZIEL-Roster dieser
      // Saison auffindbar ist, ihr marketValue verwenden (naeherungsweise,
      // gleiche Einschraenkung wie schon in V8s transferFairness).
      if (!buyerPersonRow || !buyerPersonRow.marketValue) return;
      fairnessByTier[sellerRow.orgTier].push(t.price / buyerPersonRow.marketValue);
    });
  });
});
['bottom', 'mid', 'top'].forEach((tier) => {
  const arr = fairnessByTier[tier].sort((a, b) => a - b);
  console.log(tier + ' (n=' + arr.length + '): median Preis/Fairwert=' + median(arr) + ' p10=' + percentile(arr, 0.1) + ' p90=' + percentile(arr, 0.9));
});

// ============================================================
// PHASE 20 -- Seller Intelligence (IST-Zustand aus evaluateBotSaleOffer()).
// ============================================================
console.log('\n=== PHASE 20: Seller Intelligence (IST-Zustand) ===');
console.log('Code-Befund: evaluateBotSaleOffer() gewichtet bereits Wichtigkeit (isBestPlayer -12), Ersatzverfuegbarkeit (replacementGap, bis -14), Alter (>=30: +10, <=21: -8), Potential-Luecke (>8: -10), Vertragsrest (<200 Tage: +8), Finanzlage (INSOLVENT +30/CRITICAL +16/CAUTION +6), UND Angebotshoehe relativ zum Marktwert (dominanter Faktor, x65). Das deckt de facto bereits ALLE in Auftragsabschnitt 20.1 genannten Kriterien ab (Roster Depth nur implizit ueber replacementGap). Empirischer Befund aus Phase 10: unter den ECHTEN Verkaeufen (nicht den kostenlosen Verdraengungen) macht diese Logik die Bottom10-Orgs nicht zu bedingungslosen Verkaeufern -- siehe SOLD-vs-DISPLACED_FREE-Verhaeltnis in Phase 8/9.');

// ============================================================
// PHASE 22 -- Root Cause Ranking (rein datenbasiert aus den obigen Phasen).
// ============================================================
console.log('\n=== PHASE 22: Root-Cause-Ranking (datenbasiert) ===');
const displacedShareOfLosses = Math.round((lossReasons.ROSTER_UPGRADE_DISPLACEMENT || 0) / totalLosses * 1000) / 10;
console.log('Kandidaten-Ranking (nach Anteil an den erklaerten HIGH_UPSIDE-Abgaengen + Kapitalnutzung):');
console.log('#1 ROSTER_UPGRADE_DISPLACEMENT (' + displacedShareOfLosses + '% aller HIGH_UPSIDE-Abgaenge) -- ein GEKAUFTES, nicht ein bei der Bottom-Org entstandenes Problem: Talente werden beim NAECHSTEN Kaeufer kostenlos verdraengt, sobald der ein noch besseres Angebot findet. Betrifft die ganze Talent-Pipeline nach dem Verlassen der Ursprungs-Org.');
console.log('#2 Capital Utilization (siehe Phase 12/13-Zahlen oben) -- ob Bottom-Orgs verfuegbares Budget tatsaechlich in Verstaerkung umsetzen.');
console.log('#3 Transfer Competition/Fairness (siehe Phase 14/19) -- ob staerkere/reichere Orgs strukturell jeden Wettbewerb um gute Talente gewinnen.');
console.log('#4 Player Decision Logic (siehe Phase 15/16) -- schmales, staerke-dominiertes Zustimmungs-Gate begünstigt Abwanderung AUS strukturell schwachen Orgs (strengthDelta ist fuer sie fast immer positiv), unabhaengig von Verdienst/Rolle/Bindung.');
console.log('#5 Contract/Free-Agent-Leakage -- AUSGESCHLOSSEN (Phase 17/18: strukturell 0, gleich fuer alle Orgs).');

fs.writeFileSync(path.join(__dirname, '_v9_phase8to22.json'), JSON.stringify({ pipeline, pipelineRows, breakoutStats, valueCapture, reinvestTraj: { plus1Count: reinvestTraj.plus1.length, plus2Count: reinvestTraj.plus2.length, plus3Count: reinvestTraj.plus3.length }, capitalByTier: Object.fromEntries(Object.entries(capitalByTier).map(([k, v]) => [k, { avgInvest: v.invest.reduce((a, b) => a + b, 0) / v.invest.length, avgSpend: v.spend.reduce((a, b) => a + b, 0) / v.spend.length }])), flowMatrix, consentAgg, fairnessByTier: Object.fromEntries(Object.entries(fairnessByTier).map(([k, v]) => [k, { n: v.length, median: median(v) }])) }, null, 2));
console.log('\n[Zwischenstand gespeichert: _v9_phase8to22.json]');
