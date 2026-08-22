// Bot Ecosystem V13, Phase 2-4/15-19 -- "99er Forensik". audit-run-v12.js'
// distributionSnapshotFn() liefert nur {overall,potential,age} (kein
// genId/creationReason) -- fuer die geforderte Pro-Spieler-Herkunftsanalyse
// (Phase 2/3) und Generationsraten-Buckets (Phase 4) wird hier ein
// reichhaltigerer Snapshot mit vollem QA-Tag-Datensatz erfasst. Laeuft auf
// dem POST-FIX-Code (aktueller Stand von data/org-rosters.js).
// Nutzung: node phase2-forensics-v13.js <seed> <targetSeasons>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V13-FORENSICS-POSTFIX';
const TARGET_SEASONS = parseInt(process.argv[3] || '50', 10);
const OUT_FILE = path.join(__dirname, '_v13_forensics_' + SEED + '.json');
const CHECKPOINTS = [0, 10, 20, 30, 40, 50].filter((s) => s <= TARGET_SEASONS);

function setupFn() {
  botEconomyDebugTelemetryEnabled = true;
  ORGANIZATIONS.filter((o) => o.roster).forEach((org) => {
    const roster = org.roster;
    [...(roster.starters || []), roster.sub].filter(Boolean).forEach((p) => qaTagGeneration(p, org.name, 'Starter', 'INITIAL'));
    if (roster.coach) qaTagGeneration(roster.coach, org.name, 'Coach', 'INITIAL');
    (roster.staff || []).filter((s) => s && !s.vacant).forEach((s) => qaTagGeneration(s, org.name, s.role, 'INITIAL'));
  });
  qaScanAndUpdatePeaks();
  return { orgCount: ORGANIZATIONS.length };
}

// Voller Datensatz JEDES aktiven Starters/Subs (Personal bewusst ausgelassen
// -- Phase 2 fragt explizit nach Spielern) inkl. QA-Herkunftsfeldern.
function richPlayerSnapshotFn(seasonNum) {
  const out = [];
  ORGANIZATIONS.filter((o) => o.roster).forEach((org) => {
    const roster = org.roster;
    [...(roster.starters || []), roster.sub].filter(Boolean).forEach((p, idx) => {
      const isSub = roster.sub && p === roster.sub;
      const dev = (typeof playerDevelopment !== 'undefined') ? playerDevelopment[org.name + '::' + p.name] : null;
      out.push({
        org: org.name, role: isSub ? 'Sub' : 'Starter', name: p.name,
        overall: p.overall, potential: p.potential, age: p.age,
        genId: p.__qaGenId || null, creationReason: p.__qaCreationReason || null,
        birthSeason: p.__qaBirthSeason !== undefined ? p.__qaBirthSeason : null,
        peakOverall: p.__qaPeakOverall !== undefined ? p.__qaPeakOverall : null,
        peakAge: p.__qaPeakAge !== undefined ? p.__qaPeakAge : null,
        matchesPlayed: dev && dev.matches ? dev.matches : null,
      });
    });
  });
  return { season: seasonNum, players: out };
}

function finalDumpFn() {
  return { generationLog: qaGenerationLog, retirementLog: qaRetirementLog, transferLog };
}

(async () => {
  const t0all = Date.now();
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn);
  console.log('[' + SEED + '] setup done. orgCount=', setup.orgCount, 'checkpoints=', CHECKPOINTS.join(','));

  const out = { seed: SEED, targetSeasons: TARGET_SEASONS, richSnapshots: [], generationLog: [], retirementLog: [], transferLog: [] };
  const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  out.richSnapshots.push(game.run(richPlayerSnapshotFn, 0));
  flush();
  console.log('[' + SEED + '] S0 captured.');

  for (let season = 1; season <= TARGET_SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    game.run(() => { qaScanAndUpdatePeaks(); });
    if (CHECKPOINTS.indexOf(season) !== -1) {
      out.richSnapshots.push(game.run(richPlayerSnapshotFn, season));
      flush();
    }
    console.log('[' + SEED + '] Season', season, 'done in', Date.now() - t0, 'ms.');
  }

  const dump = game.run(finalDumpFn);
  out.generationLog = dump.generationLog;
  out.retirementLog = dump.retirementLog;
  out.transferLog = dump.transferLog;
  out.durationMs = Date.now() - t0all;
  out.pageErrors = game.pageErrors.length;
  flush();
  console.log('[' + SEED + '] FORENSICS DONE in', out.durationMs, 'ms. pageErrors:', out.pageErrors, 'generationLog:', out.generationLog.length, 'retirementLog:', out.retirementLog.length);
})().catch((err) => { console.error('[' + SEED + '] FORENSICS FAILED:', err); process.exit(1); });
