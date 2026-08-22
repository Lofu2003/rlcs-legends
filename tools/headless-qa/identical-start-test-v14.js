// Bot Ecosystem V14, Phase 30 "Identical Start Test". Waehlt deterministisch
// (namensortiert, NICHT RNG-abhaengig -- dieselbe Gruppe in jedem Seed) eine
// Gruppe von CLONE_COUNT Bot-Orgs und ueberschreibt AB S0 deren kompletten
// Zustand (Roster, Staff, Budget, Equipment-/Basecamp-Level) mit einer
// exakten Tiefenkopie EINER Vorlagen-Org (JSON-Rundreise -- alle Personen-
// Objekte sind reine Daten, keine Funktionen/Zyklen). Alle Gruppenmitglieder
// starten dadurch 100% identisch, spielen aber in der echten 454-Org-Liga
// gegen den normalen Rest -- jede Divergenz zwischen ihnen ab S1 ist REIN
// RNG-getrieben (Transfer-Wuerfe, Verletzungen, Vertragsverhandlungen,
// Match-Ergebnisse etc.), nicht durch unterschiedliche Ausgangslage erklaerbar.
// Primaeres Signal: Streuung INNERHALB eines Laufs (Gruppenmitglieder
// begannen identisch) -- mehrere Seeds nur als Robustheits-Zusatz.
// Nutzung: node identical-start-test-v14.js <seed> <seasons> <outFile>
const path = require('path');
const fs = require('fs');
const { createHeadlessGame } = require('./headless-runner');

const SEED = process.argv[2] || 'V14-IDENTICAL-A';
const SEASONS = parseInt(process.argv[3] || '20', 10);
const OUT_FILE = process.argv[4] || path.join(__dirname, '_v14_identical_' + SEED + '.json');
const CLONE_COUNT = 12;
const CHECKPOINTS = [0, 5, 10, 15, 20].filter((s) => s <= SEASONS);

function setupFn(cloneCount) {
  botEconomyDebugTelemetryEnabled = true;
  const bots = ORGANIZATIONS.filter((o) => o !== assignedOrg && o.roster);
  // Median-Staerke als Vorlage (nicht alphabetisch-erste -- Org-Name korreliert
  // nicht mit Staerke, aber ein zufaellig sehr schwacher/armer Templat-Kader
  // haette kaum Wirtschaftsaktivitaet in wenigen Saisons gezeigt). Gruppe
  // selbst bleibt ueber ALLE 453 Bots namenssortiert (deterministisch,
  // unabhaengig vom RNG-Seed) gewaehlt, damit jeder Seed exakt dieselben 12
  // Orgs testet.
  const sortedByStrength = [...bots].sort((a, b) => (a.strength || 0) - (b.strength || 0));
  const template = sortedByStrength[Math.floor(sortedByStrength.length / 2)];
  const sortedByName = [...bots].sort((a, b) => a.name.localeCompare(b.name));
  const group = sortedByName.slice(0, cloneCount);
  const templateClone = JSON.parse(JSON.stringify({
    roster: template.roster, budget: template.budget,
    equipmentLevel: template.equipmentLevel, basecampInvestLevel: template.basecampInvestLevel,
  }));
  group.forEach((org) => {
    const clone = JSON.parse(JSON.stringify(templateClone));
    org.roster = clone.roster;
    org.budget = clone.budget;
    org.equipmentLevel = clone.equipmentLevel;
    org.basecampInvestLevel = clone.basecampInvestLevel;
    org.strength = computeOrgStrengthFromRoster(org.roster);
  });
  return { groupNames: group.map((o) => o.name), templateName: template.name, templateStrength: template.strength, templateBudget: template.budget };
}

function snapshotFn(seasonNum, groupNames) {
  const rows = groupNames.map((name) => {
    const org = findOrgByName(name);
    return {
      name, rank: qaOrgRank(org), strength: org.strength || 0, budget: org.budget || 0,
      avgStarterOverall: (org.roster.starters || []).length ? org.roster.starters.reduce((s, p) => s + (p ? p.overall : 0), 0) / org.roster.starters.length : 0,
      wins: (careerWinLossTally[name] && careerWinLossTally[name].wins) || 0,
      losses: (careerWinLossTally[name] && careerWinLossTally[name].losses) || 0,
    };
  });
  return { season: seasonNum, rows };
}

(async () => {
  const game = await createHeadlessGame({ forwardConsole: false, seed: SEED });
  game.initHeadlessCareer();
  const setup = game.run(setupFn, CLONE_COUNT);
  console.log('[' + SEED + '] setup done. group=', setup.groupNames.join(','));

  const out = { seed: SEED, seasons: SEASONS, setup, snapshots: [] };
  out.snapshots.push(game.run(snapshotFn, 0, setup.groupNames));
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));

  for (let season = 1; season <= SEASONS; season++) {
    const t0 = Date.now();
    game.run(() => {
      const startSeason = careerState.seasonNumber;
      let days = 0;
      while (careerState.seasonNumber === startSeason && !careerEnded && days < 450) { advanceOneCalendarDay(); days++; }
    });
    if (CHECKPOINTS.indexOf(season) !== -1) out.snapshots.push(game.run(snapshotFn, season, setup.groupNames));
    console.log('[' + SEED + '] Season', season, 'done in', Date.now() - t0, 'ms.');
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  }

  out.pageErrors = game.pageErrors;
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  console.log('[' + SEED + '] IDENTICAL-START-TEST DONE. pageErrors:', game.pageErrors.length);
})().catch((err) => { console.error('[' + SEED + '] IDENTICAL-START-TEST FAILED:', err); process.exit(1); });
