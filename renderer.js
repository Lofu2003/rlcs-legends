const MAIN_SIZE = 3;
const SUB_SIZE = 1;
const RESERVE_SIZE = 2; // Reserve-Spieler zählen zum Kader/Budget, spielen aber nie mit
const TOTAL_ROSTER_SIZE = MAIN_SIZE + SUB_SIZE + RESERVE_SIZE;

const STAT_LABELS = [
  ['mechanics', 'MEC'],
  ['gameSense', 'GS'],
  ['speed', 'SPD'],
  ['shooting', 'SHO'],
  ['defending', 'DEF'],
  ['boostMgmt', 'BST'],
];

// Gleiche Stat-Achsen wie Spieler (User-Wunsch) — Coach-Overall/Preis damit
// direkt mit Spielern vergleichbar (siehe data/test-coaches.js).
const COACH_STAT_LABELS = STAT_LABELS;

// Wird erst bei "Neues Spiel" gesetzt (siehe startNewGame())
let assignedOrg = null;
let BUDGET = 0;

// Einheitliche Geld-Formatierung (User-Wunsch: Euro statt der fiktiven
// "Cr"-Währung) — alle Preis-/Budget-Anzeigen im ganzen Spiel laufen über
// diese eine Stelle, damit Format/Symbol nie an einzelnen Stellen auseinanderlaufen.
function formatMoney(amount) {
  return Math.round(amount).toLocaleString('de-DE') + ' €';
}

// Spielmodus — aktuell nur 'career' spielbar, 'randomizer' ist als zweiter
// Modus angekündigt (ausgegraut in der Auswahl) aber noch nicht implementiert.
// Wird pro Speicherstand mitgespeichert, damit die Fortsetzen-Liste zeigt,
// welcher Modus in welchem Slot läuft.
let gameMode = 'career';

// ── Einstellungen (globale App-Präferenzen, siehe main.js settings.json) ──
let appSettings = {
  autoCheckUpdates: true, defaultMatchSpeed: 1, quickSimPace: 'normal',
  displayMode: 'windowed', windowSize: '1280x800', uiScale: 1, rememberWindowBounds: true, windowBounds: null,
  soundEnabled: true, soundVolume: 0.5, introVideoVolume: 0.7, musicVolume: 0.3,
};

// Hintergrundmusik (#bg-music in index.html, ein echtes mp3 statt der
// synthetischen Web-Audio-Töne aus sound.js) -- startet einmal nach dem
// Intro (siehe finishIntro()) und läuft dann per `loop` app-weit durch.
// Eigenständig von soundEnabled (das ist nur für Button-Hover/-Klick), damit
// Musik unabhängig davon läuft/stumm geschaltet werden kann.
function startBackgroundMusic() {
  const music = document.getElementById('bg-music');
  music.volume = Math.max(0, Math.min(1, appSettings.musicVolume));
  music.play().catch(() => {}); // Autoplay-Policy könnte theoretisch blocken -- kein harter Fehler
}

const SETTINGS_SPEED_OPTIONS = [1, 2, 4, 8, 16, 32];
const SETTINGS_PACE_OPTIONS = [
  { id: 'normal', label: 'Normal', ms: 700 },
  { id: 'fast', label: 'Schnell', ms: 250 },
  { id: 'instant', label: 'Sofort', ms: 0 },
];
const SETTINGS_DISPLAY_MODE_OPTIONS = [
  { id: 'windowed', label: 'Fenstermodus' },
  { id: 'fullscreen', label: 'Vollbild' },
  { id: 'borderless', label: 'Rahmenloser Vollbildmodus' },
];
const SETTINGS_UI_SCALE_OPTIONS = [
  { value: 0.9, label: 'Klein' },
  { value: 1, label: 'Normal' },
  { value: 1.1, label: 'Groß' },
  { value: 1.25, label: 'Sehr groß' },
];

function quickSimPaceMs() {
  const opt = SETTINGS_PACE_OPTIONS.find((o) => o.id === appSettings.quickSimPace);
  return opt ? opt.ms : 700;
}

// Kader-Slots statt eines flachen Arrays — damit Main/Sub/Reserve echte,
// einzeln adressierbare Plätze sind (nötig für die Drag&Drop-Kader-Ansicht,
// siehe renderRosterBoard()). Kauf füllt automatisch den nächsten freien
// Slot in der Reihenfolge Main -> Sub -> Reserve (siehe toggleDraftPlayer()).
function emptySlotArray(size) { return new Array(size).fill(null); }
function padToSize(names, size) {
  const arr = names.slice(0, size);
  while (arr.length < size) arr.push(null);
  return arr;
}
let rosterSlots = { main: emptySlotArray(MAIN_SIZE), sub: emptySlotArray(SUB_SIZE), reserve: emptySlotArray(RESERVE_SIZE) };
let draftedCoachName = null;

function getAllOwnedPlayerNames() {
  return [...rosterSlots.main, ...rosterSlots.sub, ...rosterSlots.reserve].filter(Boolean);
}
// Spieler, die tatsächlich mitspielen (Main+Sub) — Reserve zählt bewusst
// NICHT dazu (spielt laut Konzept nie mit).
function getActivePlayerNames() {
  return [...rosterSlots.main, ...rosterSlots.sub].filter(Boolean);
}
function findPlayerSlot(name) {
  for (const type of ['main', 'sub', 'reserve']) {
    const idx = rosterSlots[type].indexOf(name);
    if (idx !== -1) return { type, index: idx };
  }
  return null;
}
// Entfernt einen Spieler aus dem Kader — rückt bei einem Main-Verkauf den Sub
// automatisch nach (falls vorhanden), damit die 3 aktiven Main-Plätze soweit
// möglich voll bleiben (siehe canSellPlayer()).
function removePlayerFromRoster(name) {
  const slot = findPlayerSlot(name);
  if (!slot) return;
  if (slot.type === 'main' && rosterSlots.sub[0]) {
    rosterSlots.main[slot.index] = rosterSlots.sub[0];
    rosterSlots.sub[0] = null;
  } else {
    rosterSlots[slot.type][slot.index] = null;
  }
}
// Verkauf (an eine Bot-Org) darf die aktive Mindestbesetzung (3 Main-Spieler)
// nie unterschreiten — Reserve- und Sub-Verkäufe sind davon nie betroffen,
// ein Main-Verkauf nur, wenn ein Sub zum Nachrücken bereitsteht.
function canSellPlayer(name) {
  const slot = findPlayerSlot(name);
  if (!slot || slot.type !== 'main') return true;
  return !!rosterSlots.sub[0];
}

// Ein Spieler darf laut User-Vorgabe pro Saison nur EIN einziges Mal den
// Besitzer wechseln — egal ob eigener Kauf, eigener Verkauf oder Bot-zu-Bot-
// Trade. Wird bei jedem abgeschlossenen Transfer befüllt (siehe
// completeNegotiationSuccess/acceptIncomingOffer/generateBotTrades) und bei
// jedem Saisonwechsel geleert.
let playersTradedThisSeason = new Set();

// Spieler, die per Verhandlung von einer Bot-Org abgeworben wurden, zahlen
// die ausgehandelte (mindestens doppelte) Ablöse statt des normalen Preises
// gegen den Budget-Cap — siehe getSpent()/completeNegotiationSuccess(). Gilt
// nur für die laufende Draft-Session (wird bei neuer Saison zurückgesetzt,
// siehe confirmOrgAndProceed()/startNextSeason()), da der Spieler ab der
// nächsten Saison ganz normal "dein" Kaderspieler ist.
let negotiatedPremiumPlayers = {};

// Chronologisches Log ALLER abgeschlossenen Transfers (eigene Käufe/Verkäufe
// UND Bot-zu-Bot-Trades, siehe generateBotTrades()) — für die Transfer-
// Historie-Ansicht. Bleibt über die GANZE Karriere bestehen (anders als
// negotiatedPremiumPlayers), wird nur bei neuer Karriere geleert.
let transferLog = []; // { season, from, to, player, price }

function logTransfer(from, to, player, price) {
  transferLog.unshift({ season: careerState.seasonNumber, from, to, player, price });
}

// ── Karriere-Kontinuität über mehrere Saisons ────────────────────────────
// careerState existiert ab der ersten Saison und trackt Saison-Nummer + Titel.
// careerRosterPlayers/careerCoach enthalten die AKTUELLE (ggf. weiterentwickelte)
// Version der eigenen Kader-Spieler — als eigenständige Kopien, NICHT als
// Referenz auf TEST_PLAYERS, damit Entwicklung den geteilten Spieler-Pool nicht
// dauerhaft verändert (sonst würde ein späteres "Neues Spiel" in derselben
// App-Sitzung bereits hochentwickelte Spieler im Pool vorfinden).
let careerState = null;
let careerRosterPlayers = null;
let careerReservePlayers = null; // entwickelte Reserve-Spieler, analog zu careerRosterPlayers
let careerCoach = null;

// Echte Spielzeit (Sekunden) -- User-Wunsch: Slot-Auswahl soll "Spielzeit X Tg."
// zeigen (siehe Referenz-Screenshot). Zählt per Intervall hoch, SOLANGE eine
// Karriere aktiv ist (nicht im Menü) -- siehe startPlaytimeTracking()/
// stopPlaytimeTracking(). Wird alle 30s mitgespeichert (nicht bei jedem Tick,
// das wäre unnötig viel Disk-I/O), plus wie gehabt bei jeder ohnehin
// stattfindenden saveGameState()-Aktion.
let careerPlaytimeSeconds = 0;
let playtimeIntervalId = null;

function startPlaytimeTracking() {
  stopPlaytimeTracking();
  playtimeIntervalId = setInterval(() => {
    careerPlaytimeSeconds += 1;
    if (careerPlaytimeSeconds % 30 === 0) saveGameState();
  }, 1000);
}

function stopPlaytimeTracking() {
  if (playtimeIntervalId) {
    clearInterval(playtimeIntervalId);
    playtimeIntervalId = null;
  }
}

// Rivalitäten: Bot-Teams bleiben über die gesamte Karriere bestehen (statt
// jedes Turnier neu gewürfelt zu werden) und entwickeln sich zwischen Saisons
// weiter (developBotTeams() in bot-teams.js). careerRivalRecords trackt die
// Kopf-an-Kopf-Bilanz gegen jede einzelne Bot-Org, keyed nach Org-Name.
let careerBotTeams = null;
let careerRivalRecords = {};

// ── Vertrags-Optionen: echte Spiellogik ─────────────────────────────────
// Werte werden beim Unterschreiben (confirmOrgAndProceed()) aus den
// Checkbox-Zuständen des Vertrags-Screens übernommen und bleiben für die
// GESAMTE Karriere fest (kein erneutes Ändern nach der Unterschrift).
let ceoFireable = false;          // "CEO kann entlassen werden"
let achievementsEnabled = false;  // "Erfolge aktiviert" (dieselbe Checkbox)
let consecutivePoorSeasons = 0;   // Saisons in Folge mit mehr Niederlagen als Siegen
let careerEnded = false;          // true nach triggerCeoFired() -- verhindert Weiterspielen nach Reload
let transfersLockedUntil = null;  // ISO-Datumsstring oder null -- "Transfers für KI-Teams sperren"
let unlockedAchievements = [];    // Liste freigeschalteter Achievement-IDs

function tierForOverall(overall) {
  if (overall >= 85) return 'tier-diamond';
  if (overall >= 78) return 'tier-gold';
  if (overall >= 70) return 'tier-silver';
  return 'tier-bronze';
}

// Karriere-entwickelte Version hat Vorrang vor dem statischen Pool — dadurch
// zeigt findPlayer(name) automatisch überall (Kader, Preisberechnung, Pool-
// Anzeige) den aktuellen Entwicklungsstand, ohne dass jede aufrufende Stelle
// das extra wissen muss.
function findPlayer(name) {
  const developed = (careerRosterPlayers && careerRosterPlayers.find((p) => p.name === name))
    || (careerReservePlayers && careerReservePlayers.find((p) => p.name === name));
  return developed || TEST_PLAYERS.find((p) => p.name === name);
}
function findCoach(name) {
  if (careerCoach && careerCoach.name === name) return careerCoach;
  return TEST_COACHES.find((c) => c.name === name);
}

function getSpent() {
  const playerSpend = getAllOwnedPlayerNames().reduce((sum, n) => {
    return sum + (negotiatedPremiumPlayers[n] || calculatePrice(findPlayer(n).overall));
  }, 0);
  const coachSpend = draftedCoachName ? calculatePrice(findCoach(draftedCoachName).overall) : 0;
  return playerSpend + coachSpend;
}

function getRemaining() { return BUDGET - getSpent(); }

function toggleDraftPlayer(player) {
  const slot = findPlayerSlot(player.name);
  if (slot) {
    rosterSlots[slot.type][slot.index] = null;
    delete negotiatedPremiumPlayers[player.name];
  } else {
    const targetType = ['main', 'sub', 'reserve'].find((type) => rosterSlots[type].includes(null));
    if (!targetType) return; // Kader komplett voll (Main+Sub+Reserve)
    if (calculatePrice(player.overall) > getRemaining()) return;
    rosterSlots[targetType][rosterSlots[targetType].indexOf(null)] = player.name;
  }
  renderAll();
  saveGameState();
}

function toggleDraftCoach(coach) {
  if (draftedCoachName === coach.name) {
    draftedCoachName = null;
  } else {
    if (draftedCoachName !== null) return; // nur 1 Coach erlaubt
    if (calculatePrice(coach.overall) > getRemaining()) return;
    draftedCoachName = coach.name;
  }
  renderAll();
  saveGameState();
}

function buildStatBar(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'stat-row';

  const tag = document.createElement('span');
  tag.className = 'stat-tag';
  tag.textContent = label;

  const barTrack = document.createElement('div');
  barTrack.className = 'stat-bar-track';
  const barFill = document.createElement('div');
  barFill.className = 'stat-bar-fill';
  barFill.style.width = value + '%';
  barTrack.appendChild(barFill);

  const val = document.createElement('span');
  val.className = 'stat-value';
  val.textContent = value;

  wrap.appendChild(tag);
  wrap.appendChild(barTrack);
  wrap.appendChild(val);
  return wrap;
}

function buildCard({ overall, name, price, isDrafted, isLocked, statPairs, extraClass, contractTeamName, onClick }) {
  const card = document.createElement('div');
  card.className = 'player-card ' + tierForOverall(overall) + (extraClass ? ' ' + extraClass : '');
  if (isDrafted) card.classList.add('is-drafted');
  if (isLocked) card.classList.add('is-locked');
  if (contractTeamName) card.classList.add('is-contracted');
  card.addEventListener('click', onClick);

  if (isDrafted) {
    const badge = document.createElement('div');
    badge.className = 'drafted-badge';
    badge.textContent = '✓ GEDRAFTET';
    card.appendChild(badge);
  }

  if (contractTeamName) {
    const badge = document.createElement('div');
    badge.className = 'contract-badge';
    badge.textContent = 'Spielt bereits für ' + contractTeamName;
    card.appendChild(badge);
  }

  const top = document.createElement('div');
  top.className = 'card-top';

  const rating = document.createElement('div');
  rating.className = 'card-rating';
  rating.textContent = overall;

  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = name;

  top.appendChild(rating);
  top.appendChild(nameEl);
  card.appendChild(top);

  const priceEl = document.createElement('div');
  priceEl.className = 'card-price';
  priceEl.textContent = formatMoney(price);
  card.appendChild(priceEl);

  const stats = document.createElement('div');
  stats.className = 'card-stats';
  statPairs.forEach(([key, label, value]) => stats.appendChild(buildStatBar(label, value)));
  card.appendChild(stats);

  return card;
}

// Findet das Bot-Team, das einen Spieler (per Name) aktuell unter Vertrag hat
// — null, wenn der Spieler ein freier Agent ist (oder gerade beim Nutzer).
function findBotTeamOwning(playerName) {
  if (!careerBotTeams) return null;
  return careerBotTeams.find((t) => t.players.some((p) => p.name === playerName)) || null;
}

function buildPlayerCard(p) {
  const basePrice = calculatePrice(p.overall);
  const isDrafted = !!findPlayerSlot(p.name);
  const rosterFull = getAllOwnedPlayerNames().length >= TOTAL_ROSTER_SIZE;
  const owningTeam = isDrafted ? null : findBotTeamOwning(p.name);
  const blocked = owningTeam ? isNegotiationBlocked(owningTeam.name) : false;
  const alreadyTraded = owningTeam ? playersTradedThisSeason.has(p.name) : false;
  // Vertragsspieler kosten mindestens das Doppelte (Verhandlungs-Startforderung,
  // siehe openNegotiationModal) — das wird schon auf der Karte angezeigt.
  const price = owningTeam ? basePrice * 2 : basePrice;
  const canAfford = price <= getRemaining();
  const isLocked = !isDrafted && (rosterFull || !canAfford || blocked || alreadyTraded);

  let contractTeamName = null;
  if (owningTeam) {
    contractTeamName = owningTeam.name;
    if (blocked) contractTeamName += ' — gesperrt bis Saison ' + negotiationBlocklist[owningTeam.name];
    else if (alreadyTraded) contractTeamName += ' — schon getradet, erst nächste Saison wieder';
  }

  return buildCard({
    overall: p.overall,
    name: p.name,
    price,
    isDrafted,
    isLocked,
    statPairs: STAT_LABELS.map(([key, label]) => [key, label, p[key]]),
    contractTeamName,
    onClick: () => {
      if (isLocked) return;
      if (owningTeam) { openNegotiationModal(p, owningTeam); return; }
      toggleDraftPlayer(p);
    },
  });
}

// ── Verhandlungssystem: Vertragsspieler von Bot-Orgs abwerben ───────────────
// Regelbasierte Simulation statt echter LLM-API (User-Entscheidung) — RLCS
// Legends wird als öffentliche .exe verteilt, ein API-Key im Client wäre
// extrahierbar/missbrauchbar, und ein Backend dafür ist außerhalb des Scopes.
// Trotzdem "frei schreibbar": der Nutzer tippt ein echtes Argument, das per
// Schlüsselwörtern ausgewertet wird (siehe analyzeNegotiationMessage), nicht
// nur Buttons klickt.
//
// Regeln (User-Vorgabe, 2. Runde): die Org startet bei doppeltem Marktwert,
// bewegt sich aber über mehrere Angebote hinweg auf den Nutzer zu ("kommt
// entgegen"), statt starr auf dem Doppelten zu beharren — ein deutlich zu
// niedriges Angebot (unter der Hälfte des aktuellen Ask-Preises, z.B. 150
// gegen eine Forderung von 390) wird trotzdem sofort und hart abgelehnt statt
// bloß eine niedrige Erfolgschance zu haben. Max. 3 Verhandlungsversuche pro
// Spieler; ein Frust-Balken der Org steigt bei schlechten Angeboten — wird er
// voll (oder sind die 3 Versuche aufgebraucht), bricht die Org ab und blockt
// jede weitere Verhandlung mit ihr für die nächsten 3 Saisons. Die KI behält
// dabei ihr EIGENES Interesse im Blick: der beste Spieler eines Bot-Teams
// wird zäher verteidigt als ein Rollenspieler, damit sich die Org durch einen
// Verkauf nicht selbst für die nächste Saison schwächt.
const NEGOTIATION_POSITIVE_WORDS = ['bitte', 'zukunft', 'chance', 'projekt', 'vertrauen', 'fair', 'stern', 'wachsen', 'gemeinsam', 'top', 'wichtig', 'familie', 'langfristig', 'respekt', 'perspektive'];
const NEGOTIATION_NEGATIVE_WORDS = ['muss', 'sofort', 'zwing', 'billig', 'schrott', 'egal', 'befehl', 'verlangen', 'nervt'];

const NEGOTIATION_MAX_ATTEMPTS = 3;
const NEGOTIATION_FRUSTRATION_MAX = 100;
const NEGOTIATION_INSTANT_REJECT_RATIO = 0.5; // Angebot < 50% des aktuellen Ask-Preises = "zu dreist"
const NEGOTIATION_MIN_ASK_MULTIPLIER = 1.3;   // die Org geht nie unter das 1.3-fache des Marktwerts
const NEGOTIATION_MEET_FACTOR = 0.35;         // wie stark sich der Ask-Preis pro Runde Richtung Angebot bewegt
const NEGOTIATION_BLOCK_SEASONS = 3;

let negotiationState = null; // { player, botTeam, basePrice, askPrice, attempts, frustration, ended }
let negotiationBlocklist = {}; // botTeamName -> Saison-Nummer, ab der wieder verhandelt werden darf

function isNegotiationBlocked(botTeamName) {
  const until = negotiationBlocklist[botTeamName];
  return !!until && careerState.seasonNumber < until;
}

function openNegotiationModal(player, botTeam) {
  const basePrice = calculatePrice(player.overall);
  negotiationState = { player, botTeam, basePrice, askPrice: basePrice * 2, attempts: 0, frustration: 0, ended: false };

  document.getElementById('negotiation-title').textContent = 'Verhandlung: ' + player.name;
  updateNegotiationSubtitle();
  updateNegotiationFrustrationBar();

  document.getElementById('negotiation-log').innerHTML = '';
  appendNegotiationLine('system', botTeam.name + ' hört sich Angebote für ' + player.name + ' an — Summe und Auftreten müssen aber stimmen. Max. ' + NEGOTIATION_MAX_ATTEMPTS + ' Versuche.');

  document.getElementById('negotiation-offer').value = negotiationState.askPrice;
  document.getElementById('negotiation-message').value = '';
  document.getElementById('btn-negotiation-send').disabled = false;
  document.getElementById('negotiation-modal').classList.remove('hidden');
}

function updateNegotiationSubtitle() {
  const { player, botTeam, askPrice } = negotiationState;
  document.getElementById('negotiation-subtitle').textContent =
    player.name + ' (' + player.overall + ' Overall) steht aktuell bei ' + botTeam.name +
    ' unter Vertrag. Aktuelle Forderung: ' + formatMoney(askPrice) + '.';
}

function updateNegotiationFrustrationBar() {
  const { attempts, frustration } = negotiationState;
  const fill = document.getElementById('negotiation-frustration-fill');
  fill.style.width = Math.min(100, frustration) + '%';
  fill.style.background = frustration >= 70
    ? 'linear-gradient(90deg, #e8543e, #ff8a6a)'
    : frustration >= 35
      ? 'linear-gradient(90deg, #e0a83e, #ffce6a)'
      : 'linear-gradient(90deg, #3ecf72, #6fd6e8)';
  document.getElementById('negotiation-attempts-label').textContent = 'Versuch ' + attempts + '/' + NEGOTIATION_MAX_ATTEMPTS;
}

function hideNegotiationModal() {
  document.getElementById('negotiation-modal').classList.add('hidden');
  negotiationState = null;
}

function appendNegotiationLine(who, text) {
  const log = document.getElementById('negotiation-log');
  const line = document.createElement('div');
  line.className = 'negotiation-line negotiation-line-' + who;
  const prefix = who === 'user' ? 'Du: ' : who === 'org' ? negotiationState.botTeam.name + ': ' : who === 'player' ? negotiationState.player.name + ': ' : '';
  line.textContent = prefix + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// Grobe Stimmungsanalyse per Schlüsselwörtern statt echtem NLP — bewusst
// einfach/deterministisch statt eines LLM-Aufrufs (siehe Kommentar oben).
function analyzeNegotiationMessage(message) {
  const lower = message.toLowerCase();
  let score = 0;
  NEGOTIATION_POSITIVE_WORDS.forEach((w) => { if (lower.includes(w)) score += 0.02; });
  NEGOTIATION_NEGATIVE_WORDS.forEach((w) => { if (lower.includes(w)) score -= 0.03; });
  return Math.max(-0.1, Math.min(0.12, score));
}

function sendNegotiationOffer() {
  if (!negotiationState || negotiationState.ended) return;
  const st = negotiationState;
  const { player, botTeam } = st;
  const offerInput = document.getElementById('negotiation-offer');
  const messageInput = document.getElementById('negotiation-message');
  const offer = Math.round(Number(offerInput.value) || 0);
  const message = messageInput.value.trim();

  if (message) appendNegotiationLine('user', message);
  appendNegotiationLine('user', 'Angebot: ' + formatMoney(offer) + '.');
  messageInput.value = '';

  if (offer > getRemaining()) {
    appendNegotiationLine('system', 'Das kannst du dir nicht leisten — dein Budget reicht dafür nicht aus.');
    return; // zählt nicht als Verhandlungsversuch, ist nur eine UI-Validierung
  }

  st.attempts += 1;
  const ratio = offer / st.askPrice;

  if (ratio < NEGOTIATION_INSTANT_REJECT_RATIO) {
    appendNegotiationLine('org', 'Das ist unverschämt wenig — wir verlangen ' + formatMoney(st.askPrice) + ', kein Grund für uns, darüber überhaupt nachzudenken.');
    st.frustration = NEGOTIATION_FRUSTRATION_MAX;
    updateNegotiationFrustrationBar();
    endNegotiationIfNeeded();
    return;
  }

  const isTeamsBest = player.overall === Math.max(...botTeam.players.map((p) => p.overall));
  const messageBonus = analyzeNegotiationMessage(message);

  if (offer >= st.askPrice) {
    const surplus = (offer - st.askPrice) / st.askPrice;
    let chance = 0.5 + surplus * 0.6 + messageBonus - (isTeamsBest ? 0.2 : 0);
    chance = Math.max(0.05, Math.min(0.92, chance));

    if (Math.random() < chance) {
      appendNegotiationLine('org', 'Abgemacht — ' + player.name + ' wechselt für ' + formatMoney(offer) + ' zu ' + assignedOrg.name + '.');
      appendNegotiationLine('player', 'Neue Herausforderung, neues Kapitel. Ich bin dabei.');
      completeNegotiationSuccess(offer);
      return;
    }
    st.frustration = Math.min(NEGOTIATION_FRUSTRATION_MAX, st.frustration + 15 * computeCharacterEffects(careerCharacter.traits).frustrationMultiplier);
    const voice = Math.random() < 0.5 ? 'org' : 'player';
    const rejectionPool = voice === 'org'
      ? ['Die Ablöse ist uns die Trennung noch nicht wert — wir planen mit ' + player.name + ' für die nächste Saison.', 'Unser Management sieht aktuell keinen Grund für einen Verkauf.', 'Wir reden gerne weiter, aber so noch nicht.']
      : ['Ich fühle mich hier gerade wohl — vielleicht ein andermal.', 'Der Zeitpunkt passt für mich nicht.', 'Ich will erst sehen, wie diese Saison für uns läuft.'];
    appendNegotiationLine(voice, rejectionPool[Math.floor(Math.random() * rejectionPool.length)]);
  } else {
    // Angebot liegt unter der Forderung, aber nicht dreist niedrig — die Org
    // kommt ein Stück entgegen, statt starr auf dem alten Ask-Preis zu bleiben.
    const floor = st.basePrice * NEGOTIATION_MIN_ASK_MULTIPLIER;
    const oldAsk = st.askPrice;
    st.askPrice = Math.max(floor, st.askPrice - (st.askPrice - offer) * NEGOTIATION_MEET_FACTOR);
    st.frustration = Math.min(NEGOTIATION_FRUSTRATION_MAX, st.frustration + (25 - messageBonus * 100) * computeCharacterEffects(careerCharacter.traits).frustrationMultiplier);
    if (Math.round(st.askPrice) < Math.round(oldAsk)) {
      appendNegotiationLine('org', 'Das ist uns noch zu wenig, aber wir bewegen uns: ' + formatMoney(oldAsk) + ' -> ' + formatMoney(st.askPrice) + ' wäre inzwischen unsere Untergrenze.');
    } else {
      appendNegotiationLine('org', 'Weiter unter unserer Schmerzgrenze von ' + formatMoney(st.askPrice) + ' — mehr geht bei uns gerade nicht runter.');
    }
    updateNegotiationSubtitle();
  }

  updateNegotiationFrustrationBar();
  endNegotiationIfNeeded();
}

// Prüft nach jedem Versuch, ob die Org endgültig abbricht (Frust voll ODER
// die 3 Versuche aufgebraucht) — sperrt die Org dann für die nächsten 3
// Saisons für weitere Verhandlungen.
function endNegotiationIfNeeded() {
  const st = negotiationState;
  if (!st || st.ended) return;
  if (st.frustration >= NEGOTIATION_FRUSTRATION_MAX || st.attempts >= NEGOTIATION_MAX_ATTEMPTS) {
    st.ended = true;
    negotiationBlocklist[st.botTeam.name] = careerState.seasonNumber + NEGOTIATION_BLOCK_SEASONS;
    appendNegotiationLine('system', st.botTeam.name + ' bricht die Verhandlung endgültig ab — für die nächsten ' + NEGOTIATION_BLOCK_SEASONS + ' Saisons ist mit dieser Org nichts mehr zu verhandeln.');
    document.getElementById('btn-negotiation-send').disabled = true;
  }
}

function completeNegotiationSuccess(paidPrice) {
  const { player, botTeam } = negotiationState;

  // Ersatz-Rollenspieler beim Bot-Team nachrücken lassen — das Team bleibt so
  // mit 3 Spielern turnierfähig, wird durch den Verkauf aber trotzdem
  // schwächer (realistische Konsequenz eines gelungenen Transfers).
  const idx = botTeam.players.findIndex((p) => p.name === player.name);
  if (idx !== -1) {
    const usedNames = new Set(botTeam.players.map((p) => p.name));
    botTeam.players[idx] = generateBotPlayer(usedNames);
  }

  negotiatedPremiumPlayers[player.name] = paidPrice;
  logTransfer(botTeam.name, assignedOrg.name, player.name, paidPrice);
  playersTradedThisSeason.add(player.name);
  hideNegotiationModal();
  toggleDraftPlayer(player); // rendert + speichert bereits
}

// ── Bot-zu-Bot-Trades: Bots verhandeln auch UNTEREINANDER ──────────────────
// User-Wunsch: die Bot-Liga soll sich auch ohne den Nutzer weiterbewegen.
// Dieselbe Grundidee wie generateIncomingOffers() (Team sucht einen Spieler,
// der deutlich stärker ist als der eigene schwächste), nur dass hier JEDES
// Bot-Team sowohl Käufer als auch Verkäufer sein kann. Läuft automatisch und
// ohne Nutzer-Interaktion ab (kein Verhandlungs-Popup nötig, da beide Seiten
// KI sind) — landet aber sichtbar im transferLog/der Transfer-Historie.
const BOT_TRADE_OVERALL_MARGIN = 6;
const BOT_TRADE_CHANCE = 0.25;
const MAX_BOT_TRADES_PER_SEASON = 5;

// Vertragsklausel "Transfers für KI-Teams sperren" (siehe confirmOrgAndProceed()) --
// solange aktiv, findet der gesamte KI-Transfermarkt nicht statt (weder
// Bot-zu-Bot-Trades noch Anfragen an dich, siehe generateIncomingOffers()).
function transfersAreLocked() {
  return !!transfersLockedUntil && Date.now() < new Date(transfersLockedUntil).getTime();
}

function generateBotTrades() {
  if (transfersAreLocked()) return;
  const teams = careerBotTeams;
  let executed = 0;
  const buyOrder = teams.slice().sort(() => Math.random() - 0.5); // Reihenfolge variieren, kein Team immer zuerst

  buyOrder.forEach((buyer) => {
    if (executed >= MAX_BOT_TRADES_PER_SEASON) return;
    const weakest = buyer.players.reduce((min, p) => (p.overall < min.overall ? p : min), buyer.players[0]);

    let bestSeller = null;
    let bestPlayer = null;
    teams.forEach((seller) => {
      if (seller === buyer) return;
      seller.players.forEach((p) => {
        if (playersTradedThisSeason.has(p.name)) return; // schon diese Saison getradet — tabu
        if (p.overall - weakest.overall >= BOT_TRADE_OVERALL_MARGIN && (!bestPlayer || p.overall > bestPlayer.overall)) {
          bestPlayer = p;
          bestSeller = seller;
        }
      });
    });

    if (!bestPlayer || Math.random() >= BOT_TRADE_CHANCE) return;

    const buyerIdx = buyer.players.findIndex((p) => p.name === weakest.name);
    const sellerIdx = bestSeller.players.findIndex((p) => p.name === bestPlayer.name);
    if (buyerIdx === -1 || sellerIdx === -1) return;

    buyer.players[buyerIdx] = { ...bestPlayer };
    const usedNames = new Set(bestSeller.players.map((p) => p.name));
    bestSeller.players[sellerIdx] = generateBotPlayer(usedNames); // Verkäufer bekommt frischen Rollenspieler nach

    const price = Math.round(calculatePrice(bestPlayer.overall) * (1 + Math.random() * 0.5) / 1000) * 1000;
    logTransfer(bestSeller.name, buyer.name, bestPlayer.name, price);
    playersTradedThisSeason.add(bestPlayer.name);
    executed += 1;
  });
}

// ── Eingehende Angebote: Bots fragen umgekehrt bei DIR an ──────────────────
// User-Wunsch: Bots sollen nicht nur passiv abgeworben werden können, sondern
// selbst aktiv Interesse an Spielern im eigenen Roster zeigen, wenn diese
// deutlich stärker sind als ihr eigener schwächster Spieler — dieselbe
// regelbasierte Verhandlungslogik wie beim Abwerben, nur in umgekehrter
// Richtung. Wird einmal pro Saisonwechsel neu ermittelt (siehe
// startNextSeason()), NICHT bei jedem Rendern — sonst würde sich die Anfrage
// bei jedem Bildschirmwechsel neu würfeln.
const INCOMING_OFFER_OVERALL_MARGIN = 8; // ab wie viel Overall-Vorsprung ein Spieler für einen Bot interessant wird
const INCOMING_OFFER_CHANCE = 0.35;      // pro geeignetem Team-Spieler-Paar, ob die Saison tatsächlich angefragt wird
const MAX_INCOMING_OFFERS_PER_SEASON = 3;

let pendingIncomingOffers = [];
let currentIncomingOffer = null; // { botTeam, player, weakest, offerPrice }

function generateIncomingOffers() {
  if (transfersAreLocked()) { pendingIncomingOffers = []; return; }
  const myRoster = getAllOwnedPlayerNames().map(findPlayer);
  const candidates = [];

  careerBotTeams.forEach((team) => {
    const weakest = team.players.reduce((min, p) => (p.overall < min.overall ? p : min), team.players[0]);
    let best = null;
    myRoster.forEach((p) => {
      if (playersTradedThisSeason.has(p.name)) return; // schon diese Saison getradet — tabu
      if (!canSellPlayer(p.name)) return; // Main-Verkauf ohne Sub zum Nachrücken würde unter 3 Aktive drücken
      if (p.overall - weakest.overall >= INCOMING_OFFER_OVERALL_MARGIN && (!best || p.overall > best.overall)) best = p;
    });
    if (best && Math.random() < INCOMING_OFFER_CHANCE) {
      const multiplier = 1.3 + Math.random() * 0.5; // 1.3x - 1.8x Marktwert als Lockangebot
      const offerPrice = Math.round(calculatePrice(best.overall) * multiplier / 1000) * 1000;
      candidates.push({ botTeam: team, player: best, weakest, offerPrice });
    }
  });

  // Größte Aufwertung für den Bot zuerst — pro Saison nur eine Handvoll
  // Anfragen zeigen, sonst wirkt es wie Spam.
  candidates.sort((a, b) => (b.player.overall - b.weakest.overall) - (a.player.overall - a.weakest.overall));
  pendingIncomingOffers = candidates.slice(0, MAX_INCOMING_OFFERS_PER_SEASON);
}

function showNextIncomingOffer() {
  if (pendingIncomingOffers.length === 0) { currentIncomingOffer = null; return; }
  currentIncomingOffer = pendingIncomingOffers.shift();
  const { botTeam, player, weakest, offerPrice } = currentIncomingOffer;

  document.getElementById('incoming-offer-title').textContent = botTeam.name + ' fragt an: ' + player.name;
  document.getElementById('incoming-offer-subtitle').textContent =
    botTeam.name + ' interessiert sich für ' + player.name + ' (' + player.overall + ' Overall) — deutlich stärker als ihr aktuell schwächster Spieler ' +
    weakest.name + ' (' + weakest.overall + ' Overall). Erstes Angebot: ' + formatMoney(offerPrice) + '.';

  document.getElementById('incoming-offer-log').innerHTML = '';
  appendIncomingOfferLine('org', 'Wir würden uns über ' + player.name + ' in unserem Kader sehr freuen. Wärt ihr für ' + formatMoney(offerPrice) + ' bereit, ihn/sie ziehen zu lassen?');

  document.getElementById('incoming-offer-counter').value = offerPrice;
  document.getElementById('incoming-offer-message').value = '';
  document.getElementById('incoming-offer-modal').classList.remove('hidden');
}

function appendIncomingOfferLine(who, text) {
  const log = document.getElementById('incoming-offer-log');
  const line = document.createElement('div');
  line.className = 'negotiation-line negotiation-line-' + who;
  const prefix = who === 'user' ? 'Du: ' : who === 'org' ? currentIncomingOffer.botTeam.name + ': ' : '';
  line.textContent = prefix + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function hideIncomingOfferModal() {
  document.getElementById('incoming-offer-modal').classList.add('hidden');
}

function acceptIncomingOffer(paidPrice) {
  const { botTeam, player, weakest } = currentIncomingOffer;

  // Verkauf darf die aktive Mindestbesetzung (3 Main-Spieler) nie unterschreiten
  // — ohne Sub zum Nachrücken ist ein Main-Verkauf blockiert (User-Vorgabe).
  if (!canSellPlayer(player.name)) {
    appendIncomingOfferLine('system', 'Verkauf nicht möglich — dir würden dann weniger als 3 aktive Spieler bleiben. Hol dir erst einen Sub, bevor du diesen Starter abgibst.');
    return;
  }

  // Verkaufserlös über dem Marktwert wird als zusätzliches Saison-Budget
  // gutgeschrieben (Transfer-Gewinn) — der reguläre Marktwert-Anteil ist
  // durch den Wegfall aus dem Kader ohnehin automatisch als freies
  // Budget-Cap verfügbar (siehe getSpent()).
  BUDGET += Math.max(0, paidPrice - calculatePrice(player.overall));
  logTransfer(assignedOrg.name, botTeam.name, player.name, paidPrice);
  playersTradedThisSeason.add(player.name);
  delete negotiatedPremiumPlayers[player.name];
  removePlayerFromRoster(player.name); // rückt ggf. den Sub in den frei werdenden Main-Slot nach

  // Der verkaufte Spieler ersetzt den bisher schwächsten Spieler des Bot-Teams.
  const idx = botTeam.players.findIndex((p) => p.name === weakest.name);
  if (idx !== -1) botTeam.players[idx] = { ...player };

  hideIncomingOfferModal();
  showNextIncomingOffer();
  renderAll();
  saveGameState();
}

function declineIncomingOffer() {
  hideIncomingOfferModal();
  showNextIncomingOffer();
}

function sendIncomingOfferCounter() {
  if (!currentIncomingOffer) return;
  const { botTeam, player, offerPrice } = currentIncomingOffer;
  const counterInput = document.getElementById('incoming-offer-counter');
  const messageInput = document.getElementById('incoming-offer-message');
  const counterPrice = Math.round(Number(counterInput.value) || 0);
  const message = messageInput.value.trim();

  if (message) appendIncomingOfferLine('user', message);
  appendIncomingOfferLine('user', 'Unsere Forderung: ' + formatMoney(counterPrice) + '.');
  messageInput.value = '';

  // Je mehr über dem ursprünglichen Angebot gefordert wird, desto unwilliger
  // wird die Org — dasselbe Prinzip wie beim Abwerben, nur umgekehrt.
  const demandSurplus = (counterPrice - offerPrice) / Math.max(1, offerPrice);
  const messageBonus = analyzeNegotiationMessage(message);
  let chance = 0.6 - demandSurplus * 0.5 + messageBonus;
  chance = Math.max(0.05, Math.min(0.9, chance));

  if (Math.random() < chance) {
    appendIncomingOfferLine('org', 'Abgemacht — wir zahlen ' + formatMoney(counterPrice) + ' für ' + player.name + '.');
    acceptIncomingOffer(counterPrice);
  } else {
    appendIncomingOfferLine('org', 'Das übersteigt unser Budget für diesen Transfer — wir ziehen das Angebot zurück.');
    hideIncomingOfferModal();
    showNextIncomingOffer();
  }
}

function buildCoachCard(c) {
  const price = calculatePrice(c.overall);
  const isDrafted = draftedCoachName === c.name;
  const coachSlotFull = draftedCoachName !== null;
  const canAfford = price <= getRemaining();
  const isLocked = !isDrafted && (coachSlotFull || !canAfford);

  return buildCard({
    overall: c.overall,
    name: c.name,
    price,
    isDrafted,
    isLocked,
    statPairs: COACH_STAT_LABELS.map(([key, label]) => [key, label, c[key]]),
    extraClass: 'coach-card',
    onClick: () => toggleDraftCoach(c),
  });
}

function renderOrgPanel() {
  const panel = document.getElementById('org-panel');
  panel.innerHTML = '';
  panel.className = 'org-panel';

  const title = document.createElement('div');
  title.className = 'org-title';
  title.textContent = assignedOrg.name + ' — Stärke ' + assignedOrg.strength;
  panel.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'org-line';
  desc.textContent = assignedOrg.description;
  panel.appendChild(desc);

  // Vertragsklausel "Transfers für KI-Teams sperren" (siehe generateBotTrades()/
  // generateIncomingOffers()) -- solange aktiv, kurzer Hinweis mit Enddatum.
  if (transfersLockedUntil && Date.now() < new Date(transfersLockedUntil).getTime()) {
    const lockLine = document.createElement('div');
    lockLine.className = 'org-line';
    lockLine.textContent = '🔒 KI-Transfers gesperrt bis ' + formatContractDate(new Date(transfersLockedUntil));
    panel.appendChild(lockLine);
  }
}

function formatContractDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm + '.' + date.getFullYear();
}

// ── careerDate-Arithmetik (Zeitzonen-sicher) ──────────────────────────────
// ECHTER BUG gefunden (Runde 39): careerDate ist ein reiner "YYYY-MM-DD"-Tag
// ohne Uhrzeit. Wird er über new Date(str + 'T00:00:00') geparst (= LOKALE
// Mitternacht) und danach über .toISOString() (= UTC) wieder zurück in einen
// String verwandelt, verschiebt sich das Datum in jeder Zeitzone mit
// positivem UTC-Offset (z.B. MEZ/MESZ, +1/+2h) um einen Tag zurück -- z.B.
// wurde aus dem WEITER-Button (Runde 31) durch genau dieses Muster
// stillschweigend ein Tag verschluckt. Fix: konsequent UTC verwenden (Suffix
// 'Z' beim Parsen + UTC-Methoden bei jeder Arithmetik), dann bleibt alles in
// sich konsistent, unabhängig von der Systemzeitzone. Gilt NUR für
// careerDate-artige reine Kalendertage -- formatContractDate() oben bleibt
// bewusst auf Ortszeit (für echte "jetzt"-Zeitpunkte wie das Vertragsdatum
// beim Unterschreiben, wo die lokale Zeit tatsächlich gewünscht ist).
function parseCareerDate(str) {
  return new Date(str + 'T00:00:00Z');
}

function formatCareerDateDisplay(str) {
  const date = parseCareerDate(str);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return dd + '.' + mm + '.' + date.getUTCFullYear();
}

function renderBudgetBar() {
  const bar = document.getElementById('budget-bar');
  bar.innerHTML = '';

  const remaining = getRemaining();
  const startersCount = rosterSlots.main.filter(Boolean).length;
  const subCount = rosterSlots.sub.filter(Boolean).length;
  const reserveCount = rosterSlots.reserve.filter(Boolean).length;

  const makeChip = (text) => {
    const chip = document.createElement('span');
    chip.className = 'budget-chip';
    chip.textContent = text;
    return chip;
  };

  bar.appendChild(makeChip('Spieler: ' + startersCount + ' / ' + MAIN_SIZE));
  bar.appendChild(makeChip('Sub: ' + subCount + ' / ' + SUB_SIZE));
  bar.appendChild(makeChip('Reserve: ' + reserveCount + ' / ' + RESERVE_SIZE));
  bar.appendChild(makeChip('Coach: ' + (draftedCoachName ? '1' : '0') + ' / 1'));

  const remainingChip = document.createElement('span');
  remainingChip.className = 'budget-chip budget-remaining' + (remaining < 0 ? ' budget-over' : '');
  remainingChip.textContent = 'Verbleibend: ' + formatMoney(remaining) + ' / ' + formatMoney(BUDGET);
  bar.appendChild(remainingChip);
}

function renderMatchButton() {
  const btn = document.getElementById('btn-start-match');
  const startersReady = rosterSlots.main.filter(Boolean).length >= MAIN_SIZE;
  const startLabel = careerState && careerState.seasonNumber > 1
    ? 'Saison ' + careerState.seasonNumber + ' starten'
    : 'Turnier starten';
  btn.disabled = !startersReady;
  btn.textContent = startersReady ? startLabel : startLabel + ' (erst ' + MAIN_SIZE + ' Starter draften)';
}

function renderCareerInfo() {
  const el = document.getElementById('career-info');
  if (!careerState || careerState.seasonNumber <= 1) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.textContent = 'Saison ' + careerState.seasonNumber + ' — ' + careerState.titlesWon + ' Titel gesamt';
}

function renderRosterSlot(container, label, filledContentBuilder) {
  const slot = document.createElement('div');
  const content = filledContentBuilder();
  if (content) {
    slot.className = 'roster-slot filled';
    slot.appendChild(content);
  } else {
    slot.className = 'roster-slot empty';
    slot.textContent = label;
  }
  container.appendChild(slot);
}

function buildSlotContent(name, price) {
  const wrap = document.createElement('div');
  wrap.innerHTML =
    '<span class="slot-name">' + name + '</span>' +
    '<span class="slot-price">' + formatMoney(price) + '</span>';
  return wrap;
}

function renderMyRoster() {
  const section = document.getElementById('my-roster');
  section.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'roster-heading';
  heading.textContent = 'Mein Kader';
  section.appendChild(heading);

  const slots = document.createElement('div');
  slots.className = 'roster-slots';

  rosterSlots.main.forEach((name, i) => {
    renderRosterSlot(slots, 'Starter ' + (i + 1), () =>
      name ? buildSlotContent(name, calculatePrice(findPlayer(name).overall)) : null);
  });
  renderRosterSlot(slots, 'Sub', () =>
    rosterSlots.sub[0] ? buildSlotContent(rosterSlots.sub[0], calculatePrice(findPlayer(rosterSlots.sub[0]).overall)) : null);
  rosterSlots.reserve.forEach((name, i) => {
    renderRosterSlot(slots, 'Reserve ' + (i + 1), () =>
      name ? buildSlotContent(name, calculatePrice(findPlayer(name).overall)) : null);
  });
  renderRosterSlot(slots, 'Coach', () =>
    draftedCoachName ? buildSlotContent(draftedCoachName, calculatePrice(findCoach(draftedCoachName).overall)) : null);

  section.appendChild(slots);

  const editBtn = document.createElement('button');
  editBtn.className = 'update-check-btn roster-edit-btn';
  editBtn.textContent = '🔀 Aufstellung bearbeiten (Main/Sub/Reserve/Coach tauschen)';
  editBtn.addEventListener('click', () => { renderRosterBoard(); showScreen('screen-roster'); });
  section.appendChild(editBtn);
}

function renderPlayerPool() {
  const container = document.getElementById('player-pool');
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'player-grid';

  TEST_PLAYERS
    .map((p) => findPlayer(p.name)) // ggf. weiterentwickelte Version statt Pool-Baseline
    .sort((a, b) => b.overall - a.overall)
    .forEach((p) => grid.appendChild(buildPlayerCard(p)));

  container.appendChild(grid);
}

function renderCoachPool() {
  const container = document.getElementById('coach-pool');
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'player-grid';

  TEST_COACHES
    .map((c) => findCoach(c.name)) // ggf. weiterentwickelte Version statt Pool-Baseline
    .sort((a, b) => b.overall - a.overall)
    .forEach((c) => grid.appendChild(buildCoachCard(c)));

  container.appendChild(grid);
}

function renderAll() {
  renderOrgPanel();
  renderCareerInfo();
  renderBudgetBar();
  renderMyRoster();
  renderMatchButton();
  renderPlayerPool();
  renderCoachPool();
  checkAchievements();
}

// ── Screen-Wechsel ───────────────────────────────────────────────────────
// #app-atmosphere (Logo-Wand + Trophäe, siehe index.html) wird NUR ein-/
// ausgeblendet, wenn zwischen "benutzt die gemeinsame Atmosphäre"
// (Hauptmenü/Slot-Sidebar) und einem GANZ ANDEREN Screen gewechselt wird --
// beim Wechsel ZWISCHEN Menü und Slot-Sidebar bleibt sie durchgehend
// sichtbar (User-Wunsch: Hintergrund darf dabei nicht neu laden/die
// Loop-Animation nicht unterbrechen).
const SHARED_ATMOSPHERE_SCREENS = ['screen-menu', 'screen-slots', 'screen-settings', 'screen-character', 'screen-org-mode-select', 'screen-org-select', 'screen-org-create'];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('app-atmosphere').classList.toggle('hidden', !SHARED_ATMOSPHERE_SCREENS.includes(id));
}

// ── Intro-Video (spielt bei JEDEM App-Start einmal ab, bewusst ohne
// "nicht mehr anzeigen"-Option — siehe User-Wunsch). Rein passiv: nichts
// anklickbar/hoverbar, kein Überspringen (siehe `pointer-events:none` in
// style.css). Ablauf: Video spielt sofort -> nach Ende langsames Ausblenden
// -> kurzer Blackscreen -> Hauptmenü fliegt animiert ein.
const INTRO_FADE_OUT_MS = 1200; // muss zur CSS-Transition auf #screen-intro passen
const INTRO_BLACKSCREEN_MS = 500;

// Spielt die Fly-in-Animation nur EINMAL direkt nach dem Intro ab — spätere
// Rückkehr zum Hauptmenü (z.B. "← Hauptmenü"-Buttons) läuft weiterhin ohne
// Animation, da beide Klassen danach wieder entfernt werden. Screen UND
// Inhalt faden gemeinsam (leicht zeitversetzt) ein, statt dass der
// Hintergrund hart aufpoppt und nur der Inhalt fliegt.
function showMenuWithFlyIn() {
  const menuScreen = document.getElementById('screen-menu');
  const menuWrap = document.querySelector('#screen-menu .mainmenu-left');
  menuScreen.classList.add('menu-screen-entering');
  menuWrap.classList.add('menu-flying-in');
  showScreen('screen-menu');
  centerMenuLogoOverNav();

  let cleaned = false;
  function cleanupFlyIn() {
    if (cleaned) return;
    cleaned = true;
    menuScreen.classList.remove('menu-screen-entering');
    menuWrap.classList.remove('menu-flying-in');
  }
  menuWrap.addEventListener('animationend', cleanupFlyIn, { once: true });
  // Sicherheitsnetz: 'animationend' kann in Fenstern ohne echten fokussierten
  // Compositor-Frame ausbleiben (bekanntes Muster, siehe die Settings-Tab-
  // Fade-Lektion) — Klassen spätestens nach Animationsdauer + Puffer trotzdem
  // entfernen, damit ein späterer normaler Menü-Besuch nie versehentlich
  // erneut einfliegt.
  setTimeout(cleanupFlyIn, 1500);
}

// ── Rechtlicher Hinweis (spielt nach dem Intro-Video ab, vor dem Hauptmenü).
// Rein passiv wie das Intro (nichts anklickbar/hoverbar, kein Überspringen).
// Ablauf: langsames Einblenden -> kurz stehen bleiben -> langsames
// Ausblenden -> kurzer Blackscreen -> Hauptmenü fliegt animiert ein.
const LEGAL_FADE_IN_MS = 900; // muss zur CSS-Transition auf #screen-legal passen
const LEGAL_HOLD_MS = 3200;
const LEGAL_FADE_OUT_MS = 900;
const LEGAL_BLACKSCREEN_MS = 500;

function playLegalScreen() {
  const legalScreen = document.getElementById('screen-legal');
  showScreen('screen-legal');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => legalScreen.classList.add('is-visible'));
  });

  setTimeout(() => {
    legalScreen.classList.add('is-leaving');
    setTimeout(() => {
      setTimeout(showMenuWithFlyIn, LEGAL_BLACKSCREEN_MS);
    }, LEGAL_FADE_OUT_MS);
  }, LEGAL_FADE_IN_MS + LEGAL_HOLD_MS);
}

async function playIntro() {
  const introScreen = document.getElementById('screen-intro');
  const introVideo = document.getElementById('intro-video');
  // `initSettings()` ist eine gehoistete Funktionsdeklaration (weiter unten im
  // Skript definiert, aber vollständig hoisted) -- ohne dieses Warten würde
  // die Lautstärke hier noch den hartkodierten appSettings-Default lesen,
  // nicht den tatsächlich gespeicherten Wert (IPC-Ladevorgang wäre sonst
  // noch nicht abgeschlossen). Der spätere reguläre initSettings()-Aufruf
  // bleibt bestehen und lädt redundant, aber harmlos, ein zweites Mal.
  await initSettings();
  introVideo.volume = Math.max(0, Math.min(1, appSettings.introVideoVolume));
  let finished = false;

  function finishIntro() {
    if (finished) return; // Sicherheitsnetz: 'ended' und 'error' könnten theoretisch beide feuern
    finished = true;
    // Wiedergabe/Decoder sauber stoppen -- das Video wird nie wieder gebraucht
    // (spielt genau einmal pro App-Start), sonst würde es unsichtbar im
    // Hintergrund weiterlaufen bzw. Ressourcen belegen.
    introVideo.pause();
    introVideo.removeAttribute('src');
    introVideo.load();
    introScreen.classList.add('is-leaving');
    // Hintergrundmusik startet erst NACH dem Intro (nicht gleichzeitig, um
    // nicht mit dessen eigenem Ton zu überlagern) -- läuft danach app-weit
    // durch, bis das Programm beendet wird.
    startBackgroundMusic();
    setTimeout(() => {
      setTimeout(playLegalScreen, INTRO_BLACKSCREEN_MS);
    }, INTRO_FADE_OUT_MS);
  }

  // Fällt das Video aus irgendeinem Grund aus (Datei fehlt/defekt, Wiedergabe
  // vom System verweigert), soll das Spiel NIE im Blackscreen hängen bleiben
  // — sofort zum Ausblenden/Hauptmenü übergehen statt zu warten.
  introVideo.addEventListener('ended', finishIntro);
  introVideo.addEventListener('error', finishIntro);
  introVideo.play().catch(finishIntro);
}
playIntro();

// ── Transfer-Historie: alle abgeschlossenen Wechsel als Liste ───────────────
function renderTransferLog() {
  const container = document.getElementById('transfer-log-list');
  container.innerHTML = '';

  if (transferLog.length === 0) {
    container.innerHTML = '<div class="transfer-log-empty">Noch keine Transfers in dieser Karriere.</div>';
    return;
  }

  let lastSeason = null;
  transferLog.forEach((entry) => {
    if (entry.season !== lastSeason) {
      const heading = document.createElement('div');
      heading.className = 'transfer-season-heading';
      heading.textContent = 'Saison ' + entry.season;
      container.appendChild(heading);
      lastSeason = entry.season;
    }

    const row = document.createElement('div');
    row.className = 'transfer-row';
    row.innerHTML =
      '<span class="transfer-row-from">' + entry.from + '</span>' +
      '<span class="transfer-row-player">(' + entry.player + ')</span>' +
      '<span class="transfer-row-arrow">→</span>' +
      '<span class="transfer-row-to">' + entry.to + '</span>' +
      '<span class="transfer-row-price">' + formatMoney(entry.price) + '</span>';
    container.appendChild(row);
  });
}

// ── Erfolge (Achievements) ───────────────────────────────────────────────
// Nur aktiv, wenn beim Vertrag "Erfolge aktiviert" angehakt wurde (siehe
// achievementsEnabled, gesetzt in confirmOrgAndProceed()). Bedingungen
// greifen ausschließlich auf bereits vorhandene Karriere-Werte zurück (kein
// neues Tracking-System nötig) -- transferCount zählt bewusst nur Transfers,
// an denen die EIGENE Org beteiligt ist (nicht Bot-zu-Bot-Trades).
const ACHIEVEMENTS = [
  { id: 'season2', title: 'Erste Saison überstanden', desc: 'Erreiche Saison 2.', check: () => careerState.seasonNumber >= 2 },
  { id: 'title1', title: 'Erster Titel', desc: 'Gewinne deine erste Meisterschaft.', check: () => careerState.titlesWon >= 1 },
  { id: 'title3', title: 'Dynastie', desc: 'Gewinne 3 Meisterschaften.', check: () => careerState.titlesWon >= 3 },
  { id: 'season5', title: 'Veteran', desc: 'Erreiche Saison 5.', check: () => careerState.seasonNumber >= 5 },
  { id: 'budget5m', title: 'Großinvestor', desc: 'Erreiche ein Budget von 5.000.000 €.', check: () => BUDGET >= 5000000 },
  { id: 'playtime1h', title: 'Vielspieler', desc: 'Spiele 1 Stunde in dieser Karriere.', check: () => careerPlaytimeSeconds >= 3600 },
  {
    id: 'transfers10',
    title: 'Marktaktivität',
    desc: 'Sei an 10 Transfers beteiligt (eigene Käufe/Verkäufe).',
    check: () => transferLog.filter((t) => t.from === assignedOrg.name || t.to === assignedOrg.name).length >= 10,
  },
  {
    id: 'elite90',
    title: 'Elitekader',
    desc: 'Erreiche einen Kader-Schnitt von 90 Overall.',
    check: () => {
      const all = [...(careerRosterPlayers || []), ...(careerReservePlayers || [])];
      if (all.length === 0) return false;
      return (all.reduce((sum, p) => sum + p.overall, 0) / all.length) >= 90;
    },
  },
];

function showAchievementToast(title) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML =
    '<span class="achievement-toast-icon">🏆</span>' +
    '<div><div class="achievement-toast-label">Erfolg freigeschaltet</div><div class="achievement-toast-title">' + title + '</div></div>';
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 500);
  }, 3800);
}

// Läuft bei jedem renderAll() mit (Draft-/Roster-/Turnier-Bildschirme rendern
// häufig genug, damit neue Erfolge zeitnah auffallen, ohne dass jede
// einzelne auslösende Stelle im Code extra daran denken muss).
function checkAchievements() {
  if (!achievementsEnabled || !careerState) return;
  ACHIEVEMENTS.forEach((a) => {
    if (unlockedAchievements.includes(a.id)) return;
    if (a.check()) {
      unlockedAchievements.push(a.id);
      showAchievementToast(a.title);
    }
  });
}

function renderAchievements() {
  const container = document.getElementById('achievements-list');
  container.innerHTML = '';
  if (!achievementsEnabled) {
    container.innerHTML = '<div class="transfer-log-empty">Erfolge sind für diese Karriere deaktiviert (beim Vertrag nicht angehakt).</div>';
    return;
  }
  ACHIEVEMENTS.forEach((a) => {
    const unlocked = unlockedAchievements.includes(a.id);
    const card = document.createElement('div');
    card.className = 'achievement-card' + (unlocked ? ' is-unlocked' : '');
    card.innerHTML =
      '<span class="achievement-card-icon">' + (unlocked ? '🏆' : '🔒') + '</span>' +
      '<div><div class="achievement-card-title">' + a.title + '</div><div class="achievement-card-desc">' + a.desc + '</div></div>';
    container.appendChild(card);
  });
}

// ── Kader-Aufstellung: Drag&Drop zwischen Main/Sub/Reserve/Coach ────────────
// Main/Sub/Reserve sind echte, einzeln adressierbare Slots (rosterSlots) —
// Drag&Drop tauscht einfach den Inhalt von zwei Slots. "kind" trennt Spieler-
// von Coach-Slots: ein Spieler kann nie auf den Coach-Slot gezogen werden
// (und umgekehrt), da dataTransfer beim Drop-Handler auf gleiches "kind"
// geprüft wird. Der Coach-Slot ist rein statisch (es gibt nur 1 Coach-Platz,
// also nichts zum Tauschen) — kein Drag-Handler nötig.
function buildDraggableSlotCard(kind, slotType, index, name) {
  const box = document.createElement('div');
  box.className = 'roster-board-slot' + (name ? ' filled' : ' empty');

  if (!name) {
    box.textContent = kind === 'coach' ? 'Kein Coach' : 'Leer';
    if (kind === 'player') {
      box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag-over'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
      box.addEventListener('drop', (e) => {
        e.preventDefault();
        box.classList.remove('drag-over');
        const from = JSON.parse(e.dataTransfer.getData('text/plain'));
        handleRosterSlotDrop(from, { kind, slotType, index });
      });
    }
    return box;
  }

  const entity = kind === 'coach' ? findCoach(name) : findPlayer(name);
  box.innerHTML =
    '<div class="roster-board-slot-rating">' + entity.overall + '</div>' +
    '<div class="roster-board-slot-name">' + name + '</div>';

  if (kind === 'player') {
    box.draggable = true;
    box.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind, slotType, index }));
      e.dataTransfer.effectAllowed = 'move';
    });
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag-over'); });
    box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('drag-over');
      const from = JSON.parse(e.dataTransfer.getData('text/plain'));
      handleRosterSlotDrop(from, { kind, slotType, index });
    });
  }

  return box;
}

// Tauscht den Inhalt zweier Spieler-Slots (Main/Sub/Reserve, in jeder
// Kombination) — funktioniert auch, wenn das Ziel leer ist (dann rückt einfach
// null in den Ursprungs-Slot). Coach wird hier bewusst nicht behandelt (siehe
// Kommentar oben — es gibt nichts zum Tauschen).
function handleRosterSlotDrop(from, to) {
  if (from.kind !== to.kind || from.kind !== 'player') return;
  if (from.slotType === to.slotType && from.index === to.index) return;

  const fromArr = rosterSlots[from.slotType];
  const toArr = rosterSlots[to.slotType];
  const tmp = toArr[to.index];
  toArr[to.index] = fromArr[from.index];
  fromArr[from.index] = tmp;

  renderAll();
  renderRosterBoard();
  saveGameState();
}

function renderRosterBoard() {
  const mainEl = document.getElementById('roster-board-main');
  const subEl = document.getElementById('roster-board-sub');
  const reserveEl = document.getElementById('roster-board-reserve');
  const coachEl = document.getElementById('roster-board-coach');
  [mainEl, subEl, reserveEl, coachEl].forEach((el) => { el.innerHTML = ''; });

  rosterSlots.main.forEach((name, i) => mainEl.appendChild(buildDraggableSlotCard('player', 'main', i, name)));
  rosterSlots.sub.forEach((name, i) => subEl.appendChild(buildDraggableSlotCard('player', 'sub', i, name)));
  rosterSlots.reserve.forEach((name, i) => reserveEl.appendChild(buildDraggableSlotCard('player', 'reserve', i, name)));
  coachEl.appendChild(buildDraggableSlotCard('coach', 'coach', 0, draftedCoachName));
}

// ── Charaktererstellung (läuft VOR der Org-Zuweisung) ───────────────────
// User-Wunsch: bevor man eine Organisation übernimmt, erstellt man einen
// eigenen Charakter (Nick/Name/Geschlecht/Nation/Geburtsdatum/Avatar +
// Eigenschafts-Regler). Die Regler bringen klare spielmechanische Effekte
// (siehe data/character-traits.js: computeCharacterEffects()), nicht nur
// Flavourtext. "Manager" im UI wird ab hier durch den Charakternamen ersetzt.
let careerCharacter = null; // { name, firstName, lastName, gender, nation, birthdate, avatarId, traits }
let characterTraitValues = null; // transiente Regler-Werte während der Erstellung: { axisId: -20..20 }
let selectedCharacterGender = 'M';
let selectedCharacterAvatarId = null;
let selectedCharacterNation = null;
let selectedCharacterPortraitUrl = null; // eigenes hochgeladenes/ausgewähltes Portrait-Bild (file://-URL), null = Platzhalter

function goToCharacterCreation() {
  careerCharacter = null;
  document.getElementById('char-nick-input').value = '';
  document.getElementById('char-firstname-input').value = '';
  document.getElementById('char-lastname-input').value = '';
  document.getElementById('character-error').classList.add('hidden');

  selectedCharacterGender = 'M';
  document.querySelectorAll('.character-gender-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.gender === 'M'));

  populateCharacterNationSelect();
  selectCharacterNation(CHARACTER_NATIONS[0].code);
  document.getElementById('char-nation-menu').classList.add('hidden');

  populateCharacterBirthdateSelects();
  document.getElementById('char-birthday-day').value = '';
  document.getElementById('char-birthday-month').value = '';
  document.getElementById('char-birthday-year').value = '';

  characterTraitValues = defaultCharacterTraits();
  renderCharacterTraitList();

  assignCharacterAvatar();

  // Fire-and-forget: lädt die Vorlagenliste bei Bedarf nach und zeigt dann
  // sofort ein zufälliges, zum Geschlecht passendes Portrait -- User-Wunsch:
  // beim Öffnen soll IMMER schon ein Portrait geladen/sichtbar sein, nicht
  // erst der leere Platzhalter.
  assignRandomPortrait();
  closePortraitPicker(true);
  closeManagerPicker(true);

  document.getElementById('character-overlay').classList.remove('is-closing');
  updateCharacterContinueState();
  showScreen('screen-character');
}

// Spielt die Slide-out-Animation ab, BEVOR tatsächlich zurückgewechselt wird
// -- spiegelt closeSlotPicker()/closeSettingsSidebar() 1:1 (gleiches
// .is-closing + 'animationend'-mit-Sicherheitsnetz-Muster). Geht zurück zur
// Slot-Sidebar (nicht zum Hauptmenü) -- goToCharacterCreation() wird
// ausschließlich aus dem Slot-Picker im 'new'-Modus erreicht (leerer Slot
// oder "+ Neuen Slot erstellen", siehe onSlotChosen()), User-Wunsch: von dort
// zurückspringen können, ohne "Neues Spiel" erneut anklicken zu müssen.
// #app-atmosphere bleibt dabei durchgehend sichtbar (siehe SHARED_ATMOSPHERE_SCREENS).
function closeCharacterOverlay() {
  const overlay = document.getElementById('character-overlay');
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    overlay.classList.remove('is-closing');
    openSlotPicker('new');
  }
  overlay.classList.add('is-closing');
  overlay.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 500);
}

// ── Eigenschafts-Regler (Punkte-Pool) ────────────────────────────────────
// Jede Achse hat ZWEI eigenständige Pole (z.B. Kommunikation UND Finanz-
// kompetenz, siehe character-traits.js) -- characterTraitValues[axisId] ist
// { left, right }, beide 0-20 und komplett unabhängig voneinander (User-
// Korrektur: vorher waren sie fälschlich gegenseitig exklusiv, das Bewegen
// des einen Reglers hat den anderen wieder auf 0 zurückgesetzt).
function characterPointsSpent() {
  return CHARACTER_TRAIT_AXES.reduce((sum, axis) => {
    const entry = characterTraitValues[axis.id] || {};
    return sum + (entry.left || 0) + (entry.right || 0);
  }, 0);
}

function updateCharacterPointsDisplay() {
  document.getElementById('character-points-value').textContent = CHARACTER_POINT_POOL - characterPointsSpent();
}

// Zwei native <input type="range" min="0" max="20"> pro Achse (rechter
// Regler + linker Regler, siehe .trait-axis-slider-left in style.css für den
// per direction:rtl gespiegelten linken Regler) -- User-Wunsch, orientiert an
// der Referenz-Vorlage, wo beide Pole als eigenständig greifbare, UNABHÄNGIGE
// Regler sichtbar sind (kein "entweder-oder" wie bei einem bipolaren Regler).
function renderTraitSliderFill(slider, side, magnitude) {
  const pct = (magnitude / 20) * 100;
  if (side === 'right') {
    slider.style.background =
      'linear-gradient(to right, #3ecf72 0%, #3ecf72 ' + pct + '%, #232d52 ' + pct + '%, #232d52 100%)';
  } else {
    const from = 100 - pct;
    slider.style.background =
      'linear-gradient(to right, #232d52 0%, #232d52 ' + from + '%, #3ecf72 ' + from + '%, #3ecf72 100%)';
  }
}

// Liest die aktuellen { left, right }-Werte der Achse und spiegelt sie auf
// beide Regler -- rein darstellend, ändert an den Werten selbst nichts.
function syncTraitAxisSliders(container, axisId) {
  const entry = characterTraitValues[axisId] || { left: 0, right: 0 };
  const rightSlider = container.querySelector('.trait-axis-slider-right[data-axis-id="' + axisId + '"]');
  const leftSlider = container.querySelector('.trait-axis-slider-left[data-axis-id="' + axisId + '"]');
  rightSlider.value = entry.right || 0;
  leftSlider.value = entry.left || 0;
  renderTraitSliderFill(rightSlider, 'right', entry.right || 0);
  renderTraitSliderFill(leftSlider, 'left', entry.left || 0);
}

function renderCharacterTraitList() {
  const container = document.getElementById('character-trait-list');
  container.innerHTML = CHARACTER_TRAIT_AXES.map((axis) =>
    '<div class="trait-axis-row">' +
      '<div class="trait-axis-labels"><span class="trait-axis-label-left">' + axis.leftLabel + '</span><span class="trait-axis-label-right">' + axis.rightLabel + '</span></div>' +
      '<div class="trait-axis-track">' +
        '<input type="range" min="0" max="20" step="1" value="0" class="trait-axis-slider trait-axis-slider-left" data-axis-id="' + axis.id + '" data-side="left" />' +
        '<input type="range" min="0" max="20" step="1" value="0" class="trait-axis-slider trait-axis-slider-right" data-axis-id="' + axis.id + '" data-side="right" />' +
      '</div>' +
      '<div class="trait-axis-ticks"><span>20</span><span>15</span><span>10</span><span>5</span><span>0</span><span>0</span><span>5</span><span>10</span><span>15</span><span>20</span></div>' +
    '</div>'
  ).join('');

  container.querySelectorAll('.trait-axis-slider').forEach((slider) => {
    const axisId = slider.dataset.axisId;
    const side = slider.dataset.side;
    slider.addEventListener('input', () => {
      const requested = Number(slider.value);
      const entry = characterTraitValues[axisId] || (characterTraitValues[axisId] = { left: 0, right: 0 });
      const othersSpent = characterPointsSpent() - (entry[side] || 0);
      const maxAffordable = Math.max(0, Math.min(20, CHARACTER_POINT_POOL - othersSpent));
      entry[side] = Math.max(0, Math.min(maxAffordable, requested));
      syncTraitAxisSliders(container, axisId);
      updateCharacterPointsDisplay();
    });
  });

  CHARACTER_TRAIT_AXES.forEach((axis) => syncTraitAxisSliders(container, axis.id));
  updateCharacterPointsDisplay();
}

function randomizeCharacterTraits() {
  characterTraitValues = defaultCharacterTraits();
  const poles = [];
  CHARACTER_TRAIT_AXES.forEach((axis) => {
    poles.push({ axisId: axis.id, side: 'left' });
    poles.push({ axisId: axis.id, side: 'right' });
  });
  const poleOrder = poles.sort(() => Math.random() - 0.5);
  let remaining = CHARACTER_POINT_POOL;
  poleOrder.forEach((pole, i) => {
    if (remaining <= 0) return;
    const isLast = i === poleOrder.length - 1;
    const raw = isLast ? remaining : Math.floor(Math.random() * (remaining + 1));
    const amount = Math.min(20, raw);
    characterTraitValues[pole.axisId][pole.side] = amount;
    remaining -= amount;
  });
  renderCharacterTraitList();
}

// ── Identität (Nation/Geburtsdatum/Avatar) ───────────────────────────────
const CHARACTER_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Custom Dropdown statt nativem <select> -- siehe Kommentar bei .char-dropdown
// in style.css: native <select>/<option> werden unter Windows vom
// Betriebssystem gerendert, wo Flaggen-Emoji oft nur als Länderkürzel-Text
// statt echter Flagge erscheinen. Ein Div-basiertes Dropdown läuft komplett
// durch Chromiums eigenes Rendering und zeigt die Flaggen korrekt an.
function characterFlagImgHtml(code) {
  return '<img class="char-flag-icon" src="assets/flags/' + code.toLowerCase() + '.svg" alt="">';
}

function populateCharacterNationSelect() {
  const menu = document.getElementById('char-nation-menu');
  menu.innerHTML = CHARACTER_NATIONS.map((n) =>
    '<div class="char-dropdown-option" data-code="' + n.code + '">' + characterFlagImgHtml(n.code) + ' ' + n.name + '</div>'
  ).join('');
  menu.querySelectorAll('.char-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      selectCharacterNation(opt.dataset.code);
      menu.classList.add('hidden');
    });
  });
}

function selectCharacterNation(code) {
  selectedCharacterNation = code;
  const nation = CHARACTER_NATIONS.find((n) => n.code === code);
  const trigger = document.getElementById('char-nation-trigger');
  trigger.innerHTML = characterFlagImgHtml(nation.code) + ' ' + nation.name;
  document.querySelectorAll('#char-nation-menu .char-dropdown-option').forEach((opt) => {
    opt.classList.toggle('is-selected', opt.dataset.code === code);
  });
  updateCharacterContinueState();
}

function populateCharacterBirthdateSelects() {
  document.getElementById('char-birthday-day').innerHTML =
    '<option value="">Tag</option>' + Array.from({ length: 31 }, (_, i) => i + 1).map((d) => '<option value="' + d + '">' + d + '</option>').join('');
  document.getElementById('char-birthday-month').innerHTML =
    '<option value="">Monat</option>' + CHARACTER_MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 18; y >= currentYear - 60; y--) years.push(y);
  document.getElementById('char-birthday-year').innerHTML =
    '<option value="">Jahr</option>' + years.map((y) => '<option value="' + y + '">' + y + '</option>').join('');
}

function randomizeCharacterBirthdate() {
  const currentYear = new Date().getFullYear();
  const day = 1 + Math.floor(Math.random() * 28); // 28, um ungültige Tage (z.B. 30. Feb) zu vermeiden
  const month = 1 + Math.floor(Math.random() * 12);
  const year = currentYear - 18 - Math.floor(Math.random() * 43); // 18..60 Jahre alt
  document.getElementById('char-birthday-day').value = String(day);
  document.getElementById('char-birthday-month').value = String(month);
  document.getElementById('char-birthday-year').value = String(year);
  updateCharacterContinueState();
}

// Kein Auswahl-Grid mehr (die Charaktererstellung zeigt nur noch den
// Portrait-Platzhalterblock, echte Manager-Portraits kommen als spätere
// Projekt-Assets dazu) -- der Avatar wird deshalb automatisch passend zum
// gewählten Geschlecht zugewiesen (bleibt intern u.a. für die Geschäfts-
// führer-Anzeige im Org-Vorschau-Panel relevant, siehe personAvatarBlockHtml()).
function assignCharacterAvatar() {
  const options = CHARACTER_AVATARS.filter((a) => a.gender === selectedCharacterGender);
  selectedCharacterAvatarId = options[Math.floor(Math.random() * options.length)].id;
  updateCharacterContinueState();
}

// ── Portrait: Hochladen (nativer Datei-Dialog) + Auswählen (Vorlagen-
// Sidebar) ────────────────────────────────────────────────────────────────
function renderCharacterPortraitPreview() {
  const frame = document.getElementById('character-portrait-frame');
  frame.innerHTML = selectedCharacterPortraitUrl
    ? '<img class="character-portrait-image" src="' + selectedCharacterPortraitUrl + '" alt="">'
    : '<span class="character-portrait-placeholder">👤</span><span class="character-portrait-note">Portrait kommt später</span>';
}

// Würfelt ein zufälliges Vorlagen-Portrait passend zum aktuell gewählten
// Geschlecht (dieselbe Filterung wie renderPortraitPickerGrid()) -- genutzt
// beim frischen Öffnen der Charaktererstellung, bei Geschlecht-Wechsel und
// von randomizeCharacterIdentity() ("Zufällig"/"Alles zufällig"). Lädt die
// Vorlagenliste bei Bedarf nach (derselbe Cache wie die Auswahl-Sidebar). Kein
// manuell hochgeladenes/ausgewähltes Bild wird dabei überschrieben, AUSSER
// genau in diesen Fällen -- ein manuelles Bild bleibt bei allen anderen
// Aktionen (z.B. Regler bewegen) unangetastet.
async function assignRandomPortrait() {
  if (!portraitPresetsCache) {
    portraitPresetsCache = await window.electronAPI.listPortraitPresets();
  }
  const options = portraitPresetsCache.filter((p) => !p.gender || p.gender === selectedCharacterGender);
  selectedCharacterPortraitUrl = options.length > 0 ? options[Math.floor(Math.random() * options.length)].url : null;
  renderCharacterPortraitPreview();
}

// Beide rechten Sidebars (Portrait- und Manager-Auswahl) teilen sich diesen
// Content-Shift/Button-Shift-Zustand -- siehe .character-content.
// side-panel-open und .character-overlay.side-panel-open in style.css.
function setSidePanelOpen(isOpen) {
  document.getElementById('character-content').classList.toggle('side-panel-open', isOpen);
  document.getElementById('character-overlay').classList.toggle('side-panel-open', isOpen);
}

// Generisches Öffnen/Schließen einer der beiden Sidebars (spiegelt
// closeSlotPicker() usw.: .is-closing-Klasse + 'animationend' mit
// Sicherheitsnetz). `instant` überspringt die Animation (z.B. beim
// Zurücksetzen für eine neue Charaktererstellung, wo noch nichts sichtbar
// offen war).
function closeCharSidebar(sidebar, instant) {
  if (instant || sidebar.classList.contains('hidden')) {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('is-closing');
    setSidePanelOpen(false);
    return;
  }
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sidebar.classList.add('hidden');
    sidebar.classList.remove('is-closing');
  }
  sidebar.classList.add('is-closing');
  sidebar.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 400);
  setSidePanelOpen(false);
}

// Einmal pro Sitzung geladen (nicht bei jedem Öffnen neu per IPC) -- die
// Vorlagenliste ändert sich zur Laufzeit nicht.
let portraitPresetsCache = null;

async function openPortraitPicker() {
  closeCharSidebar(document.getElementById('manager-picker-sidebar'), true); // nur eine Sidebar gleichzeitig offen
  setSidePanelOpen(true);
  const sidebar = document.getElementById('portrait-picker-sidebar');
  sidebar.classList.remove('hidden', 'is-closing');

  if (!portraitPresetsCache) {
    portraitPresetsCache = await window.electronAPI.listPortraitPresets();
  }
  renderPortraitPickerGrid();
}

// Zeigt nur Vorlagen passend zum aktuell gewählten Geschlecht (Dateiname-
// Präfix frau_/mann_ in assets/Manager_Portrai/, siehe list-portrait-presets
// in main.js) -- User-Wunsch: F-Auswahl zeigt nur "frau"-Bilder, M-Auswahl
// nur "mann"-Bilder. Wird auch beim Umschalten des Geschlecht-Toggles
// erneut aufgerufen, falls die Sidebar gerade offen ist.
function renderPortraitPickerGrid() {
  const grid = document.getElementById('portrait-picker-grid');
  const options = (portraitPresetsCache || []).filter((p) => !p.gender || p.gender === selectedCharacterGender);
  if (options.length === 0) {
    grid.innerHTML = '<p class="portrait-picker-empty">Noch keine Portrait-Vorlagen für dieses Geschlecht im Projekt -- bis dahin über "Hochladen" ein eigenes Bild wählen.</p>';
    return;
  }
  grid.innerHTML = options.map((p) =>
    '<div class="portrait-picker-item' + (p.url === selectedCharacterPortraitUrl ? ' is-selected' : '') + '" data-url="' + p.url + '">' +
      '<img src="' + p.url + '" alt="">' +
    '</div>'
  ).join('');
  grid.querySelectorAll('.portrait-picker-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedCharacterPortraitUrl = item.dataset.url;
      renderCharacterPortraitPreview();
      renderPortraitPickerGrid();
    });
  });
}

function closePortraitPicker(instant) {
  closeCharSidebar(document.getElementById('portrait-picker-sidebar'), instant);
}

// ── Manager-Vorlagen-Sidebar ("Manager auswählen"-Button) ────────────────
// Ersetzt das frühere sofortige Zufalls-und-weiter (quickStartCharacter()) --
// zeigt stattdessen alle je fertig erstellten Manager (dauerhaft über alle
// Karrieren hinweg, siehe manager-templates.json in main.js) zur
// Wiederverwendung an.
async function openManagerPicker() {
  closeCharSidebar(document.getElementById('portrait-picker-sidebar'), true); // nur eine Sidebar gleichzeitig offen
  setSidePanelOpen(true);
  const sidebar = document.getElementById('manager-picker-sidebar');
  sidebar.classList.remove('hidden', 'is-closing');

  const list = await window.electronAPI.listManagerTemplates();
  renderManagerPickerList(list);
}

function renderManagerPickerList(list) {
  const container = document.getElementById('manager-picker-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="slot-empty-label">Noch keine Manager erstellt.</p>';
    return;
  }
  container.innerHTML = list.map((m) => {
    const avatar = CHARACTER_AVATARS.find((a) => a.id === m.avatarId) || CHARACTER_AVATARS[0];
    const avatarHtml = m.portraitUrl
      ? '<img class="slot-card-avatar" src="' + m.portraitUrl + '" alt="">'
      : '<div class="slot-card-avatar" style="background:' + avatar.color + '33;">' + avatar.emoji + '</div>';
    return (
      '<div class="slot-card" data-template-id="' + m.id + '">' +
        avatarHtml +
        '<div class="slot-card-info">' +
          '<div class="slot-org">' + m.name + '</div>' +
          '<div class="slot-meta">' + m.firstName + ' ' + m.lastName + '</div>' +
        '</div>' +
        '<button class="slot-delete-btn" title="Manager löschen">✕</button>' +
      '</div>'
    );
  }).join('');

  container.querySelectorAll('.slot-card').forEach((card) => {
    const id = Number(card.dataset.templateId);
    card.addEventListener('click', () => selectManagerTemplate(list.find((m) => m.id === id)));
    card.querySelector('.slot-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await window.electronAPI.deleteManagerTemplate(id);
      renderManagerPickerList(updated);
    });
  });
}

// Übernimmt eine gespeicherte Vorlage 1:1 als careerCharacter und geht direkt
// weiter -- bewusst OHNE erneuten Aufruf von confirmCharacterAndProceed()s
// Speicher-Logik, sonst würde jede Wiederverwendung die Bibliothek mit
// Duplikaten der immer gleichen Vorlage füllen.
function selectManagerTemplate(template) {
  if (!template) return;
  const { id, ...character } = template;
  careerCharacter = character;
  closeManagerPicker(true);
  goToOrgModeSelect();
}

function closeManagerPicker(instant) {
  closeCharSidebar(document.getElementById('manager-picker-sidebar'), instant);
}

function updateCharacterContinueState() {
  const nick = document.getElementById('char-nick-input').value.trim();
  const firstName = document.getElementById('char-firstname-input').value.trim();
  const lastName = document.getElementById('char-lastname-input').value.trim();
  const day = document.getElementById('char-birthday-day').value;
  const month = document.getElementById('char-birthday-month').value;
  const year = document.getElementById('char-birthday-year').value;
  const ready = nick.length > 0 && firstName.length > 0 && lastName.length > 0 &&
    !!selectedCharacterNation && !!day && !!month && !!year && !!selectedCharacterAvatarId;
  document.getElementById('btn-character-continue').disabled = !ready;
}

// ── "Alles zufällig" / "Manager auswählen" ───────────────────────────────
// Gesplittet von den Eigenschafts-Reglern (randomizeCharacterTraits()) --
// füllt nur Geschlecht/Name/Nick/Nation/Geburtsdatum/Avatar, rührt die
// Punkte-Regler links nicht an. Wird sowohl vom eigenen "Zufällig"-Button
// im Portrait-Block als auch von randomizeAllCharacterFields() unten genutzt.
function randomizeCharacterIdentity() {
  selectedCharacterGender = Math.random() < 0.5 ? 'M' : 'F';
  document.querySelectorAll('.character-gender-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.gender === selectedCharacterGender));

  const firstNames = selectedCharacterGender === 'F' ? CHARACTER_RANDOM_FIRST_NAMES_F : CHARACTER_RANDOM_FIRST_NAMES_M;
  document.getElementById('char-firstname-input').value = firstNames[Math.floor(Math.random() * firstNames.length)];
  document.getElementById('char-lastname-input').value = CHARACTER_RANDOM_LAST_NAMES[Math.floor(Math.random() * CHARACTER_RANDOM_LAST_NAMES.length)];
  document.getElementById('char-nick-input').value =
    CHARACTER_RANDOM_NICK_PREFIXES[Math.floor(Math.random() * CHARACTER_RANDOM_NICK_PREFIXES.length)] +
    CHARACTER_RANDOM_NICK_SUFFIXES[Math.floor(Math.random() * CHARACTER_RANDOM_NICK_SUFFIXES.length)];

  const nation = CHARACTER_NATIONS[Math.floor(Math.random() * CHARACTER_NATIONS.length)];
  selectCharacterNation(nation.code);

  randomizeCharacterBirthdate();
  assignCharacterAvatar();
  assignRandomPortrait(); // User-Wunsch: "Zufällig"/"Alles zufällig" würfelt auch ein passendes Portrait
  updateCharacterContinueState();
}

function randomizeAllCharacterFields() {
  randomizeCharacterIdentity();
  randomizeCharacterTraits();
}

// Speichert die frisch ausgefüllte Vorlage dauerhaft in der Manager-
// Bibliothek (siehe manager-templates.json in main.js) -- NUR hier, nicht
// bei selectManagerTemplate() (sonst würde jede Wiederverwendung einer
// bereits gespeicherten Vorlage die Bibliothek mit Duplikaten füllen).
async function confirmCharacterAndProceed() {
  const nick = document.getElementById('char-nick-input').value.trim();
  const firstName = document.getElementById('char-firstname-input').value.trim();
  const lastName = document.getElementById('char-lastname-input').value.trim();
  const nation = selectedCharacterNation;
  const day = document.getElementById('char-birthday-day').value;
  const month = document.getElementById('char-birthday-month').value;
  const year = document.getElementById('char-birthday-year').value;

  if (!nick || !firstName || !lastName || !nation || !day || !month || !year || !selectedCharacterAvatarId) {
    const err = document.getElementById('character-error');
    err.textContent = 'Bitte alle Pflichtfelder (*) ausfüllen.';
    err.classList.remove('hidden');
    return;
  }

  careerCharacter = {
    name: nick,
    firstName,
    lastName,
    gender: selectedCharacterGender,
    nation,
    birthdate: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
    avatarId: selectedCharacterAvatarId,
    portraitUrl: selectedCharacterPortraitUrl,
    traits: { ...characterTraitValues },
  };
  await window.electronAPI.saveManagerTemplate(careerCharacter);
  goToOrgModeSelect();
}

// ── Organisations-Modus (bestehende Org übernehmen oder eigene erstellen) ──
// "Organisation erstellen" ist bewusst noch deaktiviert ("Kommt noch") --
// eigene Org-Erstellung (Name/Budget/Einbindung ins Rivalen-/Bot-System) ist
// eine eigene, größere Baustelle für eine spätere Runde, analog zur bereits
// bestehenden "Randomizer Challenge kommt noch"-Karte im Modus-Auswahl-Screen.
// Klick auf eine Karte navigiert NICHT mehr sofort -- markiert sie nur (siehe
// selectOrgMode()), "Weiter" bestätigt dann erst wirklich.
let selectedOrgMode = null;

function goToOrgModeSelect() {
  selectedOrgMode = null;
  document.querySelectorAll('.org-mode-card').forEach((c) => c.classList.remove('is-selected'));
  document.getElementById('btn-org-mode-continue').disabled = true;
  showScreen('screen-org-mode-select');
}

function selectOrgMode(mode, card) {
  selectedOrgMode = mode;
  document.querySelectorAll('.org-mode-card').forEach((c) => c.classList.toggle('is-selected', c === card));
  document.getElementById('btn-org-mode-continue').disabled = false;
}

// ── Eigene Organisation erstellen ─────────────────────────────────────────
// NUR die Seite/das Formular -- siehe Kommentar in index.html. Dropdowns/
// Checkbox-Optionen/Logo-Auswahl sind reine Formular-Widgets und voll
// interaktiv, "Erstellen" bleibt bewusst permanent disabled (keine
// Erstellungs-Logik in dieser Runde).
let selectedOrgCreateNation = null;
let selectedOrgCreateColor = null;
let selectedOrgCreateLogoUrl = null;
let selectedOrgCreateDifficulty = 'normal';
let orgCreateFillAgents = true;

const ORG_CREATE_COLOR_PRESETS = [
  { id: 'default', name: 'Default', hex: '#dc2645' },
  { id: 'blue', name: 'Blau', hex: '#3a5bff' },
  { id: 'green', name: 'Grün', hex: '#3ecf72' },
  { id: 'purple', name: 'Lila', hex: '#8b5cf6' },
  { id: 'orange', name: 'Orange', hex: '#ff8a3d' },
  { id: 'yellow', name: 'Gelb', hex: '#ffd873' },
  { id: 'cyan', name: 'Cyan', hex: '#3fbdd6' },
  { id: 'pink', name: 'Pink', hex: '#ff5a8c' },
  { id: 'black', name: 'Schwarz', hex: '#1a1f2e' },
  { id: 'white', name: 'Weiß', hex: '#f2f4f8' },
];

// Namenspools nur für den "Zufällig"-Button auf dieser Seite (siehe
// randomizeOrgCreateAll()) -- frei erfunden, keine echten Orgas.
const ORG_CREATE_RANDOM_WORDS = [
  'Nova', 'Phantom', 'Eclipse', 'Vertex', 'Zenith', 'Havoc', 'Mirage', 'Frost',
  'Blaze', 'Obsidian', 'Radiant', 'Specter', 'Orbit', 'Nexus', 'Vortex', 'Solace',
  'Apex', 'Catalyst', 'Ember', 'Static', 'Rogue', 'Onyx', 'Aurora', 'Titan',
];
const ORG_CREATE_RANDOM_SUFFIXES = ['Esports', 'Gaming', 'Club', 'Team', 'Legion'];
const ORG_CREATE_RANDOM_DESCRIPTIONS = [
  'Ein junges Projekt mit großen Ambitionen und einem eingeschworenen Kernteam.',
  'Gegründet aus Leidenschaft für den Wettkampf, mit Fokus auf langfristigen Aufbau.',
  'Kleine, aber hungrige Organisation auf der Suche nach dem nächsten großen Erfolg.',
  'Bekannt für ihre bodenständige Kultur und den engen Draht zur Community.',
  'Ambitionierter Neuling in der Szene, der sich Schritt für Schritt hocharbeitet.',
  'Eine Organisation im Aufbau, getragen von Eigeninitiative und Teamgeist.',
];

function goToOrgCreate() {
  document.getElementById('org-create-shortname-input').value = '';
  document.getElementById('org-create-fullname-input').value = '';
  document.getElementById('org-create-desc-input').value = '';

  populateOrgCreateNationSelect();
  selectOrgCreateNation(CHARACTER_NATIONS[0].code);
  document.getElementById('org-create-nation-menu').classList.add('hidden');

  populateOrgCreateColorSelect();
  selectOrgCreateColor(ORG_CREATE_COLOR_PRESETS[0].id);
  document.getElementById('org-create-color-menu').classList.add('hidden');

  selectedOrgCreateDifficulty = 'normal';
  document.querySelectorAll('#org-create-difficulty-options .org-create-option').forEach((b) => b.classList.toggle('is-active', b.dataset.value === 'normal'));

  orgCreateFillAgents = true;
  document.getElementById('btn-org-create-fill-agents').classList.add('is-active');

  selectedOrgCreateLogoUrl = null;
  renderOrgCreateLogoPreview();
  closeOrgLogoPicker(true);

  document.getElementById('org-create-error').classList.add('hidden');

  showScreen('screen-org-create');
}

function populateOrgCreateNationSelect() {
  const menu = document.getElementById('org-create-nation-menu');
  menu.innerHTML = CHARACTER_NATIONS.map((n) =>
    '<div class="char-dropdown-option" data-code="' + n.code + '">' + characterFlagImgHtml(n.code) + ' ' + n.name + '</div>'
  ).join('');
  menu.querySelectorAll('.char-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      selectOrgCreateNation(opt.dataset.code);
      menu.classList.add('hidden');
    });
  });
}

function selectOrgCreateNation(code) {
  selectedOrgCreateNation = code;
  const nation = CHARACTER_NATIONS.find((n) => n.code === code);
  const trigger = document.getElementById('org-create-nation-trigger');
  trigger.innerHTML = characterFlagImgHtml(nation.code) + ' ' + nation.name;
  document.querySelectorAll('#org-create-nation-menu .char-dropdown-option').forEach((opt) => {
    opt.classList.toggle('is-selected', opt.dataset.code === code);
  });
}

function colorSwatchHtml(hex) {
  return '<span class="char-color-swatch" style="background:' + hex + ';"></span>';
}

function populateOrgCreateColorSelect() {
  const menu = document.getElementById('org-create-color-menu');
  menu.innerHTML = ORG_CREATE_COLOR_PRESETS.map((c) =>
    '<div class="char-dropdown-option" data-id="' + c.id + '">' + colorSwatchHtml(c.hex) + ' ' + c.name + '</div>'
  ).join('');
  menu.querySelectorAll('.char-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      selectOrgCreateColor(opt.dataset.id);
      menu.classList.add('hidden');
    });
  });
}

function selectOrgCreateColor(id) {
  selectedOrgCreateColor = id;
  const color = ORG_CREATE_COLOR_PRESETS.find((c) => c.id === id);
  const trigger = document.getElementById('org-create-color-trigger');
  trigger.innerHTML = colorSwatchHtml(color.hex) + ' ' + color.name;
  document.querySelectorAll('#org-create-color-menu .char-dropdown-option').forEach((opt) => {
    opt.classList.toggle('is-selected', opt.dataset.id === id);
  });
}

function renderOrgCreateLogoPreview() {
  const frame = document.getElementById('org-create-logo-frame');
  frame.innerHTML = selectedOrgCreateLogoUrl
    ? '<img src="' + selectedOrgCreateLogoUrl + '" alt="">'
    : '<span class="character-portrait-placeholder">🛡️</span>';
}

// Einmal pro Sitzung geladen, wie portraitPresetsCache -- eigene Vorlagen-
// kategorie (Team-Logos statt Manager-Portraits), siehe list-team-logo-presets
// in main.js.
let orgLogoPresetsCache = null;

async function loadOrgLogoPresets() {
  if (!orgLogoPresetsCache) {
    orgLogoPresetsCache = await window.electronAPI.listTeamLogoPresets();
  }
  return orgLogoPresetsCache;
}

async function assignRandomOrgCreateLogo() {
  const presets = await loadOrgLogoPresets();
  if (presets.length === 0) return; // noch keine Vorlagen im Projekt -- Platzhalter bleibt
  selectedOrgCreateLogoUrl = presets[Math.floor(Math.random() * presets.length)].url;
  renderOrgCreateLogoPreview();
}

// User-Wunsch: der einzige "Zufällig"-Button auf dieser Seite (bisher nur
// fürs Logo) soll das GESAMTE Formular zufällig ausfüllen, nicht nur das
// Logo -- spiegelt "ALLES ZUFÄLLIG" bei der Charaktererstellung.
// Bug-Fix (Runde 105, User-Vorgabe: "bei zufällig Org erstellen soll niemals
// ein Name generiert werden, den es schon in der DB gibt, um Kader-Mixup-
// Probleme wie in Runde 103/104 zu vermeiden"): 24 Wörter x 5 Suffixe = nur
// 120 mögliche Kombinationen gegen 454 bestehende Orgas in der Datenbank --
// eine zufällige Kollision (z.B. "Obsidian Esports", siehe Runde 97) war real
// möglich und blieb bisher komplett ungeprüft, obwohl submitOrgCreate() die
// MANUELLE Eingabe schon seit Runde 103/104 dagegen absichert. Probiert jetzt
// bis zu alle 120 Wort/Suffix-Kombinationen (zufällige Reihenfolge) durch, bis
// eine kollisionsfreie gefunden ist -- sind ausnahmsweise ALLE 120 belegt
// (praktisch nie, aber sauber statt endlos), hängt ein Zähler an, bis der
// Name frei ist.
function randomOrgCreateIdentity() {
  const combos = [];
  ORG_CREATE_RANDOM_WORDS.forEach((word) => {
    ORG_CREATE_RANDOM_SUFFIXES.forEach((suffix) => combos.push({ word, suffix }));
  });
  const shuffled = shuffledCopy(combos, Math.random);
  const free = shuffled.find(({ word, suffix }) => !ORGANIZATIONS.some((o) => o.name === word + ' ' + suffix));
  if (free) return { shortname: free.word.toUpperCase().slice(0, 8), fullname: (free.word + ' ' + free.suffix).slice(0, 40) };
  // Ausnahmefall: alle 120 Kombinationen sind belegt -- Zahl anhängen, bis frei.
  const base = shuffled[0];
  let n = 2;
  let fullname = base.word + ' ' + base.suffix + ' ' + n;
  while (ORGANIZATIONS.some((o) => o.name === fullname)) { n++; fullname = base.word + ' ' + base.suffix + ' ' + n; }
  return { shortname: base.word.toUpperCase().slice(0, 8), fullname: fullname.slice(0, 40) };
}

async function randomizeOrgCreateAll() {
  selectOrgCreateNation(CHARACTER_NATIONS[Math.floor(Math.random() * CHARACTER_NATIONS.length)].code);
  selectOrgCreateColor(ORG_CREATE_COLOR_PRESETS[Math.floor(Math.random() * ORG_CREATE_COLOR_PRESETS.length)].id);

  const { shortname, fullname } = randomOrgCreateIdentity();
  document.getElementById('org-create-shortname-input').value = shortname;
  document.getElementById('org-create-fullname-input').value = fullname;
  document.getElementById('org-create-desc-input').value =
    ORG_CREATE_RANDOM_DESCRIPTIONS[Math.floor(Math.random() * ORG_CREATE_RANDOM_DESCRIPTIONS.length)];

  const difficulties = ['hard', 'normal', 'easy', 'casual'];
  const diffValue = difficulties[Math.floor(Math.random() * difficulties.length)];
  selectedOrgCreateDifficulty = diffValue;
  document.querySelectorAll('#org-create-difficulty-options .org-create-option').forEach((b) => b.classList.toggle('is-active', b.dataset.value === diffValue));

  orgCreateFillAgents = Math.random() < 0.5;
  document.getElementById('btn-org-create-fill-agents').classList.toggle('is-active', orgCreateFillAgents);

  await assignRandomOrgCreateLogo();
}

// ── "Organisation erstellen": echte Erstellungs-Logik ──────────────────────
// Baut aus dem Formular ein Org-Objekt in derselben Form wie eine
// instantiateOrg()-Instanz aus der 87er-Liste (name/logoUrl/description/
// budget/roster{starters,sub,coach,staff}/strength/matchBonusPct) -- dadurch
// brauchen goToOrgContract() und confirmOrgAndProceed() keine Sonderfälle
// für selbst erstellte Orgas.
const ORG_CREATE_DIFFICULTY_BUDGET = { hard: 10000, normal: 100000, easy: 1000000, casual: 10000000 };
const ORG_CREATE_DIFFICULTY_STAFF_COUNT = { hard: 0, normal: 2, easy: 4, casual: 6 };
const ORG_CREATE_START_PLAYER_COUNT = 3; // User-Wunsch: 3 Spieler statt vorher 5

function shuffledCopy(arr, rng) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
  }
  return copy;
}

function buildCustomOrgFromForm(shortname, fullname, description) {
  const rng = mulberry32(hashString(fullname + '|' + Date.now()));
  const pickNation = () => CHARACTER_NATIONS[Math.floor(rng() * CHARACTER_NATIONS.length)].code;
  const pickAvatarId = () => CHARACTER_AVATARS[Math.floor(rng() * CHARACTER_AVATARS.length)].id;

  // 3 Starter aus dem freien Spieler-Pool, falls "Mit Free Agents auffüllen"
  // aktiv ist -- sonst startet der Kader komplett leer (wird über den
  // Transfermarkt aufgebaut). Kein Sub (die Free-Agent-Datenbank ist explizit
  // für die 3 Starter-Plätze gedacht, kein 4. Spieler nötig -- analog zu den
  // bestehenden Orgas, deren Sub ebenfalls nie aus der Datenbank kommt).
  let starters = [];
  if (orgCreateFillAgents) {
    starters = shuffledCopy(FREE_AGENT_PLAYERS, rng).slice(0, ORG_CREATE_START_PLAYER_COUNT)
      .map((p) => ({ ...p, country: pickNation(), avatarId: pickAvatarId() }));
  }

  // Team-Mitarbeiter-Anzahl skaliert mit der Startinvestition (siehe
  // ORG_CREATE_DIFFICULTY_STAFF_COUNT/die "+N Personal"-Hinweise im
  // Formular) -- zufällige Rollen aus ORG_ROSTER_STAFF_ROLES, je 1 zufällige
  // Person aus dem passenden Free-Agent-Pool dieser Rolle.
  const staffCount = ORG_CREATE_DIFFICULTY_STAFF_COUNT[selectedOrgCreateDifficulty] || 0;
  const staff = shuffledCopy(ORG_ROSTER_STAFF_ROLES, rng).slice(0, staffCount).map((role) => {
    const pool = FREE_AGENT_STAFF[role];
    const person = pool[Math.floor(rng() * pool.length)];
    return { role, name: person.name, overall: person.overall, country: pickNation(), avatarId: pickAvatarId() };
  });

  // Kein Free-Agent-Pool für Coaches vorhanden (die Datenbank kennt nur die
  // 9 Mitarbeiterrollen) -- prozeduraler Fantasiename in mittlerer Stärke
  // (2,5 Sterne), da eine frisch gegründete Org noch kein Prestige hat, an
  // dem sich eine höhere/niedrigere Stufe festmachen ließe.
  const coachFirstNames = rng() < 0.5 ? ROSTER_STAFF_FIRST_NAMES_M : ROSTER_STAFF_FIRST_NAMES_F;
  const coach = {
    name: coachFirstNames[Math.floor(rng() * coachFirstNames.length)] + ' ' + ROSTER_STAFF_LAST_NAMES[Math.floor(rng() * ROSTER_STAFF_LAST_NAMES.length)],
    country: pickNation(),
    avatarId: pickAvatarId(),
    overall: starsToOverall(2.5),
  };

  const roster = { starters, sub: null, coach, staff, reserve: [] };
  const strength = computeOrgStrengthFromRoster(roster);

  return {
    name: fullname,
    shortname,
    country: selectedOrgCreateNation,
    logoUrl: selectedOrgCreateLogoUrl,
    colorId: selectedOrgCreateColor, // bisher nirgendwo gespeichert -- jetzt für die Trikot-Vorschau (Sponsoren-Seite, Runde 38) nachgetragen
    description,
    budget: ORG_CREATE_DIFFICULTY_BUDGET[selectedOrgCreateDifficulty] || ORG_CREATE_DIFFICULTY_BUDGET.normal,
    roster,
    strength,
    matchBonusPct: computeMatchBonusPct(strength),
  };
}

function submitOrgCreate() {
  const shortname = document.getElementById('org-create-shortname-input').value.trim();
  const fullname = document.getElementById('org-create-fullname-input').value.trim();
  const description = document.getElementById('org-create-desc-input').value.trim();
  const errorEl = document.getElementById('org-create-error');

  if (!shortname || !fullname || !description || !selectedOrgCreateNation || !selectedOrgCreateColor) {
    errorEl.textContent = 'Bitte alle Pflichtfelder (*) ausfüllen.';
    errorEl.classList.remove('hidden');
    return;
  }
  // Runde 103, Bug-Fix (User-Meldung: "Kader ändert sich jedesmal bei eigener Org, bei
  // vorhandener Org funktioniert alles einwandfrei"): findOrgByName()/regionOrgs()
  // unterscheiden Orgs NUR nach NAME. Kollidiert der selbst gewählte Vollname zufällig mit
  // einer der 454 bestehenden Bot-Orgs, hält regionOrgs()s "!orgs.some(o => o.name ===
  // assignedOrg.name)"-Check den bereits vorhandenen Bot-Namenseintrag für "schon
  // vorhanden" und bindet die eigene Org NICHT (mehr) ein -- an manchen Stellen der
  // Turnier-Auflösung würde dann versehentlich die GLEICHNAMIGE Bot-Org (mit ihrem
  // eigenen, andersartigen, zufällig generierten Kader) statt der eigenen verwendet,
  // während andere Stellen (die assignedOrg per Referenz bevorzugen) weiterhin korrekt
  // die eigene Org zeigen -- genau die Art Inkonsistenz ("mal dieser Kader, mal ein
  // anderer, ganz ohne eigenes Zutun"), die gemeldet wurde. Verhindert die Kollision
  // direkt bei der Eingabe, statt sie tief in der Simulation auflaufen zu lassen.
  if (ORGANIZATIONS.some((o) => o.name === fullname)) {
    errorEl.textContent = 'Dieser Name ist schon von einer bestehenden Organisation belegt -- bitte einen anderen wählen.';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const org = buildCustomOrgFromForm(shortname, fullname, description);
  goToOrgContract(org, 'screen-org-create');
}

async function openOrgLogoPicker() {
  document.getElementById('org-create-content').classList.add('side-panel-open');
  const sidebar = document.getElementById('org-logo-picker-sidebar');
  sidebar.classList.remove('hidden', 'is-closing');
  await loadOrgLogoPresets();
  renderOrgLogoPickerGrid();
}

// Logo-Vorlagen liegen in assets/wappen-eigener_verein/ -- gleiches Muster
// wie bei den Manager-Portraits: neue Dateien dort tauchen automatisch auf,
// ohne dass hier Code geändert werden muss.
function renderOrgLogoPickerGrid() {
  const grid = document.getElementById('org-logo-picker-grid');
  if (!orgLogoPresetsCache || orgLogoPresetsCache.length === 0) {
    grid.innerHTML = '<p class="portrait-picker-empty">Noch keine Logo-Vorlagen im Projekt -- bis dahin über "Hochladen" ein eigenes Bild wählen.</p>';
    return;
  }
  grid.innerHTML = orgLogoPresetsCache.map((p) =>
    '<div class="portrait-picker-item' + (p.url === selectedOrgCreateLogoUrl ? ' is-selected' : '') + '" data-url="' + p.url + '">' +
      '<img src="' + p.url + '" alt="">' +
    '</div>'
  ).join('');
  grid.querySelectorAll('.portrait-picker-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedOrgCreateLogoUrl = item.dataset.url;
      renderOrgCreateLogoPreview();
      renderOrgLogoPickerGrid();
    });
  });
}

// Spielt die Slide-out-Animation ab, spiegelt closePortraitPicker() usw.
function closeOrgLogoPicker(instant) {
  const sidebar = document.getElementById('org-logo-picker-sidebar');
  document.getElementById('org-create-content').classList.remove('side-panel-open');
  if (instant || sidebar.classList.contains('hidden')) {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('is-closing');
    return;
  }
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sidebar.classList.add('hidden');
    sidebar.classList.remove('is-closing');
  }
  sidebar.classList.add('is-closing');
  sidebar.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 400);
}

// ── Org-Auswahlmenü (ersetzt den Zufalls-Automat in der Karriere) ────────
// User-Wunsch: statt einer zufälligen Zuweisung wählt man seine Org jetzt
// selbst aus einem Menü, das alle Boni/Mali zeigt. Der alte Zufalls-Automat
// (goToOrgIntro()/spinReel(), weiter unten) bleibt im Code erhalten, wird
// aber im Karriere-Modus nicht mehr aufgerufen — er ist für den späteren
// Randomizer-Challenge-Modus vorgesehen (der genau diese Zufallszuweisung
// nutzen soll).
// Listen-Ansicht statt Karten-Grid (User-Wunsch, orientiert an einer
// Referenz-Vorlage): Suche + Regionsfilter + paginierte Zeilenliste. Die
// frühere "Eigene Organisation — Kommt noch"-Karte in diesem Grid ist jetzt
// überflüssig — dieselbe Wahl gibt es bereits auf dem vorgeschalteten
// screen-org-mode-select (siehe goToOrgModeSelect()).
const ORG_SELECT_PAGE_SIZE = 6;
const ORG_REGION_LABELS = { EU: 'Europa', NA: 'Nordamerika', SAM: 'Südamerika', MENA: 'Naher Osten & Nordafrika', OCE: 'Ozeanien', APAC: 'Asien-Pazifik', SSA: 'Subsahara-Afrika' };
let orgSelectSearchQuery = '';
let orgSelectRegionFilter = null; // null = alle Regionen
let orgSelectPage = 1;

function goToOrgSelection() {
  document.getElementById('org-select-heading').textContent = 'Willkommen, ' + careerCharacter.name;
  orgSelectSearchQuery = '';
  orgSelectRegionFilter = null;
  orgSelectPage = 1;
  pendingOrg = null;
  document.getElementById('org-select-search-input').value = '';
  // Leer statt eines Platzhaltertexts -- .org-preview-panel:empty blendet die
  // ganze Box (Rahmen/Hintergrund) komplett aus, damit im Leerzustand nur der
  // verschwommene Hauptmenü-Hintergrund sichtbar ist (User-Wunsch).
  document.getElementById('org-preview-panel').innerHTML = '';
  populateOrgRegionMenu();
  renderOrgSelectList();
  showScreen('screen-org-select');
}

// Generischer Platzhalter-Avatar (Silhouette) -- nur noch für die "Junge
// Spieler"-Slots (Nachwuchs, User-Anfrage bezog sich nicht darauf, bleibt
// eine spätere Baustelle). Spieler/Mitarbeiter selbst haben inzwischen echte
// (feste, generierte) Emoji-Avatare -- siehe CHARACTER_AVATARS/data/org-rosters.js.
const ORG_PREVIEW_PLACEHOLDER_AVATAR = '👤';
// Team-Mitarbeiter-Rollen -- "Geschäftsführer" (immer erster Eintrag) ist der
// selbst erstellte Charakter, die übrigen 9 Rollen kommen aus dem festen,
// pro Org generierten Mitarbeiter-Kader (siehe ORG_ROSTER_STAFF_ROLES in
// data/org-rosters.js -- einzige Quelle der Wahrheit für die Rollen-Liste).
const ORG_PREVIEW_STAFF_ROLES = ['Geschäftsführer', ...ORG_ROSTER_STAFF_ROLES];

// Baut einen einzelnen Avatar-Slot (Spieler oder Mitarbeiter) mit echtem
// Namen/Avatar/Nationalitätsflagge/Sterne-Bewertung -- die Sterne haben
// Logik (5 = maximaler Skill, 1 = sehr wenig Skill, siehe npcStarRating() in
// data/org-rosters.js), sind aber aktuell rein informativ (User-Entscheidung:
// wirken sich noch nicht auf Match-Simulation/Wirtschaft aus -- eine echte
// Anbindung ist eine eigene, spätere Baustelle).
function personAvatarBlockHtml(person, labelHtml) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === person.avatarId) || CHARACTER_AVATARS[0];
  const flagHtml = person.country ? '<img class="org-preview-avatar-flag-sm" src="assets/flags/' + person.country.toLowerCase() + '.svg" alt="">' : '';
  const stars = npcStarRating(person.overall);
  const starsFillPct = (stars / 5) * 100;
  return (
    '<div class="org-preview-avatar">' +
      '<div class="org-preview-avatar-circle" style="background:' + avatar.color + '33;">' + avatar.emoji + '</div>' +
      '<span class="org-preview-avatar-name-row">' + flagHtml + '<span class="org-preview-avatar-label">' + labelHtml + '</span></span>' +
      '<span class="org-select-stars org-preview-avatar-stars"><span class="stars-empty">★★★★★</span><span class="stars-filled" style="width:' + starsFillPct + '%">★★★★★</span></span>' +
    '</div>'
  );
}

// Baut das Vorschau-Panel für eine konkrete Org-Instanz (mit fest gewählter
// Pro/Con-Zeile, siehe instantiateOrg()) -- ersetzt das alte Modal-Popup.
function renderOrgPreview(instance) {
  const panel = document.getElementById('org-preview-panel');
  const rating = orgStarRating(instance.strength);
  const difficulty = orgDifficulty(instance.strength);
  const fillPct = (rating / 5) * 100;
  const flagHtml = instance.country ? '<img class="org-preview-flag" src="assets/flags/' + instance.country.toLowerCase() + '.svg" alt="">' : '';
  const initial = instance.name.trim().charAt(0).toUpperCase();
  const logoHtml = instance.logo
    ? '<img class="org-preview-logo" src="assets/team-logos/' + encodeURIComponent(instance.logo) + '" alt="">'
    : '<div class="org-preview-icon" style="background:' + orgBadgeColor(instance.name) + ';">' + initial + '</div>';

  // 3 Spieler-Plätze (RLCS Legends ist 3v3 -- KEINE CS-artigen Rollen wie
  // Rifler/AWPer, bei uns gibt es nur "Spieler"). Das ist der ECHTE, feste
  // Startkader dieser Org (siehe generateOrgRoster() in data/org-rosters.js) --
  // wird 1:1 beim Team-Unterschreiben übernommen (siehe confirmOrgAndProceed()).
  const playerSlots = instance.roster.starters.map((p) => personAvatarBlockHtml(p, p.name)).join('');

  // Erster Eintrag (Geschäftsführer) ist der selbst erstellte Charakter (siehe
  // Charaktererstellung: Nick + Avatar-Auswahl + Nation) -- die übrigen 9
  // Rollen kommen aus dem festen Mitarbeiter-Kader der Org.
  const ownAvatar = CHARACTER_AVATARS.find((a) => a.id === careerCharacter.avatarId) || CHARACTER_AVATARS[0];
  const ownFlagHtml = careerCharacter.nation ? '<img class="org-preview-avatar-flag-sm" src="assets/flags/' + careerCharacter.nation.toLowerCase() + '.svg" alt="">' : '';
  const staffSlots = ORG_PREVIEW_STAFF_ROLES.map((role, i) => {
    if (i === 0) {
      return (
        '<div class="org-preview-avatar">' +
          '<div class="org-preview-avatar-circle" style="background:' + ownAvatar.color + '33;">' + ownAvatar.emoji + '</div>' +
          '<span class="org-preview-avatar-name-row">' + ownFlagHtml + '<span class="org-preview-avatar-label">' + careerCharacter.name + '<br>(' + role + ')</span></span>' +
        '</div>'
      );
    }
    const staffPerson = instance.roster.staff.find((s) => s.role === role);
    return personAvatarBlockHtml(staffPerson, role);
  }).join('');

  const youthSlots = Array.from({ length: 4 }, () =>
    '<div class="org-preview-avatar is-locked">' +
      '<div class="org-preview-avatar-circle">🔒</div>' +
    '</div>'
  ).join('');

  panel.innerHTML =
    '<div class="org-preview-header">' +
      logoHtml +
      '<div class="org-preview-title-block">' +
        '<div class="org-preview-name">' + instance.name + '</div>' +
        '<div class="org-preview-meta-row">' +
          '<span class="org-select-stars"><span class="stars-empty">★★★★★</span><span class="stars-filled" style="width:' + fillPct + '%">★★★★★</span></span>' +
          '<span class="org-preview-budget">Gesamtbudget: ' + formatMoney(instance.budget) + '</span>' +
          '<span class="org-select-difficulty-label">SCHWIERIGKEIT:</span> <span class="org-select-difficulty difficulty-' + difficulty.level + '">' + difficulty.label + '</span>' +
          flagHtml +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="org-preview-desc">' +
      '<p class="org-preview-desc-line">' + instance.description + '</p>' +
    '</div>' +
    '<div class="org-preview-section">' +
      '<div class="org-preview-section-title">Spieler</div>' +
      '<div class="org-preview-avatar-row">' + playerSlots + '</div>' +
      '<p class="org-preview-note">Fester Startkader dieser Org — nach der Übernahme direkt einsatzbereit, kann danach über den Transfermarkt verstärkt werden.</p>' +
    '</div>' +
    '<div class="org-preview-section">' +
      '<div class="org-preview-section-title">Team-Mitarbeiter</div>' +
      '<div class="org-preview-avatar-row">' + staffSlots + '</div>' +
    '</div>' +
    '<div class="org-preview-section">' +
      '<div class="org-preview-section-title">Junge Spieler</div>' +
      '<div class="org-preview-avatar-row">' + youthSlots + '</div>' +
    '</div>' +
    '<div class="org-preview-footer">' +
      '<button type="button" id="btn-org-preview-sign" class="org-preview-sign-btn">Team unterschreiben →</button>' +
    '</div>';

  document.getElementById('btn-org-preview-sign').addEventListener('click', () => goToOrgContract(instance, 'screen-org-select'));
}

// Wählt eine Org fürs Vorschau-Panel aus UND markiert die passende Zeile in
// der Liste grün (siehe .org-select-row.is-selected) -- klickt NICHTS fest,
// erst der "Team unterschreiben"-Button in der Vorschau löst
// confirmOrgAndProceed() aus.
function selectOrgForPreview(org) {
  pendingOrg = instantiateOrg(org);
  renderOrgPreview(pendingOrg);
  document.querySelectorAll('.org-select-row').forEach((row) => {
    row.classList.toggle('is-selected', row.dataset.orgName === org.name);
  });
}

// Deterministische, aber pro Org feste Akzentfarbe fürs Icon-Badge -- echte
// Marken-Logos werden bewusst NICHT verwendet (anders als reine Namen/Stats
// wäre exaktes Logo-Reproduzieren ein deutlich größeres Marken-/Rechte-
// Risiko, siehe Disclaimer-Prinzip im Hauptmenü/KONZEPT.md).
function orgBadgeColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return 'hsl(' + (Math.abs(hash) % 360) + ', 55%, 38%)';
}

function filteredSortedOrgs() {
  const query = orgSelectSearchQuery.trim().toLowerCase();
  return ORGANIZATIONS.slice()
    .filter((org) => !orgSelectRegionFilter || orgRegion(org.country) === orgSelectRegionFilter)
    .filter((org) => !query || org.name.toLowerCase().includes(query))
    .sort((a, b) => b.strength - a.strength);
}

function populateOrgRegionMenu() {
  const menu = document.getElementById('org-select-region-menu');
  const regions = Object.keys(ORG_REGION_LABELS);
  menu.innerHTML =
    '<div class="char-dropdown-option" data-region="">Alle Regionen</div>' +
    regions.map((r) => '<div class="char-dropdown-option" data-region="' + r + '">' + ORG_REGION_LABELS[r] + '</div>').join('');
  menu.querySelectorAll('.char-dropdown-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      orgSelectRegionFilter = opt.dataset.region || null;
      orgSelectPage = 1;
      menu.classList.add('hidden');
      renderOrgSelectList();
    });
  });
}

function renderOrgSelectList() {
  const all = filteredSortedOrgs();
  const totalCount = all.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / ORG_SELECT_PAGE_SIZE));
  orgSelectPage = Math.min(orgSelectPage, pageCount);
  const startIdx = (orgSelectPage - 1) * ORG_SELECT_PAGE_SIZE;
  const pageOrgs = all.slice(startIdx, startIdx + ORG_SELECT_PAGE_SIZE);

  const list = document.getElementById('org-select-list');
  list.innerHTML = pageOrgs.map((org) => {
    const rating = orgStarRating(org.strength);
    const difficulty = orgDifficulty(org.strength);
    const fillPct = (rating / 5) * 100;
    const flagHtml = org.country ? '<img class="org-select-row-flag" src="assets/flags/' + org.country.toLowerCase() + '.svg" alt="">' : '';
    const initial = org.name.trim().charAt(0).toUpperCase();
    const iconHtml = org.logo
      ? '<img class="org-select-row-logo" src="assets/team-logos/' + encodeURIComponent(org.logo) + '" alt="">'
      : '<div class="org-select-row-icon" style="background:' + orgBadgeColor(org.name) + ';">' + initial + '</div>';
    return (
      '<div class="org-select-row" data-org-name="' + org.name + '">' +
        iconHtml +
        '<div class="org-select-row-info">' +
          '<div class="org-select-row-name-line">' + flagHtml + '<span class="org-select-row-name">' + org.name + '</span></div>' +
          '<div class="org-select-row-meta">' +
            '<span class="org-select-stars"><span class="stars-empty">★★★★★</span><span class="stars-filled" style="width:' + fillPct + '%">★★★★★</span></span>' +
            '<span class="org-select-difficulty-label">SCHWIERIGKEIT:</span> <span class="org-select-difficulty difficulty-' + difficulty.level + '">' + difficulty.label + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll('.org-select-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectOrgForPreview(findOrgByName(row.dataset.orgName));
    });
    // Falls die zuvor ausgewählte Org auf der (neu gefilterten/paginierten)
    // Seite weiterhin sichtbar ist, bleibt ihre grüne Markierung erhalten --
    // aber KEINE automatische Auswahl, wenn noch nie geklickt wurde
    // (pendingOrg ist dann null, User-Wunsch: Panel startet leer).
    if (pendingOrg) {
      row.classList.toggle('is-selected', row.dataset.orgName === pendingOrg.name);
    }
  });

  document.getElementById('org-select-page-label').textContent = String(orgSelectPage);
  document.getElementById('org-select-count-label').textContent =
    totalCount === 0 ? '0 Treffer' : '(' + (startIdx + 1) + '-' + Math.min(startIdx + ORG_SELECT_PAGE_SIZE, totalCount) + ') ' + totalCount;
  document.getElementById('org-select-prev').disabled = orgSelectPage <= 1;
  document.getElementById('org-select-next').disabled = orgSelectPage >= pageCount;
}

// ── Vertrags-Screen (Gründungsvereinbarung) ───────────────────────────────
// Zwischenstopp zwischen "Team unterschreiben" im Vorschau-Panel und dem
// eigentlichen confirmOrgAndProceed() -- User-Wunsch: erst ein echter
// Vertrag mit Logo/Datum/Unterschrift, bevor die Org final übernommen wird.
// Die zwei Karriereoptionen (CEO-Entlassbarkeit, KI-Transfersperre) sind
// aktuell reine Formular-Widgets wie schon bei "Organisation erstellen" --
// noch nicht an echte Spiellogik angebunden, das wäre eine eigene, größere
// Baustelle (Achievements-System bzw. KI-Transfermarkt-Sperrlogik).
// Existierende Orgas tragen `.logo` (bloßer Dateiname in assets/team-logos/),
// selbst erstellte Orgas tragen `.logoUrl` (bereits vollständige file://-URL --
// egal ob Vorlage aus assets/wappen-eigener_verein/ oder vom eigenen PC
// hochgeladen, siehe selectedOrgCreateLogoUrl in goToOrgCreate()) -- eine
// Stelle löst beide Formen einheitlich auf.
function resolveOrgLogoUrl(org) {
  if (org.logoUrl) return org.logoUrl;
  if (org.logo) return 'assets/team-logos/' + encodeURIComponent(org.logo);
  return null;
}

// `backScreen`: wohin "← Zurück" führt -- screen-org-select bei einer
// bestehenden Org, screen-org-create bei einer selbst erstellten (siehe
// submitOrgCreate()).
let contractBackScreen = 'screen-org-select';

function goToOrgContract(org, backScreen) {
  pendingOrg = org;
  contractBackScreen = backScreen || 'screen-org-select';

  document.getElementById('org-contract-founder-name').textContent = careerCharacter.firstName + ' ' + careerCharacter.lastName;
  document.getElementById('org-contract-org-name').textContent = org.name;

  const logoUrl = resolveOrgLogoUrl(org);
  const initial = org.name.trim().charAt(0).toUpperCase();
  const logoEl = document.getElementById('org-contract-logo');
  logoEl.innerHTML = logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div class="org-contract-logo-placeholder" style="background:' + orgBadgeColor(org.name) + ';">' + initial + '</div>';

  // Gleiches Logo (falls vorhanden) auch als gekacheltes, driftendes
  // Hintergrundmuster -- macht den Screen sichtbar org-spezifisch, ohne dass
  // jede Org eine eigene Farbe bräuchte. Funktioniert identisch für
  // hochgeladene/eigene Logos, da logoUrl bereits eine fertige file://-URL ist.
  const bgPattern = document.getElementById('org-contract-bg-pattern');
  bgPattern.style.backgroundImage = logoUrl ? 'url("' + logoUrl + '")' : 'none';
  bgPattern.classList.toggle('has-logo', !!logoUrl);

  document.getElementById('org-contract-date').textContent = formatContractDate(new Date());

  document.getElementById('opt-ceo-fireable').classList.add('is-active');
  document.querySelectorAll('.org-contract-lock-option').forEach((b) => b.classList.toggle('is-active', b.dataset.value === '1'));

  clearContractSignature();
  showScreen('screen-org-contract');
}

// Freihand-Unterschrift per Maus/Pointer -- pointerFromEvent skaliert
// Klientkoordinaten korrekt auf die tatsächliche Canvas-Auflösung, falls die
// CSS-Anzeigegröße von den width/height-Attributen abweicht.
let contractSigDrawing = false;
let contractSigLastPoint = null;
// User-Wunsch: "Fortfahren" erst klickbar/wirksam, wenn tatsächlich
// unterschrieben wurde -- gilt für beide Vertrags-Herkünfte (bestehende UND
// selbst erstellte Org), da beide über denselben screen-org-contract laufen.
let contractSigned = false;

function initContractSignatureCanvas() {
  const canvas = document.getElementById('org-contract-signature-canvas');
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1a2130';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    contractSigDrawing = true;
    contractSigLastPoint = pointFromEvent(e);
    canvas.setPointerCapture(e.pointerId);
    // Meldung verschwindet, sobald der erste Strich beginnt (User-Wunsch:
    // "erst verschwinden sobald man Signatur macht bzw. anfängt").
    contractSigned = true;
    document.getElementById('org-contract-signature-error').classList.add('hidden');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!contractSigDrawing) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(contractSigLastPoint.x, contractSigLastPoint.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    contractSigLastPoint = p;
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
    canvas.addEventListener(evt, () => { contractSigDrawing = false; });
  });
}
initContractSignatureCanvas();

function clearContractSignature() {
  const canvas = document.getElementById('org-contract-signature-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  contractSigned = false;
  document.getElementById('org-contract-signature-error').classList.add('hidden');
}

// ── Dashboard (neuer Haupt-Hub nach Vertragsunterschrift) ───────────────────
// User-Wunsch: Sidebar+Top-Nav-Layout wie im Referenz-Screenshot. Diese
// Runde bewusst NUR die Navigations-Hülle -- Sidebar-Klicks wechseln aktuell
// nur den aktiven Zustand + Seitentitel, echte Unterseiten (Kader/Training/
// Transfers/...) folgen in einer späteren Runde ("Inhalt erstmals
// ignorieren"). Der bestehende Draft-/Turnier-Flow (screen-draft etc.)
// bleibt vollständig erhalten, ist aber aus dem Dashboard heraus noch nicht
// verlinkt -- ebenfalls bewusst für eine spätere Runde.
const DASHBOARD_WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DASHBOARD_MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DASHBOARD_PAGE_LABELS = {
  home: 'Startseite', post: 'Post', messages: 'Nachrichten', roster: 'Kader', staff: 'Personal',
  training: 'Training', tactics: 'Strategien', scouting: 'Scouting', transfers: 'Transfers',
  tournaments: 'Turniere', stats: 'Statistiken', basecamp: 'Basecamp', shop: 'Shop',
  sponsors: 'Sponsoren', finance: 'Finanzen', settings: 'Einstellungen',
};

// User-Vorgabe Runde 42 (angepasst Runde 77: "Statistiken entblocken" --
// Seite selbst wird erst später gebaut, aber der Sperr-Hinweis soll weg;
// "Post"/"Personal" neu gesperrt): diese Kategorien sind (anders als die
// übrigen noch nicht gebauten Seiten) explizit als "gesperrt" markiert --
// eigener Hinweis im Hauptbereich statt des generischen "🚧 Inhalt
// folgt"-Platzhalters, siehe selectDashboardPage(). Sidebar-Buttons selbst
// tragen die `is-locked`-Klasse direkt im HTML (index.html) -- MUSS mit
// dieser Liste synchron gehalten werden.
const DASHBOARD_LOCKED_PAGES = ['post', 'messages', 'staff', 'tactics', 'basecamp', 'shop', 'training'];

// In-Game-Kalenderdatum, YYYY-MM-DD -- User-Wunsch: "Man startet immer ab
// 01. Jan 2026". Eigenständig von der Saison-Nummer (careerState.seasonNumber
// bleibt die für die Turnier-/Entwicklungslogik maßgebliche Zeiteinheit,
// siehe startNextSeason()) -- dieser Kalender ist rein für die Dashboard-
// Anzeige/den WEITER-Button gedacht.
let careerDate = null;

// ── Finanzen-Seite (Runde 34, €-Modell seit dieser Runde) ────────────────
// Budget-Verteilung (Regler) -- Werte sind FESTE €-BETRÄGE pro Kategorie
// (bis vor dieser Runde Prozente von assignedOrg.budget, siehe
// financeUnallocated()-Kommentar für den Grund der Umstellung: neues
// Einkommen darf nie automatisch anteilig in die 4 Kategorien einsickern).
// Dieser Modul-Default wird immer sofort von confirmOrgAndProceed() (neue
// Karriere) oder loadGameState() (gespeicherter Stand) überschrieben.
let financeAllocation = { transfers: 0, salaries: 0, marketing: 0, operations: 0 };
// Monatsgenaues Einnahmen/Ausgaben-Log für die 12-Monats-Cashflow-Grafik
// (Runde 34) -- { 'YYYY-MM': { income, expenses } }, gefüttert von echten
// Geldereignissen (Preisgeld-Payouts/Sponsoring-Abholen über
// addFinanceMonthlyIncome(), Personal-Verpflichtungen über
// addFinanceMonthlyExpense(), Runde 117 -- vorher blieben Ausgaben immer 0,
// weil es noch keine echte Ausgabenquelle gab).
let financeMonthlyLedger = {};
// Runde 121, User-Vorgabe ("wirklich ALLE Transaktionen einzeln aufgelistet"):
// EIN gemeinsames, chronologisches Log für JEDE Geld-Bewegung (Transfers,
// Sponsoring, Preisgeld, Gehälter, Vorstandsbudget) -- anders als
// `financeMonthlyLedger` (nur Monats-SUMMEN für den Cashflow-Chart) hier
// jede einzelne Buchung mit Datum/Kategorie/Beschreibung, direkt für die
// Transaktionsliste auf der Finanzen-Seite gedacht (renderFinanceTransactions()).
// Wird per unshift() befüllt (neueste zuerst), wächst additiv über
// addFinanceMonthlyIncome()/addFinanceMonthlyExpense() -- EIN Aufruf-Ort
// reicht, kein separater zweiter Buchungscode nötig.
let financeTransactionLog = [];
// Kumulierte Saison-Einnahmen über die GANZE Karriere (für "Gesamteinnahmen")
// -- wird einmal pro Saisonende in startNextSeason() erhöht.
let careerSeasonIncomeTotal = 0;

// ── Sponsoren-Seite (Runde 38/39) ─────────────────────────────────────────
// Voller Lebenszyklus pro Sponsor: verfügbar -> Bewerbung gesendet (7-14
// Tage Wartezeit) -> angenommen (aktiv, Ziele laufen) ODER abgelehnt (1.
// Ablehnung: 1 Monat "nicht verfügbar" ab Ablehnungsdatum; 2. Ablehnung in
// Folge: "gesperrt" für 1 ganze Saison/Jahr). Annahme/Ablehnung hängt vom
// Sterne-Verhältnis Org<->Sponsor ab (siehe sponsorWillBeAccepted() weiter
// unten) -- User-Beispiele exakt durchgerechnet: eine Org bekommt Sponsoren
// bis zu "eigene Sterne + 1" angenommen (z.B. 1-Sterne-Org kriegt Tier D UND
// C angenommen, aber nicht B/A/S).
let sponsorState = {}; // name -> { pending, requestDate, responseDate, active, completedGoals, cooldownUntil, lockedUntil, rejectionCount }
let selectedSponsorName = null;
let sponsorRequestTarget = null;
// Ersetzt die alte Kalendermonat-Quote (monthlySponsorRequests/-Month) --
// User-Korrektur: jede einzelne Anfrage gibt ihren EIGENEN Slot erst genau
// 1 Monat NACH ihrem eigenen Anfragedatum wieder frei (rollierend), nicht
// alle 5 gemeinsam am 1. des Folgemonats (siehe remainingSponsorRequests()).
let sponsorRequestLog = []; // string[] von careerDate-Anfragedaten
let sponsorSubtab = 'overview';
let sponsorTierFilter = 'all';
let sponsorPage = 1;
const SPONSORS_PER_PAGE = 12;
const SPONSOR_CATEGORY_COLORS = {
  Betting: '#e0793e', Lifestyle: '#d64fa0', Peripherals: '#3fbdd6', Hardware: '#3f7fd6',
  Apparel: '#d64f8c', Software: '#4f8cd6', 'Energy Drink': '#d6c23f', Finance: '#3fd68c',
  Travel: '#8c6fd6', Onboarding: '#a8c23f',
};
const MAX_SPONSOR_REQUESTS_PER_MONTH = 5;
// User-Vorgabe Runde 41: max. 6 GLEICHZEITIG unterzeichnete Sponsoren -- ist
// ein eigenes Limit, unabhängig von der 5er-Anfragen-Quote (siehe
// remainingSponsorRequests()). Sobald alle 6 Slots belegt sind, gibt es keinen
// "Angebot"-Button mehr (siehe sponsorDetailActionsHtml()).
const MAX_ACTIVE_SPONSORS = 6;
function activeSponsorCount() {
  return Object.values(sponsorState).filter((st) => st.active).length;
}

// Kumulierte Karriere-Siege/-Niederlagen -- existierte bisher NICHT (siehe
// Recherche-Runde vor Runde 39, seasonState.playerWins/-Losses wird jede
// Saison auf 0 zurückgesetzt) -- neu ergänzt in accumulatePlayerRecord(),
// einzig dafür, damit "careerWins"-Sponsoring-Ziele echte Daten haben.
let careerTotalWins = 0;
let careerTotalLosses = 0;
// Getrennt von careerSeasonIncomeTotal (Runde 34) -- Sponsoring-Erlöse fließen
// NICHT direkt in BUDGET (das würde bei der nächsten startNextSeason()-
// Neuberechnung verlorengehen, siehe deren "BUDGET = rosterValue + income"-
// Formel), sondern nur in diesen separaten, rein für die Finanzen-Anzeige
// gedachten Tracker (siehe financeTotalIncome()-Erweiterung unten).
let careerSponsorIncomeTotal = 0;

// Runde 101, User-Vorgabe ("Preisgeld-Logik: wenn man Preisgeld gewinnt,
// bekommt man es erst 7 Tage nach Turnierende, bis dahin als 'nicht
// zugeteiltes Budget' auf der Finanzen-Seite angezeigt, danach beim
// Gesamtsaldo dazugerechnet"): Einträge `{ eventKey, eventLabel, amount,
// availableDate }` -- `amount` fließt erst bei `careerDate >=
// availableDate` (processDuePrizePayouts()) tatsächlich in
// `assignedOrg.budget` (die echte "Gesamtsaldo"-Zahl der Finanzen-Seite,
// siehe renderDashboardFinancePanel() -- NICHT das alte, saisonweise neu
// berechnete BUDGET, das würde bei startNextSeason() verlorengehen, siehe
// Kommentar an careerSponsorIncomeTotal oben). Karrierelang gültig wie
// careerSponsorIncomeTotal -- NUR bei "Neues Spiel" zurückgesetzt, NICHT bei
// startNextSeason() (ein Preisgeld kurz vor Saisonende darf über den
// Saisonwechsel hinweg fällig werden).
let pendingPrizePayouts = [];

// Runde 102, komplette User-Vorgabe (Preisgeld-Platzierungstabellen für
// Open/Major/Worlds, siehe OPEN_PRIZE_TABLE/MAJOR_PRIZE_TABLE/
// WORLDS_PRIZE_TABLE in data/tournament-calendar.js) -- ersetzt den
// bisherigen Runde-101-Platzhalter ("nur der komplette Turniersieg zahlt
// aus"). `table`: eine der drei PRIZE_TABLEs, `place`: derselbe Tier-Anker-
// Wert, den awardTournamentPoints() schon für Saison-Punkte nutzt (siehe
// resolveOpenEvent()/resolveMajorEvent()). Skaliert wie tournamentEventPrize()
// mit +3%/Saison (Disclosed Annahme: die vom User genannten Beträge sind
// Saison-1-Basiswerte, damit Preisgeld über eine lange Karriere hinweg
// genauso "mitwächst" wie der angezeigte Gesamt-Pool).
function prizeAmountForPlacement(table, place, seasonNumber) {
  const tier = table.find((t) => place >= t.minPlace && place <= t.maxPlace);
  if (!tier) return 0;
  const growth = 1 + (seasonNumber - 1) * 0.03;
  // Rundung auf 100 statt 1000 (anders als tournamentEventPrize()) -- die
  // kleinsten Open-Preisgeld-Stufen (900/1.200/1.800) sind selbst schon unter
  // 1000, eine 1000er-Rundung würde sie in Saison 1 (Wachstumsfaktor exakt 1)
  // sofort verfälschen statt den vom User exakt vorgegebenen Betrag zu zeigen.
  return Math.round((tier.amount * growth) / 100) * 100;
}

function prizeTableForEvent(event) {
  if (event.eventType === 'open' && event.key !== 'open0') return OPEN_PRIZE_TABLE;
  if (event.eventType === 'major') return MAJOR_PRIZE_TABLE;
  if (event.eventType === 'worlds') return WORLDS_PRIZE_TABLE;
  // 'lcq' (User Runde 102: "hat kein Preisgeld") und 'open0' (isSeasonGate,
  // kein echter Sieger/Preisgeld) -- bewusst KEINE Tabelle, Preisgeld dafür
  // immer 0 (siehe tournamentEventPrize()/queuePrizePayoutForPlacement()).
  return null;
}

// Löst (sofern eine Tabelle für dieses Event existiert UND die eigene Org
// überhaupt in `placements` auftaucht) einen verzögerten Payout nach der
// ECHTEN Platzierung aus -- für Open 1-6/Major/Worlds.
function queuePrizePayoutForPlacement(event, placements) {
  if (!assignedOrg || !placements) return;
  const table = prizeTableForEvent(event);
  if (!table) return;
  const own = placements.find((p) => p.orgName === assignedOrg.name);
  if (!own) return;
  const amount = prizeAmountForPlacement(table, own.place, event.seasonNumber);
  if (!amount) return;
  pendingPrizePayouts.push({
    eventKey: event.key, eventLabel: event.label, amount,
    availableDate: addDaysToDateStr(event.endDate, 7),
  });
}


// Wird bei jedem Tagfortschritt aufgerufen (siehe advanceOneCalendarDay()):
// verbucht jeden fälligen Payout in assignedOrg.budget und entfernt ihn aus
// der Warteliste.
function processDuePrizePayouts() {
  const due = pendingPrizePayouts.filter((p) => careerDate >= p.availableDate);
  if (due.length === 0) return;
  due.forEach((p) => {
    assignedOrg.budget += p.amount;
    addFinanceMonthlyIncome(p.amount, 'Preisgeld', p.eventLabel || 'Turnier-Preisgeld');
  });
  pendingPrizePayouts = pendingPrizePayouts.filter((p) => careerDate < p.availableDate);
}

// ── Spielergehälter + monatliches Vorstandsbudget (Runde 121, User-Vorgabe:
// "Monatliches Gehalt zahlen" + "monatlich realistisch ... Budget vom
// Vorstand, mit dem man arbeiten kann") ─────────────────────────────────
// Gehalt wird bewusst NICHT als eigenes, persistiertes Feld pro Spieler
// gespeichert (hätte rollPlayer()/rollReplacementPerson()/die Free-Agent-
// Hydrierung UND eine Save-Migration erfordert), sondern -- genau wie der
// Marktwert (calculatePrice(overall)) -- live aus dem Overall abgeleitet:
// 2 % des einmaligen Marktwerts als LAUFENDES Monatsgehalt. Bei einem
// 90-Overall-Spieler (~1,43 Mio. € Marktwert) macht das rund 28.700 €/Monat.
const PLAYER_SALARY_PCT_OF_VALUE = 0.02;
function playerMonthlySalary(person) {
  return Math.round(calculatePrice(person.overall) * PLAYER_SALARY_PCT_OF_VALUE / 100) * 100;
}

// ── "Reserve"-Kategorie + 7-Tage-Ankunftsverzögerung (Runde 122, User-
// Vorgabe: "füge reserve spieler kategorie hinzu, dort landen alle spieler
// die man kauft" + "Hinweistext dass Spieler erst in 7 Tagen erscheinen wird
// (soll dann auch wirklich so sein)") ────────────────────────────────────
// assignedOrg.roster.reserve fasst bis zu 6 gekaufte, noch nicht in Starter-/
// Sub-Slots eingesetzte Spieler. Ein gerade verpflichteter Spieler landet
// NICHT sofort dort, sondern erst nach `pendingPlayerArrivals` (siehe
// queuePlayerArrival()/processDuePlayerArrivals()) -- damit die 7-Tage-
// Angabe echt ist, nicht nur Text.
const KADER_RESERVE_SLOTS = 6;
// { player, availableDate } -- ausschließlich für assignedOrg (nur der
// Spieler kauft über Scouting), NICHT Teil von assignedOrg.roster selbst,
// da diese Spieler bis zur Ankunft explizit NOCH NICHT auf dem Kader stehen.
let pendingPlayerArrivals = [];

function queuePlayerArrival(person, anchorDate) {
  pendingPlayerArrivals.push({ player: person, availableDate: addDaysToDateStr(anchorDate, 7) });
}

// Wird bei jedem Tagfortschritt aufgerufen (siehe advanceOneCalendarDay()),
// analog zu processDuePrizePayouts(). Reserve-Kapazität wird bereits beim
// KAUF geprüft (siehe executePlayerSigning()) -- zum Ankunftszeitpunkt ist
// deshalb im Normalfall immer Platz.
function processDuePlayerArrivals() {
  const due = pendingPlayerArrivals.filter((a) => careerDate >= a.availableDate);
  if (due.length === 0) return;
  due.forEach((a) => assignedOrg.roster.reserve.push(a.player));
  pendingPlayerArrivals = pendingPlayerArrivals.filter((a) => careerDate < a.availableDate);
}

// Wie viele der 6 Reserve-Plätze aktuell belegt/reserviert sind -- zählt
// sowohl bereits angekommene Reserve-Spieler ALS AUCH noch unterwegs
// befindliche Neuzugänge mit (sonst könnte man über die 6er-Grenze hinaus
// kaufen, solange die 7 Tage noch laufen).
function reserveSlotsOccupied() {
  return (assignedOrg.roster.reserve || []).length + pendingPlayerArrivals.length;
}

// Summe der Monatsgehälter EINER Org -- Starter+Sub+Reserve (Runde 122: auch
// Reserve-Spieler stehen unter Vertrag und kosten Gehalt, auch wenn sie nie
// spielen -- realistisch, wie eine echte Kaderbank) PLUS alle noch
// ausstehenden Neuzugänge (pendingPlayerArrivals, Runde 122: der Vertrag
// läuft schon ab dem Verpflichten, nicht erst ab der 7-Tage-Ankunft, sonst
// könnte man das Gehälter-Budget während der Wartezeit umgehen). Bewusst
// ohne Personal/Coach, da deren Finanz-Seite (Verpflichten) diese Runde
// erstmal gesperrt bleibt (siehe scoutingStaffRowHtml()-Kommentar).
// `pendingPlayerArrivals` betrifft ausschließlich assignedOrg (nur der
// Spieler kauft über Scouting) -- deshalb hier gezielt nur für diese Org
// mitgezählt.
function totalMonthlySalaryCommitment(org) {
  const roster = org.roster;
  const people = [...roster.starters, roster.sub, ...(roster.reserve || [])].filter(Boolean);
  const pendingPeople = org === assignedOrg ? pendingPlayerArrivals.map((a) => a.player) : [];
  return [...people, ...pendingPeople].reduce((sum, p) => sum + playerMonthlySalary(p), 0);
}

// "Realistisch": skaliert mit dem AKTUELLEN Kaderwert (nicht mit dem sich
// selbst aufblähenden assignedOrg.budget, sonst würde die Summe unbegrenzt
// weiterwachsen) -- 2 % des Kaderwerts pro Monat, dasselbe Rundungsschema
// wie computeOrgBudget() (nächste 10.000 €). Fließt wie jedes andere neue
// Einkommen in "nicht eingeteiltes Geld" (financeUnallocated()), NICHT
// automatisch anteilig in eine der 4 Kategorien (Runde-108-Grundsatz).
const MONTHLY_BOARD_BUDGET_PCT = 0.02;
function monthlyBoardBudgetAmount(org) {
  return Math.round(orgRosterMarketValue(org.roster) * MONTHLY_BOARD_BUDGET_PCT / 10000) * 10000;
}

// Läuft einmal pro echtem Kalender-Monatswechsel (siehe advanceOneCalendarDay()).
// Gehalt wird sowohl vom Gesamtbudget ALS AUCH vom "Gehälter"-Regler
// abgezogen (exakt dasselbe Zwei-Konten-Muster wie bei einem Transfer-Kauf,
// siehe executePlayerSigning()) -- reicht der Gehälter-Topf nicht (z.B. nach
// nachträglichem Umverteilen der Regler), wird er auf 0 gekappt statt negativ
// zu werden (kein Bankrott-/Verschuldungssystem in diesem Spiel, dieselbe
// Kappung wie überall sonst in diesem Projekt).
function applyMonthlyClubFinances() {
  const salaryTotal = totalMonthlySalaryCommitment(assignedOrg);
  if (salaryTotal > 0) {
    assignedOrg.budget -= salaryTotal;
    financeAllocation.salaries = Math.max(0, (financeAllocation.salaries || 0) - salaryTotal);
    const playerCount = [...assignedOrg.roster.starters, assignedOrg.roster.sub].filter(Boolean).length;
    addFinanceMonthlyExpense(salaryTotal, 'Gehälter', 'Monatliche Spielergehälter (' + playerCount + ' Spieler)');
  }
  const boardBudget = monthlyBoardBudgetAmount(assignedOrg);
  if (boardBudget > 0) {
    assignedOrg.budget += boardBudget;
    addFinanceMonthlyIncome(boardBudget, 'Vorstand', 'Monatliches Budget vom Vorstand');
  }
}

// Bug-Fix (User-Meldung: "aufgaben können nie erfüllt werden"): die Ziel-
// Prüfung hing bis hierhin an careerTotalWins/seasonState/careerRivalRecords
// -- Werte, die AUSSCHLIESSLICH vom alten, seit dem Dashboard-Umbau (Runde
// 31/68, "Neues Spiel"/"Fortsetzen" führen direkt ins Dashboard) praktisch
// unerreichbaren tournament.js/season.js-Pfad geschrieben werden
// (accumulatePlayerRecord()/startNextSeason(), siehe deren Kommentare).
// Im echten, aktuellen Spielfluss (resolveOpenEvent()/resolveMajorEvent()/
// resolveLcqEvent()/resolveWorldsEvent(), Runde 79-106) blieben diese Werte
// deshalb für immer bei 0/null stehen -- außer "seasons" (careerState.
// seasonNumber wird korrekt von resetSeasonScopedDashboardState() hochgezählt)
// war dadurch KEIN Ziel-Typ in der echten Spielschleife jemals erfüllbar.
// Fix: Siege/Niederlagen werden jetzt live aus `matchHistory` (dem echten,
// seit Runde 89 laufend befüllten Matchdaten-Log) für assignedOrg.name
// gezählt, "Titel" wird direkt im Worlds-Auflösungspfad hochgezählt (siehe
// resolveEventIfDue()), "Rivalen" = Siege innerhalb der eigenen Region
// (Open/LCQ, dort wiederholt dieselben Gegner -- Major/Worlds sind global,
// dort gibt es kein wiederkehrendes "Rivalen"-Konzept).
function sponsorCareerWinCount() {
  return matchHistory.filter((m) => m.winner === assignedOrg.name).length;
}
function sponsorSeasonWinCount() {
  return matchHistory.filter((m) => m.winner === assignedOrg.name && m.season === careerState.seasonNumber).length;
}
function sponsorRivalWinCount() {
  const region = orgRegion(assignedOrg.country);
  return matchHistory.filter((m) => m.winner === assignedOrg.name && m.region === region).length;
}

const SPONSOR_GOAL_CHECKERS = {
  seasonWins: (t) => sponsorSeasonWinCount() >= t,
  careerWins: (t) => sponsorCareerWinCount() >= t,
  titles: (t) => careerState.titlesWon >= t,
  seasons: (t) => careerState.seasonNumber > t,
  rivalWins: (t) => sponsorRivalWinCount() >= t,
};

// Liefert den aktuellen Fortschrittswert (nicht nur ob-fertig) pro Ziel-Typ,
// für die Fortschrittsbalken/Bruch-Anzeige ("0/33") im Detailpanel -- an
// dieselben echten Karrierewerte wie SPONSOR_GOAL_CHECKERS gekoppelt.
const SPONSOR_GOAL_PROGRESS = {
  seasonWins: () => sponsorSeasonWinCount(),
  careerWins: () => sponsorCareerWinCount(),
  titles: () => careerState.titlesWon,
  seasons: () => Math.max(0, careerState.seasonNumber - 1),
  rivalWins: () => sponsorRivalWinCount(),
};
function sponsorGoalProgress(goal) {
  const getter = SPONSOR_GOAL_PROGRESS[goal.type];
  const current = getter ? getter() : 0;
  return { current: Math.min(current, goal.threshold), threshold: goal.threshold };
}

// User-Vorgabe exakt nachgerechnet ("Orga mit 5 Sterne bekommen 5 Sterne
// Sponsoring angenommen... 1 Sterne Orgas alles bei 2 Sterne... Tier C und D"):
// eine Org bekommt Sponsoren bis (eigene Sterne + 1) angenommen, alles
// darüber wird abgelehnt.
function sponsorWillBeAccepted(sponsor) {
  const orgStars = orgStarRating(assignedOrg.strength);
  return sponsor.stars <= orgStars + 1;
}

function sponsorStatus(name) {
  const st = sponsorState[name];
  if (!st) return 'available';
  if (st.lockedUntil && careerDate < st.lockedUntil) return 'locked';
  if (st.active) return 'active';
  if (st.pending) return 'pending';
  if (st.cooldownUntil && careerDate < st.cooldownUntil) return 'unavailable';
  return 'available';
}

// Wird bei jedem Tagfortschritt (advanceDashboardDay()) aufgerufen -- prüft
// alle offenen Bewerbungen, ob ihre Antwortzeit (7-14 Tage, siehe
// confirmSponsorRequest()) erreicht ist, und löst abgelaufene Sperren wieder
// auf.
// User-Vorgabe Runde 41: wenn mehrere Bewerbungen gleichzeitig/im selben
// Tagfortschritt zusagen würden, aber nur noch weniger freie Slots übrig
// sind als Zusagen, bekommt NUR "wer zuerst zugesagt hat" (frühestes
// responseDate, bei Gleichstand frühestes requestDate) die verbleibenden
// Slots -- der Rest verfällt (kein Cooldown/keine Sperre, siehe unten).
function resolveSponsorResponses() {
  let changed = false;

  const due = Object.keys(sponsorState).filter((name) => {
    const st = sponsorState[name];
    return st.pending && st.responseDate && careerDate >= st.responseDate;
  });
  due.sort((a, b) => {
    const stA = sponsorState[a];
    const stB = sponsorState[b];
    if (stA.responseDate !== stB.responseDate) return stA.responseDate < stB.responseDate ? -1 : 1;
    if (stA.requestDate !== stB.requestDate) return stA.requestDate < stB.requestDate ? -1 : 1;
    return 0;
  });

  due.forEach((name) => {
    const st = sponsorState[name];
    st.pending = false;
    changed = true;
    const sponsor = SPONSORS.find((s) => s.name === name);
    if (sponsor && sponsorWillBeAccepted(sponsor)) {
      if (activeSponsorCount() < MAX_ACTIVE_SPONSORS) {
        st.active = true;
        st.completedGoals = sponsor.goals.map(() => false);
        st.collectedGoals = sponsor.goals.map(() => false);
        st.rejectionCount = 0;
      } else {
        // Kapazität war schon voll, als diese Zusage an der Reihe war --
        // die Zusage selbst verfällt ersatzlos (kein Cooldown/keine Sperre,
        // der Sponsor hätte ja zugesagt, es lag nur an der eigenen Kapazität).
        delete sponsorState[name];
      }
    } else {
      st.rejectionCount = (st.rejectionCount || 0) + 1;
      const d = parseCareerDate(careerDate);
      if (st.rejectionCount >= 2) {
        d.setUTCFullYear(d.getUTCFullYear() + 1); // "1 ganze Season (1. Jahr)"
        st.lockedUntil = d.toISOString().slice(0, 10);
      } else {
        d.setUTCMonth(d.getUTCMonth() + 1);
        st.cooldownUntil = d.toISOString().slice(0, 10);
      }
    }
  });

  Object.keys(sponsorState).forEach((name) => {
    const st = sponsorState[name];
    if (st.lockedUntil && careerDate >= st.lockedUntil) {
      st.lockedUntil = null;
      st.rejectionCount = 0;
      changed = true;
    }
  });

  if (changed) saveGameState();
}

// Prüft bei aktiven (angenommenen) Sponsoren jedes noch offene Ziel gegen die
// echten Karrierewerte -- pro fertigem Ziel gibt es sofort die Ziel-Prämie.
// Nach dem LETZTEN Ziel wird NICHT mehr automatisch ausgezahlt (User-Korrektur,
// Runde 40): der Bonus wird einmalig ausgewürfelt und in st.bonusAmount
// festgehalten, st.bonusReady=true markiert ihn als "abholbar" -- die
// eigentliche Auszahlung + das Entfernen des Sponsors passiert erst manuell
// über collectSponsorBonus().
// User-Vorgabe (diese Runde): Ziel-Prämien werden NICHT mehr automatisch
// ausgezahlt, sobald die Bedingung erfüllt ist -- `completedGoals[i]` markiert
// weiterhin nur "Bedingung erfüllt" (steuert Haken/Durchstreichen UND den
// Abschluss-Bonus-Trigger, unverändert), ein neues, unabhängiges
// `collectedGoals[i]` merkt sich, ob der Spieler die Prämie bereits manuell
// über den "Abholen"-Button (siehe sponsorGoalRowHtml()/
// collectSponsorGoalReward()) kassiert hat. Der Abschluss-Bonus wird weiterhin
// ausgewürfelt, sobald ALLE Bedingungen erfüllt sind (nicht erst nach dem
// Abholen jeder Einzelprämie) -- unverändert zur bisherigen Logik.
function checkSponsorGoals() {
  let changed = false;
  Object.keys(sponsorState).forEach((name) => {
    const st = sponsorState[name];
    if (!st.active) return;
    const sponsor = SPONSORS.find((s) => s.name === name);
    if (!sponsor) return;
    if (!st.collectedGoals) st.collectedGoals = sponsor.goals.map(() => false);
    sponsor.goals.forEach((g, i) => {
      if (st.completedGoals[i]) return;
      const checker = SPONSOR_GOAL_CHECKERS[g.type];
      if (checker && checker(g.threshold)) {
        st.completedGoals[i] = true;
        changed = true;
      }
    });
    if (!st.bonusReady && sponsor.goals.every((g, i) => st.completedGoals[i])) {
      st.bonusAmount = Math.round((sponsor.revenueMin + Math.random() * (sponsor.revenueMax - sponsor.revenueMin)) / 100) * 100;
      st.bonusReady = true;
      changed = true;
    }
  });
  if (changed) saveGameState();
}

// Manuelle Auszahlung EINER Einzel-Zielprämie (User-Vorgabe: "Abholen"-Button
// pro erfüllter Aufgabe) -- wandert in careerSponsorIncomeTotal (Anzeige
// "Gesamteinnahmen") UND direkt in assignedOrg.budget (das echte
// "Gesamtsaldo" der Finanzen-Seite -- seit dem kalendergetriebenen
// Dashboard-Umbau der stabile, karrierelange Geldwert, siehe
// resetSeasonScopedDashboardState()-Kommentar "KEINE Budget-Änderung hier").
// Da financeAllocation seit dieser Runde feste €-Beträge statt Prozente sind
// (siehe renderFinanceAllocSliders()), landet der Betrag automatisch in
// "nicht eingeteiltes Geld" -- KEINE der 4 Kategorien wird automatisch
// mit-erhöht, User-Vorgabe exakt so.
function collectSponsorGoalReward(name, i) {
  const st = sponsorState[name];
  if (!st || !st.completedGoals || !st.completedGoals[i]) return;
  if (!st.collectedGoals) st.collectedGoals = [];
  if (st.collectedGoals[i]) return;
  const sponsor = SPONSORS.find((s) => s.name === name);
  if (!sponsor) return;
  st.collectedGoals[i] = true;
  const reward = sponsor.goals[i].reward;
  careerSponsorIncomeTotal += reward;
  assignedOrg.budget += reward;
  addFinanceMonthlyIncome(reward, 'Sponsoring', name + ': ' + sponsor.goals[i].label);
  saveGameState();
  renderDashboardSponsorsPanel();
  refreshDashboardSidebarBadges();
}

// Manuelle Auszahlung des fertig ausgewürfelten Bonus (siehe checkSponsorGoals())
// -- erst hier wandert der Betrag tatsächlich in careerSponsorIncomeTotal +
// assignedOrg.budget (siehe collectSponsorGoalReward()-Kommentar), danach
// verschwindet der Sponsor (muss für ein neues Engagement neu angefragt
// werden, User-Wunsch exakt so).
function collectSponsorBonus(name) {
  const st = sponsorState[name];
  if (!st || !st.bonusReady) return;
  careerSponsorIncomeTotal += st.bonusAmount;
  assignedOrg.budget += st.bonusAmount;
  addFinanceMonthlyIncome(st.bonusAmount, 'Sponsoring', name + ': Abschluss-Bonus (alle Ziele erfüllt)');
  delete sponsorState[name];
  if (selectedSponsorName === name) selectedSponsorName = null;
  saveGameState();
  renderDashboardSponsorsPanel();
  refreshDashboardSidebarBadges();
}

// Vorzeitige Vertragsauflösung durch den Spieler (User-Vorgabe, Runde 40):
// KEIN Bonus, auch wenn zufällig gerade alle Ziele erfüllt sind ("wenn nicht
// der fall ist bekommt er trotzdem kein boni ausgezhalt wenn er voher
// vertrag beendet") -- bereits ausgezahlte Ziel-Prämien bleiben natürlich
// erhalten, nur der Abschluss-Bonus entfällt.
function fireSponsor(name) {
  if (!sponsorState[name]) return;
  delete sponsorState[name];
  if (selectedSponsorName === name) selectedSponsorName = null;
  saveGameState();
  renderDashboardSponsorsPanel();
}

// Ein Log-Eintrag "belegt" seinen Slot genau 1 Monat lang ab seinem eigenen
// Datum (z.B. Anfrage am 10.Jan -> Slot wieder frei am 10.Feb). Anfragen an
// unterschiedlichen Tagen laufen deshalb unabhängig voneinander wieder ab,
// nicht alle gemeinsam zum Monatsersten.
function activeSponsorRequestCount() {
  return sponsorRequestLog.filter((reqDate) => {
    const expiry = parseCareerDate(reqDate);
    expiry.setUTCMonth(expiry.getUTCMonth() + 1);
    const expiryStr = expiry.toISOString().slice(0, 10);
    return careerDate < expiryStr;
  }).length;
}
function remainingSponsorRequests() {
  return Math.max(0, MAX_SPONSOR_REQUESTS_PER_MONTH - activeSponsorRequestCount());
}

function formatDashboardDate(iso) {
  const date = parseCareerDate(iso);
  return {
    weekday: DASHBOARD_WEEKDAYS[date.getUTCDay()] + ',',
    dateLine: String(date.getUTCDate()).padStart(2, '0') + ' ' + DASHBOARD_MONTHS[date.getUTCMonth()] + ' ' + date.getUTCFullYear(),
  };
}

// DD.MM.YYYY (Runde 117, Vertragsdaten) -- eigenes, kompakteres Format als
// formatDashboardDate() (das für die Topbar-Anzeige gedacht ist), passend
// zum Referenz-Screenshot der Scouting-Seite ("05.05.2027").
function formatContractDate(dateStr) {
  const date = parseCareerDate(dateStr);
  return String(date.getUTCDate()).padStart(2, '0') + '.' + String(date.getUTCMonth() + 1).padStart(2, '0') + '.' + date.getUTCFullYear();
}

function renderDashboardTopbar() {
  document.getElementById('dashboard-manager-name').textContent = careerCharacter.name;
  document.getElementById('dashboard-org-name').textContent = assignedOrg.shortname || assignedOrg.name;

  const logoUrl = resolveOrgLogoUrl(assignedOrg);
  const logoEl = document.getElementById('dashboard-org-logo');
  logoEl.innerHTML = logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div class="dashboard-org-logo-placeholder" style="background:' + orgBadgeColor(assignedOrg.name) + ';">' + assignedOrg.name.trim().charAt(0).toUpperCase() + '</div>';

  const { weekday, dateLine } = formatDashboardDate(careerDate);
  document.getElementById('dashboard-date-weekday').textContent = weekday;
  document.getElementById('dashboard-date-line').textContent = dateLine;

  const region = orgRegion(assignedOrg.country);
  document.getElementById('dashboard-region-value').textContent = region ? ORG_REGION_LABELS[region].toUpperCase() : 'UNBEKANNT';

  // Runde 99, Bug-Fix (User-Meldung: "am Tag der Auslosung wird der Button
  // zu MATCH statt WEITER zu bleiben, und beim Klick auf MATCH wird das
  // erste Match sofort simuliert statt am nächsten Tag, ohne dass sich die
  // Ticker-UI öffnet"): die alte Runde-95-Vorschau (peekOwnMatchTomorrow(),
  // "zeig MATCH schon HEUTE, wenn morgen ein Match ansteht") passte zum
  // damaligen Verhalten, bei dem ein Klick Tag UND Match in einem Rutsch
  // erledigte. Seit der Runde-99-Entkopplung (Tagfortschritt und Match-Start
  // sind jetzt getrennte Klicks, siehe pendingOwnMatch/triggerPendingOwnMatch())
  // war diese Vorschau nur noch eine falsche Ankündigung: sie zeigte MATCH
  // schon EINEN Tag zu früh (z.B. am neuen Auslosungstag, weil dort bereits
  // vorhersehbar ist, dass morgen ein Match kommt), obwohl ein Klick an
  // diesem Tag nur den Tag weiterschiebt (pendingOwnMatch ist ja noch leer)
  // -- ohne jede sichtbare Reaktion, keine Ticker-UI. Der Button zeigt jetzt
  // AUSSCHLIESSLICH pendingOwnMatch (ein WIRKLICH schon gefundenes, noch
  // nicht gestartetes Match) -- "MATCH" heißt ab jetzt immer "ein Klick
  // startet garantiert sofort den Ticker", nie mehr eine Vorhersage auf
  // übermorgen. peekOwnMatchTomorrow() dadurch komplett entfernt (totes
  // Vorschau-Konzept, siehe frühere Fassung dieser Datei).
  document.getElementById('btn-dashboard-advance-day').textContent = pendingOwnMatch ? 'MATCH »' : 'WEITER »';
  // Runde 100, User-Vorgabe ("während der Match-Phase, wenn der Button zu
  // MATCH wechselt, verschwindet der Schnellvorlauf-Pfeil"): ein offenes
  // pendingOwnMatch darf nie übersprungen werden (siehe
  // fastForwardToNextEventDay()), der Pfeil wäre in diesem Zustand ohnehin
  // wirkungslos -- blendet stattdessen ganz aus, statt einen funktionslosen
  // Button stehen zu lassen.
  // Runde 105, User-Vorgabe ("während eines laufenden Turnieres soll der
  // Pfeil/Skip-Button weg sein"): zusätzlich zum bestehenden pendingOwnMatch-
  // Fall blendet der Pfeil jetzt auch aus, solange IRGENDEIN Turnier gerade
  // seine Enthüllungsspanne durchläuft (siehe isAnyTournamentCurrentlyRevealing())
  // -- sonst könnte man an der ganzen neuen Match-für-Match-Erfahrung
  // (Auslosungstage, Kaskaden-Animation, Runden-Gating) einfach vorbeispringen.
  document.getElementById('btn-dashboard-fast-forward').classList.toggle('hidden', !!pendingOwnMatch || isAnyTournamentCurrentlyRevealing(careerDate));
  // Runde 105, Bug-Fix ("Rest der Gruppenphase/Playoffs wird nach dem eigenen
  // Match sofort auto simuliert statt Match für Match zu kaskadieren"): so
  // lange die Kaskaden-Animation eines Enthüllungsschritts noch läuft
  // (cascadeAnimationActive, siehe cascadeRevealStep()), wird WEITER/MATCH
  // deaktiviert -- ein hastiger Klick würde die Turnier-Detailseite sonst für
  // den nächsten Tag komplett neu aufbauen und die noch laufende Animation
  // mittendrin durch die fertige Endansicht ersetzen, bevor der Spieler sie
  // je zu Gesicht bekommen hat.
  const advanceBtn = document.getElementById('btn-dashboard-advance-day');
  advanceBtn.disabled = cascadeAnimationActive;
  advanceBtn.title = cascadeAnimationActive ? 'Ergebnisse werden noch angezeigt …' : '';

  refreshDashboardSidebarBadges();
}

// User-Vorgabe (diese Runde): rote Zahl an "Sponsoren" (Anzahl abholbereiter
// Einzel-Zielprämien + Abschluss-Boni, siehe collectSponsorGoalReward()/
// collectSponsorBonus()) und rote "1" an "Finanzen" sobald "nicht
// eingeteiltes Geld" > 0€ ist (siehe financeUnallocated()). Wird bei jedem
// renderDashboardTopbar()-Aufruf neu berechnet (Tagfortschritt, Dashboard-
// Öffnen) UND direkt nach jeder Abholen-Aktion.
function sponsorReadyToCollectCount() {
  let count = 0;
  Object.keys(sponsorState).forEach((name) => {
    const st = sponsorState[name];
    if (!st.active) return;
    const sponsor = SPONSORS.find((s) => s.name === name);
    if (!sponsor) return;
    sponsor.goals.forEach((g, i) => {
      if (st.completedGoals[i] && !(st.collectedGoals && st.collectedGoals[i])) count += 1;
    });
    if (st.bonusReady) count += 1;
  });
  return count;
}

function refreshDashboardSidebarBadges() {
  const sponsorBadge = document.getElementById('dashboard-sidebar-badge-sponsors');
  const sponsorCount = sponsorReadyToCollectCount();
  sponsorBadge.textContent = String(sponsorCount);
  sponsorBadge.classList.toggle('hidden', sponsorCount <= 0);

  const financeBadge = document.getElementById('dashboard-sidebar-badge-finance');
  const hasUnallocated = financeUnallocated() > 0;
  financeBadge.textContent = '1';
  financeBadge.classList.toggle('hidden', !hasUnallocated);
}

// ── Dashboard-Seite "Startseite" (User-Vorgabe: UI wie im mitgeschickten
// Referenz-Screenshot "Esports Manager 2026"). Reine Kurzübersicht aus
// bereits bestehenden, echten Datenquellen -- kein neues Datenmodell.
// Zwei Abweichungen vom Referenz-Screenshot, disclosed:
// (1) Kein Kartentraining-System im Spiel vorhanden (siehe "Training",
//     gesperrte Seite) -- das Status-Banner zeigt stattdessen echte
//     Kader-Mindestgröße-/Reserve-Warnungen (rosterMeetsTournamentMinimum(),
//     reserveSlotsOccupied()).
// (2) "Globale ERS-Rangliste" (ein erfundenes, regionsübergreifendes Elo-/
//     Liga-Stufen-System) gibt es hier nicht -- Saison-Punkte sind seit
//     Runde 90 bewusst REGIONAL gebunden (seasonLeaderboardForRegion()),
//     daher zeigt diese Karte die echte Saison-Rangliste der eigenen
//     Region, dieselbe Datenquelle/Hervorhebung wie Statistiken (Runde
//     110/112, statsTeamRows()/statsQualifyingOrgSet()).
function dashboardHomeMiniAvatarHtml(person, roleLabel) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === person.avatarId) || CHARACTER_AVATARS[0];
  return (
    '<div class="dashboard-home-mini-avatar" title="' + person.name + ' (' + roleLabel + ')">' +
      '<div class="dashboard-home-mini-avatar-circle" style="background:' + avatar.color + '33">' + avatar.emoji + '</div>' +
      '<span class="dashboard-home-mini-avatar-name">' + person.name + '</span>' +
    '</div>'
  );
}

function dashboardHomeUpcomingItemHtml(ev) {
  let statusText;
  if (careerDate > ev.phaseDates.registration.end) {
    statusText = 'Turnier läuft';
  } else if (careerDate >= ev.phaseDates.registration.start) {
    statusText = 'Anmeldung läuft';
  } else {
    const daysUntilReg = daysBetweenDateStrs(careerDate, ev.phaseDates.registration.start);
    statusText = 'Anmeldung öffnet in ' + daysUntilReg + ' Tag' + (daysUntilReg === 1 ? '' : 'en');
  }
  return (
    '<div class="dashboard-home-upcoming-item" data-home-tournament="' + ev.key + '">' +
      '<div class="dashboard-home-upcoming-logo" style="background:' + ev.color + ';">' + ev.icon + '</div>' +
      '<div class="dashboard-home-upcoming-text">' +
        '<span class="dashboard-home-upcoming-name">' + ev.label + '</span>' +
        '<span class="dashboard-home-upcoming-stars">' + tournamentStarsHtml(ev.stars) + '</span>' +
      '</div>' +
      '<span class="dashboard-home-upcoming-countdown">' + statusText + '</span>' +
    '</div>'
  );
}

function dashboardHomeResultItemHtml(m) {
  const isOwnA = m.teamA === assignedOrg.name;
  const opponent = isOwnA ? m.teamB : m.teamA;
  const ownScore = isOwnA ? m.scoreA : m.scoreB;
  const oppScore = isOwnA ? m.scoreB : m.scoreA;
  const won = m.winner === assignedOrg.name;
  return (
    '<div class="dashboard-home-result-item">' +
      '<span class="dashboard-home-result-pill ' + (won ? 'is-win' : 'is-loss') + '">' + (won ? 'S' : 'N') + '</span>' +
      '<span class="dashboard-home-result-opponent">vs. ' + opponent + '</span>' +
      '<span class="dashboard-home-result-score">' + ownScore + ':' + oppScore + '</span>' +
    '</div>'
  );
}

function dashboardHomeRankingRowHtml(row, rank, qualifyingSet) {
  const isOwn = assignedOrg && row.org.name === assignedOrg.name;
  const qualifies = qualifyingSet.has(row.org.name);
  return (
    '<div class="dashboard-stats-row' + (isOwn ? ' is-own-org' : '') + (qualifies ? ' is-qualified' : '') + '" title="' + (qualifies ? 'Qualifiziert sich aktuell für Major/Weltmeisterschaft' : '') + '">' +
      '<span class="dashboard-stats-row-rank">#' + rank + '</span>' +
      '<div class="dashboard-stats-row-team">' +
        '<div class="dashboard-stats-row-logo">' + statsRowLogoHtml(row.org) + '</div>' +
        '<span class="dashboard-stats-row-name">' + row.org.name + '</span>' +
      '</div>' +
      '<span class="dashboard-stats-row-num">' + row.points + '</span>' +
    '</div>'
  );
}

function renderDashboardHomePanel() {
  const org = assignedOrg;
  const region = orgRegion(org.country);

  // Status-Banner: echte Kader-Mindestgröße-/Reserve-Warnung statt des
  // erfundenen Kartentraining-Hinweises aus dem Referenz-Screenshot.
  const hasMinRoster = rosterMeetsTournamentMinimum();
  const reserveFull = reserveSlotsOccupied() >= KADER_RESERVE_SLOTS;
  const banner = document.getElementById('dashboard-home-status-banner');
  const iconEl = document.getElementById('dashboard-home-status-icon');
  const titleEl = document.getElementById('dashboard-home-status-title');
  const subEl = document.getElementById('dashboard-home-status-sub');
  if (!hasMinRoster) {
    banner.classList.add('is-warning');
    iconEl.textContent = '⚠️';
    titleEl.textContent = 'Kader zu klein';
    subEl.textContent = 'Mindestens 3 Spieler nötig, um an Turnieren teilzunehmen -- hol dir Verstärkung über Scouting.';
  } else if (reserveFull) {
    banner.classList.add('is-warning');
    iconEl.textContent = '⚠️';
    titleEl.textContent = 'Reserve voll';
    subEl.textContent = 'Kein Platz mehr für neue Spieler -- verkaufe zuerst jemanden, bevor du Neuzugänge verpflichtest.';
  } else {
    banner.classList.remove('is-warning');
    iconEl.textContent = '👍';
    titleEl.textContent = 'Alles geregelt';
    subEl.textContent = 'Keine Probleme. Weiter zum nächsten Tag.';
  }

  // "Organisation"-Karte: aktiver Kader (Starter + Sub) als kompakte
  // Avatar-Reihe, echter Team-Zustand (Runde 119, Team-Chemie).
  const starters = (org.roster && org.roster.starters) || [];
  const sub = org.roster && org.roster.sub;
  const avatarsHtml = starters.map((p) => dashboardHomeMiniAvatarHtml(p, 'Starter')).join('') +
    (sub ? dashboardHomeMiniAvatarHtml(sub, 'Sub') : '');
  document.getElementById('dashboard-home-org-avatars').innerHTML = avatarsHtml || '<div class="dashboard-home-results-empty">Noch keine Spieler im Kader.</div>';
  const condition = computeTeamPhysicalCondition(org);
  const morale = computeTeamMorale(org);
  const conditionEl = document.getElementById('dashboard-home-org-condition');
  if (condition >= 70 && morale >= 60) {
    conditionEl.className = 'dashboard-home-org-condition is-ok';
    conditionEl.textContent = 'Alle Spieler sind in guter Verfassung!';
  } else {
    conditionEl.className = 'dashboard-home-org-condition is-warning';
    conditionEl.textContent = 'Zustand/Moral des Kaders lässt nach (' + condition + '% Zustand, ' + morale + '% Moral).';
  }

  // "Anstehende Turniere"-Karte: dieselbe Datenquelle wie
  // renderTournamentUpcomingList() (Turniere-Seite), hier nur die ersten 3.
  let schedule = currentSeasonTournamentSchedule();
  let upcoming = schedule.filter((ev) => ev.endDate >= careerDate);
  if (upcoming.length === 0) {
    schedule = buildSeasonTournamentSchedule((careerState.seasonNumber || 1) + 1);
    upcoming = schedule.filter((ev) => ev.endDate >= careerDate);
  }
  const upcomingList = upcoming.slice(0, 3);
  const upcomingEl = document.getElementById('dashboard-home-upcoming');
  upcomingEl.innerHTML = upcomingList.length > 0
    ? upcomingList.map(dashboardHomeUpcomingItemHtml).join('')
    : '<div class="dashboard-home-upcoming-empty">Keine weiteren Turniere in dieser Saison.</div>';
  upcomingEl.querySelectorAll('[data-home-tournament]').forEach((el) => {
    el.addEventListener('click', () => openTournamentDetail(el.dataset.homeTournament));
  });

  // "Letzte Ergebnisse"-Karte: dieselbe Datenquelle wie Team-Info (Runde 111).
  const recentMatches = matchesForTeam(org.name).slice(0, 5);
  const resultsEl = document.getElementById('dashboard-home-results');
  resultsEl.innerHTML = recentMatches.length > 0
    ? recentMatches.map(dashboardHomeResultItemHtml).join('')
    : '<div class="dashboard-home-results-empty">Keine aktuellen Spiele.</div>';

  // "Saison-Rangliste"-Karte: echte Regions-Rangliste (siehe Kopfkommentar).
  // Eigene Org bleibt sichtbar (angepinnt mit "…"-Trenner), auch wenn sie
  // außerhalb der Top 8 liegt -- sonst würde man sich selbst nie finden.
  document.getElementById('dashboard-home-ranking-region').textContent = '(' + (ORG_REGION_LABELS[region] || region) + ')';
  const allRows = statsTeamRows(region);
  const qualifyingSet = statsQualifyingOrgSet(region);
  const ownIndex = allRows.findIndex((r) => r.org.name === org.name);
  const topCount = 8;
  let rankingHtml = allRows.slice(0, topCount).map((row, i) => dashboardHomeRankingRowHtml(row, i + 1, qualifyingSet)).join('');
  if (ownIndex >= topCount) {
    rankingHtml += '<div class="dashboard-home-ranking-separator">•••</div>';
    rankingHtml += dashboardHomeRankingRowHtml(allRows[ownIndex], ownIndex + 1, qualifyingSet);
  }
  document.getElementById('dashboard-home-ranking-body').innerHTML = rankingHtml;
}

function selectDashboardPage(id) {
  document.querySelectorAll('.dashboard-sidebar-item').forEach((el) => el.classList.toggle('is-active', el.dataset.page === id));
  document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS[id] || 'Startseite';

  // "Einstellungen" (Runde 32), "Finanzen" (Runde 34), "Sponsoren" (Runde
  // 38), "Turniere" (Runde 43), "Statistiken" (Runde 110) und "Transfers"
  // (Runde 114, nur Übersichts-/Log-Ansicht, siehe dortigen Kopfkommentar)
  // sind die einzigen der 16 Seiten mit echtem Inhalt bisher -- alle anderen
  // bleiben beim Platzhalter. Fünf davon (DASHBOARD_LOCKED_PAGES) zeigen
  // dabei einen expliziten Sperr-Hinweis statt des generischen "🚧 Inhalt
  // folgt"-Texts (User-Vorgabe Runde 42).
  const isHome = id === 'home';
  const isSettings = id === 'settings';
  const isFinance = id === 'finance';
  const isSponsors = id === 'sponsors';
  const isTournaments = id === 'tournaments';
  const isStats = id === 'stats';
  const isTransfers = id === 'transfers';
  const isScouting = id === 'scouting';
  const isRoster = id === 'roster';
  const isLocked = DASHBOARD_LOCKED_PAGES.includes(id);
  const placeholderEl = document.getElementById('dashboard-page-placeholder');
  placeholderEl.classList.toggle('is-locked', isLocked);
  placeholderEl.innerHTML = isLocked
    ? '<p>🔒 ' + (DASHBOARD_PAGE_LABELS[id] || '') + ' wird zu einem späteren Zeitpunkt ins Spiel kommen.</p>'
    : '<p>🚧 Inhalt folgt in einer späteren Runde.</p>';
  placeholderEl.classList.toggle('hidden', isHome || isSettings || isFinance || isSponsors || isTournaments || isStats || isTransfers || isScouting || isRoster);
  document.getElementById('dashboard-page-home').classList.toggle('hidden', !isHome);
  document.getElementById('dashboard-page-settings').classList.toggle('hidden', !isSettings);
  document.getElementById('dashboard-page-finance').classList.toggle('hidden', !isFinance);
  document.getElementById('dashboard-page-sponsors').classList.toggle('hidden', !isSponsors);
  document.getElementById('dashboard-page-tournaments').classList.toggle('hidden', !isTournaments);
  document.getElementById('dashboard-page-stats').classList.toggle('hidden', !isStats);
  document.getElementById('dashboard-page-transfers').classList.toggle('hidden', !isTransfers);
  document.getElementById('dashboard-page-scouting').classList.toggle('hidden', !isScouting);
  document.getElementById('dashboard-page-roster').classList.toggle('hidden', !isRoster);
  // Turnier-Detailseite ist ein Sub-Zustand von "Turniere", nur über den
  // "DETAILS"-Button erreichbar -- jeder Sidebar-Klick (auch erneut auf
  // "Turniere") kehrt zur Kalender-/Listenansicht zurück.
  tournamentDetailEventKey = null;
  document.getElementById('dashboard-page-tournament-detail').classList.add('hidden');
  // Team-Info-Seite ist ein Sub-Zustand von "Statistiken" (analog zur
  // Turnier-Detailseite), nur über "MEHR INFO" erreichbar.
  teamInfoOrgName = null;
  document.getElementById('dashboard-page-team-info').classList.add('hidden');
  // Person-Info ist ein Sub-Zustand von Statistiken UND Scouting (Runde 118)
  // -- jeder Sidebar-Klick verlässt sie wieder, analog zu Team-Info.
  personInfoIdentity = null;
  personInfoOrigin = null;
  document.getElementById('dashboard-page-person-info').classList.add('hidden');
  if (isHome) renderDashboardHomePanel();
  if (isSettings) renderDashboardSettingsPanel();
  if (isFinance) renderDashboardFinancePanel();
  if (isSponsors) renderDashboardSponsorsPanel();
  if (isTournaments) renderDashboardTournamentsPanel();
  if (isStats) renderDashboardStatsPanel();
  if (isTransfers) renderDashboardTransfersPanel();
  if (isScouting) renderDashboardScoutingPanel();
  if (isRoster) renderDashboardKaderPanel();
}

// Nutzt die ECHTEN appSettings (siehe screen-settings weiter oben im Code) --
// direkt live angewendet statt über einen draftSettings-Zwischenstand wie
// beim alten Einstellungen-Screen, da diese Seite keinen separaten
// "Speichern"/"Abbrechen"-Knopf hat (nur EIN Exit-Button, siehe
// Referenz-Screenshot) -- jede Änderung wird sofort persistiert.
function renderDashboardSettingsPanel() {
  const musicPct = Math.round(appSettings.musicVolume * 100);
  document.getElementById('dashboard-settings-music-volume').value = musicPct;
  document.getElementById('dashboard-settings-music-volume-value').textContent = musicPct + '%';

  const soundPct = Math.round(appSettings.soundVolume * 100);
  document.getElementById('dashboard-settings-sound-volume').value = soundPct;
  document.getElementById('dashboard-settings-sound-volume-value').textContent = soundPct + '%';

  const introPct = Math.round(appSettings.introVideoVolume * 100);
  document.getElementById('dashboard-settings-intro-volume').value = introPct;
  document.getElementById('dashboard-settings-intro-volume-value').textContent = introPct + '%';

  document.getElementById('dashboard-settings-window-size').value = appSettings.windowSize;
  document.getElementById('dashboard-settings-ui-scale').value = String(appSettings.uiScale);
  document.getElementById('dashboard-settings-fullscreen').classList.toggle('is-active', appSettings.displayMode === 'fullscreen');
}

async function persistAppSettings() {
  await window.electronAPI.saveSettings(appSettings);
  await window.electronAPI.applyDisplaySettings();
}

// ── Dashboard-Seite "Finanzen" ───────────────────────────────────────────
// Echte Daten wo vorhanden (Gesamtsaldo/-einnahmen/-ausgaben/Transaktionen/
// Finanzvorstand), die Budget-Verteilung (4 Regler) ist ein NEUES,
// eigenständiges Planungsfeature -- persistiert, wirkt sich aber bewusst
// noch auf KEIN anderes Spielsystem aus (kein Gehalts-/Marketing-/
// Betriebskosten-Abzug existiert im Spiel). Die 12-Monats-Cashflow-Grafik
// ist bewusst nur strukturell (kein monatsgenaues Tracking vorhanden).
function financeExpenseTransfers() {
  return transferLog.filter((t) => t.to === assignedOrg.name);
}
function financeIncomeTransfers() {
  return transferLog.filter((t) => t.from === assignedOrg.name);
}
function financeTotalExpenses() {
  return financeExpenseTransfers().reduce((sum, t) => sum + t.price, 0);
}
function financeTotalIncome() {
  // careerSponsorIncomeTotal (Runde 39) fließt hier mit ein -- rein für die
  // Anzeige, berührt NICHT das eigentliche BUDGET (siehe Kommentar dort).
  return careerSeasonIncomeTotal + careerSponsorIncomeTotal + financeIncomeTransfers().reduce((sum, t) => sum + t.price, 0);
}
function financeCashflowThisSeason() {
  const season = careerState.seasonNumber;
  const income = financeIncomeTransfers().filter((t) => t.season === season).reduce((s, t) => s + t.price, 0);
  const expenses = financeExpenseTransfers().filter((t) => t.season === season).reduce((s, t) => s + t.price, 0);
  return { income, expenses };
}
function financeCFO() {
  return assignedOrg.roster.staff.find((s) => s.role === 'Finanzvorstand') || null;
}

function formatMoneyShort(amount) {
  const abs = Math.abs(Math.round(amount));
  if (abs >= 1000000) {
    const m = amount / 1000000;
    return (Number.isInteger(m) ? m : m.toFixed(1)) + 'M €';
  }
  if (abs >= 1000) return Math.round(amount / 1000) + 'K €';
  return Math.round(amount) + ' €';
}

const FINANCE_ALLOC_KEYS = ['transfers', 'salaries', 'marketing', 'operations'];
const FINANCE_ALLOC_COLORS = { transfers: '#e8d84a', salaries: '#d64fc7', marketing: '#a83fd6', operations: '#3f7fd6' };
const FINANCE_UNALLOCATED_COLOR = '#4a4f63';

// User-Vorgabe (diese Runde): financeAllocation[key] sind seit hier FESTE
// €-BETRÄGE (nicht mehr Prozente von assignedOrg.budget wie vorher) -- neues
// Einkommen (Sponsoring-Abholen, Preisgeld) darf NIE automatisch anteilig in
// die 4 Kategorien "einsickern", nur "nicht eingeteiltes Geld" soll wachsen,
// bis der Spieler SELBST einen Regler verschiebt. Migration alter (v<27)
// prozentbasierter Spielstände siehe loadGameState().
function financeAllocatedSum() {
  return FINANCE_ALLOC_KEYS.reduce((s, k) => s + financeAllocation[k], 0);
}
function financeUnallocated() {
  return Math.max(0, assignedOrg.budget - financeAllocatedSum());
}

function renderFinancePie() {
  const values = FINANCE_ALLOC_KEYS.map((k) => financeAllocation[k]);
  const unallocated = financeUnallocated();
  const total = values.reduce((s, v) => s + v, 0) + unallocated;
  const safeValues = total > 0 ? [...values, unallocated] : [1, 1, 1, 1, 0];
  const safeColors = [...FINANCE_ALLOC_KEYS.map((k) => FINANCE_ALLOC_COLORS[k]), FINANCE_UNALLOCATED_COLOR];
  const safeTotal = total > 0 ? total : 4;
  let acc = 0;
  const stops = safeValues.map((v, i) => {
    const start = (acc / safeTotal) * 100;
    acc += v;
    const end = (acc / safeTotal) * 100;
    return safeColors[i] + ' ' + start + '% ' + end + '%';
  }).join(', ');
  document.getElementById('dashboard-finance-pie').style.background = 'conic-gradient(' + stops + ')';
}

// Wie viel eine Kategorie MAXIMAL halten könnte (eigener Betrag + noch
// freies Geld) -- die eigentliche Zuteilungs-Obergrenze, aber NICHT mehr das
// `max`-Attribut des <input type="range"> selbst (siehe Kommentar an
// renderFinanceAllocSliders() für den Grund).
function financeSliderCap(key) {
  return financeAllocation[key] + financeUnallocated();
}

// Bug-Fix (User-Meldung: "ab einer gewissen Summe kann man nicht mehr weiter
// Geld in eine Kategorie reinpacken"): der Regler-eigene Cap
// (financeSliderCap()) ist ein sich bei JEDER anderen Aktion verschiebendes
// Ziel -- das `max`-Attribut eines <input type="range"> wurde bisher exakt
// auf diesen wandernden Cap gesetzt. Browser scheinen native Drag-Gesten
// bei genügend großen Beträgen/oft genug wechselndem `max` nicht mehr
// zuverlässig bis zum echten Ende durchzuziehen (das eigentliche Symptom
// ließ sich mit einer echten Maus-Drag-Simulation nicht sauber isolieren,
// aber ein sich laufend veränderndes `max` ist der bekannteste Auslöser
// für genau diese Klasse Problem bei Range-Inputs). Fix: das `max`-Attribut
// ist jetzt IMMER das komplette Budget (`assignedOrg.budget`) -- ändert sich
// nur noch, wenn neues Geld dazukommt, nie durch bloßes Verschieben eines
// Reglers. Die eigentliche Deckelung (nie mehr zuteilen als vorhanden)
// passiert stattdessen rein in JS im Input-Handler (siehe unten) -- kein
// Geld wird dadurch erzeugt oder vernichtet, nur die Regler-Mechanik selbst
// wurde robuster gemacht, exakt wie gewünscht.
function renderFinanceAllocSliders(skipKey) {
  const totalBudget = Math.max(1, assignedOrg.budget);
  FINANCE_ALLOC_KEYS.forEach((key) => {
    const amount = financeAllocation[key];
    const slider = document.getElementById('dashboard-finance-' + key + '-slider');
    // Der gerade per Maus gezogene Regler wird während der eigenen Geste
    // nicht angefasst (weder max noch value) -- verhindert, dass ein
    // Neu-Setzen mitten in der nativen Drag-Geste sie stört. Die anderen 3
    // dürfen sich currently ruhig live aktualisieren (kein aktiver Drag dort).
    if (key !== skipKey) {
      slider.max = totalBudget;
      slider.step = 1;
      slider.value = amount;
    }
    document.getElementById('dashboard-finance-' + key + '-value').textContent = formatMoneyShort(amount);
  });
  document.getElementById('dashboard-finance-unallocated-value').textContent = formatMoneyShort(financeUnallocated());
  renderFinancePie();
}

// Verbucht ein echtes Geldereignis (Preisgeld-Payout, Sponsoring-Abholen,
// Transfer, Gehalt, Vorstandsbudget, ...) im Monat des AKTUELLEN careerDate
// -- Grundlage für die 12-Monats-Cashflow-Grafik (siehe renderFinanceChart())
// UND (Runde 121) für die itemisierte Transaktionsliste auf der
// Finanzen-Seite (financeTransactionLog, siehe renderFinanceTransactions()).
// `category`/`description` sind optional (ältere Aufrufe ohne diese Angaben
// bleiben gültig, landen dann unter "Sonstiges") -- rein additiv.
function addFinanceMonthlyIncome(amount, category, description) {
  const month = careerDate.slice(0, 7);
  if (!financeMonthlyLedger[month]) financeMonthlyLedger[month] = { income: 0, expenses: 0 };
  financeMonthlyLedger[month].income += amount;
  financeTransactionLog.unshift({ date: careerDate, type: 'income', category: category || 'Sonstiges', amount, description: description || '' });
}

// Runde 117 -- Gegenstück zu addFinanceMonthlyIncome(), bisher gab es keine
// einzige Stelle, die echte Ausgaben in die Monats-Cashflow-Grafik einträgt
// (siehe der alte Kommentar an renderFinanceChart(): "Ausgaben bleiben aktuell
// immer 0, kein Transfermarkt gebaut"). Die neue Personal-Verpflichtungs-
// Mechanik (signStaffMember()) ist die erste echte Ausgabe, die hier
// eingetragen wird.
function addFinanceMonthlyExpense(amount, category, description) {
  const month = careerDate.slice(0, 7);
  if (!financeMonthlyLedger[month]) financeMonthlyLedger[month] = { income: 0, expenses: 0 };
  financeMonthlyLedger[month].expenses += amount;
  financeTransactionLog.unshift({ date: careerDate, type: 'expense', category: category || 'Sonstiges', amount, description: description || '' });
}

// Zeigt die letzten 12 Monate ab dem aktuellen careerDate, Balkenhöhen
// proportional zum größten Einnahmen/Ausgaben-Wert im sichtbaren Zeitraum
// (echte Werte aus financeMonthlyLedger, siehe addFinanceMonthlyIncome()/
// addFinanceMonthlyExpense()).
function renderFinanceChart() {
  const chart = document.getElementById('dashboard-finance-chart');
  const current = parseCareerDate(careerDate);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(current);
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 10).slice(0, 7);
    const entry = financeMonthlyLedger[key] || { income: 0, expenses: 0 };
    months.push({ monthIndex: d.getUTCMonth(), income: entry.income, expenses: entry.expenses });
  }
  const maxValue = Math.max(1, ...months.map((m) => Math.max(m.income, m.expenses)));
  const MAX_BAR_PX = 100;
  let html = '';
  months.forEach((m) => {
    const incomeHeight = m.income > 0 ? Math.max(4, Math.round((m.income / maxValue) * MAX_BAR_PX)) : 4;
    const expenseHeight = m.expenses > 0 ? Math.max(4, Math.round((m.expenses / maxValue) * MAX_BAR_PX)) : 4;
    html +=
      '<div class="dashboard-finance-chart-col">' +
        '<div class="dashboard-finance-chart-bars">' +
          '<div class="dashboard-finance-chart-income" style="height:' + incomeHeight + 'px;" title="Einnahmen: ' + formatMoney(m.income) + '"></div>' +
          '<div class="dashboard-finance-chart-expense" style="height:' + expenseHeight + 'px;" title="Ausgaben: ' + formatMoney(m.expenses) + '"></div>' +
        '</div>' +
        '<span class="dashboard-finance-chart-label">' + DASHBOARD_MONTHS[m.monthIndex] + '</span>' +
      '</div>';
  });
  chart.innerHTML = html;
}

function renderFinanceCFO() {
  const cfo = financeCFO();
  const el = document.getElementById('dashboard-finance-cfo');
  if (!cfo) {
    el.innerHTML = '<div class="dashboard-finance-cfo-text"><span class="dashboard-finance-cfo-role">Finanzvorstand</span><span class="dashboard-finance-cfo-name">Nicht besetzt</span></div>';
    return;
  }
  const avatar = CHARACTER_AVATARS.find((a) => a.id === cfo.avatarId) || CHARACTER_AVATARS[0];
  el.innerHTML =
    '<div class="dashboard-finance-cfo-avatar" style="background:' + avatar.color + '33;">' + avatar.emoji + '</div>' +
    '<div class="dashboard-finance-cfo-text"><span class="dashboard-finance-cfo-role">Finanzvorstand</span><span class="dashboard-finance-cfo-name">' + cfo.name + '</span></div>';
}

// Runde 121, User-Vorgabe ("wirklich ALLE Transaktionen einzeln aufgelistet,
// zurzeit wird da nichts reingeschrieben"): liest jetzt aus dem gemeinsamen
// financeTransactionLog (jede Buchung von addFinanceMonthlyIncome()/
// addFinanceMonthlyExpense() aus, siehe deren Kopfkommentar) statt nur aus
// transferLog -- deckt dadurch auch Sponsoring/Preisgeld/Gehälter/
// Vorstandsbudget ab, nicht nur Transfers. Zeigt das ECHTE Buchungsdatum
// (vorher stand hier nur "Saison N", obwohl die Spalte "Datum" heißt).
function renderFinanceTransactions() {
  const container = document.getElementById('dashboard-finance-transactions-list');
  if (financeTransactionLog.length === 0) {
    container.innerHTML = '<div class="dashboard-finance-transactions-empty">Noch keine Transaktionsdaten.</div>';
    return;
  }
  container.innerHTML = financeTransactionLog.map((t) => {
    const isExpense = t.type === 'expense';
    return (
      '<div class="dashboard-finance-transaction-row">' +
        '<span>' + formatContractDate(t.date) + '</span>' +
        '<span>' + t.category + '</span>' +
        '<span>' + (isExpense ? 'Ausgabe' : 'Einnahme') + '</span>' +
        '<span class="' + (isExpense ? 'is-expense' : 'is-income') + '">' + (isExpense ? '-' : '+') + formatMoney(t.amount) + '</span>' +
        '<span>' + t.description + '</span>' +
      '</div>'
    );
  }).join('');
}

function renderDashboardFinancePanel() {
  document.getElementById('dashboard-finance-balance').textContent = formatMoney(assignedOrg.budget);
  document.getElementById('dashboard-finance-income').textContent = formatMoney(financeTotalIncome());
  document.getElementById('dashboard-finance-expenses').textContent = formatMoney(financeTotalExpenses());

  // Runde 101, User-Vorgabe ("Preisgeld wird 7 Tage nach Turnierende gutgeschrieben,
  // bis dahin bei Finanzen als nicht zugeteiltes Budget angezeigt"): Summe aller noch
  // nicht fälligen Payouts (siehe pendingPrizePayouts/processDuePrizePayouts()) --
  // zeigt zusätzlich das früheste Freigabedatum, bleibt komplett ausgeblendet, wenn
  // gerade nichts aussteht.
  const pendingItemEl = document.getElementById('dashboard-finance-pending-prize-item');
  if (pendingPrizePayouts.length > 0) {
    const total = pendingPrizePayouts.reduce((sum, p) => sum + p.amount, 0);
    const earliestDate = pendingPrizePayouts.reduce((min, p) => (p.availableDate < min ? p.availableDate : min), pendingPrizePayouts[0].availableDate);
    document.getElementById('dashboard-finance-pending-prize').textContent =
      formatMoney(total) + ' (ab ' + formatCareerDateDisplay(earliestDate) + ')';
    pendingItemEl.classList.remove('hidden');
  } else {
    pendingItemEl.classList.add('hidden');
  }

  const { income, expenses } = financeCashflowThisSeason();
  document.getElementById('dashboard-finance-cashflow-income').textContent = '+' + formatMoneyShort(income).replace(' €', '');
  document.getElementById('dashboard-finance-cashflow-expense').textContent = '-' + formatMoneyShort(expenses).replace(' €', '');

  renderFinanceAllocSliders();
  renderFinanceCFO();
  renderFinanceChart();
  renderFinanceTransactions();
}

// ── Dashboard-Seite "Sponsoren" ──────────────────────────────────────────
function starsHtml(stars) {
  const fillPct = (stars / 5) * 100;
  return '<span class="org-select-stars"><span class="stars-empty">★★★★★</span><span class="stars-filled" style="width:' + fillPct + '%">★★★★★</span></span>';
}

function filteredSponsors() {
  if (sponsorTierFilter === 'all') return SPONSORS;
  return SPONSORS.filter((s) => s.tier === sponsorTierFilter);
}

const SPONSOR_STATUS_META = {
  available: { label: 'Verfügbar', dotClass: 'is-available' },
  pending: { label: 'Nicht verfügbar', dotClass: 'is-unavailable' },
  unavailable: { label: 'Nicht verfügbar', dotClass: 'is-unavailable' },
  locked: { label: 'Gesperrt', dotClass: 'is-locked' },
  active: { label: 'Vertrag unterzeichnet', dotClass: 'is-signed' },
};

function sponsorCardHtml(s) {
  const status = sponsorStatus(s.name);
  const catColor = SPONSOR_CATEGORY_COLORS[s.category] || '#8a91a8';
  const meta = SPONSOR_STATUS_META[status];
  return (
    '<div class="dashboard-sponsor-card' + (s.name === selectedSponsorName ? ' is-selected' : '') + '" data-sponsor="' + s.name + '">' +
      '<div class="dashboard-sponsor-logo" style="background:' + s.color + ';">' + s.emoji + '</div>' +
      '<div class="dashboard-sponsor-info">' +
        '<div class="dashboard-sponsor-name">' + s.name + '</div>' +
        '<div class="dashboard-sponsor-stars">' + starsHtml(s.stars) + '</div>' +
        '<div class="dashboard-sponsor-meta">' +
          '<span class="dashboard-sponsor-category-badge" style="background:' + catColor + ';">' + s.category + '</span>' +
          '<span class="dashboard-sponsor-tier-label">Tier <strong>' + s.tier + '</strong></span>' +
        '</div>' +
      '</div>' +
      '<span class="dashboard-sponsor-card-status-dot ' + meta.dotClass + '" title="' + meta.label + '"></span>' +
    '</div>'
  );
}

function renderSponsorGrid() {
  const all = filteredSponsors();
  const pageCount = Math.max(1, Math.ceil(all.length / SPONSORS_PER_PAGE));
  sponsorPage = Math.min(sponsorPage, pageCount);
  const start = (sponsorPage - 1) * SPONSORS_PER_PAGE;
  const pageItems = all.slice(start, start + SPONSORS_PER_PAGE);

  document.getElementById('dashboard-sponsors-grid').innerHTML = pageItems.map(sponsorCardHtml).join('');
  document.querySelectorAll('#dashboard-sponsors-grid .dashboard-sponsor-card').forEach((card) => {
    card.addEventListener('click', () => renderSponsorDetail(card.dataset.sponsor));
  });

  renderSponsorPagination(pageCount);
}

function renderSponsorPagination(pageCount) {
  const el = document.getElementById('dashboard-sponsors-pagination');
  if (pageCount <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= pageCount; p++) {
    html += '<button type="button" class="dashboard-sponsors-page-btn' + (p === sponsorPage ? ' is-active' : '') + '" data-page="' + p + '">' + p + '</button>';
  }
  html += '<button type="button" class="dashboard-sponsors-page-btn" id="dashboard-sponsors-page-next" ' + (sponsorPage >= pageCount ? 'disabled' : '') + '>›</button>';
  el.innerHTML = html;
  el.querySelectorAll('.dashboard-sponsors-page-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => { sponsorPage = Number(btn.dataset.page); renderSponsorGrid(); });
  });
  const nextBtn = document.getElementById('dashboard-sponsors-page-next');
  if (nextBtn) nextBtn.addEventListener('click', () => { sponsorPage = Math.min(pageCount, sponsorPage + 1); renderSponsorGrid(); });
}

function selectSponsorTier(tier) {
  sponsorTierFilter = tier;
  sponsorPage = 1;
  document.querySelectorAll('.dashboard-sponsors-tier-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tier === tier));
  renderSponsorGrid();
}

// Klick auf eine Karte (Übersicht ODER Meine Sponsoren) zeigt/aktualisiert
// die Detailansicht links -- ersetzt das alte "Signieren per Klick" aus
// Runde 38 komplett durch den echten Bewerbungs-Lebenszyklus.
// Ein Ziel-Eintrag mit Bruch-Anzeige ("3/33") + Fortschrittsbalken + Reward
// -- unfertige Ziele bekommen zusätzlich das "In Bearbeitung"-Badge (siehe
// Referenz-Screenshot Runde 40). Wird sowohl in der Übersicht (eigener
// Sponsor) als auch bei Meine Sponsoren verwendet.
function sponsorGoalRowHtml(g, i, st, name) {
  const done = !!(st && st.completedGoals && st.completedGoals[i]);
  const collected = !!(st && st.collectedGoals && st.collectedGoals[i]);
  const readyToCollect = done && !collected;
  // Bug-Fix (User-Meldung): Fortschrittsbalken/Bruch dürfen NUR bei tatsächlich
  // unterzeichneten Sponsoren echten Karriere-Fortschritt zeigen -- vorher
  // wurde sponsorGoalProgress() (globale Karrierewerte) auch für Sponsoren
  // OHNE Vertrag berechnet, wodurch ein Ziel schon "voll" aussehen konnte
  // (z.B. 100% Balken), obwohl gar kein Vertrag existiert und nichts
  // tatsächlich erledigt wurde. Ohne aktiven Vertrag zeigt der Balken jetzt
  // immer 0 -- die Zielbeschreibung/Schwelle bleibt als Vorschau sichtbar,
  // aber ohne so zu wirken, als würde bereits daran gearbeitet.
  const progress = (st && st.active) ? sponsorGoalProgress(g) : { current: 0, threshold: g.threshold };
  const pct = progress.threshold > 0 ? Math.min(100, Math.round((progress.current / progress.threshold) * 100)) : 0;
  let footRight = '';
  if (readyToCollect) {
    footRight = '<button type="button" class="dashboard-sponsor-goal-collect-btn" data-goal-collect="' + i + '">Abholen</button>';
  } else if (!done) {
    footRight = '<span class="dashboard-sponsor-goal-badge">In Bearbeitung</span>';
  }
  return (
    '<div class="dashboard-sponsor-goal' + (done ? ' is-done' : '') + '" data-sponsor-name="' + name + '">' +
      '<span class="dashboard-sponsor-goal-bullet">' + (done ? '✓' : '»') + '</span>' +
      '<div class="dashboard-sponsor-goal-body">' +
        '<div class="dashboard-sponsor-goal-top">' +
          '<span class="dashboard-sponsor-goal-label">' + g.label + '</span>' +
          '<span class="dashboard-sponsor-goal-fraction">' + progress.current + '/' + progress.threshold + '</span>' +
        '</div>' +
        '<div class="dashboard-sponsor-goal-bar"><div class="dashboard-sponsor-goal-bar-fill" style="width:' + pct + '%;"></div></div>' +
        '<div class="dashboard-sponsor-goal-foot">' +
          '<span class="dashboard-sponsor-goal-reward">Reward: Budget um ' + formatMoney(g.reward) + ' erhöhen</span>' +
          footRight +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// Aktionsbereich des Detailpanels -- je nach Status entweder "Angebot"
// (verfügbar), Hinweistext (wartend/abgelehnt/gesperrt) oder bei bereits
// unterzeichneten Sponsoren "Entlassen" (+ "Belohnung abholen" sobald
// st.bonusReady, siehe checkSponsorGoals()/collectSponsorBonus()).
function sponsorDetailActionsHtml(prefix, status, st, sponsor) {
  if (status === 'available') {
    // User-Vorgabe Runde 41: max. 6 gleichzeitig unterzeichnete Sponsoren --
    // sobald voll, gibt es gar keinen "Angebot"-Button mehr, nur den Hinweis.
    if (activeSponsorCount() >= MAX_ACTIVE_SPONSORS) {
      return '<p class="dashboard-sponsor-detail-hint">Du hast bereits die maximale Kapazität an Sponsoren erreicht (' +
        MAX_ACTIVE_SPONSORS + '/' + MAX_ACTIVE_SPONSORS + ') -- entlasse oder hole zuerst einen bestehenden Sponsor ab, um wieder Platz zu schaffen.</p>';
    }
    return '<button type="button" id="' + prefix + '-offer" class="dashboard-sponsor-offer-btn">Angebot</button>' +
      '<div class="dashboard-sponsor-revenue"><span class="dashboard-sponsor-revenue-label">Geschätzter Umsatz:</span> ' +
      formatMoney(sponsor.revenueMin) + ' - ' + formatMoney(sponsor.revenueMax) + '</div>';
  }
  if (status === 'pending') {
    return '<p class="dashboard-sponsor-detail-hint">Bewerbung gesendet am ' + formatCareerDateDisplay(st.requestDate) +
      ' -- Antwort erwartet ab ' + formatCareerDateDisplay(st.responseDate) + '.</p>';
  }
  if (status === 'unavailable') {
    return '<p class="dashboard-sponsor-detail-hint">Zuletzt abgelehnt -- wieder anfragbar ab ' + formatCareerDateDisplay(st.cooldownUntil) + '.</p>';
  }
  if (status === 'locked') {
    return '<p class="dashboard-sponsor-detail-hint">Gesperrt bis ' + formatCareerDateDisplay(st.lockedUntil) + ' (zu ambitioniert angefragt -- zu großer Sterne-Unterschied, zweimal in Folge abgelehnt).</p>';
  }
  if (status === 'active') {
    let html = '<button type="button" id="' + prefix + '-fire" class="dashboard-sponsor-fire-btn">Entlassen</button>' +
      '<div class="dashboard-sponsor-revenue"><span class="dashboard-sponsor-revenue-label">Geschätzter Umsatz:</span> ' +
      formatMoney(sponsor.revenueMin) + ' - ' + formatMoney(sponsor.revenueMax) + '</div>';
    if (st.bonusReady) {
      html += '<button type="button" id="' + prefix + '-collect" class="dashboard-sponsor-collect-btn">Belohnung abholen (' + formatMoney(st.bonusAmount) + ')</button>' +
        '<p class="dashboard-sponsor-detail-hint">Alle Ziele erfüllt -- die Belohnung ist abholbar.</p>';
    } else {
      html += '<p class="dashboard-sponsor-detail-hint">Erfülle alle Ziele, um die Belohnung abholbar zu machen.</p>';
    }
    return html;
  }
  return '';
}

function wireSponsorDetailActions(prefix, name) {
  const offerBtn = document.getElementById(prefix + '-offer');
  if (offerBtn) offerBtn.addEventListener('click', () => openSponsorRequestPopup(name));
  const fireBtn = document.getElementById(prefix + '-fire');
  if (fireBtn) {
    fireBtn.addEventListener('click', () => {
      showConfirmModal(
        'Sponsor entlassen?',
        'Der Vertrag mit ' + name + ' wird sofort beendet. Eine eventuell schon abholbare oder noch nicht erreichte Abschluss-Belohnung verfällt dabei unwiderruflich.',
        () => fireSponsor(name),
        { danger: true, confirmLabel: 'Entlassen' }
      );
    });
  }
  const collectBtn = document.getElementById(prefix + '-collect');
  if (collectBtn) collectBtn.addEventListener('click', () => collectSponsorBonus(name));
}

function wireSponsorGoalCollectButtons(prefix, name) {
  const container = document.getElementById(prefix + '-goals');
  if (!container) return;
  container.querySelectorAll('[data-goal-collect]').forEach((btn) => {
    const i = Number(btn.dataset.goalCollect);
    btn.addEventListener('click', () => collectSponsorGoalReward(name, i));
  });
}

function renderSponsorDetail(name) {
  selectedSponsorName = name;
  const sponsor = SPONSORS.find((s) => s.name === name);
  if (!sponsor) return;
  const status = sponsorStatus(name);
  const st = sponsorState[name];
  const meta = SPONSOR_STATUS_META[status];
  const goalsHtml = sponsor.goals.map((g, i) => sponsorGoalRowHtml(g, i, st, name)).join('');

  // Übersicht- UND Meine-Sponsoren-Detailpanel zeigen bei Bedarf denselben
  // Sponsor (eine einzige globale Auswahl, siehe selectedSponsorName) -- beide
  // Elementsätze werden deshalb hier gemeinsam befüllt (Präfix "sponsor-detail"
  // bzw. "mine-sponsor-detail").
  ['sponsor-detail', 'mine-sponsor-detail'].forEach((prefix) => {
    const dot = document.getElementById(prefix + '-status-dot');
    if (!dot) return;
    dot.className = 'dashboard-sponsor-detail-status-dot ' + meta.dotClass;
    document.getElementById(prefix + '-status-text').textContent = meta.label;
    document.getElementById(prefix + '-logo').style.background = sponsor.color;
    document.getElementById(prefix + '-logo').textContent = sponsor.emoji;
    document.getElementById(prefix + '-name').textContent = sponsor.name;
    document.getElementById(prefix + '-description').textContent = sponsor.description;
    document.getElementById(prefix + '-actions').innerHTML = sponsorDetailActionsHtml(prefix, status, st, sponsor);
    wireSponsorDetailActions(prefix, name);
    document.getElementById(prefix + '-goals').innerHTML = goalsHtml;
    wireSponsorGoalCollectButtons(prefix, name);
  });

  document.getElementById('dashboard-sponsors-detail').classList.remove('hidden');

  // Markierung der angeklickten Karte muss dauerhaft bestehen bleiben, bis
  // eine andere Karte gewählt wird -- dafür müssen beide Karten-Listen bei
  // jeder Detailänderung neu gerendert werden (sonst bleibt .is-selected auf
  // der zuletzt gerenderten Karte hängen, siehe Übersicht UND Meine Sponsoren).
  renderSponsorGrid();
  renderMySponsorsGrid();
}

// Baut NUR das Karten-Raster für "Meine Sponsoren" (gefüllte Karten + leere
// Platzhalter-Slots bis mindestens 6, siehe Referenz-Screenshot) -- ruft
// bewusst NICHT renderSponsorDetail() auf (das würde mit renderSponsorDetail()
// -> renderMySponsorsGrid() eine Endlosschleife ergeben), siehe renderMySponsors()
// für die Erstauswahl-Logik beim Öffnen des Tabs.
function renderMySponsorsGrid() {
  const mine = SPONSORS.filter((s) => sponsorState[s.name] && sponsorState[s.name].active);
  const emptyEl = document.getElementById('dashboard-sponsors-mine-empty');
  const detailEl = document.getElementById('dashboard-sponsors-mine-detail');
  const gridEl = document.getElementById('dashboard-sponsors-mine-grid');

  detailEl.classList.toggle('hidden', mine.length === 0);
  emptyEl.classList.toggle('hidden', mine.length > 0);

  const MIN_SLOTS = 6;
  let html = mine.map(sponsorCardHtml).join('');
  for (let i = 0; i < Math.max(0, MIN_SLOTS - mine.length); i++) {
    html += '<div class="dashboard-sponsor-card dashboard-sponsor-card-empty"><span class="dashboard-sponsor-card-empty-label">Frei</span></div>';
  }
  gridEl.innerHTML = html;
  gridEl.querySelectorAll('.dashboard-sponsor-card[data-sponsor]').forEach((card) => {
    card.addEventListener('click', () => renderSponsorDetail(card.dataset.sponsor));
  });
}

// Einstiegspunkt beim Öffnen des "Meine Sponsoren"-Tabs -- wählt bei Bedarf
// einen Standard-Sponsor (aktuelle Auswahl ist keiner der eigenen Sponsoren
// oder leer) und rendert dann über renderSponsorDetail() das Detailpanel
// (das intern wiederum renderMySponsorsGrid() aufruft).
function renderMySponsors() {
  const mine = SPONSORS.filter((s) => sponsorState[s.name] && sponsorState[s.name].active);
  if (mine.length === 0) {
    renderMySponsorsGrid();
    return;
  }
  if (!selectedSponsorName || !mine.some((s) => s.name === selectedSponsorName)) {
    selectedSponsorName = mine[0].name;
  }
  renderSponsorDetail(selectedSponsorName);
}

function selectSponsorSubtab(id) {
  sponsorSubtab = id;
  document.querySelectorAll('.dashboard-sponsors-subtab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.subtab === id));
  document.getElementById('dashboard-sponsors-overview').classList.toggle('hidden', id !== 'overview');
  document.getElementById('dashboard-sponsors-mine').classList.toggle('hidden', id !== 'mine');
  if (id === 'mine') renderMySponsors();
}

// ── Bewerbungs-Popup ("Angebot") ──────────────────────────────────────────
function openSponsorRequestPopup(name) {
  sponsorRequestTarget = name;
  document.getElementById('sponsor-request-name').textContent = name;
  document.getElementById('sponsor-request-remaining').textContent = String(remainingSponsorRequests());
  document.getElementById('btn-sponsor-request-confirm').disabled = remainingSponsorRequests() <= 0;
  document.getElementById('sponsor-request-modal').classList.remove('hidden');
}

function closeSponsorRequestPopup() {
  sponsorRequestTarget = null;
  document.getElementById('sponsor-request-modal').classList.add('hidden');
}

// User-Vorgabe: max. 5 GLEICHZEITIG aktive Bewerbungs-Slots, jeder einzelne
// Slot läuft 1 Monat nach seinem eigenen Anfragedatum rollierend wieder ab
// (siehe activeSponsorRequestCount()) -- eng an careerDate gekoppelt, nicht
// an Echtzeit. Antwortzeit 7-14 Tage (zufällig, echtes Spielereignis wie
// schon generateBotTrades() -- kein Determinismus nötig).
function confirmSponsorRequest() {
  if (!sponsorRequestTarget || remainingSponsorRequests() <= 0 || activeSponsorCount() >= MAX_ACTIVE_SPONSORS) {
    closeSponsorRequestPopup();
    return;
  }

  const name = sponsorRequestTarget;
  const responseDays = 7 + Math.floor(Math.random() * 8); // 7-14 Tage
  const d = parseCareerDate(careerDate);
  d.setUTCDate(d.getUTCDate() + responseDays);

  const prevRejectionCount = (sponsorState[name] && sponsorState[name].rejectionCount) || 0;
  sponsorState[name] = {
    pending: true,
    requestDate: careerDate,
    responseDate: d.toISOString().slice(0, 10),
    active: false,
    completedGoals: [],
    cooldownUntil: null,
    lockedUntil: null,
    rejectionCount: prevRejectionCount,
  };

  sponsorRequestLog.push(careerDate);

  closeSponsorRequestPopup();
  renderSponsorDetail(name);
  saveGameState();
}

// Trikot rechts -- Farbe von der Org (nur selbst erstellte Orgas haben eine
// gewählte Farbe, siehe ORG_CREATE_COLOR_PRESETS; bei den 87 festen Orgas
// gibt es kein Farbfeld, Fallback auf eine neutrale Akzentfarbe), Logo in der
// Mitte über die schon bestehende resolveOrgLogoUrl()/orgBadgeColor()-Logik.
function renderSponsorJersey() {
  const svg = document.getElementById('dashboard-sponsors-jersey-svg');
  let color = '#3ecf72';
  if (assignedOrg.colorId) {
    const preset = ORG_CREATE_COLOR_PRESETS.find((c) => c.id === assignedOrg.colorId);
    if (preset) color = preset.hex;
  }
  svg.querySelector('path').style.fill = color;

  const logoUrl = resolveOrgLogoUrl(assignedOrg);
  const logoEl = document.getElementById('dashboard-sponsors-jersey-logo');
  logoEl.innerHTML = logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div style="background:' + orgBadgeColor(assignedOrg.name) + ';width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:8px;">' + assignedOrg.name.trim().charAt(0).toUpperCase() + '</div>';
}

function renderDashboardSponsorsPanel() {
  checkSponsorGoals();
  selectSponsorSubtab(sponsorSubtab);
  document.querySelectorAll('.dashboard-sponsors-tier-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tier === sponsorTierFilter));
  renderSponsorGrid();
  renderSponsorJersey();
  // Beim ersten Öffnen (noch keine Auswahl) direkt den ersten sichtbaren
  // Sponsor zeigen, damit die Detailansicht nie leer wirkt (spiegelt den
  // Referenz-Screenshot, der ebenfalls immer einen vorausgewählten Sponsor zeigt).
  if (!selectedSponsorName && filteredSponsors().length > 0) {
    renderSponsorDetail(filteredSponsors()[0].name);
    renderSponsorGrid();
  } else if (selectedSponsorName) {
    renderSponsorDetail(selectedSponsorName);
  }
}

// ── Turniere-Seite (Runde 43) ─────────────────────────────────────────────
// Bildet die bestehende, rein zustandsmaschinen-getriebene Saisonstruktur
// (3x Open Qualifier -> Major -> Last Chance Qualifier -> Weltmeisterschaft,
// siehe season.js/startTournament()) auf einen konkreten Kalender ab, rein
// zur Anzeige -- siehe Kommentar in data/tournament-calendar.js. Steuert
// NICHT die tatsächliche Turnier-Simulation, das bleibt weiterhin über den
// "Turnier starten"-Button auf dem Draft-Screen.
let tournamentCalendarViewMonth = null; // 'YYYY-MM', wird beim ersten Öffnen auf den Saisonstart initialisiert

// Open-Qualifier-Anmeldung (Runde 45, echte Regional-Brackets -- ersetzt die
// Runde-44-Zufallslotterie): jedes der 6 Opens hat sein eigenes 1-Tages-
// Anmeldefenster, für das man sich EINZELN an-/abmelden kann. Kein Losen
// mehr nötig -- das Teilnehmerfeld ist einfach "alle Orgas der eigenen
// Region" + man selbst, wenn angemeldet (siehe regionOrgs()/
// tournamentDetailSlotsHtml() weiter unten).
let openQualifierRegistrations = {}; // { open1: true, open4: false, ... } -- fehlender Key = nicht angemeldet
// Runde 82, Saison-Leaderboard (siehe awardTournamentPoints() weiter unten):
// laufendes Punkte-Konto je Org, wird bei jedem Saisonwechsel zurückgesetzt
// (siehe startNextSeason()).
let seasonPoints = {}; // { orgName: totalPoints }
// Runde 85: gespeicherte Turnier-Endstände dieser Saison, key = Event-Key
// (z.B. 'open1', 'major1', 'lcq' -- bei 'lcq' zusätzlich pro Region
// verschachtelt, siehe resolveEventIfDue()). Wird bei jedem Saisonwechsel
// zurückgesetzt (siehe startNextSeason()) und dient sowohl als "schon
// aufgelöst"-Merker (checkTournamentResolutions() löst jedes Event nur
// einmal auf) als auch als Datenquelle für die Turnier-Detailseite (echte
// Namen/Ergebnisse statt "TBD", siehe tournamentStageHtml()).
let seasonTournamentResults = {};
// Runde 98, Bug-Fix (User-Meldung: "wenn man disqualifiziert ist weil man zweimal verloren hat,
// ist man in einem ewigen Loop mit Match-Button gefangen und spielt ewig gegen das letzte Team"):
// revealedStepCount() (siehe dort) klemmt den enthüllten Schritt dauerhaft auf totalSteps fest,
// sobald der Kalender über das Enthüllungsfenster eines Events hinausläuft -- es gab aber KEIN
// Signal, dass "dieser Schritt/dieses Match wurde schon live gezeigt". Ohne Merker fand
// findOwnMatchToday() das eigene Match des letzten enthüllten Schritts (Sieg ODER Niederlage,
// betraf also nicht nur Disqualifikationen) jeden weiteren Tag erneut und spielte es endlos neu ab
// -- der Grund, warum der Bug speziell bei einer frühen Disqualifikation auffiel: nach dem
// eigentlichen Ausscheiden gibt es sonst keine neuen Turniertage mehr, die den Loop überdecken
// könnten. Key = `event.key + ':' + Schritt` -> true, sobald der Live-Ticker dafür einmal lief.
// Persistiert wie seasonTournamentResults (siehe startNextSeason()/confirmOrgAndProceed()/
// collectSaveState()/loadGameState()).
let shownOwnMatchSteps = {};
// Runde 102, User-Vorgabe ("Swiss/jedes Turnierformat step-by-step statt alle
// Bot-Matches gleichzeitig fertig"): merkt sich, für welche (Event, Schritt,
// Stage-Instanz)-Kombination die animierte Schritt-für-Schritt-Enthüllung
// schon einmal gelaufen ist (siehe cascadeRevealStep()) -- ein späteres
// erneutes Rendern (Tab-Wechsel, Tagfortschritt an einem anderen Turnier)
// zeigt dieselbe, schon enthüllte Stage dann wieder normal/sofort statt die
// Animation zu wiederholen. Bewusst NICHT dasselbe Objekt wie
// shownOwnMatchSteps (unterschiedliche Bedeutung: "Live-Ticker angesehen" vs.
// "Bot-Matches dieses Schritts schon einmal Match-für-Match aufgedeckt"), aber
// dieselbe Persistenz-Behandlung (Neues Spiel/Saisonwechsel/Save/Load).
let cascadeRevealedSteps = {};
// Runde 99, Bug-Fix (User-Meldung: "wenn Anmeldephase ist und man auf Weiter
// klickt, wird man sofort ins Match reingeworfen"): advanceDashboardDay()
// rief bei einem reaktiv (erst am Auflösungstag selbst, an dem ein Turnier
// zum ersten Mal aufgelöst UND enthüllt wird) gefundenen eigenen Match bisher
// SOFORT playOwnMatchSeriesLive() auf -- der Button zeigte in diesem Fall nie
// "MATCH", der Spieler landete ohne zweiten bewussten Klick im Live-Ticker.
// Jetzt merkt sich advanceDashboardDay() ein so gefundenes Match nur noch
// hier, der Tagfortschritt schließt normal ab, renderDashboardTopbar() zeigt
// "MATCH »" -- erst ein weiterer Klick (siehe Listener auf
// btn-dashboard-advance-day) startet den Ticker via triggerPendingOwnMatch().
// Bewusst NICHT persistiert (reines Session-UI-Detail wie selectedSponsorName):
// ein Beenden exakt zwischen Fund und Klick auf MATCH würde dieses eine
// Match beim nächsten Laden überspringen (Ergebnis war ja längst simuliert,
// betrifft nur die Live-Anzeige) -- ein sehr seltener Randfall, den wir bewusst
// nicht mit zusätzlicher Save-Komplexität absichern.
let pendingOwnMatch = null; // { event, match, stepKey } oder null
// Runde 92/93, User-Vorgabe ("Open Qualifier umbauen"): die 32 Teams pro
// Region, die den Open Qualifier (open0, 8 Gruppen à 8 Teams Doppel-K.o.,
// siehe resolveOpenQualifierEvent()) überlebt haben -- key = Region, Wert =
// Array von Org-Namen. Ersetzt die alte ">32 Vorrunde-Cut"-Platzhalterlogik in
// resolveOpenEvent(): Open 1-6 rekrutieren ihr 32er-Feld jetzt aus DIESER
// Liste statt aus regionOrgs(region) (64 Orgas). NUR Open 1-6 -- Major/
// Worlds/LCQ hängen unverändert an Saison-Punkten, nicht an dieser Liste
// (Runde 93, User-Klarstellung). Wird bei jedem Saisonwechsel zurückgesetzt
// (wie seasonPoints/seasonTournamentResults) UND bei "Neues Spiel" (siehe
// confirmOrgAndProceed()).
let seasonQualifiedTeams = {};
// Runde 102, User-Vorgabe ("wenn man das Überspringen getan hat, sollen Text
// und Button wieder verschwinden"): isPlayerDisqualifiedForSeason() bleibt ja
// weiterhin `true` (die eigene Org IST ja immer noch disqualifiziert, das
// ändert sich erst mit der nächsten Saison) -- ohne einen eigenen "schon
// benutzt"-Merker würde der Skip-Banner nach dem Sprung ins Transferfenster
// also sofort wieder auftauchen. Season-scoped wie seasonQualifiedTeams --
// zurückgesetzt bei "Neues Spiel" UND jedem Saisonwechsel.
let seasonSkipUsed = false;
let tournamentDetailEventKey = null; // 'open1'..'open6', welches Turnier die Detailseite gerade zeigt
let tournamentDetailActiveTab = 'overview'; // welcher dynamische Tab (Runde 50) gerade aktiv ist
let tournamentDetailConnectors = {}; // tabKey -> [{containerId, connections}], siehe renderTournamentFormatTabs()

function addDaysToDateStr(str, days) {
  const d = parseCareerDate(str);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Runde 94, User-Vorgabe ("Tag für Tag"-Ergebnis-Enthüllung): ganzzahlige
// Differenz in Tagen zwischen zwei careerDate-Strings (b - a). Reine
// Kalenderarithmetik über parseCareerDate()/UTC-Millisekunden, robust gegen
// Monats-/Jahresgrenzen.
function daysBetweenDateStrs(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseCareerDate(b).getTime() - parseCareerDate(a).getTime()) / msPerDay);
}

// Wie viele der `totalSteps` (Stages eines Turniers ODER interne Runden des
// Open-Qualifier-Baums, siehe fillStageResults()/fillQualifierGroupBracket())
// sind laut Kalender bereits enthüllt: Tag 1 der Qualifikationsphase zeigt
// Schritt 1, Tag 2 Schritt 2, usw. -- exakt die "Tag 1 nur Runde 1, Tag 2
// Halbfinale, letzter Tag Finale"-Vorgabe des Users, verallgemeinert auf
// jede Schrittzahl.
function revealedStepCount(event, totalSteps) {
  const daysPassed = daysBetweenDateStrs(event.phaseDates.qualification.start, careerDate);
  return Math.max(0, Math.min(totalSteps, daysPassed + 1));
}

// Runde 99, Folge-Fix (User-Meldung: "wenn man am Verlosungstag auf Weiter
// klickt und beim ersten Match-Tag ankommt, kommt zwar der MATCH-Button,
// aber das erste Match wurde schon automatisch im Bracket eingetragen"):
// revealedStepCount() sagt nur, was der KALENDER laut Simulationsstand schon
// enthüllen dürfte -- das ist unabhängig davon, ob der Spieler sein eigenes
// Match aus GENAU diesem Schritt schon über den Live-Ticker angesehen hat
// (pendingOwnMatch). Ohne Bremse füllte renderTournamentFormatTabs() den
// kompletten Schritt (inkl. der eigenen Karte MIT Score, und bei Round-Robin
// sogar die daraus berechnete Tabelle) sofort beim Ankommen auf dem neuen
// Tag -- der Spieler sah das Ergebnis im Bracket, bevor er den Ticker
// überhaupt gestartet hatte. Diese Funktion hält die SICHTBARE Enthüllung
// exakt einen Schritt zurück, solange ein eigenes Match DIESES Events noch
// unangesehen aussteht -- findOwnMatchToday()/die Kalender-/Speicherlogik
// bleiben unverändert auf revealedStepCount() (die müssen den echten Stand
// kennen, um das Match überhaupt erst zu ENTDECKEN). Sobald triggerPendingOwnMatch()
// den Ticker abgespielt hat, verschwindet die Bremse (pendingOwnMatch===null)
// und der zurückgehaltene Schritt wird normal sichtbar.
function visualRevealStepCount(event, totalSteps) {
  const calendarStep = revealedStepCount(event, totalSteps);
  if (pendingOwnMatch && pendingOwnMatch.event.key === event.key) return calendarStep - 1;
  return calendarStep;
}

// Runde 103, User-Vorgabe ("bei Swiss soll, wenn man erstes Match spielt, die
// Bots auch nur Tag 1 ablaufen, dann Tag 2, usw. -- nicht alles auf einmal"):
// eine Swiss-Stage (Open 1-6/LCQ/Worlds, NICHT open0 -- der hat sein eigenes
// STANDARD8_SLOT_ROUND-System) bekommt jetzt genau wie der Open Qualifier
// eine RUNDEN-INTERNE Enthüllung statt die ganze Stage an einem Kalendertag
// auf einmal zu zeigen. 5 ist die mathematische Obergrenze für eine 3-Sieg/
// 3-Niederlage-Schwelle (siehe simulateSwissStage()): nach 4 Runden kann ein
// Team höchstens 2-2 stehen und ist immer noch im Rennen, Runde 5 entscheidet
// dann IMMER -- ein Feld kann also nie mehr als 5 Runden brauchen (kann aber
// bei sehr kleinen/unrunden Feldern rechnerisch auch weniger sein, dann
// zeigen die "überzähligen" Tage schlicht nichts Neues mehr, siehe
// fillSwissLadderResultsPartial()).
const SWISS_REVEAL_ROUNDS = 5;

// Index der swissLadder-Stage in info.stages, oder -1, falls dieses Format
// keine hat (Major/Worlds-Gruppenphase ist roundRobin, kein Swiss). open0
// wird hier bewusst nicht behandelt (hat sein eigenes, komplett separates
// Schritt-System, siehe Aufrufer).
function swissStageIndexForEvent(info) {
  return info.stages.findIndex((s) => s.visual === 'swissLadder');
}

// Runde 105, User-Vorgabe ("nach Swiss erstmal ein Tag wieder nicht gespielt
// und Auslosung nur für Gruppenphase, selbe dann für Playoffs -- für alle
// Turniere, damit man sich vorher die Aufstellung in Ruhe anschauen kann"):
// baut die GESAMTE geordnete Liste der Enthüllungs-"Schritte" eines Events als
// flaches Array -- jeder Eintrag ist entweder `{stageIndex, isAssignment:true}`
// (reiner Auslosungstag, nur Startpaarungen/Zuteilung, kein Ergebnis) oder
// `{stageIndex, swissRound?}` (echter Enthüllungsschritt). Stage 0 bekommt
// NIE einen eigenen Auslosungs-SLOT hier -- die bekommt ihren schon seit
// Runde 99 bestehenden, separaten "Tag 0" (revealedStepCount()===0, siehe
// renderTournamentFormatTabs()) VOR diesem Array. Jede SPÄTERE Stage (i>0)
// bekommt genau einen Auslosungs-Slot direkt vor ihrer eigenen Enthüllung.
function buildStageStepPlan(info, swissIndex) {
  const plan = [];
  info.stages.forEach((stage, i) => {
    if (i > 0) plan.push({ stageIndex: i, isAssignment: true });
    if (i === swissIndex) {
      for (let r = 1; r <= SWISS_REVEAL_ROUNDS; r++) plan.push({ stageIndex: i, swissRound: r });
    } else {
      plan.push({ stageIndex: i });
    }
  });
  return plan;
}

// Löst einen GLOBALEN 1-basierten Enthüllungs-Schritt in ein Element des
// obigen Plans auf (siehe buildStageStepPlan()) -- ersetzt die alte,
// formelbasierte Berechnung, seit Auslosungstage jetzt zusätzliche Slots
// zwischen den Stages einschieben können.
// Bug-Fix (Runde 105, User-Meldung: "beim Auslosungstag wird das ganze
// Turnier in einem Zug mit Ergebnissen durchsimuliert"): `globalStep` ist am
// separaten, seit Runde 99 bestehenden "Tag 0" (revealedStepCount()===0, der
// EINE Auslosungstag VOR der allerersten Stage) tatsächlich 0 -- `plan[0-1]`
// ist `plan[-1]`, in JS `undefined`, wodurch der `||`-Fallback auf
// `plan[plan.length-1]` (die LETZTE Stage, meist Playoffs!) zurückfiel.
// renderTournamentFormatTabs()s `i < resolvedStep.stageIndex`-Zweig hielt
// dadurch JEDE Stage vor der letzten für "schon komplett enthüllt" und füllte
// sofort alle echten Ergebnisse, obwohl gerade erst die Anmeldung geschlossen
// hatte. Fix: `globalStep < 1` explizit auf `stageIndex: -1` abbilden (ein
// Sentinel, das garantiert kleiner als jeder echte Stage-Index ist) --
// dadurch bleiben alle Stages TBD, bis die separate `i===0 &&
// stepsRevealed===0`-Weiche (unverändert) die erste Stage als Auslosungstag
// befüllt.
function stageForGlobalStep(swissIndex, globalStep, info) {
  if (globalStep < 1) return { stageIndex: -1 };
  const plan = buildStageStepPlan(info, swissIndex);
  return plan[globalStep - 1] || plan[plan.length - 1];
}

// Anzahl der Enthüllungs-"Schritte" (= Kalendertage) eines Events -- normal
// 1 Schritt pro Stage, AUSSER: Open Qualifier (3 Runden INNERHALB seiner
// einzigen Stage, siehe fillStandard8BracketPartial()), Major (4 Gruppen A-D
// INNERHALB der Gruppenphase-Stage, je ihr eigener Tag, User-Vorgabe "Tag1
// Gruppe A... Tag4 Gruppe D", PLUS Runde 105: ein neuer Auslosungstag vor
// Playoffs) und jede Swiss-Stage (SWISS_REVEAL_ROUNDS interne Runden statt 1
// Schritt, s.o.) -- Major hat seine Gruppenphase-Feinaufteilung schon über
// `groupRevealCount` gelöst (kein eigener Stage-Step-Plan nötig), alle
// anderen Formate nutzen jetzt einheitlich buildStageStepPlan().
function totalRevealStepsForEvent(event, info) {
  if (event.key === 'open0') return 3;
  if (event.eventType === 'major') return info.stages[0].groupLabels.length + 2;
  const swissIndex = swissStageIndexForEvent(info);
  return buildStageStepPlan(info, swissIndex).length;
}

// ── Live-Match-Popup (Runde 95, User-Vorgabe "detailliertere Simulation") ──
// Extrahiert ALLE Einzelspiele EINES Enthüllungs-"Schritts" (1-basiert, siehe
// totalRevealStepsForEvent()/revealedStepCount()) als flache Liste im
// gemeinsamen `{teamAName,teamBName,scoreA,scoreB,isOwnMatch,games,ownIsA}`-
// Format -- Grundlage für findOwnMatchForStep(), das darin nach der eigenen
// Org sucht. Spiegelt dieselben Enthüllungs-Zweige wie renderTournamentFormatTabs()
// (open0: Runde INNERHALB der 8 Gruppen, Major: Gruppe INNERHALB der
// Gruppenphase, sonst: ganze Stage).
// Runde 102, Erweiterung fürs Schritt-für-Schritt-Reveal (cascadeRevealStep()
// weiter unten): jedes zurückgegebene Match trägt jetzt zusätzlich
// `_groupIndex` (Index der Gruppe/Instanz, in der es liegt -- 0 bei
// ungruppierten Stages), damit ein Aufrufer das passende DOM-Element
// rekonstruieren kann (dieselbe Gruppen-Nummerierung, die
// tournamentStageHtml()/fillStageResults() für ihre Karten-IDs verwenden,
// z.B. stageInstanceId + '-de' + groupIndex + '-' + slot). Rein additiv
// (Objekt-Spread, KEINE Mutation der in seasonTournamentResults
// gespeicherten Original-Objekte) -- ändert nichts am bestehenden
// findOwnMatchForStep()-Verhalten, das dieses Feld einfach ignoriert.
function matchesForRevealStep(event, step) {
  const eventResult = seasonTournamentResults[event.key];
  if (!eventResult) return [];
  const region = orgRegion(assignedOrg.country);
  const resultForStages = (event.eventType === 'lcq' || event.eventType === 'open')
    ? (region ? eventResult[region] : null)
    : eventResult;
  if (!resultForStages) return [];

  if (event.key === 'open0') {
    const out = [];
    (resultForStages.gruppenphase || []).forEach((g, gi) => {
      (g.matches || []).forEach((m) => {
        const prefix = m.slot.replace(/-\d+$/, '');
        if (STANDARD8_SLOT_ROUND[prefix] === step) out.push({ ...m, _groupIndex: gi });
      });
    });
    return out;
  }
  const info = tournamentFormatInfo(event);
  if (event.eventType === 'major') {
    const groupCount = info.stages[0].groupLabels.length;
    if (step <= groupCount) {
      const gi = step - 1;
      const g = (resultForStages.gruppenphase || [])[gi];
      return g ? (g.results || []).map((m) => ({ ...m, _groupIndex: gi })) : [];
    }
    // Runde 105: neuer Auslosungstag vor Playoffs (step === groupCount+1) --
    // noch keine Matches, nur Startaufstellung (siehe fillStageAssignmentOnly()).
    if (step === groupCount + 1) return [];
    return ((resultForStages.playoffs && resultForStages.playoffs.matches) || []).map((m) => ({ ...m, _groupIndex: 0 }));
  }
  // Runde 103: swissIndex/stageForGlobalStep() lösen den GLOBALEN Schritt in
  // {stageIndex, swissRound} auf -- ohne Swiss-Stage (swissIndex===-1) exakt
  // dieselbe alte 1:1-Abbildung (Schritt N = Stage N-1) wie vorher.
  const swissIndex = swissStageIndexForEvent(info);
  const resolvedStep = stageForGlobalStep(swissIndex, step, info);
  // Runde 105: ein Auslosungstag zeigt nur Namen, noch keine Ergebnisse --
  // hier gibt es (bewusst) nichts zu finden, weder fürs Cascade-Reveal noch
  // für die eigene-Match-Erkennung (findOwnMatchForStep()).
  if (resolvedStep.isAssignment) return [];
  const { stageIndex, swissRound } = resolvedStep;
  const stageKeys = stageResultKeysForEventType(event);
  const key = stageKeys[stageIndex];
  const stage = info.stages[stageIndex];
  const stageData = key ? resultForStages[key] : null;
  if (!stageData || !stage) return [];
  if (stage.visual === 'swissLadder') {
    const groups = stage.groupLabels ? stageData : [stageData];
    const out = [];
    groups.forEach((g, gi) => (g.log || []).forEach((entry) => {
      // Runde 103: nur die Matches DIESER internen Runde -- swissRound ist
      // hier IMMER gesetzt, da stage.visual==='swissLadder' laut
      // swissStageIndexForEvent() garantiert stageIndex===swissIndex bedeutet.
      if (entry.b !== null && entry.round === swissRound) out.push({ ...entry, _groupIndex: gi });
    }));
    return out;
  }
  if (stage.visual === 'roundRobin') {
    const out = [];
    stageData.forEach((g, gi) => (g.results || []).forEach((m) => out.push({ ...m, _groupIndex: gi })));
    return out;
  }
  if (stage.visual === 'doubleElim') {
    if (stage.groupLabels) {
      const out = [];
      stageData.forEach((g, gi) => (g.matches || []).forEach((m) => out.push({ ...m, _groupIndex: gi })));
      return out;
    }
    return (stageData.matches || []).map((m) => ({ ...m, _groupIndex: 0 }));
  }
  if (stage.visual === 'bracket') return (stageData.matches || []).map((m) => ({ ...m, _groupIndex: 0 }));
  if (stage.visual === 'lcqVorrunde') return (stageData.koMatches || []).map((m) => ({ ...m, _groupIndex: 0 }));
  return [];
}

// Sucht innerhalb eines Enthüllungs-Schritts nach einem Match der eigenen Org
// (`isOwnMatch`-Flag, siehe simulateBotSeries()). Normalisiert Swiss-Log-
// Einträge (Felder `a`/`b`/`winsA`/`winsB`) auf dieselbe
// `teamAName`/`teamBName`/`scoreA`/`scoreB`-Form wie Bracket-/RoundRobin-
// Matches, damit playOwnMatchSeriesLive() nur EIN Format kennen muss.
// Runde 105: filtert jetzt zusätzlich Matches heraus, die per PER-MATCH-Key
// (ownMatchKey(), s.o.) schon als "gezeigt" markiert sind -- damit ein
// zweites eigenes Match im selben Schritt (andere Runde/Slot) noch gefunden
// werden kann, nachdem das erste bereits gespielt wurde. Gibt zusätzlich den
// passenden Key zurück, den triggerPendingOwnMatch() dann als "gezeigt"
// markiert.
function findOwnMatchForStep(event, step) {
  const raw = matchesForRevealStep(event, step).find((m) => m.isOwnMatch && !shownOwnMatchSteps[ownMatchKey(event, step, m)]);
  if (!raw) return null;
  const match = ('teamAName' in raw)
    ? raw // Bracket-/RoundRobin-Match, schon im richtigen Format
    : { teamAName: raw.a, teamBName: raw.b, scoreA: raw.winsA, scoreB: raw.winsB, games: raw.games, isOwnMatch: raw.isOwnMatch, ownIsA: raw.ownIsA };
  return { match, matchKey: ownMatchKey(event, step, raw) };
}

// Runde 99: peekOwnMatchTomorrow() (Runde 95, "Vorschau auf morgen fürs
// MATCH-Label") komplett entfernt -- seit der Runde-99-Entkopplung von
// Tagfortschritt und Match-Start (pendingOwnMatch/triggerPendingOwnMatch(),
// siehe advanceDashboardDay()) war jede Vorab-Vorschau falsch: sie zeigte
// "MATCH" schon EINEN Tag zu früh (z.B. am neuen Auslosungstag, User-Meldung
// "Button wird zu MATCH statt WEITER zu bleiben, Klick simuliert das Match
// sofort statt am nächsten Tag, UI öffnet sich nicht"), weil ein Klick an
// diesem Tag ja nur den Tag weiterschiebt, nicht sofort spielt.
// renderDashboardTopbar() zeigt "MATCH" jetzt ausschließlich, wenn
// pendingOwnMatch WIRKLICH gesetzt ist (siehe dort).

// Runde 98: gemeinsamer Schlüssel für shownOwnMatchSteps (s.o.), den
// findOwnMatchToday() beim Fund und triggerPendingOwnMatch() beim
// tatsächlichen Abspielen verwenden, um dieselbe Instanz eines
// Enthüllungsschritts zu identifizieren.
function ownMatchStepKey(event, step) {
  return event.key + ':' + step;
}

// Runde 105, Bug-Fix (User-Meldung: "in der Gruppenphase wird nach dem ersten
// Match trotzdem alles auto simuliert, jedes Match muss einzeln bestritten
// werden"): EIN Enthüllungsschritt (z.B. die komplette Gruppenphase-Stage,
// die -- anders als Swiss -- NICHT auf mehrere Kalendertage verteilt ist)
// kann MEHRERE eigene Matches enthalten (z.B. Viertelfinale gewonnen ->
// Halbfinale, beides am selben Tag). `ownMatchStepKey()`/`shownOwnMatchSteps`
// markierten bisher den GESAMTEN Schritt als "gezeigt", sobald nur EIN
// eigenes Match darin gespielt wurde -- ein zweites eigenes Match im selben
// Schritt wurde dadurch nie als pendingOwnMatch erkannt und lief einfach im
// generischen Bot-Cascade mit. Eindeutige Kennung pro EINZELNEM Match
// (Gruppenindex + Slot/Spalte-Zeile/Team-Namen, je nach Match-Form) statt pro
// ganzem Schritt.
function matchUniqueSlotId(match) {
  if (match.slot !== undefined) return match._groupIndex + '|' + match.slot;
  if (match.colKey !== undefined) return match._groupIndex + '|' + match.colKey + '-' + match.row;
  return match._groupIndex + '|' + (match.teamAName || match.a) + '|' + (match.teamBName || match.b);
}
function ownMatchKey(event, step, match) {
  return ownMatchStepKey(event, step) + '#' + matchUniqueSlotId(match);
}

// Für den TATSÄCHLICHEN Tagfortschritt (advanceDashboardDay()): läuft NACH
// checkTournamentResolutions(), careerDate ist bereits der neue, aktuelle Tag
// -- findet ein eigenes Match, das GENAU heute (der zuletzt enthüllte Schritt)
// zum ersten Mal sichtbar wird. Wird jetzt AUCH direkt nach dem Abspielen
// eines eigenen Matches erneut aufgerufen (siehe triggerPendingOwnMatch()),
// um ein WEITERES eigenes Match im selben Schritt zu finden, ohne auf den
// nächsten Kalendertag warten zu müssen.
function findOwnMatchToday() {
  for (const event of currentSeasonTournamentSchedule()) {
    if (!seasonTournamentResults[event.key]) continue;
    const info = tournamentFormatInfo(event);
    const totalSteps = totalRevealStepsForEvent(event, info);
    const step = revealedStepCount(event, totalSteps);
    if (step < 1 || step > totalSteps) continue;
    const found = findOwnMatchForStep(event, step);
    // Runde 99: NICHT mehr sofort hier als gezeigt markieren -- das Match wird
    // erst als pendingOwnMatch gemerkt und über einen bewussten zweiten Klick
    // (triggerPendingOwnMatch()) gestartet; erst DORT gilt es als "gezeigt".
    if (found) return { event, match: found.match, stepKey: found.matchKey };
  }
  return null;
}

// Runde 99: startet ein zuvor nur gemerktes (pendingOwnMatch) eigenes Match --
// ausgelöst durch den zweiten, bewussten Klick auf den MATCH-Button (siehe
// Listener auf btn-dashboard-advance-day). Markiert den Schritt erst JETZT als
// gezeigt (shownOwnMatchSteps), nicht schon bei der reinen Entdeckung in
// findOwnMatchToday() -- sonst würde ein noch nicht gestarteter Ticker beim
// Beenden/Neuladen unwiderruflich verloren gehen (siehe pendingOwnMatch-Kommentar).
function triggerPendingOwnMatch() {
  if (!pendingOwnMatch) return;
  const { event, match, stepKey } = pendingOwnMatch;
  pendingOwnMatch = null;
  shownOwnMatchSteps[stepKey] = true;
  // Runde 105, Folge-Fix (User-Meldung: "muss direkt hintereinander ALLE
  // eigenen Matches bestreiten ohne die Bot-Kaskade dazwischen zu sehen --
  // mache das wie bei Swiss/Open-Quali"): war dieses Match Teil einer gerade
  // laufenden Runden-Kaskade (siehe cascadeRevealStep()), wurde dort eine
  // Fortsetzungs-Funktion hinterlegt -- die übernimmt jetzt, statt sofort
  // stumpf nach dem NÄCHSTEN eigenen Match zu suchen. Das lässt die
  // Bot-Matches der GERADE ABGESCHLOSSENEN Runde (schon fertig) UND jeder
  // weiteren Runde (die die Fortsetzung selbst anstößt) normal dazwischen
  // sichtbar werden, statt alle eigenen Matches ohne Zwischenanimation
  // durchzureichen.
  const resumeCascade = cascadeResumeCallbacks[stepKey];
  delete cascadeResumeCallbacks[stepKey];
  playOwnMatchSeriesLive(match, event, () => {
    showScreen('screen-dashboard');
    if (resumeCascade) {
      // Setzt cascadeAnimationActive wieder + führt die Runden-Kette fort
      // (nächste Runde, inkl. eines evtl. NEUEN eigenen Matches darin).
      resumeCascade();
    } else {
      // Fallback (kein aktiver Kaskaden-Kontext bekannt -- z.B. das eigene
      // Match wurde ganz am Anfang eines Tages über findOwnMatchToday()
      // entdeckt, BEVOR die Turnier-Detailseite je gerendert wurde): wie
      // bisher direkt nach dem nächsten eigenen Match suchen.
      pendingOwnMatch = findOwnMatchToday();
    }
    renderDashboardTopbar();
    // Runde 99, Folge-Fix ("erstes Match im oberen Bracket wurde schon
    // automatisch eingetragen, bevor der Ticker lief"): visualRevealStepCount()
    // hielt die Turniere-/Detailseite bewusst einen Schritt zurück, solange
    // DIESES Match als pendingOwnMatch offen war (siehe dort) -- jetzt, wo es
    // gerade beendet wurde, muss neu gerendert werden, sonst bliebe die Seite
    // bis zum nächsten Tagfortschritt auf dem zurückgehaltenen Stand stehen.
    if (!document.getElementById('dashboard-page-tournaments').classList.contains('hidden')) {
      renderDashboardTournamentsPanel();
    }
    if (!document.getElementById('dashboard-page-tournament-detail').classList.contains('hidden')) {
      renderTournamentDetailPanel();
    }
    if (!document.getElementById('dashboard-page-home').classList.contains('hidden')) {
      renderDashboardHomePanel();
    }
    // Gleicher Live-Refresh-Fix wie in finishDashboardDayAdvance() -- das
    // eigene Match kann Statistiken/Team-Info ebenfalls betreffen (eigene
    // Org UND der gerade gesehene Gegner), falls diese Seite gerade offen ist.
    if (!document.getElementById('dashboard-page-stats').classList.contains('hidden')) {
      renderDashboardStatsPanel();
    }
    if (!document.getElementById('dashboard-page-team-info').classList.contains('hidden')) {
      renderTeamInfoPanel();
    }
    if (!document.getElementById('dashboard-page-transfers').classList.contains('hidden')) {
      renderDashboardTransfersPanel();
    }
    if (!document.getElementById('dashboard-page-scouting').classList.contains('hidden')) {
      renderDashboardScoutingPanel();
    }
    saveGameState();
  });
}

// Spielt die komplette, bereits fertig simulierte Serie der eigenen Org LIVE
// im bestehenden Match-Ticker ab (playMatchTicker()/tickMatch()/
// renderSeriesDots(), seit der ursprünglichen Draft-Match-Ansicht bestehende,
// bewährte Infrastruktur -- Wall-Clock-Timer, Speed-Regler, 5-Minuten-Uhr +
// hochzählende Verlängerung, Tor/Save/Sub-Hervorhebung). WICHTIG: das
// ENDERGEBNIS steht durch die (unveränderte, instante) Turnier-Simulation
// schon fest -- hier wird NICHTS neu gewürfelt, nur die bereits aufgezeichneten
// echten Ticker-Events (match.games[].events, siehe simulateBotSeries())
// zeitversetzt abgespielt, damit der Bracket-Stand konsistent bleibt.
// `bestOf` wird aus dem Serien-Endstand hergeleitet (Ziel-Siegzahl = höherer
// der beiden Endscores, Bo(2*Ziel-1)) -- braucht keine eigene Stage->Bo-
// Zuordnungstabelle.
function playOwnMatchSeriesLive(match, event, onSeriesDone) {
  const ownIsA = match.ownIsA;
  const ownName = assignedOrg.name;
  const oppName = ownIsA ? match.teamBName : match.teamAName;
  const oppOrg = findOrgByName(oppName);
  const ownRoster = assignedOrg.roster.starters;
  const oppRoster = oppOrg ? oppOrg.roster.starters : [];
  const bestOf = 2 * Math.max(match.scoreA, match.scoreB) - 1;
  const games = match.games || [];
  const priorResults = []; // 'win'/'loss' aus Sicht der EIGENEN Org

  function playNextGame() {
    const gameIndex = priorResults.length;
    const g = games[gameIndex];
    const ownScore = ownIsA ? g.scoreA : g.scoreB;
    const oppScore = ownIsA ? g.scoreB : g.scoreA;
    const ownWinsThisGame = ownScore > oppScore;
    const isLastGame = gameIndex === games.length - 1;
    const winsSoFar = { win: priorResults.filter((r) => r === 'win').length, loss: priorResults.filter((r) => r === 'loss').length };

    const seriesInfo = {
      bestOf,
      gameNumber: gameIndex + 1,
      priorResults: priorResults.slice(),
      pendingResult: ownWinsThisGame ? 'win' : 'loss',
      preGameWinsA: winsSoFar.win,
      preGameWinsB: winsSoFar.loss,
      seriesDone: isLastGame,
      finalWinsA: winsSoFar.win + (ownWinsThisGame ? 1 : 0),
      finalWinsB: winsSoFar.loss + (ownWinsThisGame ? 0 : 1),
      continueLabel: isLastGame ? 'Weiter zum Turnier' : 'Nächstes Spiel',
    };
    // Die Ticker-Events sind mit team:'A'/'B' relativ zur URSPRÜNGLICHEN
    // simulateMatch()-Aufrufreihenfolge getaggt -- nameA/playersA MÜSSEN
    // deshalb exakt dieser Zuordnung folgen (siehe ownIsA), sonst würden
    // Tor-/Save-Hervorhebungen auf der falschen Roster-Seite aufblitzen.
    const nameA = ownIsA ? ownName : oppName;
    const nameB = ownIsA ? oppName : ownName;
    const playersA = ownIsA ? ownRoster : oppRoster;
    const playersB = ownIsA ? oppRoster : ownRoster;
    const result = { events: g.events, scoreA: g.scoreA, scoreB: g.scoreB, teamABonusPct: 0 };

    playMatchTicker(result, nameA, nameB, playersA, playersB, careerCoach, null, () => {
      priorResults.push(ownWinsThisGame ? 'win' : 'loss');
      if (isLastGame) onSeriesDone();
      else playNextGame();
    }, seriesInfo);
  }
  playNextGame();
}

// Runde 102, User-Vorgabe ("Gesamtpreisgeld muss zur Preisgeld-
// Platzierungsverteilung übereinstimmen, LCQ hat kein Preisgeld"): der
// angezeigte Gesamt-Pool ist jetzt direkt die Summe aller Platzierungs-
// Auszahlungen (prizeAmountForPlacement() weiter unten, dieselbe Rundung auf
// 100 pro Tier) -- garantiert per Konstruktion, dass Anzeige und tatsächliche
// Auszahlung (queuePrizePayoutForPlacement()) IMMER exakt übereinstimmen,
// auch wenn die Tabellen später mal angepasst werden. `def` kann sowohl ein
// TOURNAMENT_EVENT_DEFS-Rohobjekt als auch ein fertig gebautes Event sein --
// prizeTableForEvent() braucht nur `.eventType`/`.key`. open0 (isSeasonGate)
// und lcq (User: "hat kein Preisgeld") haben keine Tabelle -> Ergebnis 0.
function tournamentEventPrize(def, seasonNumber) {
  const table = prizeTableForEvent(def);
  if (!table) return 0;
  return totalPrizePoolForTable(table, seasonNumber);
}

// Wächst wie jede einzelne Platzierungs-Auszahlung leicht mit der Saisonzahl
// (+3%/Saison, dieselbe Formel wie prizeAmountForPlacement()) -- deckt sich
// dadurch immer exakt mit der Summe dessen, was am Ende WIRKLICH pro
// Platzierung ausgezahlt wird.
function totalPrizePoolForTable(table, seasonNumber) {
  return table.reduce((sum, tier) => sum + (tier.maxPlace - tier.minPlace + 1) * prizeAmountForPlacement([tier], tier.minPlace, seasonNumber), 0);
}

function tournamentEventLocation(def, seasonNumber, eventIndex) {
  if (def.format !== 'LAN') return null;
  return TOURNAMENT_HOST_LOCATIONS[(seasonNumber + eventIndex) % TOURNAMENT_HOST_LOCATIONS.length];
}

// Jedes Event ENDET am letzten Tag seines fest zugeordneten Monats
// (TOURNAMENT_EVENT_END_MONTH, siehe data/tournament-calendar.js, Runde 46
// -- User-Korrektur: Turniere sollen am MonatsENDE stattfinden, nicht am
// Monatsanfang, UND alles um einen Monat verschoben damit Januar wieder
// turnierfrei bleibt). Die Finale-Phase fällt dadurch auf den
// Monatsletzten, die restlichen 3 Phasen zählen von dort rückwärts.
// Saison N landet im Kalenderjahr TOURNAMENT_SEASON_1_YEAR + (N-1).
function buildSeasonTournamentSchedule(seasonNumber) {
  const year = TOURNAMENT_SEASON_1_YEAR + (seasonNumber - 1);
  return TOURNAMENT_EVENT_DEFS.map((def, i) => {
    const endMonth = TOURNAMENT_EVENT_END_MONTH[def.key];
    const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const monthEndDate = String(year) + '-' + String(endMonth).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    const totalSpanDays = TOURNAMENT_PHASE_KEYS.reduce((sum, k) => sum + def.phases[k], 0);
    let phaseCursor = addDaysToDateStr(monthEndDate, -(totalSpanDays - 1));
    const phaseDates = {};
    TOURNAMENT_PHASE_KEYS.forEach((phaseKey) => {
      const days = def.phases[phaseKey];
      const startDate = phaseCursor;
      const endDate = addDaysToDateStr(phaseCursor, days - 1);
      phaseDates[phaseKey] = { start: startDate, end: endDate };
      phaseCursor = addDaysToDateStr(endDate, 1);
    });
    const startDate = phaseDates.registration.start;
    const endDate = phaseDates.finals.end;
    return {
      key: def.key, seasonNumber, eventType: def.eventType, openIndex: def.openIndex, label: def.label,
      tierLabel: def.tierLabel, stars: def.stars, format: def.format, color: def.color, icon: def.icon,
      points: def.points, prize: tournamentEventPrize(def, seasonNumber),
      location: tournamentEventLocation(def, seasonNumber, i),
      startDate, endDate, phaseDates,
    };
  });
}

function currentSeasonTournamentSchedule() {
  return buildSeasonTournamentSchedule(careerState.seasonNumber || 1);
}

function tournamentStarsHtml(stars) {
  let html = '';
  for (let i = 0; i < 5; i++) html += '<span class="dashboard-tournament-star' + (i < stars ? ' is-filled' : '') + '">★</span>';
  return html;
}

// ── Open-Qualifier-Anmeldung, echte Regional-Brackets (Runde 45, ersetzt die
// Runde-44-Zufallslotterie komplett) ──────────────────────────────────────
// Kein Losverfahren mehr nötig: ein echter Open ist frei zugänglich ("jeder
// kann mitmachen"), es gibt kein festes Slot-Kontingent, das aufgefüllt
// werden müsste. Das Teilnehmerfeld eines Opens für die EIGENE Region ist
// deshalb schlicht "alle Orgas dieser Region" (automatisch, wie ein Bot-Team
// das immer mitspielt) + die eigene Org NUR wenn man sich für genau dieses
// eine Open angemeldet hat (jedes der 6 Opens hat sein eigenes 1-Tages-
// Anmeldefenster, siehe TOURNAMENT_EVENT_DEFS/TOURNAMENT_EVENT_START_MONTH).
// User-Vorgabe: "wenn es Open Quali gibt wo tausende mitmachen, dann sollen
// bei uns ALLE ORGAS da mitmachen, um eine solche große Zahl mäßig zu
// simulieren" -- mit jetzt mind. 32 Orgas pro Region (Runde 45) ist das
// strukturell erfüllt. Die Detailseite zeigt bewusst NUR die eigene Region
// (die anderen 6 sind für den Spieler nicht direkt relevant/spielbar).
// Runde 93, Bug-Fix (User-Vorgabe "das eigene Team soll man im Bracket sehen
// können, wenn man dabei ist"): eine per "Eigene Org gründen"
// (buildCustomOrgFromForm()) selbst erstellte Org wird NIE in die globale
// ORGANIZATIONS-Liste eingetragen (bewusst so, siehe dortiger Kopfkommentar --
// nur echte/generierte Orgas stehen dort). Vorher fehlte eine solche eigene
// Org dadurch komplett aus regionOrgs() -- selbst bei Anmeldung wurde sie nie
// wirklich Teil des Teilnehmerfelds, weil die Anmelde-Logik nur einen
// bestehenden Eintrag filtert/behält, aber nie einen fehlenden ergänzt. Jetzt
// wird die eigene Org hier per REFERENZ ergänzt, falls sie zur Region gehört
// und noch nicht enthalten ist (bei einer der 454 bestehenden Orgas als
// Startpunkt ist sie ohnehin schon in ORGANIZATIONS, dieser Zweig ist dann
// ein No-Op).
function regionOrgs(region) {
  const orgs = ORGANIZATIONS.filter((o) => orgRegion(o.country) === region);
  if (assignedOrg && orgRegion(assignedOrg.country) === region) {
    const collisionIndex = orgs.findIndex((o) => o.name === assignedOrg.name);
    // Runde 103, Härtung (User-Meldung "Kader ändert sich bei eigener Org"): submitOrgCreate()
    // verhindert eine Namenskollision mit einer bestehenden Org jetzt schon bei der Eingabe --
    // dieser Zweig ist nur noch für ALTE Spielstände relevant, die vor diesem Fix erstellt
    // wurden. Die eigene Org hat IMMER Vorrang: bei einer Kollision wird der gleichnamige
    // Bot-Eintrag ERSETZT (nicht wie vorher stillschweigend übersprungen), sonst würde an
    // dieser Namensposition weiterhin die Bot-Org (mit ihrem eigenen, andersartigen Kader)
    // verwendet.
    if (collisionIndex === -1) orgs.push(assignedOrg);
    else orgs[collisionIndex] = assignedOrg;
  }
  return orgs;
}

// ── Team-Chemie (Runde 119, User-Vorgabe "Kader-Seite" + "Physischer
// Zustand/Moral/Sprachliche Verständigung sollen echten Einfluss auf Spieler
// UND die simulierten Games haben") ────────────────────────────────────────
// Alle drei Werte sind REIN ABGELEITET aus bereits vorhandenen, echten Daten
// (matchHistory/Kader-Nationalitäten) -- kein neuer, eigenständig
// gespeicherter Zustand nötig, dadurch auch nichts, das aus dem Ruder
// laufen oder inkonsistent zum tatsächlichen Spielgeschehen werden könnte.
const TEAM_CONDITION_WINDOW_DAYS = 7;
const TEAM_CONDITION_COST_PER_MATCH = 6;
const TEAM_CONDITION_FLOOR = 40;
const TEAM_MORALE_RECENT_MATCHES = 10;
const TEAM_MORALE_BASE = 40; // bei 0% Siegquote
const TEAM_MORALE_WIN_RANGE = 60; // bei 100% Siegquote: 40+60 = 100
const TEAM_LANGUAGE_BASE = 30; // bei maximaler Nationalitäten-Streuung
const TEAM_LANGUAGE_HOMOGENEITY_RANGE = 70;
// Neutral-Baseline, um die ein Bonus/Malus entsteht -- 70% entspricht in
// allen drei Metriken ungefähr "durchschnittlich gesundes Team" (100%
// Kondition ohne kürzliche Spiele, ~50% Siegquote+Bonus, mittlere
// Nationalitäten-Streuung liegen alle grob in diesem Bereich).
const TEAM_CHEMISTRY_NEUTRAL_BASELINE = 70;
const TEAM_CHEMISTRY_BONUS_PER_POINT = 0.15; // -> max. rund -10.5%/+4.5%, ähnliche Größenordnung wie computeMatchBonusPct()

// Physischer Zustand: sinkt mit jedem Match der letzten TEAM_CONDITION_WINDOW_DAYS
// Tage (Ermüdung durch Spiellast), erholt sich von selbst, sobald eine Weile
// nicht gespielt wurde -- kein Timer/keine gespeicherte Erholungsrate nötig,
// da rein aus dem Datums-Fenster über matchHistory berechnet.
function computeTeamPhysicalCondition(org) {
  if (!careerDate) return 100;
  const cutoff = addDaysToDateStr(careerDate, -TEAM_CONDITION_WINDOW_DAYS);
  const recentCount = matchesForTeam(org.name).filter((m) => m.date >= cutoff && m.date <= careerDate).length;
  return Math.max(TEAM_CONDITION_FLOOR, 100 - recentCount * TEAM_CONDITION_COST_PER_MATCH);
}

// Moral: Siegquote der letzten TEAM_MORALE_RECENT_MATCHES Einzelspiele (nicht
// Serien) -- echte sportliche Form, kein Zufallswert. Ohne jede Historie
// (Saisonbeginn) neutral bei 70.
function computeTeamMorale(org) {
  const recent = matchesForTeam(org.name).slice(-TEAM_MORALE_RECENT_MATCHES);
  if (recent.length === 0) return TEAM_CHEMISTRY_NEUTRAL_BASELINE;
  const wins = recent.filter((m) => m.winner === org.name).length;
  return Math.round(TEAM_MORALE_BASE + (wins / recent.length) * TEAM_MORALE_WIN_RANGE);
}

// Sprachliche Verständigung: wie homogen die Nationalitäten im Hauptkader
// sind (Starter + Sub) -- ein Kader mit vielen Landsleuten kommuniziert
// realistischerweise besser als eine bunt zusammengewürfelte Truppe ohne
// gemeinsame Sprache. Nutzt echte player.country-Werte (dieselben, die auch
// überall sonst im Spiel für Flaggen/Nation verwendet werden) als Näherung
// für "gemeinsame Sprache" -- eine echte Sprachfamilien-Zuordnung (z.B.
// "Skandinavisch" als Gruppe) gibt es im Spiel nicht, disclosed
// Vereinfachung, aber kein erfundener Wert: exakte Nationalität ist real.
function computeTeamLanguageUnderstanding(org) {
  const roster = [...((org.roster && org.roster.starters) || []), org.roster && org.roster.sub].filter(Boolean);
  if (roster.length === 0) return TEAM_CHEMISTRY_NEUTRAL_BASELINE;
  const counts = {};
  roster.forEach((p) => { counts[p.country] = (counts[p.country] || 0) + 1; });
  const maxSameCountry = Math.max(...Object.values(counts));
  const homogeneity = maxSameCountry / roster.length;
  return Math.round(TEAM_LANGUAGE_BASE + homogeneity * TEAM_LANGUAGE_HOMOGENEITY_RANGE);
}

// Fasst alle 3 Werte zu EINEM Match-Bonus/-Malus zusammen (Prozentpunkte,
// dieselbe Einheit wie computeMatchBonusPct()/orgMatchBonusPct in match.js) --
// wird nur für die eigene, gedraftete Org tatsächlich in die Simulation
// eingespeist (siehe simulateBotSeries() unten), nicht für Bot-vs-Bot (bleibt
// bewusst unangetastet/fair, exakt wie schon beim bestehenden Coach-Bonus-
// Mechanismus in match.js).
function teamChemistryBonusPct(org) {
  const condition = computeTeamPhysicalCondition(org);
  const morale = computeTeamMorale(org);
  const language = computeTeamLanguageUnderstanding(org);
  const avg = (condition + morale + language) / 3;
  return (avg - TEAM_CHEMISTRY_NEUTRAL_BASELINE) * TEAM_CHEMISTRY_BONUS_PER_POINT;
}

// ── Bot-vs-Bot-Simulations-Engine (Runde 81, User-Vorgabe "Option A") ─────
// Löst eine komplette Best-of-Serie zwischen zwei Orgas OHNE Live-Ticker auf
// -- für die spätere automatische Hintergrund-Auflösung der neuen Dashboard-
// Turnier-Brackets (Swiss/Gruppenphase/Playoffs etc.). Nutzt bewusst die
// bestehende, bereits geprüfte match.js-Engine (simulateMatch(), echte
// Spieler-Statachsen + Gaussian-Varianz über resolveDuel()) wieder, statt
// eine neue, gröbere Rating-vs-Rating-Formel zu erfinden: org.roster.starters
// (siehe data/org-rosters.js) ist bereits exakt das 3-Spieler-Array-Format,
// das simulateMatch() erwartet. Die "Team-Stärkewerte" fließen damit über die
// 6 echten Statachsen (Mechanics/GameSense/Speed/Shooting/Defending/
// BoostMgmt) der Datenbank ein -- granularer als ein einzelner Team-Rating-
// Wert, im Kern aber genau der User-Vorgabe entsprechend ("Stärke +
// Zufallsvarianz -> realistisches Ergebnis"). myOptions bleibt für Bot-vs-Bot
// weiterhin leer ({}) -- kein Coach-/Sub-/Org-Bonus, symmetrisch zwischen
// zwei Bot-Orgs. NUR wenn die eigene, gedraftete Org beteiligt ist (Runde
// 119), fließt ihr teamChemistryBonusPct() ein -- korrekt auf die jeweils
// richtige Seite (A ODER B, siehe ownIsA), da match.js seit dieser Runde
// beide Seiten symmetrisch unterstützt (orgMatchBonusPct/-PctB).
// Serien-Logik (Ziel-Siegzahl, Abbruch sobald eine Seite sie erreicht) ist
// eine EIGENSTÄNDIGE, schlanke Kopie des Musters aus dem älteren tournament.js
// (createSeriesMatch()/simulateFullSeriesInstant()) -- bewusst NICHT an
// dessen createTournamentTeam()-Objekte gekoppelt, um das alte, separate
// Turniersystem laut Projekt-Konvention unangetastet zu lassen.
function simulateBotSeries(orgA, orgB, bestOf) {
  const targetWins = Math.ceil(bestOf / 2);
  const isOwnMatch = !!(assignedOrg && (orgA.name === assignedOrg.name || orgB.name === assignedOrg.name));
  const ownIsA = isOwnMatch && orgA.name === assignedOrg.name;
  // Bug-Fix (Runde 97, per Live-Test gefunden): eine Org mit unvollständigem
  // Kader (z.B. eine frisch per "Eigene Org gründen" erstellte Org OHNE
  // Free-Agent-Auffüllung -- roster.starters bleibt dann leer, bis der
  // Spieler über den Transfermarkt echte Spieler holt) ließ simulateMatch()
  // auf einem leeren Array zugreifen -- duelStat(undefined) stürzte mit
  // "Cannot read properties of undefined (reading 'mechanics')" ab und
  // blockierte JEDE weitere Turnier-Auflösung (Save-Datei dadurch quasi
  // unspielbar, jeder erneute Ladeversuch crashte am selben Punkt). Eine Org
  // ohne vollständiges 3er-Starter-Aufgebot kann real nicht antreten --
  // automatisches kampfloses Forfeit statt Absturz.
  const aReady = !!(orgA.roster && orgA.roster.starters && orgA.roster.starters.length >= 3);
  const bReady = !!(orgB.roster && orgB.roster.starters && orgB.roster.starters.length >= 3);
  if (!aReady || !bReady) {
    // Sind BEIDE unvollständig (seltener Randfall, z.B. zwei frische Custom-
    // Orgas gegeneinander), entscheidet ein Münzwurf, da keine Seite wirklich
    // antreten könnte.
    const aWonSeries = aReady ? true : bReady ? false : Math.random() < 0.5;
    const forfeitMsg = (aWonSeries ? orgB.name : orgA.name) + ' tritt mit unvollständigem Kader nicht an -- kampflose Niederlage.';
    const games = [];
    for (let i = 0; i < targetWins; i++) {
      games.push(isOwnMatch
        ? { scoreA: aWonSeries ? 1 : 0, scoreB: aWonSeries ? 0 : 1, events: [{ time: '0:00', stepSeconds: 1, type: 'final', isFinal: true, team: null, player: null, msg: forfeitMsg }] }
        : { scoreA: aWonSeries ? 1 : 0, scoreB: aWonSeries ? 0 : 1 });
    }
    return {
      winner: aWonSeries ? orgA : orgB, loser: aWonSeries ? orgB : orgA,
      winsA: aWonSeries ? targetWins : 0, winsB: aWonSeries ? 0 : targetWins,
      games, isOwnMatch, ownIsA,
    };
  }
  let winsA = 0;
  let winsB = 0;
  const games = [];
  // Runde 119, User-Vorgabe: physischer Zustand/Moral/sprachliche
  // Verständigung sollen "richtigen Einfluss ... auf die simulierten Games"
  // haben -- teamChemistryBonusPct(assignedOrg) wird EINMAL pro Serie (nicht
  // pro Spiel, da sich die Chemie innerhalb einer Serie nicht ändert)
  // berechnet und als orgMatchBonusPct/orgMatchBonusPctB an match.js
  // übergeben (match.js unterstützt seit diesem Runde beide Seiten
  // symmetrisch). Nur für die EIGENE Serie -- Bot-vs-Bot bleibt unverändert
  // ({} wie bisher), da Chemie-Werte für alle 454 Orgs live zu berechnen
  // unnötigen Overhead ohne spielrelevanten Nutzen wäre (der Spieler sieht
  // diese Spiele nie).
  let ownMyOptions = {};
  if (isOwnMatch) {
    const chemistryBonusPct = teamChemistryBonusPct(assignedOrg);
    ownMyOptions = ownIsA ? { orgMatchBonusPct: chemistryBonusPct } : { orgMatchBonusPctB: chemistryBonusPct };
  }
  // Runde 95, User-Vorgabe ("eigenes Match live ansehen, mit Ticker/Timer/
  // Overtime"): die vollen Ticker-Events (simulateMatch()s r.events) werden
  // NUR für Serien der eigenen Org mitgespeichert -- für die tausenden Bot-
  // vs-Bot-Spiele pro Saison wäre das reiner Speicher-/Spielstand-Ballast
  // ohne Nutzen (werden nie live angesehen). Ändert NICHTS an Sieger-/Score-
  // Berechnung -- rein additiv, kein Regressionsrisiko für die bereits
  // verifizierte Bracket-Logik.
  while (winsA < targetWins && winsB < targetWins) {
    const r = simulateMatch(orgA.roster.starters, orgB.roster.starters, orgA.name, orgB.name, ownMyOptions);
    if (r.scoreA > r.scoreB) winsA++; else winsB++;
    games.push(isOwnMatch ? { scoreA: r.scoreA, scoreB: r.scoreB, events: r.events } : { scoreA: r.scoreA, scoreB: r.scoreB });
    // Runde 113, User-Vorgabe: Spieler entwickeln sich aus den ECHTEN
    // Ticker-Ereignissen dieses Spiels weiter (siehe applyPlayerDevelopmentForGame()-
    // Kommentar) -- läuft für JEDES Spiel, nicht nur eigene, rein additiv (nutzt
    // `r.events`, BEVOR sie für Bot-vs-Bot-Spiele gleich wieder verworfen werden).
    applyPlayerDevelopmentForGame(orgA, orgB, r);
  }
  const aWonSeries = winsA === targetWins;
  // `ownIsA`: welche Seite (A/B) die eigene Org ist -- die Ticker-Events in
  // `games[].events` taggen Aktionen mit `team:'A'/'B'` relativ zur
  // simulateMatch()-Aufrufreihenfolge (orgA/orgB), das muss beim späteren
  // Live-Abspielen (playOwnMatchSeriesLive()) bekannt sein, um Roster-Kacheln
  // und Text richtig zuzuordnen.
  return { winner: aWonSeries ? orgA : orgB, loser: aWonSeries ? orgB : orgA, winsA, winsB, games, isOwnMatch, ownIsA };
}

// ── Punkte-Verrechnung / Saison-Leaderboard (Runde 82, User-Vorgabe "Option
// B") ─────────────────────────────────────────────────────────────────────
// Reine Buchhaltungslogik: liest einen fertigen Turnier-Endstand (Platz je
// Org), schlägt die passende Punktzahl in OPEN_POINTS_TABLE/MAJOR_POINTS_TABLE
// (data/tournament-calendar.js) nach und addiert sie auf ein laufendes, pro
// Saison zurückgesetztes Punkte-Konto je Org (seasonPoints). WOHER die
// `placements` kommen (eine echte Bracket-Auflösung mit Swiss-Paarung +
// Runden-Fortschritt) ist bewusst NICHT Teil dieser Funktion -- das braucht
// noch die Swiss-Paarungs-Logik und das Live-Wiring der Brackets (beides
// eigene, noch offene Baustellen, siehe rlcs-legends-project.md Runde 81/82).
// Worlds/LCQ haben KEINE eigene Punkte-Tabelle (Worlds ist das Saisonfinale,
// LCQ bestimmt nur, WER zur WM fährt, siehe data/tournament-calendar.js) --
// `pointsTableForEvent()` deckt deshalb bewusst nur 'open' (inkl. open0) und
// 'major' ab.
function pointsTableForEvent(event) {
  // Runde 92: open0 (Open Qualifier) ist reines Saison-Zugangstor
  // (isSeasonGate, siehe TOURNAMENT_EVENT_DEFS) -- er kürt keinen Sieger und
  // vergibt daher auch keine Saison-Punkte, siehe resolveOpenQualifierEvent().
  if (event.eventType === 'open' && event.key !== 'open0') return OPEN_POINTS_TABLE;
  if (event.eventType === 'major') return MAJOR_POINTS_TABLE;
  return null; // 'worlds'/'lcq'/open0 -- bewusst KEIN Fallback auf OPEN_POINTS_TABLE, siehe Kommentar oben
}

// `table`: OPEN_POINTS_TABLE oder MAJOR_POINTS_TABLE. `place`: 1-basierter
// Endplatz (1 = Turniersieger). `maxPlace: null` bedeutet "und schlechter"
// (siehe die 17+-Zeile in OPEN_POINTS_TABLE).
function pointsForPlacement(table, place) {
  const tier = table.find((t) => place >= t.minPlace && (t.maxPlace === null || place <= t.maxPlace));
  return tier ? tier.points : 0;
}

// placements: Array von { orgName, place }. Addiert die jeweils fällige
// Punktzahl auf das laufende Saison-Konto jeder Org.
function awardTournamentPoints(event, placements) {
  const table = pointsTableForEvent(event);
  if (!table) return; // Worlds/LCQ speisen das Saison-Leaderboard nicht, siehe pointsTableForEvent()
  placements.forEach(({ orgName, place }) => {
    seasonPoints[orgName] = (seasonPoints[orgName] || 0) + pointsForPlacement(table, place);
  });
  saveGameState();
}

// Laufende Saison-Rangliste einer Region, absteigend nach Punkten sortiert --
// Grundlage für Major-Slot-/LCQ-/WM-Direktqualifikations-Cutoffs
// (MAJOR_REGION_SLOTS/LCQ_ELIGIBILITY_BANDS).
// Runde 105, Bug-Fix (User-Meldung: "Season-Skip bringt mich nicht bis
// Dezember, bleibt vorher stehen" -- per Node-Sandbox-Simulation der
// KOMPLETTEN Saison nachgestellt und bestätigt): lieferte bisher ALLE Orgas
// der Region (regionOrgs(region), 64+), UNABHÄNGIG davon, ob sie den Open
// Qualifier (open0) überhaupt überlebt haben. Wer nicht qualifiziert ist,
// hat 0 Saison-Punkte (kann ja nie an Open 1-6 teilnehmen) -- stand also
// einfach mit ALLEN anderen nicht-qualifizierten Orgas gleichauf ganz unten
// in der "Rangliste". LCQ zieht seinen K.o.-Pool aber aus GENAU diesem
// unteren Rest (`ranked.slice(band.lcqRangeEnd)`, siehe resolveLcqEvent())
// -- eine disqualifizierte Org (Spieler ODER Bot) konnte dadurch trotzdem in
// den LCQ-K.o.-Pool rutschen und dort ein ECHTES Match bekommen, obwohl sie
// laut isPlayerDisqualifiedForSeason() (und der Turnier-Struktur insgesamt:
// nur der Open Qualifier ist das Zugangstor zur GESAMTEN übrigen Saison,
// nicht nur zu Open 1-6) für den Rest der Saison komplett raus sein sollte.
// Genau DAS ließ den Season-Skip an einem echten pendingOwnMatch im Oktober
// abbrechen, lange vor dem Transferfenster im Dezember. Fix: nur noch Orgas,
// die tatsächlich in seasonQualifiedTeams[region] stehen, zählen überhaupt
// zur Rangliste -- betrifft Major-Slots/LCQ-Ranking/WM-Direktqualifikation
// gleichermaßen (alle nutzen diese eine Funktion).
function seasonLeaderboardForRegion(region) {
  const qualifiedNames = seasonQualifiedTeams[region] || [];
  return regionOrgs(region)
    .filter((org) => qualifiedNames.includes(org.name))
    .map((org) => ({ orgName: org.name, points: seasonPoints[org.name] || 0 }))
    .sort((a, b) => b.points - a.points);
}

// ── Round-Robin- & Swiss-Paarungsalgorithmus (Runde 82, User-Vorgabe "Option
// C") ─────────────────────────────────────────────────────────────────────
// Der "Matchmaker" für die verbliebenen Round-Robin-Gruppen (Major/Worlds,
// seit Runde 80) und Swiss-Stages (Open/LCQ) -- nimmt eine bereits
// zusammengestellte Team-Liste entgegen (WOHER die Teilnehmer/ihre Seed-
// Reihenfolge kommen -- Regionsfeld, Qualifikationspunkte etc. -- ist
// bewusst nicht Teil dieser Funktionen, siehe simulateBotSeries()/
// awardTournamentPoints() für dieselbe Abgrenzung) und erzeugt daraus
// faire Paarungen + simulierte Ergebnisse (über simulateBotSeries()).

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Snake-Draft-Seeding (Standard-Turnier-Praxis): Seed 1..N -> Gruppe 0..k-1,
// dann rückwärts k-1..0, dann wieder vorwärts usw. -- verhindert, dass alle
// Top-Seeds in derselben Gruppe landen. `orderedTeams` muss bereits nach
// Seed sortiert sein (bestes Team zuerst); WIE diese Reihenfolge zustande
// kommt (Saison-Punkte, Org-Stärke, ...) entscheidet der Aufrufer.
function seedIntoRoundRobinGroups(orderedTeams, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  let dir = 1;
  let g = 0;
  orderedTeams.forEach((team) => {
    groups[g].push(team);
    g += dir;
    if (g === groupCount) { g = groupCount - 1; dir = -1; }
    else if (g === -1) { g = 0; dir = 1; }
  });
  return groups;
}

// Alle Paarungen einer Gruppe (jeder gegen jeden, genau einmal).
function roundRobinPairs(teams) {
  const pairs = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);
  }
  return pairs;
}

// Simuliert eine komplette Round-Robin-Gruppe (Major/Worlds-Gruppenphase,
// 4 Teams). Tabellenplatz: Siege zuerst, bei Gleichstand Spiele-Differenz
// (Head-to-Head-Tiebreak wird bewusst nicht nachgebildet -- disclosed
// vereinfacht, echtes RLCS nutzt zusätzliche Tiebreak-Regeln).
function simulateRoundRobinGroup(teams, bestOf) {
  const record = {};
  teams.forEach((t) => { record[t.name] = { wins: 0, losses: 0, gameWins: 0, gameLosses: 0 }; });
  const results = [];
  // Runde 86: `slot` = 'm-' + Index, deckt sich exakt mit
  // tournamentRoundRobinGroupHtml()s Match-Karten-IDs (instanceId + '-m-' + i),
  // da roundRobinPairs() hier wie dort in derselben deterministischen
  // Reihenfolge durchlaufen wird.
  roundRobinPairs(teams).forEach(([a, b], i) => {
    const r = simulateBotSeries(a, b, bestOf);
    record[r.winner.name].wins++;
    record[r.loser.name].losses++;
    record[a.name].gameWins += r.winsA; record[a.name].gameLosses += r.winsB;
    record[b.name].gameWins += r.winsB; record[b.name].gameLosses += r.winsA;
    results.push({ slot: 'm-' + i, a: a.name, b: b.name, winner: r.winner.name, winsA: r.winsA, winsB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
  });
  const standings = teams
    .map((t) => ({ orgName: t.name, ...record[t.name] }))
    .sort((x, y) => (y.wins - y.losses) - (x.wins - x.losses) || (y.gameWins - y.gameLosses) - (x.gameWins - x.gameLosses));
  // Runde 99: `standings` ist nach Ergebnis SORTIERT -- für den neuen
  // Auslosungstag (fillRoundRobinAssignmentOnly()) braucht es aber die
  // Gruppen-ZUTEILUNG in der URSPRÜNGLICHEN (unsortierten) Reihenfolge, sonst
  // würde die Sortierung selbst schon das Ergebnis verraten, bevor auch nur
  // ein Spiel enthüllt ist.
  const teamNames = teams.map((t) => t.name);
  return { standings, results, teamNames };
}

// Backtracking-Matching innerhalb EINES Record-Buckets (z.B. alle aktuell
// 1-1 stehenden Teams): findet eine vollständige 1:1-Paarung, bei der kein
// Paar zum wiederholten Mal aufeinandertrifft (`played[name]` = Set bereits
// gespielter Gegner-Namen, über die GESAMTE Swiss-Stage hinweg geführt --
// User-Vorgabe: "niemals zweimal gegeneinander, danach in Swiss gar nicht
// mehr"). Zufällige Ausgangsreihenfolge, damit nicht immer dieselben
// Paarungen entstehen. Gibt `null` zurück, wenn selbst durch Backtracking
// keine gültige Paarung existiert (bei den hier genutzten Bucket-Größen
// -- siehe computeSwissLadderColumns(), nie kleiner als 4 -- praktisch
// ausgeschlossen, aber sauber behandelt statt stillschweigend zu crashen).
function pairWithoutRepeats(bucketTeams, played) {
  function backtrack(remaining) {
    if (remaining.length === 0) return [];
    const [first, ...rest] = remaining;
    for (let i = 0; i < rest.length; i++) {
      const opponent = rest[i];
      if (played[first.name].has(opponent.name)) continue;
      const restWithoutOpponent = rest.slice(0, i).concat(rest.slice(i + 1));
      const subPairing = backtrack(restWithoutOpponent);
      if (subPairing !== null) return [[first, opponent], ...subPairing];
    }
    return null;
  }
  return backtrack(shuffleArray(bucketTeams));
}

// Simuliert eine komplette Swiss-Stage (Open/LCQ: 16 Teams, 3 Siege/3
// Niederlagen-Schwelle, Bo5) für EINE Gruppe. Rundenlogik folgt exakt
// computeSwissLadderColumns()' Bucket-Struktur (pro Runde nach aktuellem
// Record bündeln, nur innerhalb des Buckets paaren), ohne diese Funktion
// selbst zu importieren -- die Bucket-Bildung ergibt sich hier automatisch
// aus den tatsächlich simulierten Ergebnissen statt aus der rein
// arithmetischen Vorhersage.
function simulateSwissStage(teams, winThreshold, lossThreshold, bestOf, historySet) {
  const record = {};
  const played = {};
  const hadBye = new Set();
  teams.forEach((t) => {
    record[t.name] = { wins: 0, losses: 0 };
    played[t.name] = new Set();
  });
  // Runde 103, User-Vorgabe ("wenn Team A gegen Team B schon gespielt hat,
  // sollen sie sich so lange wie nur mathematisch möglich nicht nochmal
  // treffen -- gilt für jedes Turnier"): eine optionale, schon VOR dieser
  // Stage bestehende Historie (z.B. Worlds Play-In-Gegner, siehe
  // resolveWorldsEvent()) wird hier in dieselbe `played`-Tracking-Struktur
  // vorgeladen, die pairWithoutRepeats() ohnehin schon für Wiederholungen
  // INNERHALB der Swiss-Stage nutzt -- dadurch vermeidet die Rundenpaarung
  // automatisch auch Gegner von VOR der Stage, ganz ohne separate
  // Sonderlogik. Ohne `historySet` (die meisten Aufrufer, siehe
  // resolveOpenEvent()/resolveLcqEvent()) unverändertes Verhalten.
  if (historySet) {
    teams.forEach((t) => {
      teams.forEach((other) => {
        if (t !== other && havePlayedBefore(historySet, t.name, other.name)) played[t.name].add(other.name);
      });
    });
  }
  const log = [];
  // Runde 86: `qualifiedSlots`/`eliminatedSlots` taggen jeden Übertritt in
  // "Qualifiziert"/"Eliminiert" mit `day`+`row` -- exakt das Schema, das
  // tournamentSwissLadderHtml()s Endcap-Zeilen-IDs verwenden
  // (qualifiedId(day)/eliminatedId(day) + '-m' + row). `log`-Einträge
  // bekommen zusätzlich `colKey`+`row`, passend zu den regulären
  // Tages-Spalten-Zeilen-IDs (colId(w,l) + '-m' + row).
  const qualifiedSlots = [];
  const eliminatedSlots = [];
  const qualifiedRowCounters = {};
  const eliminatedRowCounters = {};
  function nextRow(counters, day) {
    const i = counters[day] || 0;
    counters[day] = i + 1;
    return i;
  }
  let round = 0;
  let repeatFallbackUsed = false;

  const isAlive = (t) => record[t.name].wins < winThreshold && record[t.name].losses < lossThreshold;

  while (teams.some(isAlive)) {
    round++;
    const buckets = {};
    teams.filter(isAlive).forEach((t) => {
      const key = record[t.name].wins + ',' + record[t.name].losses;
      (buckets[key] = buckets[key] || []).push(t);
    });
    Object.entries(buckets).forEach(([colKey, bucketTeams]) => {
      let rowInCol = 0;
      // Runde 85, User-Vorgabe (LCQ mit realistischer, nicht zweierpotenz-
      // großer Region-Feldgröße statt exakt 32/16/8): bei ungerader Bucket-
      // Größe bekommt EIN Team ein Freilos (automatischer Sieg ohne Spiel,
      // Standard-Praxis bei echten Swiss-Systemen mit unrunden
      // Teilnehmerzahlen) -- bevorzugt ein Team, das noch kein Freilos in
      // dieser Stage hatte, damit es sich fair verteilt.
      let toPair = bucketTeams;
      if (bucketTeams.length % 2 === 1) {
        const candidates = bucketTeams.filter((t) => !hadBye.has(t.name));
        const pool = candidates.length ? candidates : bucketTeams;
        const byeTeam = pool[Math.floor(Math.random() * pool.length)];
        hadBye.add(byeTeam.name);
        record[byeTeam.name].wins++;
        log.push({ round, colKey, row: rowInCol++, a: byeTeam.name, b: null, winner: byeTeam.name, bye: true });
        if (record[byeTeam.name].wins === winThreshold) {
          qualifiedSlots.push({ day: round + 1, row: nextRow(qualifiedRowCounters, round + 1), teamName: byeTeam.name });
        }
        toPair = bucketTeams.filter((t) => t !== byeTeam);
      }
      let pairing = pairWithoutRepeats(toPair, played);
      if (!pairing) {
        // Extremer Ausnahmefall (siehe Kommentar oben): keine wiederholungs-
        // freie Paarung möglich -- letzter Ausweg, EINE Wiederholung zulassen,
        // statt die gesamte Simulation abstürzen zu lassen.
        repeatFallbackUsed = true;
        const shuffled = shuffleArray(toPair);
        pairing = shuffled.map((t, i) => (i % 2 === 0 ? [t, shuffled[i + 1]] : null)).filter(Boolean);
      }
      pairing.forEach(([a, b]) => {
        const r = simulateBotSeries(a, b, bestOf);
        played[a.name].add(b.name);
        played[b.name].add(a.name);
        record[r.winner.name].wins++;
        record[r.loser.name].losses++;
        log.push({ round, colKey, row: rowInCol++, a: a.name, b: b.name, winner: r.winner.name, winsA: r.winsA, winsB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
        if (record[r.winner.name].wins === winThreshold) {
          qualifiedSlots.push({ day: round + 1, row: nextRow(qualifiedRowCounters, round + 1), teamName: r.winner.name });
        }
        if (record[r.loser.name].losses === lossThreshold) {
          eliminatedSlots.push({ day: round + 1, row: nextRow(eliminatedRowCounters, round + 1), teamName: r.loser.name });
        }
      });
    });
  }

  const qualified = teams
    .filter((t) => record[t.name].wins === winThreshold)
    .sort((a, b) => record[a.name].losses - record[b.name].losses); // 3-0 vor 3-1 vor 3-2
  const eliminated = teams
    .filter((t) => record[t.name].losses === lossThreshold)
    .sort((a, b) => record[b.name].wins - record[a.name].wins); // 2-3 vor 1-3 vor 0-3

  // `team` = die originale Org-Referenz (nicht nur der Name) -- damit ein
  // Aufrufer die qualifizierten Teams direkt in die nächste Turnierstufe
  // weiterreichen kann (siehe resolveOpenEvent() weiter unten), ohne sie
  // erst wieder per Name nachschlagen zu müssen.
  return {
    qualified: qualified.map((t) => ({ team: t, orgName: t.name, wins: record[t.name].wins, losses: record[t.name].losses })),
    eliminated: eliminated.map((t) => ({ team: t, orgName: t.name, wins: record[t.name].wins, losses: record[t.name].losses })),
    rounds: round,
    log,
    qualifiedSlots,
    eliminatedSlots,
    repeatFallbackUsed,
  };
}

// ── Zusammenführung A+B+C: vollständige Turnier-Auflösung (Runde 84, User-
// Vorgabe "führe alles jetzt zusammen") ───────────────────────────────────
// Reine Logik-Ebene, UNABHÄNGIG von den bestehenden HTML/SVG-Bracket-Baumaufbau-
// Funktionen (buildStandard8DoubleElim()/buildAflBracket() usw.) -- diese
// bleiben unangetastet (dort steckt viel fein abgestimmter visueller Code,
// siehe die ~15 Runden Verbindungslinien-Feinschliff). Die Funktionen hier
// bilden dieselbe TURNIERSTRUKTUR rein index-/objektbasiert nach (kein DOM,
// keine IDs), damit simulateBotSeries()-Ergebnisse tatsächlich echte
// Platzierungen erzeugen können. Das Verbinden dieser Platzierungen mit den
// "TBD"-Karten in der Turnier-Detailseite (echte Namen/Ergebnisse anzeigen)
// UND das automatische Auslösen beim Kalender-Tagfortschritt sind bewusst
// NICHT Teil dieser Runde -- eigene, separate nächste Schritte (siehe
// rlcs-legends-project.md).

// Bildet buildStandard8DoubleElim()s GSL-Struktur nach (8 Teams, Index-
// Reihenfolge bestimmt die Paarung: 0v1/2v3/4v5/6v7 im Oberen Viertelfinale).
// Oberes-Viertelfinale-VERLIERER spielen im Unteren Bracket weiter (siehe
// Kommentar bei buildStandard8DoubleElim(), Runde 76: die visuellen
// Verbindungslinien dorthin wurden entfernt, die LOGISCHE Bedeutung -- GSL,
// Verlierer bekommen eine zweite Chance -- blieb unverändert bestehen).
// `historySet` (Runde 105, optional): bereits gespielte Begegnungen aus
// FRÜHEREN Stages desselben Turniers (z.B. Swiss-Historie vor der
// Gruppenphase) -- wird (a) für die UBQF-Startpaarung genutzt (Runde 105,
// Bug-Fix: bisher wurde nur die GRUPPEN-ZUTEILUNG selbst gegen die Historie
// geprüft, siehe resolveOpenEvent()s reduceRematchCollisions() vor dem
// Aufruf dieser Funktion -- NICHT aber die Reihenfolge INNERHALB der Gruppe,
// die die feste `teams[0]`-vs-`teams[1]`-Paarung bestimmt; ein Team konnte
// dadurch trotz "richtiger" Gruppenzuteilung direkt im ersten Match wieder
// auf einen Swiss-Gegner treffen) und (b) zusammen mit den INNERHALB dieser
// Funktion neu entstehenden Ergebnissen für die LBSF-Paarung (die einzige
// Stelle in diesem Bracket mit echter Wahlfreiheit, siehe
// pairAvoidingRematch()) genutzt.
function simulateStandard8Group(teams, bestOf, historySet) {
  // Runde 86, User-Vorgabe ("Bracket-Befüllung"): `matches`/`slots` taggen
  // jedes Einzelergebnis mit demselben Slot-Key, den buildStandard8DoubleElim()
  // für die DOM-IDs verwendet (mkId(roundKey, i) = treeId + '-' + roundKey +
  // '-' + i) -- eine spätere Fülle-Funktion kann so 1:1 per
  // getElementById(treeId + '-' + slot) das richtige Karten-Element finden,
  // ohne dass diese Funktion selbst etwas über HTML/DOM wissen muss.
  const matches = [];
  const localHistory = new Set(historySet || []);
  const orderedTeams = historySet ? reduceRound1RematchCollisions(teams, localHistory) : teams;
  function playMatch(slot, teamA, teamB) {
    const r = simulateBotSeries(teamA, teamB, bestOf);
    matches.push({ slot, teamAName: teamA.name, teamBName: teamB.name, scoreA: r.winsA, scoreB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
    localHistory.add([teamA.name, teamB.name].sort().join('|'));
    return r;
  }
  const ubqf = [
    playMatch('ubqf-0', orderedTeams[0], orderedTeams[1]),
    playMatch('ubqf-1', orderedTeams[2], orderedTeams[3]),
    playMatch('ubqf-2', orderedTeams[4], orderedTeams[5]),
    playMatch('ubqf-3', orderedTeams[6], orderedTeams[7]),
  ];
  const ubsf = [
    playMatch('ubsf-0', ubqf[0].winner, ubqf[1].winner),
    playMatch('ubsf-1', ubqf[2].winner, ubqf[3].winner),
  ];
  const lbqf = [
    playMatch('lbqf-0', ubqf[0].loser, ubqf[1].loser),
    playMatch('lbqf-1', ubqf[2].loser, ubqf[3].loser),
  ];
  // Runde 105: LBSF ist die einzige Stelle in diesem Bracket mit echter
  // Wahlfreiheit (beide Unteres-Bracket-Gewinner könnten strukturell auf
  // JEDEN der beiden Oberes-Bracket-Halbfinale-Verlierer treffen) -- hier
  // wird die rematch-ärmere von beiden möglichen Zuordnungen gewählt.
  const lbsfOpponents = pairAvoidingRematch(
    [lbqf[0].winner, lbqf[1].winner],
    [ubsf[0].loser, ubsf[1].loser],
    localHistory
  );
  const lbsf = [
    playMatch('lbsf-0', lbqf[0].winner, lbsfOpponents[0]),
    playMatch('lbsf-1', lbqf[1].winner, lbsfOpponents[1]),
  ];
  const slots = [
    { slot: 'ubq-0', teamName: ubsf[0].winner.name },
    { slot: 'ubq-1', teamName: ubsf[1].winner.name },
    { slot: 'lbq-0', teamName: lbsf[0].winner.name },
    { slot: 'lbq-1', teamName: lbsf[1].winner.name },
  ];
  return {
    qualified: [ubsf[0].winner, ubsf[1].winner, lbsf[0].winner, lbsf[1].winner], // -> Playoffs
    eliminated: [lbqf[0].loser, lbqf[1].loser, lbsf[0].loser, lbsf[1].loser], // 5.-8. Platz (GSL raus)
    matches, slots,
  };
}

// Bildet buildAflBracket()s "AFL Final Eight"-Struktur nach. `upperTeams` ist
// IMMER 4 Teams/2 Spiele (unabhängig von afl8/afl12 -- ubR1 hat laut
// buildAflBracket() immer count:2, siehe dortiger Kopfkommentar). Nur das
// Untere Bracket unterscheidet sich in der Größe: `lowerTeams` 4 Teams/2
// Spiele bei afl8, 8 Teams/4 Spiele (+ eine zusätzliche lbR2-Reduktionsrunde)
// bei afl12.
// `historySet` (Runde 105, optional): siehe simulateStandard8Group() --
// dasselbe Prinzip, hier an den QF- (Ober-Verlierer x Unter-Gewinner) und
// SF-Paarungen (Ober-Gewinner x QF-Gewinner) angewendet, den einzigen beiden
// Stellen in diesem Bracket mit echter Wahlfreiheit.
function simulateAflBracket(upperTeams, lowerTeams, bestOf, historySet) {
  // Runde 86: `matches` taggt jedes Einzelergebnis mit demselben Slot-Key,
  // den buildAflBracket() für die DOM-IDs verwendet (mkId(roundKey, i) =
  // treeId + '-' + roundKey + '-' + i) -- siehe simulateStandard8Group()
  // für dasselbe Muster.
  const matches = [];
  const localHistory = new Set(historySet || []);
  function playMatch(slot, teamA, teamB) {
    const r = simulateBotSeries(teamA, teamB, bestOf);
    matches.push({ slot, teamAName: teamA.name, teamBName: teamB.name, scoreA: r.winsA, scoreB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
    localHistory.add([teamA.name, teamB.name].sort().join('|'));
    return r;
  }

  const ubR1 = [playMatch('ubr1-0', upperTeams[0], upperTeams[1]), playMatch('ubr1-1', upperTeams[2], upperTeams[3])];

  let lbWinners;
  const otherLosers = []; // alle Verlierer unterhalb des Halbfinales (Viertelfinale + jede Unteres-Bracket-Runde)
  if (lowerTeams.length === 4) { // afl8: eine einzige Unteres-Bracket-Runde
    const lbR1 = [playMatch('lbr1-0', lowerTeams[0], lowerTeams[1]), playMatch('lbr1-1', lowerTeams[2], lowerTeams[3])];
    otherLosers.push(lbR1[0].loser, lbR1[1].loser);
    lbWinners = [lbR1[0].winner, lbR1[1].winner];
  } else { // afl12: 8 Unterbracket-Startplätze, 2 Runden bis auf 2 Team reduziert
    const lbR1 = [
      playMatch('lbr1-0', lowerTeams[0], lowerTeams[1]), playMatch('lbr1-1', lowerTeams[2], lowerTeams[3]),
      playMatch('lbr1-2', lowerTeams[4], lowerTeams[5]), playMatch('lbr1-3', lowerTeams[6], lowerTeams[7]),
    ];
    otherLosers.push(lbR1[0].loser, lbR1[1].loser, lbR1[2].loser, lbR1[3].loser);
    const lbR2 = [playMatch('lbr2-0', lbR1[0].winner, lbR1[1].winner), playMatch('lbr2-1', lbR1[2].winner, lbR1[3].winner)];
    otherLosers.push(lbR2[0].loser, lbR2[1].loser);
    lbWinners = [lbR2[0].winner, lbR2[1].winner];
  }

  // Runde 105: QF-Paarung (Ober-Verlierer x Unter-Gewinner) rematch-ärmer wählen.
  const qfOpponents = pairAvoidingRematch([ubR1[0].loser, ubR1[1].loser], lbWinners, localHistory);
  const qf = [playMatch('qf-0', ubR1[0].loser, qfOpponents[0]), playMatch('qf-1', ubR1[1].loser, qfOpponents[1])];
  otherLosers.push(qf[0].loser, qf[1].loser);
  // Runde 105: SF-Paarung (Ober-Gewinner x QF-Gewinner) rematch-ärmer wählen.
  const sfOpponents = pairAvoidingRematch([ubR1[0].winner, ubR1[1].winner], [qf[0].winner, qf[1].winner], localHistory);
  const sf = [playMatch('sf-0', ubR1[0].winner, sfOpponents[0]), playMatch('sf-1', ubR1[1].winner, sfOpponents[1])];
  // Grand Final: KEINE Ausweichmöglichkeit (nur je 1 Team pro Bracket-Seite
  // übrig) -- der vom User explizit genannte, unvermeidbare Ausnahmefall.
  const gf = playMatch('gf-0', sf[0].winner, sf[1].winner);

  // "otherLosers" deckt sich bei afl8 exakt mit der 4er-"5.-8. Platz"-Bande
  // (2 lbR1- + 2 QF-Verlierer). Bei afl12 sind es 8 Teams (4 lbR1- + 2 lbR2-
  // + 2 QF-Verlierer), die sich laut Punkte-Tabelle die GLEICHE "5.-8."-
  // Bande teilen (echtes RLCS vergibt hier ebenfalls geteilte Plätze, siehe
  // rlcs-legends-project.md -- keine feinere Tier-Unterteilung nötig, alle
  // bekommen denselben Punktewert).
  return {
    champion: gf.winner,
    runnerUp: gf.loser,
    semifinalLosers: [sf[0].loser, sf[1].loser], // 3.-4. Platz
    otherLosers, // 5.-8. Platz (geteilt, siehe Kommentar oben)
    matches,
  };
}

// Snake-Split (wiederverwendet seedIntoRoundRobinGroups()) in `groupCount`
// gleich große, nach Stärke ausgeglichene Gruppen -- Platzhalter-Seeding für
// Stages, die (anders als Major/Worlds' Round-Robin-Gruppen) keine externe
// Saison-Punkte-Reihenfolge haben; nutzt `org.strength` als einzige
// universell vorhandene Vergleichsgröße.
function seedByStrength(teams, groupCount) {
  const ordered = teams.slice().sort((a, b) => (b.strength || 0) - (a.strength || 0));
  return seedIntoRoundRobinGroups(ordered, groupCount);
}

// ── Anti-Rematch-Seeding (Runde 103, komplette User-Vorgabe: "wenn Team A
// gegen Team B schon gespielt hat, sollen sie sich so lange wie nur
// mathematisch möglich nicht nochmal treffen -- für jedes Team gegen jedes
// Team, für jedes Turnierformat") ─────────────────────────────────────────
// Baut aus einer Liste bereits gespielter Matches (egal welches Format --
// Bracket-Matches haben `teamAName`/`teamBName`, Swiss-Log/RoundRobin-
// Einträge haben `a`/`b`) eine Menge sortierter "NameA|NameB"-Paare. Wird pro
// Turnier-Auflösung frisch aufgebaut (NUR Matches DIESES EINEN Turniers bis
// zum aktuellen Punkt, nicht die saisonweite matchHistory-Datenbank -- die
// User-Vorgabe bezieht sich explizit auf "Swiss bis Playoffs/Finale", also
// eine EINZELNE Turnier-Historie).
function buildMatchHistorySet(matchLists) {
  const set = new Set();
  matchLists.forEach((matches) => {
    (matches || []).forEach((m) => {
      const a = m.teamAName || m.a;
      const b = m.teamBName || m.b;
      if (a && b) set.add([a, b].sort().join('|'));
    });
  });
  return set;
}
function havePlayedBefore(historySet, nameA, nameB) {
  return historySet.has([nameA, nameB].sort().join('|'));
}

// Runde 105, User-Vorgabe ("NIEMALS ein Rematch in irgendeinem Turnier/
// Format, außer strukturell unvermeidbar im Finale"): die bisherige Anti-
// Rematch-Logik griff nur bei der SEEDING ZWISCHEN Stages (Swiss->
// Gruppenphase usw.) -- innerhalb der FESTEN Bracket-Topologie eines
// Doppel-K.o.-Formats selbst (z.B. wer im Unteren Bracket auf wen trifft)
// konnte trotzdem ein Rematch entstehen: verliert Team A sein Oberes-
// Bracket-Viertelfinale gegen Team B, kommt A ins Untere Bracket, kann aber
// im Unteren-Bracket-Halbfinale erneut auf B treffen, falls B danach sein
// Oberes-Bracket-Halbfinale verliert -- ein strukturelles Merkmal von
// Doppel-K.o.-Brackets, das bisher nicht abgefangen wurde. An GENAU den
// Stellen, an denen die Bracket-Struktur zwei mögliche 1:1-Zuordnungen
// zwischen zwei 2er-Teamlisten zulässt (z.B. "welcher Unteres-Bracket-
// Gewinner trifft auf welchen Oberes-Bracket-Verlierer"), wählt diese
// Funktion die Zuordnung mit weniger (im Idealfall null) bereits gespielten
// Begegnungen. Bei Gleichstand (z.B. beide Zuordnungen 0 oder beide 1
// Kollision) bleibt die ursprüngliche (unveränderte) Reihenfolge bestehen.
function pairAvoidingRematch(aTeams, bTeams, historySet) {
  const straightCollisions = (havePlayedBefore(historySet, aTeams[0].name, bTeams[0].name) ? 1 : 0)
    + (havePlayedBefore(historySet, aTeams[1].name, bTeams[1].name) ? 1 : 0);
  const swappedCollisions = (havePlayedBefore(historySet, aTeams[0].name, bTeams[1].name) ? 1 : 0)
    + (havePlayedBefore(historySet, aTeams[1].name, bTeams[0].name) ? 1 : 0);
  return swappedCollisions < straightCollisions ? [bTeams[1], bTeams[0]] : bTeams;
}

// Repariert eine bereits fertig gebildete Gruppeneinteilung (`groups`, Array
// von Team-Arrays -- z.B. aus seedByStrength()/seedIntoRoundRobinGroups())
// minimal-invasiv: solange irgendein Team in seiner Gruppe einen Gegner mit
// gemeinsamer Historie hat, wird versucht, es mit einem Team aus einer
// ANDEREN Gruppe zu tauschen, das die Gesamt-Kollisionszahl senkt. Bewusst
// KEIN Neu-Seeding von Grund auf (das würde die Stärke-Balance zerstören) --
// nur so viele Tauschvorgänge wie nötig, um Kollisionen aufzulösen. Ist eine
// Kollision durch die Feldgröße/Historie rechnerisch nicht vermeidbar (z.B.
// ein Team hat schon gegen ALLE anderen in seiner möglichen Gruppe gespielt),
// bleibt sie bestehen, statt die Funktion in eine Endlosschleife laufen zu
// lassen -- exakt die User-Formulierung "so lange wie nur mathematisch
// möglich".
function reduceRematchCollisions(groups, historySet) {
  function collisionsIn(g) {
    let n = 0;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (havePlayedBefore(historySet, g[i].name, g[j].name)) n++;
      }
    }
    return n;
  }
  let guard = 0;
  let improved = true;
  while (improved && guard < 300) {
    improved = false;
    guard++;
    for (let gi = 0; gi < groups.length && !improved; gi++) {
      for (let ti = 0; ti < groups[gi].length && !improved; ti++) {
        const hasCollision = groups[gi].some((other, oi) => oi !== ti && havePlayedBefore(historySet, groups[gi][ti].name, other.name));
        if (!hasCollision) continue;
        for (let gj = 0; gj < groups.length && !improved; gj++) {
          if (gj === gi) continue;
          for (let tj = 0; tj < groups[gj].length; tj++) {
            const before = collisionsIn(groups[gi]) + collisionsIn(groups[gj]);
            const tmp = groups[gi][ti]; groups[gi][ti] = groups[gj][tj]; groups[gj][tj] = tmp;
            const after = collisionsIn(groups[gi]) + collisionsIn(groups[gj]);
            if (after < before) { improved = true; break; }
            const tmp2 = groups[gi][ti]; groups[gi][ti] = groups[gj][tj]; groups[gj][tj] = tmp2; // kein Fortschritt -- zurücktauschen
          }
        }
      }
    }
  }
  return groups;
}

function totalCollisionCount(groups, historySet) {
  let n = 0;
  groups.forEach((g) => {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (havePlayedBefore(historySet, g[i].name, g[j].name)) n++;
      }
    }
  });
  return n;
}

// Runde 105, User-Vorgabe ("NIEMALS ein Rematch, in keinem einzigen
// Turnier/Format"): Live-Diagnose zeigte, dass reduceRematchCollisions()
// (reiner GREEDY Hill-Climb, EIN Durchlauf ab der Stärke-Seed-Ausgangslage)
// bei einer dicht bespielten Swiss-Historie (32 Teams, je 3-5 Swiss-Matches)
// oft in einem lokalen Optimum mit mehreren Rest-Kollisionen hängen bleibt
// (empirisch: ~8-10 Kollisionen in der Ausgangslage, davon im Schnitt nur auf
// ~1-2 gesenkt statt auf 0) -- ein einzelner Swap, der die Gesamtzahl NICHT
// sofort verbessert, wird nie versucht, obwohl er den Weg zu einer späteren,
// besseren Lösung freimachen könnte (klassisches "stuck in local optimum"-
// Problem von reinem Greedy-Hillclimbing). Diese Wrapper-Funktion führt den
// bestehenden, bereits geprüften Hill-Climb MEHRFACH aus: der erste Versuch
// startet unverändert von der übergebenen (stärke-balancierten) Ausgangslage,
// jeder weitere Versuch startet von derselben Ausgangslage, aber mit ein paar
// zufälligen Team-Vertauschungen ZWISCHEN Gruppen vorab "angestoßen" (kleine
// Störung, keine komplette Neumischung -- die Stärke-Balance bleibt dadurch
// weitgehend erhalten) -- behält am Ende die Lösung mit der wenigsten
// Gesamt-Kollisionszahl. Bricht sofort ab, sobald 0 Kollisionen erreicht
// sind (häufigster Fall). `attempts` bewusst klein gehalten (12) -- jeder
// Versuch ist selbst schon bis zu 300 Iterationen teuer, das bleibt aber
// weit unterhalb spürbarer Rechenzeit für ein einmaliges Turnier-Ergebnis.
function reduceRematchCollisionsMultiStart(groups, historySet, attempts) {
  // Per Brute-Force-Test (alle 12870 möglichen 8er/8er-Aufteilungen von 16
  // Swiss-Qualifizierten durchprobiert, Scratchpad-Skript
  // probe-bruteforce-optimal.mjs) bestätigt: das ECHTE mathematische Minimum
  // liegt bei manchen Swiss-Ergebnissen bei 1-2 Kollisionen, NICHT 0 -- eine
  // Erhöhung von `attempts` über ~30-40 hinaus brachte im Test kaum noch
  // Verbesserung (250 Versuche lieferten fast dieselbe Restkollisionszahl wie
  // 30). 40 ist also schon nah am praktisch erreichbaren Optimum, ohne
  // unnötig Rechenzeit zu verschwenden.
  attempts = attempts || 40;
  let best = reduceRematchCollisions(groups.map((g) => g.slice()), historySet);
  let bestScore = totalCollisionCount(best, historySet);
  for (let attempt = 1; attempt < attempts && bestScore > 0; attempt++) {
    const perturbed = groups.map((g) => g.slice());
    // 3 zufällige Vertauschungen zwischen zwei unterschiedlichen Gruppen als
    // Ausgangsstörung, bevor der Hill-Climb erneut läuft.
    for (let s = 0; s < 3; s++) {
      const gi = Math.floor(Math.random() * perturbed.length);
      let gj = Math.floor(Math.random() * perturbed.length);
      if (perturbed.length > 1) { while (gj === gi) gj = Math.floor(Math.random() * perturbed.length); }
      const ti = Math.floor(Math.random() * perturbed[gi].length);
      const tj = Math.floor(Math.random() * perturbed[gj].length);
      const tmp = perturbed[gi][ti]; perturbed[gi][ti] = perturbed[gj][tj]; perturbed[gj][tj] = tmp;
    }
    const candidate = reduceRematchCollisions(perturbed, historySet);
    const score = totalCollisionCount(candidate, historySet);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

// Für Bracket-Seedlisten (Playoffs -- feste Paarungen (0,1),(2,3),... siehe
// simulateAflBracket()/simulateSingleElimBracket()): behandelt je 2
// benachbarte Plätze als "Gruppe der Größe 2", lässt reduceRematchCollisions()
// Kollisionen (= eine bereits gespielte Runde-1-Paarung) auflösen, flacht
// danach wieder zu einer Liste ab. Beeinflusst absichtlich NUR Runde 1 -- ab
// Runde 2 legt das Bracket die Paarungen erst durch die tatsächlichen
// Ergebnisse fest, das ist "so weit wie mathematisch möglich" im Voraus
// planbar.
function reduceRound1RematchCollisions(orderedTeams, historySet) {
  const pairs = [];
  for (let i = 0; i < orderedTeams.length; i += 2) pairs.push(orderedTeams.slice(i, i + 2));
  return reduceRematchCollisionsMultiStart(pairs, historySet).flat();
}

// Runde 93, Bug-Fix (dasselbe Custom-Org-Problem wie bei regionOrgs() oben):
// findOrgByName() sucht NUR in ORGANIZATIONS, kennt also eine per "Eigene Org
// gründen" erstellte Org nie. Wird dort gebraucht, wo Namen aus
// seasonQualifiedTeams[region] (reine Strings) wieder zu Org-Objekten
// aufgelöst werden müssen -- die eigene Org wird per Namensgleichheit
// bevorzugt PER REFERENZ zurückgegeben (dasselbe Muster wie
// applyOrgLogoToElement() für Logos, seit Runde 87 etabliert).
function resolveOrgByNameOrOwn(name) {
  if (assignedOrg && assignedOrg.name === name) return assignedOrg;
  return findOrgByName(name);
}

// Ermittelt das Teilnehmerfeld für EIN Open-Event in EINER Region -- die
// eigene Org ist nur dabei, wenn man in dieser Region sitzt UND sich für
// GENAU dieses Event angemeldet hat (Runde 90). `pool`: alle grundsätzlich
// in Frage kommenden Orgas (open0: regionOrgs(region), open1-6: der
// Open-Qualifier-Pool, siehe resolveOpenEvent()).
function eligibleOpenFieldFromPool(pool, event, region) {
  const isPlayerRegion = assignedOrg && orgRegion(assignedOrg.country) === region;
  return isPlayerRegion && !openQualifierRegistrations[event.key]
    ? pool.filter((o) => o.name !== assignedOrg.name)
    : pool;
}

// Auflösung des Open Qualifier (open0, Januar) für EINE Region (Runde 93,
// User-Korrektur zu Runde 92 -- "kann ruhig auch mehrere in Gruppen
// aufgeteilte Turnierbäume sein" statt eines einzelnen 65-Team-Sonderbaus):
// das Feld wird in 8 Gruppen à 8 Teams aufgeteilt, jede Gruppe läuft als
// GENAU derselbe "standard8"-Doppel-K.o.-Baum (simulateStandard8Group()/
// buildDoubleElimBracket(shape:'standard8')), der schon für die reguläre
// Open-Gruppenphase existiert -- inklusive des ECHTEN, bereits gebauten
// grafischen Turnierbaums mit per getBoundingClientRect() gezeichneten
// Verbindungslinien (siehe tournamentFormatInfo()/tournamentStageHtml()).
// KEIN Swiss, KEIN Playoffs, KEIN Turniersieger, KEINE Saison-Punkte
// (isSeasonGate: true, siehe pointsTableForEvent()). Jede Gruppe liefert 4
// Qualifizierte (2 Ober-/2 Unterbracket-Pfad) + 4 Ausgeschiedene -- 8 Gruppen
// x 4 = exakt 32 Qualifizierte, die in seasonQualifiedTeams[region]
// festgeschrieben werden (das Feld, aus dem Open 1-6 diese Saison ihre
// Teilnehmer ziehen, siehe resolveOpenEvent() unten). Wer rausfliegt, ist für
// den Rest der Saison komplett raus.
function resolveOpenQualifierEvent(event, region) {
  const rawField = eligibleOpenFieldFromPool(regionOrgs(region), event, region);
  let field = rawField;
  const preDeciderMatches = [];
  const preDeciderLosers = [];
  // Bug-Fix (Runde 96, User-Meldung "keine Teams mehr im Bracket/Absturz"):
  // die vorherige Fassung behandelte NUR "65" (eigene Org zusätzlich
  // angemeldet) -- übersah aber, dass eine Region schon OHNE die eigene Org
  // exakt 64 Orgas hat (die eigene Org ist ja meist eine der 454
  // bestehenden, siehe regionOrgs()). Meldet man sich NICHT an, filtert
  // eligibleOpenFieldFromPool() sie aus einem bereits-64er-Pool heraus ->
  // 63 (ebenfalls ungerade, aber ein DEFIZIT statt eines Überschusses). Die
  // alte "einmal halbieren"-Logik reduzierte das fälschlich auf 62 (kein
  // Vielfaches von 8 mehr) -- simulateStandard8Group() griff dann auf
  // nicht existierende teams[6]/teams[7] zu und stürzte ab, was JEDE
  // weitere Turnier-Auflösung dieser Session blockierte (leere Brackets,
  // kein Speichern, keine Live-Aktualisierung).
  // Robuster Fix: läuft in einer Schleife, bis das Feld ein sauberes
  // Vielfaches von 8 ist (simulateStandard8Group()s feste 8-Team-Struktur) --
  // funktioniert unabhängig davon, ob der Rest aus einem Überschuss (65) oder
  // einem Defizit (63) kommt, und bleibt für den (aktuell nie vorkommenden)
  // Fall größerer Abweichungen trotzdem terminierend (Feldgröße sinkt jede
  // Runde um genau 1, erreicht spätestens nach 7 Durchläufen ein Vielfaches
  // von 8).
  while (field.length % 8 !== 0) {
    const shuffled = shuffleArray(field);
    const [a, b, ...rest] = shuffled;
    const r = simulateBotSeries(a, b, 5);
    preDeciderMatches.push({ slot: 'predecider-' + preDeciderMatches.length, teamAName: a.name, teamBName: b.name, scoreA: r.winsA, scoreB: r.winsB });
    preDeciderLosers.push(r.loser);
    field = [r.winner, ...rest];
  }
  const groupCount = field.length / 8;
  const groups = seedByStrength(field, groupCount);
  const groupResults = groups.map((g) => simulateStandard8Group(g, 5));
  if (preDeciderMatches.length) {
    groupResults[0].matches = [...preDeciderMatches, ...groupResults[0].matches];
    groupResults[0].eliminated = [...preDeciderLosers, ...groupResults[0].eliminated];
  }

  const qualified = groupResults.flatMap((r) => r.qualified);
  seasonQualifiedTeams[region] = qualified.map((o) => o.name);
  // `gruppenphase` (nicht `groups`) -- derselbe Schlüsselname wie beim
  // regulären Open/LCQ (siehe stageResultKeysForEventType()), damit
  // tallyEventMatches()/buildMatchRecordsForEvent() den bestehenden
  // `event.eventType === 'open'`-Zweig 1:1 mitnutzen, ohne einen eigenen
  // open0-Sonderfall zu brauchen.
  const eliminated = groupResults.flatMap((r) => r.eliminated);
  return { gruppenphase: groupResults, qualifiedNames: qualified.map((o) => o.name), eliminatedNames: eliminated.map((o) => o.name), championName: null };
}

// Vollständige Auflösung eines regulären Open-Events (open1-6) für EINE
// Region: Swiss(32, 2x16) -> Gruppenphase(16, 2x8, GSL) -> Playoffs(8, AFL
// Final Eight) -> Platzierungen -> awardTournamentPoints(). Das Feld sind
// (Runde 92) NICHT mehr alle 64 Orgas der Region, sondern nur noch die 32,
// die den Open Qualifier (open0) im Januar überlebt haben (siehe
// seasonQualifiedTeams) -- dadurch ist das Feld immer schon exakt 32, die
// alte ">32 Vorrunde-Cut"-Platzhalterlogik (Top-32-nach-Stärke) entfällt
// ersatzlos, sie wird durch die ECHTE Qualifikation aus dem Open Qualifier
// ersetzt. Runde 94, User-Korrektur: KEINE eigene An-/Abmeldung mehr für
// Open 1-6 -- wer im Qualifizierten-Pool steht, nimmt automatisch teil (siehe
// openRegistrationStatus()), eligibleOpenFieldFromPool()s Anmelde-Filter wird
// hier nicht mehr gebraucht (bleibt nur für open0 selbst relevant).
// Platzierungs-Zahlen sind TIER-Repräsentanten (siehe pointsForPlacement()'s
// Bereichs-Lookup), keine eindeutigen Einzelränge -- reale RLCS-Turniere
// vergeben ohnehin geteilte Plätze innerhalb eines Tiers (z.B. "geteilter
// 5.-8. Platz"), daher genügt irgendein Platzwert INNERHALB des richtigen
// Bereichs.
function resolveOpenEvent(event, region) {
  if (event.key === 'open0') return resolveOpenQualifierEvent(event, region);

  const field = (seasonQualifiedTeams[region] || []).map((name) => resolveOrgByNameOrOwn(name)).filter(Boolean);

  const swissGroups = seedByStrength(field, 2);
  const swissResults = swissGroups.map((g) => simulateSwissStage(g, 3, 3, 5));

  const swissPlacements = [];
  swissResults.forEach((res) => {
    res.eliminated.forEach((t) => {
      const place = t.losses === 3 && t.wins === 0 ? 15 : t.wins === 1 ? 12 : 9; // 0-3 / 1-3 / 2-3
      swissPlacements.push({ orgName: t.orgName, place });
    });
  });

  // Runde 103, User-Vorgabe ("Team A/B, die schon gegeneinander gespielt
  // haben, sollen sich so lange wie mathematisch möglich nicht nochmal
  // treffen"): reduceRematchCollisions() ordnet die Stärke-Seeds minimal um,
  // damit möglichst kein Swiss-Gegnerpaar direkt in dieselbe Gruppenphase-
  // Gruppe gerät.
  const swissHistory = buildMatchHistorySet(swissResults.map((res) => res.log));
  const gruppenphaseField = swissResults.flatMap((res) => res.qualified.map((t) => t.team));
  const gspGroups = reduceRematchCollisionsMultiStart(seedByStrength(gruppenphaseField, 2), swissHistory);
  // Runde 105: swissHistory zusätzlich als historySet REINGEREICHT (nicht nur
  // für die Gruppen-SEEDING genutzt) -- simulateStandard8Group() braucht sie
  // für die interne LBSF-Paarung (siehe pairAvoidingRematch()), damit auch
  // dort keine Swiss-Begegnung wiederholt wird.
  const gspResults = gspGroups.map((g) => simulateStandard8Group(g, 5, swissHistory));

  const gspEliminatedPlacements = gspResults.flatMap((res) => res.eliminated.map((t) => ({ orgName: t.name, place: 5 })));

  // simulateStandard8Group()s qualified-Array ist [ubPfad0, ubPfad1, lbPfad0,
  // lbPfad1] -- "Gruppensieger" (Oberes-Bracket-Pfad) müssen ins AFL-Obere-
  // Bracket (2 Chancen), "Gruppenzweite" (Unteres-Bracket-Pfad) ins AFL-
  // Untere-Bracket (1 Chance). Ein simples flatMap() würde das pro Gruppe
  // vermischen -- deshalb hier getrennt je Pfad über beide Gruppen gesammelt.
  // Runde 103: Playoffs-Seeds zusätzlich gegen die KUMULIERTE Swiss+Gruppenphase-
  // Historie auf Runde-1-Rematches geprüft (Ober-/Unteres Bracket getrennt,
  // da unabhängige Pfade).
  const gruppenphaseHistory = buildMatchHistorySet(gspResults.map((res) => res.matches));
  const cumulativeHistory = new Set([...swissHistory, ...gruppenphaseHistory]);
  const upperSeeds = reduceRound1RematchCollisions(gspResults.flatMap((res) => res.qualified.slice(0, 2)), cumulativeHistory);
  const lowerSeeds = reduceRound1RematchCollisions(gspResults.flatMap((res) => res.qualified.slice(2, 4)), cumulativeHistory);
  // Runde 105: cumulativeHistory auch hier als historySet für die interne
  // QF-/SF-Paarung von simulateAflBracket() (siehe pairAvoidingRematch()).
  const playoffResult = simulateAflBracket(upperSeeds, lowerSeeds, 5, cumulativeHistory);
  const playoffPlacements = [
    { orgName: playoffResult.champion.name, place: 1 },
    { orgName: playoffResult.runnerUp.name, place: 2 },
    ...playoffResult.semifinalLosers.map((t) => ({ orgName: t.name, place: 3 })),
    ...playoffResult.otherLosers.map((t) => ({ orgName: t.name, place: 5 })),
  ];

  const placements = [...swissPlacements, ...gspEliminatedPlacements, ...playoffPlacements];
  awardTournamentPoints(event, placements);
  // Runde 86: `swiss`/`gruppenphase`/`playoffs` sind die vollen Zwischen-
  // ergebnisse je Stage (inkl. `matches`/`slots`/`log`) -- rein additiv,
  // damit die Turnier-Detailseite die "TBD"-Bracket-Karten mit echten
  // Namen/Scores befüllen kann (siehe fillBracketMatches() etc.), ohne dass
  // sich am bereits verifizierten placements/championName-Verhalten etwas
  // ändert.
  // Statistiken-Seite (diese Runde): `playoffParticipants` sind exakt die
  // Teams, die in die AFL-Playoffs eingezogen sind (upperSeeds/lowerSeeds,
  // dieselben Variablen wie beim simulateAflBracket()-Aufruf oben) -- rein
  // additiv, siehe recordCareerOrgStats().
  return {
    placements, championName: playoffResult.champion.name, swiss: swissResults, gruppenphase: gspResults, playoffs: playoffResult,
    playoffParticipants: [...upperSeeds, ...lowerSeeds].map((t) => t.name),
  };
}

// Vollständige Auflösung eines Major-Events (major1/major2): Teilnehmer aus
// dem Saison-Leaderboard je Region (MAJOR_REGION_SLOTS) -> Round-Robin
// (16 Teams, 4 Gruppen à 4) -> Playoffs (afl8 bei Major 1 / afl12 bei
// Major 2) -> Platzierungen -> awardTournamentPoints().
function resolveMajorEvent(event) {
  const isParis = event.key === 'major2';
  const perGroupAdvance = isParis ? 3 : 2;

  const field = [];
  Object.keys(MAJOR_REGION_SLOTS).forEach((region) => {
    const slots = MAJOR_REGION_SLOTS[region];
    const top = seasonLeaderboardForRegion(region).slice(0, slots);
    top.forEach((entry) => {
      const org = findOrgByName(entry.orgName);
      if (org) field.push({ org, points: entry.points });
    });
  });
  // Übergreifende Seed-Reihenfolge für den Snake-Draft: nach Saison-Punkten,
  // bei Gleichstand (z.B. Saisonstart, alle bei 0) nach Org-Stärke.
  const ordered = field
    .sort((a, b) => b.points - a.points || (b.org.strength || 0) - (a.org.strength || 0))
    .map((f) => f.org);

  const groups = seedIntoRoundRobinGroups(ordered, 4);
  const groupResults = groups.map((g) => simulateRoundRobinGroup(g, 5));

  // Gruppen-Rang 0 (Gruppensieger, über alle 4 Gruppen) -> AFL-Oberes-Bracket
  // (2 Chancen), alle übrigen fortgekommenen Ränge -> AFL-Unteres-Bracket (1
  // Chance) -- analog zur Open-Gruppenphase-Logik oben (Gruppensieger vs.
  // Gruppenzweite).
  const groupPlacements = [];
  const upperSeeds = [];
  const lowerSeeds = [];
  groupResults.forEach((res) => {
    res.standings.forEach((s, i) => {
      if (i < perGroupAdvance) {
        (i === 0 ? upperSeeds : lowerSeeds).push(findOrgByName(s.orgName));
      } else {
        // Nicht-fortgekommene Gruppen-Plätze auf die 3 MAJOR_POINTS_TABLE-
        // Tiers (15-16/12-14/9-11) verteilt -- schlechtester Rang IMMER auf
        // den schlechtesten Tier zuerst (Rang vom Gruppenende her gezählt:
        // letzter Platz -> 15-16, vorletzter -> 12-14, drittletzter -> 9-11).
        // Bei 4-Team-Gruppen bleiben bei Top-2-Aufstieg (Major 1) nur 2
        // nicht-fortgekommene Ränge (9-11 bleibt dabei ungenutzt), bei
        // Top-3-Aufstieg (Major 2) nur 1 (nur 15-16 wird gebraucht) -- eine
        // Folge davon, dass Runde 80 Swiss (3 gestaffelte Eliminations-Tiers)
        // durch 4-Team-Round-Robin (max. 2 nicht-fortgekommene Ränge)
        // ersetzt hat; die Punkte-WERTE selbst bleiben unverändert.
        const rankFromBottom = res.standings.length - 1 - i;
        const place = rankFromBottom === 0 ? 15 : rankFromBottom === 1 ? 12 : 9;
        groupPlacements.push({ orgName: s.orgName, place });
      }
    });
  });

  // Runde 103, User-Vorgabe ("so lange wie mathematisch möglich nicht nochmal
  // aufeinandertreffen -- gilt für jedes Turnier"): Gruppenmitglieder haben
  // schon gegeneinander gespielt (Round-Robin, jeder gegen jeden) -- die
  // Playoff-Seeds werden hier gegen genau diese Historie auf Runde-1-Rematches
  // geprüft (Ober-/Unteres Bracket getrennt, unabhängige Pfade).
  const groupHistory = buildMatchHistorySet(groupResults.map((res) => res.results));
  // Runde 105: groupHistory auch als historySet für die interne QF-/SF-
  // Paarung von simulateAflBracket() (siehe pairAvoidingRematch()).
  const playoffResult = simulateAflBracket(
    reduceRound1RematchCollisions(upperSeeds, groupHistory),
    reduceRound1RematchCollisions(lowerSeeds, groupHistory),
    7,
    groupHistory
  );
  const playoffPlacements = [
    { orgName: playoffResult.champion.name, place: 1 },
    { orgName: playoffResult.runnerUp.name, place: 2 },
    ...playoffResult.semifinalLosers.map((t) => ({ orgName: t.name, place: 3 })),
    ...playoffResult.otherLosers.map((t) => ({ orgName: t.name, place: 5 })),
  ];

  const placements = [...groupPlacements, ...playoffPlacements];
  awardTournamentPoints(event, placements);
  // Runde 86: `gruppenphase`/`playoffs` additiv für die Bracket-Befüllung
  // (siehe resolveOpenEvent()-Kommentar für dasselbe Muster).
  // Statistiken-Seite (diese Runde): playoffParticipants = upperSeeds/lowerSeeds
  // VOR der Rematch-Umsortierung -- reduceRound1RematchCollisions() ändert nur
  // die Paarungsreihenfolge, nicht WER dabei ist, dieselbe Teammenge reicht also.
  return {
    placements, championName: playoffResult.champion.name, gruppenphase: groupResults, playoffs: playoffResult,
    playoffParticipants: [...upperSeeds, ...lowerSeeds].map((t) => t.name),
  };
}

// "Schnelles K.o.-System" (Runde 85, User-Vorgabe für die LCQ-Vorrunde):
// reduziert `teams` in EINER schnellen Bo3-Runde auf höchstens
// `targetSurvivors` -- nur so viele Teams wie nötig spielen tatsächlich
// (der Überschuss wird gegeneinander ausgespielt, der Rest bekommt
// automatisch ein Freilos). Ist das Feld schon kleiner/gleich dem Ziel
// (unser Regionen-Pool ist endlich, siehe rlcs-legends-project.md),
// passiert gar nichts -- alle gehen unverändert durch (disclosed
// Vereinfachung, kein Turnier kann mehr Teams "filtern" als es Teilnehmer hat).
// Runde 106, User-Vorgabe ("LCQ-Vorrunde soll ein echter, angezeigter/
// simulierter Bracket sein, nicht unsichtbar"): gibt jetzt zusätzlich zu den
// Überlebenden auch die einzelnen K.o.-Matches (mit Slot-Tag fürs Bracket-
// Rendering, gleiches Muster wie simulateStandard8Group()) und die Namen der
// automatisch durchgereichten Freilos-Teams zurück -- rein additiv, die
// Überlebenden-Liste (jetzt `.survivors`) bleibt inhaltlich identisch zur
// alten Rückgabe.
function runQuickKnockout(teams, targetSurvivors) {
  if (teams.length <= targetSurvivors) return { survivors: teams.slice(), koMatches: [], byeNames: teams.map((t) => t.name) };
  const excess = teams.length - targetSurvivors;
  const shuffled = shuffleArray(teams);
  const byeTeams = shuffled.slice(0, shuffled.length - excess * 2);
  const koTeams = shuffled.slice(shuffled.length - excess * 2);
  const survivors = [];
  const koMatches = [];
  for (let i = 0; i < koTeams.length; i += 2) {
    const r = simulateBotSeries(koTeams[i], koTeams[i + 1], 3);
    koMatches.push({ slot: 'ko-' + koMatches.length, teamAName: koTeams[i].name, teamBName: koTeams[i + 1].name, scoreA: r.winsA, scoreB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
    survivors.push(r.winner);
  }
  return { survivors: [...byeTeams, ...survivors], koMatches, byeNames: byeTeams.map((t) => t.name) };
}

// Vollständige Auflösung des Last Chance Qualifier für EINE Region (nur
// EU/NA/SAM/MENA haben laut LCQ_ELIGIBILITY_BANDS überhaupt einen LCQ).
// Erzwingt eine EXAKTE Feldgröße nach einer Stage, deren natürliches Ergebnis
// (wie bei Swiss mit ungeraden Feldgrößen) davon abweichen kann (Runde 105,
// siehe Kommentar in resolveLcqEvent()). Überschuss: schwächste Teams
// spielen Schnellentscheidungen gegeneinander, bis die Zielgröße erreicht
// ist (gleiches Muster wie resolveOpenQualifierEvent()s Vorentscheidungs-
// Schleife). Defizit: die besten AUSGESCHIEDENEN Teams aus `eliminatedPool`
// (bessere Sieg-Niederlage-Bilanz zuerst) rücken ohne weiteres Spiel als
// Wildcard nach -- reicht der Pool selbst dafür nicht (extremer
// Ausnahmefall), bleibt das Feld kleiner als `targetSize`, statt endlos zu
// warten. `outMatches` sammelt eventuell gespielte Entscheidungsspiele, damit
// sie in die Bracket-Anzeige übernommen werden können.
function reconcileFieldToExactSize(field, eliminatedPool, targetSize, outMatches) {
  let result = field.slice();
  while (result.length > targetSize) {
    const sorted = result.slice().sort((a, b) => (a.strength || 0) - (b.strength || 0));
    const teamA = sorted[0];
    const teamB = sorted[1];
    if (!teamB) break;
    const r = simulateBotSeries(teamA, teamB, 5);
    outMatches.push({ slot: 'lcq-wildcard-' + outMatches.length, teamAName: teamA.name, teamBName: teamB.name, scoreA: r.winsA, scoreB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
    result = result.filter((t) => t !== r.loser);
  }
  if (result.length < targetSize) {
    const candidates = eliminatedPool
      .slice()
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .map((e) => e.team);
    while (result.length < targetSize && candidates.length) {
      result = [...result, candidates.shift()];
    }
  }
  return result;
}

// Exaktes 4-Phasen-Format nach User-Vorgabe (Runde 85): Vorrunde (Teams im
// LCQ_ELIGIBILITY_BANDS-Bereich lcqRangeStart-lcqRangeEnd bekommen ein
// Freilos/hohes Seeding direkt in den 32er-Pool, alle übrigen nicht direkt
// qualifizierten Teams der Region müssen sich per "schnellem K.o." die
// restlichen Plätze erspielen) -> Swiss (2 Gruppen) -> GSL-Gruppenphase
// (2 Gruppen à 8) -> Playoffs (AFL Final Eight, Bo7) -- NUR der
// Turniersieger bekommt das WM-Ticket. Direktqualifizierte (Rang 1 bis
// autoQualifyTop) nehmen gar nicht teil, die sind schon für die WM gesetzt.
// KEINE Punkte-Verrechnung -- LCQ speist das Saison-Leaderboard nicht
// (pointsTableForEvent() liefert für 'lcq' bewusst `null`, siehe Runde 82).
function resolveLcqEvent(event, region) {
  const band = LCQ_ELIGIBILITY_BANDS[region];
  const ranked = seasonLeaderboardForRegion(region); // absteigend nach Saison-Punkten
  const byeEntries = ranked.slice(band.lcqRangeStart - 1, band.lcqRangeEnd);
  const koEntries = ranked.slice(band.lcqRangeEnd);
  const byeTeams = byeEntries.map((e) => findOrgByName(e.orgName)).filter(Boolean);
  const koTeams = koEntries.map((e) => findOrgByName(e.orgName)).filter(Boolean);

  // Ziel: 32 Teams für die Swiss-Stage. Unser Regionen-Pool ist endlich (28-
  // 34 nicht direkt qualifizierte Teams je nach Region, siehe
  // rlcs-legends-project.md) -- reicht er nicht für volle 32, gehen einfach
  // ALLE verfügbaren Teams durch (disclosed, dieselbe Vereinfachung wie bei
  // resolveOpenEvent()s Vorrunde-Cut).
  const targetKoSurvivors = Math.max(0, 32 - byeTeams.length);
  const koResult = runQuickKnockout(koTeams, targetKoSurvivors);

  const swissField = [...byeTeams, ...koResult.survivors];
  const swissGroups = seedByStrength(swissField, 2);
  // Bug-Fix (Runde 105, aufgedeckt durch die seasonLeaderboardForRegion()-
  // Korrektur oben: der Regionen-Pool schrumpfte dadurch auf die TATSÄCHLICH
  // qualifizierten Orgas, z.B. 28 statt der ursprünglich angenommenen 32-64 --
  // targetKoSurvivors=32 kann dann gar nicht mehr erreicht werden, koTeams
  // gehen unverändert durch runQuickKnockout()s eigenen Kurzschluss durch).
  // Der alte Kommentar ("14/15/16 liefert immer genau 8 Qualifizierte pro
  // Gruppe") galt NUR für diesen konkreten Größenbereich -- empirisch
  // nachgemessen (siehe test-swiss-qualified-distribution.mjs) liefert
  // simulateSwissStage(3,3) bei kleineren Feldern WENIGER als 8 Qualifizierte
  // (z.B. N=12 -> 7), was simulateStandard8Group()s feste 8-Team-Indizierung
  // (teams[6]/teams[7]) zum Absturz brachte. Die feste "2 Gruppen à 8"-GSL-/
  // AFL8-Playoff-Struktur des LCQ braucht aber IMMER exakt 16 Teams --
  // deshalb wird das tatsächliche Swiss-Ergebnis hier symmetrisch auf exakt
  // 16 nachjustiert: Überschuss wird per Schnellentscheidung (schwächste
  // zuerst) rausgekürzt, ein Defizit wird durch die besten AUSGESCHIEDENEN
  // Swiss-Teams (beste Bilanz zuerst, klassisches "Wildcard"-Nachrücken)
  // aufgefüllt -- alles rein additiv, ändert nichts an Feldern, die schon
  // zufällig exakt 16 treffen.
  const swissResults = swissGroups.map((g) => simulateSwissStage(g, 3, 3, 5));
  // Runde 103, User-Vorgabe ("so lange wie mathematisch möglich nicht nochmal
  // aufeinandertreffen -- gilt für jedes Turnier"): dasselbe Muster wie
  // resolveOpenEvent().
  const swissHistory = buildMatchHistorySet(swissResults.map((res) => res.log));
  const wildcardMatches = [];
  const gruppenphaseField = reconcileFieldToExactSize(
    swissResults.flatMap((res) => res.qualified.map((t) => t.team)),
    swissResults.flatMap((res) => res.eliminated),
    16,
    wildcardMatches
  );

  const gspGroups = reduceRematchCollisionsMultiStart(seedByStrength(gruppenphaseField, 2), swissHistory);
  // Runde 105: swissHistory auch als historySet für simulateStandard8Group()s
  // interne LBSF-Paarung (siehe pairAvoidingRematch()).
  const gspResults = gspGroups.map((g) => simulateStandard8Group(g, 5, swissHistory));
  if (wildcardMatches.length) {
    gspResults[0].matches = [...wildcardMatches, ...gspResults[0].matches];
  }
  const gruppenphaseHistory = buildMatchHistorySet(gspResults.map((res) => res.matches));
  const cumulativeHistory = new Set([...swissHistory, ...gruppenphaseHistory]);
  const upperSeeds = reduceRound1RematchCollisions(gspResults.flatMap((res) => res.qualified.slice(0, 2)), cumulativeHistory);
  const lowerSeeds = reduceRound1RematchCollisions(gspResults.flatMap((res) => res.qualified.slice(2, 4)), cumulativeHistory);
  // Runde 105: cumulativeHistory auch hier als historySet für simulateAflBracket()s
  // interne QF-/SF-Paarung.
  const playoffResult = simulateAflBracket(upperSeeds, lowerSeeds, 7, cumulativeHistory);

  // Runde 86: `swiss`/`gruppenphase`/`playoffs` additiv für die Bracket-
  // Befüllung (siehe resolveOpenEvent()-Kommentar für dasselbe Muster).
  // Runde 106, User-Vorgabe ("LCQ-Vorrunde soll ein echter, angezeigter/
  // simulierter Bracket sein"): `vorrunde` speichert zusätzlich, WER per
  // Band-Seeding direkt ein Freilos bekam (`seededByeNames`), welche
  // K.o.-Matches im Überschuss-Ausgleich gespielt wurden (`koMatches`,
  // meist leer -- die 7 Regionen-Pools sind laut Beobachtung praktisch immer
  // ≤32, siehe buildLcqVorrundeBracket()-Kommentar), welche Teams DORT ein
  // Freilos bekamen (`koByeNames`) und die vollständige, für die Swiss-Stage
  // qualifizierte Namensliste (`qualifiedNames`, = `swissField`).
  return {
    championName: playoffResult.champion.name, region,
    vorrunde: {
      seededByeNames: byeTeams.map((t) => t.name),
      koMatches: koResult.koMatches,
      koByeNames: koResult.byeNames,
      // Reihenfolge bewusst K.o.-Sieger ZUERST, dann alle Freilose --
      // deckt sich 1:1 mit buildLcqVorrundeBracket()s qualifiedIds-Reihenfolge
      // (dort verbinden nur die ersten `koPairCount` Slots mit einem
      // K.o.-Match), damit fillLcqVorrundeResultsPartial() per Index
      // zuordnen kann, welcher Qualifiziert-Slot von welchem Match abhängt.
      qualifiedNames: [
        ...koResult.koMatches.map((m) => (m.scoreA > m.scoreB ? m.teamAName : m.teamBName)),
        ...koResult.byeNames,
        ...byeTeams.map((t) => t.name),
      ],
    },
    swiss: swissResults, gruppenphase: gspResults, playoffs: playoffResult,
    // Statistiken-Seite (diese Runde): siehe resolveOpenEvent()-Kommentar für
    // dasselbe Muster (upperSeeds/lowerSeeds VOR der Rematch-Umsortierung).
    playoffParticipants: [...upperSeeds, ...lowerSeeds].map((t) => t.name),
  };
}

// Bildet ein reines Einzel-K.o.-Bracket nach (Worlds-Playoffs, Runde 79-
// Korrektur: "kein Unteres Bracket mehr"). `teams.length` muss eine
// Zweierpotenz sein. `eliminationRounds[0]` = in der ERSTEN Runde raus
// (schlechtester Platz), das LETZTE Element = Finalist (2. Platz).
// `historySet` (Runde 105, optional): bereits gespielte Begegnungen aus
// früheren Stages -- anders als bei Doppel-K.o. (feste Ober-/Unteres-
// Bracket-Pfade) gibt es bei REINEM Einzel-K.o. KEINE strukturelle
// Einschränkung, wer in einer Runde gegen wen antritt (jeder Runde-N-
// Gewinner könnte grundsätzlich gegen jeden anderen Runde-N-Gewinner
// spielen) -- vor JEDER Runde ab der zweiten (Runde 1 ist schon vorher
// sauber vorgeseedet) werden die Teilnehmer deshalb per
// reduceRound1RematchCollisions() (dasselbe Muster wie bei Bracket-
// Seedlisten) so umsortiert, dass möglichst keine bereits gespielte
// Begegnung entsteht -- bei nur noch 2 Teams (Finale) bleibt das automatisch
// wirkungslos (nichts zum Tauschen da), der vom User genannte unvermeidbare
// Ausnahmefall ergibt sich also von selbst, ohne Sonderfall-Code.
function simulateSingleElimBracket(teams, bestOf, historySet) {
  let round = teams;
  const eliminationRounds = [];
  // Runde 86: `matches` taggt jedes Einzelergebnis mit demselben Slot-Key,
  // den buildSingleElimTree() für die DOM-IDs verwendet (treeId + '-r' +
  // roundIndex + '-' + matchIndex).
  const matches = [];
  const localHistory = new Set(historySet || []);
  let roundIndex = 0;
  while (round.length > 1) {
    const pairedRound = roundIndex === 0 ? round : reduceRound1RematchCollisions(round, localHistory);
    const winners = [];
    const losers = [];
    for (let i = 0; i < pairedRound.length; i += 2) {
      const teamA = pairedRound[i];
      const teamB = pairedRound[i + 1];
      const r = simulateBotSeries(teamA, teamB, bestOf);
      matches.push({ slot: 'r' + roundIndex + '-' + (i / 2), teamAName: teamA.name, teamBName: teamB.name, scoreA: r.winsA, scoreB: r.winsB, games: r.games, isOwnMatch: r.isOwnMatch, ownIsA: r.ownIsA });
      localHistory.add([teamA.name, teamB.name].sort().join('|'));
      winners.push(r.winner);
      losers.push(r.loser);
    }
    eliminationRounds.push(losers);
    round = winners;
    roundIndex++;
  }
  return { champion: round[0], eliminationRounds, matches };
}

// Vollständige Auflösung der World Championship (Runde 85). 20 Teams: die 16
// Direktqualifizierten (Top autoQualifyTop je Region, ALLE 7 Regionen,
// siehe LCQ_ELIGIBILITY_BANDS) + die 4 regionalen LCQ-Sieger. Nur die besten
// WORLDS_DIRECT_SEED_COUNT (12) der 16 Direktqualifizierten sind gesetzt
// (Freilos direkt in die Swiss Stage) -- die 4 schwächsten müssen zusammen
// mit den 4 LCQ-Siegern zuerst durchs Play-In. Setzt voraus, dass der LCQ
// dieser Saison schon aufgelöst wurde (siehe seasonTournamentResults.lcq,
// checkTournamentResolutions() garantiert die richtige chronologische
// Reihenfolge -- LCQ liegt im Kalender vor Worlds).
function resolveWorldsEvent(event) {
  const directField = [];
  Object.keys(LCQ_ELIGIBILITY_BANDS).forEach((region) => {
    const top = seasonLeaderboardForRegion(region).slice(0, LCQ_ELIGIBILITY_BANDS[region].autoQualifyTop);
    top.forEach((entry) => {
      const org = findOrgByName(entry.orgName);
      if (org) directField.push({ org, points: entry.points });
    });
  });
  directField.sort((a, b) => b.points - a.points || (b.org.strength || 0) - (a.org.strength || 0));
  const directSeeded = directField.slice(0, WORLDS_DIRECT_SEED_COUNT).map((f) => f.org);
  const directPlayIn = directField.slice(WORLDS_DIRECT_SEED_COUNT).map((f) => f.org);

  const lcqResults = seasonTournamentResults.lcq || {};
  const lcqChampions = LCQ_REGIONS
    .map((region) => lcqResults[region] && findOrgByName(lcqResults[region].championName))
    .filter(Boolean);

  const playInField = [...directPlayIn, ...lcqChampions]; // 4 + 4 = 8 Teams
  const playInResult = simulateStandard8Group(playInField, 5);
  const groupPhaseField = [...directSeeded, ...playInResult.qualified]; // 12 + 4 = 16

  // Runde 103, User-Vorgabe ("so lange wie mathematisch möglich nicht nochmal
  // aufeinandertreffen -- gilt für jedes Turnier"): Play-In-Gegner (die 4
  // Direktqualifizierten, die durchs Play-In mussten, gegen die 4 LCQ-Sieger)
  // werden hier gegen die Gruppenzuteilung geprüft.
  const playInHistory = buildMatchHistorySet([playInResult.matches]);
  // Bug-Fix (Runde 105, aufgedeckt durch den VM-Simulations-Härtetest für den
  // Season-Skip): diese Stage hieß laut tournamentFormatInfo()/Kopfkommentar
  // ("Runde 80, User-Korrektur ... auch bei der WM wurde Swiss durch 4
  // Round-Robin-Gruppen ersetzt, siehe Kommentar bei 'major' oben") schon
  // immer 'roundRobin' (4 Gruppen à 4, wie bei Major) -- resolveWorldsEvent()
  // selbst wurde dabei aber nie mit umgestellt und rief hier weiterhin
  // simulateSwissStage() (EINE Gruppe, Swiss-Log-Datenform) auf. Das
  // Mismatch zur 'roundRobin'-Visual-Deklaration blieb unbemerkt, bis
  // matchesForRevealStep()s roundRobin-Zweig (der ein Array von Gruppen mit
  // .results/.standings erwartet) an einem echten Single-Swiss-Objekt mit
  // "stageData.forEach is not a function" abstürzte. Fix: tatsächlich 4
  // Round-Robin-Gruppen simulieren (identisches Muster zu resolveMajorEvent()),
  // damit Datenform und Visual-Deklaration wieder übereinstimmen.
  const groups = reduceRematchCollisionsMultiStart(seedByStrength(groupPhaseField, 4), playInHistory);
  const groupResults = groups.map((g) => simulateRoundRobinGroup(g, 5));
  const groupHistory = buildMatchHistorySet(groupResults.map((res) => res.results));
  const cumulativeHistory = new Set([...playInHistory, ...groupHistory]);

  const advancing = []; // Top 2 pro Gruppe -> Playoffs
  const nonAdvancing = []; // Platz 3/4 pro Gruppe -> Platz 9-16 (nach Bilanz sortiert)
  groupResults.forEach((res) => {
    res.standings.forEach((s, i) => {
      if (i < 2) advancing.push(findOrgByName(s.orgName));
      else nonAdvancing.push(s);
    });
  });
  nonAdvancing.sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || (b.gameWins - b.gameLosses) - (a.gameWins - a.gameLosses));

  const playoffField = reduceRound1RematchCollisions(advancing, cumulativeHistory); // sollte 8 sein (2 pro Gruppe x 4 Gruppen)

  // Runde 105: cumulativeHistory auch als historySet für die Runde-2+-
  // Umsortierung in simulateSingleElimBracket() (siehe dortiger Kommentar).
  const finalResult = simulateSingleElimBracket(playoffField, 7, cumulativeHistory);
  const rounds = finalResult.eliminationRounds; // [Viertelfinale-Verlierer(4), Halbfinale-Verlierer(2), Finale-Verlierer(1)]
  // Runde 102, User-Vorgabe (Preisgeld-Platzierungstabelle auch für Worlds,
  // siehe WORLDS_PRIZE_TABLE in data/tournament-calendar.js): Worlds hatte
  // bisher kein `placements`-Array (nur die Einzelfelder unten, Punkte/
  // Preisgeld je Platzierung gab es für dieses Event noch nie, siehe
  // pointsTableForEvent()-Kommentar "Worlds/LCQ haben KEINE eigene Punkte-
  // Tabelle"). Baut hier NUR fürs Preisgeld ein Tier-Anker-Array analog zu
  // resolveOpenEvent()/resolveMajorEvent() (place 1/2/3/5/9/13/17, exakt auf
  // die 7 WORLDS_PRIZE_TABLE-Bänder abgestimmt) -- vergibt bewusst KEINE
  // Saison-Punkte (Worlds bleibt das Saisonfinale, unverändert). 9-16 kommen
  // aus den 8 Gruppenphase-Nicht-Aufsteigern (beste 4 -> 9-12, schlechteste
  // 4 -> 13-16), 17-20 aus `playIn.eliminated` (die 4 Play-In-Verlierer,
  // kommen gar nicht erst in die Gruppenphase).
  const placements = [
    { orgName: finalResult.champion.name, place: 1 },
    { orgName: rounds[rounds.length - 1][0].name, place: 2 },
    ...rounds[rounds.length - 2].map((t) => ({ orgName: t.name, place: 3 })),
    ...rounds[rounds.length - 3].map((t) => ({ orgName: t.name, place: 5 })),
    ...nonAdvancing.slice(0, 4).map((s) => ({ orgName: s.orgName, place: 9 })),
    ...nonAdvancing.slice(4, 8).map((s) => ({ orgName: s.orgName, place: 13 })),
    ...playInResult.eliminated.map((t) => ({ orgName: t.name, place: 17 })),
  ];
  // Runde 86: `playIn`/`swiss`/`playoffs` additiv für die Bracket-Befüllung
  // (siehe resolveOpenEvent()-Kommentar für dasselbe Muster). Der Schlüssel
  // heißt weiterhin `swiss` (siehe stageResultKeysForEventType()), auch wenn
  // die Stage seit diesem Fix tatsächlich ein Round-Robin-Gruppen-Array ist --
  // eine Umbenennung würde unnötig viele weitere Stellen anfassen, die diesen
  // Schlüssel schon rein positionsbasiert (stageIndex 1) auslesen.
  return {
    championName: finalResult.champion.name,
    runnerUpName: rounds[rounds.length - 1][0].name,
    semifinalLoserNames: rounds[rounds.length - 2].map((t) => t.name),
    quarterfinalLoserNames: rounds[rounds.length - 3].map((t) => t.name),
    placements,
    playIn: playInResult, swiss: groupResults, playoffs: finalResult,
    // Statistiken-Seite (diese Runde): playoffField = die 8 Viertelfinalisten,
    // exakt die "Playoffs erreicht"-Teilnehmer für Worlds (siehe resolveOpenEvent()-
    // Kommentar für dasselbe Muster bei den anderen Event-Typen).
    playoffParticipants: playoffField.map((t) => t.name),
  };
}

// ── Formkurven (Runde 88, User-Vorgabe "Formkurven, die man bei Statistiken
// dann später sehen kann") ─────────────────────────────────────────────────
// Wertet die vollständigen Match-Logs eines aufgelösten Turniers aus (siehe
// `matches`/`log`/`results` aus Runde 86) und verschiebt die Form jeder
// beteiligten Org je nach Sieg-/Niederlagen-Bilanz IN DIESEM Turnier. Reine
// Datenschicht + Persistenz -- die Anzeige (Statistiken-Seite) ist bewusst
// NICHT Teil dieser Runde, User-Vorgabe: "später".
let teamForm = {}; // { orgName: { current: 0-100, history: [{date, value}] } }
const FORM_NEUTRAL = 50;
const FORM_STEP_PER_NET_WIN = 3; // ein Netto-Sieg (Siege minus Niederlagen) verschiebt die Form um 3 Punkte
const FORM_HISTORY_MAX = 30; // Kurve "vergisst" alte Werte von selbst, statt hart pro Saison zurückgesetzt zu werden

function tallyMatchRecord(tally, teamName, isWin) {
  if (!tally[teamName]) tally[teamName] = { wins: 0, losses: 0 };
  if (isWin) tally[teamName].wins++; else tally[teamName].losses++;
}
// `matches`: [{teamAName, teamBName, scoreA, scoreB}] -- standard8/AFL/
// Einzel-K.o. (siehe simulateStandard8Group()/simulateAflBracket()/
// simulateSingleElimBracket(), Runde 86).
function tallyFromMatches(tally, matches) {
  (matches || []).forEach((m) => {
    tallyMatchRecord(tally, m.teamAName, m.scoreA > m.scoreB);
    tallyMatchRecord(tally, m.teamBName, m.scoreB > m.scoreA);
  });
}
// `results`: [{a, b, winsA, winsB}] -- Round-Robin-Gruppen (siehe
// simulateRoundRobinGroup()).
function tallyFromRoundRobinResults(tally, results) {
  (results || []).forEach((m) => {
    tallyMatchRecord(tally, m.a, m.winsA > m.winsB);
    tallyMatchRecord(tally, m.b, m.winsB > m.winsA);
  });
}
// `log`: [{a, b, winner, bye?}] -- Swiss-Stage (siehe simulateSwissStage()).
// Freilos-Einträge (b === null) sind kein echtes Match zwischen zwei Teams.
function tallyFromSwissLog(tally, log) {
  (log || []).forEach((entry) => {
    if (entry.b === null) return;
    tallyMatchRecord(tally, entry.a, entry.winner === entry.a);
    tallyMatchRecord(tally, entry.b, entry.winner === entry.b);
  });
}

// Sammelt ALLE Einzelspiel-Ergebnisse eines aufgelösten Events (unabhängig
// vom Event-Typ, der die Zwischenergebnisse unterschiedlich verschachtelt --
// siehe resolveOpenEvent()/resolveMajorEvent()/resolveLcqEvent()/
// resolveWorldsEvent(), Runde 84/85) zu einer einzigen Sieg/Niederlagen-
// Bilanz je Team für DIESES Turnier.
function tallyEventMatches(event, eventResult) {
  const tally = {};
  if (event.eventType === 'open' || event.eventType === 'lcq') {
    (eventResult.swiss || []).forEach((res) => tallyFromSwissLog(tally, res.log));
    (eventResult.gruppenphase || []).forEach((res) => tallyFromMatches(tally, res.matches));
    if (eventResult.playoffs) tallyFromMatches(tally, eventResult.playoffs.matches);
  } else if (event.eventType === 'major') {
    (eventResult.gruppenphase || []).forEach((res) => tallyFromRoundRobinResults(tally, res.results));
    if (eventResult.playoffs) tallyFromMatches(tally, eventResult.playoffs.matches);
  } else if (event.eventType === 'worlds') {
    if (eventResult.playIn) tallyFromMatches(tally, eventResult.playIn.matches);
    (eventResult.swiss || []).forEach((res) => tallyFromRoundRobinResults(tally, res.results));
    if (eventResult.playoffs) tallyFromMatches(tally, eventResult.playoffs.matches);
  }
  return tally;
}

// Verschiebt die Form EINER Org um `(Siege - Niederlagen) * FORM_STEP_PER_NET_WIN`
// (auf 0-100 begrenzt) und hängt den neuen Wert an die Kurve an -- kappt sie
// bei FORM_HISTORY_MAX, damit sie sich von selbst auf die jüngste Entwicklung
// beschränkt, ohne einen harten Saison-Reset zu brauchen.
function updateTeamForm(orgName, wins, losses) {
  if (!teamForm[orgName]) teamForm[orgName] = { current: FORM_NEUTRAL, history: [] };
  const entry = teamForm[orgName];
  entry.current = Math.max(0, Math.min(100, entry.current + (wins - losses) * FORM_STEP_PER_NET_WIN));
  entry.history.push({ date: careerDate, value: entry.current });
  if (entry.history.length > FORM_HISTORY_MAX) entry.history.shift();
}

function updateTeamFormForEvent(event, eventResult) {
  const tally = tallyEventMatches(event, eventResult);
  Object.keys(tally).forEach((orgName) => updateTeamForm(orgName, tally[orgName].wins, tally[orgName].losses));
}

// ── Karrierelange Org-Statistiken (Statistiken-Seite, diese Runde) ────────
// Anders als seasonPoints/seasonTournamentResults (die JEDE Saison wieder bei
// 0 anfangen, siehe resetSeasonScopedDashboardState()) läuft das hier über
// die GESAMTE Karriere durch, für JEDE Org (nicht nur die eigene) -- Basis
// für die Statistiken-Tabelle ("Gewonnene Majors"/"Gewonnene Worlds"/
// "Playoff-Teilnahmen"). `playoffAppearances` zählt jede Org, die die
// Playoff-Stage EINES Events erreicht hat (unabhängig vom Ausgang dort) --
// bei Open 1-6/LCQ/Worlds die Teilnehmer des AFL-/Einzel-K.o.-Brackets, bei
// Major dasselbe. open0 (Season-Gate, kein Playoff-Konzept) zählt nicht mit.
let careerOrgStats = {}; // { orgName: { majorsWon, worldsWon, playoffAppearances, recentResults } }
const CAREER_ORG_RECENT_RESULTS_MAX = 8;

function ensureCareerOrgStats(orgName) {
  if (!careerOrgStats[orgName]) careerOrgStats[orgName] = { majorsWon: 0, worldsWon: 0, playoffAppearances: 0, recentResults: [] };
  if (!careerOrgStats[orgName].recentResults) careerOrgStats[orgName].recentResults = []; // v27-Saves kannten das Feld noch nicht
  return careerOrgStats[orgName];
}

// `place` ist derselbe Tier-Anker-Wert, den awardTournamentPoints()/die
// Preisgeld-Tabellen schon nutzen (1/2/3/5/9/... -- keine exakte Platzierung
// bei Gleichständen, sondern die untere Grenze der jeweiligen Platzierungs-
// Bandbreite, siehe resolveOpenEvent()/resolveMajorEvent()/resolveWorldsEvent()).
function recordCareerOrgStats(event, result) {
  (result.playoffParticipants || []).forEach((orgName) => {
    ensureCareerOrgStats(orgName).playoffAppearances += 1;
  });
  if (result.championName) {
    if (event.eventType === 'major') ensureCareerOrgStats(result.championName).majorsWon += 1;
    if (event.eventType === 'worlds') ensureCareerOrgStats(result.championName).worldsWon += 1;
  }
  // "Neueste Erfolge" -- nur Events mit echter placements-Liste (Open 1-6/
  // Major/Worlds), LCQ/open0 haben keine vergleichbare Platzierungsskala
  // (siehe pointsTableForEvent()-Kommentar), tauchen hier bewusst nicht auf.
  (result.placements || []).forEach(({ orgName, place }) => {
    const stats = ensureCareerOrgStats(orgName);
    stats.recentResults.unshift({ season: event.seasonNumber, eventLabel: event.label, place });
    if (stats.recentResults.length > CAREER_ORG_RECENT_RESULTS_MAX) stats.recentResults.length = CAREER_ORG_RECENT_RESULTS_MAX;
  });
}

// ── Spieler-Entwicklung (Runde 113, User-Vorgabe) ─────────────────────────
// Wertet die ECHTEN Ticker-Ereignisse aus simulateMatch() (match.js, "was im
// Textfeld als Ereignis kommt") pro Spieler aus und lässt Spieler dadurch
// über die Karriere hinweg wirklich besser oder schlechter werden -- nicht
// nur kosmetisch, sondern an den TATSÄCHLICH simulationsrelevanten Stats
// (mechanics/gameSense/speed/shooting/defending/boostMgmt, siehe duelStat()/
// shotOnGoalChance()/goalChance() in match.js), wodurch sich Entwicklung
// direkt auf Matches, Overall (= Durchschnitt der 6 Stats, siehe
// generateOrgRoster()) UND darüber automatisch auf die Sterne-Bewertung
// (npcStarRating()) und die Org-Gesamtstärke (computeOrgStrengthFromRoster())
// auswirkt -- exakt die vom User verlangte Kette "Leistung -> Stats -> Sterne".
//
// Spielernamen sind NICHT eindeutig über alle 454 Orgas hinweg (echte
// RLCS-Namen aus ORG_REAL_ROSTER_NAMES, z.B. "Caard" spielt für mehrere
// verschiedene Orgas) -- der Schlüssel ist deshalb IMMER "orgName::playerName",
// nie der Spielername allein. `baseline` friert die 6 Stats EINMALIG beim
// ersten Entwicklungs-Ereignis ein (= die ursprünglich generierten Werte);
// jede spätere Anwendung rechnet `baseline + delta` neu aus, statt
// wiederholt auf den bereits veränderten Wert draufzurechnen (verhindert
// Rundungsdrift über hunderte Matches). ORGANIZATIONS wird bei jedem
// App-Start komplett neu aus den Rohdaten aufgebaut (siehe organizations.js)
// -- reapplyPlayerDevelopmentToRosters() spielt die gespeicherte Entwicklung
// deshalb nach jedem Laden einmal auf die frischen Objekte zurück.
const PLAYER_STAT_KEYS = ['mechanics', 'gameSense', 'speed', 'shooting', 'defending', 'boostMgmt'];
const PLAYER_DEV_STAT_MIN = 35; // weiter/tiefer als die 45-95-Generierungsspanne, damit echte Karriereentwicklung sichtbaren Raum hat
const PLAYER_DEV_STAT_MAX = 99;
// User-Vorgabe exakt umgesetzt: (1) praktisch jeder wird langsam besser --
// PLAYER_DEV_BASE_GROWTH gilt für JEDEN, unabhängig von Sieg/Niederlage/
// Aktionen; (2) wer mehr "macht" (Tore/Paraden/gewonnene Zweikämpfe aus dem
// Ticker), wird SCHNELLER besser -- PLAYER_DEV_ACTION_WEIGHT pro Aktionspunkt;
// (3) eine Niederlage zieht etwas ab, ABER: viel geleistet -> der Abzug wird
// bis auf 0 abgefedert (kann durch die Grundzunahme + Aktionsbonus sogar
// trotzdem netto besser werden), kaum/nichts geleistet -> voller Abzug.
const PLAYER_DEV_BASE_GROWTH = 0.03;
const PLAYER_DEV_ACTION_WEIGHT = 0.015;
const PLAYER_DEV_LOSS_PENALTY_BASE = 0.15;
const PLAYER_DEV_LOSS_OFFSET_THRESHOLD = 6; // Aktionspunkte, ab denen die Niederlage-Strafe komplett aufgehoben ist
const PLAYER_DEV_RECENT_GAMES_MAX = 8;

let playerDevelopment = {}; // 'orgName::playerName' -> { baseline:{...6 Stats}, delta, history:[{date,value}], matches, goals, wins, losses, recentGames:[...] }

function playerDevKey(orgName, playerName) { return orgName + '::' + playerName; }

function ensurePlayerDevelopment(orgName, player) {
  const key = playerDevKey(orgName, player.name);
  if (!playerDevelopment[key]) {
    const baseline = {};
    PLAYER_STAT_KEYS.forEach((k) => { baseline[k] = player[k]; });
    playerDevelopment[key] = { baseline, delta: 0, history: [], matches: 0, goals: 0, wins: 0, losses: 0, recentGames: [] };
  }
  return playerDevelopment[key];
}

// Zählt pro Spieler Tore/gewonnene Zweikämpfe/Paraden/Fehlschüsse aus den
// echten Ticker-Ereignissen EINES Spiels (simulateMatch()s `events`) --
// `team` je Ereignis kommt direkt aus match.js mit, keine eigene Zuordnung
// nötig. Bei einem (seltenen) Namensgleichstand zwischen den beiden
// antretenden Teams könnte die letzte verarbeitete Team-Zuordnung gewinnen --
// disclosed Randfall, siehe Projekt-Memory.
function tallyPlayerActionsFromEvents(events) {
  const tally = {};
  (events || []).forEach((e) => {
    if (!e.player || !e.team) return;
    if (!tally[e.player] || tally[e.player].team !== e.team) {
      tally[e.player] = { team: e.team, goals: 0, duelsWon: 0, saves: 0, misses: 0 };
    }
    if (e.type === 'goal') tally[e.player].goals += 1;
    else if (e.type === 'duel') tally[e.player].duelsWon += 1;
    else if (e.type === 'save') tally[e.player].saves += 1;
    else if (e.type === 'miss') tally[e.player].misses += 1;
  });
  return tally;
}

function playerActionScore(t) {
  return t.goals * 3 + t.saves * 2 + t.duelsWon * 1;
}

function applyPlayerDevelopmentDelta(org, player, deltaChange, actionTally, isWinner, opponentName) {
  const dev = ensurePlayerDevelopment(org.name, player);
  dev.delta += deltaChange;
  dev.matches += 1;
  dev.goals += actionTally.goals;
  if (isWinner) dev.wins += 1; else dev.losses += 1;
  PLAYER_STAT_KEYS.forEach((k) => {
    player[k] = Math.max(PLAYER_DEV_STAT_MIN, Math.min(PLAYER_DEV_STAT_MAX, Math.round(dev.baseline[k] + dev.delta)));
  });
  player.overall = Math.round(PLAYER_STAT_KEYS.reduce((s, k) => s + player[k], 0) / PLAYER_STAT_KEYS.length);
  dev.history.push({ date: careerDate, value: player.overall });
  if (dev.history.length > FORM_HISTORY_MAX) dev.history.shift();
  dev.recentGames.unshift({ date: careerDate, opponent: opponentName, goals: actionTally.goals, isWin: isWinner });
  if (dev.recentGames.length > PLAYER_DEV_RECENT_GAMES_MAX) dev.recentGames.length = PLAYER_DEV_RECENT_GAMES_MAX;
}

// Wird nach JEDEM einzelnen simulierten Spiel (nicht erst nach der ganzen
// Bo5/Bo7-Serie) aus simulateBotSeries() aufgerufen -- pro Spiel eigenes
// Sieg/Niederlage-Ergebnis, daher granularer als ein reiner Serien-Sieg.
// NICHT für Forfeits (unvollständiger Kader, siehe simulateBotSeries())
// aufgerufen -- dort gibt es keine echten Ticker-Ereignisse.
// org.strength (computeOrgStrengthFromRoster(), siehe data/org-rosters.js)
// wird bisher NUR einmal bei Org-Erzeugung berechnet und danach nirgends neu
// -- ohne Nachziehen hier würde die Team-Stärke (Team-Info-Sterne, Statistiken-
// Tabellen-Tie-Break) mit der Zeit von den tatsächlichen, sich entwickelnden
// Spielerwerten abdriften. Einmal pro Org pro Spiel neu berechnet (nicht pro
// Spieler einzeln), da genau EIN Wert für den ganzen 14-köpfigen Kader gilt.
// Runde 117, User-Vorgabe ("Alter-Logik mit verbessern/verschlechtern
// koppeln, wenig Einfluss"): skaliert NUR den Wachstums-Anteil (Grundwachstum
// + Aktionsbonus), NICHT die Niederlage-Strafe weiter unten -- sonst würden
// ältere Spieler bei einer Niederlage kontraintuitiv LANGSAMER schlechter
// werden (Verlust-Strafe ist für jedes Alter gleich streng, das bleibt reine
// Leistungssache). Bewusst subtil (0,8-1,15x, kein dominanter Effekt): junge
// Spieler (~17-21) wachsen etwas schneller, Richtung Karriereende (30+) klar
// gedämpft, dieselbe Altersspanne wie scoutingPotentialStars() auf der
// Scouting-Seite (konzeptionell konsistent, aber eigenständige Formel --
// Potenzial ist eine Anzeige-Projektion, das hier ist der tatsächliche
// Entwicklungsraten-Multiplikator).
function playerAgeGrowthFactor(age) {
  if (age <= 21) return 1.15;
  if (age <= 25) return 1.0;
  if (age <= 29) return 0.92;
  return 0.8;
}

function applyPlayerDevelopmentForGame(orgA, orgB, gameResult) {
  const tally = tallyPlayerActionsFromEvents(gameResult.events);
  const aWonGame = gameResult.scoreA > gameResult.scoreB;
  [
    { org: orgA, opponent: orgB.name, isWinner: aWonGame, team: 'A' },
    { org: orgB, opponent: orgA.name, isWinner: !aWonGame, team: 'B' },
  ].forEach(({ org, opponent, isWinner, team }) => {
    const roster = [...((org.roster && org.roster.starters) || []), org.roster && org.roster.sub].filter(Boolean);
    roster.forEach((player) => {
      const t = (tally[player.name] && tally[player.name].team === team) ? tally[player.name] : { goals: 0, duelsWon: 0, saves: 0, misses: 0 };
      const actionScore = playerActionScore(t);
      let delta = (PLAYER_DEV_BASE_GROWTH + actionScore * PLAYER_DEV_ACTION_WEIGHT) * playerAgeGrowthFactor(player.age);
      if (!isWinner) {
        const offset = Math.min(1, actionScore / PLAYER_DEV_LOSS_OFFSET_THRESHOLD);
        delta -= PLAYER_DEV_LOSS_PENALTY_BASE * (1 - offset);
      }
      applyPlayerDevelopmentDelta(org, player, delta, t, isWinner, opponent);
    });
    if (org.roster) org.strength = computeOrgStrengthFromRoster(org.roster);
  });
}

// Spielt die gespeicherte Entwicklung (baseline+delta) auf die frisch aus
// den Rohdaten aufgebauten ORGANIZATIONS-Objekte zurück -- MUSS nach jedem
// loadGameState() einmal laufen, sonst wäre jede Karriereentwicklung nach
// einem Neustart der App verloren (ORGANIZATIONS wird beim Skriptstart immer
// neu mit den ursprünglichen Baseline-Werten aufgebaut, siehe organizations.js).
// Zieht org.strength (s.o.) für jede betroffene Org einmal nach, NACHDEM alle
// ihre Spieler zurückgespielt wurden (Set verhindert Mehrfachberechnung bei
// mehreren entwickelten Spielern derselben Org).
function reapplyPlayerDevelopmentToRosters() {
  const touchedOrgs = new Set();
  Object.keys(playerDevelopment).forEach((key) => {
    const sepIdx = key.indexOf('::');
    if (sepIdx === -1) return;
    const orgName = key.slice(0, sepIdx);
    const playerName = key.slice(sepIdx + 2);
    const org = findOrgByName(orgName);
    if (!org || !org.roster) return;
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    const player = roster.find((p) => p.name === playerName);
    if (!player) return;
    const dev = playerDevelopment[key];
    PLAYER_STAT_KEYS.forEach((k) => {
      player[k] = Math.max(PLAYER_DEV_STAT_MIN, Math.min(PLAYER_DEV_STAT_MAX, Math.round(dev.baseline[k] + dev.delta)));
    });
    player.overall = Math.round(PLAYER_STAT_KEYS.reduce((s, k) => s + player[k], 0) / PLAYER_STAT_KEYS.length);
    touchedOrgs.add(org);
  });
  touchedOrgs.forEach((org) => { org.strength = computeOrgStrengthFromRoster(org.roster); });
}

// Setzt jeden bisher entwickelten Spieler auf seine echte Baseline zurück
// (Delta = 0) und leert danach die Nachverfolgung -- für "Neues Spiel", siehe
// dortigen Kommentar. Wiederverwendet dieselbe Schlüssel-/Auflösungslogik wie
// reapplyPlayerDevelopmentToRosters(), nur ohne das gespeicherte Delta
// aufzuaddieren. Zieht org.strength aus demselben Grund wie dort nach --
// sonst würde eine neue Karriere die (jetzt zurückgesetzten) Spielerwerte
// zeigen, aber die Team-Stärke/-Sterne blieben auf dem alten, entwickelten
// Stand der vorherigen Karriere stehen.
function resetPlayerDevelopmentToBaseline() {
  const touchedOrgs = new Set();
  Object.keys(playerDevelopment).forEach((key) => {
    const sepIdx = key.indexOf('::');
    if (sepIdx === -1) return;
    const orgName = key.slice(0, sepIdx);
    const playerName = key.slice(sepIdx + 2);
    const org = findOrgByName(orgName);
    if (!org || !org.roster) return;
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    const player = roster.find((p) => p.name === playerName);
    if (!player) return;
    const dev = playerDevelopment[key];
    PLAYER_STAT_KEYS.forEach((k) => { player[k] = dev.baseline[k]; });
    player.overall = Math.round(PLAYER_STAT_KEYS.reduce((s, k) => s + player[k], 0) / PLAYER_STAT_KEYS.length);
    touchedOrgs.add(org);
  });
  touchedOrgs.forEach((org) => { org.strength = computeOrgStrengthFromRoster(org.roster); });
  playerDevelopment = {};
}

// ── Match-Datenbank (Runde 89, User-Vorgabe "Das Datenmodell erweitern") ──
// Bisher steckten Einzelspiel-Ergebnisse nur verschachtelt (und in 3
// unterschiedlichen Rohformaten, siehe tallyFromMatches()/
// tallyFromRoundRobinResults()/tallyFromSwissLog() oben) in
// seasonTournamentResults. Diese Sektion baut daraus zusätzlich eine FLACHE,
// einheitliche Match-Datenbank (`matchHistory`) mit einer festen Struktur je
// Einzelspiel -- rein additiv, die bestehende verschachtelte Struktur (von
// der die Bracket-Befüllung aus Runde 86 abhängt) bleibt unverändert
// bestehen. Abweichung vom User-Beispiel: `TeamA`/`TeamB` referenzieren die
// Org per NAME statt per numerischer ID -- unser Org-Datenmodell
// (data/organizations.js) hat keine numerischen IDs, jede andere Stelle im
// Code identifiziert Orgs durchgehend per Name (`findOrgByName()` usw.);
// eine numerische ID einzuführen wäre ein eigener, viel größerer Umbau des
// gesamten Org-Referenzierungs-Systems, nicht Teil dieser Runde.
let matchHistory = []; // wächst über die ganze Karriere (kein Saison-Reset, wie teamForm)

// Menschenlesbare Runden-Bezeichnung aus dem Slot-Key (z.B. "gf-0" ->
// "Grand Final") -- deckt alle Slot-Präfixe ab, die
// simulateStandard8Group()/simulateAflBracket()/simulateSingleElimBracket()
// (Runde 86) vergeben.
const SLOT_ROUND_LABELS = {
  ubqf: 'Oberes Bracket – Viertelfinale', ubsf: 'Oberes Bracket – Halbfinale',
  lbqf: 'Unteres Bracket – Viertelfinale', lbsf: 'Unteres Bracket – Halbfinale',
  ubr1: 'Oberes Bracket – Runde 1', lbr1: 'Unteres Bracket – Runde 1', lbr2: 'Unteres Bracket – Runde 2',
  qf: 'Viertelfinale', sf: 'Halbfinale', gf: 'Grand Final',
  r0: 'Viertelfinale', r1: 'Halbfinale', r2: 'Grand Final', // Worlds-Einzel-K.o. (immer genau 3 Runden)
  predecider: 'Open Qualifier – Vorentscheidungsspiel', // Runde 93, siehe resolveOpenQualifierEvent()
};
function roundLabelForSlot(slot) {
  const prefix = slot.replace(/-\d+$/, '');
  return SLOT_ROUND_LABELS[prefix] || slot;
}

// `meta`: { season, eventKey, region (oder null), stageKey } -- identifiziert
// eindeutig, zu welchem Turnier/welcher Stage ein Match gehört.
function makeMatchId(meta, key) {
  return [meta.season, meta.eventKey, meta.region, meta.stageKey, key].filter((v) => v !== null && v !== undefined).join('_');
}

// `matches`: [{slot, teamAName, teamBName, scoreA, scoreB}] -- standard8/AFL/
// Einzel-K.o. (siehe Runde 86).
function canonicalMatchesFromMatches(matches, meta) {
  return (matches || []).map((m) => ({
    matchId: makeMatchId(meta, m.slot),
    season: meta.season, eventKey: meta.eventKey, region: meta.region, stage: meta.stageKey,
    round: roundLabelForSlot(m.slot),
    teamA: m.teamAName, teamB: m.teamBName, scoreA: m.scoreA, scoreB: m.scoreB,
    winner: m.scoreA > m.scoreB ? m.teamAName : m.teamBName,
    date: careerDate,
  }));
}
// `results`: [{slot, a, b, winsA, winsB, winner}] -- Round-Robin-Gruppen.
function canonicalMatchesFromRoundRobin(results, meta) {
  return (results || []).map((m) => ({
    matchId: makeMatchId(meta, m.slot),
    season: meta.season, eventKey: meta.eventKey, region: meta.region, stage: meta.stageKey,
    round: 'Gruppenspiel',
    teamA: m.a, teamB: m.b, scoreA: m.winsA, scoreB: m.winsB, winner: m.winner,
    date: careerDate,
  }));
}
// `log`: [{round, colKey, row, a, b, winner, winsA, winsB, bye?}] -- Swiss-
// Stage. Freilos-Einträge (b === null) sind kein echtes Match zwischen zwei
// Teams, werden übersprungen.
function canonicalMatchesFromSwissLog(log, meta) {
  return (log || [])
    .filter((entry) => entry.b !== null)
    .map((entry) => ({
      matchId: makeMatchId(meta, 'd' + entry.round + '-' + entry.colKey.replace(',', '-') + '-m' + entry.row),
      season: meta.season, eventKey: meta.eventKey, region: meta.region, stage: meta.stageKey,
      round: 'Tag ' + entry.round + ' (' + entry.colKey.replace(',', ':') + ')',
      teamA: entry.a, teamB: entry.b, scoreA: entry.winsA, scoreB: entry.winsB, winner: entry.winner,
      date: careerDate,
    }));
}

// Läuft strukturell identisch zu tallyEventMatches() (siehe Kommentar dort
// zur Verschachtelung je Event-Typ), erzeugt aber kanonische Match-
// Datensätze statt einer aggregierten Sieg/Niederlagen-Bilanz.
function buildMatchRecordsForEvent(event, region, eventResult) {
  const season = careerState.seasonNumber;
  const base = { season, eventKey: event.key, region: region || null };
  const records = [];
  if (event.eventType === 'open' || event.eventType === 'lcq') {
    (eventResult.swiss || []).forEach((res, gi) => records.push(...canonicalMatchesFromSwissLog(res.log, { ...base, stageKey: 'swiss-g' + gi })));
    (eventResult.gruppenphase || []).forEach((res, gi) => records.push(...canonicalMatchesFromMatches(res.matches, { ...base, stageKey: 'gruppenphase-g' + gi })));
    if (eventResult.playoffs) records.push(...canonicalMatchesFromMatches(eventResult.playoffs.matches, { ...base, stageKey: 'playoffs' }));
  } else if (event.eventType === 'major') {
    (eventResult.gruppenphase || []).forEach((res, gi) => records.push(...canonicalMatchesFromRoundRobin(res.results, { ...base, stageKey: 'gruppenphase-g' + gi })));
    if (eventResult.playoffs) records.push(...canonicalMatchesFromMatches(eventResult.playoffs.matches, { ...base, stageKey: 'playoffs' }));
  } else if (event.eventType === 'worlds') {
    if (eventResult.playIn) records.push(...canonicalMatchesFromMatches(eventResult.playIn.matches, { ...base, stageKey: 'playin' }));
    (eventResult.swiss || []).forEach((res, gi) => records.push(...canonicalMatchesFromRoundRobin(res.results, { ...base, stageKey: 'swiss-g' + gi })));
    if (eventResult.playoffs) records.push(...canonicalMatchesFromMatches(eventResult.playoffs.matches, { ...base, stageKey: 'playoffs' }));
  }
  return records;
}

function recordMatchHistoryForEvent(event, region, eventResult) {
  matchHistory.push(...buildMatchRecordsForEvent(event, region, eventResult));
}

// Einfache Abfrage-Hilfsfunktion ("wie ein Team zuletzt gespielt hat") --
// weitere Abfragen (z.B. nach Turnier/Saison gefiltert) können bei Bedarf
// später ergänzt werden, sobald es einen echten Verwendungszweck dafür gibt
// (Nachrichtenticker, Statistiken-Seite).
function matchesForTeam(orgName) {
  return matchHistory.filter((m) => m.teamA === orgName || m.teamB === orgName);
}

// ── Dashboard-Seite "Statistiken" (Runde 110, "Spieler"-Tab Runde 113) ────
// Reine Anzeige über bereits bestehende, echte Datenquellen -- KEIN eigenes
// "ERS"-Punktesystem erfunden (anders als im Referenz-Screenshot): "Punkte"
// = die echten seasonPoints (dasselbe Konto, das auch Major-/LCQ-/WM-
// Qualifikation steuert), "Platz" (Rang links) ergibt sich direkt aus der
// Sortierung nach genau diesen Punkten und aktualisiert sich dadurch von
// selbst live mit jedem aufgelösten Turnier. "Spieler"-Tab (Runde 113) nutzt
// die neue playerDevelopment-Nachverfolgung (siehe Kopfkommentar dort) --
// nicht mehr gesperrt.
let statsRegionFilter = null; // wird beim ersten Öffnen auf die eigene Region initialisiert
let statsSearchQuery = '';
let statsPage = 1;
let selectedStatsOrgName = null;
const STATS_TEAMS_PER_PAGE = 20;
let statsActiveTab = 'teams';
let statsPlayerPage = 1;
let selectedStatsPlayerKey = null;
const STATS_PLAYERS_PER_PAGE = 20;

// Ein einziger Durchlauf über matchHistory statt pro Org zu filtern (könnte
// bei 454 Orgs x wachsender Matchdatenbank sonst spürbar langsam werden).
function computeCareerWinLossTally() {
  const tally = {};
  matchHistory.forEach((m) => {
    if (!tally[m.teamA]) tally[m.teamA] = { wins: 0, losses: 0 };
    if (!tally[m.teamB]) tally[m.teamB] = { wins: 0, losses: 0 };
    if (m.winner === m.teamA) { tally[m.teamA].wins += 1; tally[m.teamB].losses += 1; }
    else { tally[m.teamB].wins += 1; tally[m.teamA].losses += 1; }
  });
  return tally;
}

function statsWinPctLabel(tally, orgName) {
  const rec = tally[orgName];
  if (!rec || rec.wins + rec.losses === 0) return 'N/A';
  return Math.round((rec.wins / (rec.wins + rec.losses)) * 100) + '%';
}

// User-Vorgabe (diese Runde): Teams grün hervorheben, die nach ihrem
// AKTUELLEN Punktestand für Major ODER Weltmeisterschaft qualifizieren
// würden -- nutzt dieselbe echte Cutoff-Logik wie die tatsächliche
// Qualifikation (MAJOR_REGION_SLOTS/LCQ_ELIGIBILITY_BANDS.autoQualifyTop,
// dieselben Konstanten, die auch resolveMajorEvent()/resolveWorldsEvent()
// für die Teilnehmerfelder nutzen).
// Bug-Fix (User-Meldung: "Team 1-5 UND 11 sind grün, ergibt keinen Sinn"):
// zählte den Rang bisher über seasonLeaderboardForRegion() -- die sortiert
// NUR nach Punkten, OHNE Gleichstand-Tie-Break. statsTeamRows() (die
// tatsächliche Tabellen-Sortierung) bricht Gleichstände zusätzlich nach
// Org-Stärke auf. Bei vielen 0-Punkte-Gleichständen (z.B. Saisonstart, bevor
// überhaupt ein Open aufgelöst wurde) ergaben beide Sortierungen
// UNTERSCHIEDLICHE Reihenfolgen -- ein Team konnte dadurch in der einen
// Rangliste "oben", in der angezeigten Tabelle aber weiter unten stehen,
// und trotzdem markiert werden (das gemeldete Team auf Platz 11). Fix:
// baut die Markierungs-Menge jetzt direkt aus statsTeamRows()s EIGENER
// Reihenfolge (derselben, die auch angezeigt wird) -- garantiert exakte
// Übereinstimmung zwischen Tabelle und Markierung, unabhängig von
// Gleichständen. Season-Qualifikation (seasonQualifiedTeams) bleibt
// weiterhin Pflicht, sonst könnte ein nicht season-qualifiziertes Team mit
// zufällig hohen Punkten trotzdem markiert werden.
function statsQualifyingOrgSet(region) {
  const majorSlots = MAJOR_REGION_SLOTS[region] || 0;
  const worldsSlots = (LCQ_ELIGIBILITY_BANDS[region] && LCQ_ELIGIBILITY_BANDS[region].autoQualifyTop) || 0;
  const cutoff = Math.max(majorSlots, worldsSlots);
  const qualifiedNames = new Set(seasonQualifiedTeams[region] || []);
  const set = new Set();
  for (const row of statsTeamRows(region)) {
    if (set.size >= cutoff) break;
    if (qualifiedNames.has(row.org.name)) set.add(row.org.name);
  }
  return set;
}

// Baut die vollständige, sortierte Zeilenliste einer Region -- ALLE Orgas
// der Region (nicht nur die für Major/LCQ/WM qualifizierten, anders als
// seasonLeaderboardForRegion(), das ist bewusst eine Qualifikations-Cutoff-
// Funktion, keine allgemeine Rangliste). Sortiert nach Saison-Punkten
// absteigend, bei Gleichstand nach Org-Stärke -- ergibt direkt den "Platz".
function statsTeamRows(region) {
  const tally = computeCareerWinLossTally();
  return regionOrgs(region)
    .map((org) => ({
      org,
      points: seasonPoints[org.name] || 0,
      winPct: statsWinPctLabel(tally, org.name),
      majorsWon: (careerOrgStats[org.name] && careerOrgStats[org.name].majorsWon) || 0,
      worldsWon: (careerOrgStats[org.name] && careerOrgStats[org.name].worldsWon) || 0,
      playoffAppearances: (careerOrgStats[org.name] && careerOrgStats[org.name].playoffAppearances) || 0,
    }))
    .sort((a, b) => b.points - a.points || (b.org.strength || 0) - (a.org.strength || 0));
}

function statsRowLogoHtml(org) {
  const logoUrl = resolveOrgLogoUrl(org);
  return logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div style="background:' + orgBadgeColor(org.name) + ';width:100%;height:100%;display:flex;align-items:center;justify-content:center;">' + org.name.trim().charAt(0).toUpperCase() + '</div>';
}

function statsTeamRowHtml(row, rank, qualifyingSet) {
  const isOwn = assignedOrg && row.org.name === assignedOrg.name;
  const qualifies = qualifyingSet.has(row.org.name);
  return (
    '<div class="dashboard-stats-row' + (row.org.name === selectedStatsOrgName ? ' is-selected' : '') + (isOwn ? ' is-own-org' : '') + (qualifies ? ' is-qualified' : '') + '" data-stats-org="' + row.org.name + '" title="' + (qualifies ? 'Qualifiziert sich aktuell für Major/Weltmeisterschaft' : '') + '">' +
      '<span class="dashboard-stats-row-rank">' + rank + '</span>' +
      '<div class="dashboard-stats-row-team">' +
        '<div class="dashboard-stats-row-logo">' + statsRowLogoHtml(row.org) + '</div>' +
        '<span class="dashboard-stats-row-name">' + row.org.name + '</span>' +
      '</div>' +
      '<span class="dashboard-stats-row-num">' + row.winPct + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.majorsWon + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.worldsWon + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.points + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.playoffAppearances + '</span>' +
    '</div>'
  );
}

function statsFilteredRows() {
  const rows = statsTeamRows(statsRegionFilter);
  const q = statsSearchQuery.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.org.name.toLowerCase().includes(q));
}

function renderStatsPagination(pageCount) {
  const el = document.getElementById('dashboard-stats-pagination');
  if (pageCount <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= pageCount; p++) {
    html += '<button type="button" class="dashboard-stats-page-btn' + (p === statsPage ? ' is-active' : '') + '" data-stats-page="' + p + '">' + p + '</button>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.dashboard-stats-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => { statsPage = Number(btn.dataset.statsPage); renderStatsTable(); });
  });
}

function renderStatsTable() {
  const all = statsFilteredRows();
  document.getElementById('dashboard-stats-team-count').textContent = all.length + ' Teams';

  const pageCount = Math.max(1, Math.ceil(all.length / STATS_TEAMS_PER_PAGE));
  statsPage = Math.min(statsPage, pageCount);
  const start = (statsPage - 1) * STATS_TEAMS_PER_PAGE;
  const pageItems = all.slice(start, start + STATS_TEAMS_PER_PAGE);

  const qualifyingSet = statsQualifyingOrgSet(statsRegionFilter);
  const body = document.getElementById('dashboard-stats-table-body');
  body.innerHTML = pageItems.length > 0
    ? pageItems.map((row, i) => statsTeamRowHtml(row, start + i + 1, qualifyingSet)).join('')
    : '<div class="dashboard-stats-recent-results-empty">Keine Teams gefunden.</div>';
  body.querySelectorAll('[data-stats-org]').forEach((row) => {
    row.addEventListener('click', () => renderStatsDetailPanel(row.dataset.statsOrg));
  });

  renderStatsPagination(pageCount);
}

// Reine SVG-Flächenkurve (kein externes Chart-Framework, konsistent mit
// renderFinanceChart()/den Turnier-Bracket-Verbindungslinien) über eine
// beliebige `[{date,value}]`-Kurve (0-100-Skala) -- Team-Form
// (teamForm[orgName].history, siehe updateTeamForm()) UND Spieler-Entwicklung
// (playerDevelopment[key].history, siehe applyPlayerDevelopmentDelta())
// nutzen dieselbe Funktion, nur mit unterschiedlicher History-Quelle. User-
// Vorgabe: bildet echte Sieg-/Niederlagen-/Leistungs-Entwicklung ab, nicht
// ein erfundenes Punktesystem wie im Referenz-Screenshot ("ERS-Verlauf").
function renderStatsFormChartInto(containerId, historyOrNull) {
  const container = document.getElementById(containerId);
  const history = historyOrNull && historyOrNull.length > 1 ? historyOrNull : null;
  if (!history) {
    container.innerHTML = '<div class="dashboard-stats-form-chart-empty">Noch keine Formkurve -- nimmt erst nach dem ersten aufgelösten Turnier dieser Org Form an.</div>';
    return;
  }
  const W = 280;
  const H = 130;
  const pad = 6;
  const stepX = (W - pad * 2) / (history.length - 1);
  const points = history.map((h, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - h.value / 100) * (H - pad * 2);
    return [x, y];
  });
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ' L' + points[points.length - 1][0].toFixed(1) + ',' + (H - pad) + ' L' + points[0][0].toFixed(1) + ',' + (H - pad) + ' Z';
  const gradId = containerId + 'Gradient';
  container.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#c04fd6" stop-opacity="0.55"/>' +
        '<stop offset="100%" stop-color="#c04fd6" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + areaPath + '" fill="url(#' + gradId + ')"/>' +
      '<path d="' + linePath + '" fill="none" stroke="#d66fe8" stroke-width="2"/>' +
    '</svg>';
}

function statsRecentResultRowHtml(entry) {
  return (
    '<div class="dashboard-stats-recent-result-row">' +
      '<span class="dashboard-stats-recent-result-event">S' + entry.season + ' · ' + entry.eventLabel + '</span>' +
      '<span class="dashboard-stats-recent-result-place">Platz ' + entry.place + '</span>' +
    '</div>'
  );
}

function renderStatsDetailPanel(orgName) {
  selectedStatsOrgName = orgName;
  const org = findOrgByName(orgName);
  if (!org) return;

  document.getElementById('dashboard-stats-detail-logo').innerHTML = statsRowLogoHtml(org);
  document.getElementById('dashboard-stats-detail-name').textContent = org.name;
  document.getElementById('dashboard-stats-detail-description').textContent = org.description || '';

  renderStatsFormChartInto('dashboard-stats-form-chart', teamForm[orgName] && teamForm[orgName].history);

  const stats = careerOrgStats[orgName];
  const recent = (stats && stats.recentResults) || [];
  document.getElementById('dashboard-stats-recent-results').innerHTML = recent.length > 0
    ? recent.map(statsRecentResultRowHtml).join('')
    : '<div class="dashboard-stats-recent-results-empty">Keine letzten Turniere.</div>';

  renderStatsTable(); // Markierung der gewählten Zeile aktualisieren
}

function selectStatsRegion(region) {
  statsRegionFilter = region;
  statsPage = 1;
  document.querySelectorAll('.dashboard-stats-region-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.statsRegion === region));
  renderStatsTable();
}

function renderDashboardStatsPanel() {
  if (!statsRegionFilter) statsRegionFilter = orgRegion(assignedOrg.country) || 'EU';
  document.querySelectorAll('.dashboard-stats-region-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.statsRegion === statsRegionFilter));
  document.querySelectorAll('[data-stats-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.statsTab === statsActiveTab));
  document.getElementById('dashboard-stats-teams-view').classList.toggle('hidden', statsActiveTab !== 'teams');
  document.getElementById('dashboard-stats-players-view').classList.toggle('hidden', statsActiveTab !== 'players');
  document.getElementById('dashboard-stats-teams-detail-col').classList.toggle('hidden', statsActiveTab !== 'teams');
  document.getElementById('dashboard-stats-players-detail-col').classList.toggle('hidden', statsActiveTab !== 'players');
  document.getElementById('dashboard-stats-search').placeholder = statsActiveTab === 'players' ? 'Spieler suchen…' : 'Team suchen…';
  document.getElementById('dashboard-stats-search').value = statsSearchQuery;

  if (statsActiveTab === 'teams') {
    renderStatsTable();
    const rows = statsFilteredRows();
    if (!selectedStatsOrgName || !rows.some((r) => r.org.name === selectedStatsOrgName)) {
      if (rows.length > 0) renderStatsDetailPanel(rows[0].org.name);
    } else {
      renderStatsDetailPanel(selectedStatsOrgName);
    }
  } else {
    renderStatsPlayerTable();
    const rows = statsPlayerFilteredRows();
    if (!selectedStatsPlayerKey || !rows.some((r) => r.key === selectedStatsPlayerKey)) {
      if (rows.length > 0) renderStatsPlayerDetailPanel(rows[0].key);
    } else {
      renderStatsPlayerDetailPanel(selectedStatsPlayerKey);
    }
  }
}

// Wechselt zwischen "Teams" und "Spieler" -- teilen sich Such-Leiste (User-
// Vorgabe bezog sich nur auf die Team-Tabelle für den Regionsfilter, daher
// hat "Spieler" bewusst KEINEN Regionsfilter, siehe statsAllPlayers()) und
// die Detailspalte rechts (zwei parallele, per .hidden umgeschaltete
// Varianten in index.html, analog zu statsRegionFilter-Umschaltung).
function selectStatsTab(tab) {
  if (statsActiveTab === tab) return;
  statsActiveTab = tab;
  statsSearchQuery = '';
  statsPage = 1;
  statsPlayerPage = 1;
  renderDashboardStatsPanel();
}

// ── "Spieler"-Tab + Spieler-Entwicklung sichtbar machen (Runde 113) ───────
// Flache Liste ALLER Spieler (Starter+Sub) über ALLE Regionen -- inkl. der
// eigenen Org, die (wie bei regionOrgs()) NICHT Teil von ORGANIZATIONS ist
// und separat drangehängt werden muss. Sortiert nach Overall absteigend
// (wie im Referenz-Screenshot), bei Gleichstand nach Spielanzahl. Spalten
// bewusst NICHT die CS2-Werte aus dem Screenshot (K/D, ADR, HS%, MVP, IR),
// sondern echte, aus playerDevelopment getrackte Rocket-League-Werte.
function statsAllPlayers() {
  const orgs = Object.keys(ORG_REGION_LABELS).reduce((all, region) => all.concat(regionOrgs(region)), []);
  const players = [];
  orgs.forEach((org) => {
    if (!org.roster) return;
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    roster.forEach((player) => {
      const key = playerDevKey(org.name, player.name);
      const dev = playerDevelopment[key];
      const matches = dev ? dev.matches : 0;
      players.push({
        org,
        player,
        key,
        dev,
        matches,
        winPct: matches > 0 ? Math.round((dev.wins / matches) * 100) + '%' : 'N/A',
        goals: dev ? dev.goals : 0,
        stars: npcStarRating(player.overall),
      });
    });
  });
  return players.sort((a, b) => b.player.overall - a.player.overall || b.matches - a.matches);
}

function statsPlayerFilteredRows() {
  const rows = statsAllPlayers();
  const q = statsSearchQuery.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.player.name.toLowerCase().includes(q) || r.org.name.toLowerCase().includes(q));
}

function statsPlayerRowHtml(row, rank) {
  const isSelected = row.key === selectedStatsPlayerKey;
  const avatar = CHARACTER_AVATARS.find((a) => a.id === row.player.avatarId) || CHARACTER_AVATARS[0];
  const devLabel = row.dev ? (row.dev.delta >= 0 ? '+' : '') + row.dev.delta.toFixed(1) : '–';
  const devClass = row.dev && row.dev.delta > 0.05 ? ' is-dev-positive' : (row.dev && row.dev.delta < -0.05 ? ' is-dev-negative' : '');
  return (
    '<div class="dashboard-stats-row is-player-row' + (isSelected ? ' is-selected' : '') + '" data-stats-player="' + row.key + '">' +
      '<span class="dashboard-stats-row-rank">' + rank + '</span>' +
      '<div class="dashboard-stats-row-team">' +
        '<div class="dashboard-stats-row-logo" style="background:' + avatar.color + '33;display:flex;align-items:center;justify-content:center;">' + avatar.emoji + '</div>' +
        '<span class="dashboard-stats-row-name">' + row.player.name + '</span>' +
      '</div>' +
      '<span class="dashboard-stats-row-num">' + row.matches + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.winPct + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.goals + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.player.overall + '</span>' +
      '<span class="dashboard-stats-row-num">★ ' + row.stars.toFixed(1) + '</span>' +
      '<span class="dashboard-stats-row-num' + devClass + '">' + devLabel + '</span>' +
    '</div>'
  );
}

function renderStatsPlayerPagination(pageCount) {
  const el = document.getElementById('dashboard-stats-player-pagination');
  if (pageCount <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= pageCount; p++) {
    html += '<button type="button" class="dashboard-stats-page-btn' + (p === statsPlayerPage ? ' is-active' : '') + '" data-stats-player-page="' + p + '">' + p + '</button>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.dashboard-stats-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => { statsPlayerPage = Number(btn.dataset.statsPlayerPage); renderStatsPlayerTable(); });
  });
}

function renderStatsPlayerTable() {
  const all = statsPlayerFilteredRows();
  document.getElementById('dashboard-stats-team-count').textContent = all.length + ' Spieler';

  const pageCount = Math.max(1, Math.ceil(all.length / STATS_PLAYERS_PER_PAGE));
  statsPlayerPage = Math.min(statsPlayerPage, pageCount);
  const start = (statsPlayerPage - 1) * STATS_PLAYERS_PER_PAGE;
  const pageItems = all.slice(start, start + STATS_PLAYERS_PER_PAGE);

  const body = document.getElementById('dashboard-stats-player-table-body');
  body.innerHTML = pageItems.length > 0
    ? pageItems.map((row, i) => statsPlayerRowHtml(row, start + i + 1)).join('')
    : '<div class="dashboard-stats-recent-results-empty">Keine Spieler gefunden.</div>';
  body.querySelectorAll('[data-stats-player]').forEach((row) => {
    row.addEventListener('click', () => renderStatsPlayerDetailPanel(row.dataset.statsPlayer));
  });

  renderStatsPlayerPagination(pageCount);
}

// Ermittelt die stärkste der 6 Statachsen für eine kurze, EHRLICHE
// Beschreibungszeile -- kein erfundener Bio-Text/Rolle wie "AWPer" im
// Referenz-Screenshot (Rocket League kennt diese Rollen nicht, siehe
// data/org-rosters.js: Spieler haben keine Rolle, nur 6 gleichwertige
// Statachsen).
function statsPlayerStrongestStatLabel(player) {
  let best = STAT_LABELS[0];
  STAT_LABELS.forEach((pair) => { if (player[pair[0]] > player[best[0]]) best = pair; });
  return best[1] + ' ' + player[best[0]];
}

function statsPlayerRecentResultRowHtml(entry) {
  return (
    '<div class="dashboard-team-info-result-row">' +
      '<span class="dashboard-team-info-match-opponent">vs. ' + entry.opponent + ' (' + entry.goals + ' Tore)</span>' +
      '<span class="dashboard-team-info-match-outcome ' + (entry.isWin ? 'is-win' : 'is-loss') + '">' + (entry.isWin ? 'SIEG' : 'NIEDERLAGE') + '</span>' +
    '</div>'
  );
}

function renderStatsPlayerDetailPanel(key) {
  selectedStatsPlayerKey = key;
  const sepIdx = key.indexOf('::');
  if (sepIdx === -1) return;
  const orgName = key.slice(0, sepIdx);
  const playerName = key.slice(sepIdx + 2);
  const org = findOrgByName(orgName) || (assignedOrg && assignedOrg.name === orgName ? assignedOrg : null);
  if (!org || !org.roster) return;
  const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
  const player = roster.find((p) => p.name === playerName);
  if (!player) return;
  const dev = playerDevelopment[key];

  const avatar = CHARACTER_AVATARS.find((a) => a.id === player.avatarId) || CHARACTER_AVATARS[0];
  const avatarEl = document.getElementById('dashboard-stats-player-detail-avatar');
  avatarEl.innerHTML = avatar.emoji;
  avatarEl.style.background = avatar.color + '33';

  document.getElementById('dashboard-stats-player-detail-name').textContent = player.name;
  document.getElementById('dashboard-stats-player-detail-team-logo').innerHTML = statsRowLogoHtml(org);
  document.getElementById('dashboard-stats-player-detail-team-name').textContent = org.name;

  const matches = dev ? dev.matches : 0;
  const goals = dev ? dev.goals : 0;
  document.getElementById('dashboard-stats-player-detail-description').textContent =
    'Overall ' + player.overall + ' · stärkste Statachse: ' + statsPlayerStrongestStatLabel(player) + '. ' +
    (matches > 0 ? matches + ' getrackte Spiele, ' + goals + ' Tore.' : 'Noch keine getrackten Spiele.');

  renderStatsFormChartInto('dashboard-stats-player-form-chart', dev && dev.history);

  const recent = dev ? dev.recentGames : [];
  document.getElementById('dashboard-stats-player-recent-results').innerHTML = recent.length > 0
    ? recent.map(statsPlayerRecentResultRowHtml).join('')
    : '<div class="dashboard-stats-recent-results-empty">Keine letzten Spiele.</div>';

  renderStatsPlayerTable(); // Markierung der gewählten Zeile aktualisieren
}

// ── Team-Info-Seite (Runde 111) ───────────────────────────────────────────
// Von Statistiken über "MEHR INFO" für JEDE Org erreichbar (nicht nur die
// eigene) -- spiegelt strukturell die Turnier-Detailseite (openTournamentDetail()/
// closeTournamentDetail()): eigenständiges verstecktes Panel, Zurück-Button
// + jeder Sidebar-Klick verlässt es wieder.
let teamInfoOrgName = null;
// Runde 119: `origin` merkt sich die aufrufende Seite ('stats'|'scouting'|
// 'roster'), damit "Zurück" korrekt dorthin zurückkehrt -- vorher war
// closeTeamInfo() fest auf "Statistiken" verdrahtet, was für die (bereits
// bestehenden) Aufrufe von Scouting/Person-Info aus zwar keinen Absturz,
// aber eine falsche Rücksprung-Seite verursachte. Default bleibt 'stats',
// damit ALLE bestehenden Aufrufe (die keinen origin übergeben) ihr
// bisheriges Verhalten exakt beibehalten.
let teamInfoOrigin = 'stats';

// Verallgemeinerte Fassung von renderSponsorJersey() -- funktioniert für
// JEDE Org, nicht nur assignedOrg. Bot-Orgs haben kein `colorId` (das gibt es
// nur bei selbst erstellten Orgas, siehe ORG_CREATE_COLOR_PRESETS) -- Fallback
// auf orgBadgeColor(org.name), damit jedes Team trotzdem eine eigene,
// konsistente Trikotfarbe bekommt statt immer derselben neutralen Farbe.
function renderTeamInfoJersey(org) {
  const svg = document.getElementById('dashboard-team-info-jersey-svg');
  let color = orgBadgeColor(org.name);
  if (org.colorId) {
    const preset = ORG_CREATE_COLOR_PRESETS.find((c) => c.id === org.colorId);
    if (preset) color = preset.hex;
  }
  svg.querySelector('path').style.fill = color;

  const logoUrl = resolveOrgLogoUrl(org);
  const logoEl = document.getElementById('dashboard-team-info-jersey-logo');
  logoEl.innerHTML = logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div style="background:' + orgBadgeColor(org.name) + ';width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:8px;">' + org.name.trim().charAt(0).toUpperCase() + '</div>';
}

function teamInfoResultRowHtml(entry) {
  return (
    '<div class="dashboard-team-info-result-row">' +
      '<span class="dashboard-team-info-match-opponent">S' + entry.season + ' · ' + entry.eventLabel + '</span>' +
      '<span class="dashboard-stats-recent-result-place">Platz ' + entry.place + '</span>' +
    '</div>'
  );
}

function teamInfoMatchRowHtml(match, orgName) {
  const isWinner = match.winner === orgName;
  const opponent = match.teamA === orgName ? match.teamB : match.teamA;
  const score = match.teamA === orgName ? match.scoreA + ':' + match.scoreB : match.scoreB + ':' + match.scoreA;
  return (
    '<div class="dashboard-team-info-result-row">' +
      '<span class="dashboard-team-info-match-opponent">vs. ' + opponent + ' (' + score + ')</span>' +
      '<span class="dashboard-team-info-match-outcome ' + (isWinner ? 'is-win' : 'is-loss') + '">' + (isWinner ? 'SIEG' : 'NIEDERLAGE') + '</span>' +
    '</div>'
  );
}

function renderTeamInfoPanel() {
  const org = findOrgByName(teamInfoOrgName);
  if (!org) return;

  renderTeamInfoJersey(org);

  const region = orgRegion(org.country);
  const rows = statsTeamRows(region);
  const rank = rows.findIndex((r) => r.org.name === org.name) + 1;
  const points = seasonPoints[org.name] || 0;
  document.getElementById('dashboard-team-info-title').textContent = '#' + (rank || '-') + ' ' + org.name + ' · ' + points + ' Pkt.';

  document.getElementById('dashboard-team-info-flag').src = 'assets/flags/' + (org.country || '').toLowerCase() + '.svg';
  document.getElementById('dashboard-team-info-country').textContent = (CHARACTER_NATIONS.find((n) => n.code === org.country) || {}).name || org.country || 'Unbekannt';
  document.getElementById('dashboard-team-info-stars').innerHTML = starsHtml(orgStarRating(org.strength));
  document.getElementById('dashboard-team-info-description').textContent = org.description || '';

  // "CEO" aus dem Referenz-Screenshot gibt es als Konzept nicht -- zeigt
  // stattdessen den echten Cheftrainer der Org (org.roster.coach, siehe
  // Kopfkommentar am Panel in index.html).
  const coach = org.roster && org.roster.coach;
  if (coach) {
    const avatar = CHARACTER_AVATARS.find((a) => a.id === coach.avatarId) || CHARACTER_AVATARS[0];
    document.getElementById('dashboard-team-info-coach-avatar').innerHTML = avatar.emoji;
    document.getElementById('dashboard-team-info-coach-avatar').style.background = avatar.color + '33';
    document.getElementById('dashboard-team-info-coach-name').textContent = coach.name;
    document.getElementById('dashboard-team-info-coach-flag').src = 'assets/flags/' + (coach.country || '').toLowerCase() + '.svg';
    document.getElementById('dashboard-team-info-coach-country').textContent = (CHARACTER_NATIONS.find((n) => n.code === coach.country) || {}).name || coach.country || 'Unbekannt';
    document.querySelector('.dashboard-team-info-coach-row').classList.remove('hidden');
  } else {
    document.querySelector('.dashboard-team-info-coach-row').classList.add('hidden');
  }

  const stats = careerOrgStats[org.name];
  const recent = (stats && stats.recentResults) || [];
  document.getElementById('dashboard-team-info-recent-results').innerHTML = recent.length > 0
    ? recent.map(teamInfoResultRowHtml).join('')
    : '<div class="dashboard-team-info-results-empty">Keine letzten Turniere.</div>';

  renderStatsFormChartInto('dashboard-team-info-form-chart', teamForm[org.name] && teamForm[org.name].history);

  const recentMatches = matchesForTeam(org.name).slice(-8).reverse();
  document.getElementById('dashboard-team-info-recent-matches').innerHTML = recentMatches.length > 0
    ? recentMatches.map((m) => teamInfoMatchRowHtml(m, org.name)).join('')
    : '<div class="dashboard-team-info-results-empty">Keine aktuellen Spiele.</div>';
}

// Bug-Fix (live gefunden): Team-Info war ursprünglich NUR von Statistiken aus
// erreichbar und versteckte deshalb hart nur `dashboard-page-stats`. Seit
// Person-Info (Runde 118) auch von Scouting aus zu Team-Info verlinken kann,
// reichte das nicht mehr -- ein Klick auf den Team-Namen INNERHALB von
// Person-Info hätte Team-Info sichtbar gemacht, ohne Person-Info selbst zu
// verstecken (beide Seiten gleichzeitig sichtbar/überlappend). Versteckt
// jetzt robust ALLE mit "MEHR INFO"/Namens-Klicks erreichbaren Sub-Seiten,
// unabhängig davon, von welcher aus Team-Info gerade geöffnet wird.
function hideDashboardSubpagesForNavigation() {
  // Defensiv auch den generischen Platzhalter verstecken -- normalerweise
  // längst versteckt (man kommt ja immer über Statistiken/Scouting hierher,
  // die ihn selbst schon ausblenden), aber falls diese Funktion je aus einem
  // unerwarteten Zustand aufgerufen wird, verhindert das ein Layout-Gequetsche
  // durch einen unsichtbar mitlaufenden dritten Flex-Nachbarn.
  document.getElementById('dashboard-page-placeholder').classList.add('hidden');
  document.getElementById('dashboard-page-stats').classList.add('hidden');
  document.getElementById('dashboard-page-scouting').classList.add('hidden');
  document.getElementById('dashboard-page-roster').classList.add('hidden');
  document.getElementById('dashboard-page-team-info').classList.add('hidden');
  document.getElementById('dashboard-page-person-info').classList.add('hidden');
  personInfoIdentity = null;
  personInfoOrigin = null;
}

function openTeamInfo(orgName, origin) {
  teamInfoOrgName = orgName;
  teamInfoOrigin = origin || 'stats';
  hideDashboardSubpagesForNavigation();
  document.getElementById('dashboard-page-team-info').classList.remove('hidden');
  document.getElementById('dashboard-page-title').textContent = 'Organisation | ' + orgName;
  renderTeamInfoPanel();
}

function closeTeamInfo() {
  const origin = teamInfoOrigin || 'stats';
  teamInfoOrgName = null;
  teamInfoOrigin = 'stats';
  document.getElementById('dashboard-page-team-info').classList.add('hidden');
  document.getElementById('dashboard-page-' + origin).classList.remove('hidden');
  document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS[origin] || DASHBOARD_PAGE_LABELS.stats;
  if (origin === 'roster') renderDashboardKaderPanel();
  else renderDashboardStatsPanel();
}

// ── "Person-Info"-Seite (Runde 118) ───────────────────────────────────────
// Eine gemeinsame Detailseite für Spieler UND Mitarbeiter -- erreichbar von
// Statistiken (Spieler-Tab "MEHR INFO") UND von Scouting (Spieler- und
// Personal-Tab, Namens-Zelle). Identität wird über org+name+role aufgelöst
// (Namen sind ligaweit NICHT eindeutig, siehe playerDevelopment-
// Kopfkommentar, dasselbe Prinzip wie überall sonst in diesem Projekt).
// `origin` merkt sich, von welcher Seite/welchem Tab aus geöffnet wurde,
// damit "Zurück" korrekt dorthin zurückkehrt (anders als Team-Info, das
// IMMER von Statistiken kommt, kann diese Seite von 3 verschiedenen Stellen
// erreicht werden).
let personInfoIdentity = null; // { orgName, personName, role }
let personInfoOrigin = null; // { page: 'stats' } | { page: 'scouting', tab: 'players'|'staff' }

function resolvePersonByIdentity(orgName, personName, role) {
  const org = findOrgByName(orgName) || (assignedOrg && assignedOrg.name === orgName ? assignedOrg : null);
  if (!org || !org.roster) return null;
  let person = null;
  if (role === 'Coach') {
    person = org.roster.coach;
  } else if (role === 'Starter' || role === 'Sub') {
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    person = roster.find((p) => p.name === personName) || null;
  } else if (role === 'Reserve') {
    // Runde 122: neue Reserve-Kategorie (Kader-Seite) -- eigener Pfad, da
    // org.roster.reserve weder Starter/Sub noch eine der 9 Personal-Rollen ist.
    person = (org.roster.reserve || []).find((p) => p.name === personName) || null;
  } else {
    person = (org.roster.staff || []).find((s) => s.role === role && s.name === personName) || null;
  }
  if (!person || person.name !== personName) return null;
  return { org, person, role };
}

// Kurze, EHRLICHE Beschreibungszeile -- keine erfundene Bio/Rolle (dasselbe
// Prinzip wie schon beim Statistiken-Spieler-Tab, Runde 113). Statachsen gibt
// es nur bei Spielern/Coach (rollPlayer()), nicht bei den 9 regulären
// Mitarbeiter-Rollen (rollStaff()).
function personInfoDescription(person) {
  const hasStats = PLAYER_STAT_KEYS.every((k) => typeof person[k] === 'number');
  return 'Overall ' + person.overall + (hasStats ? ' · stärkste Statachse: ' + statsPlayerStrongestStatLabel(person) : '') + '.';
}

// Statistiken-Spieler-Tab/playerDevelopment adressieren Spieler über den
// 'orgName::playerName'-Schlüssel (ohne Rolle) -- löst Starter/Sub selbst
// auf, bevor openPersonInfo() (das die Rolle explizit braucht) aufgerufen wird.
function openPersonInfoFromDevKey(key, origin) {
  const sepIdx = key.indexOf('::');
  if (sepIdx === -1) return;
  const orgName = key.slice(0, sepIdx);
  const playerName = key.slice(sepIdx + 2);
  const org = findOrgByName(orgName) || (assignedOrg && assignedOrg.name === orgName ? assignedOrg : null);
  if (!org || !org.roster) return;
  const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
  const player = roster.find((p) => p.name === playerName);
  if (!player) return;
  const role = org.roster.starters.includes(player) ? 'Starter' : 'Sub';
  openPersonInfo(orgName, playerName, role, origin);
}

function openPersonInfo(orgName, personName, role, origin) {
  const resolvedOrigin = origin || { page: 'stats' };
  hideDashboardSubpagesForNavigation();
  personInfoIdentity = { orgName, personName, role };
  personInfoOrigin = resolvedOrigin;
  document.getElementById('dashboard-page-person-info').classList.remove('hidden');
  document.getElementById('dashboard-page-title').textContent = 'Profil';
  renderPersonInfoPanel();
}

function closePersonInfo() {
  const origin = personInfoOrigin || { page: 'stats' };
  personInfoIdentity = null;
  personInfoOrigin = null;
  document.getElementById('dashboard-page-person-info').classList.add('hidden');
  document.getElementById('dashboard-page-' + origin.page).classList.remove('hidden');
  if (origin.page === 'scouting') {
    document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS.scouting;
    if (origin.tab) scoutingActiveTab = origin.tab;
    renderDashboardScoutingPanel();
  } else if (origin.page === 'roster') {
    document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS.roster;
    renderDashboardKaderPanel();
  } else {
    document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS.stats;
    renderDashboardStatsPanel();
  }
}

function renderPersonInfoPanel() {
  if (!personInfoIdentity) return;
  const resolved = resolvePersonByIdentity(personInfoIdentity.orgName, personInfoIdentity.personName, personInfoIdentity.role);
  if (!resolved) { closePersonInfo(); return; }
  const { org, person, role } = resolved;

  const avatar = CHARACTER_AVATARS.find((a) => a.id === person.avatarId) || CHARACTER_AVATARS[0];
  const avatarEl = document.getElementById('dashboard-person-info-avatar');
  avatarEl.innerHTML = avatar.emoji;
  avatarEl.style.background = avatar.color + '33';

  document.getElementById('dashboard-person-info-title').textContent = person.name;
  document.getElementById('dashboard-person-info-flag').src = 'assets/flags/' + (person.country || '').toLowerCase() + '.svg';
  document.getElementById('dashboard-person-info-country').textContent = (CHARACTER_NATIONS.find((n) => n.code === person.country) || {}).name || person.country || 'Unbekannt';
  document.getElementById('dashboard-person-info-stars').innerHTML = starsHtml(npcStarRating(person.overall));
  document.getElementById('dashboard-person-info-description').textContent = personInfoDescription(person);

  document.getElementById('dashboard-person-info-age').textContent = person.age;
  document.getElementById('dashboard-person-info-contract').textContent = formatContractDate(person.contractStart) + ' – ' + formatContractDate(person.contractEnd);
  document.getElementById('dashboard-person-info-potential').textContent = '★ ' + scoutingPotentialStars(person).toFixed(1);
  document.getElementById('dashboard-person-info-value').textContent = formatMoney(calculatePrice(person.overall));

  // Runde 121: Gehalt gibt es aktuell nur für Spieler (Starter/Sub) --
  // Personal/Coach-Verpflichtungen bleiben diese Runde gesperrt (siehe
  // scoutingStaffRowHtml()-Kommentar), ein Gehalt dafür anzuzeigen wäre
  // irreführend.
  const isPlayerRole = role === 'Starter' || role === 'Sub' || role === 'Reserve';
  document.getElementById('dashboard-person-info-salary-fact').classList.toggle('hidden', !isPlayerRole);
  if (isPlayerRole) {
    document.getElementById('dashboard-person-info-salary').textContent = formatMoney(playerMonthlySalary(person)) + '/Monat';
  }

  document.getElementById('dashboard-person-info-role').textContent = role;
  document.getElementById('dashboard-person-info-team-logo').innerHTML = statsRowLogoHtml(org);
  const teamNameEl = document.getElementById('dashboard-person-info-team-name');
  teamNameEl.textContent = org.name;
  teamNameEl.onclick = () => openTeamInfo(org.name);

  // Statachsen -- nur bei Spielern/Coach (rollPlayer()), nicht bei den 9
  // regulären Mitarbeiter-Rollen (rollStaff() hat keine 6 Statachsen).
  const hasStats = PLAYER_STAT_KEYS.every((k) => typeof person[k] === 'number');
  document.getElementById('dashboard-person-info-stats-section').classList.toggle('hidden', !hasStats);
  if (hasStats) {
    document.getElementById('dashboard-person-info-stats').innerHTML = STAT_LABELS.map(([key, label]) => (
      '<div class="dashboard-person-info-stat-row">' +
        '<span class="dashboard-person-info-stat-label">' + label + '</span>' +
        '<div class="dashboard-person-info-stat-track"><div class="dashboard-person-info-stat-fill" style="width:' + person[key] + '%;"></div></div>' +
        '<span class="dashboard-person-info-stat-value">' + person[key] + '</span>' +
      '</div>'
    )).join('');
  }

  // Entwicklungs-Verlauf/letzte Ergebnisse -- nur wenn playerDevelopment
  // tatsächlich Daten hat (mindestens 1 getracktes Spiel). Mitarbeiter/Coach
  // sind nicht an das Entwicklungssystem (Runde 113) angebunden.
  const dev = playerDevelopment[playerDevKey(org.name, person.name)];
  const hasChart = !!(dev && dev.history && dev.history.length > 1);
  document.getElementById('dashboard-person-info-chart-card').classList.toggle('hidden', !hasChart);
  if (hasChart) renderStatsFormChartInto('dashboard-person-info-chart', dev.history);

  const hasResults = !!(dev && dev.recentGames && dev.recentGames.length > 0);
  document.getElementById('dashboard-person-info-results-card').classList.toggle('hidden', !hasResults);
  if (hasResults) {
    document.getElementById('dashboard-person-info-recent-results').innerHTML = dev.recentGames.map(statsPlayerRecentResultRowHtml).join('');
  }
}

// ── Dashboard-Seite "Transfers" (Runde 114) ───────────────────────────────
// User-Vorgabe: NUR die Übersichts-/Log-Seite wird hier gebaut -- das
// eigentliche Kaufen/Verkaufen kommt bewusst NICHT hierher, sondern in einer
// späteren Runde auf die "Scouting"-Seite. "Meine Transfers"/"Weltweite
// Transfers" lesen aus dem bereits bestehenden `transferLog` (siehe
// logTransfer() weiter oben, bislang nur vom alten screen-draft-
// Verhandlungsflow beschrieben, der seit "Neues Spiel"/"Fortsetzen" direkt
// zum Dashboard nicht mehr durchlaufen wird) -- bleibt im normalen neuen
// Spielfluss also aktuell leer und zeigt ehrlich "Keine Ergebnisse" (genau
// wie im User-Referenz-Screenshot), statt erfundener Einträge. WICHTIG für
// eine künftige Kauf/Verkauf-Mechanik auf "Scouting": muss weiterhin über
// logTransfer() (dieselbe {season, from, to, player, price}-Form) schreiben,
// damit diese Seite UND die bestehenden financeExpenseTransfers()/
// financeIncomeTransfers()-Aggregationen (Finanzen-Seite) automatisch
// korrekt bleiben.
let transfersActiveTab = 'mine';

// `status:'pending'` (siehe dashboardTransfersInProgressEntries() weiter
// unten) ausgeschlossen -- "Meine Transfers" ist die ABGESCHLOSSENE Historie
// (echtes TRANSFERDATUM je Zeile), ein noch laufender Transfer hat noch kein
// echtes Abschlussdatum und gehört ausschließlich in den Transferliste-Tab.
// Beide Tabs bleiben dadurch garantiert überschneidungsfrei.
function dashboardTransfersMineEntries() {
  return transferLog.filter((t) => (t.from === assignedOrg.name || t.to === assignedOrg.name) && t.status !== 'pending');
}

// transferLog wird per unshift() befüllt (siehe logTransfer()) -- dadurch
// bereits neueste-zuerst sortiert, keine eigene Sortierung nötig. Ebenfalls
// nur abgeschlossene Transfers (s.o.).
function dashboardTransfersWorldEntries() {
  return transferLog.filter((t) => t.status !== 'pending');
}

// User-Korrektur (Runde 115): "Transferliste" ist KEIN allgemeiner
// Marktüberblick über alle Spieler ligaweit (das war die ursprüngliche
// Runde-114-Fassung) -- soll stattdessen NUR meine eigenen, aktuell
// LAUFENDEN Transfers zeigen. `transferLog`-Einträge werden aber erst beim
// ABSCHLUSS eines Transfers geschrieben (siehe logTransfer()) -- es gibt
// aktuell (noch) KEIN Konzept für "laufend"/"in Verhandlung" (kein
// Gebots-/Verhandlungsstatus-Feld), weil die eigentliche Kauf/Verkauf-
// Mechanik bewusst erst später auf "Scouting" gebaut wird (siehe Kopf-
// kommentar oben). Ehrlich leer statt erfunden, bis diese Mechanik
// tatsächlich einen offenen Status kennt -- dieselbe "keine Daten statt
// Fake-Daten"-Linie wie bei "Meine Transfers"/"Weltweite Transfers".
function dashboardTransfersInProgressEntries() {
  return transferLog.filter((t) => (t.from === assignedOrg.name || t.to === assignedOrg.name) && t.status === 'pending');
}

// Best-effort-Auflösung der AKTUELLEN Spieler-Info zu einem reinen Namen aus
// transferLog -- der Log speichert (bewusst schlank) nur den Namen, keinen
// orgName::playerName-Schlüssel wie playerDevelopment (siehe dessen
// Kopfkommentar zur Namensgleichstand-Problematik: Spielernamen sind NICHT
// eindeutig über alle Orgas). Sucht zuerst in der Zielorg (`to`, meist noch
// aktuell), dann in der Herkunftsorg -- bei einem seltenen Namensgleichstand
// könnte das die falsche Person treffen; disclosed Randfall, betrifft nur
// die Anzeige (ROLLE/BEWERTUNG/NATION), nie Preis/Datum/Von/An, die direkt
// aus dem Log-Eintrag selbst kommen.
function resolveTransferLogPlayerInfo(entry) {
  // Zweiter Bug-Fix-Teil (User-Meldung: "soll man alle sehen vom gekauften
  // die Rolle/Bewertung/Nation, kein '-'"): ein GERADE gekaufter Spieler
  // (Runde 122, 7-Tage-Ankunftsverzögerung) steht zwischen Kauf und
  // tatsächlicher Ankunft WEDER in roster.starters/.sub/.reserve NOCH
  // sonstwo im Kader -- er wartet ausschließlich in pendingPlayerArrivals
  // (nur für assignedOrg relevant, siehe dessen Kopfkommentar). Ohne diesen
  // Check zeigte JEDER frisch gekaufte Spieler bis zu 7 Tage lang "-" statt
  // echter Werte, obwohl logTransfer() den Transfer schon sofort beim Kauf
  // einträgt (executePlayerSigning()), nicht erst bei der Ankunft.
  const pending = pendingPlayerArrivals.find((a) => a.player.name === entry.player);
  if (pending) {
    return { role: 'Unterwegs', stars: npcStarRating(pending.player.overall), country: pending.player.country };
  }
  // Dritter Bug-Fix-Teil (User-Meldung: "Daten verschwinden sobald die
  // Spieler angekommen sind"): eine per "Eigene Org gründen" erstellte Org
  // steht NIE in der globalen ORGANIZATIONS-Liste (siehe deren Kopfkommentar
  // in organizations.js) -- rohes findOrgByName(entry.to) fand die eigene
  // Org deshalb nie, sobald `entry.to === assignedOrg.name` eine SELBST
  // ERSTELLTE Org war. Solange der Spieler noch in pendingPlayerArrivals
  // wartete, griff der Zweig oben (der nicht über findOrgByName läuft) --
  // erst NACH der Ankunft (jetzt im eigenen roster.reserve) fiel die Suche
  // auf diesen Zweig zurück und lief für eine eigene Org komplett ins Leere.
  // resolveOrgByNameOrOwn() (Runde 93, exakt für diesen Fall gebaut) bevorzugt
  // assignedOrg per Referenz, bevor es auf findOrgByName() zurückfällt.
  const candidateOrgs = [resolveOrgByNameOrOwn(entry.to), resolveOrgByNameOrOwn(entry.from)].filter(Boolean);
  for (const org of candidateOrgs) {
    if (!org.roster) continue;
    // Bug-Fix (User-Meldung: "Rolle/Nation/Bewertung leer bei Transfers"):
    // suchte bisher NUR in starters/sub -- seit Runde 122 landet ein
    // Neuzugang aber zuerst in roster.reserve (nicht mehr direkt im
    // Hauptkader), und Personal-Transfers (Coach/die 9 Stab-Rollen, Runde
    // 117) wurden hier nie überhaupt berücksichtigt. Deckt jetzt den
    // kompletten Kader ab.
    if (org.roster.starters && org.roster.starters.some((p) => p.name === entry.player)) {
      const player = org.roster.starters.find((p) => p.name === entry.player);
      return { role: 'Starter', stars: npcStarRating(player.overall), country: player.country };
    }
    if (org.roster.sub && org.roster.sub.name === entry.player) {
      return { role: 'Sub', stars: npcStarRating(org.roster.sub.overall), country: org.roster.sub.country };
    }
    if (org.roster.reserve && org.roster.reserve.some((p) => p.name === entry.player)) {
      const player = org.roster.reserve.find((p) => p.name === entry.player);
      return { role: 'Reserve', stars: npcStarRating(player.overall), country: player.country };
    }
    if (org.roster.coach && org.roster.coach.name === entry.player) {
      return { role: 'Coach', stars: npcStarRating(org.roster.coach.overall), country: org.roster.coach.country };
    }
    if (org.roster.staff && org.roster.staff.some((s) => s.name === entry.player)) {
      const staffMember = org.roster.staff.find((s) => s.name === entry.player);
      return { role: staffMember.role, stars: npcStarRating(staffMember.overall), country: staffMember.country };
    }
  }
  return null;
}

function dashboardTransferLogRowHtml(entry) {
  const info = resolveTransferLogPlayerInfo(entry);
  const nationLabel = info && info.country ? ((CHARACTER_NATIONS.find((n) => n.code === info.country) || {}).name || info.country) : '–';
  return (
    '<div class="dashboard-stats-row dashboard-transfers-log-row">' +
      '<span class="dashboard-transfers-cell dashboard-transfers-cell-name">' + entry.player + '</span>' +
      '<span class="dashboard-transfers-cell">' + (info ? info.role : '–') + '</span>' +
      '<span class="dashboard-transfers-cell">' + (info ? '★ ' + info.stars.toFixed(1) : '–') + '</span>' +
      '<span class="dashboard-transfers-cell">' + nationLabel + '</span>' +
      '<span class="dashboard-transfers-cell">' + entry.from + '</span>' +
      '<span class="dashboard-transfers-cell">' + entry.to + '</span>' +
      '<span class="dashboard-transfers-cell">' + (entry.date ? formatDashboardDate(entry.date).dateLine : 'Saison ' + entry.season) + '</span>' +
      '<span class="dashboard-transfers-price">' + formatMoney(entry.price) + '</span>' +
    '</div>'
  );
}

const TRANSFERS_TAB_EMPTY_LABELS = {
  mine: 'Keine Ergebnisse',
  world: 'Keine Ergebnisse',
  list: 'Keine laufenden Transfers',
};

function renderDashboardTransfersLogView() {
  const entries = transfersActiveTab === 'mine' ? dashboardTransfersMineEntries()
    : transfersActiveTab === 'world' ? dashboardTransfersWorldEntries()
    : dashboardTransfersInProgressEntries();
  const body = document.getElementById('dashboard-transfers-log-body');
  body.innerHTML = entries.length > 0
    ? entries.map(dashboardTransferLogRowHtml).join('')
    : '<div class="dashboard-transfers-empty">' + TRANSFERS_TAB_EMPTY_LABELS[transfersActiveTab] + '</div>';
}

function renderDashboardTransfersPanel() {
  const isOpen = isTransferWindowOpen(careerDate);
  const banner = document.getElementById('dashboard-transfer-window-banner');
  banner.textContent = 'Transferfenster: ' + (isOpen ? 'Geöffnet' : 'Geschlossen');
  banner.classList.toggle('is-open', isOpen);
  banner.classList.toggle('is-closed', !isOpen);

  document.querySelectorAll('[data-transfers-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.transfersTab === transfersActiveTab));
  renderDashboardTransfersLogView();
}

function selectTransfersTab(tab) {
  if (transfersActiveTab === tab) return;
  transfersActiveTab = tab;
  renderDashboardTransfersPanel();
}

// ── Dashboard-Seite "Scouting" (Runde 116) ────────────────────────────────
// User-Vorgabe: UI wie im CS2-Referenz-Screenshot, an Rocket League angepasst
// -- Kaufen/Verkaufen bewusst NICHT hier gebaut (kommt in einer späteren
// Runde). "Personal"-Tab bleibt Platzhalter (kein Referenz-Layout dafür
// bekannt). ROLLE = Starter/Sub (echte Kader-Unterscheidung, keine erfundene
// Shooter-Rolle wie im Screenshot). VERTRAGSENDE/GEHALT bewusst weggelassen
// -- es gibt weder Vertragslaufzeiten noch Einzelgehälter im Spiel, kein
// erfundener Wert (dieselbe Linie wie schon bei "ALTER" auf der Transfers-
// Seite). ALTER ist diesmal ECHT (rollPlayer(), data/org-rosters.js, Runde
// 116) -- POTENZIAL ist eine daraus abgeleitete, transparente Projektion
// (scoutingPotentialStars()), keine beliebige Zufallszahl: jüngere Spieler
// bekommen einen Aufschlag auf ihre aktuelle Sterne-Bewertung, der mit
// steigendem Alter gegen 0 geht. Reine Anzeige -- wirkt (noch) NICHT auf die
// tatsächliche Entwicklungs-Obergrenze in applyPlayerDevelopmentDelta()
// (Runde 113) ein, disclosed im Abschlussbericht.
let scoutingActiveTab = 'players';
let scoutingSearchQuery = '';
let scoutingPage = 1;
let scoutingRegionFilter = '';
let scoutingMinRating = 0;
const SCOUTING_PLAYERS_PER_PAGE = 20;

function scoutingPotentialStars(player) {
  const currentStars = npcStarRating(player.overall);
  const ageFactor = Math.max(0, (26 - player.age) / 10);
  const boosted = Math.min(5, currentStars + ageFactor * 1.5);
  return Math.round(boosted * 2) / 2;
}

// Flache Liste aller Spieler ligaweit außer der eigenen Org (die scoutet man
// nicht, man hat sie schon) -- wiederverwendet dasselbe Org-Sammel-Muster wie
// statsAllPlayers()/die (in Runde 115 entfernte) Transferliste-Marktübersicht.
function scoutingAllPlayers() {
  const orgs = Object.keys(ORG_REGION_LABELS).reduce((all, region) => all.concat(regionOrgs(region)), []);
  const rows = [];
  orgs.forEach((org) => {
    if (!org.roster || org.name === assignedOrg.name) return;
    const region = orgRegion(org.country);
    const roster = [...(org.roster.starters || []), org.roster.sub].filter(Boolean);
    roster.forEach((player) => {
      rows.push({
        org, player, region,
        role: org.roster.starters.includes(player) ? 'Starter' : 'Sub',
        stars: npcStarRating(player.overall),
        potential: scoutingPotentialStars(player),
        marketValue: calculatePrice(player.overall),
      });
    });
  });
  // Runde 120, User-Vorgabe: "bei scoutinmg sollen auch die freien personal
  // und spierl angezeigt werden" -- derselbe Free-Agent-Pool (data/free-
  // agents.js), aus dem sich auch verkaufende Bot-Orgs bei einem Transfer
  // bedienen (siehe executePlayerSigning()). `org: null` markiert die Zeile
  // als Free Agent (kein Team, kein Vertrag, keine Rolle) -- signierte Free
  // Agents verschwinden aus der Liste (signedFreeAgentPlayers-Set).
  freeAgentPlayerPool().forEach((player) => {
    if (signedFreeAgentPlayers.has(player.name)) return;
    rows.push({
      org: null, player, region: null, role: '',
      stars: npcStarRating(player.overall),
      potential: scoutingPotentialStars(player),
      marketValue: calculatePrice(player.overall),
    });
  });
  return rows.sort((a, b) => b.player.overall - a.player.overall);
}

function scoutingFilteredRows() {
  let rows = scoutingAllPlayers();
  if (scoutingRegionFilter) rows = rows.filter((r) => r.region === scoutingRegionFilter);
  if (scoutingMinRating > 0) rows = rows.filter((r) => r.stars >= scoutingMinRating);
  const q = scoutingSearchQuery.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.player.name.toLowerCase().includes(q) || (r.org && r.org.name.toLowerCase().includes(q)));
  return rows;
}

// Team-Zelle ist anklickbar (öffnet die bestehende Team-Info-Seite, Runde
// 111) -- der Spielername selbst NICHT, da es noch keine Spieler-Detailseite
// gibt (disclosed Scope-Grenze, wie beim Statistiken-Spieler-Tab). Free-
// Agent-Zeilen (Runde 120, row.org === null) haben WEDER Team-Info noch
// Person-Info (kein Team, kein Vertrag/keine Rolle für resolvePersonByIdentity())
// -- Namens-/Team-Zelle bleiben dort bewusst nicht anklickbar, zeigen
// stattdessen andersfarbig "Free Agent". AKTION-Spalte (Runde 120, User-
// Vorgabe "spieler auch kaufen können") funktioniert für beide Fälle gleich,
// siehe signScoutingPlayer()/executePlayerSigning().
function scoutingRowHtml(row) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === row.player.avatarId) || CHARACTER_AVATARS[0];
  const nationLabel = (CHARACTER_NATIONS.find((n) => n.code === row.player.country) || {}).name || row.player.country || '–';
  const isFreeAgent = !row.org;
  const nameCellHtml = isFreeAgent
    ? '<div class="dashboard-scouting-row-team">' +
        '<div class="dashboard-stats-row-logo" style="background:' + avatar.color + '33;display:flex;align-items:center;justify-content:center;">' + avatar.emoji + '</div>' +
        '<span class="dashboard-transfers-cell-name" title="' + row.player.name + '">' + row.player.name + '</span>' +
      '</div>'
    : '<div class="dashboard-scouting-row-team" data-scouting-person="' + row.org.name + '::' + row.player.name + '::' + row.role + '">' +
        '<div class="dashboard-stats-row-logo" style="background:' + avatar.color + '33;display:flex;align-items:center;justify-content:center;">' + avatar.emoji + '</div>' +
        '<span class="dashboard-transfers-cell-name" title="' + row.player.name + '">' + row.player.name + '</span>' +
      '</div>';
  const teamCellHtml = isFreeAgent
    ? '<div class="dashboard-scouting-row-team"><span class="dashboard-scouting-free-agent-label">Free Agent</span></div>'
    : '<div class="dashboard-scouting-row-team" data-scouting-team="' + row.org.name + '">' +
        '<div class="dashboard-stats-row-logo">' + statsRowLogoHtml(row.org) + '</div>' +
        '<span class="dashboard-transfers-cell-name" title="' + row.org.name + '">' + row.org.name + '</span>' +
      '</div>';
  const windowOpen = isTransferWindowOpen(careerDate);
  const reserveHasRoom = reserveSlotsOccupied() < KADER_RESERVE_SLOTS;
  const affordable = row.marketValue <= (financeAllocation.transfers || 0) && row.marketValue <= assignedOrg.budget;
  // Runde 121, User-Vorgabe: ein Kauf darf nicht nur den einmaligen Preis
  // decken, sondern muss auch das LAUFENDE Monatsgehalt tragen können.
  // Runde 122: kein Tausch mehr -- der Neuzugang kommt zur Reserve DAZU
  // (siehe executePlayerSigning()), das Gehalt wird deshalb rein addiert.
  const salaryAffordable = (totalMonthlySalaryCommitment(assignedOrg) + playerMonthlySalary(row.player)) <= (financeAllocation.salaries || 0);
  const canSign = windowOpen && reserveHasRoom && affordable && salaryAffordable;
  const disabledReason = !windowOpen ? 'Nur im geöffneten Transferfenster möglich'
    : (!reserveHasRoom ? 'Kein Platz mehr im Kader -- verkaufe zuerst einen Spieler'
    : (!affordable ? 'Transferbudget oder Gesamtbudget zu niedrig'
    : (!salaryAffordable ? 'Nicht genug Geld bei Gehälter' : '')));
  return (
    '<div class="dashboard-stats-row dashboard-scouting-row">' +
      nameCellHtml +
      '<span class="dashboard-transfers-cell">' + (row.role || '–') + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.player.age + '</span>' +
      '<span class="dashboard-stats-row-num">★ ' + row.stars.toFixed(1) + '</span>' +
      '<span class="dashboard-transfers-cell">' + nationLabel + '</span>' +
      '<span class="dashboard-stats-row-num">★ ' + row.potential.toFixed(1) + '</span>' +
      '<span class="dashboard-transfers-cell">' + (row.player.contractEnd ? formatContractDate(row.player.contractEnd) : '–') + '</span>' +
      '<span class="dashboard-transfers-price">' + formatMoney(row.marketValue) + '</span>' +
      '<span class="dashboard-transfers-price">' + formatMoney(playerMonthlySalary(row.player)) + '</span>' +
      teamCellHtml +
      '<button type="button" class="dashboard-scouting-sign-btn' + (canSign ? '' : ' is-locked') + '" data-scouting-buy-org="' + (row.org ? row.org.name : '') + '" data-scouting-buy-name="' + row.player.name + '"' +
        (disabledReason ? ' title="' + disabledReason + '"' : '') +
      '>Verpflichten</button>' +
    '</div>'
  );
}

function renderScoutingPagination(pageCount) {
  const el = document.getElementById('dashboard-scouting-pagination');
  if (pageCount <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= pageCount; p++) {
    html += '<button type="button" class="dashboard-stats-page-btn' + (p === scoutingPage ? ' is-active' : '') + '" data-scouting-page="' + p + '">' + p + '</button>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.dashboard-stats-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => { scoutingPage = Number(btn.dataset.scoutingPage); renderScoutingPlayersView(); });
  });
}

function renderScoutingPlayersView() {
  const all = scoutingFilteredRows();
  const pageCount = Math.max(1, Math.ceil(all.length / SCOUTING_PLAYERS_PER_PAGE));
  scoutingPage = Math.min(scoutingPage, pageCount);
  const start = (scoutingPage - 1) * SCOUTING_PLAYERS_PER_PAGE;
  const pageItems = all.slice(start, start + SCOUTING_PLAYERS_PER_PAGE);

  const body = document.getElementById('dashboard-scouting-players-body');
  body.innerHTML = pageItems.length > 0
    ? pageItems.map(scoutingRowHtml).join('')
    : '<div class="dashboard-transfers-empty">Keine Spieler gefunden.</div>';
  body.querySelectorAll('[data-scouting-team]').forEach((el) => {
    el.addEventListener('click', () => openTeamInfo(el.dataset.scoutingTeam));
  });
  body.querySelectorAll('[data-scouting-person]').forEach((el) => {
    el.addEventListener('click', () => {
      const [orgName, personName, role] = el.dataset.scoutingPerson.split('::');
      openPersonInfo(orgName, personName, role, { page: 'scouting', tab: 'players' });
    });
  });
  body.querySelectorAll('[data-scouting-buy-name]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = findScoutingPlayerRow(btn.dataset.scoutingBuyOrg, btn.dataset.scoutingBuyName);
      if (row) signScoutingPlayer(row);
    });
  });

  renderScoutingPagination(pageCount);
}

// Wie findScoutingStaffRow() -- Identität über Org+Name statt Array-Index,
// da sich die zugrundeliegende Liste zwischen Render und Klick ändern kann.
// Org-leer ("") identifiziert eine Free-Agent-Zeile (row.org === null).
function findScoutingPlayerRow(orgName, playerName) {
  return scoutingAllPlayers().find((r) => (orgName ? r.org && r.org.name === orgName : !r.org) && r.player.name === playerName);
}

// ── "Personal"-Tab (Runde 117) -- wie "Spieler", aber mit echter
// Verpflichtungs-Mechanik (User-Vorgabe: "da kann man Coach, Psychologe etc.
// kaufen bzw. verhandeln"). Coach (org.roster.coach, eigenes Feld) UND die 9
// regulären Rollen (org.roster.staff) fließen beide ein.
let scoutingStaffPage = 1;
const SCOUTING_STAFF_PER_PAGE = 20;

function scoutingAllStaff() {
  const orgs = Object.keys(ORG_REGION_LABELS).reduce((all, region) => all.concat(regionOrgs(region)), []);
  const rows = [];
  orgs.forEach((org) => {
    if (!org.roster || org.name === assignedOrg.name) return;
    const region = orgRegion(org.country);
    const people = [];
    if (org.roster.coach) people.push({ person: org.roster.coach, role: 'Coach' });
    (org.roster.staff || []).forEach((s) => people.push({ person: s, role: s.role }));
    people.forEach(({ person, role }) => {
      rows.push({
        org, person, role, region,
        stars: npcStarRating(person.overall),
        potential: scoutingPotentialStars(person),
        marketValue: calculatePrice(person.overall),
      });
    });
  });
  // Runde 120: freies Personal (nur die 9 regulären Rollen -- für Coaches
  // gibt es KEINEN Free-Agent-Pool, siehe buildCustomOrgFromForm()-Kommentar
  // "Kein Free-Agent-Pool für Coaches vorhanden", dasselbe Prinzip gilt hier).
  ORG_ROSTER_STAFF_ROLES.forEach((role) => {
    freeAgentStaffPool(role).forEach((person) => {
      if (signedFreeAgentStaff.has(role + '::' + person.name)) return;
      rows.push({
        org: null, person, role, region: null,
        stars: npcStarRating(person.overall),
        potential: scoutingPotentialStars(person),
        marketValue: calculatePrice(person.overall),
      });
    });
  });
  return rows.sort((a, b) => b.person.overall - a.person.overall);
}

function scoutingStaffFilteredRows() {
  let rows = scoutingAllStaff();
  if (scoutingRegionFilter) rows = rows.filter((r) => r.region === scoutingRegionFilter);
  if (scoutingMinRating > 0) rows = rows.filter((r) => r.stars >= scoutingMinRating);
  const q = scoutingSearchQuery.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.person.name.toLowerCase().includes(q) || (r.org && r.org.name.toLowerCase().includes(q)) || r.role.toLowerCase().includes(q));
  return rows;
}

// Re-sucht eine Zeile anhand einer stabilen Identität (Org+Name+Rolle) statt
// eines Array-Index -- Personennamen sind ligaweit NICHT eindeutig (siehe
// playerDevelopment-Kopfkommentar, gleiches Prinzip), ein reiner Index wäre
// zudem fragil, sobald sich die zugrundeliegende Liste zwischen Render und
// Klick verändert (z.B. durch eine gerade erst abgeschlossene Verpflichtung).
// Org-leer ("") identifiziert eine Free-Agent-Zeile (row.org === null).
function findScoutingStaffRow(orgName, personName, role) {
  return scoutingAllStaff().find((r) => (orgName ? r.org && r.org.name === orgName : !r.org) && r.person.name === personName && r.role === role);
}

function scoutingStaffRowHtml(row) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === row.person.avatarId) || CHARACTER_AVATARS[0];
  const nationLabel = (CHARACTER_NATIONS.find((n) => n.code === row.person.country) || {}).name || row.person.country || '–';
  // Runde 121, User-Vorgabe ("Personal soll erstmal gesperrt sein"): der
  // Verpflichten-Button bleibt für JEDE Personal-Zeile deaktiviert, egal ob
  // Transferfenster/Budget an sich passen würden -- Fenster-/Budget-Logik
  // bewusst nicht gelöscht (nur überschrieben), damit sie bei einer späteren
  // Freischaltung sofort wieder greift.
  const canSign = false;
  const disabledReason = 'Kommt in einem späteren Update';
  const isFreeAgent = !row.org;
  const nameCellHtml = (isFreeAgent ? '<div class="dashboard-scouting-row-team">' : '<div class="dashboard-scouting-row-team" data-scouting-person="' + row.org.name + '::' + row.person.name + '::' + row.role + '">') +
      '<div class="dashboard-stats-row-logo" style="background:' + avatar.color + '33;display:flex;align-items:center;justify-content:center;">' + avatar.emoji + '</div>' +
      '<span class="dashboard-transfers-cell-name" title="' + row.person.name + '">' + row.person.name + '</span>' +
    '</div>';
  const teamCellHtml = isFreeAgent
    ? '<div class="dashboard-scouting-row-team"><span class="dashboard-scouting-free-agent-label">Free Agent</span></div>'
    : '<div class="dashboard-scouting-row-team" data-scouting-team="' + row.org.name + '">' +
        '<div class="dashboard-stats-row-logo">' + statsRowLogoHtml(row.org) + '</div>' +
        '<span class="dashboard-transfers-cell-name" title="' + row.org.name + '">' + row.org.name + '</span>' +
      '</div>';
  return (
    '<div class="dashboard-stats-row dashboard-scouting-staff-row">' +
      nameCellHtml +
      '<span class="dashboard-transfers-cell">' + row.role + '</span>' +
      '<span class="dashboard-stats-row-num">' + row.person.age + '</span>' +
      '<span class="dashboard-stats-row-num">★ ' + row.stars.toFixed(1) + '</span>' +
      '<span class="dashboard-transfers-cell">' + nationLabel + '</span>' +
      '<span class="dashboard-stats-row-num">★ ' + row.potential.toFixed(1) + '</span>' +
      '<span class="dashboard-transfers-cell">' + (row.person.contractEnd ? formatContractDate(row.person.contractEnd) : '–') + '</span>' +
      '<span class="dashboard-transfers-price">' + formatMoney(row.marketValue) + '</span>' +
      teamCellHtml +
      '<button type="button" class="dashboard-scouting-sign-btn" data-scouting-sign-org="' + (row.org ? row.org.name : '') + '" data-scouting-sign-name="' + row.person.name + '" data-scouting-sign-role="' + row.role + '"' +
        (canSign ? '' : ' disabled') + (disabledReason ? ' title="' + disabledReason + '"' : '') +
      '>Verpflichten</button>' +
    '</div>'
  );
}

function renderScoutingStaffPagination(pageCount) {
  const el = document.getElementById('dashboard-scouting-staff-pagination');
  if (pageCount <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let p = 1; p <= pageCount; p++) {
    html += '<button type="button" class="dashboard-stats-page-btn' + (p === scoutingStaffPage ? ' is-active' : '') + '" data-scouting-staff-page="' + p + '">' + p + '</button>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.dashboard-stats-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => { scoutingStaffPage = Number(btn.dataset.scoutingStaffPage); renderScoutingStaffView(); });
  });
}

function renderScoutingStaffView() {
  const all = scoutingStaffFilteredRows();
  const pageCount = Math.max(1, Math.ceil(all.length / SCOUTING_STAFF_PER_PAGE));
  scoutingStaffPage = Math.min(scoutingStaffPage, pageCount);
  const start = (scoutingStaffPage - 1) * SCOUTING_STAFF_PER_PAGE;
  const pageItems = all.slice(start, start + SCOUTING_STAFF_PER_PAGE);

  const body = document.getElementById('dashboard-scouting-staff-body');
  body.innerHTML = pageItems.length > 0
    ? pageItems.map(scoutingStaffRowHtml).join('')
    : '<div class="dashboard-transfers-empty">Keine Mitarbeiter gefunden.</div>';
  body.querySelectorAll('[data-scouting-team]').forEach((el) => {
    el.addEventListener('click', () => openTeamInfo(el.dataset.scoutingTeam));
  });
  body.querySelectorAll('[data-scouting-person]').forEach((el) => {
    el.addEventListener('click', () => {
      const [orgName, personName, role] = el.dataset.scoutingPerson.split('::');
      openPersonInfo(orgName, personName, role, { page: 'scouting', tab: 'staff' });
    });
  });
  body.querySelectorAll('.dashboard-scouting-sign-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = findScoutingStaffRow(btn.dataset.scoutingSignOrg, btn.dataset.scoutingSignName, btn.dataset.scoutingSignRole);
      if (row) signStaffMember(row);
    });
  });

  renderScoutingStaffPagination(pageCount);
}

// Zeigt den Bestätigungsdialog (Preis/Rolle/Bewertung) -- Fenster-/Budget-
// Prüfung passiert zusätzlich schon hier defensiv (der Button ist bei
// geschlossenem Fenster/zu niedrigem Budget bereits deaktiviert, siehe
// scoutingStaffRowHtml(), das hier ist nur ein zweites Sicherheitsnetz,
// falls sich der Zustand zwischen Render und Klick geändert hat).
// Runde 121, User-Vorgabe ("Personal soll erstmal gesperrt sein"): der
// Button ist bereits deaktiviert (scoutingStaffRowHtml()), diese Funktion
// ist dieselbe Zweitabsicherung wie bei jedem anderen Kauf-Flow in diesem
// Projekt (Render-Zustand und Klick-Zeitpunkt könnten sonst auseinanderlaufen).
// Die eigentliche Verpflichtungs-Logik (Fenster-/Budget-Check, Bestätigungs-
// dialog) bleibt vollständig in executeStaffSigning() erhalten und wird bei
// einer künftigen Freischaltung wieder direkt nutzbar sein.
function signStaffMember(row) {
  showConfirmModal('Noch nicht verfügbar', 'Personal-Verpflichtungen kommen in einem späteren Update.', () => {}, { hideCancel: true, confirmLabel: 'Verstanden' });
}

// Führt die Verpflichtung tatsächlich aus: verkaufende Org bekommt SOFORT
// einen frischen Ersatz für die freigewordene Position (rollReplacementPerson(),
// data/org-rosters.js, Runde 117) -- derselbe "Kader bleibt immer vollständig"-
// Grundsatz wie bei der Spieler-Entwicklung (Runde 113), sonst würde
// computeOrgStrengthFromRoster() mit einer Lücke rechnen. Die eigene, bisher
// auf dieser Rolle sitzende Person wird schlicht entlassen (kein Free-Agent-
// Pool für Mitarbeiter vorhanden -- disclosed Design-Entscheidung, siehe
// Abschlussbericht). Bucht denselben transferLog-Eintrag wie ein künftiger
// Spieler-Kauf (Runde 114/115-Form) -- Finanzen-Seite bleibt dadurch
// automatisch korrekt. Runde 120: freies Personal (row.org === null) hat
// keinen Verkäufer, der reagieren müsste -- wird stattdessen als vergeben
// markiert (signedFreeAgentStaff), damit es aus dem Scouting-Pool verschwindet.
function executeStaffSigning(row, price) {
  const sellerOrg = row.org;
  const role = row.role;
  const isCoach = role === 'Coach';

  if (sellerOrg) {
    const replacement = rollReplacementPerson(row.stars, role, careerDate);
    const replacementEntry = isCoach ? replacement : { role, ...replacement };
    if (isCoach) {
      sellerOrg.roster.coach = replacementEntry;
    } else {
      const idx = sellerOrg.roster.staff.findIndex((s) => s.role === role);
      if (idx !== -1) sellerOrg.roster.staff[idx] = replacementEntry;
    }
    if (sellerOrg.roster) sellerOrg.strength = computeOrgStrengthFromRoster(sellerOrg.roster);
    // sellerOrg ist eine "fremde" Bot-Org -- NICHT Teil von collectSaveState()
    // (nur assignedOrg wird als volles Objekt gespeichert, siehe Kopfkommentar
    // an playerDevelopment), ORGANIZATIONS wird bei jedem App-Start komplett
    // neu aus den Rohdaten aufgebaut. Ohne Nachverfolgung wäre dieser Ersatz
    // nach einem Neustart wieder weg (die ursprüngliche Person käme
    // "zurück", obwohl man sie doch verpflichtet hat) -- dasselbe Muster wie
    // playerDevelopment/reapplyPlayerDevelopmentToRosters() (Runde 113).
    recordStaffTransferReplacement(sellerOrg.name, role, replacementEntry);
  } else {
    signedFreeAgentStaff.add(role + '::' + row.person.name);
  }

  const signedPerson = { ...row.person };
  if (!isCoach) signedPerson.role = role;
  if (isCoach) {
    assignedOrg.roster.coach = signedPerson;
  } else {
    const ownIdx = assignedOrg.roster.staff.findIndex((s) => s.role === role);
    if (ownIdx !== -1) assignedOrg.roster.staff[ownIdx] = signedPerson;
  }
  assignedOrg.strength = computeOrgStrengthFromRoster(assignedOrg.roster);

  assignedOrg.budget -= price;
  financeAllocation.transfers = Math.max(0, (financeAllocation.transfers || 0) - price);
  logTransfer(sellerOrg ? sellerOrg.name : 'Free Agent', assignedOrg.name, row.person.name, price);
  addFinanceMonthlyExpense(price, 'Personal', row.person.name + ' (' + row.role + ') von ' + (sellerOrg ? sellerOrg.name : 'Free Agent'));

  renderDashboardScoutingPanel();
  renderDashboardTopbar();
  saveGameState();
}

// { 'orgName::role' -> Ersatzperson-Objekt } für Bot-Orgs, die eine Position
// durch eine Personal-Verpflichtung verloren haben -- siehe
// executeStaffSigning()-Kommentar. Muss nach jedem loadGameState() einmal auf
// die frisch aufgebauten ORGANIZATIONS zurückgespielt werden.
let staffTransferReplacements = {};

function recordStaffTransferReplacement(orgName, role, replacementEntry) {
  staffTransferReplacements[orgName + '::' + role] = replacementEntry;
}

function reapplyStaffTransferReplacements() {
  Object.keys(staffTransferReplacements).forEach((key) => {
    const sepIdx = key.indexOf('::');
    if (sepIdx === -1) return;
    const orgName = key.slice(0, sepIdx);
    const role = key.slice(sepIdx + 2);
    const org = findOrgByName(orgName);
    if (!org || !org.roster) return;
    const entry = staffTransferReplacements[key];
    if (role === 'Coach') {
      org.roster.coach = entry;
    } else {
      const idx = org.roster.staff.findIndex((s) => s.role === role);
      if (idx !== -1) org.roster.staff[idx] = entry;
    }
    org.strength = computeOrgStrengthFromRoster(org.roster);
  });
}

// ── Scouting-Spieler-Kauf (Runde 120, User-Vorgabe: "spieler auch kaufen
// können") ──────────────────────────────────────────────────────────────
// Namen aus der Signatur des Verkäufer-Teams (siehe scoutingAllPlayers()/
// executeStaffSigning()-Kommentar) markiert vergebene Free Agents, die
// dadurch aus dem Scouting-Pool verschwinden.
let signedFreeAgentPlayers = new Set();
let signedFreeAgentStaff = new Set();
let playerTransferReplacements = {};

function recordPlayerTransferReplacement(orgName, slotType, index, replacementEntry) {
  const key = orgName + '::' + slotType + (slotType === 'starters' ? '::' + index : '');
  playerTransferReplacements[key] = replacementEntry;
}

function reapplyPlayerTransferReplacements() {
  Object.keys(playerTransferReplacements).forEach((key) => {
    const parts = key.split('::');
    const org = findOrgByName(parts[0]);
    if (!org || !org.roster) return;
    const entry = playerTransferReplacements[key];
    if (parts[1] === 'starters') {
      const idx = Number(parts[2]);
      if (org.roster.starters[idx]) org.roster.starters[idx] = entry;
    } else {
      org.roster.sub = entry;
    }
    org.strength = computeOrgStrengthFromRoster(org.roster);
  });
}

// Der eigene, aktuell SCHWÄCHSTE Spieler unter den AKTIVEN Slots (Starter
// oder Sub, nach Overall) -- wird NICHT mehr beim Kauf benutzt (Runde 122:
// Neuzugänge landen in der Reserve, siehe executePlayerSigning()), sondern
// beim manuellen BEFÖRDERN eines Reserve-Spielers auf der Kader-Seite
// (promoteReservePlayer()) als Standard-Tauschziel.
function weakestOwnPlayer() {
  const roster = assignedOrg.roster;
  const candidates = roster.starters.map((p, i) => ({ slotType: 'starters', index: i, player: p, slotLabel: 'Starter' }));
  if (roster.sub) candidates.push({ slotType: 'sub', index: null, player: roster.sub, slotLabel: 'Sub' });
  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c.player.overall < min.player.overall ? c : min));
}

function signScoutingPlayer(row) {
  const price = row.marketValue;
  if (!isTransferWindowOpen(careerDate)) {
    showConfirmModal('Transferfenster geschlossen', 'Verpflichtungen sind nur vom 1. Dezember bis 15. Januar möglich.', () => {}, { hideCancel: true, confirmLabel: 'Verstanden' });
    return;
  }
  // Runde 122, User-Vorgabe: "wenn man dann bei scouting mehr kaufen will
  // kommt Hinweis das man kein Platz mehr hat und ein Spieler vorher
  // verkaufen muss" -- 6 Reserve-Plätze, zählt auch schon unterwegs
  // befindliche (noch nicht angekommene) Neuzugänge mit.
  if (reserveSlotsOccupied() >= KADER_RESERVE_SLOTS) {
    showConfirmModal('Kein Platz mehr im Kader', 'Deine Reserve ist voll (' + KADER_RESERVE_SLOTS + '/' + KADER_RESERVE_SLOTS + ' Plätze belegt). Verkaufe zuerst einen Spieler, bevor du einen neuen verpflichtest.', () => {}, { hideCancel: true, confirmLabel: 'Verstanden' });
    return;
  }
  if (price > (financeAllocation.transfers || 0) || price > assignedOrg.budget) {
    showConfirmModal('Budget zu niedrig', row.player.name + ' kostet ' + formatMoney(price) + ' -- das übersteigt dein Transferbudget oder Gesamtbudget.', () => {}, { hideCancel: true, confirmLabel: 'Verstanden' });
    return;
  }
  // Runde 122: kein Tausch mehr beim Kauf -- der Neuzugang KOMMT zusätzlich
  // in die Reserve dazu, ersetzt niemanden direkt. Das Gehalt wird deshalb
  // schlicht auf die bestehende Summe aufaddiert (siehe
  // totalMonthlySalaryCommitment()-Kommentar, zählt Reserve+Pending mit).
  const salary = playerMonthlySalary(row.player);
  const salaryAfterBuy = totalMonthlySalaryCommitment(assignedOrg) + salary;
  if (salaryAfterBuy > (financeAllocation.salaries || 0)) {
    showConfirmModal('Nicht genug Geld bei Gehälter', row.player.name + ' würde ' + formatMoney(salary) + '/Monat kosten -- damit würde dein Gehälter-Budget nicht mehr für den gesamten Kader reichen.', () => {}, { hideCancel: true, confirmLabel: 'Verstanden' });
    return;
  }
  const reactionNote = row.org ? ' ' + row.org.name + ' sucht sich danach selbst den nächstbesten Ersatz vom Transfermarkt.' : '';
  showConfirmModal(
    row.player.name + ' verpflichten?',
    'Bewertung ★' + row.stars.toFixed(1) + ' · Preis: ' + formatMoney(price) + ' · Gehalt: ' + formatMoney(salary) + '/Monat. ' +
      row.player.name + ' wird in 7 Tagen in deiner Kader-Reserve ankommen, bis dahin läuft der Vertrag bereits.' + reactionNote,
    () => executePlayerSigning(row, price),
    { confirmLabel: 'Verpflichten' }
  );
}

// Führt den Kauf tatsächlich aus. Kernstück (User-Vorgabe): kauft man einen
// Spieler von einer Bot-Org weg, tätigt DIESE sofort selbst den
// nächstbesseren Transfer, den sie sich mit ihrem Budget leisten kann --
// orgRemainingBudget()/bestAffordableFreeAgent() (data/org-rosters.js)
// bilden das aus dem freigewordenen Kaderwert-Spielraum unter dem festen
// Org-Budget-Deckel ab (kein separates, erfundenes Bot-Bargeld). Free-Agent-
// Käufe (row.org === null) haben keinen Verkäufer, der reagieren müsste.
// Runde 122: der Neuzugang landet NICHT sofort im Kader, sondern erst nach
// 7 echten Tagen in der Reserve (queuePlayerArrival()) -- Vertrag/Bezahlung
// laufen aber schon ab jetzt (siehe totalMonthlySalaryCommitment()).
function executePlayerSigning(row, price) {
  const sellerOrg = row.org;

  if (sellerOrg) {
    const slotType = row.role === 'Starter' ? 'starters' : 'sub';
    const idx = slotType === 'starters' ? sellerOrg.roster.starters.findIndex((p) => p.name === row.player.name) : null;
    const rosterValueWithoutSold = orgRosterMarketValue(sellerOrg.roster) - calculatePrice(row.player.overall);
    const remainingBudget = Math.max(0, sellerOrg.budget - rosterValueWithoutSold);
    const pool = freeAgentPlayerPool().filter((p) => !signedFreeAgentPlayers.has(p.name) && p.name !== row.player.name);
    const chosen = bestAffordableFreeAgent(pool, remainingBudget);
    if (chosen) {
      const replacement = signFreeAgentPlayer(chosen, careerDate);
      if (slotType === 'starters' && idx !== -1) sellerOrg.roster.starters[idx] = replacement;
      else sellerOrg.roster.sub = replacement;
      signedFreeAgentPlayers.add(chosen.name);
      recordPlayerTransferReplacement(sellerOrg.name, slotType, idx, replacement);
      // Eigene, sichtbare Transfer-Zeile für den Bot-Reaktions-Trade -- landet
      // in "Weltweite Transfers" (Runde 114) und in Finanzen automatisch
      // korrekt (financeExpenseTransfers()/-IncomeTransfers() lesen generisch
      // aus transferLog, kein Sonderfall für Bot-Bot-Transfers nötig).
      logTransfer('Free Agent', sellerOrg.name, replacement.name, calculatePrice(replacement.overall));
    }
    sellerOrg.strength = computeOrgStrengthFromRoster(sellerOrg.roster);
  } else {
    signedFreeAgentPlayers.add(row.player.name);
  }

  const signedPerson = { ...row.player };
  queuePlayerArrival(signedPerson, careerDate);

  assignedOrg.budget -= price;
  financeAllocation.transfers = Math.max(0, (financeAllocation.transfers || 0) - price);
  logTransfer(sellerOrg ? sellerOrg.name : 'Free Agent', assignedOrg.name, row.player.name, price);
  addFinanceMonthlyExpense(price, 'Transfers', row.player.name + ' von ' + (sellerOrg ? sellerOrg.name : 'Free Agent'));

  renderDashboardScoutingPanel();
  renderDashboardTopbar();
  saveGameState();

  // User-Vorgabe: "kommt Hinweistext dass Spieler erst in 7 Tagen erscheinen
  // wird (soll dann auch wirklich so sein)" -- eigener Hinweis NACH der
  // Bestätigung, zusätzlich zur Erwähnung im Bestätigungsdialog selbst.
  showConfirmModal(
    row.player.name + ' verpflichtet!',
    row.player.name + ' wird in 7 Tagen (' + formatContractDate(addDaysToDateStr(careerDate, 7)) + ') in deiner Kader-Reserve erscheinen. Bis dahin ist er noch bei seinem bisherigen Verein im Einsatz.',
    () => {},
    { hideCancel: true, confirmLabel: 'Verstanden' }
  );
}

function renderDashboardScoutingPanel() {
  const scout = assignedOrg.roster.staff.find((s) => s.role === 'Scout');
  const scoutAvatarEl = document.getElementById('dashboard-scouting-scout-avatar');
  if (scout) {
    const avatar = CHARACTER_AVATARS.find((a) => a.id === scout.avatarId) || CHARACTER_AVATARS[0];
    scoutAvatarEl.innerHTML = avatar.emoji;
    scoutAvatarEl.style.background = avatar.color + '33';
  } else {
    scoutAvatarEl.innerHTML = '';
    scoutAvatarEl.style.background = 'transparent';
  }

  // Transferbudget = der bereits bestehende, echte financeAllocation.transfers-
  // Topf (Runde 108-€-Modell) -- kein separates, neu erfundenes Budget.
  document.getElementById('dashboard-scouting-budget').textContent = formatMoneyShort(financeAllocation.transfers || 0);
  // "Spieler:"/"Personal:" ist die GESAMTE scoutbare Population des jeweils
  // aktiven Tabs, unabhängig von Such-/Filterzustand (liest wie im Referenz-
  // Screenshot als feste Datenbankgröße, nicht als Treffer-Zähler) -- deshalb
  // hier und NICHT in renderScoutingPlayersView()/renderScoutingStaffView()
  // gesetzt.
  document.getElementById('dashboard-scouting-count-label').textContent = scoutingActiveTab === 'staff' ? 'Personal:' : 'Spieler:';
  document.getElementById('dashboard-scouting-player-count').textContent = scoutingActiveTab === 'staff' ? scoutingAllStaff().length : scoutingAllPlayers().length;
  document.getElementById('dashboard-scouting-search').value = scoutingSearchQuery;

  document.querySelectorAll('[data-scouting-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.scoutingTab === scoutingActiveTab));
  document.getElementById('dashboard-scouting-players-view').classList.toggle('hidden', scoutingActiveTab !== 'players');
  document.getElementById('dashboard-scouting-staff-view').classList.toggle('hidden', scoutingActiveTab !== 'staff');

  if (scoutingActiveTab === 'players') renderScoutingPlayersView();
  else renderScoutingStaffView();
}

function selectScoutingTab(tab) {
  if (scoutingActiveTab === tab) return;
  scoutingActiveTab = tab;
  // Suche/Paginierung zurücksetzen (dasselbe Muster wie selectStatsTab()) --
  // ein Namens-Treffer aus dem einen Tab würde im anderen sonst nur verwirren.
  scoutingSearchQuery = '';
  scoutingPage = 1;
  scoutingStaffPage = 1;
  renderDashboardScoutingPanel();
}

// Suche/Filter-Leiste wird von "Spieler" UND "Personal" gemeinsam genutzt
// (siehe HTML) -- dispatcht je nach aktivem Tab an die richtige Render-
// Funktion, statt zwei fast identische Listener-Sätze zu duplizieren.
function renderActiveScoutingView() {
  if (scoutingActiveTab === 'players') renderScoutingPlayersView();
  else renderScoutingStaffView();
}

function toggleScoutingFilterPanel() {
  const panel = document.getElementById('dashboard-scouting-filter-panel');
  const btn = document.getElementById('btn-dashboard-scouting-filter');
  const willShow = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willShow);
  btn.classList.toggle('is-active', willShow);
}

// ── Kalender-Anbindung: automatische Turnier-Auflösung (Runde 85) ────────
// Jedes Turnier wird komplett in EINEM Schritt aufgelöst (dieselbe "Instant"-
// Philosophie wie das ältere tournament.js/season.js-System, siehe
// simulateFullSeriesInstant()), sobald die Anmeldephase endet -- es gibt
// (noch) keine Tag-für-Tag-Anzeige einzelner Matches in der neuen
// Turnier-Detailseite, ein Auflösen über mehrere Tage verteilt hätte also
// keinen sichtbaren Mehrwert.
function tournamentResolutionTriggerDate(event) {
  return addDaysToDateStr(event.phaseDates.registration.end, 1);
}

function resolveEventIfDue(event) {
  if (seasonTournamentResults[event.key]) return; // schon aufgelöst
  if (careerDate < tournamentResolutionTriggerDate(event)) return; // noch nicht fällig

  if (event.eventType === 'open') {
    // Runde 90, User-Vorgabe ("alle Regionen sollen im Hintergrund auch
    // richtig simuliert werden, so wie das Turnier, bei dem man selbst
    // mitmacht") -- vorher lief NUR die eigene Region, wodurch alle
    // anderen 6 Regionen NIE Saison-Punkte bekamen und Major-/Worlds-/LCQ-
    // Qualifikation dort bedeutungslos war (immer 0-Punkte-Gleichstand).
    // Jetzt wie bei LCQ: alle 7 Regionen einzeln auflösen, pro Region
    // verschachtelt speichern -- angezeigt wird weiterhin nur die eigene
    // Region des Spielers (siehe renderTournamentFormatTabs()/
    // tournamentResultSummaryHtml()).
    const perRegion = {};
    Object.keys(ORG_REGION_LABELS).forEach((region) => {
      const result = resolveOpenEvent(event, region);
      perRegion[region] = result;
      updateTeamFormForEvent(event, result);
      recordMatchHistoryForEvent(event, region, result);
      queuePrizePayoutForPlacement(event, result.placements);
      recordCareerOrgStats(event, result);
    });
    seasonTournamentResults[event.key] = perRegion;
  } else if (event.eventType === 'major') {
    const result = resolveMajorEvent(event);
    seasonTournamentResults[event.key] = result;
    updateTeamFormForEvent(event, result);
    recordMatchHistoryForEvent(event, null, result);
    queuePrizePayoutForPlacement(event, result.placements);
    recordCareerOrgStats(event, result);
  } else if (event.eventType === 'lcq') {
    const perRegion = {};
    LCQ_REGIONS.forEach((region) => {
      const result = resolveLcqEvent(event, region);
      perRegion[region] = result;
      updateTeamFormForEvent(event, result);
      recordMatchHistoryForEvent(event, region, result);
      // Runde 102, User-Vorgabe ("LCQ hat kein Preisgeld, entfernen"): kein
      // queuePrizePayout*()-Aufruf mehr -- prizeTableForEvent() liefert für
      // 'lcq' ohnehin `null`/Preisgeld 0 (s. dort), ein Aufruf wäre also
      // sowieso immer wirkungslos gewesen.
      recordCareerOrgStats(event, result);
    });
    seasonTournamentResults[event.key] = perRegion;
  } else if (event.eventType === 'worlds') {
    // Braucht seasonTournamentResults.lcq -- durch die chronologische
    // Reihenfolge des Kalenders (LCQ = Oktober, Worlds = November) UND den
    // täglichen checkTournamentResolutions()-Aufruf bereits garantiert
    // vorhanden, wenn Worlds fällig wird.
    const result = resolveWorldsEvent(event);
    seasonTournamentResults[event.key] = result;
    updateTeamFormForEvent(event, result);
    recordMatchHistoryForEvent(event, null, result);
    queuePrizePayoutForPlacement(event, result.placements);
    recordCareerOrgStats(event, result);
    // Bug-Fix (siehe SPONSOR_GOAL_CHECKERS-Kommentar oben): careerState.titlesWon
    // wurde im NEUEN, echten Spielfluss bisher nirgends hochgezählt (nur die
    // alte, praktisch unerreichbare startNextSeason() tat das) -- weder
    // Sponsoring-"titles"-Ziele noch die title1/title3-Erfolge konnten dadurch
    // je auslösen. Einziger korrekter Hook-Punkt: hier, wenn die eigene Org
    // Weltmeister wird.
    if (assignedOrg && result.championName === assignedOrg.name) {
      careerState.titlesWon += 1;
    }
  }
}

function checkTournamentResolutions() {
  currentSeasonTournamentSchedule().forEach(resolveEventIfDue);
}

// Runde 99, User-Vorgabe ("wenn man nicht min. 3 Spieler im Kader hat, kann
// man an keinem Turnier teilnehmen, Hinweistext bei den Turnieren"): dieselbe
// Mindestgröße wie der Forfeit-Schutz in simulateBotSeries() (Runde 97) --
// dort verhindert sie nur den Absturz BEI einem Match, hier verhindert sie
// von vornherein die TEILNAHME/Anmeldung, damit der Spieler den Zustand
// sieht statt nur automatische Forfeits zu kassieren.
function rosterMeetsTournamentMinimum() {
  return !!(assignedOrg && assignedOrg.roster && assignedOrg.roster.starters && assignedOrg.roster.starters.length >= 3);
}

function openRegistrationStatus(event) {
  if (!rosterMeetsTournamentMinimum()) return 'notEnoughPlayers';
  if (event.key === 'open0') {
    if (careerDate < event.phaseDates.registration.start) return 'unavailable';
    if (careerDate <= event.phaseDates.registration.end) return 'open';
    return 'closed';
  }
  // Runde 92/94: die Qualifikations-PRÜFUNG aus Runde 81 existiert jetzt
  // (siehe resolveOpenQualifierEvent()/seasonQualifiedTeams) -- Open 1-6 sind
  // nur für Orgas offen, die den Open Qualifier (open0) überlebt haben, und
  // laufen dann OHNE eigene An-/Abmeldung automatisch mit (User-Vorgabe: "man
  // kann sich dafür nicht anmelden & abmelden, man muss die durchspielen").
  // Major/Worlds/LCQ bleiben unverändert 'seasonLocked' (dort gibt es
  // ohnehin keine direkte Registrierung, siehe tournamentDetailRegistrationHtml()).
  if (event.eventType === 'open') {
    if (!seasonTournamentResults['open0']) return 'seasonLocked'; // Open Qualifier noch nicht aufgelöst
    const region = orgRegion(assignedOrg.country);
    const qualified = region && (seasonQualifiedTeams[region] || []).includes(assignedOrg.name);
    return qualified ? 'autoRegistered' : 'notQualified';
  }
  return 'seasonLocked';
}

function registerForOpenQualifier(eventKey) {
  openQualifierRegistrations[eventKey] = true;
  saveGameState();
}

function unregisterFromOpenQualifier(eventKey) {
  openQualifierRegistrations[eventKey] = false;
  saveGameState();
}

function tournamentDetailRegistrationHtml(event) {
  const status = openRegistrationStatus(event);
  if (status === 'notEnoughPlayers') {
    return '<p class="dashboard-tournament-detail-status is-unavailable">⚠️ Zu wenig Spieler im Kader (mindestens 3 nötig) -- keine Turnierteilnahme möglich. Hol dir mehr Spieler über den Transfermarkt.</p>';
  }
  if (status === 'seasonLocked') {
    // Bug-Fix (Runde 95, User-Meldung "fehlerhafte Info bei Major"): dieser
    // Zweig gilt für Major/Worlds/LCQ -- die hängen NICHT am Open Qualifier,
    // sondern ausschließlich an gesammelten Saison-Punkten (siehe Runde 93,
    // MAJOR_REGION_SLOTS/WORLDS_DIRECT_QUALIFIER_COUNT/LCQ_ELIGIBILITY_BANDS)
    // -- die alte Meldung verwies fälschlich auf den Open Qualifier.
    // Runde 106, User-Vorgabe: beim Major konkreter erklären, WORAN die
    // automatische Qualifikation hängt (feststehender Top-Punkte-Platz, den
    // niemand mehr einholen kann), statt nur "läuft automatisch über Punkte".
    if (event.eventType === 'major') {
      return '<p class="dashboard-tournament-detail-status is-unavailable">🔒 Fürs Major qualifiziert, sobald du zu 100% einer der Top-Teams bist -- mit so vielen Saison-Punkten, dass dir kein Team diesen Platz mehr wegnehmen kann.</p>';
    }
    return '<p class="dashboard-tournament-detail-status is-unavailable">🔒 Keine direkte Anmeldung -- die Teilnahme an diesem Turnier wird automatisch über deine gesammelten Saison-Punkte entschieden.</p>';
  }
  if (status === 'notQualified') {
    return '<p class="dashboard-tournament-detail-status is-unavailable">❌ Nicht qualifiziert -- deine Org ist beim Open Qualifier im Januar ausgeschieden und kann diese Saison an keinem weiteren Turnier mehr teilnehmen.</p>';
  }
  if (status === 'autoRegistered') {
    return '<p class="dashboard-tournament-detail-status is-open">✅ Automatisch angemeldet -- du hast dich beim Open Qualifier für Open 1-6 qualifiziert und spielst dieses Turnier automatisch mit.</p>';
  }
  if (status === 'unavailable') {
    return '<p class="dashboard-tournament-detail-status is-unavailable">Registrierung nicht verfügbar</p>';
  }
  if (status === 'closed') {
    return '<p class="dashboard-tournament-detail-status is-running">🔒 Turnier läuft bereits.</p>';
  }
  if (openQualifierRegistrations[event.key]) {
    return '<p class="dashboard-tournament-detail-status is-open">✅ Du bist angemeldet.</p>' +
      '<button type="button" id="btn-tournament-detail-unregister" class="dashboard-tournament-details-btn is-danger">Abmelden</button>';
  }
  return '<p class="dashboard-tournament-detail-status is-open">Registrierung möglich.</p>' +
    '<button type="button" id="btn-tournament-detail-register" class="dashboard-tournament-details-btn">Anmelden</button>';
}

// Runde 90, User-Vorgabe ("am Tag der Anmeldung... sollen alle Logos der
// Teams/Orgas geladen gezeigt werden") -- eine einzelne Teilnehmer-Slot-
// Kachel (echtes Logo oder Farb-Badge-Fallback, siehe applyOrgLogoToElement()
// für dasselbe Muster in den Bracket-Karten). Wiederverwendet von
// tournamentDetailSlotsHtml() (Open) und tournamentDetailQualifiedFieldHtml()
// (Major/LCQ/Worlds).
function orgSlotHtml(name) {
  const isOwn = assignedOrg && name === assignedOrg.name;
  const org = isOwn ? assignedOrg : findOrgByName(name);
  const logoUrl = org ? resolveOrgLogoUrl(org) : null;
  const logoHtml = logoUrl
    ? '<img src="' + logoUrl + '" alt="">'
    : '<div class="dashboard-tournament-slot-badge" style="background:' + orgBadgeColor(name) + ';">' + name.trim().charAt(0).toUpperCase() + '</div>';
  return '<div class="dashboard-tournament-slot' + (isOwn ? ' is-own-team' : '') + '" title="' + name + '">' + logoHtml + '<span>' + name + '</span></div>';
}

// Runde 91, User-Korrektur ("vor der Anmeldephase soll noch kein Team
// angezeigt und die Slots leer bleiben, erst beim Tag der Anmeldung
// sichtbar"): nimmt die Runde-90-"jederzeit sichtbar"-Vereinfachung teilweise
// zurück -- vor Erreichen von phaseDates.registration.start werden nur leere
// Platzhalter-Slots gezeigt (gleiche Anzahl wie am Reveal-Tag, damit sich das
// Raster nicht sichtbar verschiebt), keine echten Namen/Logos. Reused von
// tournamentDetailSlotsHtml() (Open) und tournamentDetailQualifiedFieldHtml()
// (Major/LCQ/Worlds) -- gilt laut User-Vorgabe für JEDES Turnier.
function tournamentDetailEmptySlotsHtml(count) {
  const slot = '<div class="dashboard-tournament-slot is-empty"><div class="dashboard-tournament-slot-badge" style="background:rgba(255,255,255,0.05);">?</div><span>TBD</span></div>';
  return new Array(Math.max(count, 1)).fill(slot).join('');
}

// Runde 90, User-Korrektur: zeigt die echten Teilnehmer-Logos ab dem
// Anmeldetag (Runde 91: vorher leere Platzhalter, siehe
// tournamentDetailEmptySlotsHtml()) -- das Teilnehmerfeld eines Open-Events
// (alle Orgas der Region) steht von vornherein fest, es gibt keine Ziehung/
// kein Losverfahren, das ein Verstecken NACH dem Anmeldetag rechtfertigen
// würde. Die eigene Org erscheint nur, wenn der Spieler sich angemeldet hat
// (siehe resolveOpenEvent(), dieselbe Regel).
function tournamentDetailSlotsHtml(event) {
  const region = orgRegion(assignedOrg.country);
  // Runde 92/94: nur der Open Qualifier (open0) zeigt noch ALLE Orgas der
  // Region -- Open 1-6 zeigen den Open-Qualifier-Pool (die 32, die open0
  // überlebt haben), nicht mehr regionOrgs(region) (64).
  const pool = event.key === 'open0'
    ? (region ? regionOrgs(region) : [])
    : (region ? (seasonQualifiedTeams[region] || []).map((name) => resolveOrgByNameOrOwn(name)).filter(Boolean) : []);
  // Bug-Fix (Runde 94, User-Meldung "32 statt 1 Slot"): VOR der Auflösung
  // von open0 ist seasonQualifiedTeams[region] noch leer (pool.length === 0),
  // wodurch tournamentDetailEmptySlotsHtml()s Math.max(count,1)-Sicherheitsnetz
  // fälschlich nur 1 Platzhalter-Slot zeigte statt der bekannten Ziel-Feldgröße
  // 32. Open 1-6 haben IMMER exakt 32 Plätze (das ist ja der ganze Punkt des
  // Open Qualifier), unabhängig davon, ob open0 schon aufgelöst ist.
  const placeholderCount = event.key === 'open0' ? pool.length : 32;
  if (careerDate < event.phaseDates.registration.start) {
    return tournamentDetailEmptySlotsHtml(placeholderCount);
  }
  // Runde 94, User-Vorgabe ("man kann sich nicht an-/abmelden, man muss alle
  // Turniere durchspielen, wenn man sich für Open qualifiziert hat"): Open 1-6
  // haben KEINE eigene An-/Abmeldung mehr -- wer im Open-Qualifier-Pool steht,
  // ist automatisch dabei (siehe auch openRegistrationStatus()). Nur open0
  // selbst behält die echte An-/Abmeldung.
  if (event.key !== 'open0') return pool.map((o) => o.name).map(orgSlotHtml).join('');
  const ownQualified = pool.some((o) => o.name === assignedOrg.name);
  let names = pool.filter((o) => o.name !== assignedOrg.name).map((o) => o.name);
  if (ownQualified && openQualifierRegistrations[event.key]) names = [assignedOrg.name, ...names];
  return names.map(orgSlotHtml).join('');
}

// Runde 90, User-Vorgabe ("bei den anderen Turnieren die, die sich dafür
// auch qualifiziert haben"): Major/LCQ/Worlds haben (anders als Open) ein
// echtes Qualifikationskriterium, das schon existiert (MAJOR_REGION_SLOTS/
// LCQ_ELIGIBILITY_BANDS/Direktqualifikation), aber bisher nur INTERN in
// resolveMajorEvent()/resolveLcqEvent()/resolveWorldsEvent() berechnet
// wurde. Diese Funktion liest dieselben Kriterien für eine reine Vorschau
// aus, OHNE selbst zu simulieren (die eigentliche Auflösung bleibt exklusiv
// Aufgabe der resolveXxxEvent()-Funktionen).
function tournamentDetailQualifiedFieldNames(event) {
  if (event.eventType === 'major') {
    const names = [];
    Object.keys(MAJOR_REGION_SLOTS).forEach((region) => {
      seasonLeaderboardForRegion(region).slice(0, MAJOR_REGION_SLOTS[region]).forEach((e) => names.push(e.orgName));
    });
    return names;
  }
  if (event.eventType === 'lcq') {
    const region = orgRegion(assignedOrg.country);
    const band = region && LCQ_ELIGIBILITY_BANDS[region];
    if (!band || band.lcqRangeStart === null) return []; // Region ohne LCQ (OCE/APAC/SSA)
    // Zeigt den gesamten LCQ-in-Frage-kommenden Pool (Bye-Bereich + alle
    // übrigen nicht direkt qualifizierten Teams, die per Vorrunde/K.o. um
    // die restlichen Plätze spielen) -- wer von den K.o.-Kandidaten
    // tatsächlich übersteht, steht erst nach der Auflösung fest.
    return seasonLeaderboardForRegion(region).slice(band.autoQualifyTop).map((e) => e.orgName);
  }
  if (event.eventType === 'worlds') {
    const names = [];
    Object.keys(LCQ_ELIGIBILITY_BANDS).forEach((region) => {
      seasonLeaderboardForRegion(region).slice(0, LCQ_ELIGIBILITY_BANDS[region].autoQualifyTop).forEach((e) => names.push(e.orgName));
    });
    const lcqResults = seasonTournamentResults.lcq || {};
    LCQ_REGIONS.forEach((region) => { if (lcqResults[region]) names.push(lcqResults[region].championName); });
    return names;
  }
  return [];
}

// Bug-Fix (Runde 94, User-Meldung "Weltmeisterschaft muss 20 Slots sein"):
// tournamentDetailQualifiedFieldNames('worlds') liefert nur 16 Namen, solange
// der LCQ (Oktober) noch nicht aufgelöst ist -- die 4 LCQ-Sieger fehlen dann
// einfach noch (seasonTournamentResults.lcq existiert noch nicht). Das ist
// beim TATSÄCHLICHEN Auflösen kein Problem (LCQ läuft laut Kalender immer
// einen Monat VOR Worlds), aber der Platzhalter-Slot-Zähler VOR der Auflösung
// darf sich nicht an dieser noch unvollständigen Zwischenzählung orientieren
// -- er muss die bekannte END-Feldgröße zeigen. Major/LCQ haben dieses
// Problem nicht (ihre Zähler hängen an keinem anderen Event).
function targetFieldSizeForEvent(event) {
  if (event.key === 'worlds') return WORLDS_TOTAL_TEAMS;
  return tournamentDetailQualifiedFieldNames(event).length;
}

function tournamentDetailQualifiedFieldHtml(event) {
  const names = tournamentDetailQualifiedFieldNames(event);
  // Bug-Fix (Runde 95, User-Meldung "LCQ zeigt nur 1 Slot"): dieselbe
  // Math.max(count,1)-Falle wie beim Worlds-Fix (Runde 94) -- für Regionen
  // OHNE LCQ (OCE/APAC/SSA, siehe LCQ_ELIGIBILITY_BANDS) ist die Ziel-
  // Feldgröße echt 0, das Sicherheitsnetz zeigte dafür fälschlich 1
  // Platzhalter-Slot statt korrekt "kein LCQ für diese Region" zu melden.
  const targetSize = targetFieldSizeForEvent(event);
  if (targetSize === 0) {
    return '<p class="dashboard-tournament-detail-status is-unavailable">Für deine Region gibt es keinen Last Chance Qualifier -- die Weltmeisterschafts-Qualifikation läuft hier ausschließlich über die Saison-Punkte.</p>';
  }
  if (careerDate < event.phaseDates.registration.start) {
    return tournamentDetailEmptySlotsHtml(targetSize);
  }
  if (!names.length) {
    return '<p class="dashboard-tournament-detail-status is-unavailable">Das Teilnehmerfeld steht erst nach Abschluss der Qualifikation fest.</p>';
  }
  return names.map(orgSlotHtml).join('');
}

// ── Swiss/Playoff-Struktur pro Turnierart (Runde 47/48/49) ────────────────
// Rein STRUKTURELLE Darstellung -- 1:1 nach dem echten RLCS-2026-Format
// recherchiert (WebSearch/WebFetch gegen Liquipedia/dignitas.gg, Juli 2026).
// Runde 49, User-Korrektur: die vom User beigefügten Screenshots waren NUR
// UI-Orientierung (Optik/Kartenstil), keine RLCS-Datenquelle -- die Bo1/Bo3-
// Eskalation aus Runde 48 war daraus fälschlich abgeleitet. Neu recherchiert:
// Open Swiss/Gruppenphase durchgehend Bo5, Open-Playoffs Bo5, Major- UND
// Worlds-Playoffs durchgehend Bo7 (explizit verifiziert: "all series played
// as best-of-seven"). Echte Doppel-K.o.-Struktur (Ober- + Unterbracket) statt
// der Runde-48-Vereinfachung als reines Einzel-K.o. Verbindungslinien werden
// jetzt NICHT mehr per CSS geraten, sondern nach dem Rendern per
// getBoundingClientRect() tatsächlich zwischen den echten Kartenpositionen
// gezeichnet (SVG) -- dadurch immer korrekt, unabhängig vom Flexbox-Layout.
// KEINE echte Match-Simulation/Seeding (kommt laut User-Vorgabe in einer
// späteren Runde) -- Platzhalter-Karten bleiben bewusst leer ("—:—").

// Berechnet die exakte Tag/Bilanz-Spaltenstruktur eines Triple-Elimination-
// Swiss (3 Siege = Aufstieg, 3 Niederlagen = raus, alle Spiele Bo5) für eine
// beliebige Team-Anzahl -- rein arithmetisch aus der Bilanz-Verteilung
// hergeleitet. Für 16 Teams ergibt das exakt 9 Spalten (Tag1 0:0 x8 ... Tag5
// 2:2 x3, 33 Matches gesamt, 8 auf/8 ab), per Node-Simulation verifiziert.
function computeSwissLadderColumns(teamCount, winThreshold, lossThreshold) {
  let states = { '0,0': teamCount };
  const columns = [];
  let day = 0;
  while (Object.entries(states).some(([k]) => {
    const [w, l] = k.split(',').map(Number);
    return w < winThreshold && l < lossThreshold;
  })) {
    day++;
    const nextStates = {};
    const dayColumns = [];
    Object.entries(states).forEach(([key, count]) => {
      const [w, l] = key.split(',').map(Number);
      if (w >= winThreshold || l >= lossThreshold) return;
      const matches = count / 2;
      dayColumns.push({ day, wins: w, losses: l, matches });
      nextStates[(w + 1) + ',' + l] = (nextStates[(w + 1) + ',' + l] || 0) + matches;
      nextStates[w + ',' + (l + 1)] = (nextStates[w + ',' + (l + 1)] || 0) + matches;
    });
    dayColumns.sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses));
    columns.push(...dayColumns);
    states = nextStates;
  }
  return columns;
}

// Eine Karte = ein Match = 2 Teams untereinander (Runde 50, Referenz-
// Vorlage: "bei 8 Teams 4 Boxen, bei 4 Teams 2 Boxen"). Runde 55, User-
// Vorgabe (RLCS-World-Championship-"Hybrid Playoff Bracket"-Screenshot,
// 1:1-Angleichung): keine Uhr/Zeit-Kopfzeile mehr -- stattdessen pro
// Team-Zeile Logo-Platzhalter + Name + Score-Box rechts, exakt wie im
// Referenzbild. Der Bo-Wert steht jetzt am Runden-Label (siehe
// .bracket-round-label/.bracket-round-bo), nicht mehr auf der Karte selbst
// -- im Referenzbild ist auf der Karte keine Bo-Angabe zu sehen.
// Runde 64, User-Referenzfoto (erneuter 1:1-Abgleich): das Original
// beschriftet JEDES Match durchgehend mit einem Buchstaben ("MATCH -- A"
// bis "MATCH -- I", links neben der Karte, vertikal). `matchLabel` ist
// optional -- bestehende Aufrufstellen (Swiss/Round-Robin/Einzel-K.o./
// Gruppen-Doppel-K.o.) übergeben ihn bewusst NICHT, nur der Playoff-Baum
// (buildAflBracket()) nummeriert durch, da nur dort im Referenzfoto
// Buchstaben zu sehen sind.
function tournamentMatchCardHtml(id, matchLabel) {
  const teamRow = (
    '<div class="tournament-match-card-team">' +
      '<span class="tournament-match-card-logo"></span>' +
      '<span class="tournament-match-card-name">TBD</span>' +
      '<span class="tournament-match-card-score">–</span>' +
    '</div>'
  );
  const labelHtml = matchLabel ? '<span class="tournament-match-card-label">Match ' + matchLabel + '</span>' : '';
  return '<div class="tournament-match-card" id="' + id + '">' + labelHtml + teamRow + teamRow + '</div>';
}

// Zeichnet nach dem Rendern echte Verbindungslinien zwischen zusammen-
// gehörigen Karten/Spalten (per id, siehe connections) -- läuft NACH dem
// Einfügen ins DOM (rAF in renderTournamentFormatTabs()), misst die
// tatsächlichen Positionen via getBoundingClientRect() und zeichnet ein SVG
// darüber. Dadurch immer geometrisch korrekt, unabhängig vom Flexbox-Layout
// darunter (kein Rätselraten über CSS-Ausrichtung mehr nötig).
function drawSvgConnectors(containerEl, connections) {
  if (!containerEl || !connections || !connections.length) return;
  const old = containerEl.querySelector(':scope > svg.tournament-connectors');
  if (old) old.remove();
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'tournament-connectors');
  const cRect = containerEl.getBoundingClientRect();
  const width = containerEl.scrollWidth;
  const height = containerEl.scrollHeight;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  function addPath(d, color) {
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color || 'rgba(255,255,255,0.3)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
  }
  function localRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x1: r.right - cRect.left + containerEl.scrollLeft,
      x0: r.left - cRect.left + containerEl.scrollLeft,
      top: r.top - cRect.top + containerEl.scrollTop,
      y: r.top - cRect.top + containerEl.scrollTop + r.height / 2,
    };
  }

  connections.forEach((conn) => {
    if (conn.type === 'merge') {
      const fromEls = conn.fromIds.map((id) => document.getElementById(id));
      const toEls = conn.toIds.map((id) => document.getElementById(id));
      if (fromEls.some((el) => !el) || toEls.some((el) => !el)) return;
      const fromPts = fromEls.map(localRect);
      // Runde 67, User-Vorgabe ("lilane Linie soll mehr Abstand zu den
      // Halbfinale-Tabellen haben, nicht direkt an der Tabelle anliegen"):
      // der Bündelungsbalken saß bisher exakt auf `fromPts[0].x1` (der
      // Box-Kante selbst) -- jetzt 14px Luft dazwischen.
      const sourceX = fromPts[0].x1 + 14;
      const fromYs = fromPts.map((p) => p.y);
      const sourceMidY = (Math.min(...fromYs) + Math.max(...fromYs)) / 2;
      const color = conn.color;
      // Runde 68, User-Vorgabe ("zwei gerade Linien von der lilanen Linie zu
      // den jeweiligen Tabellen bei Halbfinale mittig hin, wie bei einem
      // Turnier-Bracket Halbfinale->Finale"): die 14px-Lücke aus Runde 67
      // brauchte diese kurzen Verbindungsstücke, die JEDE Quellbox (auf
      // ihrer eigenen Mitte, "mittig") mit dem Bündelungsbalken verbinden --
      // vorher endete an dieser Stelle nichts, die Lücke war leer.
      if (fromPts.length > 1) {
        fromPts.forEach((p, i) => addPath('M' + p.x1 + ',' + fromYs[i] + ' L' + sourceX + ',' + fromYs[i], color));
      }

      if (toEls.length === 1) {
        // Runde 60, User-Vorgabe ("Halbfinale zu Grand Final muss eine
        // klare gerade Linie sein, keine Versetzung"): bei genau EINEM
        // Ziel (Grand Final) wird die Zielbox exakt auf sourceMidY
        // ausgerichtet, statt sich darauf zu verlassen, dass ihre CSS-
        // Position zufällig mit der Quell-Mitte übereinstimmt. Reset vor
        // der Neumessung verhindert, dass sich der Versatz bei
        // wiederholten Aufrufen (z.B. Tab-Wechsel) aufaddiert.
        toEls[0].style.transform = '';
        const delta = sourceMidY - localRect(toEls[0]).y;
        toEls[0].style.transform = 'translateY(' + delta + 'px)';
      }
      const toPts = toEls.map(localRect);
      const targetX = toPts[0].x0;
      const toYs = toPts.map((p) => p.y);
      const targetMidY = (Math.min(...toYs) + Math.max(...toYs)) / 2;
      if (fromYs.length > 1) addPath('M' + sourceX + ',' + Math.min(...fromYs) + ' L' + sourceX + ',' + Math.max(...fromYs), color);
      if (toYs.length > 1) addPath('M' + targetX + ',' + Math.min(...toYs) + ' L' + targetX + ',' + Math.max(...toYs), color);
      const midX = sourceX + (targetX - sourceX) / 2;
      addPath('M' + sourceX + ',' + sourceMidY + ' L' + midX + ',' + sourceMidY + ' L' + midX + ',' + targetMidY + ' L' + targetX + ',' + targetMidY, color);
      return;
    }
    const fromEl = document.getElementById(conn.fromId);
    const toEl = document.getElementById(conn.toId);
    if (!fromEl || !toEl) return;
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const x1 = fr.right - cRect.left + containerEl.scrollLeft;
    const y1 = fr.top - cRect.top + containerEl.scrollTop + fr.height / 2;

    if (typeof conn.stubLength === 'number') {
      // Runde 67, User-Vorgabe (Zoom-Vergleich, "türkise Linie" -- nur ein
      // kurzes Verbindungsstück, den Rest weglassen): kein voller Pfad zum
      // Ziel mehr, nur ein kurzer waagrechter Stummel ab der Quelle.
      addPath('M' + x1 + ',' + y1 + ' L' + (x1 + conn.stubLength) + ',' + y1, conn.color);
      return;
    }

    const x2 = tr.left - cRect.left + containerEl.scrollLeft;
    const y2 = tr.top - cRect.top + containerEl.scrollTop + tr.height / 2;

    if (conn.cornerAtMidOf) {
      // Runde 69, User-Vorgabe ("Die Ecke der grünen Linie soll auf die
      // Mitte der roten Linie. Der Anfang bis zur roten Linie soll
      // unverändert bleiben."): Grün teilt seine Quelle (ubR1[0]) mit Rot
      // (ubR1[0] -> qf[0]) -- beide laufen deshalb schon bisher auf
      // derselben Höhe (y1) deckungsgleich los, das bleibt unverändert.
      // `cornerAtMidOf` verweist auf Rots ZIEL (qf[0]): die erste Ecke von
      // Grün sitzt auf demselben X-Knickpunkt, den ein Standard-Ellenbogen
      // von hier zu DIESEM Referenzziel hätte, und auf der Y-Mitte
      // zwischen Start und Referenzziel -- also exakt "die Mitte der
      // roten Linie".
      // Runde 70, User-Ergänzung ("von der Mitte der grünen Linie... eine
      // neue Linie, die wie die Linie zuvor entlang geht, gerade aus und
      // dann nach unten, mittig von Halbfinale-Text die Tabelle"): ab
      // dieser ersten Ecke geht es weiter -- nochmal geradeaus bis zur
      // horizontalen Mitte der Zielbox (genau der Runde-67-`topEntry`-
      // Stil), dann von dort zentriert senkrecht von OBEN in die Box
      // hinein, endet an der Ziel-Oberkante.
      // Runde 71, User-Korrektur: der neue Ast soll nicht erst am ENDE der
      // senkrechten Strecke abzweigen, sondern MITTIG davon -- "wie bei der
      // lilanen Linie", deren Stamm ja auch von der Mitte des
      // Bündelungsbalkens (nicht von dessen Ende) abgeht. Deshalb jetzt
      // ZWEI getrennte Pfad-Elemente statt einem durchgehenden: die
      // senkrechte Strecke (bis `cornerY`, "Mitte der roten Linie") wird
      // komplett gezeichnet, der neue Ast zweigt aber schon von deren
      // eigener Mitte ab (`branchY`), nicht von `cornerY` selbst.
      const refEl = document.getElementById(conn.cornerAtMidOf);
      if (refEl) {
        const refRect = refEl.getBoundingClientRect();
        const refX0 = refRect.left - cRect.left + containerEl.scrollLeft;
        const refY = refRect.top - cRect.top + containerEl.scrollTop + refRect.height / 2;
        const cornerX = x1 + (refX0 - x1) / 2;
        const cornerY = (y1 + refY) / 2;
        const branchY = (y1 + cornerY) / 2;
        const targetCenterX = (x2 + (tr.right - cRect.left + containerEl.scrollLeft)) / 2;
        const targetTop = tr.top - cRect.top + containerEl.scrollTop;
        addPath('M' + x1 + ',' + y1 + ' L' + cornerX + ',' + y1 + ' L' + cornerX + ',' + cornerY, conn.color);
        addPath('M' + cornerX + ',' + branchY + ' L' + targetCenterX + ',' + branchY + ' L' + targetCenterX + ',' + targetTop, conn.color);
        return;
      }
    }

    // Eckiger Bracket-Konnektor (horizontal-vertikal-horizontal, rechte
    // Winkel) statt weicher Bezier-Kurve -- User-Vorgabe: "wie bei einem
    // klassischen Swiss/Turnierformat, nicht wellig", gilt einheitlich für
    // Swiss-Leiter UND alle Bracket-Bäume, da beide diese eine Funktion
    // teilen. `turnXOffset` (optional, relativ zur Ziel-Spalte) verschiebt
    // nur den Knick-Punkt weg vom geometrischen Mittelpunkt -- nötig, wenn
    // zwei Verbindungen auf dasselbe Ziel-Spalten-Paar treffen und sich
    // sonst überlagern würden.
    const midX = typeof conn.turnXOffset === 'number' ? x2 + conn.turnXOffset : x1 + (x2 - x1) / 2;
    addPath('M' + x1 + ',' + y1 + ' L' + midX + ',' + y1 + ' L' + midX + ',' + y2 + ' L' + x2 + ',' + y2, conn.color);
  });
  containerEl.appendChild(svg);
}

// Anordnung wie ein echtes RLCS-Swiss-Bracket (Runde 51-54, User-Referenz:
// RLCS 2024 Worlds Swiss Bracket). Runde 54, User-Korrektur (Screenshot-
// Vergleich unser-Ist vs. Referenz-Soll): der bisherige Aufbau machte JEDE
// Tabelle (auch Qualifiziert/Eliminiert) zu einem EIGENEN Flex-Element auf
// oberster Ebene -- das trieb die Gesamtbreite künstlich in die Länge
// (Tag 4 z.B. erzeugte 4 Spalten nebeneinander: Qualifiziert/2:1/1:2/
// Eliminiert, statt EINER Tages-Spalte). Zusätzlich sorgte das
// translateY(-net*ROW_UNIT)-Fächern für unnötig große Leerräume zwischen
// den Tabellen. Fix: pro TAG jetzt EIN Wrapper (.swiss-day-column,
// flex-column), der Qualifiziert (falls vorhanden) oben, die aktiven
// Spalten in Netto-Bilanz-Reihenfolge in der Mitte und Eliminiert (falls
// vorhanden) unten in NATÜRLICHER (nicht transform-verschobener) Reihenfolge
// stapelt -- genau wie im Referenzbild, wo QUALIFIED/2-1/1-2/ELIMINATED
// sichtbar in EINER Spalte übereinander sitzen. Der Fächer-/Diamant-Effekt
// entsteht weiterhin automatisch durch `.swiss-ladder { align-items:
// center }` auf die unterschiedlich hohen Tages-Wrapper, ganz ohne
// manuelle Pixel-Offsets -- dadurch bleibt alles kompakt (keine
// künstlichen Lücken) und exakt so breit wie die echten 6 Tages-Slots
// (Tag1..Tag6), nicht mehr.
function tournamentSwissLadderHtml(instanceId) {
  const WIN_T = 3, LOSS_T = 3;
  const LINE_COLOR = 'rgba(255,255,255,0.32)'; // neutral, kein Grün/Rot (User-Vorgabe Runde 53)

  const columns = computeSwissLadderColumns(16, WIN_T, LOSS_T);
  const maxDay = Math.max(...columns.map((c) => c.day));
  const colId = (w, l) => instanceId + '-col-' + w + '-' + l;
  const qualifiedId = (day) => instanceId + '-q' + day;
  const eliminatedId = (day) => instanceId + '-e' + day;

  // Wie viele Teams erreichen an Tag `day` erstmals 3 Siege/3 Niederlagen
  // (kommt jeweils aus Tag day-1s entscheidendem Match).
  const qualifiedAt = {};
  const eliminatedAt = {};
  columns.forEach((c) => {
    if (c.wins >= WIN_T || c.losses >= LOSS_T) return;
    const nextDay = c.day + 1;
    if (c.wins + 1 === WIN_T) qualifiedAt[nextDay] = (qualifiedAt[nextDay] || 0) + c.matches;
    if (c.losses + 1 === LOSS_T) eliminatedAt[nextDay] = (eliminatedAt[nextDay] || 0) + c.matches;
  });

  const connections = [];
  columns.forEach((c) => {
    if (c.wins >= WIN_T || c.losses >= LOSS_T) return;
    const fromId = colId(c.wins, c.losses);
    const nextDay = c.day + 1;
    if (c.wins + 1 === WIN_T) {
      connections.push({ fromId, toId: qualifiedId(nextDay), color: LINE_COLOR });
    } else if (columns.some((x) => x.wins === c.wins + 1 && x.losses === c.losses)) {
      connections.push({ fromId, toId: colId(c.wins + 1, c.losses), color: LINE_COLOR });
    }
    if (c.losses + 1 === LOSS_T) {
      connections.push({ fromId, toId: eliminatedId(nextDay), color: LINE_COLOR });
    } else if (columns.some((x) => x.wins === c.wins && x.losses === c.losses + 1)) {
      connections.push({ fromId, toId: colId(c.wins, c.losses + 1), color: LINE_COLOR });
    }
  });

  // Runde 86: jede Zeile bekommt eine ID (`idPrefix-m` + Index, rein
  // additiv, keine Layout-/Stil-Änderung) -- ermöglicht späteres Befüllen
  // mit echten Team-Namen per getElementById(), siehe fillSwissLadderResults().
  // Runde 87: jedes Team-Element bekommt zusätzlich ein Logo-Element
  // (`.swiss-table-team-logo`) + trägt den Namen jetzt im verschachtelten
  // `.swiss-table-team-label` statt direkt im Team-Span (sonst würde
  // .textContent= das Logo mitlöschen).
  function teamCellHtml() {
    return '<span class="swiss-table-team"><span class="swiss-table-team-logo"></span><span class="swiss-table-team-label">TBD</span></span>';
  }
  function matchRowsHtml(count, idPrefix) {
    return Array.from({ length: count }).map((_, i) =>
      '<div class="swiss-table-row" id="' + idPrefix + '-m' + i + '">' + teamCellHtml() + '<span class="swiss-table-vs">vs</span>' + teamCellHtml() + '</div>'
    ).join('');
  }
  function singleRowsHtml(count, idPrefix) {
    return Array.from({ length: count }).map((_, i) => '<div class="swiss-table-row" id="' + idPrefix + '-m' + i + '">' + teamCellHtml() + '</div>').join('');
  }
  function endcapTableHtml(id, label, count, extraClass) {
    return (
      '<div class="swiss-table swiss-table-endcap ' + extraClass + '" id="' + id + '">' +
        '<div class="swiss-table-header">' + label + '</div>' +
        '<div class="swiss-table-rows">' + singleRowsHtml(count, id) + '</div>' +
      '</div>'
    );
  }

  let html = '';
  for (let day = 1; day <= maxDay + 1; day++) {
    let dayHtml = '';
    if (qualifiedAt[day]) {
      dayHtml += endcapTableHtml(qualifiedId(day), '✅ Qualifiziert', qualifiedAt[day], 'is-qualified');
    }
    // columns ist pro Tag bereits Netto-Bilanz-absteigend sortiert (siehe
    // computeSwissLadderColumns()), daher hier keine erneute Sortierung
    // nötig -- ergibt exakt die Referenz-Reihenfolge oben=beste Bilanz.
    columns.filter((c) => c.day === day).forEach((c) => {
      const net = c.wins - c.losses;
      const tint = day === maxDay ? 'is-decider' : net > 0 ? 'is-winning' : net < 0 ? 'is-losing' : 'is-even';
      dayHtml += (
        '<div class="swiss-table ' + tint + '" id="' + colId(c.wins, c.losses) + '">' +
          '<div class="swiss-table-header">Tag ' + c.day + ' (' + c.wins + ':' + c.losses + ')</div>' +
          '<div class="swiss-table-rows">' + matchRowsHtml(c.matches, colId(c.wins, c.losses)) + '</div>' +
        '</div>'
      );
    });
    if (eliminatedAt[day]) {
      dayHtml += endcapTableHtml(eliminatedId(day), '❌ Eliminiert', eliminatedAt[day], 'is-eliminated');
    }
    html += '<div class="swiss-day-column">' + dayHtml + '</div>';
  }

  return { html: '<div class="swiss-ladder" id="' + instanceId + '">' + html + '</div>', containerId: instanceId, connections };
}

function tournamentRoundRobinGroupHtml(instanceId, label) {
  // Standings-Tabelle (wie bei echten RLCS-Gruppen-Grafiken) + Spielplan
  // darunter -- 4 Teams, jeder gegen jeden = 6 Round-Robin-Spiele (Bo5).
  // Runde 86: jede Zeile + ihre Team-/Sieg-/Niederlagen-Zellen bekommen eine
  // ID/Klasse (rein additiv, keine Layout-/Stil-Änderung) -- ermöglicht
  // späteres Befüllen mit echten Platzierungen per getElementById().
  // Runde 87: Team-Zelle bekommt zusätzlich ein Logo-Element (Klasse
  // `.tournament-rr-standings-logo`, per fillRoundRobinResults() befüllt) --
  // rein additiv, `.tournament-rr-standings-label` trägt weiterhin den Namen.
  const rows = Array.from({ length: 4 }).map((_, i) =>
    '<tr id="' + instanceId + '-standing-' + i + '">' +
      '<td>' + (i + 1) + '</td>' +
      '<td class="tournament-rr-standings-team">' +
        '<span class="tournament-rr-standings-logo"></span>' +
        '<span class="tournament-rr-standings-label">TBD</span>' +
      '</td>' +
      '<td class="tournament-rr-standings-wins">—</td>' +
      '<td class="tournament-rr-standings-losses">—</td>' +
    '</tr>'
  ).join('');
  const cards = Array.from({ length: 6 }).map((_, i) => tournamentMatchCardHtml(instanceId + '-m-' + i)).join('');
  return (
    '<div class="tournament-rr-group">' +
      '<div class="tournament-rr-group-label">' + label + '</div>' +
      '<table class="tournament-rr-standings"><thead><tr><th>#</th><th>Team</th><th>S</th><th>N</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tournament-rr-group-matches-label">Spielplan <span class="bracket-round-bo">Bo5</span></div>' +
      '<div class="tournament-rr-group-matches">' + cards + '</div>' +
    '</div>'
  );
}

// Baut einen linearen Einzel-K.o.-Baum (für LCQ -- kein Doppel-K.o. im
// echten RLCS). rounds: [{label, matches, bo}], matches halbiert sich pro
// Runde. Gibt HTML + die Verbindungen für drawSvgConnectors() zurück.
function buildSingleElimTree(treeId, rounds) {
  const connections = [];
  let prevIds = null;
  const roundsHtml = rounds.map((r, ri) => {
    const ids = [];
    for (let i = 0; i < r.matches; i++) ids.push(treeId + '-r' + ri + '-' + i);
    if (prevIds) {
      ids.forEach((toId, i) => {
        connections.push({ fromId: prevIds[i * 2], toId, color: 'rgba(255,255,255,0.35)' });
        connections.push({ fromId: prevIds[i * 2 + 1], toId, color: 'rgba(255,255,255,0.35)' });
      });
    }
    prevIds = ids;
    const cardsHtml = ids.map((id) => tournamentMatchCardHtml(id)).join('');
    return '<div class="bracket-round"><div class="bracket-round-label">' + r.label + ' <span class="bracket-round-bo">' + r.bo + '</span></div><div class="bracket-round-body">' + cardsHtml + '</div></div>';
  }).join('');
  return { html: roundsHtml, connections };
}

// 'standard8': Runde 73, komplett neu nach echtem User-Referenzscreenshot
// (Bracket-Hosting-Seite, "Group Stage" mit 8 Teams). Vorher (Runde 49-72)
// baute diese Funktion einen VOLLEN klassischen Doppel-K.o. bis zu einem
// Grand Final -- das war FALSCH: eine Gruppenphase kürt keinen einzelnen
// Champion, sie bestimmt nur, welche 4 von 8 Teams weiterziehen (deckt
// sich mit der schon länger korrekten Beschreibung in
// tournamentFormatInfo(): "Top 4 pro Gruppe (2 von der Gewinner-, 2 von
// der Verlierer-Seite) ziehen in die Playoffs ein" -- die alte
// Bracket-Implementierung hatte das nie tatsächlich umgesetzt). Echte
// Struktur laut Referenzscreenshot: ZWEI komplett unabhängige, sich nie
// kreuzende Qualifikationspfade:
// - Oberes Bracket: 4 Viertelfinale-Spiele (alle 8 Teams) -> 2 Halbfinale-
//   Spiele (je 2 Viertelfinale-Sieger) -> je EIN direkter Qualifiziert-
//   Slot pro Halbfinale-Sieger -- die zwei Halbfinale/Qualifiziert-Paare
//   sind voneinander GETRENNT (kein Cross-Match), "wie zwei Halbfinalen
//   mit zwei Finalen, die von einander getrennt sind" (User-Zitat).
// - Unteres Bracket: die 4 Oberes-Viertelfinale-VERLIERER spielen 2
//   Unteres-Viertelfinale-Spiele, deren Sieger dann gegen die 2 Oberes-
//   Halbfinale-VERLIERER in 2 Unteres-Halbfinale-Spielen antreten --
//   deren Sieger qualifizieren sich direkt (2 weitere Slots).
// Kein Grand Final, kein Pokal -- `withTrophy` wird deshalb nicht mehr
// gebraucht (war an jeder tatsächlichen Aufrufstelle ohnehin immer false).
function buildStandard8DoubleElim(treeId, bo) {
  const connections = [];
  // Runde 75 führte hier testweise eine bunte Debug-Palette ein (jede
  // Linie eine eigene Farbe, um einzelne Verbindungen in Screenshots
  // benennen zu können -- genutzt in Runde 76, um 6 Cross-Bracket-Linien
  // gezielt zu entfernen). Runde 78, User-Vorgabe: wieder zurück auf eine
  // einzige neutrale weiße Farbe für ALLE Linien, wie bei Playoffs schon
  // in Runde 72. `nextGroupColor()`/`skipColor()` bleiben als Funktionen
  // bestehen (mehrfach aufgerufen), geben jetzt aber überall denselben
  // Wert zurück.
  const nextGroupColor = () => 'rgba(255,255,255,0.3)';
  const connect = (fromId, toId) => connections.push({ fromId, toId, color: nextGroupColor() });
  // Runde 76, User-Vorgabe (per Debug-Farben benannt): einzelne Cross-
  // Bracket-Verbindungen ganz entfernen. `skipColor()` "verbraucht" trotzdem
  // die jeweilige Palettenfarbe, damit alle ÜBRIGEN Linien ihre bisherige
  // Farbidentität behalten (falls der User später erneut per Farbe
  // referenziert, z.B. "die rote Linie" -- die soll weiterhin dieselbe
  // Verbindung meinen wie vorher, nicht durch das Entfernen verschoben
  // werden).
  const skipColor = () => { nextGroupColor(); };
  const mkId = (roundKey, i) => treeId + '-' + roundKey + '-' + i;

  function buildRound(key, label, count) {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(mkId(key, i));
    const cardsHtml = ids.map((id) => tournamentMatchCardHtml(id)).join('');
    return { ids, html: '<div class="bracket-round"><div class="bracket-round-label">' + label + ' <span class="bracket-round-bo">' + bo + '</span></div><div class="bracket-round-body">' + cardsHtml + '</div></div>' };
  }
  // Qualifiziert-Slots sind KEINE Matches -- ein einzelnes Team pro Box,
  // kein Score, keine Bo-Angabe am Runden-Label. Grüner Akzent (siehe CSS
  // `.group-qualified-slot`) matcht das schon etablierte "qualifiziert"-
  // Farbmotiv aus der Swiss-Leiter (`.swiss-table.is-qualified`).
  function buildQualifiedSlots(key, count) {
    const ids = [];
    for (let i = 0; i < count; i++) ids.push(mkId(key, i));
    const slotsHtml = ids.map((id) =>
      '<div class="tournament-match-card group-qualified-slot" id="' + id + '">' +
        '<div class="tournament-match-card-team">' +
          '<span class="tournament-match-card-logo"></span>' +
          '<span class="tournament-match-card-name">TBD</span>' +
        '</div>' +
      '</div>'
    ).join('');
    return { ids, html: '<div class="bracket-round"><div class="bracket-round-label">✅ Qualifiziert</div><div class="bracket-round-body">' + slotsHtml + '</div></div>' };
  }

  const ubqf = buildRound('ubqf', 'Oberes Bracket – Viertelfinale', 4);
  const ubsf = buildRound('ubsf', 'Oberes Bracket – Halbfinale', 2);
  const ubQualified = buildQualifiedSlots('ubq', 2);
  const lbqf = buildRound('lbqf', 'Unteres Bracket – Viertelfinale', 2);
  const lbsf = buildRound('lbsf', 'Unteres Bracket – Halbfinale', 2);
  const lbQualified = buildQualifiedSlots('lbq', 2);

  // Oberes Bracket: Viertelfinale -> Halbfinale (getrennte Paare, kein
  // Cross-Match) -> Qualifiziert (1:1 pro Halbfinale-Sieger).
  connect(ubqf.ids[0], ubsf.ids[0]); connect(ubqf.ids[1], ubsf.ids[0]);
  connect(ubqf.ids[2], ubsf.ids[1]); connect(ubqf.ids[3], ubsf.ids[1]);
  connect(ubsf.ids[0], ubQualified.ids[0]);
  connect(ubsf.ids[1], ubQualified.ids[1]);

  // Unteres Bracket: Oberes-Viertelfinale-Verlierer -> Unteres Viertel-
  // finale -> (+ Oberes-Halbfinale-Verlierer) -> Unteres Halbfinale ->
  // Qualifiziert (1:1 pro Halbfinale-Sieger).
  // Runde 76, User-Vorgabe (per Debug-Farbe benannt): alle 4 Cross-
  // Verbindungen "Oberes Viertelfinale -> Unteres Viertelfinale" (Hellblau/
  // Dunkelblau/Lila/Pink) UND beide Cross-Verbindungen "Oberes Halbfinale
  // -> Unteres Halbfinale" (Hellrot + der "in der Tabelle selbst
  // verlaufende" Teil der türkisen Linie) komplett entfernt -- die rein
  // INTERNEN Unteres-Bracket-Verbindungen (Viertelfinale->Halbfinale,
  // Halbfinale->Qualifiziert) bleiben unverändert bestehen.
  skipColor(); skipColor(); // Hellblau, Dunkelblau: ubqf[0]/[1] -> lbqf[0] entfernt
  skipColor(); skipColor(); // Lila, Pink: ubqf[2]/[3] -> lbqf[1] entfernt
  connect(lbqf.ids[0], lbsf.ids[0]); skipColor(); // Hellrot: ubsf[0] -> lbsf[0] entfernt
  connect(lbqf.ids[1], lbsf.ids[1]); skipColor(); // Türkis (Tabellen-Teil): ubsf[1] -> lbsf[1] entfernt
  connect(lbsf.ids[0], lbQualified.ids[0]);
  connect(lbsf.ids[1], lbQualified.ids[1]);

  const html = (
    '<div class="bracket-group-wrap" id="' + treeId + '">' +
      '<div class="bracket-group-row">' + ubqf.html + ubsf.html + ubQualified.html + '</div>' +
      '<div class="bracket-group-row">' + lbqf.html + lbsf.html + lbQualified.html + '</div>' +
    '</div>'
  );
  return { html, containerId: treeId, connections };
}

// 'afl8'/'afl12': echtes "AFL Final Eight"-Prinzip (benannt nach dem
// australischen-Football-Finalsystem, das exakt diese Routung nutzt),
// Runde 55 komplett neu gebaut nach echtem RLCS-World-Championship-
// "Hybrid Playoff Bracket"-Referenzfoto (Lyon). WICHTIGER Unterschied zu
// 'standard8': die oberen Seeds spielen NIE gegeneinander in einem eigenen
// Ober-Finale -- ein Sieg in Runde 1 bringt ein Freilos direkt bis ins
// Halbfinale, eine Niederlage in Runde 1 bringt nur EINE zweite Chance
// im Viertelfinale gegen einen Unterbracket-Aufsteiger. Struktur exakt wie
// im Referenzbild (Matches A-I): Runde1 = Oberes Bracket (2 Spiele, 2
// Freilos-Chancen) + Unteres Bracket (2 Spiele, 1 Chance), beide in
// derselben Spalte übereinander -> Viertelfinale (2 Spiele: Ober-Verlierer
// vs. Unter-Aufsteiger) -> Halbfinale (2 Spiele: Ober-Sieger-Freilos vs.
// Viertelfinal-Sieger) -> Grand Final. Für afl12 (Major2/Worlds, 12 statt
// 8 Teams) gibt es kein offizielles Referenzfoto -- hier wird dasselbe
// Prinzip 1:1 auf 8 Unterbracket-Startplätze erweitert (Unteres Bracket
// braucht dafür 2 statt 1 Runde, um von 8 auf 2 Team zu reduzieren, bevor
// es auf die Ober-Verlierer trifft), disclosed als plausible Erweiterung
// des verifizierten 8-Team-Prinzips, nicht selbst am echten RLCS
// nachgewiesen.
function buildAflBracket(treeId, shape, bo, withTrophy) {
  const connections = [];
  // Runde 66 führte hier testweise eine bunte Debug-Palette ein (jede
  // Linie eine eigene Farbe, um einzelne Verbindungen in Screenshots
  // benennen zu können). Runde 72, User-Vorgabe: wieder zurück auf eine
  // einzige neutrale weiße Farbe für ALLE Linien -- Debug-Zweck erfüllt,
  // jetzt soll die Playoffs-Optik wieder zur neutralen weißen Linienfarbe
  // aus Runde 53 passen (wie Swiss-Leiter, Gruppenphase-Doppel-K.o. und
  // LCQ-Einzel-K.o. sie ohnehin nie verlassen hatten). `nextAflColor()`
  // bleibt als Funktion bestehen (an mehreren Stellen aufgerufen), gibt
  // jetzt aber überall denselben Wert zurück.
  const nextAflColor = () => 'rgba(255,255,255,0.3)';
  const connect = (fromId, toId) => connections.push({ fromId, toId, color: nextAflColor() });
  const mkId = (roundKey, i) => treeId + '-' + roundKey + '-' + i;

  // Runde 64, User-Referenzfoto: Match-Buchstaben (A, B, C, ...) werden in
  // der ECHTEN chronologischen Reihenfolge des Originals vergeben (Oberes
  // Runde1 -> Unteres Runde1[/Runde2 bei afl12] -> Viertelfinale ->
  // Halbfinale -> Grand Final) -- unabhängig davon, in welcher Code-
  // Reihenfolge die Runden unten tatsächlich gebaut werden (Viertelfinale/
  // Halbfinale werden vor dem Unteren Bracket instanziiert, weil sie schon
  // für die Freilos-Verbindungen gebraucht werden).
  let letterCode = 65; // 'A'
  const nextLetters = (count) => Array.from({ length: count }, () => String.fromCharCode(letterCode++));
  const ubR1Letters = nextLetters(2);
  const lbR1Letters = nextLetters(shape === 'afl8' ? 2 : 4);
  const lbR2Letters = shape === 'afl12' ? nextLetters(2) : null;
  const qfLetters = nextLetters(2);
  const sfLetters = nextLetters(2);
  const gfLetter = nextLetters(1)[0];

  function buildRound(def, letters, boExtraClass) {
    const ids = [];
    for (let i = 0; i < def.count; i++) ids.push(mkId(def.key, i));
    const cardsHtml = ids.map((id, i) => tournamentMatchCardHtml(id, letters[i])).join('');
    const boClass = 'bracket-round-bo' + (boExtraClass ? ' ' + boExtraClass : '');
    return { ids, html: '<div class="bracket-round"><div class="bracket-round-label">' + def.label + ' <span class="' + boClass + '">' + bo + '</span></div><div class="bracket-round-body">' + cardsHtml + '</div></div>' };
  }

  const ubR1 = buildRound({ key: 'ubr1', label: 'Oberes Bracket – Runde 1', count: 2 }, ubR1Letters);
  const qf = buildRound({ key: 'qf', label: 'Viertelfinale', count: 2 }, qfLetters);
  // Runde 68, User-Vorgabe: "Bo5" bei Halbfinale minimal weiter nach rechts
  // versetzen (nur hier, nicht bei den anderen Runden-Labels).
  const sf = buildRound({ key: 'sf', label: 'Halbfinale', count: 2 }, sfLetters, 'bracket-round-bo-nudge');

  connect(ubR1.ids[0], qf.ids[0]);
  connect(ubR1.ids[1], qf.ids[1]);
  connect(qf.ids[0], sf.ids[0]);
  connect(qf.ids[1], sf.ids[1]);
  // Runde 59-69, User-Referenzfoto: der Freilos-Pfad (beide Oberes-Bracket-
  // Runde-1-Sieger springen ohne Viertelfinale direkt ins Halbfinale). Nach
  // dem Debug-Farben-Feedback (Runde 66-69) behandeln die zwei Freilos-
  // Verbindungen die beiden Zielboxen jetzt bewusst UNTERSCHIEDLICH:
  // - ubR1[0] -> sf[0] ("grüne Linie"): teilt ihre Quelle mit der roten
  //   Linie (ubR1[0] -> qf[0]) und läuft deshalb unverändert deckungsgleich
  //   mit ihr los. Runde 69, User-Korrektur zu Runde 67: die Ecke (der
  //   Knick) sitzt jetzt NICHT mehr weit rechts an der Halbfinale-Spalte,
  //   sondern exakt auf der "Mitte der roten Linie" -- demselben X-Knick,
  //   den ein Standard-Ellenbogen zum ROTEN Referenzziel (qf[0]) hätte,
  //   auf halber Höhe zwischen Start und diesem Referenzziel
  //   (`cornerAtMidOf: qf.ids[0]`). Endet dort bewusst (kein weiterer Pfad
  //   zur Halbfinale-Box), analog zum türkisen Kurz-Stummel.
  // - ubR1[1] -> sf[1] ("türkise Linie"): weiterhin auf ein kurzes
  //   Verbindungsstück reduziert (`stubLength`), das nur bis knapp hinter
  //   den Knickpunkt der roten/orangen Verlierer-Pfad-Linien reicht (24px
  //   ab der Quelle, exakt der Abstand, den auch die Standard-Ellenbogen
  //   zwischen Runde-1 und Viertelfinale nutzen).
  connections.push({ fromId: ubR1.ids[0], toId: sf.ids[0], color: nextAflColor(), cornerAtMidOf: qf.ids[0] });
  connections.push({ fromId: ubR1.ids[1], toId: sf.ids[1], color: nextAflColor(), stubLength: 24 });

  let round1Html;
  if (shape === 'afl8') {
    const lbR1 = buildRound({ key: 'lbr1', label: 'Unteres Bracket – Runde 1', count: 2 }, lbR1Letters);
    connect(lbR1.ids[0], qf.ids[0]);
    connect(lbR1.ids[1], qf.ids[1]);
    round1Html = '<div class="bracket-afl-r1-group">' + ubR1.html + '</div><div class="bracket-afl-r1-group">' + lbR1.html + '</div>';
  } else { // afl12 -- 8 Unterbracket-Startplätze statt 4, siehe Kommentar oben
    const lbR1 = buildRound({ key: 'lbr1', label: 'Unteres Bracket – Runde 1', count: 4 }, lbR1Letters);
    const lbR2 = buildRound({ key: 'lbr2', label: 'Unteres Bracket – Runde 2', count: 2 }, lbR2Letters);
    connect(lbR1.ids[0], lbR2.ids[0]); connect(lbR1.ids[1], lbR2.ids[0]);
    connect(lbR1.ids[2], lbR2.ids[1]); connect(lbR1.ids[3], lbR2.ids[1]);
    connect(lbR2.ids[0], qf.ids[0]);
    connect(lbR2.ids[1], qf.ids[1]);
    round1Html = (
      '<div class="bracket-afl-column">' +
        '<div class="bracket-afl-r1-group">' + ubR1.html + '</div>' +
        '<div class="bracket-afl-r1-group">' + lbR1.html + '</div>' +
      '</div>' +
      '<div class="bracket-afl-column"><div class="bracket-afl-r1-group">' + lbR2.html + '</div></div>'
    );
  }

  const gfId = mkId('gf', 0);
  // Runde 59/60, User-Referenzfoto: "zwischen beiden Halbfinale-Matches auch
  // eine Verbindungslinie, mittig" -- analoge Bündelungs-Optik wie beim
  // Freilos-Pfad oben, hier ohne `skipGap` nötig (Halbfinale/Grand-Final
  // sind unmittelbar benachbart). Da hier nur EIN Ziel existiert (Grand
  // Final), richtet drawSvgConnectors() die GF-Box automatisch exakt auf
  // die Halbfinale-Mitte aus -- ergibt eine wirklich gerade Linie ohne die
  // von Runde 59 bemängelte kleine Versetzung.
  connections.push({ type: 'merge', fromIds: [sf.ids[0], sf.ids[1]], toIds: [gfId], color: nextAflColor() });
  const gfCardHtml = tournamentMatchCardHtml(gfId, gfLetter);

  const round1Wrap = shape === 'afl8' ? '<div class="bracket-afl-column">' + round1Html + '</div>' : round1Html;

  const html = (
    '<div class="bracket-afl-wrap" id="' + treeId + '">' +
      round1Wrap +
      '<div class="bracket-afl-column bracket-afl-lifted">' + qf.html + '</div>' +
      '<div class="bracket-afl-column bracket-afl-lifted">' + sf.html + '</div>' +
      '<div class="bracket-afl-column bracket-afl-lifted bracket-afl-gf">' +
        '<div class="bracket-round"><div class="bracket-round-label">Grand Final <span class="bracket-round-bo">' + bo + '</span></div><div class="bracket-round-body">' + gfCardHtml + '</div></div>' +
        (withTrophy ? '<img class="bracket-trophy" src="assets/Menu_Pokal_trimmed.png" alt="">' : '') +
      '</div>' +
    '</div>'
  );
  return { html, containerId: treeId, connections };
}

function buildDoubleElimBracket(treeId, shape, bo, withTrophy) {
  if (shape === 'standard8') return buildStandard8DoubleElim(treeId, bo);
  return buildAflBracket(treeId, shape, bo, withTrophy);
}

// Gibt eine FLACHE, chronologisch geordnete Liste der echten RLCS-Phasen
// zurück (Runde 50, User-Vorgabe: "Gruppe, Swiss, Playoffs haben als eigene
// Kategorie in richtiger chronologischer Reihenfolge") -- jede Stage bekommt
// ihren EIGENEN Tab (siehe renderTournamentFormatTabs()), statt zwei fest
// zusammengefasste Swiss-/Playoff-Tabs wie in Runde 47-49.
function tournamentFormatInfo(event) {
  // Runde 92/93, User-Vorgabe ("Open Qualifier umbauen", dann "kann ruhig auch
  // mehrere in Gruppen aufgeteilte Turnierbäume sein"): open0 ist kein Open
  // wie die anderen mehr -- nur noch EINE Stage, 8 Gruppen à 8 Teams, jede ein
  // echter "standard8"-Doppel-K.o.-Baum MIT grafischen Verbindungslinien
  // (dieselbe Engine/Visual wie die reguläre Open-Gruppenphase weiter unten,
  // nur mit 8 statt 2 Gruppen-Instanzen -- siehe resolveOpenQualifierEvent()).
  // Kein Swiss, kein Playoffs, kein Turniersieger -- WICHTIG (User-Korrektur):
  // die 32 Qualifizierten sind NUR für Open 1-6 berechtigt, NICHT direkt für
  // Major/Worlds/LCQ -- die Qualifikation dafür läuft ausschließlich über
  // Saison-Punkte, die erst in Open 1-6 gesammelt werden müssen (unverändert
  // seit Runde 79, siehe MAJOR_REGION_SLOTS/WORLDS_DIRECT_QUALIFIER_COUNT).
  if (event.key === 'open0') {
    const region = assignedOrg ? orgRegion(assignedOrg.country) : null;
    // Echte aktuelle Feldgröße (64 oder 65 mit der eigenen Org, siehe
    // eligibleOpenFieldFromPool()) -- rein für die Kopf-Anzeige "N Teams".
    const fieldSize = region ? eligibleOpenFieldFromPool(regionOrgs(region), event, region).length : 64;
    return {
      stages: [
        {
          tabLabel: 'Doppel-K.o.', title: 'Open Qualifier – Doppel-K.o.', teamsIn: fieldSize,
          desc: 'Alle Orgas der Region (+ die eigene, falls angemeldet) spielen in 8 Gruppen à 8 Teams je einen Doppel-K.o.-Baum (Bo5). Jede Gruppe qualifiziert 4 Teams (2 vom Oberen-, 2 vom Unteren-Bracket-Pfad) -- 8 Gruppen x 4 = 32 Qualifizierte für Open 1-6. Alle anderen sind für den Rest der Saison komplett raus. Passt die Teamzahl nicht auf ein Vielfaches von 8 (z.B. an- oder abgemeldete eigene Org), entscheiden vorab ein oder mehrere Vorentscheidungsspiele über die letzten Gruppenplätze.',
          visual: 'doubleElim', shape: 'standard8', bo: 'Bo5',
          // Bug-Fix (Runde 96): Math.floor() statt Math.round() -- muss exakt
          // dieselbe Gruppenzahl vorhersagen, auf die resolveOpenQualifierEvent()s
          // Trimm-Schleife das Feld tatsächlich reduziert (nächstes Vielfaches
          // von 8 NACH UNTEN, nicht kaufmännisch gerundet).
          groupLabels: Array.from({ length: Math.floor(fieldSize / 8) }, (_, i) => 'Gruppe ' + (i + 1)),
        },
      ],
    };
  }
  if (event.eventType === 'open') {
    return {
      stages: [
        {
          tabLabel: 'Swiss', title: 'Swiss-Stage', teamsIn: 32,
          desc: '32 Teams, die sich beim Open Qualifier (Januar) für die Saison qualifiziert haben. 2 Gruppen à 16, Triple-Elimination (3 Siege = Aufstieg, 3 Niederlagen = raus), alle Spiele Bo5.',
          visual: 'swissLadder', groupLabels: ['Gruppe A', 'Gruppe B'],
        },
        {
          tabLabel: 'Gruppenphase', title: 'Gruppenphase', teamsIn: 16,
          desc: '2 Doppel-K.o.-Gruppen à 8 Teams, alle Spiele Bo5. Top 4 pro Gruppe (2 von der Gewinner-, 2 von der Verlierer-Seite) ziehen in die Playoffs ein.',
          visual: 'doubleElim', shape: 'standard8', bo: 'Bo5', groupLabels: ['Gruppe A', 'Gruppe B'],
        },
        {
          tabLabel: 'Playoffs', title: 'Playoffs', teamsIn: 8, trophy: true,
          desc: '"AFL Final Eight"-Format: die 4 Gruppensieger starten mit 2 Chancen im Oberen Bracket, die 4 Gruppenzweiten mit nur 1 Chance im Unteren Bracket. Alle Spiele Bo5.',
          visual: 'doubleElim', shape: 'afl8', bo: 'Bo5',
        },
      ],
    };
  }
  if (event.eventType === 'major') {
    const isParis = event.key === 'major2';
    const shape = isParis ? 'afl12' : 'afl8';
    const totalPlayoff = isParis ? 12 : 8;
    const topPerGroup = isParis ? 3 : 2;
    return {
      stages: [
        // Runde 80, User-Korrektur (echte RLCS-2026-Recherche, ersetzt die
        // Runde-79-Fehlannahme "Major startet direkt mit einer echten Swiss
        // Stage"): das Schweizer System wurde bei Majors 2026 komplett
        // abgeschafft. Echtes Format: 4 Round-Robin-Gruppen à 4 Teams, jeder
        // gegen jeden, Bo5 -- siehe WORLDS_MAJOR_GROUP_STAGE_FORMAT in
        // tournament-calendar.js. Top 2 pro Gruppe (Major 1) bzw. Top 3 pro
        // Gruppe (Major 2) ziehen weiter.
        {
          tabLabel: 'Gruppenphase', title: 'Gruppenphase', teamsIn: 16,
          desc: '16 Teams, direkt international (alle Regionen zusammen) -- 4 Round-Robin-Gruppen à 4 Teams, jeder gegen jeden, alle Spiele Bo5. Top ' + topPerGroup + ' pro Gruppe (' + totalPlayoff + ' insgesamt) ziehen in die Playoffs ein.',
          visual: 'roundRobin', groupLabels: ['Gruppe A', 'Gruppe B', 'Gruppe C', 'Gruppe D'],
        },
        {
          tabLabel: 'Playoffs', title: 'Playoffs', teamsIn: totalPlayoff, trophy: true,
          desc: 'Hybrid-Elimination-Bracket ("AFL Final Eight"-Prinzip, Mischung aus Doppel- und Einzel-K.o.), ALLE Spiele Bo7: die 4 Gruppensieger starten im Oberen Bracket, die übrigen ' + (totalPlayoff - 4) + ' Teams im Unteren Bracket.',
          visual: 'doubleElim', shape, bo: 'Bo7',
        },
      ],
    };
  }
  if (event.eventType === 'worlds') {
    return {
      stages: [
        // Runde 79, User-Korrektur: die 20 WM-Teams setzen sich aus den 16
        // besten Teams der Jahres-Punktetabelle (siehe OPEN_POINTS_TABLE/
        // MAJOR_POINTS_TABLE) + den 4 regionalen LCQ-Siegern zusammen --
        // davon sind aber nur die BESTEN 12 der 16 direkt gesetzt (Freilos
        // direkt in die Gruppenphase, siehe WORLDS_DIRECT_SEED_COUNT in
        // tournament-calendar.js). Die restlichen 4 der 16 (die am
        // schlechtesten qualifizierten Direkt-Teams, z.B. OCE #2/APAC #1/
        // SSA #1 + 1 Tiebreaker) müssen zusammen mit den 4 LCQ-Siegern
        // zuerst durchs Play-In (GSL-Doppel-K.o., WORLDS_PLAYIN_FIELD_SIZE
        // = 8 Teams, Top 4 ziehen weiter).
        {
          tabLabel: 'Play-In', title: 'Play-In', teamsIn: 8,
          desc: 'Die 4 am schlechtesten qualifizierten Direkt-Teams + die 4 regionalen LCQ-Sieger spielen ein Doppel-K.o.-Bracket (Bo5). Top 4 ziehen (zusammen mit den 12 direkt gesetzten Teams) in die Gruppenphase ein.',
          visual: 'doubleElim', shape: 'standard8', bo: 'Bo5',
        },
        // Runde 80, User-Korrektur (echte RLCS-2026-Recherche, ersetzt die
        // Runde-79-Fehlannahme "wie beim Major eine echte Swiss Stage"): auch
        // bei der Weltmeisterschaft wurde Swiss durch 4 Round-Robin-Gruppen
        // à 4 Teams ersetzt, siehe Kommentar bei 'major' oben. Top 2 pro
        // Gruppe (8 insgesamt) ziehen in die Playoffs ein.
        {
          tabLabel: 'Gruppenphase', title: 'Gruppenphase', teamsIn: 16,
          desc: '12 direkt gesetzte Teams + 4 Überlebende aus dem Play-In -- 4 Round-Robin-Gruppen à 4 Teams, jeder gegen jeden, alle Spiele Bo5. Top 2 pro Gruppe (8 insgesamt) ziehen in die Playoffs ein.',
          visual: 'roundRobin', groupLabels: ['Gruppe A', 'Gruppe B', 'Gruppe C', 'Gruppe D'],
        },
        // Runde 79, User-Korrektur (ersetzt die Runde-56-Fehlannahme
        // "AFL Final Eight mit 12 Teams"): die WM-Playoffs sind ein
        // einfaches 8-Team-Single-Elimination-Bracket -- KEIN Unteres
        // Bracket mehr, wer verliert ist sofort raus.
        {
          tabLabel: 'Playoffs', title: 'Playoffs', teamsIn: 8, trophy: true,
          desc: 'Reines Single-Elimination-Bracket, kein Unteres Bracket -- wer verliert, scheidet sofort aus. Alle Spiele Bo7. Viertelfinale -> Halbfinale -> Grand Final.',
          visual: 'bracket',
          rounds: [
            { label: 'Viertelfinale', matches: 4, bo: 'Bo7' },
            { label: 'Halbfinale', matches: 2, bo: 'Bo7' },
            { label: 'Grand Final', matches: 1, bo: 'Bo7' },
          ],
        },
      ],
    };
  }
  // Runde 79, User-Korrektur (kompletter Neubau, ersetzt die alte,
  // zu stark vereinfachte Annahme "einfaches Einzel-K.o.-Bracket, kein
  // Finale"): der ECHTE LCQ läuft REGIONAL (nur EU/NA/SAM/MENA, siehe
  // LCQ_REGIONS in tournament-calendar.js -- OCE/APAC/SSA haben gar
  // keinen LCQ) und hat 4 Phasen, jede mit ihrer eigenen Elimination:
  // Vorrunde (Doppel-K.o., beliebig großes Feld -> Top 32) -> Swiss (32,
  // 2 Gruppen à 16, wie bei Open) -> Gruppenphase/GSL (16, 2 Gruppen à 8,
  // Doppel-K.o. OHNE Finale, wie bei Open) -> Playoffs ("AFL Final Eight",
  // 8 Teams, Bo7, MIT echtem Grand Final -- anders als die alte Annahme
  // gibt es hier einen einzigen Sieger, der den WM-Startplatz erhält,
  // daher jetzt `trophy: true`). Runde 106, User-Vorgabe ("LCQ-Vorrunde soll
  // ein echter, angezeigter/simulierter Bracket sein, nicht unsichtbar"):
  // der bisherige leere `visual: 'info'`-Platzhalter (Runde 79, damals als
  // "eigene, größere Baustelle für eine spätere Runde" zurückgestellt) ist
  // jetzt `'lcqVorrunde'` -- eigener, dynamisch nach echter Feldgröße
  // skalierender Bracket-Typ (siehe lcqVorrundeFieldPlan()/
  // buildLcqVorrundeBracket()), da das Teilnehmerfeld (28-34 Teams je
  // Region) kein festes 8/16/32-Raster wie die übrigen Formate hat.
  return {
    stages: [
      {
        tabLabel: 'Vorrunde', title: 'Vorrunde', teamsIn: 32,
        desc: 'Alle angemeldeten Teams der Region, die sich noch nicht direkt für die WM qualifiziert haben, spielen ein Doppel-K.o.-Bracket. Es wird so lange ausgesiebt, bis nur noch die Top 32 übrig sind.',
        visual: 'lcqVorrunde',
      },
      {
        tabLabel: 'Swiss', title: 'Swiss-Stage', teamsIn: 32,
        desc: '2 Gruppen à 16, Triple-Elimination (3 Siege = Aufstieg, 3 Niederlagen = raus), alle Spiele Bo5 -- exakt wie bei Open. Top 8 pro Gruppe (16 insgesamt) ziehen weiter.',
        visual: 'swissLadder', groupLabels: ['Gruppe A', 'Gruppe B'],
      },
      {
        tabLabel: 'Gruppenphase', title: 'Gruppenphase (GSL)', teamsIn: 16,
        desc: '2 Doppel-K.o.-Gruppen à 8 Teams, alle Spiele Bo5 -- exakt wie bei Open. Top 4 pro Gruppe (2 von der Gewinner-, 2 von der Verlierer-Seite) ziehen in die Playoffs ein.',
        visual: 'doubleElim', shape: 'standard8', bo: 'Bo5', groupLabels: ['Gruppe A', 'Gruppe B'],
      },
      {
        tabLabel: 'Playoffs', title: 'Playoffs', teamsIn: 8, trophy: true,
        desc: '"AFL Final Eight"-Format: die 4 Gruppensieger starten mit 2 Chancen im Oberen Bracket, die 4 Gruppenzweiten mit nur 1 Chance im Unteren Bracket. Alle Spiele Bo7. NUR der Turniersieger fährt zur Weltmeisterschaft.',
        visual: 'doubleElim', shape: 'afl8', bo: 'Bo7',
      },
    ],
  };
}

// ── Bracket-Befüllung mit echten Ergebnissen (Runde 86, User-Vorgabe "Die
// Bracket-Befüllung") ─────────────────────────────────────────────────────
// Läuft NACH dem Rendern (analog zu drawSvgConnectors(), siehe
// selectTournamentDetailTab()) und überschreibt die "TBD"/"–"-Platzhalter
// per getElementById()/querySelector() mit den echten Namen/Scores aus
// simulateStandard8Group()/simulateAflBracket()/simulateSingleElimBracket()/
// simulateRoundRobinGroup()/simulateSwissStage(). Rührt die HTML-Bau-
// Funktionen selbst NICHT an -- die Slot-Keys in `matches`/`slots` wurden
// bewusst so gewählt, dass sie exakt den dortigen DOM-IDs entsprechen.

// Runde 87, User-Vorgabe ("die jeweiligen Logos... auch im Bracket
// angezeigt werden"): liefert dieselbe Logo-URL/Badge-Fallback-Logik, die
// tournamentDetailSlotsHtml() schon seit Runde 45 nutzt -- `assignedOrg`
// wird bevorzugt per Referenz genommen (nicht per Namens-Lookup), damit das
// EIGENE Team garantiert korrekt aufgelöst wird, auch falls sein Name aus
// irgendeinem Grund nicht 1:1 in ORGANIZATIONS zu finden wäre.
// Runde 95, User-Vorgabe ("eigenes Team & Orga soll orange hervorgehoben
// werden, egal in welchem Turnier/Bracket"): einzige Stelle, die prüft, ob
// ein Team-Name die eigene Org ist -- von JEDER Fill-Funktion unten
// aufgerufen, die eine `.is-own-org`-CSS-Klasse (orange, siehe style.css)
// auf das jeweilige Zeilen-/Karten-Element setzt.
function isOwnOrgName(name) {
  return !!(assignedOrg && assignedOrg.name === name);
}

function applyOrgLogoToElement(el, teamName) {
  if (!el) return;
  const org = (assignedOrg && assignedOrg.name === teamName) ? assignedOrg : findOrgByName(teamName);
  const logoUrl = org ? resolveOrgLogoUrl(org) : null;
  if (logoUrl) {
    el.style.backgroundImage = 'url(' + logoUrl + ')';
    el.style.backgroundColor = '';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = orgBadgeColor(teamName);
    el.textContent = teamName.trim().charAt(0).toUpperCase();
  }
}

// `isFinal` (Runde 102, s. cascadeRevealMatchGameByGame() weiter unten):
// während der Serie noch läuft (Zwischenstand, z.B. 1:0 einer Bo5) darf die
// Sieger-Hervorhebung (`is-winner`) noch NICHT gesetzt werden -- die
// Zwischenführung ist ja nicht das Endergebnis. Default `true`, damit alle
// bestehenden (nicht-animierten) Aufrufstellen unverändert funktionieren.
function fillMatchCardResult(cardId, teamAName, scoreA, teamBName, scoreB, isFinal = true) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const teamRows = card.querySelectorAll('.tournament-match-card-team');
  function fillRow(rowEl, name, score, isWinner) {
    if (!rowEl) return;
    const nameEl = rowEl.querySelector('.tournament-match-card-name');
    const scoreEl = rowEl.querySelector('.tournament-match-card-score');
    if (nameEl) nameEl.textContent = name;
    if (scoreEl) scoreEl.textContent = String(score);
    applyOrgLogoToElement(rowEl.querySelector('.tournament-match-card-logo'), name);
    rowEl.classList.toggle('is-winner', isFinal && isWinner);
    rowEl.classList.toggle('is-own-org', isOwnOrgName(name));
  }
  fillRow(teamRows[0], teamAName, scoreA, scoreA > scoreB);
  fillRow(teamRows[1], teamBName, scoreB, scoreB > scoreA);
}

// Runde 94, User-Vorgabe ("wer weiter ist ohne Ergebnis"): zeigt NUR die
// beiden Team-Namen/Logos einer Karte, OHNE Score/Sieger-Markierung -- für
// die Runde, die als nächstes ansteht (die Teilnehmer stehen durch die
// bereits fertige Simulation schon fest, das Ergebnis wird aber laut Kalender
// erst am Folgetag enthüllt, siehe fillStandard8BracketPartial()).
function fillMatchCardNamesOnly(cardId, teamAName, teamBName) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const teamRows = card.querySelectorAll('.tournament-match-card-team');
  [[teamRows[0], teamAName], [teamRows[1], teamBName]].forEach(([rowEl, name]) => {
    if (!rowEl) return;
    const nameEl = rowEl.querySelector('.tournament-match-card-name');
    if (nameEl) nameEl.textContent = name;
    applyOrgLogoToElement(rowEl.querySelector('.tournament-match-card-logo'), name);
    rowEl.classList.toggle('is-own-org', isOwnOrgName(name));
  });
}

// Standard8-Doppel-K.o. hat immer genau 3 "Runden" (siehe
// simulateStandard8Group()): ubqf (Runde 1) -> ubsf+lbqf (Runde 2) -> lbsf
// (Runde 3). Nutzt dieselbe Slot-Präfix-Konvention wie roundLabelForSlot().
// `predecider` (Runde 93, Open-Qualifier-Vorentscheidungsspiel bei ungerader
// Feldgröße) zählt als Teil von Runde 1 -- es ist bereits VOR Runde 1 der
// Gruppen entschieden, wird also am selben Enthüllungstag gezeigt.
const STANDARD8_SLOT_ROUND = { predecider: 1, ubqf: 1, ubsf: 2, lbqf: 2, lbsf: 3 };

// Runde 105, User-Vorgabe ("Gruppe A und B sollen gleichzeitig laufen, sonst
// wartet man unnötig lange"): dieselbe Slot-Präfix->Runde-Zuordnung wie
// STANDARD8_SLOT_ROUND oben, jetzt auch für die AFL-Playoff-Brackets (siehe
// simulateAflBracket()) und das reine Einzel-K.o.-Bracket (Worlds-Playoffs,
// siehe simulateSingleElimBracket()) -- Grundlage für cascadeRevealStep()s
// rundenweise PARALLELE Enthüllung (alle Matches EINER Runde gleichzeitig,
// erst danach beginnt die nächste, von den Ergebnissen abhängige Runde).
// AFL8: ubr1+lbr1 (Runde 1, beide Seiten schon vor dem ersten Spiel geseedet)
// -> qf (Runde 2) -> sf (Runde 3) -> gf (Runde 4). AFL12: zusätzlich lbr2
// als eigene Runde zwischen lbr1 und qf (siehe simulateAflBracket()).
const AFL8_SLOT_ROUND = { ubr1: 1, lbr1: 1, qf: 2, sf: 3, gf: 4 };
const AFL12_SLOT_ROUND = { ubr1: 1, lbr1: 1, lbr2: 2, qf: 3, sf: 4, gf: 5 };

// Ermittelt die interne Bracket-Runde eines Matches (für die parallele
// Rundenweise-Enthüllung in cascadeRevealStep()). swissLadder/roundRobin
// liefern hier IMMER 1 -- Swiss-Matches sind beim Aufruf schon auf die
// aktuelle Runde vorgefiltert (siehe matchesForRevealStep()), Round-Robin-
// Matches haben untereinander keine Abhängigkeit (jeder-gegen-jeden), dürfen
// also ohnehin alle gleichzeitig laufen.
function roundNumberForMatch(stage, match) {
  // 'lcqVorrunde' (Runde 106): alle K.o.-Paare der Vorrunde sind unabhängig
  // voneinander (kein Bracket-Folge-Runden-Bezug wie bei standard8/afl) --
  // dasselbe Muster wie swissLadder/roundRobin, immer eine einzige Runde.
  if (stage.visual === 'swissLadder' || stage.visual === 'roundRobin' || stage.visual === 'lcqVorrunde') return 1;
  const prefix = match.slot ? match.slot.replace(/-\d+$/, '') : null;
  if (!prefix) return 1;
  if (stage.visual === 'bracket') {
    const m = /^r(\d+)$/.exec(prefix);
    return m ? Number(m[1]) + 1 : 1;
  }
  if (stage.shape === 'standard8') return STANDARD8_SLOT_ROUND[prefix] || 1;
  if (stage.shape === 'afl12') return AFL12_SLOT_ROUND[prefix] || 1;
  return AFL8_SLOT_ROUND[prefix] || 1;
}

// Rundenweise Enthüllung EINER standard8-Gruppe (Runde 94, User-Vorgabe:
// "Tag 1 nur Runde 1, wer weiter ist ohne Ergebnis in Halbfinale, Tag 2
// Halbfinale-Ergebnisse + wer weiter ist im Finale, letzter Tag Finale"):
// Matches bis einschließlich `roundDepth` bekommen Name+Score, die Matches
// GENAU eine Runde voraus bekommen nur die Namen (Teilnehmer stehen fest,
// Ergebnis kommt erst morgen), alles weiter Entfernte bleibt "TBD".
function fillStandard8BracketPartial(treeId, groupResult, roundDepth) {
  (groupResult.matches || []).forEach((m) => {
    const prefix = m.slot.replace(/-\d+$/, '');
    const round = STANDARD8_SLOT_ROUND[prefix];
    if (round === undefined || round > roundDepth + 1) return;
    if (round <= roundDepth) {
      fillMatchCardResult(treeId + '-' + m.slot, m.teamAName, m.scoreA, m.teamBName, m.scoreB);
    } else {
      fillMatchCardNamesOnly(treeId + '-' + m.slot, m.teamAName, m.teamBName);
    }
  });
  // Die 4 "Qualifiziert"-Einzelslots (ubq-0/1, lbq-0/1) fassen das Ergebnis
  // der letzten Runde (lbsf) zusammen -- erst zeigen, wenn die enthüllt ist.
  if (roundDepth >= 3) (groupResult.slots || []).forEach((s) => fillQualifiedSlot(treeId + '-' + s.slot, s.teamName));
}

// Runde 105, Verallgemeinerung von fillStandard8BracketPartial() (die dort
// hart auf STANDARD8_SLOT_ROUND verdrahtet bleibt, für ihre bestehenden
// Aufrufer unverändert) -- nutzt stattdessen das generische
// roundNumberForMatch(), funktioniert dadurch für JEDE rundenbasierte
// Bracket-Form (afl8/afl12/Einzel-K.o.). Wird für die Re-Render-während-
// laufender-Kaskade-Reparatur gebraucht (siehe cascadeRevealStep()) UND für
// den neuen Auslosungstag vor AFL-/Einzel-K.o.-Playoffs (roundDepth=0).
function fillBracketMatchesPartial(stage, treeId, matches, roundDepth) {
  (matches || []).forEach((m) => {
    const round = roundNumberForMatch(stage, m);
    if (round > roundDepth + 1) return;
    if (round <= roundDepth) {
      fillMatchCardResult(treeId + '-' + m.slot, m.teamAName, m.scoreA, m.teamBName, m.scoreB);
    } else {
      fillMatchCardNamesOnly(treeId + '-' + m.slot, m.teamAName, m.teamBName);
    }
  });
}

function fillQualifiedSlot(slotId, teamName) {
  const el = document.getElementById(slotId);
  if (!el) return;
  const nameEl = el.querySelector('.tournament-match-card-name');
  if (nameEl) nameEl.textContent = teamName;
  applyOrgLogoToElement(el.querySelector('.tournament-match-card-logo'), teamName);
  el.classList.toggle('is-own-org', isOwnOrgName(teamName));
}

// Wiederverwendet für standard8/AFL/Einzel-K.o. -- alle drei nutzen
// dieselbe `tournamentMatchCardHtml()`-Kartenstruktur, `slots` (Einzelteam-
// Boxen ohne Score) ist optional (nur standard8 hat sie).
function fillBracketMatches(treeId, matches, slots) {
  (matches || []).forEach((m) => fillMatchCardResult(treeId + '-' + m.slot, m.teamAName, m.scoreA, m.teamBName, m.scoreB));
  (slots || []).forEach((s) => fillQualifiedSlot(treeId + '-' + s.slot, s.teamName));
}

// Setzt/entfernt das "Freilos"-Badge auf einem Qualifiziert-Slot der
// LCQ-Vorrunde (siehe buildLcqVorrundeBracket()) -- ein separates .hidden-
// Toggle statt Text-Ersetzung, damit fillQualifiedSlot() (Name/Logo/
// is-own-org) unverändert wiederverwendet werden kann.
function setLcqVorrundeByeTag(slotId, isBye) {
  const el = document.getElementById(slotId);
  const tag = el && el.querySelector('.lcq-vorrunde-bye-tag');
  if (tag) tag.classList.toggle('hidden', !isBye);
}

// Vollständige (End-)Befüllung der LCQ-Vorrunde: K.o.-Matches mit echtem
// Ergebnis, alle Qualifiziert-Slots mit Name + "Freilos"-Badge, wo
// zutreffend. `instanceId` ist bereits der Baum-Container (stageInstanceId
// + '-vr', siehe tournamentStageHtml()).
function fillLcqVorrundeResults(instanceId, vorrundeData) {
  const koMatches = vorrundeData.koMatches || [];
  koMatches.forEach((m) => fillMatchCardResult(instanceId + '-' + m.slot, m.teamAName, m.scoreA, m.teamBName, m.scoreB));
  const byeNameSet = new Set([...(vorrundeData.seededByeNames || []), ...(vorrundeData.koByeNames || [])]);
  (vorrundeData.qualifiedNames || []).forEach((name, i) => {
    const slotId = instanceId + '-q-' + i;
    fillQualifiedSlot(slotId, name);
    setLcqVorrundeByeTag(slotId, byeNameSet.has(name));
  });
}

// Bug-Fix (Runde 106, dasselbe Muster wie fillRoundRobinResultsPartial()):
// ein noch nicht angesehenes eigenes K.o.-Match der Vorrunde bleibt namens-
// only, der davon abhängige Qualifiziert-Slot (per Index -- die ersten
// `koMatches.length` Slots gehören laut resolveLcqEvent()s Reihenfolge
// GENAU zu den K.o.-Matches derselben Position) bleibt bis dahin ebenfalls
// TBD. Freilos-Slots (Index >= koMatches.length) sind IMMER sofort sicher
// zu zeigen -- sie hängen an keinem Match, nur an der (schon vorab
// feststehenden) Band-Seedierung.
function fillLcqVorrundeResultsPartial(instanceId, vorrundeData, event, step) {
  const koMatches = vorrundeData.koMatches || [];
  const koVisible = koMatches.map((m) => !m.isOwnMatch || shownOwnMatchSteps[ownMatchKey(event, step, { ...m, _groupIndex: 0 })]);
  koMatches.forEach((m, i) => {
    if (koVisible[i]) fillMatchCardResult(instanceId + '-' + m.slot, m.teamAName, m.scoreA, m.teamBName, m.scoreB);
    else fillMatchCardNamesOnly(instanceId + '-' + m.slot, m.teamAName, m.teamBName);
  });
  const byeNameSet = new Set([...(vorrundeData.seededByeNames || []), ...(vorrundeData.koByeNames || [])]);
  (vorrundeData.qualifiedNames || []).forEach((name, i) => {
    if (i < koMatches.length && !koVisible[i]) return; // TBD, noch keine Karte anfassen
    const slotId = instanceId + '-q-' + i;
    fillQualifiedSlot(slotId, name);
    setLcqVorrundeByeTag(slotId, byeNameSet.has(name));
  });
}

// Bug-Fix (Runde 106, per Live-Test gefunden: "zwischen eigenen Matches
// derselben Major-Gruppe verschwinden beim Re-Render auch die schon
// bekannten Bot-Ergebnisse"): Round-Robin-Gruppen (Major/Worlds) können
// jetzt mehrere eigene Matches INNERHALB derselben Runde haben (siehe
// playRound()s neue Mehrfach-Pause) -- die alte fillRoundRobinResults()
// kennt nur "ganze Gruppe komplett fertig" oder "noch gar nicht angefasst"
// (keine Zwischenstufe). Verlässt der Spieler die Seite (oder wird sie neu
// gerendert) zwischen zwei eigenen Matches DERSELBEN Gruppe, baute
// tournamentStageHtml() frische, leere DOM-Karten -- ohne einen Zwischen-
// Fülle-Pfad blieb alles TBD, auch längst bekannte Bot-Ergebnisse. Füllt
// jetzt jedes Match einzeln: Bot-Matches und bereits angesehene eigene
// Matches (shownOwnMatchSteps) bekommen sofort ihr Ergebnis, ein noch
// ausstehendes eigenes Match bleibt namens-only (TBD-Score) bis es gespielt
// wurde. Die Tabelle (Standings) wird erst befüllt, sobald WIRKLICH jedes
// Match der Gruppe sichtbar ist (sonst wäre sie rechnerisch falsch).
function fillRoundRobinResultsPartial(instanceId, groupResult, event, step, groupIndex) {
  let allVisible = true;
  (groupResult.results || []).forEach((m) => {
    // Bug-Fix (Runde 106, per Live-Test gefunden: gezeigte eigene Matches
    // blieben trotzdem dauerhaft namens-only): ownMatchKey()/matchUniqueSlotId()
    // brauchen `_groupIndex` -- die in `groupResult.results` gespeicherten
    // ORIGINAL-Matchobjekte tragen dieses Feld NICHT (nur die in
    // matchesForRevealStep() erzeugte Kopie hat es), ein Vergleich ohne
    // explizites `_groupIndex: groupIndex` erzeugte dadurch einen komplett
    // anderen Schlüssel als den, der beim Abspielen als "gezeigt" markiert
    // wurde -- `visible` war dadurch für eigene Matches IMMER false.
    const visible = !m.isOwnMatch || shownOwnMatchSteps[ownMatchKey(event, step, { ...m, _groupIndex: groupIndex })];
    if (visible) fillMatchCardResult(instanceId + '-' + m.slot, m.a, m.winsA, m.b, m.winsB);
    else { fillMatchCardNamesOnly(instanceId + '-' + m.slot, m.a, m.b); allVisible = false; }
  });
  if (!allVisible) return;
  (groupResult.standings || []).forEach((s, i) => {
    const row = document.getElementById(instanceId + '-standing-' + i);
    if (!row) return;
    const teamEl = row.querySelector('.tournament-rr-standings-team');
    const winsEl = row.querySelector('.tournament-rr-standings-wins');
    const lossesEl = row.querySelector('.tournament-rr-standings-losses');
    const labelEl = teamEl && teamEl.querySelector('.tournament-rr-standings-label');
    if (labelEl) labelEl.textContent = s.orgName;
    if (teamEl) {
      applyOrgLogoToElement(teamEl.querySelector('.tournament-rr-standings-logo'), s.orgName);
      teamEl.classList.toggle('is-own-org', isOwnOrgName(s.orgName));
    }
    if (winsEl) winsEl.textContent = String(s.wins);
    if (lossesEl) lossesEl.textContent = String(s.losses);
  });
}

function fillRoundRobinResults(instanceId, groupResult) {
  (groupResult.results || []).forEach((m) => fillMatchCardResult(instanceId + '-' + m.slot, m.a, m.winsA, m.b, m.winsB));
  (groupResult.standings || []).forEach((s, i) => {
    const row = document.getElementById(instanceId + '-standing-' + i);
    if (!row) return;
    const teamEl = row.querySelector('.tournament-rr-standings-team');
    const winsEl = row.querySelector('.tournament-rr-standings-wins');
    const lossesEl = row.querySelector('.tournament-rr-standings-losses');
    // Runde 87: Name geht ins verschachtelte `-label`-Element (nicht mehr
    // direkt in die `<td>`, sonst würde .textContent= das Logo-Element
    // mitlöschen), zusätzlich Logo befüllen.
    const labelEl = teamEl && teamEl.querySelector('.tournament-rr-standings-label');
    if (labelEl) labelEl.textContent = s.orgName;
    if (teamEl) {
      applyOrgLogoToElement(teamEl.querySelector('.tournament-rr-standings-logo'), s.orgName);
      teamEl.classList.toggle('is-own-org', isOwnOrgName(s.orgName));
    }
    if (winsEl) winsEl.textContent = String(s.wins);
    if (lossesEl) lossesEl.textContent = String(s.losses);
  });
}

// tournamentSwissLadderHtml() rechnet ihre Spalten-/Zeilenstruktur fest für
// 16 Teams aus (computeSwissLadderColumns(16, ...), nie parametrisiert) --
// zunächst vermutet, das würde bei LCQs realistischen 14/15-Team-
// Regionsfeldern (siehe rlcs-legends-project.md) zu fehlenden Ziel-Zeilen
// führen. Empirisch widerlegt (Node-Verifikation, Runde 86): Spalten-
// Schlüssel (colId(w,l)) und Tag-Nummerierung hängen NUR von der 3-3-
// Schwelle ab, nicht von der Teamzahl -- ein 14- oder 15-Team-Lauf erzeugt
// dieselben (w,l)-Zustände wie ein 16er-Lauf, nur mit weniger Zeilen PRO
// Spalte (nie mehr als die im 16-Team-HTML vorhandenen). Über je 10
// zufällige Durchläufe bei 14/15/16 Teams: 0 fehlende Ziel-IDs in allen
// Fällen -- die Funktion füllt daher unabhängig von der tatsächlichen
// Teamzahl korrekt und vollständig, kein Team-Zahl-Guard nötig.
// Runde 87: befüllt sowohl `.swiss-table-team-label` (Name) als auch
// `.swiss-table-team-logo` (echtes Logo/Badge-Fallback, siehe
// applyOrgLogoToElement()) -- Freilos-Gegner ("Freilos", kein echtes Team)
// bekommt bewusst KEIN Logo.
function fillSwissTeamCell(teamEl, teamName) {
  if (!teamEl) return;
  const labelEl = teamEl.querySelector('.swiss-table-team-label');
  if (labelEl) labelEl.textContent = teamName;
  if (teamName !== 'Freilos') applyOrgLogoToElement(teamEl.querySelector('.swiss-table-team-logo'), teamName);
  teamEl.classList.toggle('is-own-org', isOwnOrgName(teamName));
}

function fillSwissLadderResults(instanceId, swissResult) {
  (swissResult.log || []).forEach((entry) => {
    const rowId = instanceId + '-col-' + entry.colKey.replace(',', '-') + '-m' + entry.row;
    const rowEl = document.getElementById(rowId);
    if (!rowEl) return;
    const teamEls = rowEl.querySelectorAll('.swiss-table-team');
    fillSwissTeamCell(teamEls[0], entry.a);
    fillSwissTeamCell(teamEls[1], entry.b === null ? 'Freilos' : entry.b);
    // Runde 90, User-Vorgabe ("die gespielten Einzelergebnisse... lesen
    // können"): "vs"-Platzhalter wird bei echten Matches durch den
    // tatsächlichen Score ersetzt (Freilos hat keinen Score, bleibt "vs").
    const vsEl = rowEl.querySelector('.swiss-table-vs');
    if (vsEl && entry.b !== null) {
      vsEl.textContent = entry.winsA + ':' + entry.winsB;
      vsEl.classList.add('has-score');
    }
  });
  (swissResult.qualifiedSlots || []).forEach((s) => {
    const rowEl = document.getElementById(instanceId + '-q' + s.day + '-m' + s.row);
    if (rowEl) fillSwissTeamCell(rowEl.querySelector('.swiss-table-team'), s.teamName);
  });
  (swissResult.eliminatedSlots || []).forEach((s) => {
    const rowEl = document.getElementById(instanceId + '-e' + s.day + '-m' + s.row);
    if (rowEl) fillSwissTeamCell(rowEl.querySelector('.swiss-table-team'), s.teamName);
  });
}

// Runde 103, User-Vorgabe ("Swiss soll Runde für Runde enthüllt werden, nicht
// die ganze Stage auf einen Schlag"): exaktes Gegenstück zu
// fillStandard8BracketPartial() für die Swiss-Ladder-Darstellung -- Matches
// bis einschließlich `swissRoundDepth` bekommen Name+Score, die Matches GENAU
// eine Runde voraus (schon feststehende Paarung, Ergebnis kommt erst morgen)
// nur die Namen, alles weiter Entfernte bleibt "TBD". Qualifiziert-/
// Eliminiert-Endcaps hängen an `day` (= Runde+1, dieselbe Bedeutung wie
// `round` hier), werden also erst gezeigt, sobald ihre auslösende Runde
// enthüllt ist.
function fillSwissLadderResultsPartial(instanceId, swissResult, swissRoundDepth) {
  (swissResult.log || []).forEach((entry) => {
    if (entry.round > swissRoundDepth + 1) return;
    const rowId = instanceId + '-col-' + entry.colKey.replace(',', '-') + '-m' + entry.row;
    const rowEl = document.getElementById(rowId);
    if (!rowEl) return;
    const teamEls = rowEl.querySelectorAll('.swiss-table-team');
    fillSwissTeamCell(teamEls[0], entry.a);
    fillSwissTeamCell(teamEls[1], entry.b === null ? 'Freilos' : entry.b);
    if (entry.round <= swissRoundDepth) {
      const vsEl = rowEl.querySelector('.swiss-table-vs');
      if (vsEl && entry.b !== null) {
        vsEl.textContent = entry.winsA + ':' + entry.winsB;
        vsEl.classList.add('has-score');
      }
    }
  });
  (swissResult.qualifiedSlots || []).forEach((s) => {
    if (s.day - 1 > swissRoundDepth) return;
    const rowEl = document.getElementById(instanceId + '-q' + s.day + '-m' + s.row);
    if (rowEl) fillSwissTeamCell(rowEl.querySelector('.swiss-table-team'), s.teamName);
  });
  (swissResult.eliminatedSlots || []).forEach((s) => {
    if (s.day - 1 > swissRoundDepth) return;
    const rowEl = document.getElementById(instanceId + '-e' + s.day + '-m' + s.row);
    if (rowEl) fillSwissTeamCell(rowEl.querySelector('.swiss-table-team'), s.teamName);
  });
}

// Ordnet jedem Stage-INDEX (feste Reihenfolge, siehe tournamentFormatInfo())
// den passenden Schlüssel im resolveXxxEvent()-Rückgabeobjekt zu. `null` =
// diese Stage hat keine befüllbaren Bracket-Karten (LCQ-Vorrunde, `visual:
// 'info'`, hat kein Bracket-Visual, siehe tournamentStageHtml()).
function stageResultKeysForEventType(event) {
  if (event.key === 'open0') return ['gruppenphase']; // Runde 93: eine einzige Stage, 8 Gruppen
  if (event.eventType === 'open') return ['swiss', 'gruppenphase', 'playoffs'];
  if (event.eventType === 'major') return ['gruppenphase', 'playoffs'];
  if (event.eventType === 'worlds') return ['playIn', 'swiss', 'playoffs'];
  if (event.eventType === 'lcq') return ['vorrunde', 'swiss', 'gruppenphase', 'playoffs'];
  return [];
}

// Dispatcht anhand von stage.visual (nicht per Label-String, robuster) auf
// die passende fillXxxResults()-Funktion. `stageData` ist bereits das
// richtige Unterobjekt (Array bei gruppierten Stages, einzelnes Ergebnis
// sonst), siehe stageResultKeysForEventType().
// `roundDepth` (Runde 94): nur für den Open Qualifier gesetzt (dessen einzige
// Stage 8 standard8-Gruppen enthält, siehe resolveOpenQualifierEvent()) --
// steuert die rundenweise Enthüllung INNERHALB jeder Gruppe (siehe
// fillStandard8BracketPartial()).
// `groupRevealCount` (Runde 94): nur für Majors Gruppenphase gesetzt (4
// Gruppen A-D in EINER Stage, aber User-Vorgabe "Tag1 Gruppe A, Tag2 Gruppe
// B..." -- jede Gruppe ihr EIGENER Enthüllungstag statt der ganzen Stage auf
// einmal) -- befüllt nur die ersten `groupRevealCount` Gruppen-Instanzen.
// Beide Parameter bleiben bei allen anderen Turnierarten `undefined` -- dort
// wird eine bereits enthüllte Stage komplett auf einmal gefüllt (die
// Enthüllung passiert dort rein auf STAGE-Ebene, siehe renderTournamentFormatTabs()).
// `ownMatchEvent`/`ownMatchStep` (Runde 106, optional): nur von
// cascadeRevealStep() gesetzt, wenn eine Round-Robin-Gruppe (Major/Worlds)
// noch mitten in ihrer eigenen-Match-Pause stecken könnte -- siehe
// fillRoundRobinResultsPartial(). Alle anderen Aufrufer (Stage längst
// komplett fertig, z.B. eine frühere Gruppe/ein früherer Tag) lassen diese
// Parameter weg und bekommen unverändert die alte Sofort-Komplett-Füllung.
function fillStageResults(stage, stageInstanceId, stageData, roundDepth, groupRevealCount, ownMatchEvent, ownMatchStep) {
  if (!stageData) return;
  if (stage.visual === 'swissLadder') {
    // Runde 103: `roundDepth` wird hier für die NEUE Swiss-Runden-für-Runde-
    // Enthüllung wiederverwendet (open0s doubleElim-Zweig unten und diese
    // Stage kommen nie gleichzeitig vor, keine Überschneidungsgefahr).
    if (stage.groupLabels) {
      stageData.forEach((res, gi) => {
        if (roundDepth !== undefined) fillSwissLadderResultsPartial(stageInstanceId + '-sw' + gi, res, roundDepth);
        else fillSwissLadderResults(stageInstanceId + '-sw' + gi, res);
      });
    } else if (roundDepth !== undefined) {
      fillSwissLadderResultsPartial(stageInstanceId + '-sw', stageData, roundDepth);
    } else {
      fillSwissLadderResults(stageInstanceId + '-sw', stageData);
    }
  } else if (stage.visual === 'roundRobin') {
    const revealCount = groupRevealCount !== undefined ? groupRevealCount : stageData.length;
    stageData.slice(0, revealCount).forEach((res, gi) => {
      if (ownMatchEvent) fillRoundRobinResultsPartial(stageInstanceId + '-rr' + gi, res, ownMatchEvent, ownMatchStep, gi);
      else fillRoundRobinResults(stageInstanceId + '-rr' + gi, res);
    });
  } else if (stage.visual === 'doubleElim') {
    if (stage.groupLabels) {
      stageData.forEach((res, gi) => {
        if (roundDepth !== undefined) fillStandard8BracketPartial(stageInstanceId + '-de' + gi, res, roundDepth);
        else fillBracketMatches(stageInstanceId + '-de' + gi, res.matches, res.slots);
      });
    } else if (roundDepth !== undefined) {
      // Runde 105: afl8/afl12 (Playoffs) hatten bisher KEINEN roundDepth-Zweig
      // -- ein Re-Render während laufender Kaskade (siehe cascadeRevealStep())
      // füllte dadurch immer ALLES instant, egal wie weit die Animation
      // tatsächlich war.
      fillBracketMatchesPartial(stage, stageInstanceId + '-de', stageData.matches, roundDepth);
    } else {
      fillBracketMatches(stageInstanceId + '-de', stageData.matches, stageData.slots);
    }
  } else if (stage.visual === 'bracket') {
    if (roundDepth !== undefined) fillBracketMatchesPartial(stage, stageInstanceId + '-se', stageData.matches, roundDepth);
    else fillBracketMatches(stageInstanceId + '-se', stageData.matches, null);
  } else if (stage.visual === 'lcqVorrunde') {
    if (ownMatchEvent) fillLcqVorrundeResultsPartial(stageInstanceId + '-vr', stageData, ownMatchEvent, ownMatchStep);
    else fillLcqVorrundeResults(stageInstanceId + '-vr', stageData);
  }
}

// Runde 102, User-Vorgabe ("Swiss/jedes Turnierformat soll Match für Match
// step-by-step aufgelöst wirken, nicht alle Bot-Matches gleichzeitig fertig,
// sobald man sein eigenes Match spielt -- automatisch nacheinander"):
// rekonstruiert das DOM-Element EINES einzelnen Matches aus
// matchesForRevealStep()s neuem `_groupIndex`-Tag + derselben Slot-/Zeilen-
// Konvention, die tournamentStageHtml()/fillStageResults() für ihre Karten-
// IDs verwenden.
function domIdForCascadeMatch(stageInstanceId, stage, match) {
  if (stage.visual === 'swissLadder') {
    const base = stage.groupLabels ? stageInstanceId + '-sw' + match._groupIndex : stageInstanceId + '-sw';
    return base + '-col-' + match.colKey.replace(',', '-') + '-m' + match.row;
  }
  if (stage.visual === 'roundRobin') return stageInstanceId + '-rr' + match._groupIndex + '-' + match.slot;
  if (stage.visual === 'doubleElim') {
    const base = stage.groupLabels ? stageInstanceId + '-de' + match._groupIndex : stageInstanceId + '-de';
    return base + '-' + match.slot;
  }
  if (stage.visual === 'bracket') return stageInstanceId + '-se-' + match.slot;
  return null;
}

// Befüllt GENAU ein Match auf einem ZWISCHENSTAND (Runde 102, User-Vorgabe
// "nicht nach Skript, sondern nach bester Simulation läuft das Ergebnis ab --
// z.B. 1:0, verzögert 2:0, 2:1, 3:1"): `winsA`/`winsB` sind der Serienstand
// NACH dem gerade "gespielten" Einzelspiel, `isFinal` steuert nur die Sieger-
// Hervorhebung (fillMatchCardResult()). Swiss-Log-Einträge kennen keine
// Sieger-Hervorhebung, `isFinal` ist dort ohne Wirkung.
function fillCascadeMatchTally(stageInstanceId, stage, match, winsA, winsB, isFinal) {
  const domId = domIdForCascadeMatch(stageInstanceId, stage, match);
  if (!domId) return null;
  if (stage.visual === 'swissLadder') {
    const rowEl = document.getElementById(domId);
    if (!rowEl) return null;
    const teamEls = rowEl.querySelectorAll('.swiss-table-team');
    fillSwissTeamCell(teamEls[0], match.a);
    fillSwissTeamCell(teamEls[1], match.b === null ? 'Freilos' : match.b);
    const vsEl = rowEl.querySelector('.swiss-table-vs');
    if (vsEl && match.b !== null) { vsEl.textContent = winsA + ':' + winsB; vsEl.classList.add('has-score'); }
    return rowEl;
  }
  if (!document.getElementById(domId)) return null;
  if (stage.visual === 'roundRobin') fillMatchCardResult(domId, match.a, winsA, match.b, winsB, isFinal);
  else fillMatchCardResult(domId, match.teamAName, winsA, match.teamBName, winsB, isFinal);
  return document.getElementById(domId);
}

// Kurzer, neutraler Aufblitz-Effekt (.is-cascade-revealed, siehe style.css) --
// entfernt/erzwungener Reflow davor, damit ein wiederholtes Aufblitzen
// desselben Elements (mehrere Einzelspiele hintereinander) die Animation
// jedes Mal neu startet statt sie nur zu verlängern (dasselbe Muster wie
// highlightPlayerTile() für den Live-Ticker).
function flashCascadeElement(el) {
  if (!el) return;
  el.classList.remove('is-cascade-revealed');
  void el.offsetWidth;
  el.classList.add('is-cascade-revealed');
  setTimeout(() => el.classList.remove('is-cascade-revealed'), 900);
}

const CASCADE_GAME_DELAY_MS = 1000; // Pause zwischen zwei Einzelspielen DERSELBEN Serie
const CASCADE_MATCH_GAP_MS = 450; // Pause NACH einer fertigen Serie, bevor das nächste Match beginnt

// Spielt EIN Match Spiel für Spiel durch (match.games -- dieselben, schon
// fertig simulierten Einzelspiel-Ergebnisse, die auch playOwnMatchSeriesLive()
// für den eigenen Live-Ticker verwendet, siehe simulateBotSeries()): nach
// jedem Einzelspiel wird der Serienstand aktualisiert (1:0, dann verzögert
// 2:0, 2:1, 3:1, ...), NICHT nur das Endergebnis eingeblendet. `onDone()`
// läuft, sobald die Serie (oder ein Freilos ohne games) fertig angezeigt ist.
function cascadeRevealSingleMatch(stageInstanceId, stage, match, onDone) {
  const games = match.games;
  if (!games || games.length === 0) {
    // Freilos/kein Spielverlauf bekannt -- direkt den Endstand zeigen.
    const finalWinsA = match.winsA !== undefined ? match.winsA : match.scoreA;
    const finalWinsB = match.winsB !== undefined ? match.winsB : match.scoreB;
    flashCascadeElement(fillCascadeMatchTally(stageInstanceId, stage, match, finalWinsA, finalWinsB, true));
    onDone();
    return;
  }
  let winsA = 0;
  let winsB = 0;
  function playNextGame(gameIndex) {
    const g = games[gameIndex];
    if (g.scoreA > g.scoreB) winsA++; else winsB++;
    const isFinal = gameIndex === games.length - 1;
    flashCascadeElement(fillCascadeMatchTally(stageInstanceId, stage, match, winsA, winsB, isFinal));
    if (isFinal) { onDone(); return; }
    setTimeout(() => playNextGame(gameIndex + 1), CASCADE_GAME_DELAY_MS);
  }
  playNextGame(0);
}

// Runde 102: enthüllt ALLE Matches EINES Enthüllungs-Schritts nacheinander --
// UND innerhalb jedes einzelnen Matches Spiel für Spiel (cascadeRevealSingleMatch()),
// als würde man live zuschauen, statt einfach den fertigen Endstand
// hinzuplumpsen. Rein visuelle Staffelung, die Simulation selbst bleibt
// komplett instant/deterministisch (Instant-Philosophie unverändert, siehe
// resolveEventIfDue()), nur die ANZEIGE wird zeitversetzt nachgezogen. Läuft
// nur EINMAL pro Schritt (cascadeRevealedSteps, gleicher Schlüssel wie
// shownOwnMatchSteps) -- ein späteres erneutes Rendern derselben, schon
// enthüllten Stage (z.B. Tab-Wechsel) nutzt wieder die normale, sofortige
// fillStageResults() statt die Animation erneut abzuspielen. Der Abschluss-
// Aufruf von fillStageResults() NACH der Animation fängt zusätzlich Freilose/
// abgeleitete Tabellenstände (Standings, Qualifiziert-Slots) ab, die
// matchesForRevealStep() bewusst nicht liefert (siehe dortiger Kommentar).
// Runde 105, Bug-Fix (User-Meldung: "nachdem ich mein erstes Match in der
// Gruppenphase gespielt habe, wurde der Rest sofort auto simuliert, nicht
// Match für Match"): per Live-Test bestätigt -- klickt der Spieler direkt
// nach dem eigenen Match sofort wieder WEITER (bevor die mehrsekündige
// Kaskaden-Animation der übrigen Bot-Matches fertig ist), rendert
// renderTournamentFormatTabs() die Turnier-Detailseite für den NEUEN Tag
// komplett neu -- die laufende Animation wird dabei mitten drin durch eine
// frische, bereits komplett gefüllte Ansicht ersetzt (aus Sicht des NEUEN
// Tages ist die Stage ja tatsächlich schon vollständig vorbei, das ist an
// sich korrekt), der Spieler bekommt die Kaskade dadurch aber nie zu Gesicht.
// `cascadeAnimationActive` sperrt deshalb den Tagfortschritt (WEITER/MATCH-
// Button wird disabled, siehe renderDashboardTopbar()), solange irgendeine
// Animation noch läuft -- true ab dem ersten Einzelspiel, false sobald
// `finish()` erreicht ist (auch im Freilos-/0-Matches-Sofortfall, dort war
// ohnehin nichts zu sperren). Beide Übergänge rendern die Topbar sofort neu,
// damit der Button ohne Verzögerung reagiert.
let cascadeAnimationActive = false;
// Runde 105, Bug-Fix (User-Meldung: "In der Gruppenphase muss ich alle
// Matches machen, bevor diese angezeigt werden -- soll step-by-step wie bei
// Swiss/Doppel-K.o. gelöst sein"): per Live-Test reproduziert -- verlässt der
// Spieler die Turnier-Detailseite (z.B. zur Startseite) und kehrt zurück,
// WÄHREND eine Kaskaden-Animation noch läuft, baut renderTournamentFormatTabs()
// die komplette Stage-HTML frisch auf (neue DOM-Elemente, gleiche IDs, siehe
// tournamentStageHtml()) -- der bisherige, EINZIGE Guard (cascadeRevealedSteps)
// unterschied dabei nicht zwischen "noch nie enthüllt" und "wird gerade
// enthüllt": ein Re-Render während einer laufenden Animation fiel auf
// finish() zurück und füllte SOFORT ALLES instant, die eigentlich noch
// laufende, für den Spieler nie sichtbar gewordene Animation wurde komplett
// verschluckt. `cascadeRoundProgress[key]` merkt sich deshalb, wie viele
// Runden bereits WIRKLICH fertig animiert sind -- ein Re-Render während
// `cascadeAnimationActive` füllt nur genau diesen bereits abgeschlossenen
// Teil sofort nach (fillStageResults() mit passendem roundDepth) und lässt
// die im Hintergrund weiterlaufende Original-Animation unangetastet -- ihre
// Timer aktualisieren die neuen (gleich benannten) DOM-Elemente von selbst
// weiter, sobald die nächste Runde fertig ist.
const cascadeRoundProgress = {};
// Runde 105, Folge-Fix (User-Meldung: "Bei Gruppenphase/Playoffs muss ich
// direkt hintereinander ALLE eigenen Matches bestreiten, ohne die Bot-
// Kaskade dazwischen zu sehen -- erst danach wird alles auf einmal gezeigt.
// Mache das wie bei Swiss/Open-Quali"): der vorherige Fix (sofortiges erneutes
// findOwnMatchToday() direkt nach jedem eigenen Match, siehe
// triggerPendingOwnMatch()) behob zwar das Kernproblem "zweites eigenes Match
// wird nie erkannt", ließ aber die komplette Runden-Kaskade bis zum LETZTEN
// eigenen Match blockiert (visualRevealStepCount()s Drossel hält die GANZE
// Stage zurück, solange irgendein eigenes Match dieses Schritts noch offen
// ist) -- der Spieler sah dadurch nie die Bot-Ergebnisse zwischen seinen
// eigenen Matches, genau wie bei Swiss/Open-Quali gewünscht. Jetzt läuft die
// Runden-Kaskade WIRKLICH rundenweise durch: findet eine Runde ein noch
// unangesehenes eigenes Match, laufen die ÜBRIGEN (Bot-)Matches dieser Runde
// trotzdem normal durch, DANACH pausiert die Kette (MATCH-Button, kein
// WEITER-Sperren mehr -- der Spieler soll ja klicken können) und wird nach
// dem Ansehen des eigenen Matches GENAU an dieser Stelle fortgesetzt
// (cascadeResumeCallbacks[] hält dafür die Fortsetzungs-Funktion bereit,
// siehe triggerPendingOwnMatch()).
const cascadeResumeCallbacks = {};
function cascadeRevealStep(event, step, stage, stageInstanceId, stageData, roundDepth, groupRevealCount) {
  const key = ownMatchStepKey(event, step) + '|' + stageInstanceId;
  const finish = () => {
    cascadeAnimationActive = false;
    fillStageResults(stage, stageInstanceId, stageData, roundDepth, groupRevealCount, event, step);
    renderDashboardTopbar();
  };
  // Runde 105: "pausiert, wartet auf ein gerade angezeigtes eigenes Match"
  // ist ein DRITTER Zustand neben "läuft gerade" (cascadeAnimationActive)
  // und "komplett fertig" -- in beiden Fällen darf ein Re-Render (z.B. Tab-
  // Wechsel, Seite verlassen+zurück) NICHT alles instant füllen, sondern nur
  // den bereits wirklich abgeschlossenen Teil.
  const isPausedForOwnMatch = !!(pendingOwnMatch && pendingOwnMatch.event.key === event.key && cascadeResumeCallbacks[pendingOwnMatch.stepKey]);
  if (cascadeRevealedSteps[key]) {
    if (cascadeAnimationActive || isPausedForOwnMatch) {
      const doneRounds = cascadeRoundProgress[key] || 0;
      // Bug-Fix (Runde 106, per Live-Test gefunden: "zwischen zwei eigenen
      // Matches derselben Major-Gruppe verschwinden beim Re-Render auch die
      // schon bekannten Bot-Ergebnisse"): die alte Fassung schloss die GERADE
      // laufende Gruppe (doneRounds===0, also noch keine Runde komplett fertig
      // -- bei Round-Robin trifft das zu, solange noch nicht ALLE eigenen
      // Matches der Gruppe gespielt sind) komplett von fillStageResults() aus,
      // um sie nicht versehentlich sofort komplett zu füllen. Seit
      // fillRoundRobinResultsPartial() (s.o.) ist das nicht mehr nötig --
      // die volle groupRevealCount wird jetzt IMMER übergeben, zusammen mit
      // event/step, damit die Partial-Fill-Funktion pro Match selbst
      // entscheidet: Bot-Matches und schon gezeigte eigene Matches bekommen
      // ihr Ergebnis, ein noch offenes eigenes Match bleibt namens-only.
      if (doneRounds > 0 || groupRevealCount !== undefined) {
        fillStageResults(stage, stageInstanceId, stageData, doneRounds, groupRevealCount, event, step);
      }
      return;
    }
    finish();
    return;
  }
  cascadeRevealedSteps[key] = true;
  const matches = matchesForRevealStep(event, step);
  if (matches.length === 0) { finish(); return; }
  cascadeAnimationActive = true;
  cascadeRoundProgress[key] = 0;
  renderDashboardTopbar();

  // Runde 105, User-Vorgabe ("Gruppe A und B sollen gleichzeitig laufen,
  // sonst wartet ein Spieler unnötig lange, was Spielspaß nehmen kann"):
  // Matches werden nach ihrer INTERNEN Bracket-Runde gruppiert
  // (roundNumberForMatch()) -- innerhalb einer Runde laufen ALLE Matches
  // (über alle Gruppen hinweg, z.B. Gruppe A UND Gruppe B gleichzeitig) im
  // selben Moment los, statt nacheinander. Erst wenn WIRKLICH jedes Match der
  // Runde fertig ist, beginnt die nächste Runde (die von den Ergebnissen der
  // vorigen abhängt, z.B. Halbfinale-Teilnehmer stehen erst nach dem
  // Viertelfinale fest). Swiss-/Round-Robin-Matches sind laut
  // roundNumberForMatch() immer "eine Runde" (Swiss ist beim Aufruf schon auf
  // die aktuelle interne Runde vorgefiltert, Round-Robin-Matches haben
  // untereinander keine Abhängigkeit) -- laufen also ohnehin schon alle
  // gleichzeitig.
  const rounds = new Map();
  matches.forEach((m) => {
    const r = roundNumberForMatch(stage, m);
    if (!rounds.has(r)) rounds.set(r, []);
    rounds.get(r).push(m);
  });
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);

  function playRound(idx) {
    if (idx >= roundNumbers.length) { finish(); return; }
    const roundMatches = rounds.get(roundNumbers[idx]);
    // Runde 105/106: ALLE eigenen, noch nicht angesehenen Matches DIESER
    // Runde (nicht nur das erste!) werden aus der Auto-Kaskade herausgenommen
    // -- Bug-Fix (User-Meldung: "beim Major muss man jedes Match in seiner
    // Gruppe spielen, nicht nur eins"): roundNumberForMatch() liefert für
    // Round-Robin-Stages (Major/Worlds-Gruppenphase) IMMER 1 für ALLE Matches
    // einer Gruppe (jeder-gegen-jeden hat keine Bracket-Abhängigkeit) -- die
    // eigene Org kann dadurch INNERHALB derselben Runde mehrere eigene
    // Matches haben (z.B. 3 bei einer 4er-Gruppe), nicht nur bei Brackets
    // (dort strukturell max. 1 pro Runde möglich). Die alte "nur das ERSTE
    // gefundene eigene Match pausiert, der Rest läuft als Bot-Match mit"-
    // Logik ließ das zweite/dritte eigene Match dadurch unbeaufsichtigt
    // durchlaufen. Jetzt: die übrigen (echten Bot-)Matches derselben Runde
    // laufen weiterhin normal parallel durch, ALLE eigenen Matches pausieren
    // danach NACHEINANDER (je ein Klick pro Match).
    const ownMatches = [];
    const botMatches = [];
    roundMatches.forEach((m) => {
      if (m.isOwnMatch && !shownOwnMatchSteps[ownMatchKey(event, step, m)]) ownMatches.push(m);
      else botMatches.push(m);
    });

    function pauseForOwnMatch(ownIdx) {
      const ownRaw = ownMatches[ownIdx];
      const normalized = ('teamAName' in ownRaw)
        ? ownRaw
        : { teamAName: ownRaw.a, teamBName: ownRaw.b, scoreA: ownRaw.winsA, scoreB: ownRaw.winsB, games: ownRaw.games, isOwnMatch: ownRaw.isOwnMatch, ownIsA: ownRaw.ownIsA };
      const ownKey = ownMatchKey(event, step, ownRaw);
      // Diese Runde selbst gilt erst als "fertig" (cascadeRoundProgress),
      // sobald ALLE ihre eigenen Matches gespielt wurden -- bis dahin bleibt
      // roundNumbers[idx] TBD für Re-Renders (siehe fillBracketMatchesPartial()/
      // fillStandard8BracketPartial()s "round > roundDepth+1"-Grenze, die für
      // roundDepth=idx-1 genau diese Runde noch als "Namen ohne Ergebnis" zeigt).
      cascadeAnimationActive = false;
      pendingOwnMatch = { event, match: normalized, stepKey: ownKey };
      cascadeResumeCallbacks[ownKey] = () => {
        cascadeAnimationActive = true;
        renderDashboardTopbar();
        if (ownIdx + 1 < ownMatches.length) {
          setTimeout(() => pauseForOwnMatch(ownIdx + 1), CASCADE_MATCH_GAP_MS);
        } else {
          cascadeRoundProgress[key] = roundNumbers[idx];
          setTimeout(() => playRound(idx + 1), CASCADE_MATCH_GAP_MS);
        }
      };
      renderDashboardTopbar();
    }

    function afterBotMatchesOfRoundDone() {
      if (ownMatches.length > 0) { pauseForOwnMatch(0); return; }
      cascadeRoundProgress[key] = roundNumbers[idx];
      setTimeout(() => playRound(idx + 1), CASCADE_MATCH_GAP_MS);
    }

    if (botMatches.length === 0) { afterBotMatchesOfRoundDone(); return; }
    let remaining = botMatches.length;
    botMatches.forEach((match) => {
      cascadeRevealSingleMatch(stageInstanceId, stage, match, () => {
        remaining--;
        if (remaining === 0) afterBotMatchesOfRoundDone();
      });
    });
  }
  playRound(0);
}

// Runde 99, User-Vorgabe ("ein Tag nach der Anmeldung, wo nur die Teams
// zugewiesen werden, kein Ergebnis"): zeigt für die SwissLadder-Stage nur die
// Runde-1-Paarungen (colKey '0,0' -- vor jedem Ergebnis stehen alle Teams bei
// 0 Siegen/0 Niederlagen, siehe simulateSwissStage()) mit Namen, aber ohne
// Score -- exakt dasselbe Muster wie fillMatchCardNamesOnly()/
// fillStandard8BracketPartial() weiter oben, nur fürs Swiss-Tabellen-Layout.
function fillSwissAssignmentOnly(instanceId, swissResult) {
  (swissResult.log || []).filter((entry) => entry.colKey === '0,0').forEach((entry) => {
    const rowId = instanceId + '-col-0-0-m' + entry.row;
    const rowEl = document.getElementById(rowId);
    if (!rowEl) return;
    const teamEls = rowEl.querySelectorAll('.swiss-table-team');
    fillSwissTeamCell(teamEls[0], entry.a);
    fillSwissTeamCell(teamEls[1], entry.b === null ? 'Freilos' : entry.b);
  });
}

// Zeigt nur, WELCHE 4 Teams dieser Round-Robin-Gruppe zugeteilt sind (per
// `teamNames`, siehe simulateRoundRobinGroup() -- bewusst NICHT `standings`,
// die ist ja schon nach Ergebnis sortiert und würde die Platzierung
// vorwegnehmen). Weder Einzelspiel-Ergebnisse noch Sieg/Niederlage-Zahlen
// werden befüllt, die HTML-Vorlage zeigt dort ihren TBD-Ausgangszustand.
function fillRoundRobinAssignmentOnly(instanceId, groupResult) {
  (groupResult.teamNames || []).forEach((name, i) => {
    const row = document.getElementById(instanceId + '-standing-' + i);
    if (!row) return;
    const teamEl = row.querySelector('.tournament-rr-standings-team');
    const labelEl = teamEl && teamEl.querySelector('.tournament-rr-standings-label');
    if (labelEl) labelEl.textContent = name;
    if (teamEl) {
      applyOrgLogoToElement(teamEl.querySelector('.tournament-rr-standings-logo'), name);
      teamEl.classList.toggle('is-own-org', isOwnOrgName(name));
    }
  });
}

// Dispatcht wie fillStageResults(), aber NUR für den neuen Auslosungstag
// (revealedStepCount()===0, siehe renderTournamentFormatTabs()) -- zeigt
// ausschließlich die schon feststehenden STARTPAARUNGEN/-ZUTEILUNGEN der
// ERSTEN Stage eines Turniers, komplett ohne Ergebnis. 'afl8'/'afl12'
// (Playoffs) und 'info' (LCQ-Vorrunde, noch keine Ergebnis-Engine) kommen
// laut tournamentFormatInfo() nie als erste Stage vor und brauchen deshalb
// keinen eigenen Zweig.
// Runde 105, Erweiterung (User-Vorgabe: "Auslosungstag auch vor Gruppenphase/
// Playoffs, nicht nur einmal am Turnierstart"): zeigt für AFL-Brackets
// (afl8/afl12, Open/LCQ/Major-Playoffs) und reine Einzel-K.o.-Brackets
// (Worlds-Playoffs) nur die feststehenden RUNDE-0-Startpaarungen (Namen ohne
// Score) -- alle späteren Runden hängen von noch nicht enthüllten Ergebnissen
// ab und bleiben TBD. `firstRoundSlotPrefixes` sind die Slot-Präfixe (vor der
// laufenden Nummer, siehe m.slot.replace(/-\d+$/, '')) der jeweils ERSTEN
// Runde: AFL hat ZWEI parallele erste Runden (Oberes-Bracket 'ubr1' UND
// Unteres-Bracket 'lbr1' -- beide Seiten sind schon beim Stage-Start komplett
// geseedet, siehe simulateAflBracket()), Einzel-K.o. nur eine ('r0', siehe
// simulateSingleElimBracket()).
function fillBracketAssignmentOnly(treeId, matches, firstRoundSlotPrefixes) {
  (matches || []).forEach((m) => {
    const prefix = m.slot.replace(/-\d+$/, '');
    if (firstRoundSlotPrefixes.includes(prefix)) fillMatchCardNamesOnly(treeId + '-' + m.slot, m.teamAName, m.teamBName);
  });
}

function fillStageAssignmentOnly(stage, stageInstanceId, stageData) {
  if (!stageData) return;
  if (stage.visual === 'swissLadder') {
    if (stage.groupLabels) stageData.forEach((res, gi) => fillSwissAssignmentOnly(stageInstanceId + '-sw' + gi, res));
    else fillSwissAssignmentOnly(stageInstanceId + '-sw', stageData);
  } else if (stage.visual === 'roundRobin') {
    stageData.forEach((res, gi) => fillRoundRobinAssignmentOnly(stageInstanceId + '-rr' + gi, res));
  } else if (stage.visual === 'doubleElim' && stage.shape === 'standard8') {
    if (stage.groupLabels) stageData.forEach((res, gi) => fillStandard8BracketPartial(stageInstanceId + '-de' + gi, res, 0));
    else fillStandard8BracketPartial(stageInstanceId + '-de', stageData, 0);
  } else if (stage.visual === 'doubleElim') {
    // afl8/afl12 (Open/LCQ/Major-Playoffs) -- nie gruppiert (groupLabels kommt
    // laut tournamentFormatInfo() nur bei standard8 vor).
    fillBracketAssignmentOnly(stageInstanceId + '-de', stageData.matches, ['ubr1', 'lbr1']);
  } else if (stage.visual === 'bracket') {
    fillBracketAssignmentOnly(stageInstanceId + '-se', stageData.matches, ['r0']);
  } else if (stage.visual === 'lcqVorrunde') {
    // Freilos-Teams sind schon beim Auslosungstag bekannt (reine Band-
    // Seedierung, kein simuliertes Ergebnis) -- nur die K.o.-Paarungen
    // selbst (falls überhaupt vorhanden) bekommen Namen ohne Score, die
    // Qualifiziert-Slots bleiben bis zum eigentlichen Enthüllungstag TBD.
    fillBracketAssignmentOnly(stageInstanceId + '-vr', stageData.koMatches, ['ko']);
  }
}

// Runde 105, User-Vorgabe ("Pfeile zwischen den Turnier-Tabs, damit sichtbar
// ist wo das nächste Spiel ist, wenn man qualifiziert ist"): prüft, ob EINE
// Stage (unabhängig von Runde/Gruppe/Enthüllungsstand) IRGENDWO ein eigenes
// Match enthält -- reine Datenprüfung auf dem längst fertig simulierten
// Ergebnis (Instant-Philosophie unverändert), nutzt für jeden Visual-Typ
// dieselbe Datenform wie tournamentStageHtml()/fillStageResults().
function stageHasOwnMatch(stage, stageData) {
  if (!stageData) return false;
  if (stage.visual === 'swissLadder') {
    const groups = stage.groupLabels ? stageData : [stageData];
    return groups.some((g) => (g.log || []).some((entry) => entry.isOwnMatch));
  }
  if (stage.visual === 'roundRobin') {
    return stageData.some((g) => (g.results || []).some((m) => m.isOwnMatch));
  }
  if (stage.visual === 'doubleElim') {
    const groups = stage.groupLabels ? stageData : [stageData];
    return groups.some((g) => (g.matches || []).some((m) => m.isOwnMatch));
  }
  if (stage.visual === 'bracket') {
    return (stageData.matches || []).some((m) => m.isOwnMatch);
  }
  if (stage.visual === 'lcqVorrunde') {
    return (stageData.koMatches || []).some((m) => m.isOwnMatch);
  }
  return false;
}

// Sucht ab `fromIndex` die erste Stage mit einem eigenen Match -- das ist
// die Stage, in der der Spieler als nächstes wirklich antritt (oder gar
// keine mehr, falls schon ausgeschieden). `fromIndex` ist der heutige
// Enthüllungsstand (resolvedStep.stageIndex), damit bereits abgeschlossene
// frühere Stages nicht fälschlich markiert werden.
function nextOwnMatchStageIndex(info, resultForStages, stageKeys, fromIndex) {
  if (!resultForStages) return -1;
  for (let i = Math.max(fromIndex, 0); i < info.stages.length; i++) {
    const stageData = stageKeys[i] ? resultForStages[stageKeys[i]] : null;
    if (stageHasOwnMatch(info.stages[i], stageData)) return i;
  }
  return -1;
}

// Runde 106, User-Vorgabe ("LCQ-Vorrunde soll ein echter, angezeigter/
// simulierter Bracket sein, nicht unsichtbar -- erst ab Swiss passiert
// etwas"): errechnet die für den STATISCHEN Kartenbau nötigen Zahlen VOR
// der eigentlichen Turnierauflösung (resolveLcqEvent() läuft erst am
// Fälligkeitstag im Oktober) -- die Feldgröße selbst steht aber schon seit
// dem Open Qualifier im Januar fest (`seasonQualifiedTeams[region].length`),
// dieselbe Formel wie dort. Praktisch (per Live-/Sandbox-Probe über alle 7
// Regionen bestätigt) bleibt der Pool fast immer ≤32 -- `koPairCount` ist
// dadurch fast immer 0 (alle K.o.-Teams gehen automatisch als Freilos durch,
// siehe runQuickKnockout()); die Bracket-Engine unten bleibt trotzdem für
// den Fall eines größeren Pools korrekt (z.B. nach künftigen Balance-
// Änderungen).
function lcqVorrundeFieldPlan(region) {
  const band = LCQ_ELIGIBILITY_BANDS[region];
  if (!band) return { koPairCount: 0, totalQualifiedCount: 32 };
  const poolSize = (seasonQualifiedTeams[region] && seasonQualifiedTeams[region].length) || 32;
  const byeCount = Math.max(0, Math.min(band.lcqRangeEnd, poolSize) - (band.lcqRangeStart - 1));
  const koCount = Math.max(0, poolSize - band.lcqRangeEnd);
  const targetKoSurvivors = Math.max(0, 32 - byeCount);
  // Spiegelt runQuickKnockout() exakt: `excess` (=koCount-targetKoSurvivors)
  // IST direkt die Anzahl der K.o.-Matches (nicht durch 2 teilen -- jedes
  // Match verringert das Feld um genau 1, excess*2 Teams spielen excess
  // Matches, siehe dortiger Kommentar).
  const koPairCount = koCount > targetKoSurvivors ? (koCount - targetKoSurvivors) : 0;
  const totalQualifiedCount = koCount > targetKoSurvivors ? (byeCount + targetKoSurvivors) : (byeCount + koCount);
  return { koPairCount, totalQualifiedCount };
}

// Baut die LCQ-Vorrunde als echten (wenn auch meist sehr kleinen) Bracket:
// eine optionale K.o.-Runde (nur bei Feld-Überschuss, siehe
// lcqVorrundeFieldPlan()) links, verbunden über Linien mit der
// "Qualifiziert für die Swiss-Stage"-Liste rechts -- Freilos-Teams landen
// direkt in dieser Liste (kein Match, kein Verbindungspfeil nötig, nur ein
// Badge, siehe fillLcqVorrundeResults()). Gleiches Karten-/Verbindungs-Muster
// wie buildStandard8DoubleElim()s buildQualifiedSlots().
function buildLcqVorrundeBracket(treeId, koPairCount, totalQualifiedCount) {
  const connections = [];
  const connect = (fromId, toId) => connections.push({ fromId, toId, color: 'rgba(255,255,255,0.3)' });
  const mkId = (key, i) => treeId + '-' + key + '-' + i;

  const koIds = [];
  let koHtml = '';
  if (koPairCount > 0) {
    for (let i = 0; i < koPairCount; i++) koIds.push(mkId('ko', i));
    const cardsHtml = koIds.map((id) => tournamentMatchCardHtml(id)).join('');
    koHtml = '<div class="bracket-round"><div class="bracket-round-label">K.o.-Runde (Überschuss) <span class="bracket-round-bo">Bo3</span></div><div class="bracket-round-body">' + cardsHtml + '</div></div>';
  }

  const qualifiedIds = [];
  for (let i = 0; i < totalQualifiedCount; i++) qualifiedIds.push(mkId('q', i));
  const qualifiedCardsHtml = qualifiedIds.map((id) =>
    '<div class="tournament-match-card group-qualified-slot lcq-vorrunde-qualified-slot" id="' + id + '">' +
      '<div class="tournament-match-card-team">' +
        '<span class="tournament-match-card-logo"></span>' +
        '<span class="tournament-match-card-name">TBD</span>' +
        '<span class="lcq-vorrunde-bye-tag hidden">Freilos</span>' +
      '</div>' +
    '</div>'
  ).join('');
  const qualifiedHtml = '<div class="bracket-round"><div class="bracket-round-label">✅ Qualifiziert für die Swiss-Stage (' + totalQualifiedCount + ')</div><div class="bracket-round-body">' + qualifiedCardsHtml + '</div></div>';

  koIds.forEach((id, i) => connect(id, qualifiedIds[i]));

  return { html: koHtml + qualifiedHtml, koIds, qualifiedIds, connections };
}

function tournamentStageHtml(stage, stageInstanceId, region) {
  let bodyHtml = '';
  const connectors = [];
  if (stage.visual === 'swissLadder') {
    // Runde 79, User-Korrektur: Major/Worlds nutzen für ihre 16-Team-Phase
    // ebenfalls eine echte Swiss Stage (siehe WORLDS_MAJOR_GROUP_STAGE_IS_SWISS
    // in tournament-calendar.js) -- als EINE einzelne 16-Team-Instanz, nicht
    // als 2 Gruppen wie bei Open (32 Teams = 2x16). `groupLabels` ist dafür
    // optional, analog zum bereits bestehenden Einzel-/Gruppen-Unterschied
    // bei 'doubleElim' weiter unten.
    if (stage.groupLabels) {
      stage.groupLabels.forEach((label, gi) => {
        const built = tournamentSwissLadderHtml(stageInstanceId + '-sw' + gi);
        bodyHtml += '<div class="tournament-stage-group-block"><div class="tournament-stage-group-block-label">' + label + '</div>' + built.html + '</div>';
        connectors.push({ containerId: built.containerId, connections: built.connections });
      });
    } else {
      const built = tournamentSwissLadderHtml(stageInstanceId + '-sw');
      bodyHtml = built.html;
      connectors.push({ containerId: built.containerId, connections: built.connections });
    }
  } else if (stage.visual === 'roundRobin') {
    bodyHtml = '<div class="tournament-rr-groups">' + stage.groupLabels.map((label, gi) => tournamentRoundRobinGroupHtml(stageInstanceId + '-rr' + gi, label)).join('') + '</div>';
  } else if (stage.visual === 'doubleElim') {
    if (stage.groupLabels) {
      stage.groupLabels.forEach((label, gi) => {
        const built = buildDoubleElimBracket(stageInstanceId + '-de' + gi, stage.shape, stage.bo, false);
        bodyHtml += '<div class="tournament-stage-group-block"><div class="tournament-stage-group-block-label">' + label + '</div>' + built.html + '</div>';
        connectors.push({ containerId: built.containerId, connections: built.connections });
      });
    } else {
      const built = buildDoubleElimBracket(stageInstanceId + '-de', stage.shape, stage.bo, !!stage.trophy);
      bodyHtml = built.html;
      connectors.push({ containerId: built.containerId, connections: built.connections });
    }
  } else if (stage.visual === 'lcqVorrunde') {
    // Runde 106, User-Vorgabe ("LCQ-Vorrunde soll ein echter Bracket sein"):
    // ersetzt den alten leeren 'info'-Platzhalter (Runde 79) -- Feldgröße
    // kommt aus lcqVorrundeFieldPlan() (siehe dort), echte Befüllung über
    // fillLcqVorrundeResults()/-Partial().
    const treeId = stageInstanceId + '-vr';
    const plan = lcqVorrundeFieldPlan(region);
    const built = buildLcqVorrundeBracket(treeId, plan.koPairCount, plan.totalQualifiedCount);
    bodyHtml = '<div class="bracket-tree-wrap" id="' + treeId + '"><div class="bracket-tree">' + built.html + '</div></div>';
    connectors.push({ containerId: treeId, connections: built.connections });
  } else { // 'bracket' -- Einzel-K.o. (LCQ-Playoffs-Vorstufe entfällt seit
    // Runde 79 -- WM-Playoffs und LCQ selbst nutzen diesen Typ nicht mehr
    // für ihre Haupt-Bracket-Phase, nur Worlds' Playoffs (Single-Elim) noch).
    const treeId = stageInstanceId + '-se';
    const tree = buildSingleElimTree(treeId, stage.rounds);
    bodyHtml = '<div class="bracket-tree-wrap" id="' + treeId + '"><div class="bracket-tree">' + tree.html + '</div>' + (stage.trophy ? '<img class="bracket-trophy" src="assets/Menu_Pokal_trimmed.png" alt="">' : '') + '</div>';
    connectors.push({ containerId: treeId, connections: tree.connections });
  }
  const html = (
    '<div class="dashboard-tournament-stage">' +
      '<div class="dashboard-tournament-stage-header">' +
        '<h3>' + stage.title + '</h3>' +
        '<span class="dashboard-tournament-stage-count">' + stage.teamsIn + ' Teams</span>' +
      '</div>' +
      '<p class="dashboard-tournament-stage-desc">' + stage.desc + '</p>' +
      bodyHtml +
    '</div>'
  );
  return { html, connectors };
}

// Baut die komplette Tab-Leiste + den Tab-Inhalt NEU (Runde 50): jede echte
// RLCS-Phase (siehe tournamentFormatInfo()) bekommt einen eigenen,
// chronologisch geordneten Tab NACH "Übersicht" -- alte dynamische Tabs von
// einem vorherigen Turnier werden zuerst entfernt.
function renderTournamentFormatTabs(event) {
  const info = tournamentFormatInfo(event);
  const tabsBar = document.getElementById('dashboard-tournament-detail-tabs');
  const contentHost = document.getElementById('dashboard-tournament-detail-dynamic-content');

  // Bug-Fix (Runde 105, per Live-Test gefunden: "72 statt 3 Pfeile nach
  // mehreren Re-Renders"): die alte Selektor-Fassung räumte nur
  // ".dashboard-tournament-detail-tab[data-dynamic]" auf -- die neuen Pfeil-
  // Spans tragen aber die eigene Klasse "dashboard-tournament-detail-tab-
  // arrow" (kein gemeinsames Klassen-Token mit den Tab-Buttons) und wurden
  // dadurch bei JEDEM Re-Render zusätzlich angehängt, ohne die vorigen je zu
  // entfernen. `[data-dynamic]` allein erfasst beide Elementtypen (im
  // Tabs-Container steht sonst nur der statische "Übersicht"-Button ohne
  // dieses Attribut).
  tabsBar.querySelectorAll('[data-dynamic]').forEach((b) => b.remove());
  contentHost.innerHTML = '';
  tournamentDetailConnectors = {};

  // Runde 86: sobald das Event aufgelöst ist (seasonTournamentResults),
  // werden die "TBD"-Bracket-Karten mit echten Namen/Scores befüllt (siehe
  // fillStageResults()). Bei LCQ UND (seit Runde 90) Open ist das Ergebnis
  // pro Region verschachtelt (seasonTournamentResults[key][region], alle 7
  // Regionen laufen im Hintergrund mit) -- dieselbe Region, die auch das
  // "Region: ..."-Label im Kopf der Detailseite bestimmt, wird hier gezeigt.
  const eventResult = seasonTournamentResults[event.key];
  const resultForStages = (event.eventType === 'lcq' || event.eventType === 'open')
    ? (eventResult ? eventResult[orgRegion(assignedOrg.country)] : null)
    : eventResult;
  const stageKeys = stageResultKeysForEventType(event);
  // Runde 94, User-Vorgabe ("Tag für Tag"-Ergebnis-Enthüllung, z.B. "open1-6:
  // Tag1 Swiss, Tag2 Gruppenphase, Tag3 Playoff"): eine bereits FERTIG
  // simulierte Stage (siehe resolveXxxEvent()s "Instant"-Philosophie,
  // unverändert) wird trotzdem erst dann sichtbar befüllt, wenn ihr
  // Enthüllungstag laut Kalender erreicht ist. Drei Fälle (siehe
  // totalRevealStepsForEvent()): Open Qualifier enthüllt RUNDENWEISE
  // innerhalb seiner einen Stage, Major enthüllt seine 4 Gruppenphase-Gruppen
  // TAGEWEISE einzeln, alle anderen enthüllen eine ganze Stage pro Tag.
  const isOpenQualifier = event.key === 'open0';
  const isMajor = event.eventType === 'major';
  const totalSteps = totalRevealStepsForEvent(event, info);
  // Runde 99, Folge-Fix: gedrosselt statt roher Kalenderwert, siehe
  // visualRevealStepCount() -- hält ein noch nicht angesehenes eigenes Match
  // (pendingOwnMatch) vom Bracket fern, bis der Live-Ticker gelaufen ist.
  // Bleibt für open0 relevant (dessen Runden-Gating komplett über separate
  // Kalendertage läuft, siehe roundDepth unten).
  const stepsRevealed = visualRevealStepCount(event, totalSteps);
  const roundDepth = isOpenQualifier ? stepsRevealed : undefined;
  // Runde 105, Folge-Fix (User-Meldung: "muss direkt hintereinander ALLE
  // eigenen Matches bestreiten ohne die Bot-Kaskade dazwischen zu sehen --
  // erst danach wird im Bracket alles auf einmal gezeigt"): für JEDE Stage
  // mit interner Runden-Kaskade (cascadeRevealStep(), also alles außer
  // open0/Major, die ihre eigenen Zweige unten haben) wird jetzt der
  // UNGEDROSSELTE Rohwert genutzt -- die Drossel oben schützte ursprünglich
  // davor, das Ergebnis eines noch nicht angesehenen eigenen Matches vor dem
  // Ticker zu zeigen, aber cascadeRevealStep()s eigene Runden-Logik nimmt das
  // pendende eigene Match seit Runde 105 sowieso schon EXPLIZIT aus der Auto-
  // Kaskade heraus (siehe dortiges `ownRaw`) -- die äußere Drossel war für
  // diesen Zweck also nur noch redundant, hielt aber zusätzlich die GESAMTE
  // restliche Stage (inkl. bereits fertig kaskadierter früherer Runden)
  // fälschlich komplett zurück, solange irgendein eigenes Match dieser Stage
  // noch offen war -- das Bracket blieb dadurch bis zum LETZTEN eigenen
  // Match komplett leer, statt Runde für Runde sichtbar zu werden.
  const rawStepsRevealed = revealedStepCount(event, totalSteps);
  // Runde 103, User-Vorgabe ("Swiss soll Runde für Runde enthüllt werden"):
  // swissIndex/resolvedStep lösen den GLOBALEN Schritt in {stageIndex,
  // swissRound} auf (siehe stageForGlobalStep()) -- bei Major/open0 bleibt
  // swissIndex immer -1 (die haben keine swissLadder-Stage, laufen
  // unverändert über ihre eigenen Zweige oben/unten).
  const swissIndex = (isMajor || isOpenQualifier) ? -1 : swissStageIndexForEvent(info);
  const resolvedStep = stageForGlobalStep(swissIndex, rawStepsRevealed, info);
  // Runde 105, User-Vorgabe ("Pfeile zwischen den Kategorien, damit klar
  // wird, wo das nächste Spiel ist, wenn man qualifiziert ist"): einmal pro
  // Render bestimmen, welche Stage (falls überhaupt noch eine) das nächste
  // eigene Match enthält -- markiert deren Tab weiter unten.
  const nextOwnStageIdx = nextOwnMatchStageIndex(info, resultForStages, stageKeys, resolvedStep.stageIndex);

  info.stages.forEach((stage, i) => {
    // Pfeil VOR jedem Stage-Tab (auch vor dem ersten, direkt nach
    // "Übersicht") -- zeigt die chronologische Ablaufreihenfolge des
    // gesamten Turniers auf einen Blick.
    const arrow = document.createElement('span');
    arrow.className = 'dashboard-tournament-detail-tab-arrow';
    arrow.dataset.dynamic = '1';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    tabsBar.appendChild(arrow);

    const tabKey = 'stage' + i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dashboard-tournament-detail-tab';
    if (i === nextOwnStageIdx) btn.classList.add('has-next-own-match');
    btn.dataset.detailTab = tabKey;
    btn.dataset.dynamic = '1';
    btn.textContent = stage.tabLabel;
    btn.addEventListener('click', () => selectTournamentDetailTab(tabKey));
    tabsBar.appendChild(btn);

    const built = tournamentStageHtml(stage, 'st' + i, event.eventType === 'lcq' ? orgRegion(assignedOrg.country) : undefined);
    const contentDiv = document.createElement('div');
    contentDiv.id = 'dashboard-tournament-detail-tab-' + tabKey;
    contentDiv.className = 'dashboard-tournament-detail-tab-content hidden';
    contentDiv.innerHTML = '<div class="dashboard-tournament-stage-list">' + built.html + '</div>';
    contentHost.appendChild(contentDiv);

    tournamentDetailConnectors[tabKey] = built.connectors;

    if (resultForStages && stageKeys[i]) {
      const stageData = resultForStages[stageKeys[i]];
      if (isMajor && i === 0) {
        // Gruppenphase-Stage (4 Gruppen A-D): rawStepsRevealed zählt hier
        // direkt die Anzahl bereits enthüllter Gruppen (Tag1=1 Gruppe...
        // Tag4=4) -- Runde 105: UNGEDROSSELT (siehe Kommentar oben bei
        // rawStepsRevealed), damit mehrere eigene Matches in derselben
        // Gruppe (round-robin, jeder-gegen-jeden) nicht das ganze Bracket
        // bis zum letzten davon leer lassen.
        const groupRevealCount = Math.min(rawStepsRevealed, stage.groupLabels.length);
        if (groupRevealCount > 0) {
          // Runde 102, User-Vorgabe ("step-by-step statt alle Bot-Matches
          // gleichzeitig"): ältere, schon an einem früheren Tag enthüllte
          // Gruppen instant/komplett füllen (unverändert), NUR die heute neu
          // hinzugekommene Gruppe Match-für-Match kaskadieren.
          if (groupRevealCount > 1) fillStageResults(stage, 'st' + i, stageData, undefined, groupRevealCount - 1);
          cascadeRevealStep(event, groupRevealCount, stage, 'st' + i, stageData, undefined, groupRevealCount);
        }
        // Runde 99: Auslosungstag (rawStepsRevealed===0) -- Gruppenzuteilung ohne Ergebnis.
        else if (rawStepsRevealed === 0) fillStageAssignmentOnly(stage, 'st' + i, stageData);
      } else if (isMajor && i === 1) {
        // Playoffs-Stage: Runde 105, neuer Auslosungstag direkt NACH dem
        // letzten Gruppentag (zeigt nur die AFL-Runde-1-Startpaarungen,
        // Ober-/Unteres Bracket, noch ohne Ergebnis) -- danach am folgenden
        // Tag ein einziger Umschlag von TBD auf komplett, kaskadiert Match
        // für Match.
        const majorPlayoffAssignmentStep = info.stages[0].groupLabels.length + 1;
        if (rawStepsRevealed === majorPlayoffAssignmentStep) fillStageAssignmentOnly(stage, 'st' + i, stageData);
        else if (rawStepsRevealed >= totalSteps) cascadeRevealStep(event, totalSteps, stage, 'st' + i, stageData);
      } else if (isOpenQualifier && i < stepsRevealed) {
        // Runde 102: roundDepth (= stepsRevealed) ist hier die laufende
        // Runde INNERHALB der einen Stage -- ältere Runden instant (bereits
        // an früheren Tagen kaskadiert), nur die heute neue Runde kaskadiert.
        if (roundDepth > 1) fillStageResults(stage, 'st' + i, stageData, roundDepth - 1);
        cascadeRevealStep(event, roundDepth, stage, 'st' + i, stageData, roundDepth);
      } else if (i < resolvedStep.stageIndex) {
        // Diese Stage liegt komplett hinter uns -- an einem früheren Tag
        // schon vollständig enthüllt. Bei der Swiss-Stage heißt "vollständig"
        // jetzt: ALLE SWISS_REVEAL_ROUNDS Runden (Runde 103, vorher war eine
        // Swiss-Stage IMMER in einem Rutsch komplett, dieser Zweig deckt jetzt
        // den Fall ab, dass ihre letzte Runde an einem vergangenen Tag lag).
        if (i === swissIndex) fillStageResults(stage, 'st' + i, stageData, SWISS_REVEAL_ROUNDS);
        else fillStageResults(stage, 'st' + i, stageData);
      } else if (i === resolvedStep.stageIndex) {
        // Das ist die Stage, die HEUTE (dieser Kalendertag) neu enthüllt wird.
        if (resolvedStep.isAssignment) {
          // Runde 105, User-Vorgabe ("nach Swiss erstmal ein Tag wieder nicht
          // gespielt, Auslosung nur für Gruppenphase, selbe dann für
          // Playoffs -- für alle Turniere"): reiner Auslosungstag VOR dieser
          // Stage (egal ob Swiss/Gruppenphase/Playoffs) -- nur Startpaarungen/
          // Zuteilung, noch kein Ergebnis (siehe fillStageAssignmentOnly()).
          fillStageAssignmentOnly(stage, 'st' + i, stageData);
        } else if (i === swissIndex) {
          // Runde 103, User-Vorgabe ("bei Swiss soll man erst Tag 1 sehen,
          // dann Tag 2, usw."): ältere Swiss-Runden instant (schon an
          // früheren Tagen enthüllt/kaskadiert), NUR die heute neue Runde
          // wird Match für Match kaskadiert.
          if (resolvedStep.swissRound > 1) fillStageResults(stage, 'st' + i, stageData, resolvedStep.swissRound - 1);
          cascadeRevealStep(event, rawStepsRevealed, stage, 'st' + i, stageData, resolvedStep.swissRound);
        } else {
          cascadeRevealStep(event, rawStepsRevealed, stage, 'st' + i, stageData, roundDepth);
        }
      } else if (i === 0 && stepsRevealed === 0) {
        // Runde 99, User-Vorgabe ("ein Tag nach der Anmeldung nur Teams
        // zuweisen, ein Tag später erst spielen"): der neue Auslosungstag --
        // die Simulation ist längst fertig (Instant-Philosophie), aber
        // revealedStepCount() liefert an diesem einen Tag bewusst 0 (siehe
        // dort). Zeigt nur die feststehenden Startpaarungen der ERSTEN Stage,
        // alle weiteren Stages bleiben vollständig TBD.
        fillStageAssignmentOnly(stage, 'st' + i, stageData);
      }
    }
  });

  // Aktiven Tab wiederherstellen (z.B. nach einem Tagfortschritt, während man
  // gerade "Playoffs" ansieht -- soll nicht auf "Übersicht" zurückspringen),
  // fällt auf "Übersicht" zurück falls der vorher aktive Tab bei diesem
  // Turnier gar nicht existiert (z.B. beim Wechsel zu einem anderen Event).
  const stillExists = tournamentDetailActiveTab === 'overview' || info.stages.some((_, i) => 'stage' + i === tournamentDetailActiveTab);
  selectTournamentDetailTab(stillExists ? tournamentDetailActiveTab : 'overview');
}

// Runde 85: zeigt Sieger + wichtigste Platzierungen, sobald das Turnier
// automatisch aufgelöst wurde (seasonTournamentResults[event.key], siehe
// checkTournamentResolutions()). Gibt `null` zurück, solange das Turnier
// noch nicht dran war -- dann bleibt die bisherige Anmeldung-/Teilnehmer-
// Anzeige unverändert bestehen. Zeigt bewusst nur eine Zusammenfassung,
// KEINE einzelnen Bracket-Karten mit echten Namen (die "TBD"-Platzhalter in
// den Format-Tabs bleiben bestehen -- das würde die bestehenden, seit ~15
// Runden fein abgestimmten Bracket-HTML-Bau-Funktionen anfassen müssen,
// disclosed als eigener, separater nächster Schritt).
function tournamentResultSummaryHtml(event) {
  const result = seasonTournamentResults[event.key];
  if (!result) return null;
  // Runde 94, User-Vorgabe ("Tag für Tag"-Enthüllung): der komplette
  // Endstand (Sieger/Platzierungen) wird trotz bereits fertiger Simulation
  // erst gezeigt, wenn auch der LETZTE Enthüllungstag erreicht ist -- vorher
  // bleibt die per-Stage/per-Runde TBD-Ansicht (siehe renderTournamentFormatTabs())
  // aktiv, damit die Tag-für-Tag-Spannung nicht durch die Zusammenfassung
  // vorweggenommen wird.
  const totalSteps = totalRevealStepsForEvent(event, tournamentFormatInfo(event));
  // Runde 99, Folge-Fix: gedrosselt (visualRevealStepCount()), sonst würde
  // die Zusammenfassung den Turniersieger schon zeigen, während das eigene
  // Match des letzten Schritts noch unangesehen als pendingOwnMatch aussteht.
  if (visualRevealStepCount(event, totalSteps) < totalSteps) return null;

  if (event.eventType === 'lcq') {
    const rows = LCQ_REGIONS.map((region) => {
      const r = result[region];
      return '<div class="dashboard-tournament-result-row"><strong>' + ORG_REGION_LABELS[region] + ':</strong> ' + (r ? r.championName : '—') + ' zieht ins WM-Ticket ein</div>';
    }).join('');
    return '<p class="dashboard-tournament-detail-status is-open">🏆 Last Chance Qualifier abgeschlossen -- Sieger je Region:</p>' + rows;
  }

  if (event.eventType === 'worlds') {
    return (
      '<p class="dashboard-tournament-detail-status is-open">🏆 Weltmeister: ' + result.championName + '</p>' +
      '<div class="dashboard-tournament-result-row">2. Platz: ' + result.runnerUpName + '</div>' +
      '<div class="dashboard-tournament-result-row">3.-4. Platz: ' + result.semifinalLoserNames.join(', ') + '</div>' +
      '<div class="dashboard-tournament-result-row">5.-8. Platz: ' + result.quarterfinalLoserNames.join(', ') + '</div>'
    );
  }

  // Runde 92: der Open Qualifier (open0) kürt keinen Sieger -- er hat weder
  // `placements` noch einen echten `championName`, sondern nur die Liste der
  // 32 Qualifizierten (siehe resolveOpenQualifierEvent()). Eigener Zweig VOR
  // dem generischen Open-Fall unten, der `.placements` voraussetzt.
  if (event.key === 'open0') {
    const regionResult = assignedOrg ? result[orgRegion(assignedOrg.country)] : null;
    if (!regionResult) return null;
    const ownQualified = regionResult.qualifiedNames.includes(assignedOrg.name);
    return (
      '<p class="dashboard-tournament-detail-status is-open">✅ Open Qualifier abgeschlossen -- 32 Teams für Open 1-6 qualifiziert.</p>' +
      '<div class="dashboard-tournament-result-row">Deine Org: ' + (ownQualified ? 'qualifiziert ✅' : (assignedOrg && orgRegion(assignedOrg.country) ? 'ausgeschieden ❌' : '—')) + '</div>'
    );
  }

  // Runde 90: Open ist jetzt (wie LCQ) pro Region verschachtelt -- alle 7
  // Regionen laufen im Hintergrund mit, hier wird nur die eigene Region des
  // Spielers gezeigt (dieselbe, die auch die Bracket-Tabs bestimmt).
  const regionResult = event.eventType === 'open'
    ? (assignedOrg ? result[orgRegion(assignedOrg.country)] : null)
    : result;
  if (!regionResult) return null;

  // Open/Major: regionResult = { placements: [{orgName, place}], championName }
  const byPlace = {};
  regionResult.placements.forEach((p) => { (byPlace[p.place] = byPlace[p.place] || []).push(p.orgName); });
  const order = Object.keys(byPlace).map(Number).sort((a, b) => a - b);
  const rows = order.map((place) => '<div class="dashboard-tournament-result-row">Platz ' + place + ': ' + byPlace[place].join(', ') + '</div>').join('');
  return '<p class="dashboard-tournament-detail-status is-open">🏆 Turniersieger: ' + regionResult.championName + '</p>' + rows;
}

function renderTournamentDetailPanel() {
  if (!tournamentDetailEventKey) return;
  const schedule = currentSeasonTournamentSchedule();
  const event = schedule.find((e) => e.key === tournamentDetailEventKey);
  if (!event) return;

  document.getElementById('dashboard-tournament-detail-logo').innerHTML = '<span style="color:' + event.color + ';">' + event.icon + '</span>';
  document.getElementById('dashboard-tournament-detail-dates').textContent = formatCareerDateDisplay(event.startDate) + ' - ' + formatCareerDateDisplay(event.endDate);
  document.getElementById('dashboard-tournament-detail-name').textContent = event.label;
  document.getElementById('dashboard-tournament-detail-stars').innerHTML = tournamentStarsHtml(event.stars);
  document.getElementById('dashboard-tournament-detail-tier').textContent = event.tierLabel;
  document.getElementById('dashboard-tournament-detail-prize').textContent = formatMoney(event.prize);
  document.getElementById('dashboard-tournament-detail-points').textContent = '+ ' + event.points + ' Pkt.';
  const region = orgRegion(assignedOrg.country);
  // Runde 81, User-Vorgabe (Turnier-Detailseite jetzt für alle Turnierarten
  // offen, siehe renderTournamentUpcomingList()): Major/Worlds bringen alle
  // Regionen zusammen -- "Region: EU" auf einem internationalen Turnier wäre
  // irreführend, deshalb hier "International" statt der eigenen Region.
  document.getElementById('dashboard-tournament-detail-region').textContent =
    (event.eventType === 'major' || event.eventType === 'worlds')
      ? 'International'
      : (region ? ('Region: ' + ORG_REGION_LABELS[region]) : '');

  // Runde 85: sobald checkTournamentResolutions() dieses Event aufgelöst
  // hat, ersetzt eine Ergebnis-Zusammenfassung (Sieger + Platzierungen) die
  // bisherige Anmeldung-/Teilnehmerfeld-Anzeige -- beide sind nach
  // Turnierende ohnehin nicht mehr relevant.
  const resultHtml = tournamentResultSummaryHtml(event);

  const registrationEl = document.getElementById('dashboard-tournament-detail-registration');
  if (resultHtml) {
    registrationEl.innerHTML = '<p class="dashboard-tournament-detail-status is-running">🔒 Turnier abgeschlossen.</p>';
  } else {
    registrationEl.innerHTML = tournamentDetailRegistrationHtml(event);
    const registerBtn = document.getElementById('btn-tournament-detail-register');
    if (registerBtn) registerBtn.addEventListener('click', () => { registerForOpenQualifier(event.key); renderTournamentDetailPanel(); });
    const unregisterBtn = document.getElementById('btn-tournament-detail-unregister');
    if (unregisterBtn) unregisterBtn.addEventListener('click', () => { unregisterFromOpenQualifier(event.key); renderTournamentDetailPanel(); });
  }

  // Runde 90, User-Vorgabe ("bei den anderen Turnieren die, die sich dafür
  // auch qualifiziert haben"): Major/LCQ/Worlds zeigen jetzt ihr echtes,
  // bereits an anderer Stelle berechnetes Qualifikationsfeld (siehe
  // tournamentDetailQualifiedFieldHtml()) statt eines reinen Platzhaltertexts.
  document.getElementById('dashboard-tournament-detail-slots').innerHTML = resultHtml
    || (event.eventType === 'open'
      ? tournamentDetailSlotsHtml(event)
      : tournamentDetailQualifiedFieldHtml(event));

  renderTournamentFormatTabs(event);
}

// Zeichnet Verbindungslinien erst NEU, wenn ein Tab tatsächlich sichtbar
// wird (Runde 50, Bugfix) -- vorher liefen sie einmalig direkt nach dem
// Rendern, während der Container noch "hidden" (display:none) war, wodurch
// getBoundingClientRect() nur Nullkoordinaten lieferte und gar keine
// Linien sichtbar waren.
function selectTournamentDetailTab(tab) {
  tournamentDetailActiveTab = tab;
  document.querySelectorAll('.dashboard-tournament-detail-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.detailTab === tab));
  document.querySelectorAll('.dashboard-tournament-detail-tab-content').forEach((c) => c.classList.toggle('hidden', c.id !== 'dashboard-tournament-detail-tab-' + tab));
  const connectors = tournamentDetailConnectors[tab];
  if (connectors && connectors.length) {
    requestAnimationFrame(() => {
      connectors.forEach(({ containerId, connections }) => {
        const el = document.getElementById(containerId);
        if (el) drawSvgConnectors(el, connections);
      });
    });
  }
}

function openTournamentDetail(eventKey) {
  tournamentDetailEventKey = eventKey;
  tournamentDetailActiveTab = 'overview';
  document.getElementById('dashboard-page-tournaments').classList.add('hidden');
  document.getElementById('dashboard-page-tournament-detail').classList.remove('hidden');
  const schedule = currentSeasonTournamentSchedule();
  const event = schedule.find((e) => e.key === eventKey);
  document.getElementById('dashboard-page-title').textContent = 'Turnier | ' + (event ? event.label : '');
  renderTournamentDetailPanel();
}

function closeTournamentDetail() {
  tournamentDetailEventKey = null;
  document.getElementById('dashboard-page-tournament-detail').classList.add('hidden');
  document.getElementById('dashboard-page-tournaments').classList.remove('hidden');
  document.getElementById('dashboard-page-title').textContent = DASHBOARD_PAGE_LABELS.tournaments;
  // Während die Detailseite offen war, lief die Turniere-Seite selbst nicht
  // mit (advanceDashboardDay() rendert sie nur bei sichtbarem Panel neu) --
  // beim Zurückkehren einmal frisch rendern, damit "Heute"-Markierung/
  // Bevorstehend-Liste nicht veraltet sind, falls währenddessen WEITER
  // geklickt wurde.
  renderDashboardTournamentsPanel();
}

function tournamentEventCardHtml(ev) {
  const locationHtml = ev.location
    ? '<img class="dashboard-tournament-location-flag" src="assets/flags/' + ev.location.country.toLowerCase() + '.svg" alt="">' +
      '<span>' + ev.location.country + ', ' + ev.location.city + '</span>'
    : '<span>Online</span>';
  return (
    '<div class="dashboard-tournament-card" data-tournament="' + ev.key + '" style="--tournament-accent:' + ev.color + ';">' +
      '<div class="dashboard-tournament-card-logo" style="background:' + ev.color + ';">' + ev.icon + '</div>' +
      '<div class="dashboard-tournament-card-body">' +
        '<div class="dashboard-tournament-card-dates">' + formatCareerDateDisplay(ev.startDate) + ' - ' + formatCareerDateDisplay(ev.endDate) + '</div>' +
        '<div class="dashboard-tournament-card-name">' + ev.label + '</div>' +
        '<div class="dashboard-tournament-card-meta">' +
          '<span class="dashboard-tournament-stars">' + tournamentStarsHtml(ev.stars) + '</span>' +
          '<span class="dashboard-tournament-tier-badge">' + ev.tierLabel + '</span>' +
          '<span class="dashboard-tournament-location">' + locationHtml + '</span>' +
        '</div>' +
        // Runde 101, User-Meldung ("+100 Pkt. entfernen, stimmt so nicht direkt -- man
        // bekommt ja nicht einfach 100 Punkte als Gewinner"): `ev.points` war die reine
        // MAX-Punktzahl des Turniers (nur der Turniersieger bekommt sie tatsächlich, alle
        // anderen Platzierungen weniger, siehe OPEN_POINTS_TABLE/MAJOR_POINTS_TABLE) --
        // als "+ N Pkt." auf JEDER Turnierkarte suggerierte das fälschlich einen fixen
        // Bonus für jede Teilnahme.
        '<div class="dashboard-tournament-card-prize">' + formatMoney(ev.prize) + '</div>' +
      '</div>' +
      '<button type="button" class="dashboard-tournament-details-btn" data-tournament-details="' + ev.key + '">DETAILS</button>' +
    '</div>'
  );
}

function renderTournamentUpcomingList() {
  let schedule = currentSeasonTournamentSchedule();
  let upcoming = schedule.filter((ev) => ev.endDate >= careerDate);
  // Runde 102, Bug-Fix (User-Meldung: "keine Turniere fürs nächste Jahr
  // angezeigt, z.B. am 1. Jan. 2027"): die aktuelle Saison kann schon
  // komplett vorbei sein (Transferfenster), bevor checkSeasonRolloverIfDue()
  // den tatsächlichen Rollover auslöst (der wartet auf den Registrierungs-
  // start der Folge-Saison) -- bis dahin schon die Vorschau der Folge-Saison
  // zeigen, statt die Liste leer zu lassen.
  if (upcoming.length === 0) {
    schedule = buildSeasonTournamentSchedule((careerState.seasonNumber || 1) + 1);
    upcoming = schedule.filter((ev) => ev.endDate >= careerDate);
  }
  const listEl = document.getElementById('dashboard-tournaments-list');
  listEl.innerHTML = upcoming.length > 0
    ? upcoming.map(tournamentEventCardHtml).join('')
    : '<div class="dashboard-tournaments-list-empty">Alle Turniere dieser Saison sind bereits abgeschlossen.</div>';
  listEl.querySelectorAll('[data-tournament-details]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = schedule.find((e) => e.key === btn.dataset.tournamentDetails);
      // Runde 81, User-Vorgabe: jede Turnierart (Open/Major/LCQ/Weltmeister-
      // schaft) bekommt jetzt die volle Detailseite mit Format-Tabs -- der
      // alte Hinweis-Stub für Major/LCQ/Worlds (Runde 44) entfällt.
      if (ev) openTournamentDetail(ev.key);
    });
  });
}

// Synthetisches "Event"-Objekt, NUR damit das Transferfenster dieselbe
// {event, phaseKey, isFirstDay}-Balken-/Label-Anzeige wie ein echtes Turnier
// durchlaufen kann (siehe renderTournamentCalendar()) -- kein echtes
// TOURNAMENT_EVENT_DEFS-Event, braucht deshalb nur die Farbe.
const TRANSFER_WINDOW_CALENDAR_EVENT = { color: TRANSFER_WINDOW_COLOR };

function tournamentPhaseMapForMonth(schedule, year, month) {
  // Liefert pro Tag (1-basiert) im Monat die evtl. aktive Event-Phase --
  // day -> { event, phaseKey, isFirstDay }.
  const map = {};
  const monthPrefix = String(year) + '-' + String(month).padStart(2, '0') + '-';
  schedule.forEach((ev) => {
    TOURNAMENT_PHASE_KEYS.forEach((phaseKey) => {
      const span = ev.phaseDates[phaseKey];
      let cursor = span.start;
      let isFirstDay = true;
      while (cursor <= span.end) {
        if (cursor.startsWith(monthPrefix)) {
          const day = Number(cursor.slice(8, 10));
          map[day] = { event: ev, phaseKey, isFirstDay };
        }
        cursor = addDaysToDateStr(cursor, 1);
        isFirstDay = false;
      }
    });
  });
  // Runde 101, User-Vorgabe ("Transferphase soll auch im Kalender
  // eingezeichnet sein"): das Transferfenster ist kein TOURNAMENT_EVENT_DEFS-
  // Eintrag (spannt zudem über den Jahreswechsel, siehe
  // TRANSFER_WINDOW_START/END_MONTH_DAY in data/tournament-calendar.js) --
  // wird hier separat Tag für Tag nachgetragen. `map[day]` bleibt bei einer
  // (aktuell nie vorkommenden) Kollision mit einer echten Turnierphase
  // unangetastet, echte Turniertage haben also immer Vorrang.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (map[day]) continue;
    const dateStr = monthPrefix + String(day).padStart(2, '0');
    if (isTransferWindowOpen(dateStr)) {
      map[day] = { event: TRANSFER_WINDOW_CALENDAR_EVENT, phaseKey: 'transferWindow', isFirstDay: dateStr.slice(5) === TRANSFER_WINDOW_START_MONTH_DAY };
    }
  }
  return map;
}

function renderTournamentCalendar() {
  // Startet auf dem aktuellen In-Game-Monat statt immer auf dem ersten
  // Event der Saison (Runde 44: seit Januar turnierfrei ist, würde "erstes
  // Event" sonst am Saisonstart direkt zum Februar springen und die
  // "Heute"-Markierung wäre beim ersten Öffnen nie sichtbar).
  if (!tournamentCalendarViewMonth) {
    tournamentCalendarViewMonth = careerDate.slice(0, 7);
  }
  const [yearStr, monthStr] = tournamentCalendarViewMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12

  const MONTH_NAMES = ['JANUAR', 'FEBRUAR', 'MÄRZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'];
  document.getElementById('dashboard-tournament-cal-title').textContent = MONTH_NAMES[month - 1] + ', ' + year;

  // Runde 102, User-Vorgabe ("oben mittig über dem Kalender: Transferfenster
  // Geöffnet/Geschlossen"): zeigt den ECHTEN aktuellen Stand (heutiges
  // careerDate) -- unabhängig davon, welchen Monat/welches Jahr man sich
  // gerade ansieht (das browst man ja über die ‹/›-Pfeile unabhängig vom
  // tatsächlichen Kalenderfortschritt).
  const isOpen = isTransferWindowOpen(careerDate);
  const statusEl = document.getElementById('dashboard-transfer-window-status');
  statusEl.textContent = 'Transferfenster: ' + (isOpen ? 'Geöffnet' : 'Geschlossen');
  statusEl.classList.toggle('is-open', isOpen);
  statusEl.classList.toggle('is-closed', !isOpen);

  // Runde 101, User-Vorgabe ("jedes Jahr ist gleich aufgebaut, soll auch im
  // Kalender eingezeichnet sein"): buildSeasonTournamentSchedule() rechnet
  // seinen Zieljahr rein arithmetisch aus der Saison-Nummer aus
  // (TOURNAMENT_SEASON_1_YEAR + (seasonNumber-1)) -- das lässt sich exakt
  // umkehren, um für JEDES angezeigte Kalenderjahr (nicht nur das der
  // aktuellen Saison) dieselbe, sich Jahr für Jahr identisch wiederholende
  // Turnierstruktur zu erzeugen. Vorher zeigte currentSeasonTournamentSchedule()
  // nur das EINE Jahr der laufenden Saison -- jedes andere Jahr (z.B. beim
  // Durchblättern in die Vergangenheit/Zukunft) blieb leer, obwohl die
  // Struktur ja Jahr für Jahr exakt gleich ist. Reine Anzeige -- Anmeldung/
  // Auflösung/Punkte hängen weiterhin ausschließlich an
  // careerState.seasonNumber (currentSeasonTournamentSchedule()), hier
  // unangetastet.
  const schedule = buildSeasonTournamentSchedule(year - TOURNAMENT_SEASON_1_YEAR + 1);
  const phaseMap = tournamentPhaseMapForMonth(schedule, year, month);

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Montag = 0 ... Sonntag = 6 (deutsches Kalenderformat, siehe Referenz-Screenshot)
  const firstWeekday = (firstOfMonth.getUTCDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = careerDate;
  let html = '';
  cells.forEach((day) => {
    if (day === null) {
      html += '<div class="dashboard-tournament-cal-cell is-empty"></div>';
      return;
    }
    const dateStr = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isToday = dateStr === todayStr;
    const info = phaseMap[day];
    let barHtml = '';
    if (info) {
      barHtml = '<div class="dashboard-tournament-cal-bar" style="background:' + info.event.color + ';"></div>' +
        (info.isFirstDay
          ? '<div class="dashboard-tournament-cal-phase-label" style="color:' + info.event.color + ';">' +
            TOURNAMENT_PHASE_ICONS[info.phaseKey] + ' ' + TOURNAMENT_PHASE_LABELS[info.phaseKey] + '</div>'
          : '');
    }
    html += '<div class="dashboard-tournament-cal-cell' + (isToday ? ' is-today' : '') + '">' +
      '<span class="dashboard-tournament-cal-day">' + day + '</span>' +
      barHtml +
      '</div>';
  });
  document.getElementById('dashboard-tournament-cal-grid').innerHTML = html;
}

function shiftTournamentCalendarMonth(delta) {
  const [yearStr, monthStr] = tournamentCalendarViewMonth.split('-');
  let year = Number(yearStr);
  let month = Number(monthStr) + delta;
  if (month < 1) { month = 12; year -= 1; }
  if (month > 12) { month = 1; year += 1; }
  tournamentCalendarViewMonth = String(year) + '-' + String(month).padStart(2, '0');
  renderTournamentCalendar();
}

// Runde 100, User-Vorgabe ("sobald man disqualifiziert ist, dass man die
// ganze Season skippen kann"): "disqualifiziert für die Saison" heißt hier
// konkret -- der Open Qualifier ist aufgelöst, die eigene Org steht aber
// NICHT im 32er-Feld ihrer Region (dieselbe Bedingung wie der
// 'notQualified'-Zweig in openRegistrationStatus()). Das ist bewusst NICHT
// dasselbe wie "in einem einzelnen Turnier verloren" (z.B. Swiss-3-Loss-
// Ausscheiden aus Open 1) -- das schließt nur von DIESEM EINEN Event aus,
// nicht von der restlichen Saison (Open 1-6 laufen automatisch weiter, siehe
// resolveOpenEvent()). Nur das Verpassen des Open-Qualifier-Felds sperrt
// wirklich JEDES weitere Turnier dieser Saison.
function isPlayerDisqualifiedForSeason() {
  if (!seasonTournamentResults['open0']) return false;
  const region = orgRegion(assignedOrg.country);
  const qualified = region && (seasonQualifiedTeams[region] || []).includes(assignedOrg.name);
  return !qualified;
}

function renderDashboardTournamentsPanel() {
  renderTournamentCalendar();
  renderTournamentUpcomingList();
  // Runde 102: seasonSkipUsed unterdrückt den Banner, NACHDEM er schon einmal
  // genutzt wurde (isPlayerDisqualifiedForSeason() selbst bleibt ja weiterhin
  // wahr, siehe Deklaration von seasonSkipUsed).
  document.getElementById('dashboard-season-skip-banner').classList.toggle('hidden', seasonSkipUsed || !isPlayerDisqualifiedForSeason());
}

// Runde 100: springt (wie fastForwardToNextEventDay(), aber gezielt bis zum
// Transferfenster statt zum nächstbesten Ereignistag) den kompletten Rest
// der Saison durch -- nur für den Fall gedacht, dass die eigene Org laut
// isPlayerDisqualifiedForSeason() ohnehin an keinem weiteren Turnier mehr
// teilnehmen kann, also nichts mehr zu verpassen ist. `pendingOwnMatch` bleibt
// als Sicherheitsnetz stehen, sollte aber für eine disqualifizierte Org nie
// auftreten (findOwnMatchToday() findet dann schlicht keine eigenen Matches
// mehr).
function skipRestOfSeasonToTransferWindow() {
  let daysAdvanced = 0;
  while (daysAdvanced < FAST_FORWARD_MAX_DAYS) {
    advanceOneCalendarDay();
    daysAdvanced++;
    if (pendingOwnMatch || careerDate.slice(5) === TRANSFER_WINDOW_START_MONTH_DAY) break;
  }
  seasonSkipUsed = true; // Runde 102: Banner/Button verschwinden jetzt, s. renderDashboardTournamentsPanel()
  // Runde 102, User-Vorgabe ("Kalender soll auch bis dahin springen, wo man
  // hingesprungen ist"): tournamentCalendarViewMonth ist ein vom Tagfortschritt
  // UNABHÄNGIGER Anzeige-Zustand (man kann ja im Kalender vor-/zurückblättern,
  // ohne dass sich careerDate ändert) -- ohne diese Zeile bliebe die Kalender-
  // ANSICHT auf dem alten Monat stehen, obwohl careerDate längst im Dezember ist.
  tournamentCalendarViewMonth = careerDate.slice(0, 7);
  finishDashboardDayAdvance();
}

// Doppelte Bestätigung (User-Vorgabe: "wird gefragt ob man sich sicher ist,
// bestätigt nochmal") über das schon bestehende generische Bestätigungs-
// Popup (showConfirmModal(), s.u.) -- keine neue UI-Komponente nötig.
function onSeasonSkipClick() {
  showConfirmModal(
    'Rest der Saison überspringen?',
    'Du bist für den Rest dieser Saison ausgeschieden und kannst an keinem weiteren Turnier mehr teilnehmen. Direkt bis zur Öffnung des Transferfensters (1. Dezember) vorspringen?',
    () => {
      showConfirmModal(
        'Wirklich sicher?',
        'Das überspringt alle verbleibenden Tage dieser Saison auf einmal -- das lässt sich nicht rückgängig machen.',
        skipRestOfSeasonToTransferWindow,
        { confirmLabel: 'Ja, überspringen', danger: true }
      );
    },
    { confirmLabel: 'Weiter' }
  );
}

// Runde 100, Refactor (für den neuen Schnellvorlauf-Pfeil): reine
// Tag-Fortschritts-LOGIK (Datum, Sponsoren, Turnier-Auflösung, eigenes-Match-
// Fund) OHNE Rendering/Speichern -- gemeinsame Basis für advanceDashboardDay()
// (EIN Tag, rendert danach sofort) und fastForwardToNextEventDay() (viele
// Tage in einer stillen Schleife, rendert erst ganz am Ende einmal).
function advanceOneCalendarDay() {
  const previousMonth = careerDate.slice(0, 7);
  const d = parseCareerDate(careerDate);
  d.setUTCDate(d.getUTCDate() + 1);
  careerDate = d.toISOString().slice(0, 10);
  // Runde 105, User-Vorgabe ("wenn man den nächsten Monat erreicht, soll der
  // Kalender auto auf den aktuellen Monat rüberwechseln, z.B. Jan->Feb"):
  // `tournamentCalendarViewMonth` ist sonst bewusst vom Tagfortschritt
  // UNABHÄNGIG (man kann im Kalender vor-/zurückblättern, ohne dass sich
  // careerDate ändert, siehe skipRestOfSeasonToTransferWindow()) -- sobald der
  // ECHTE Tagfortschritt aber in einen neuen Monat wechselt, soll die Ansicht
  // automatisch mitziehen, statt manuell umgeblättert werden zu müssen.
  const newMonth = careerDate.slice(0, 7);
  if (newMonth !== previousMonth) tournamentCalendarViewMonth = newMonth;
  // Runde 121, User-Vorgabe ("Monatliches Gehalt"/"monatlich realistisch...
  // Budget vom Vorstand"): läuft genau einmal pro tatsächlichem Monatswechsel
  // (nicht pro Tag) -- wiederverwendet exakt dieselbe previousMonth/newMonth-
  // Erkennung wie der Kalender-Sync direkt darüber.
  if (newMonth !== previousMonth) applyMonthlyClubFinances();
  // Runde 102: MUSS vor checkTournamentResolutions() laufen, damit die
  // Turnier-Auflösung ab dem Rollover-Tag sofort die neue Saison sieht
  // (siehe checkSeasonRolloverIfDue()).
  checkSeasonRolloverIfDue();
  resolveSponsorResponses();
  // Runde 85: löst jedes Turnier-Event genau einmal automatisch auf, sobald
  // sein Anmeldeschluss erreicht ist (siehe checkTournamentResolutions()).
  checkTournamentResolutions();
  // Runde 101: verbucht fällige (7 Tage alte) Preisgeld-Payouts, siehe
  // queuePrizePayoutForPlacement()/processDuePrizePayouts().
  processDuePrizePayouts();
  // Runde 122: verbucht fällige (7 Tage alte) Spieler-Neuzugänge, siehe
  // queuePlayerArrival()/processDuePlayerArrivals().
  processDuePlayerArrivals();
  // Bug-Fix: MUSS nach checkTournamentResolutions() laufen, sonst sieht die
  // Sponsoring-Zielprüfung an genau dem Tag, an dem ein Turnier aufgelöst
  // wird, noch den alten matchHistory-Stand (ein Sieg würde sonst immer
  // erst am nächsten Tagfortschritt im Fortschrittsbalken auftauchen).
  checkSponsorGoals();

  // Runde 99, User-Meldung ("Weiter während der Anmeldephase wirft sofort ins
  // Match"): ein heute neu enthülltes eigenes Match startet NICHT mehr sofort
  // hier (Runde-95-Verhalten) -- es wird nur gemerkt (pendingOwnMatch), der
  // Tagfortschritt schließt ganz normal ab, und renderDashboardTopbar()
  // (aufgerufen aus finishDashboardDayAdvance()) zeigt daraufhin "MATCH »".
  // Erst der nächste, bewusste Klick auf den Button startet den Ticker
  // (siehe Listener auf btn-dashboard-advance-day / triggerPendingOwnMatch()).
  pendingOwnMatch = findOwnMatchToday();
}

function advanceDashboardDay() {
  advanceOneCalendarDay();
  finishDashboardDayAdvance();
}

// Runde 105, User-Vorgabe ("während eines laufenden Turnieres soll der
// Pfeil/Skip-Button weg sein"): true, sobald `careerDate` innerhalb der
// Enthüllungsspanne IRGENDEINES Turniers der laufenden Saison liegt --
// von dessen erstem Auslosungstag (`phaseDates.start.start`, siehe
// buildSeasonTournamentSchedule()) bis zu seinem letzten Tag (`endDate`).
// Ohne diese Sperre könnte der Schnellvorlauf mitten durch die ganze neue
// Match-für-Match-Erfahrung (Runde 105: Auslosungstage, Kaskaden-Animation,
// Runden-Gating) hindurchspringen und sie komplett umgehen -- er würde ja
// erst beim NÄCHSTEN Turnier-Anmeldetag wieder anhalten (siehe
// isCalendarEventDay()), lange nachdem das laufende Turnier "durchsimuliert"
// erschienen wäre.
function isAnyTournamentCurrentlyRevealing(dateStr) {
  return currentSeasonTournamentSchedule().some((event) => dateStr >= event.phaseDates.start.start && dateStr <= event.endDate);
}

// Runde 100, User-Vorgabe ("Pfeil neben Weiter/Match, der schnell bis zu
// einem Event-Tag im Kalender simuliert -- aktuell alle Anmeldetage der
// Turniere und der Tag der Transferöffnung"): `dateStr` gilt als Ereignistag,
// wenn dort entweder ein Turnier seine Anmeldephase ÖFFNET oder das
// Transferfenster öffnet (siehe TRANSFER_WINDOW_START_MONTH_DAY in
// data/tournament-calendar.js). Reiner Kalender-Check, unabhängig von der
// tatsächlichen (noch nicht gebauten) Transfermarkt-Logik.
function isCalendarEventDay(dateStr) {
  if (dateStr.slice(5) === TRANSFER_WINDOW_START_MONTH_DAY) return true;
  // Runde 102, Bug-Fix (User-Meldung: "Schnellvorlauf überspringt immer
  // ganzes Jahr"): currentSeasonTournamentSchedule() bleibt an
  // careerState.seasonNumber hängen -- checkSeasonRolloverIfDue() zählt die
  // erst weiter, wenn die Registrierung der Folge-Saison TATSÄCHLICH
  // erreicht ist. Bis dahin (z.B. während des Transferfensters kurz vor dem
  // Rollover) muss der Schnellvorlauf trotzdem schon das Registrierungsdatum
  // der FOLGE-Saison als Ziel kennen, sonst findet er nichts mehr bis zum
  // (dann falschen) nächsten 1. Dezember.
  const nextSeasonSchedule = buildSeasonTournamentSchedule((careerState.seasonNumber || 1) + 1);
  return currentSeasonTournamentSchedule().some((event) => event.phaseDates.registration.start === dateStr)
    || nextSeasonSchedule.some((event) => event.phaseDates.registration.start === dateStr);
}

// Sicherheitsnetz gegen eine Endlosschleife, falls der Kalender aus
// irgendeinem Grund nie wieder einen Ereignistag liefert (z.B. Saison-
// Nummer bleibt stehen) -- großzügig über ein volles Kalenderjahr hinaus.
const FAST_FORWARD_MAX_DAYS = 400;

// Runde 100: simuliert Tag für Tag OHNE Zwischenanzeige, bis entweder der
// nächste Ereignistag (isCalendarEventDay()) erreicht ist ODER ein eigenes
// Match auftaucht (pendingOwnMatch) -- ein noch nicht angesehenes eigenes
// Match darf NIE übersprungen werden (dieselbe Garantie wie überall sonst im
// Tagfortschritt, siehe [[rlcs-legends-project]] Runde 99), deshalb bricht
// der Vorlauf sofort ab, sobald eines gefunden wird, und rendert normal --
// der Spieler sieht dann den MATCH-Button (der Pfeil selbst blendet sich in
// diesem Zustand ohnehin aus, siehe renderDashboardTopbar()).
function fastForwardToNextEventDay() {
  if (pendingOwnMatch) return; // Button ist in diesem Zustand ausgeblendet, reine Absicherung
  let daysAdvanced = 0;
  while (daysAdvanced < FAST_FORWARD_MAX_DAYS) {
    advanceOneCalendarDay();
    daysAdvanced++;
    if (pendingOwnMatch || isCalendarEventDay(careerDate)) break;
  }
  finishDashboardDayAdvance();
}

function finishDashboardDayAdvance() {
  renderDashboardTopbar();
  // Startseite (Runde 126): Status-Banner/Kader-Zustand/Turnier-Countdown/
  // Ergebnisse/Rangliste sind alle datumsabhängig -- gleiches Live-Refresh-
  // Muster wie bei allen anderen Seiten unten.
  if (!document.getElementById('dashboard-page-home').classList.contains('hidden')) {
    renderDashboardHomePanel();
  }
  // Ohne diesen Refresh blieb die Sponsoren-Seite (Karten/Detail) beim
  // Tagfortschritt optisch auf dem alten Stand stehen (z.B. Sperre auf
  // 2. Ablehnung wurde intern korrekt gesetzt, aber die Karte zeigte
  // weiter den alten gelben "Nicht verfügbar"-Punkt statt rot).
  if (!document.getElementById('dashboard-page-sponsors').classList.contains('hidden')) {
    renderDashboardSponsorsPanel();
  }
  // Gleiches Prinzip für die Turniere-Seite -- die "Heute"-Markierung im
  // Kalender und die "nur noch offene Turniere"-Filterung der Liste müssen
  // beim Tagfortschritt aktuell bleiben, wenn die Seite gerade offen ist.
  if (!document.getElementById('dashboard-page-tournaments').classList.contains('hidden')) {
    renderDashboardTournamentsPanel();
  }
  // Open-Qualifier-Detailseite: Anmeldestatus/Teilnehmer-Slots müssen sich
  // ebenfalls live aktualisieren, wenn der Draw während des Betrachtens
  // dieser Seite ausgelöst wird.
  if (!document.getElementById('dashboard-page-tournament-detail').classList.contains('hidden')) {
    renderTournamentDetailPanel();
  }
  // Bug-Fix (User-Meldung: "Spieler-Daten/Entwicklungsverlauf werden nach
  // einem Turnier nicht live geupdatet"): dieselbe fehlende Live-Aktualisierung
  // wie oben bei Sponsoren/Turniere, nur für Statistiken vergessen -- die
  // zugrundeliegenden Daten (playerDevelopment/careerOrgStats/seasonPoints)
  // wurden schon vorher korrekt bei jedem simulierten Spiel aktualisiert
  // (live geprüft), nur die Statistiken-Seite selbst rendert sich beim
  // Tagfortschritt nie neu, solange sie schon offen ist -- ein Sidebar-
  // Wechsel weg und zurück zeigte die aktuellen Werte bereits korrekt an.
  if (!document.getElementById('dashboard-page-stats').classList.contains('hidden')) {
    renderDashboardStatsPanel();
  }
  if (!document.getElementById('dashboard-page-team-info').classList.contains('hidden')) {
    renderTeamInfoPanel();
  }
  // Transfers-Seite (Runde 114): das Transferfenster-Banner ist datumsabhängig
  // (isTransferWindowOpen(careerDate)) -- muss beim Tagfortschritt genauso
  // live nachziehen wie oben, sonst zeigt es z.B. beim Überschreiten des
  // 1. Dezembers/15. Januars den falschen Status, solange die Seite offen ist.
  if (!document.getElementById('dashboard-page-transfers').classList.contains('hidden')) {
    renderDashboardTransfersPanel();
  }
  // Scouting-Seite (Runde 116): Transferbudget (financeAllocation.transfers)
  // und Spielerwerte können sich beim Tagfortschritt ändern (Entwicklung,
  // Finanzen) -- gleiches Live-Refresh-Muster wie oben.
  if (!document.getElementById('dashboard-page-scouting').classList.contains('hidden')) {
    renderDashboardScoutingPanel();
  }
  saveGameState();
}

function goToDashboard() {
  careerDate = careerDate || '2026-01-01';
  renderDashboardTopbar();
  selectDashboardPage('home');
  showScreen('screen-dashboard');
}

// ── Org-Zuweisung: Intro-Seite → Spielautomat → Popup → Kader ───────────
const REEL_ITEM_HEIGHT = 60;
const REEL_LAPS = 5;

let pendingOrg = null; // schon zufällig bestimmt, aber dem Spieler noch nicht gezeigt

function goToOrgIntro() {
  pendingOrg = assignRandomOrg();
  document.getElementById('intro-welcome-heading').textContent = 'Willkommen, ' + careerCharacter.name;
  document.getElementById('intro-text-main').innerHTML =
    'Du startest jetzt als ' + careerCharacter.name + ' für eine <strong>zufällig zugeordnete ' +
    'Organisation</strong>. Du suchst dir die Organisation nicht aus — so wie im ' +
    'echten Esport wird dir ein Verein zugeteilt, mit dem du arbeiten musst.';
  document.getElementById('intro-text-block').classList.remove('hidden');
  document.getElementById('reel-block').classList.add('hidden');
  showScreen('screen-org-intro');
}

function buildReelSequence(targetOrg) {
  const seq = [];
  for (let i = 0; i < REEL_LAPS; i++) {
    seq.push(...ORGANIZATIONS.slice().sort(() => Math.random() - 0.5));
  }
  seq.push(targetOrg); // garantiert der letzte Eintrag — hier landet der Automat
  return seq;
}

function spinReel() {
  document.getElementById('intro-text-block').classList.add('hidden');
  document.getElementById('reel-block').classList.remove('hidden');

  const track = document.getElementById('reel-track');
  const sequence = buildReelSequence(pendingOrg);

  track.innerHTML = '';
  sequence.forEach((org) => {
    const item = document.createElement('div');
    item.className = 'reel-item';
    item.textContent = org.name;
    track.appendChild(item);
  });

  // Startzustand ohne Transition setzen, dann im nächsten Frame die Ziel-
  // Position mit Transition anfahren — sonst überspringt der Browser den
  // Sprung von "0" auf die Zielposition ohne sichtbare Animation.
  track.style.transition = 'none';
  track.style.transform = 'translateY(0)';

  const targetIndex = sequence.length - 1;
  const viewportHeight = REEL_ITEM_HEIGHT * 3;
  const finalOffset = -(targetIndex * REEL_ITEM_HEIGHT) + (viewportHeight / 2 - REEL_ITEM_HEIGHT / 2);

  track.classList.add('is-spinning');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      track.style.transition = 'transform 3.4s cubic-bezier(0.12, 0.75, 0.2, 1)';
      track.style.transform = 'translateY(' + finalOffset + 'px)';
    });
  });
  setTimeout(() => track.classList.remove('is-spinning'), 2400);

  // Popup zeigen, sobald der Automat steht — kurze Pause danach, damit die
  // gelandete Org noch sichtbar bleibt. transitionend UND ein Fallback-Timer
  // lösen dasselbe aus (je nachdem was zuerst feuert); modalTriggered
  // verhindert, dass es doppelt passiert. Der Fallback stellt sicher, dass
  // das Popup auch dann erscheint, wenn transitionend aus irgendeinem Grund
  // (z.B. Timing-Eigenheiten je nach System) nicht zuverlässig feuert.
  let modalTriggered = false;
  const triggerModal = () => {
    if (modalTriggered) return;
    modalTriggered = true;
    setTimeout(() => showOrgModal(pendingOrg), 1400);
  };
  const onSpinDone = () => {
    track.removeEventListener('transitionend', onSpinDone);
    triggerModal();
  };
  track.addEventListener('transitionend', onSpinDone);
  setTimeout(triggerModal, 3600);
}

function showOrgModal(org) {
  document.getElementById('modal-org-title').textContent = org.name + ' — Stärke ' + org.strength;
  const lines = document.getElementById('modal-org-lines');
  lines.innerHTML =
    '<div class="org-line">' + org.description + '</div>' +
    '<div class="modal-budget">Startbudget: ' + formatMoney(org.budget) + '</div>';
  document.getElementById('org-modal').classList.remove('hidden');
}

function confirmOrgAndProceed() {
  document.getElementById('org-modal').classList.add('hidden');
  assignedOrg = pendingOrg;
  gameMode = 'career'; // aktuell der einzige spielbare Modus
  const charEffects = computeCharacterEffects(careerCharacter.traits);
  BUDGET = Math.round(assignedOrg.budget * charEffects.budgetMultiplier / 1000) * 1000;

  // "Echter Startkader" (User-Entscheidung): die Org startet NICHT mit leerem
  // Kader, sondern direkt mit den 3 festen Startern + Sub + Coach aus
  // generateOrgRoster() (siehe data/org-rosters.js) -- dieselbe Vorbefüll-
  // Logik wie beim Saisonwechsel (startNextSeason()), nur schon für Saison 1.
  // Der Kader "kostet nichts extra": sein Marktwert steckt schon in BUDGET
  // (siehe computeOrgBudget() in organizations.js), getSpent()/getRemaining()
  // rechnen dadurch automatisch richtig, ohne dass am Draft-Code selbst etwas
  // geändert werden musste. Reserve-Plätze bleiben leer -- die werden weiter
  // frei aus dem Transfermarkt/Pool bestückt.
  // roster.sub ist bei selbst erstellten Orgas OHNE Free-Agent-Auffüllung
  // (bzw. bei nur 3 gefundenen Startern) bewusst leer -- siehe
  // buildCustomOrgFromForm() -- bei den 87 bestehenden Orgas (generateOrgRoster())
  // ist immer ein Sub vorhanden.
  const roster = assignedOrg.roster;
  careerRosterPlayers = roster.sub ? [...roster.starters, roster.sub] : [...roster.starters];
  careerReservePlayers = [];
  careerCoach = roster.coach;
  rosterSlots = {
    main: padToSize(roster.starters.map((p) => p.name), MAIN_SIZE),
    sub: padToSize(roster.sub ? [roster.sub.name] : [], SUB_SIZE),
    reserve: emptySlotArray(RESERVE_SIZE),
  };
  draftedCoachName = roster.coach.name;

  negotiatedPremiumPlayers = {};
  negotiationBlocklist = {};
  playersTradedThisSeason = new Set();
  transferLog = [];
  tournamentState = null;
  careerState = { seasonNumber: 1, titlesWon: 0, seasonGuideShown: false };

  // Vertragsklauseln vom Vertrags-Screen übernehmen (siehe goToOrgContract()) --
  // gelten für die gesamte Karriere, werden hier einmalig fest eingefroren.
  ceoFireable = document.getElementById('opt-ceo-fireable').classList.contains('is-active');
  achievementsEnabled = ceoFireable; // dieselbe Checkbox steuert beides (siehe Vertragstext)
  consecutivePoorSeasons = 0;
  careerEnded = false;
  unlockedAchievements = [];
  const lockOption = document.querySelector('.org-contract-lock-option.is-active');
  const lockMonths = lockOption && lockOption.dataset.value === '6' ? 6 : 1;
  const lockDate = new Date();
  lockDate.setMonth(lockDate.getMonth() + lockMonths);
  transfersLockedUntil = lockDate.toISOString();

  // Bot-Teams (inkl. Vertrags-Zuordnung echter Spieler) schon HIER erzeugen,
  // nicht erst bei startTournament() — die Markt-/Draft-Ansicht muss von
  // Anfang an wissen, welche Spieler schon anderswo unter Vertrag sind.
  careerBotTeams = generateBotTeams(TOURNAMENT_TEAM_COUNT - 1, assignedOrg.name);
  careerRivalRecords = {};
  careerPlaytimeSeconds = 0;
  startPlaytimeTracking();

  // User-Wunsch: nach der Unterschrift geht es jetzt zum neuen Dashboard
  // (statt direkt zum Draft-Screen) -- "Man startet immer ab 01. Jan 2026".
  careerDate = '2026-01-01';
  // Feste €-Beträge (nicht mehr Prozente, siehe financeAllocation-Kommentar
  // an FINANCE_ALLOC_KEYS) -- EINMALIG aus dem Startbudget nach der klassischen
  // 50/20/10/20-Aufteilung berechnet, damit die Finanzen-Seite nicht komplett
  // leer wirkt, wenn man sie zum ersten Mal öffnet. Künftiges Einkommen
  // verändert diese festen Beträge NIE automatisch mehr (User-Vorgabe).
  const startBudget = Math.max(0, assignedOrg.budget);
  financeAllocation = {
    transfers: Math.round(startBudget * 0.5),
    salaries: Math.round(startBudget * 0.2),
    marketing: Math.round(startBudget * 0.1),
    operations: Math.round(startBudget * 0.2),
  };
  careerSeasonIncomeTotal = 0;
  sponsorState = {};
  selectedSponsorName = null;
  careerTotalWins = 0;
  careerTotalLosses = 0;
  careerSponsorIncomeTotal = 0;
  sponsorRequestLog = [];
  tournamentCalendarViewMonth = null;
  financeMonthlyLedger = {};
  financeTransactionLog = [];
  pendingPlayerArrivals = [];
  openQualifierRegistrations = {};
  // Bug-Fix: bei "Neues Spiel" wurde der Renderer-Prozess nicht neu geladen,
  // dadurch überlebten diese vier Variablen aus einem vorherigen Spielstand
  // (gleiche Electron-Session) und wurden in den neuen Spielstand mit
  // gespeichert -- z.B. stand das erste Turnier (Januar) schon mit alten
  // Ergebnissen da. Gehören genau wie seasonPoints/seasonTournamentResults
  // (siehe startNextSeason(), Runde 82/85) zum Karriere-Zustand und müssen
  // bei einer komplett neuen Karriere ebenfalls auf 0 zurück -- anders als
  // beim reinen Saisonwechsel INNERHALB einer Karriere, wo teamForm/
  // matchHistory bewusst NICHT zurückgesetzt werden (siehe deren Deklaration).
  seasonPoints = {};
  seasonTournamentResults = {};
  teamForm = {};
  matchHistory = [];
  careerOrgStats = {};
  // Bug-Fix (selbst gefunden): ORGANIZATIONS bleibt über die GESAMTE
  // App-Sitzung im Speicher (wird nur beim App-Start neu aufgebaut, nicht
  // bei "Neues Spiel") -- eine vorherige Karriere könnte Spieler-Objekte
  // bereits IN-PLACE entwickelt haben. Bloßes `playerDevelopment = {}` würde
  // nur die Nachverfolgung zurücksetzen, nicht die schon veränderten Stats
  // selbst -- resetPlayerDevelopmentToBaseline() spielt zuerst jeden
  // betroffenen Spieler auf seine echte Baseline zurück, bevor die
  // Nachverfolgung geleert wird.
  resetPlayerDevelopmentToBaseline();
  // Personal-Verpflichtungen (Runde 117) betreffen nur fremde Bot-Orgs --
  // anders als bei playerDevelopment gibt es hier keinen "Baseline"-Zustand
  // zum Zurückspielen (jede Ersatzperson ist bereits ein eigenständiges,
  // fertiges Objekt, kein akkumulierter Delta-Wert). Leeren der Nachverfolgung
  // reicht: ein wirklicher App-Neustart baut ORGANIZATIONS ohnehin komplett
  // neu aus den Rohdaten auf.
  staffTransferReplacements = {};
  playerTransferReplacements = {};
  signedFreeAgentPlayers = new Set();
  signedFreeAgentStaff = new Set();
  seasonQualifiedTeams = {};
  shownOwnMatchSteps = {}; // Runde 98: sonst könnte ein alter Merker den Match-Popup im neuen Spiel unterdrücken
  cascadeRevealedSteps = {}; // Runde 102: kein Merker aus einer vorherigen Karriere darf hier noch stehen
  pendingOwnMatch = null; // Runde 99: kein Match aus einer vorherigen Karriere darf hier noch anstehen
  pendingPrizePayouts = []; // Runde 101: kein Preisgeld aus einer vorherigen Karriere darf hier noch ausstehen
  seasonSkipUsed = false; // Runde 102: neue Karriere, neue Saison 1 -- Banner darf wieder erscheinen können
  renderAll();
  saveGameState();
  goToDashboard();
}

// ── Match-Simulation & Text-Ticker ───────────────────────────────────────
let matchSpeed = 1;
let matchRunId = 0; // erhöht sich bei jedem neuen Match — stoppt laufende Wiedergaben von vorher

function buildRosterTile(p, team) {
  const tile = document.createElement('div');
  tile.className = 'player-tile';
  tile.dataset.team = team;
  tile.dataset.name = p.name;
  tile.innerHTML =
    '<div class="tile-rating">' + p.overall + '</div>' +
    '<div class="tile-name">' + p.name + '</div>';
  return tile;
}

function renderMatchRosters(teamA, teamB) {
  const rosterA = document.getElementById('roster-a');
  const rosterB = document.getElementById('roster-b');
  rosterA.innerHTML = '';
  rosterB.innerHTML = '';
  teamA.forEach((p) => rosterA.appendChild(buildRosterTile(p, 'A')));
  teamB.forEach((p) => rosterB.appendChild(buildRosterTile(p, 'B')));
}

function buildMetaChip(label, valueText) {
  const chip = document.createElement('div');
  chip.className = 'meta-chip';
  chip.innerHTML = '<span class="meta-label">' + label + '</span><span class="meta-value">' + valueText + '</span>';
  return chip;
}

function buildBonusChip(pct) {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  const chip = document.createElement('div');
  chip.className = 'meta-chip bonus-chip' + (rounded > 0 ? ' bonus-positive' : rounded < 0 ? ' bonus-negative' : '');
  chip.innerHTML = '<span class="meta-label">Team-Bonus</span><span class="meta-value">' + sign + rounded + '%</span>';
  return chip;
}

function renderMatchMeta(coach, sub, teamABonusPct) {
  const metaA = document.getElementById('roster-meta-a');
  metaA.innerHTML = '';
  metaA.appendChild(buildMetaChip('Coach', coach ? coach.name + ' (' + coach.overall + ')' : '— keiner gedraftet'));
  metaA.appendChild(buildMetaChip('Sub', sub ? sub.name + ' (' + sub.overall + ')' : '— keiner gedraftet'));
  metaA.appendChild(buildBonusChip(teamABonusPct));

  const metaB = document.getElementById('roster-meta-b');
  metaB.innerHTML = '';
  metaB.appendChild(buildMetaChip('Coach', '— Bot-Team'));
  metaB.appendChild(buildMetaChip('Sub', '— Bot-Team'));
  metaB.appendChild(buildBonusChip(0));
}

const FLASH_CLASSES = ['tile-flash-goal', 'tile-flash-save', 'tile-flash-sub'];

function highlightPlayerTile(team, playerName, type) {
  if (!playerName) return;
  const cls = type === 'goal' ? 'tile-flash-goal'
    : type === 'save' ? 'tile-flash-save'
    : type === 'sub' ? 'tile-flash-sub'
    : null;
  if (!cls) return;
  const tile = document.querySelector('.player-tile[data-team="' + team + '"][data-name="' + playerName + '"]');
  if (!tile) return;
  // "ein paar Sekunden" sichtbar — vorherige Klasse zuerst entfernen, damit ein
  // erneutes Aufblitzen (falls derselbe Spieler kurz danach nochmal trifft) die
  // Animation sauber neu startet, statt einfach zu verlängern.
  tile.classList.remove(...FLASH_CLASSES);
  void tile.offsetWidth; // Reflow erzwingen, damit die CSS-Animation neu startet
  tile.classList.add(cls);
  clearTimeout(tile._flashTimeout);
  tile._flashTimeout = setTimeout(() => tile.classList.remove(cls), 2600);
}

function setMatchSpeed(speed) {
  matchSpeed = speed;
  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.speed) === speed);
  });
}

let matchInterval = null;
let matchElapsedGameSeconds = 0;
let matchEventCumulative = [];
let matchEventsGlobal = [];
let matchNextEventIndex = 0;
let matchLastTickTime = null;
let matchWentToOvertime = false;
let matchOnFinished = null; // Callback, wenn der Nutzer nach dem Ticker auf "Weiter" klickt
let matchSeriesDotsInfo = null; // { bestOf, priorResults, pendingResult } fürs Serien-Punkte-Anzeige

const MATCH_DURATION_SECONDS = 300; // 5 Minuten Spielzeit
const MATCH_TICK_MS = 100;          // Ziel-Intervall — Browser können das drosseln
                                     // (z.B. unfokussierte Fenster), deshalb wird unten
                                     // die ECHTE verstrichene Zeit gemessen statt eines
                                     // angenommenen festen Werts pro Tick.

function stopMatchInterval() {
  if (matchInterval) {
    clearInterval(matchInterval);
    matchInterval = null;
  }
}

// Baut das synthetische Ticker-Schlusswort für ein Einzelspiel innerhalb einer
// Serie — erscheint als letzte Zeile NACH dem eigentlichen Spielverlauf, damit
// der Serien-Stand nicht schon vor dem Spielende verraten wird.
function buildSeriesResultEvent(info) {
  const msg = info.seriesDone
    ? 'SERIE ENTSCHIEDEN! Endstand ' + info.finalWinsA + ':' + info.finalWinsB
    : 'Spiel ' + info.gameNumber + ' vorbei — Serienstand jetzt ' + info.finalWinsA + ':' + info.finalWinsB;
  return { time: 'Serie', msg, stepSeconds: 3, type: 'series', isSeriesResult: true };
}

// Spielt ein bereits fertig simuliertes Match (result von simulateMatch) im
// Ticker ab. "Team A" ist hier IMMER das eigene, gedraftete Team (so wird
// simulateMatch auch aufgerufen — Coach/Sub/Org-Bonus gelten nur für Team A).
// onFinished(scoreA, scoreB) wird aufgerufen, sobald der Ticker fertig ist UND
// der Nutzer auf "Weiter"/"Nächstes Spiel" klickt. seriesInfo (optional) zeigt
// den Bo5/Bo7-Serienkontext an (Kopfzeile + Schlusswort im Ticker).
function playMatchTicker(result, nameA, nameB, playersA, playersB, coach, sub, onFinished, seriesInfo) {
  const events = seriesInfo ? [...result.events, buildSeriesResultEvent(seriesInfo)] : result.events;

  let cumulative = 0;
  matchEventCumulative = events.map((e) => {
    cumulative += e.stepSeconds;
    return cumulative;
  });
  matchEventsGlobal = events;
  matchNextEventIndex = 0;
  matchElapsedGameSeconds = 0;
  matchWentToOvertime = result.events.some((e) => e.isOvertime);
  matchOnFinished = onFinished;

  const seriesInfoEl = document.getElementById('match-series-info');
  if (seriesInfo) {
    seriesInfoEl.textContent = 'Bo' + seriesInfo.bestOf + ' — Spiel ' + seriesInfo.gameNumber
      + ' · Serienstand vor diesem Spiel: ' + seriesInfo.preGameWinsA + ':' + seriesInfo.preGameWinsB;
  } else {
    seriesInfoEl.textContent = '';
  }

  // Serien-Punkte: bereits gespielte Spiele sofort sichtbar, das GERADE laufende
  // Spiel wird erst am Ende (synthetisches "series"-Ereignis) aufgedeckt, damit
  // der Ticker sein eigenes Ergebnis nicht vorab verrät.
  matchSeriesDotsInfo = seriesInfo
    ? { bestOf: seriesInfo.bestOf, priorResults: seriesInfo.priorResults, pendingResult: seriesInfo.pendingResult }
    : null;
  renderSeriesDots(false);

  document.getElementById('match-name-a').textContent = nameA;
  document.getElementById('match-name-b').textContent = nameB;
  document.getElementById('match-score').textContent = '0 : 0';
  document.getElementById('match-clock').textContent = formatClock(MATCH_DURATION_SECONDS);
  document.getElementById('btn-back-to-menu-match').classList.add('hidden');
  document.getElementById('btn-match-continue').classList.add('hidden');
  document.getElementById('btn-match-continue').textContent = seriesInfo ? seriesInfo.continueLabel : 'Weiter zum Turnier';
  setMatchSpeed(1);

  renderMatchRosters(playersA, playersB);
  renderMatchMeta(coach, sub, result.teamABonusPct);

  const ticker = document.getElementById('match-ticker');
  ticker.innerHTML = '';

  showScreen('screen-match');
  stopMatchInterval();
  matchLastTickTime = performance.now();
  matchInterval = setInterval(tickMatch, MATCH_TICK_MS);
}

// Nach Ablauf der regulären 5 Minuten: falls es zur Verlängerung kam, zählt die
// Uhr mit "+" hoch (wie im echten Spiel), sonst bleibt sie bei 0:00 stehen.
function computeMatchClockText() {
  if (matchWentToOvertime && matchElapsedGameSeconds > MATCH_DURATION_SECONDS) {
    return '+' + formatClock(matchElapsedGameSeconds - MATCH_DURATION_SECONDS);
  }
  return formatClock(Math.max(0, MATCH_DURATION_SECONDS - matchElapsedGameSeconds));
}

function tickMatch() {
  // Echte verstrichene Wall-Clock-Zeit seit dem letzten Tick messen, statt einen
  // festen MATCH_TICK_MS-Abstand anzunehmen — Browser drosseln setInterval teils
  // stark (z.B. bei unfokussierten Fenstern), das würde sonst die Uhr verlangsamen.
  // matchSpeed wird jeden Tick frisch gelesen, wodurch ein Speed-Wechsel sofort wirkt.
  const now = performance.now();
  const realElapsedSec = (now - matchLastTickTime) / 1000;
  matchLastTickTime = now;
  matchElapsedGameSeconds += realElapsedSec * matchSpeed;
  document.getElementById('match-clock').textContent = computeMatchClockText();

  while (
    matchNextEventIndex < matchEventsGlobal.length &&
    matchEventCumulative[matchNextEventIndex] <= matchElapsedGameSeconds
  ) {
    revealMatchEvent(matchEventsGlobal[matchNextEventIndex]);
    matchNextEventIndex += 1;
  }

  if (matchNextEventIndex >= matchEventsGlobal.length) {
    stopMatchInterval();
    document.getElementById('btn-back-to-menu-match').classList.remove('hidden');
    document.getElementById('btn-match-continue').classList.remove('hidden');
  }
}

// "Sofort simulieren"-Button: überspringt die Ticker-Animation des AKTUELLEN
// Einzelspiels — das Ergebnis steht ja bereits fest (simulateMatch() berechnet
// den ganzen Spielverlauf im Voraus, der Ticker spielt ihn nur zeitversetzt ab).
// Wirkt nur auf das laufende Spiel, nicht auf die restliche Serie.
function instantFinishCurrentGame() {
  if (!matchInterval) return; // Ticker ist schon fertig (natürlich oder bereits per Klick beendet)
  stopMatchInterval();
  while (matchNextEventIndex < matchEventsGlobal.length) {
    revealMatchEvent(matchEventsGlobal[matchNextEventIndex]);
    matchNextEventIndex += 1;
  }
  matchElapsedGameSeconds = matchEventCumulative.length
    ? matchEventCumulative[matchEventCumulative.length - 1]
    : MATCH_DURATION_SECONDS;
  document.getElementById('match-clock').textContent = computeMatchClockText();
  document.getElementById('btn-back-to-menu-match').classList.remove('hidden');
  document.getElementById('btn-match-continue').classList.remove('hidden');
}

function revealMatchEvent(e) {
  const ticker = document.getElementById('match-ticker');

  const row = document.createElement('div');
  row.className = 'ticker-row' + (e.isGoal ? ' ticker-goal' : '') + (e.isFinal ? ' ticker-final' : '')
    + (e.type === 'sub' ? ' ticker-sub' : '') + (e.type === 'overtime-start' ? ' ticker-overtime' : '')
    + (e.type === 'series' ? ' ticker-series' : '');
  row.innerHTML = '<span class="ticker-time">' + e.time + '</span><span class="ticker-msg">' + e.msg + '</span>';
  ticker.appendChild(row);
  ticker.scrollTop = ticker.scrollHeight;

  const scoreMatch = e.msg.match(/\((\d+):(\d+)\)/);
  if (scoreMatch) {
    document.getElementById('match-score').textContent = scoreMatch[1] + ' : ' + scoreMatch[2];
  }

  if (e.type === 'sub') {
    // Kachel des ausgewechselten Spielers durch den Sub ersetzen
    const tile = document.querySelector('.player-tile[data-team="A"][data-name="' + e.subOutName + '"]');
    if (tile) {
      tile.dataset.name = e.subInPlayer.name;
      tile.querySelector('.tile-rating').textContent = e.subInPlayer.overall;
      tile.querySelector('.tile-name').textContent = e.subInPlayer.name;
    }
  }

  highlightPlayerTile(e.team, e.player, e.type);

  // Das synthetische Serien-Ergebnis-Ereignis ist der Moment, in dem das GERADE
  // gespielte Spiel selbst als Punkt aufgedeckt wird (vorher nur die früheren
  // Spiele der Serie) — kein Spoiler vor Ende des Ticker-Verlaufs.
  if (e.type === 'series') renderSeriesDots(true);
}

// Zeichnet die Serien-Punkte (grün = Sieg, rot = Niederlage, leer = noch offen).
// revealCurrent=false zeigt nur die bereits abgeschlossenen Spiele der Serie.
function renderSeriesDots(revealCurrent) {
  const el = document.getElementById('match-series-dots');
  if (!matchSeriesDotsInfo) { el.innerHTML = ''; return; }
  const { bestOf, priorResults, pendingResult } = matchSeriesDotsInfo;
  const results = revealCurrent ? [...priorResults, pendingResult] : priorResults;
  let html = '';
  for (let i = 0; i < bestOf; i++) {
    const r = results[i];
    const cls = r === 'win' ? 'series-dot-win' : r === 'loss' ? 'series-dot-loss' : '';
    html += '<span class="series-dot' + (cls ? ' ' + cls : '') + '"></span>';
  }
  el.innerHTML = html;
}

// ── Turnier: echtes Swiss-Bracket-Format (r1 → r2w/r2l → r3-Decider → Playoffs) ──
let tournamentState = null;
let tournamentAutoSimRunning = false; // true während "Turnier sofort simulieren" läuft

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const TOURNAMENT_TEAM_COUNT = 32; // Open-Qualifier-Feldgröße (voll RLCS-1:1-Struktur, komprimiert — siehe season.js)

// ── Saison-Orchestrierung: 3 Open Qualifier -> Major -> LCQ/Direkt -> WM ────
// User-Wunsch: volle 1:1-Nachbildung der echten RLCS-Saisonstruktur (siehe
// season.js für die reine Logik-Schicht — hier wird sie an UI/Match-Ticker
// angebunden). `seasonState` trägt die saisonweiten Daten (alle 32 Teams
// bleiben über die GANZE Saison bestehen, Punkte akkumulieren); `tournamentState`
// bleibt bewusst als Konzept erhalten und beschreibt IMMER nur die AKTUELL
// sichtbare Bracket-Stufe (Name, ob die Runde schon gespielt wurde, Status-
// Hinweis) — dadurch funktioniert der bestehende Match-Ticker-Flow
// (playNextSeriesGame() etc.) so gut wie unverändert weiter, er kennt nur
// "eine Serie spielen", nicht welchem der 4 Turnierformate sie entstammt.
let seasonState = null;

function resetTeamRecords(teams) {
  teams.forEach((t) => { t.wins = 0; t.losses = 0; t.scoreFor = 0; t.scoreAgainst = 0; });
}

function findTournamentTeam(id) {
  return seasonState.allTeams.find((t) => t.id === id);
}

// Liefert die Matches der aktuell zu spielenden Stufe als flache Liste —
// zentraler Dispatch über alle 4 Event-Typen (Open/Major/LCQ/WM) und deren
// jeweilige interne Stufen.
function getCurrentStageMatches() {
  const ss = seasonState;
  if (!ss || !ss.event) return [];
  const ev = ss.event;
  const stage = tournamentState.stage;

  if (stage === 'open-bracket') return getDoubleElimRoundMatches(ev.bracket);
  if (stage === 'open-swiss') return getRoundMatches(ev.swiss, tournamentState.swissRoundNum);
  if (stage === 'open-gsl') return ev.gslGroups.flatMap((g) => getGslGroupPendingMatches(g));
  if (stage === 'open-playoff-semi') return [ev.playoffs.sf1, ev.playoffs.sf2];
  if (stage === 'open-playoff-final') return [ev.playoffs.final];

  if (stage === 'major-swiss') return getRoundMatches(ev.swiss, tournamentState.swissRoundNum);
  if (stage === 'major-playoff-quarter') return [ev.playoffs.qf1, ev.playoffs.qf2, ev.playoffs.qf3, ev.playoffs.qf4];
  if (stage === 'major-playoff-semi') return [ev.playoffs.sf1, ev.playoffs.sf2];
  if (stage === 'major-playoff-final') return [ev.playoffs.final];

  if (stage === 'lcq-quarter') return [ev.bracket.qf1, ev.bracket.qf2, ev.bracket.qf3, ev.bracket.qf4];
  if (stage === 'lcq-semi') return [ev.bracket.sf1, ev.bracket.sf2];

  if (stage === 'worlds-gsl') return ev.groups.flatMap((g) => getGslGroupPendingMatches(g));
  if (stage === 'worlds-playoff-quarter') return [ev.playoffs.qf1, ev.playoffs.qf2, ev.playoffs.qf3, ev.playoffs.qf4];
  if (stage === 'worlds-playoff-semi') return [ev.playoffs.sf1, ev.playoffs.sf2];
  if (stage === 'worlds-playoff-final') return [ev.playoffs.final];

  return []; // Info-/Übergangsstufen (z.B. 'major-check') haben keine Matches
}

function findPlayerMatch() {
  return getCurrentStageMatches().find((m) => m.aId === 'player' || m.bId === 'player');
}

function startTournament() {
  const myStarters = rosterSlots.main.filter(Boolean).map(findPlayer);
  const mySub = rosterSlots.sub[0] ? findPlayer(rosterSlots.sub[0]) : null;
  const myCoach = draftedCoachName ? findCoach(draftedCoachName) : null;

  // Bot-Teams bleiben über die ganze Karriere bestehen (Rivalitäten) — nur bei
  // der allerersten Saison neu würfeln, danach den entwickelten Bestand nutzen.
  if (!careerBotTeams) careerBotTeams = generateBotTeams(TOURNAMENT_TEAM_COUNT - 1, assignedOrg.name);
  const botTeams = careerBotTeams;
  const teams = [
    createTournamentTeam('player', assignedOrg.name, true, myStarters, mySub, myCoach),
    ...botTeams.map((b, i) => createTournamentTeam('bot' + i, b.name, false, b.players, null, null)),
  ];

  seasonState = {
    allTeams: teams,
    seasonPoints: initSeasonPoints(teams),
    playerWins: 0, playerLosses: 0, // akkumuliert über die ganze Saison (für startNextSeason())
    eventType: 'open',
    openIndex: 0,
    event: createOpenQualifier(teams),
    majorField: null,
    worldsField: null,
    seasonComplete: false,
    finalChampionId: null, // gesetzt, sobald ein WM-Champion feststeht
  };

  enterOpenBracketStage();
  renderTournamentScreen();
  showScreen('screen-tournament');
  saveGameState();
  if (!careerState.seasonGuideShown) showSeasonGuide();
}

// Setzt tournamentState für die (erste oder nächste) Doppel-K.O.-Runde des
// aktuellen Open Qualifiers auf.
// Alle "enter*Stage()"-Funktionen (hier und in advanceTournamentStage() weiter
// unten) setzen NUR den Zustand auf — Rendern/Speichern passiert zentral am
// Ende von advanceTournamentStage() bzw. explizit in startTournament().
function enterOpenBracketStage() {
  pairDoubleElimRound(seasonState.event.bracket, SWISS_BEST_OF);
  tournamentState = { stage: 'open-bracket', stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false };
}

const SWISS_ROUND_LABELS = ['', 'Runde 1 (0-0)', 'Runde 2', 'Runde 3', 'Runde 4', 'Runde 5 (Decider)'];

// Stufen ohne eigenes Match (reine Info-/Übergangsbildschirme zwischen zwei
// Events, z.B. "hast du dich fürs Major qualifiziert?") — stageMatchPlayed
// wird für diese Stufen sofort auf true gesetzt (siehe die jeweiligen
// enter*()-Funktionen), der Aktions-Button zeigt direkt "Weiter".
const INFO_STAGES = new Set(['open-complete', 'major-check', 'major-complete', 'worlds-check', 'lcq-complete']);

function seasonContextLabel() {
  const ss = seasonState;
  if (!ss) return '';
  if (ss.eventType === 'open') return 'Open Qualifier ' + (ss.openIndex + 1) + ' / 3';
  if (ss.eventType === 'major') return 'Major';
  if (ss.eventType === 'lcq') return 'Last Chance Qualifier';
  if (ss.eventType === 'worlds') return 'Weltmeisterschaft';
  return '';
}

function stageTitle(ts) {
  const s = ts.stage;
  if (s === 'open-bracket') return 'Open Qualifier — Doppel-K.O.-Bracket (Bo5)';
  if (s === 'open-swiss') return 'Open Qualifier — Swiss (' + (SWISS_ROUND_LABELS[ts.swissRoundNum] || ('Runde ' + ts.swissRoundNum)) + ', Bo5)';
  if (s === 'open-gsl') return 'Open Qualifier — GSL-Gruppen (Bo5)';
  if (s === 'open-playoff-semi') return 'Open Qualifier — Halbfinale (Bo7)';
  if (s === 'open-playoff-final') return 'Open Qualifier — Finale (Bo7)';
  if (s === 'open-complete') return 'Open Qualifier ' + (seasonState.openIndex + 1) + ' abgeschlossen';

  if (s === 'major-check') return 'Punkte-Auswertung nach den Opens';
  if (s === 'major-swiss') return 'Major — Swiss (' + (SWISS_ROUND_LABELS[ts.swissRoundNum] || ('Runde ' + ts.swissRoundNum)) + ', Bo5)';
  if (s === 'major-playoff-quarter') return 'Major — Viertelfinale (Bo7)';
  if (s === 'major-playoff-semi') return 'Major — Halbfinale (Bo7)';
  if (s === 'major-playoff-final') return 'Major — Finale (Bo7)';
  if (s === 'major-complete') return 'Major abgeschlossen';

  if (s === 'worlds-check') return 'Weltmeisterschaft-Qualifikation';
  if (s === 'lcq-quarter') return 'Last Chance Qualifier — Viertelfinale (Bo5)';
  if (s === 'lcq-semi') return 'Last Chance Qualifier — Halbfinale (Bo5)';
  if (s === 'lcq-complete') return 'Last Chance Qualifier abgeschlossen';

  if (s === 'worlds-gsl') return 'Weltmeisterschaft — GSL-Gruppen (Bo5)';
  if (s === 'worlds-playoff-quarter') return 'Weltmeisterschaft — Viertelfinale (Bo7)';
  if (s === 'worlds-playoff-semi') return 'Weltmeisterschaft — Halbfinale (Bo7)';
  if (s === 'worlds-playoff-final') return 'Weltmeisterschaft — Finale (Bo7)';
  return '';
}

function renderTournamentScreen() {
  const ts = tournamentState;
  const contextEl = document.getElementById('season-context');
  const titleEl = document.getElementById('tournament-title');
  const banner = document.getElementById('tournament-champion-banner');
  const actionBtn = document.getElementById('btn-tournament-action');
  const quickSimRoundBtn = document.getElementById('btn-quick-sim-round');
  const quickSimAllBtn = document.getElementById('btn-quick-sim-all');

  contextEl.textContent = ts.stage === 'season-complete' ? '' : seasonContextLabel();

  if (ts.stage === 'season-complete') {
    const wasChampion = seasonState.finalChampionId === 'player';
    const totalTitles = careerState.titlesWon + (wasChampion ? 1 : 0);
    titleEl.textContent = 'Saison ' + careerState.seasonNumber + ' beendet';
    banner.classList.remove('hidden');
    banner.textContent = ts.seasonSummary + ' — Titel gesamt: ' + totalTitles;
    actionBtn.textContent = 'Nächste Saison starten';
    quickSimRoundBtn.classList.add('hidden');
    quickSimAllBtn.classList.add('hidden');
  } else {
    banner.classList.add('hidden');
    let title = stageTitle(ts);
    if (ts.playerStatusNote) title += ' — ' + ts.playerStatusNote;
    titleEl.textContent = title;
    actionBtn.textContent = ts.stageMatchPlayed ? 'Weiter' : 'Match spielen';
    const isInfoStage = INFO_STAGES.has(ts.stage);
    quickSimRoundBtn.classList.toggle('hidden', ts.stageMatchPlayed || tournamentAutoSimRunning || isInfoStage);
    quickSimAllBtn.classList.toggle('hidden', tournamentAutoSimRunning);
  }

  actionBtn.disabled = tournamentAutoSimRunning;
  renderRivalryNote();
  renderPointsStanding();
  renderBracketForCurrentStage();
}

// ── Punktestand & Tabelle ─────────────────────────────────────────────────
function renderPointsStanding() {
  const el = document.getElementById('points-standing');
  if (!seasonState) { el.textContent = ''; return; }
  const ranked = rankTeamsByPoints(seasonState.allTeams, seasonState.seasonPoints);
  const rank = ranked.findIndex((t) => t.id === 'player') + 1;
  const points = seasonState.seasonPoints['player'] || 0;
  el.innerHTML = 'Dein Punktestand: <span class="points-standing-value">' + points + ' Punkte</span> — Rang ' + rank + ' von ' + ranked.length;
}

// Qualifikationsstatus eines Teams fürs Tabellen-Popup — bewusst nur an den
// PUNKTE-Cutoffs zwischen den Events festgemacht (Top16 fürs Major, Top12
// direkt zur WM, LCQ-Pool, LCQ-Ergebnis), NICHT am internen Bracket-Stand
// innerhalb eines einzelnen Events (Doppel-K.O./Swiss/GSL) — das würde für
// alle 31 Bot-Teams über 4 verschiedene Event-Strukturen hinweg getrackt
// werden müssen, für eine reine "wo stehe ich in der Saison"-Übersicht nicht
// nötig. 'green' = qualifiziert/durch, 'red' = an diesem Cutoff ausgeschieden,
// 'neutral' = noch offen/unentschieden.
function computeTeamSeasonStatus(team) {
  const ss = seasonState;
  if (ss.worldsDirect) {
    if (ss.worldsDirect.some((t) => t.id === team.id)) return 'green';
    const inLcqPool = ss.worldsLcqPool && ss.worldsLcqPool.some((t) => t.id === team.id);
    if (inLcqPool) {
      const lcqQualifiers = ss.eventType === 'lcq' ? ss.event.qualifiedForWorlds : ss.lcqQualifiersForBots;
      if (!lcqQualifiers) return 'neutral';
      return lcqQualifiers.some((t) => t.id === team.id) ? 'green' : 'red';
    }
    return 'red';
  }
  if (ss.majorField) {
    return ss.majorField.some((t) => t.id === team.id) ? 'green' : 'red';
  }
  // Noch mitten in den Opens — nichts ist final, zeigt nur die aktuelle
  // Top16-Projektion als Orientierung.
  const ranked = rankTeamsByPoints(ss.allTeams, ss.seasonPoints);
  const rank = ranked.findIndex((t) => t.id === team.id);
  return rank < MAJOR_SIZE ? 'green' : 'neutral';
}

function computeStandingsRows() {
  const ranked = rankTeamsByPoints(seasonState.allTeams, seasonState.seasonPoints);
  return ranked.map((team, i) => ({
    rank: i + 1,
    name: team.name,
    points: seasonState.seasonPoints[team.id] || 0,
    isPlayer: team.id === 'player',
    status: computeTeamSeasonStatus(team),
  }));
}

function showStandings() {
  document.getElementById('standings-context').textContent = seasonContextLabel();
  const rows = computeStandingsRows();
  document.getElementById('standings-list').innerHTML = rows.map((r) =>
    '<div class="standings-row standings-' + r.status + (r.isPlayer ? ' is-player' : '') + '">' +
      '<span class="standings-rank">#' + r.rank + '</span>' +
      '<span class="standings-name">' + escapeXml(r.name) + '</span>' +
      '<span class="standings-points">' + r.points + ' Pkt</span>' +
      '<span class="standings-status-dot"></span>' +
    '</div>'
  ).join('');
  document.getElementById('standings-modal').classList.remove('hidden');
}

function hideStandings() {
  document.getElementById('standings-modal').classList.add('hidden');
}

// Zeigt die Kopf-an-Kopf-Bilanz gegen den aktuellen Gegner, falls es schon eine
// gibt (frühere Saison oder frühere Runde derselben Karriere) — sonst nichts,
// damit ein "0:0"-Hinweis beim allerersten Aufeinandertreffen nicht nur Rauschen ist.
function renderRivalryNote() {
  const ts = tournamentState;
  const noteEl = document.getElementById('rivalry-note');
  const playerMatch = ts.stage === 'season-complete' ? null : findPlayerMatch();
  if (!playerMatch) { noteEl.classList.add('hidden'); return; }

  const opponentId = playerMatch.aId === 'player' ? playerMatch.bId : playerMatch.aId;
  const opponent = findTournamentTeam(opponentId);
  const record = careerRivalRecords[opponent.name];
  if (!record || record.wins + record.losses === 0) { noteEl.classList.add('hidden'); return; }

  noteEl.classList.remove('hidden');
  noteEl.textContent = '⚔ Bisherige Bilanz gegen ' + opponent.name + ': ' + record.wins + ' Siege, ' + record.losses + ' Niederlagen';
}

function onTournamentActionClick() {
  const ts = tournamentState;

  if (ts.stage === 'season-complete') {
    startNextSeason();
    return;
  }

  if (!ts.stageMatchPlayed) {
    const playerMatch = findPlayerMatch();
    const stageMatches = getCurrentStageMatches();

    if (!playerMatch) {
      // Spieler ist ausgeschieden ODER schon qualifiziert und wartet — die gesamte
      // Stufe läuft ohne Ticker durch, er sieht nur die Ergebnisse.
      stageMatches.forEach((m) => simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch));
      ts.stageMatchPlayed = true;
      renderTournamentScreen();
      saveGameState();
      return;
    }

    // Alle Bot-vs-Bot-Serien dieser Stufe sofort simulieren (kein Ticker nötig)
    stageMatches.forEach((m) => {
      if (m === playerMatch) return;
      simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch);
    });

    const playerIsA = playerMatch.aId === 'player';
    const opponent = findTournamentTeam(playerIsA ? playerMatch.bId : playerMatch.aId);
    playNextSeriesGame(playerMatch, opponent, playerIsA);
    return;
  }

  advanceTournamentStage();
}

// "Runde schnell simulieren"-Button: simuliert ALLE Serien der aktuellen Stufe
// sofort ohne Ticker — auch die des Spielers. Wie der bestehende "Spieler ist
// nicht mehr dabei"-Zweig in onTournamentActionClick(), aber bewusst als
// Alternative zum normalen "Match spielen" wählbar, nicht nur als Fallback.
// Trägt das Ergebnis einer entschiedenen Serie in die Rivalen-Bilanz ein, falls
// der Spieler daran beteiligt war (Bot-vs-Bot-Serien werden nicht getrackt).
function recordRivalResultIfPlayerMatch(match) {
  if (!match || (match.aId !== 'player' && match.bId !== 'player')) return;
  const opponentId = match.aId === 'player' ? match.bId : match.aId;
  const opponent = findTournamentTeam(opponentId);
  const playerWon = (match.aId === 'player' && match.scoreA > match.scoreB)
    || (match.bId === 'player' && match.scoreB > match.scoreA);
  if (!careerRivalRecords[opponent.name]) careerRivalRecords[opponent.name] = { wins: 0, losses: 0 };
  if (playerWon) careerRivalRecords[opponent.name].wins += 1;
  else careerRivalRecords[opponent.name].losses += 1;
}

function quickSimulateCurrentRound() {
  const ts = tournamentState;
  if (ts.stage === 'season-complete' || ts.stageMatchPlayed) return;
  const stageMatches = getCurrentStageMatches();
  stageMatches.forEach((m) => simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch));
  recordRivalResultIfPlayerMatch(stageMatches.find((m) => m.aId === 'player' || m.bId === 'player'));
  ts.stageMatchPlayed = true;
  renderTournamentScreen();
  saveGameState();
}

// "Turnier sofort simulieren"-Button: simuliert das GESAMTE restliche Turnier
// (alle verbleibenden Stufen bis Champion) ohne einen einzigen Ticker — dafür
// wird das Bracket stufenweise mit kurzer Pause dazwischen neu gezeichnet, statt
// in einem Sprung zum Endstand — fühlt sich wie eine Turnier-Auflösungs-
// Animation an (ähnlich wie bei draftrlcs.app), nicht wie ein abrupter Cut.
async function quickSimulateEntireTournament() {
  if (tournamentState.stage === 'season-complete' || tournamentAutoSimRunning) return;

  tournamentAutoSimRunning = true;
  renderTournamentScreen();

  while (tournamentState.stage !== 'season-complete') {
    const ts = tournamentState;
    if (!ts.stageMatchPlayed) {
      const stageMatches = getCurrentStageMatches();
      stageMatches.forEach((m) => simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch));
      recordRivalResultIfPlayerMatch(stageMatches.find((m) => m.aId === 'player' || m.bId === 'player'));
      ts.stageMatchPlayed = true;
      renderTournamentScreen();
      await sleep(quickSimPaceMs());
    }
    advanceTournamentStage(); // rendert + speichert bereits selbst
    if (tournamentState.stage !== 'season-complete') await sleep(quickSimPaceMs());
  }

  tournamentAutoSimRunning = false;
  renderTournamentScreen();
}

// Spielt EIN Einzelspiel innerhalb der aktuellen Bo5/Bo7-Serie des Spielers.
// Ist die Serie danach noch nicht entschieden, führt der "Weiter"-Button auf
// dem Match-Screen direkt ins nächste Einzelspiel derselben Serie (statt
// zurück zum Turnier-Screen) — der Spieler bleibt also auf dem Match-Screen,
// bis die Serie entschieden ist.
// Leitet aus einem Serien-Einzelspiel das Ergebnis AUS SICHT DES SPIELERS ab
// ('win'/'loss') — die goalsA/goalsB in match.games beziehen sich immer auf
// match.aId/match.bId, nicht auf "Spieler"/"Gegner".
function gameResultFromPlayerPerspective(game, playerIsA) {
  const playerGoals = playerIsA ? game.goalsA : game.goalsB;
  const oppGoals = playerIsA ? game.goalsB : game.goalsA;
  return playerGoals > oppGoals ? 'win' : 'loss';
}

function playNextSeriesGame(match, opponent, playerIsA) {
  const ts = tournamentState;
  const playerTeam = findTournamentTeam('player');
  const preGameWinsA = match.seriesWinsA;
  const preGameWinsB = match.seriesWinsB;
  const gameNumber = match.games.length + 1;
  // Ergebnisse der BEREITS gespielten Spiele dieser Serie — vor recordSeriesGame()
  // erfasst, damit das gerade laufende Spiel hier noch nicht enthalten ist.
  const priorResults = match.games.map((g) => gameResultFromPlayerPerspective(g, playerIsA));

  const result = simulateMatch(
    playerTeam.players, opponent.players, playerTeam.name, opponent.name,
    { sub: playerTeam.sub, coach: playerTeam.coach, orgMatchBonusPct: assignedOrg.matchBonusPct + computeCharacterEffects(careerCharacter.traits).matchBonusPct }
  );

  // result.scoreA/-B beziehen sich immer auf "playerTeam vs. opponent" (so wurde
  // simulateMatch aufgerufen) — für die Serie (aId/bId) muss das je nach
  // playerIsA in der richtigen Reihenfolge eingetragen werden.
  const goalsA = playerIsA ? result.scoreA : result.scoreB;
  const goalsB = playerIsA ? result.scoreB : result.scoreA;
  recordSeriesGame(seasonState.allTeams, match, goalsA, goalsB);
  const pendingResult = gameResultFromPlayerPerspective(match.games[match.games.length - 1], playerIsA);

  const seriesDone = match.played;
  if (seriesDone) {
    ts.stageMatchPlayed = true;
    recordRivalResultIfPlayerMatch(match);
  }
  saveGameState();

  const playerSeriesWins = playerIsA ? match.seriesWinsA : match.seriesWinsB;
  const opponentSeriesWins = playerIsA ? match.seriesWinsB : match.seriesWinsA;

  playMatchTicker(
    result, playerTeam.name, opponent.name, playerTeam.players, opponent.players,
    playerTeam.coach, playerTeam.sub,
    () => {
      if (seriesDone) { showScreen('screen-tournament'); renderTournamentScreen(); }
      else { playNextSeriesGame(match, opponent, playerIsA); }
    },
    {
      bestOf: match.bestOf, gameNumber,
      preGameWinsA: playerIsA ? preGameWinsA : preGameWinsB,
      preGameWinsB: playerIsA ? preGameWinsB : preGameWinsA,
      finalWinsA: playerSeriesWins, finalWinsB: opponentSeriesWins,
      seriesDone, priorResults, pendingResult,
      continueLabel: seriesDone ? 'Weiter zum Turnier' : 'Nächstes Spiel (Serie ' + playerSeriesWins + ':' + opponentSeriesWins + ')',
    }
  );
}

// ── Enter*-Funktionen: setzen NUR tournamentState/seasonState auf (kein
// Rendern/Speichern — das passiert zentral am Ende von advanceTournamentStage()).

function enterOpenSwissStage() {
  const open = seasonState.event;
  tournamentState = { stage: 'open-swiss', engine: open.swiss, swissRoundNum: 1, stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false };
}

function enterOpenGslStage() {
  tournamentState = { stage: 'open-gsl', stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false };
}

function enterOpenPlayoffSemiStage() {
  const open = seasonState.event;
  tournamentState = {
    stage: 'open-playoff-semi',
    playoffMatches: { qf1: null, qf2: null, qf3: null, qf4: null, sf1: open.playoffs.sf1, sf2: open.playoffs.sf2, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterOpenPlayoffFinalStage() {
  const open = seasonState.event;
  tournamentState = {
    stage: 'open-playoff-final',
    playoffMatches: { qf1: null, qf2: null, qf3: null, qf4: null, sf1: open.playoffs.sf1, sf2: open.playoffs.sf2, final: open.playoffs.final },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function buildInfoHtml(heading, lines) {
  return '<h2>' + heading + '</h2>' + lines.map((l) => '<div class="season-info-line">' + l + '</div>').join('');
}

function enterOpenCompleteStage() {
  const open = seasonState.event;
  const player = findTournamentTeam('player');
  const playerPoints = seasonState.seasonPoints['player'] || 0;
  const lines = [
    '🏆 Champion: <span class="season-info-highlight">' + open.champion.name + '</span>',
    'Dein Ergebnis: ' + (open.placements['player'] || '?') + ' (' + player.wins + '-' + player.losses + ')',
    'Deine Punkte aus diesem Open: <span class="season-info-highlight">' + (OPEN_POINTS[open.placements['player']] || 0) + '</span>',
    'Gesamtpunkte bisher: <span class="season-info-highlight">' + playerPoints + '</span>',
  ];
  tournamentState = {
    stage: 'open-complete', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false,
    infoHtml: buildInfoHtml('Open Qualifier ' + (seasonState.openIndex + 1) + ' abgeschlossen', lines),
  };
}

function enterMajorCheckStage() {
  const ranked = rankTeamsByPoints(seasonState.allTeams, seasonState.seasonPoints);
  seasonState.majorField = ranked.slice(0, MAJOR_SIZE);
  const qualified = seasonState.majorField.some((t) => t.id === 'player');
  const rank = ranked.findIndex((t) => t.id === 'player') + 1;
  const lines = qualified
    ? ['Du hast Rang ' + rank + ' erreicht — <span class="season-info-highlight">fürs Major qualifiziert!</span>']
    : ['Du hast Rang ' + rank + ' erreicht — das reicht knapp nicht fürs Major (Top ' + MAJOR_SIZE + ').',
       'Deine Saison endet hier.'];
  tournamentState = { stage: 'major-check', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false, majorQualified: qualified, infoHtml: buildInfoHtml('Punkte-Auswertung nach den Opens', lines) };
}

function enterMajorSwissStage() {
  resetTeamRecords(seasonState.majorField);
  seasonState.eventType = 'major';
  seasonState.event = createMajor(seasonState.majorField);
  pairRound(seasonState.event.swiss, 1, SWISS_BEST_OF);
  tournamentState = { stage: 'major-swiss', engine: seasonState.event.swiss, swissRoundNum: 1, stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false };
}

function enterMajorPlayoffQuarterStage() {
  const major = seasonState.event;
  tournamentState = {
    stage: 'major-playoff-quarter',
    playoffMatches: { qf1: major.playoffs.qf1, qf2: major.playoffs.qf2, qf3: major.playoffs.qf3, qf4: major.playoffs.qf4, sf1: null, sf2: null, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterMajorPlayoffSemiStage() {
  const major = seasonState.event;
  tournamentState = {
    stage: 'major-playoff-semi',
    playoffMatches: { qf1: major.playoffs.qf1, qf2: major.playoffs.qf2, qf3: major.playoffs.qf3, qf4: major.playoffs.qf4, sf1: major.playoffs.sf1, sf2: major.playoffs.sf2, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterMajorPlayoffFinalStage() {
  const major = seasonState.event;
  tournamentState = {
    stage: 'major-playoff-final',
    playoffMatches: { qf1: major.playoffs.qf1, qf2: major.playoffs.qf2, qf3: major.playoffs.qf3, qf4: major.playoffs.qf4, sf1: major.playoffs.sf1, sf2: major.playoffs.sf2, final: major.playoffs.final },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterMajorCompleteStage() {
  const major = seasonState.event;
  const player = findTournamentTeam('player');
  const lines = [
    '🏆 Major-Champion: <span class="season-info-highlight">' + major.champion.name + '</span>',
    'Dein Ergebnis: ' + (major.placements['player'] || '?') + ' (' + player.wins + '-' + player.losses + ')',
    'Gesamtpunkte (Opens + Major): <span class="season-info-highlight">' + (seasonState.seasonPoints['player'] || 0) + '</span>',
  ];
  tournamentState = { stage: 'major-complete', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false, infoHtml: buildInfoHtml('Major abgeschlossen', lines) };
}

function enterWorldsCheckStage() {
  const rankedForWorlds = rankTeamsByPoints(seasonState.majorField, seasonState.seasonPoints);
  const { direct, lcqPool } = determineWorldsQualification(rankedForWorlds);
  seasonState.worldsDirect = direct;
  seasonState.worldsLcqPool = lcqPool;
  const isDirect = direct.some((t) => t.id === 'player');
  const isLcq = lcqPool.some((t) => t.id === 'player');
  let lines, qualification;
  if (isDirect) {
    qualification = 'direct';
    lines = ['<span class="season-info-highlight">Direkt für die Weltmeisterschaft qualifiziert!</span> (Top ' + WORLDS_DIRECT_QUALIFIERS + ' der Saison-Punkte)'];
  } else if (isLcq) {
    qualification = 'lcq';
    lines = ['Knapp verpasst — aber du bekommst eine letzte Chance im <span class="season-info-highlight">Last Chance Qualifier</span>.'];
  } else {
    qualification = 'none';
    lines = ['Deine Saison-Punkte reichen nicht für die Weltmeisterschaft oder den Last Chance Qualifier.', 'Deine Saison endet hier.'];
  }
  tournamentState = { stage: 'worlds-check', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false, worldsQualification: qualification, infoHtml: buildInfoHtml('Weltmeisterschaft-Qualifikation', lines) };
}

function enterLcqQuarterStage() {
  const lcqField = buildLcqField(seasonState.allTeams, seasonState.majorField, seasonState.worldsLcqPool, seasonState.seasonPoints);
  resetTeamRecords(lcqField);
  seasonState.eventType = 'lcq';
  seasonState.event = createLastChanceQualifier(lcqField);
  tournamentState = {
    stage: 'lcq-quarter',
    playoffMatches: { qf1: seasonState.event.bracket.qf1, qf2: seasonState.event.bracket.qf2, qf3: seasonState.event.bracket.qf3, qf4: seasonState.event.bracket.qf4, sf1: null, sf2: null, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterLcqSemiStage() {
  const lcq = seasonState.event;
  tournamentState = {
    stage: 'lcq-semi',
    playoffMatches: { qf1: lcq.bracket.qf1, qf2: lcq.bracket.qf2, qf3: lcq.bracket.qf3, qf4: lcq.bracket.qf4, sf1: lcq.bracket.sf1, sf2: lcq.bracket.sf2, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterLcqCompleteStage() {
  const lcq = seasonState.event;
  const madeIt = lcq.qualifiedForWorlds.some((t) => t.id === 'player');
  const lines = madeIt
    ? ['<span class="season-info-highlight">Geschafft!</span> Du hast dich über den Last Chance Qualifier für die Weltmeisterschaft qualifiziert.']
    : ['Knapp gescheitert — der Last Chance Qualifier war deine letzte Chance.', 'Deine Saison endet hier.'];
  tournamentState = { stage: 'lcq-complete', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false, lcqQualified: madeIt, infoHtml: buildInfoHtml('Last Chance Qualifier abgeschlossen', lines) };
}

// Ist der Spieler direkt qualifiziert (nicht Teil des LCQ), muss der LCQ
// trotzdem gespielt werden — er entscheidet die letzten 4 der 16 WM-Plätze,
// unabhängig davon, ob der Spieler selbst daran teilnimmt. Da diese Bots-only-
// Austragung für den Spieler nicht sichtbar/interaktiv ist, wird sie hier
// sofort (ohne Ticker) komplett durchsimuliert.
function autoSimulateLcqForBots(lcqField) {
  resetTeamRecords(lcqField);
  const lcq = createLastChanceQualifier(lcqField);
  [lcq.bracket.qf1, lcq.bracket.qf2, lcq.bracket.qf3, lcq.bracket.qf4].forEach((m) => simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch));
  finalizeLcqQuarterfinals(lcq);
  [lcq.bracket.sf1, lcq.bracket.sf2].forEach((m) => simulateFullSeriesInstant(seasonState.allTeams, m, simulateMatch));
  finalizeLcqSemifinals(lcq);
  return lcq.qualifiedForWorlds;
}

function enterWorldsGslStage() {
  const lcqQualifiers = seasonState.eventType === 'lcq' ? seasonState.event.qualifiedForWorlds : seasonState.lcqQualifiersForBots;
  const worldsField = [...seasonState.worldsDirect, ...lcqQualifiers];
  seasonState.worldsField = worldsField;
  resetTeamRecords(worldsField);
  seasonState.eventType = 'worlds';
  seasonState.event = createWorldsGslStage(worldsField);
  tournamentState = { stage: 'worlds-gsl', stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false };
}

function enterWorldsPlayoffQuarterStage() {
  const worlds = seasonState.event;
  tournamentState = {
    stage: 'worlds-playoff-quarter',
    playoffMatches: { qf1: worlds.playoffs.qf1, qf2: worlds.playoffs.qf2, qf3: worlds.playoffs.qf3, qf4: worlds.playoffs.qf4, sf1: null, sf2: null, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterWorldsPlayoffSemiStage() {
  const worlds = seasonState.event;
  tournamentState = {
    stage: 'worlds-playoff-semi',
    playoffMatches: { qf1: worlds.playoffs.qf1, qf2: worlds.playoffs.qf2, qf3: worlds.playoffs.qf3, qf4: worlds.playoffs.qf4, sf1: worlds.playoffs.sf1, sf2: worlds.playoffs.sf2, final: null },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

function enterWorldsPlayoffFinalStage() {
  const worlds = seasonState.event;
  tournamentState = {
    stage: 'worlds-playoff-final',
    playoffMatches: { qf1: worlds.playoffs.qf1, qf2: worlds.playoffs.qf2, qf3: worlds.playoffs.qf3, qf4: worlds.playoffs.qf4, sf1: worlds.playoffs.sf1, sf2: worlds.playoffs.sf2, final: worlds.playoffs.final },
    stageMatchPlayed: false, playerStatusNote: null, playerEliminated: false,
  };
}

// Beendet die Saison — egal ob nach einem verpassten Cut oder nach der
// Weltmeisterschaft. `summary` ist der Text für das Champion-Banner.
function enterSeasonCompleteStage(summary, championId) {
  seasonState.finalChampionId = championId || null;
  seasonState.seasonComplete = true;
  tournamentState = { stage: 'season-complete', stageMatchPlayed: true, playerStatusNote: null, playerEliminated: false, seasonSummary: summary };
}

function advanceTournamentStage() {
  const ts = tournamentState;
  const open = seasonState.eventType === 'open' ? seasonState.event : null;

  if (ts.stage === 'open-bracket') {
    advanceDoubleElimRound(open.bracket);
    if (finalizeDoubleElimCutoff(open.bracket, OPEN_BRACKET_CUTOFF)) {
      finalizeOpenBracketStage(open);
      pairRound(open.swiss, 1, SWISS_BEST_OF);
      enterOpenSwissStage();
      if (open.bracket.eliminated.some((t) => t.id === 'player')) tournamentState.playerEliminated = true;
    } else {
      pairDoubleElimRound(open.bracket, SWISS_BEST_OF);
      tournamentState.stageMatchPlayed = false;
    }
  } else if (ts.stage === 'open-swiss') {
    advanceRound(open.swiss, ts.swissRoundNum);
    if (isSwissComplete(open.swiss, OPEN_BRACKET_CUTOFF)) {
      finalizeOpenSwissStage(open);
      enterOpenGslStage();
      if (open.swiss.eliminated.some((t) => t.id === 'player')) tournamentState.playerEliminated = true;
    } else {
      const nextRound = ts.swissRoundNum + 1;
      pairRound(open.swiss, nextRound, SWISS_BEST_OF);
      ts.swissRoundNum = nextRound;
      ts.stageMatchPlayed = false;
    }
  } else if (ts.stage === 'open-gsl') {
    open.gslGroups.forEach((g) => advanceGslGroup(seasonState.allTeams, g));
    if (open.gslGroups.every(isGslGroupComplete)) {
      const playerWasInGsl = open.gslGroups.some((g) => g.teams.some((t) => t.id === 'player'));
      finalizeOpenGslStage(open);
      enterOpenPlayoffSemiStage();
      const stillIn = open.playoffs.sf1.aId === 'player' || open.playoffs.sf1.bId === 'player' ||
        open.playoffs.sf2.aId === 'player' || open.playoffs.sf2.bId === 'player';
      if (playerWasInGsl && !stillIn) tournamentState.playerEliminated = true;
    } else {
      tournamentState.stageMatchPlayed = false;
    }
  } else if (ts.stage === 'open-playoff-semi') {
    const wasIn = ts.playoffMatches.sf1.aId === 'player' || ts.playoffMatches.sf1.bId === 'player' ||
      ts.playoffMatches.sf2.aId === 'player' || ts.playoffMatches.sf2.bId === 'player';
    finalizeOpenPlayoffStage(open);
    enterOpenPlayoffFinalStage();
    const stillIn = open.playoffs.final.aId === 'player' || open.playoffs.final.bId === 'player';
    if (wasIn && !stillIn) tournamentState.playerEliminated = true;
  } else if (ts.stage === 'open-playoff-final') {
    finalizeOpenChampion(open);
    awardOpenPlacementPoints(open, seasonState.seasonPoints);
    accumulatePlayerRecord();
    enterOpenCompleteStage();
  } else if (ts.stage === 'open-complete') {
    if (seasonState.openIndex < 2) {
      seasonState.openIndex += 1;
      resetTeamRecords(seasonState.allTeams);
      seasonState.event = createOpenQualifier(seasonState.allTeams);
      enterOpenBracketStage();
    } else {
      enterMajorCheckStage();
    }
  } else if (ts.stage === 'major-check') {
    if (ts.majorQualified) enterMajorSwissStage();
    else enterSeasonCompleteStage('Saison beendet — nicht fürs Major qualifiziert.', null);
  } else if (ts.stage === 'major-swiss') {
    const major = seasonState.event;
    advanceRound(major.swiss, ts.swissRoundNum);
    if (isSwissComplete(major.swiss, MAJOR_SIZE)) {
      finalizeMajorSwissStage(major);
      enterMajorPlayoffQuarterStage();
      if (major.swiss.eliminated.some((t) => t.id === 'player')) tournamentState.playerEliminated = true;
    } else {
      const nextRound = ts.swissRoundNum + 1;
      pairRound(major.swiss, nextRound, SWISS_BEST_OF);
      ts.swissRoundNum = nextRound;
      ts.stageMatchPlayed = false;
    }
  } else if (ts.stage === 'major-playoff-quarter') {
    const major = seasonState.event;
    const wasIn = [ts.playoffMatches.qf1, ts.playoffMatches.qf2, ts.playoffMatches.qf3, ts.playoffMatches.qf4]
      .some((m) => m.aId === 'player' || m.bId === 'player');
    finalizeMajorQuarterfinals(major);
    enterMajorPlayoffSemiStage();
    const stillIn = major.playoffs.sf1.aId === 'player' || major.playoffs.sf1.bId === 'player' ||
      major.playoffs.sf2.aId === 'player' || major.playoffs.sf2.bId === 'player';
    if (wasIn && !stillIn) tournamentState.playerEliminated = true;
  } else if (ts.stage === 'major-playoff-semi') {
    const major = seasonState.event;
    const wasIn = ts.playoffMatches.sf1.aId === 'player' || ts.playoffMatches.sf1.bId === 'player' ||
      ts.playoffMatches.sf2.aId === 'player' || ts.playoffMatches.sf2.bId === 'player';
    finalizeMajorSemifinals(major);
    enterMajorPlayoffFinalStage();
    const stillIn = major.playoffs.final.aId === 'player' || major.playoffs.final.bId === 'player';
    if (wasIn && !stillIn) tournamentState.playerEliminated = true;
  } else if (ts.stage === 'major-playoff-final') {
    const major = seasonState.event;
    finalizeMajorChampion(major);
    awardMajorPlacementPoints(major, seasonState.seasonPoints);
    accumulatePlayerRecord();
    enterMajorCompleteStage();
  } else if (ts.stage === 'major-complete') {
    enterWorldsCheckStage();
  } else if (ts.stage === 'worlds-check') {
    if (ts.worldsQualification === 'direct') {
      const lcqField = buildLcqField(seasonState.allTeams, seasonState.majorField, seasonState.worldsLcqPool, seasonState.seasonPoints);
      seasonState.lcqQualifiersForBots = autoSimulateLcqForBots(lcqField);
      enterWorldsGslStage();
    }
    else if (ts.worldsQualification === 'lcq') enterLcqQuarterStage();
    else enterSeasonCompleteStage('Saison beendet — nicht für die WM qualifiziert.', null);
  } else if (ts.stage === 'lcq-quarter') {
    const lcq = seasonState.event;
    finalizeLcqQuarterfinals(lcq);
    enterLcqSemiStage();
  } else if (ts.stage === 'lcq-semi') {
    const lcq = seasonState.event;
    const wasIn = ts.playoffMatches.sf1.aId === 'player' || ts.playoffMatches.sf1.bId === 'player' ||
      ts.playoffMatches.sf2.aId === 'player' || ts.playoffMatches.sf2.bId === 'player';
    finalizeLcqSemifinals(lcq);
    accumulatePlayerRecord();
    const madeIt = lcq.qualifiedForWorlds.some((t) => t.id === 'player');
    if (wasIn && !madeIt) tournamentState.playerEliminated = true;
    enterLcqCompleteStage();
  } else if (ts.stage === 'lcq-complete') {
    if (ts.lcqQualified) enterWorldsGslStage();
    else enterSeasonCompleteStage('Saison beendet — im Last Chance Qualifier gescheitert.', null);
  } else if (ts.stage === 'worlds-gsl') {
    const worlds = seasonState.event;
    worlds.groups.forEach((g) => advanceGslGroup(seasonState.allTeams, g));
    if (worlds.groups.every(isGslGroupComplete)) {
      const wasIn = worlds.groups.some((g) => g.teams.some((t) => t.id === 'player'));
      finalizeWorldsGslStage(worlds);
      enterWorldsPlayoffQuarterStage();
      const stillIn = [worlds.playoffs.qf1, worlds.playoffs.qf2, worlds.playoffs.qf3, worlds.playoffs.qf4]
        .some((m) => m.aId === 'player' || m.bId === 'player');
      if (wasIn && !stillIn) tournamentState.playerEliminated = true;
    } else {
      tournamentState.stageMatchPlayed = false;
    }
  } else if (ts.stage === 'worlds-playoff-quarter') {
    const worlds = seasonState.event;
    const wasIn = [ts.playoffMatches.qf1, ts.playoffMatches.qf2, ts.playoffMatches.qf3, ts.playoffMatches.qf4]
      .some((m) => m.aId === 'player' || m.bId === 'player');
    finalizeWorldsQuarterfinals(worlds);
    enterWorldsPlayoffSemiStage();
    const stillIn = worlds.playoffs.sf1.aId === 'player' || worlds.playoffs.sf1.bId === 'player' ||
      worlds.playoffs.sf2.aId === 'player' || worlds.playoffs.sf2.bId === 'player';
    if (wasIn && !stillIn) tournamentState.playerEliminated = true;
  } else if (ts.stage === 'worlds-playoff-semi') {
    const worlds = seasonState.event;
    const wasIn = ts.playoffMatches.sf1.aId === 'player' || ts.playoffMatches.sf1.bId === 'player' ||
      ts.playoffMatches.sf2.aId === 'player' || ts.playoffMatches.sf2.bId === 'player';
    finalizeWorldsSemifinals(worlds);
    enterWorldsPlayoffFinalStage();
    const stillIn = worlds.playoffs.final.aId === 'player' || worlds.playoffs.final.bId === 'player';
    if (wasIn && !stillIn) tournamentState.playerEliminated = true;
  } else if (ts.stage === 'worlds-playoff-final') {
    const worlds = seasonState.event;
    finalizeWorldsChampion(worlds);
    accumulatePlayerRecord();
    const wasChampion = worlds.champion.id === 'player';
    enterSeasonCompleteStage(
      '🏆 ' + worlds.champion.name + ' ist Weltmeister!' + (wasChampion ? ' (das bist du!)' : ''),
      worlds.champion.id
    );
  }

  // Status-Hinweis wird IMMER frisch abgeleitet (nicht nur beim Übergang selbst
  // gesetzt) — sonst geht die "ausgeschieden"-Meldung in einer späteren Stufe
  // verloren, in der der Spieler ohnehin nicht mehr mitspielt.
  if (tournamentState.stage !== 'season-complete' && !INFO_STAGES.has(tournamentState.stage)) {
    const player = findTournamentTeam('player');
    const inCurrentStage = getCurrentStageMatches().some((m) => m.aId === 'player' || m.bId === 'player');
    if (inCurrentStage) {
      tournamentState.playerStatusNote = null;
    } else if (tournamentState.playerEliminated) {
      tournamentState.playerStatusNote = 'du bist ausgeschieden (' + player.wins + '-' + player.losses + ') — die Stufe läuft weiter';
    } else {
      tournamentState.playerStatusNote = 'du bist qualifiziert (' + player.wins + '-' + player.losses + ') — wartest auf die nächste Runde';
    }
  }

  renderTournamentScreen();
  saveGameState();
}

// Addiert den aktuellen Win/Loss-Stand des Spieler-Teams auf die Saison-
// Gesamtbilanz (für startNextSeason()'s performanceFactor) — wird aufgerufen,
// BEVOR die Team-Records für das nächste Event zurückgesetzt werden.
function accumulatePlayerRecord() {
  const player = findTournamentTeam('player');
  seasonState.playerWins += player.wins;
  seasonState.playerLosses += player.losses;
  // Karriere-weite Summe (existierte vorher nicht, siehe Recherche-Runde vor
  // Runde 39) -- einzig für "careerWins"-Sponsoring-Ziele ergänzt, ändert
  // sonst nichts an der bestehenden Saison-Logik.
  careerTotalWins += player.wins;
  careerTotalLosses += player.losses;
}

// ── Saison-Ende: Spieler-Entwicklung + Upgrade-Budget + nächste Saison ──────
// "Kader bleibt, aber Budget für Upgrades" (User-Entscheidung): der Kader wird
// NICHT zurückgesetzt, sondern entwickelt sich leicht weiter (Drift abhängig von
// der Saison-Erfolgsquote), und der Nutzer bekommt neues Budget, um am
// Draft-Screen (wiederverwendet als Upgrade-Screen) Spieler auszutauschen.
const DEV_STAT_MIN = 50;
const DEV_STAT_MAX = 99;

function developPlayer(p, performanceFactor) {
  const developed = { ...p };
  const charEffects = computeCharacterEffects(careerCharacter.traits);
  STAT_LABELS.forEach(([key]) => {
    const drift = Math.round((Math.random() * 6 - 2.5) + performanceFactor * 4) + charEffects.developmentBonus;
    developed[key] = Math.max(DEV_STAT_MIN, Math.min(DEV_STAT_MAX, p[key] + drift));
  });
  developed.overall = Math.round(STAT_LABELS.reduce((sum, [key]) => sum + developed[key], 0) / STAT_LABELS.length);
  return developed;
}

function developCoach(c, performanceFactor) {
  const developed = { ...c };
  COACH_STAT_LABELS.forEach(([key]) => {
    const drift = Math.round((Math.random() * 4 - 1.5) + performanceFactor * 3);
    developed[key] = Math.max(DEV_STAT_MIN, Math.min(DEV_STAT_MAX, c[key] + drift));
  });
  developed.overall = Math.round(COACH_STAT_LABELS.reduce((sum, [key]) => sum + developed[key], 0) / COACH_STAT_LABELS.length);
  return developed;
}

function calculateSeasonIncome(playerTeam, wasChampion) {
  const winRatio = playerTeam.wins / Math.max(1, playerTeam.wins + playerTeam.losses);
  let income = 250000 + Math.round(winRatio * 400) * 1000;
  if (wasChampion) income += 500000;
  const charEffects = computeCharacterEffects(careerCharacter.traits);
  income += charEffects.seasonIncomeBonus;
  return income;
}

// Vertragsklausel "CEO kann entlassen werden" (siehe confirmOrgAndProceed()) --
// zwei Saisons in Folge mit mehr Niederlagen als Siegen (performanceFactor < 0.5)
// beenden die Karriere. Bewusst einfache, transparente Regel statt komplexer
// Vorstands-/Zufriedenheits-Simulation, die es hier nicht gibt.
const CEO_FIRE_AFTER_POOR_SEASONS = 2;

function renderGameOverScreen() {
  document.getElementById('gameover-reason').textContent =
    'Zwei Saisons in Folge mehr Niederlagen als Siege — der Vorstand von ' + assignedOrg.name + ' hat dich als Geschäftsführer abgesetzt.';
  document.getElementById('gameover-summary').textContent =
    'Überstandene Saisons: ' + careerState.seasonNumber + ' — Titel gewonnen: ' + careerState.titlesWon;
  showScreen('screen-gameover');
}

function triggerCeoFired() {
  careerEnded = true;
  stopPlaytimeTracking();
  saveGameState();
  renderGameOverScreen();
}

// Runde 102, Refactor: die rein saisongebundene Buchhaltung des NEUEN,
// kalendergetriebenen Dashboard-Systems (Punkte/Ergebnisse/Qualifikation/
// Anmeldungen/Reveal-Merker/Skip-Banner) -- vorher inline in startNextSeason()
// (dem Trigger des ALTEN, separaten tournament.js/season.js-Systems),
// jetzt ausgelagert, damit AUCH checkSeasonRolloverIfDue() (neuer,
// kalenderbasierter Trigger weiter unten) sie nutzen kann, ohne die alte,
// hier bewusst NICHT angefasste Kader-Entwicklung/Budget-Neuberechnung
// mitzuziehen (die gehört exklusiv zum alten System, s. startNextSeason()).
// KEINE Kader-/Budget-Änderung hier -- User-Vorgabe (Runde 102): Kader/Budget
// bleiben immer stabil, außer bei echten Transfers im offenen Transferfenster.
function resetSeasonScopedDashboardState() {
  careerState.seasonNumber += 1;
  seasonPoints = {}; // Runde 82: Saison-Leaderboard startet jede Saison wieder bei 0
  seasonTournamentResults = {}; // Runde 85: neue Saison, neue Turnier-Endstände
  // Runde 92: neue Saison -> neuer Open Qualifier im Januar -> neues 32er-Feld
  // pro Region. openQualifierRegistrations muss hier ebenfalls zurück, sonst
  // würde eine Anmeldung aus der VORHERIGEN Saison (gleicher Event-Key, z.B.
  // "open1") fälschlich automatisch weitergelten -- vorher unbemerkt, weil
  // die Anmeldung für Open 1-6 laut openRegistrationStatus() ohnehin komplett
  // gesperrt war (nur open0 ging); durch die neue Qualifikations-Logik dieser
  // Runde ist das jetzt ein echter, sichtbarer Fall.
  seasonQualifiedTeams = {};
  openQualifierRegistrations = {};
  shownOwnMatchSteps = {}; // Runde 98: neue Saison, neue Event-Keys -- alte Merker sind ohnehin hinfällig, aber sauber zurücksetzen
  cascadeRevealedSteps = {}; // Runde 102: dito -- neue Saison, neue Event-Keys
  pendingOwnMatch = null; // Runde 99: ein Match der ALTEN Saison darf nie in die neue Saison hinüberhängen
  seasonSkipUsed = false; // Runde 102: neue Saison -- Banner darf wieder erscheinen können, falls wieder disqualifiziert
}

// Runde 102, Bug-Fix (User-Meldung: "Schnellvorlauf überspringt immer ganzes
// Jahr statt bis zum tatsächlich nächsten Event, keine Turniere fürs nächste
// Jahr angezeigt, z.B. bei 1. Jan. 2027"): careerState.seasonNumber wurde
// bisher AUSSCHLIESSLICH von startNextSeason() erhöht -- das ist der Trigger
// des ALTEN tournament.js/season.js-Systems (Button "Nächste Saison starten"
// auf dem längst nicht mehr genutzten alten Turnier-Screen). Im NEUEN,
// kalendergetriebenen Dashboard-Flow gab es dafür bisher GAR KEINEN Trigger --
// currentSeasonTournamentSchedule() blieb dadurch für IMMER an Saison 1/Jahr
// 2026 hängen, sobald man über Dezember hinaus weiterspielte: isCalendarEventDay()
// fand dann bis zum GLEICHEN Kalendertag ein ganzes Jahr später (nächster
// 1. Dezember) keinen Turnier-Anmeldetag mehr (alle Saison-1-Termine liegen ja
// schon in der Vergangenheit), und die "Bevorstehend"-Liste blieb leer.
// Prüft bei jedem Tagfortschritt, ob careerDate den Registrierungsstart der
// FOLGE-Saison (deren Open Qualifier im Januar) erreicht hat -- wenn ja, zählt
// die Saison automatisch weiter.
function checkSeasonRolloverIfDue() {
  const nextSeasonSchedule = buildSeasonTournamentSchedule(careerState.seasonNumber + 1);
  const nextSeasonOpen0Start = nextSeasonSchedule[0].phaseDates.registration.start;
  if (careerDate < nextSeasonOpen0Start) return;
  resetSeasonScopedDashboardState();
}

function startNextSeason() {
  const playerTeam = findTournamentTeam('player');
  const wasChampion = seasonState.finalChampionId === 'player';
  // Erfolgsfaktor über die GESAMTE Saison (alle Events, nicht nur das letzte
  // gespielte) — seasonState.playerWins/-Losses akkumulieren das laufend
  // (siehe accumulatePlayerRecord(), aufgerufen am Ende jedes Events).
  const performanceFactor = seasonState.playerWins / Math.max(1, seasonState.playerWins + seasonState.playerLosses); // 0..1

  if (ceoFireable) {
    consecutivePoorSeasons = performanceFactor < 0.5 ? consecutivePoorSeasons + 1 : 0;
    if (consecutivePoorSeasons >= CEO_FIRE_AFTER_POOR_SEASONS) {
      triggerCeoFired();
      return;
    }
  }

  const developedStarters = playerTeam.players.map((p) => developPlayer(p, performanceFactor));
  const developedSub = playerTeam.sub ? developPlayer(playerTeam.sub, performanceFactor) : null;
  const developedCoach = playerTeam.coach ? developCoach(playerTeam.coach, performanceFactor) : null;
  // Reserve spielt nie mit, entwickelt sich aber mit demselben Team-Erfolgsfaktor
  // weiter wie der Rest des Kaders (trainiert schließlich mit).
  const reserveBefore = rosterSlots.reserve.filter(Boolean).map(findPlayer);
  const developedReserve = reserveBefore.map((p) => developPlayer(p, performanceFactor));

  careerRosterPlayers = developedSub ? [...developedStarters, developedSub] : developedStarters;
  careerReservePlayers = developedReserve;
  careerCoach = developedCoach;

  const income = calculateSeasonIncome({ wins: seasonState.playerWins, losses: seasonState.playerLosses }, wasChampion);
  careerSeasonIncomeTotal += income; // für "Gesamteinnahmen" auf der Finanzen-Seite (Runde 34)
  const rosterValue = careerRosterPlayers.reduce((sum, p) => sum + calculatePrice(p.overall), 0)
    + careerReservePlayers.reduce((sum, p) => sum + calculatePrice(p.overall), 0)
    + (careerCoach ? calculatePrice(careerCoach.overall) : 0);
  BUDGET = rosterValue + income;

  rosterSlots = {
    main: padToSize(developedStarters.map((p) => p.name), MAIN_SIZE),
    sub: padToSize(developedSub ? [developedSub.name] : [], SUB_SIZE),
    reserve: padToSize(developedReserve.map((p) => p.name), RESERVE_SIZE),
  };
  draftedCoachName = developedCoach ? developedCoach.name : null;
  negotiatedPremiumPlayers = {}; // neue Saison — kein Vertragsspieler mehr, keine Prämie fällig
  playersTradedThisSeason = new Set(); // neue Saison — Trade-Sperre pro Spieler läuft ab

  if (wasChampion) careerState.titlesWon += 1;
  resetSeasonScopedDashboardState();
  careerBotTeams = developBotTeams(careerBotTeams); // Rivalen entwickeln sich mit

  tournamentState = null;
  showScreen('screen-draft');
  renderAll();
  saveGameState();

  generateBotTrades();
  generateIncomingOffers();
  showNextIncomingOffer();
}

// ── Swiss-Bracket-Visualisierung (SVG) — angelehnt an Lykon Regional Grid ────
// Generalisiert für 16 Teams / 5 Swiss-Runden + 8er-Playoffs: statt fixer
// Positionen pro (früher exakt 4) Spalte wird die Spalten-/Boxen-Höhe aus dem
// tatsächlichen Turnierzustand berechnet (siehe buildSwissColumn()).
// Bewusst wieder größer/gut lesbar (User-Feedback) — die Seite selbst darf
// jetzt scrollen (kein verschachteltes Scroll-Fenster mehr, siehe style.css
// .bracket-container/body), daher muss das Bracket nicht mehr in eine kleine
// feste Fläche gequetscht werden.
const BR_HH  = 24;   // Kopfzeilen-Höhe
const BR_MH  = 30;   // Match-Zeilen-Höhe ("Team1 vs Team2")
const BR_SH  = 26;   // Slot-Zeilen-Höhe (einzelnes Team)
const BR_MS  = 3;    // Abstand zwischen Matches innerhalb einer Gruppe
const BR_GG  = 12;   // Abstand zwischen Gruppen-Boxen in derselben Spalte
const BR_W2  = 230;  // Spaltenbreite (einheitlich)
const BR_CG  = 44;   // Spaltenabstand
const BR_TOP = 16;

const COL_BLUE = '#3b82f6', COL_GREEN = '#22c55e', COL_AMBER = '#f59e0b',
      COL_RED = '#ef4444', COL_GOLD = '#f59e0b', COL_PURPLE = '#7c3aed';

function brMatchY(groupY, i) { return groupY + BR_HH + i * (BR_MH + BR_MS); }
function brSlotY(groupY, i)  { return groupY + BR_HH + i * BR_SH; }

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function truncateName(name) {
  return name.length > 18 ? name.slice(0, 17) + '…' : name;
}

function svgLine(x1, y1, x2, y2, color) {
  const mx = Math.round((x1 + x2) / 2);
  return '<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2 + '" ' +
    'stroke="' + color + '" stroke-width="2" fill="none" opacity="0.85" />';
}

function svgGroupBox(x, y, w, h, label, sublabel, color, innerSvg) {
  const hasSubLabel = !!sublabel;
  const labelY = hasSubLabel ? y + BR_HH / 2 : y + BR_HH / 2 + 4;
  const sublabelY = y + BR_HH - 5;
  return (
    '<rect x="' + (x - 1) + '" y="' + (y - 1) + '" width="' + (w + 2) + '" height="' + (h + 2) + '" rx="6" fill="none" stroke="' + color + '" stroke-opacity="0.12" stroke-width="2" />' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="#080f1e" stroke="' + color + '" stroke-opacity="0.5" stroke-width="1.2" />' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + BR_HH + '" rx="5" fill="' + color + '" fill-opacity="0.2" />' +
    '<rect x="' + (x + 5) + '" y="' + (y + BR_HH - 1) + '" width="' + (w - 10) + '" height="1" fill="' + color + '" fill-opacity="0.35" />' +
    '<text x="' + (x + w / 2) + '" y="' + labelY + '" text-anchor="middle" fill="' + color + '" font-size="' + (hasSubLabel ? 11 : 12) + '" font-family="monospace" font-weight="700" letter-spacing="1.5" opacity="0.95">' + label + '</text>' +
    (sublabel ? '<text x="' + (x + w / 2) + '" y="' + sublabelY + '" text-anchor="middle" fill="' + color + '" font-size="7.5" font-family="monospace" font-weight="700" letter-spacing="1" opacity="0.65">' + sublabel + '</text>' : '') +
    innerSvg
  );
}

function svgMatchRow(x, y, w, match, sepTop) {
  if (!match) {
    return '<text x="' + (x + w / 2) + '" y="' + (y + BR_MH / 2 + 4.5) + '" text-anchor="middle" fill="#263d56" font-size="11">—</text>';
  }
  const teamA = findTournamentTeam(match.aId);
  const teamB = findTournamentTeam(match.bId);
  const played = match.played;
  const aWon = played && match.scoreA > match.scoreB;
  const bWon = played && match.scoreB > match.scoreA;
  const cy = y + BR_MH / 2 + 4.5;
  const half = w / 2;
  const aCol = teamA.isPlayer ? '#ffd873' : aWon ? '#f0f7ff' : bWon ? '#172336' : '#4a6480';
  const bCol = teamB.isPlayer ? '#ffd873' : bWon ? '#f0f7ff' : aWon ? '#172336' : '#4a6480';
  const pad = 10;

  let out = '';
  if (sepTop) out += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + y + '" stroke="#0c1b2e" stroke-width="1" />';
  if (aWon) out += '<rect x="' + x + '" y="' + y + '" width="' + (half - 4) + '" height="' + BR_MH + '" fill="#22c55e" fill-opacity="0.05" />';
  if (bWon) out += '<rect x="' + (x + half + 4) + '" y="' + y + '" width="' + (half - 4) + '" height="' + BR_MH + '" fill="#22c55e" fill-opacity="0.05" />';

  out += '<text x="' + (x + pad) + '" y="' + cy + '" fill="' + aCol + '" font-size="11" font-weight="' + (aWon || teamA.isPlayer ? 700 : 400) + '">' + escapeXml(truncateName(teamA.name)) + '</text>';

  if (played) {
    out += '<text x="' + (x + half - 8) + '" y="' + cy + '" text-anchor="end" fill="' + (aWon ? '#22c55e' : '#263d56') + '" font-size="12" font-weight="700">' + match.scoreA + '</text>';
    out += '<text x="' + (x + half) + '" y="' + cy + '" text-anchor="middle" fill="#1a2d45" font-size="9" font-family="monospace">-</text>';
    out += '<text x="' + (x + half + 8) + '" y="' + cy + '" text-anchor="start" fill="' + (bWon ? '#22c55e' : '#263d56') + '" font-size="12" font-weight="700">' + match.scoreB + '</text>';
  } else {
    out += '<text x="' + (x + half) + '" y="' + cy + '" text-anchor="middle" fill="#1c3050" font-size="8" font-family="monospace" font-weight="700">VS</text>';
  }

  out += '<text x="' + (x + w - pad) + '" y="' + cy + '" text-anchor="end" fill="' + bCol + '" font-size="11" font-weight="' + (bWon || teamB.isPlayer ? 700 : 400) + '">' + escapeXml(truncateName(teamB.name)) + '</text>';
  return out;
}

function svgSlotRow(x, y, w, team, sepTop) {
  let out = '';
  if (sepTop) out += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + y + '" stroke="#0c1b2e" stroke-width="1" />';
  const col = !team ? '#192a3e' : team.isPlayer ? '#ffd873' : '#d0e4f7';
  out += '<text x="' + (x + 12) + '" y="' + (y + BR_SH / 2 + 4) + '" fill="' + col + '" font-size="11" font-weight="' + (team ? 600 : 400) + '">' + (team ? escapeXml(truncateName(team.name)) : '—') + '</text>';
  return out;
}

// Baut die Boxen-Liste für EINE Swiss-Spalte (Runde N): aktive Match-Gruppen
// dieser Runde + Gruppen, die durch die VORrunde gerade terminal (qualifiziert/
// eliminiert) geworden sind — genau die, die "ab jetzt" bekannt sind.
// Sortierung IMMER nach Sieg-Anzahl absteigend (nicht alphabetisch!) — dadurch
// steht die bessere Gruppe oben, egal ob aktiv oder terminal, und QUALIFIZIERT
// (mehr Siege) landet automatisch über ELIMINIERT (weniger Siege) — genau wie
// bei einem echten Swiss-Bracket üblich.
function buildSwissColumnBoxes(engine, round) {
  const records = Object.keys(engine.groups).filter((record) => {
    const group = engine.groups[record];
    return group.teams && group.teams.length > 0 && recordGamesPlayed(record) === round - 1;
  }).sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]));

  return records.map((record) => {
    const group = engine.groups[record];
    const wins = Number(record.split('-')[0]);
    const losses = Number(record.split('-')[1]);
    if (isTerminalRecord(record)) {
      const qualified = wins >= WINS_TARGET;
      return { type: 'slot', record, teams: group.teams, qualified, color: qualified ? COL_GREEN : COL_RED };
    }
    return { type: 'match', record, matches: group.matches, color: losses >= 1 ? COL_AMBER : COL_BLUE };
  });
}

function swissBoxHeight(box) {
  if (box.type === 'match') return BR_HH + box.matches.length * BR_MH + Math.max(0, box.matches.length - 1) * BR_MS;
  return BR_HH + box.teams.length * BR_SH;
}

// Zeichnet eine Spalte (von oben nach unten gestapelte Boxen) an X-Position x,
// liefert das SVG-Fragment plus die tatsächlich benötigte Gesamthöhe.
// positions: record -> { cy } (vertikale Boxenmitte) — wird gebraucht, um im
// Anschluss Verbindungslinien zur NÄCHSTEN Spalte zu zeichnen.
function renderSwissColumnSvg(x, boxes) {
  let svg = '';
  let y = BR_TOP;
  const positions = {};
  boxes.forEach((box) => {
    const h = swissBoxHeight(box);
    positions[box.record] = { cy: y + h / 2 };
    if (box.type === 'match') {
      let inner = '';
      box.matches.forEach((m, i) => { inner += svgMatchRow(x, brMatchY(y, i), BR_W2, m, i > 0); });
      svg += svgGroupBox(x, y, BR_W2, h, box.record, 'BO5', box.color, inner);
    } else {
      let inner = '';
      box.teams.forEach((t, i) => { inner += svgSlotRow(x, brSlotY(y, i), BR_W2, findTournamentTeam(t.id), i > 0); });
      svg += svgGroupBox(x, y, BR_W2, h, box.record, box.qualified ? 'QUALIFIZIERT' : 'ELIMINIERT', box.color, inner);
    }
    y += h + BR_GG;
  });
  return { svg, height: y - BR_GG, positions };
}

// Die zwei möglichen Folge-Records einer NICHT-terminalen Gruppe (Sieg-Pfad,
// Niederlage-Pfad) — für die Verbindungslinien zur nächsten Spalte.
function nextSwissRecords(record) {
  const parts = record.split('-').map(Number);
  return [(parts[0] + 1) + '-' + parts[1], parts[0] + '-' + (parts[1] + 1)];
}

// Generalisiert (User-Wunsch "volle 1:1-Struktur"): Swiss läuft jetzt sowohl
// beim Open Qualifier ('open-swiss', 16 Teams) als auch beim Major
// ('major-swiss', 16 Teams) — beide nutzen exakt dieselbe Engine/Anzeige,
// nur mit unterschiedlicher Team-Menge (`ts.engine`, gesetzt beim Betreten
// der jeweiligen Stufe, siehe enterOpenSwissStage()/enterMajorSwissStage()).
function renderSwissBracket() {
  const ts = tournamentState;
  const container = document.getElementById('bracket-container');
  const engine = ts.engine;
  const isSwissStage = ts.stage === 'open-swiss' || ts.stage === 'major-swiss';

  // Solange die Swiss-Stage läuft, nur bis zur aktuellen Runde zeigen (spätere
  // Runden existieren noch nicht); danach ist die Stage komplett aufgelöst (6
  // Spalten: 5 Runden + die letzte Terminal-Spalte 3-2/2-3 ohne eigene Matches).
  const maxRound = isSwissStage ? ts.swissRoundNum : 6;

  let svg = '';
  let x = 10;
  let maxHeight = 0;
  let prevX = null;
  let prevPositions = null;
  for (let round = 1; round <= maxRound; round++) {
    const boxes = buildSwissColumnBoxes(engine, round);
    if (boxes.length === 0) continue;
    const built = renderSwissColumnSvg(x, boxes);

    // Verbindungslinien von der VORHERIGEN Spalte zu dieser — jede nicht-
    // terminale Gruppe hat genau 2 Folge-Records (Sieg-/Niederlage-Pfad).
    if (prevPositions) {
      let lineSvg = '';
      Object.keys(prevPositions).forEach((record) => {
        if (isTerminalRecord(record)) return;
        nextSwissRecords(record).forEach((nextRecord) => {
          if (built.positions[nextRecord]) {
            lineSvg += svgLine(prevX + BR_W2, prevPositions[record].cy, x, built.positions[nextRecord].cy, '#ffffff');
          }
        });
      });
      svg += lineSvg;
    }

    svg += built.svg;
    maxHeight = Math.max(maxHeight, built.height);
    prevX = x;
    prevPositions = built.positions;
    x += BR_W2 + BR_CG;
  }

  const svgW = x - BR_CG + 10;
  const svgH = maxHeight + BR_TOP + 10;
  // Feste Pixelgröße statt "width:100%" — sonst wird die viewBox je nach
  // Spaltenzahl unterschiedlich stark gestreckt (Runde 1 mit wenig Inhalt würde
  // riesig hochskaliert, das komplette 6-Spalten-Bracket kaum noch skaliert).
  // 1 viewBox-Einheit = 1 Bildschirmpixel, IMMER — dadurch bleibt Text/Boxen-
  // Größe konstant, egal wie viele Runden gerade sichtbar sind. Der Container
  // übernimmt bei Bedarf horizontales Scrollen (overflow-x: auto).
  // width/height = natürliche (1:1) Größe; max-width:100%+height:auto lassen das
  // Bracket bei Bedarf proportional SCHRUMPFEN, damit es nie über den Fensterrand
  // hinausragt — aber NIE größer als die natürliche Größe hochskalieren (das war
  // der Fehler mit "width:100%" davor: kleine Brackets wurden riesig aufgeblasen).
  let html = '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" width="' + svgW + '" height="' + svgH + '" style="display:block;margin:0 auto;max-width:100%;height:auto;">' + svg + '</svg>';

  // Major nutzt (wie das alte Einzel-Turnier) Swiss GEFOLGT von Playoffs auf
  // demselben Bildschirm — sobald die Playoff-Stufe erreicht ist, wird das
  // (fertige) Swiss-Bracket weiter oben mit angezeigt.
  const majorHasPlayoffs = ts.stage === 'major-playoff-quarter' || ts.stage === 'major-playoff-semi'
    || ts.stage === 'major-playoff-final';
  if (majorHasPlayoffs) html += renderPlayoffSvg();

  container.innerHTML = html;
}

// ── Playoff-Bracket (8 Teams: Viertelfinale → Halbfinale → Finale, Bo7) ──────
const PP_W   = 230;
const PP_CG  = 44;
const PP_BH  = BR_HH + BR_MH;
const PP_GAP = 12;

// Generalisiert (User-Wunsch "volle 1:1-Struktur"): läuft jetzt bei Major/WM
// (8 Team-Playoffs, mit Viertelfinale) UND beim Open Qualifier (4-Team-
// Playoffs, nur Halbfinale+Finale, siehe buildPlayoffSemifinalsOnly() in
// tournament.js) — liest die Matches aus `ts.playoffMatches` statt fest aus
// `ts.qf1` etc., damit dieselbe Funktion für beide Varianten reicht. Fehlt
// `qf1` (Open Qualifier), wird die Viertelfinale-Spalte + ihre Linien
// einfach weggelassen und das Halbfinale rückt an den linken Rand.
function renderPlayoffSvg() {
  const pm = tournamentState.playoffMatches;
  const hasQuarters = !!pm.qf1;

  const sfX = hasQuarters ? (10 + PP_W + PP_CG) : 10;
  const finX = sfX + PP_W + PP_CG;

  let svg = '';
  let sfYs, sfCenters;

  if (hasQuarters) {
    const qfX = 10;
    const qfYs = [0, 1, 2, 3].map((i) => 10 + i * (PP_BH + PP_GAP));
    const qfCenters = qfYs.map((y) => y + PP_BH / 2);
    sfYs = [
      (qfCenters[0] + qfCenters[1]) / 2 - PP_BH / 2,
      (qfCenters[2] + qfCenters[3]) / 2 - PP_BH / 2,
    ];
    sfCenters = sfYs.map((y) => y + PP_BH / 2);

    svg += svgLine(qfX + PP_W, qfCenters[0], sfX, sfCenters[0], COL_GOLD);
    svg += svgLine(qfX + PP_W, qfCenters[1], sfX, sfCenters[0], COL_GOLD);
    svg += svgLine(qfX + PP_W, qfCenters[2], sfX, sfCenters[1], COL_GOLD);
    svg += svgLine(qfX + PP_W, qfCenters[3], sfX, sfCenters[1], COL_GOLD);

    const qfMatches = [pm.qf1, pm.qf2, pm.qf3, pm.qf4];
    const qfLabels = ['VIERTELFINALE 1', 'VIERTELFINALE 2', 'VIERTELFINALE 3', 'VIERTELFINALE 4'];
    qfMatches.forEach((m, i) => {
      svg += svgGroupBox(qfX, qfYs[i], PP_W, PP_BH, qfLabels[i], 'BO7', COL_PURPLE, svgMatchRow(qfX, qfYs[i] + BR_HH, PP_W, m, false));
    });
  } else {
    sfYs = [10, 10 + PP_BH + PP_GAP];
    sfCenters = sfYs.map((y) => y + PP_BH / 2);
  }
  const finY = (sfCenters[0] + sfCenters[1]) / 2 - PP_BH / 2;

  svg += svgLine(sfX + PP_W, sfCenters[0], finX, finY + PP_BH / 2, COL_GOLD);
  svg += svgLine(sfX + PP_W, sfCenters[1], finX, finY + PP_BH / 2, COL_GOLD);

  svg += svgGroupBox(sfX, sfYs[0], PP_W, PP_BH, 'HALBFINALE 1', 'BO7', COL_PURPLE, svgMatchRow(sfX, sfYs[0] + BR_HH, PP_W, pm.sf1, false));
  svg += svgGroupBox(sfX, sfYs[1], PP_W, PP_BH, 'HALBFINALE 2', 'BO7', COL_PURPLE, svgMatchRow(sfX, sfYs[1] + BR_HH, PP_W, pm.sf2, false));
  svg += svgGroupBox(finX, finY, PP_W, PP_BH, 'FINALE', 'BO7', COL_GOLD, svgMatchRow(finX, finY + BR_HH, PP_W, pm.final, false));

  const svgH = Math.max(sfYs[sfYs.length - 1] + PP_BH, finY + PP_BH) + 16;
  const svgW = finX + PP_W + 10;
  // Gleiche 1:1-Pixelgröße wie das Swiss-Bracket (kein "width:100%"-Stretch).
  return '<div style="margin-top:24px;"><svg viewBox="0 0 ' + svgW + ' ' + svgH + '" width="' + svgW + '" height="' + svgH + '" style="display:block;margin:0 auto;max-width:100%;height:auto;">' + svg + '</svg></div>';
}

// ── Doppel-K.O.-Bracket-Anzeige (Open Qualifier, Tag 1-2) ────────────────────
// Bewusst als kompakte Kartenliste statt eigener SVG-Bracket-Grafik (User-
// Vorgabe "verständlich bleiben" hat hier Vorrang vor visueller Politur) —
// zeigt pro "Leben-Stand" (0 oder 1 Niederlage) die aktuellen bzw. bereits
// entschiedenen Matches dieser Runde plus die Anzahl bereits Eliminierter.
function renderDoubleElimBracket() {
  const container = document.getElementById('bracket-container');
  const engine = seasonState.event.bracket;
  const groupLabels = { '0': 'Noch ungeschlagen (0 Niederlagen)', '1': 'Eine Niederlage — letzte Chance' };

  let html = '<div class="bracket-delim-wrap">';
  ['0', '1'].forEach((lossKey) => {
    const group = engine.groups[lossKey];
    if (!group || !group.teams || group.teams.length === 0) return;
    html += '<div class="bracket-delim-group">';
    html += '<div class="bracket-delim-group-title">' + groupLabels[lossKey] + ' — ' + group.teams.length + ' Teams</div>';
    if (group.matches) {
      html += '<div class="bracket-delim-matches">';
      group.matches.forEach((m) => { html += renderDelimMatchRow(m); });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '<div class="bracket-delim-eliminated">✕ Eliminiert: ' + engine.eliminated.length + ' Teams</div>';
  html += '</div>';
  container.innerHTML = html;
}

function renderDelimMatchRow(m) {
  const teamA = findTournamentTeam(m.aId);
  const teamB = findTournamentTeam(m.bId);
  const scoreText = m.played ? (m.scoreA + ' : ' + m.scoreB) : (m.scoreA + ' : ' + m.scoreB);
  const aWon = m.played && m.scoreA > m.scoreB;
  const bWon = m.played && m.scoreB > m.scoreA;
  return '<div class="bracket-delim-match' + (m.played ? ' is-played' : '') + '">' +
    '<span class="delim-team' + (aWon ? ' is-winner' : '') + '">' + teamA.name + '</span>' +
    '<span class="delim-score">' + scoreText + '</span>' +
    '<span class="delim-team' + (bWon ? ' is-winner' : '') + '">' + teamB.name + '</span>' +
    '</div>';
}

// ── GSL-Mini-Gruppen-Anzeige (Tag 4 der Opens, WM-GSL-Phase) ─────────────────
function renderGslGroups(groups) {
  const container = document.getElementById('bracket-container');
  let html = '<div class="bracket-gsl-wrap">';
  groups.forEach((group, i) => {
    html += '<div class="bracket-gsl-group">';
    html += '<div class="bracket-gsl-group-title">Gruppe ' + String.fromCharCode(65 + i) + '</div>';
    html += renderGslMatchLine('Match 1', group.match1);
    html += renderGslMatchLine('Match 2', group.match2);
    if (group.winnersMatch) html += renderGslMatchLine('Winners-Match', group.winnersMatch);
    if (group.losersMatch) html += renderGslMatchLine('Losers-Match', group.losersMatch);
    if (group.deciderMatch) html += renderGslMatchLine('Decider', group.deciderMatch);
    if (isGslGroupComplete(group)) {
      html += '<div class="bracket-gsl-result">✓ Qualifiziert: ' + group.qualified.map((t) => t.name).join(', ') + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderGslMatchLine(label, m) {
  const teamA = findTournamentTeam(m.aId);
  const teamB = findTournamentTeam(m.bId);
  const aWon = m.played && m.scoreA > m.scoreB;
  const bWon = m.played && m.scoreB > m.scoreA;
  return '<div class="bracket-gsl-match' + (m.played ? ' is-played' : '') + '">' +
    '<span class="gsl-match-label">' + label + '</span>' +
    '<span class="delim-team' + (aWon ? ' is-winner' : '') + '">' + teamA.name + '</span>' +
    '<span class="delim-score">' + m.scoreA + ' : ' + m.scoreB + '</span>' +
    '<span class="delim-team' + (bWon ? ' is-winner' : '') + '">' + teamB.name + '</span>' +
    '</div>';
}

// ── Info-/Übergangsbildschirme (zwischen zwei Events) ────────────────────────
function renderSeasonInfoStage() {
  const container = document.getElementById('bracket-container');
  container.innerHTML = '<div class="season-info-box">' + (tournamentState.infoHtml || '') + '</div>';
}

// ── Master-Dispatcher: welche Bracket-Ansicht passt zur aktuellen Stufe? ────
function renderBracketForCurrentStage() {
  const s = tournamentState.stage;
  if (s === 'open-bracket') { renderDoubleElimBracket(); return; }
  if (s === 'open-swiss' || s === 'major-swiss') { renderSwissBracket(); return; }
  if (s === 'open-gsl') { renderGslGroups(seasonState.event.gslGroups); return; }
  if (s === 'worlds-gsl') { renderGslGroups(seasonState.event.groups); return; }
  if (s === 'open-playoff-semi' || s === 'open-playoff-final'
    || s === 'major-playoff-quarter' || s === 'major-playoff-semi' || s === 'major-playoff-final'
    || s === 'worlds-playoff-quarter' || s === 'worlds-playoff-semi' || s === 'worlds-playoff-final') {
    document.getElementById('bracket-container').innerHTML = renderPlayoffSvg();
    return;
  }
  if (s === 'lcq-quarter' || s === 'lcq-semi') {
    // LCQ nutzt dieselbe Playoff-Optik (Viertel-/Halbfinale), aber Bo5 statt
    // Bo7 (ein einzelner Tag) — die Anzeige selbst ist identisch genug, um
    // dieselbe Funktion zu nutzen.
    document.getElementById('bracket-container').innerHTML = renderPlayoffSvg();
    return;
  }
  // Info-/Übergangsstufen + season-complete
  renderSeasonInfoStage();
}

// ── Speichersystem: mehrere Speicherstände (Slots) ───────────────────────
// Läuft über die Electron-IPC-Bridge in main.js/preload.js, jeder Slot ist
// eine eigene JSON-Datei in app.getPath('userData'). currentSlotId bindet die
// laufende Karriere an genau einen Slot — jeder saveGameState()-Aufruf
// schreibt dorthin, bis ein anderer Slot gewählt wird.
let currentSlotId = null;
let slotPickerMode = null; // 'new' | 'continue'

function collectSaveState() {
  return {
    version: 33, gameMode, careerCharacter, assignedOrg, BUDGET, rosterSlots, draftedCoachName, tournamentState,
    careerState, careerRosterPlayers, careerReservePlayers, careerCoach, careerBotTeams, careerRivalRecords,
    negotiatedPremiumPlayers, negotiationBlocklist, transferLog, careerPlaytimeSeconds,
    playersTradedThisSeason: Array.from(playersTradedThisSeason),
    ceoFireable, achievementsEnabled, consecutivePoorSeasons, careerEnded, transfersLockedUntil, unlockedAchievements,
    careerDate, financeAllocation, financeAllocationIsEuro: true, careerSeasonIncomeTotal,
    sponsorState, careerTotalWins, careerTotalLosses, careerSponsorIncomeTotal,
    sponsorRequestLog,
    openQualifierRegistrations,
    seasonPoints,
    seasonTournamentResults,
    teamForm,
    matchHistory,
    careerOrgStats,
    seasonQualifiedTeams,
    shownOwnMatchSteps,
    pendingPrizePayouts,
    cascadeRevealedSteps,
    seasonSkipUsed,
    financeMonthlyLedger,
    financeTransactionLog,
    playerDevelopment,
    staffTransferReplacements,
    playerTransferReplacements,
    signedFreeAgentPlayers: Array.from(signedFreeAgentPlayers),
    signedFreeAgentStaff: Array.from(signedFreeAgentStaff),
    pendingPlayerArrivals,
  };
}

function saveGameState() {
  if (!currentSlotId) return;
  window.electronAPI.saveGame(currentSlotId, collectSaveState());
}

async function loadGameState() {
  const data = await window.electronAPI.loadGame(currentSlotId);
  if (!data) return;

  assignedOrg = data.assignedOrg;
  // v1-v32-Spielstände kannten die Reserve-Kategorie noch nicht (Runde 122) --
  // assignedOrg wird als volles Objekt geladen (s.o.), roster.reserve fehlt
  // bei solchen alten Ständen deshalb komplett statt leer zu sein.
  if (assignedOrg && assignedOrg.roster && !assignedOrg.roster.reserve) assignedOrg.roster.reserve = [];
  gameMode = data.gameMode || 'career'; // ältere Spielstände (v1-v7) kannten nur Karriere
  // ältere Spielstände (v1-v8) kannten noch keinen Charakter, v9 kannte noch
  // das alte pathId-System statt Trait-Reglern -- in beiden Fällen fehlt
  // `.traits`, Fallback auf neutrale Werte, damit computeCharacterEffects()
  // nie auf undefined trifft. Alte Felder (region/pathId) werden einfach
  // mitkopiert, aber nirgends mehr gelesen (harmlos).
  careerCharacter = data.careerCharacter
    ? { name: 'Manager', firstName: '', lastName: '', gender: 'M', nation: 'DE', birthdate: null, avatarId: null, ...data.careerCharacter, traits: data.careerCharacter.traits || defaultCharacterTraits() }
    : { name: 'Manager', firstName: '', lastName: '', gender: 'M', nation: 'DE', birthdate: null, avatarId: null, traits: defaultCharacterTraits() };
  BUDGET = data.BUDGET;
  if (data.rosterSlots) {
    rosterSlots = data.rosterSlots;
  } else if (data.draftedPlayerNames) {
    // Migration von altem flachem Format (v1-v6): erste MAIN_SIZE = Starter, Rest = Sub.
    rosterSlots = {
      main: padToSize(data.draftedPlayerNames.slice(0, MAIN_SIZE), MAIN_SIZE),
      sub: padToSize(data.draftedPlayerNames.slice(MAIN_SIZE, MAIN_SIZE + SUB_SIZE), SUB_SIZE),
      reserve: emptySlotArray(RESERVE_SIZE),
    };
  } else {
    rosterSlots = { main: emptySlotArray(MAIN_SIZE), sub: emptySlotArray(SUB_SIZE), reserve: emptySlotArray(RESERVE_SIZE) };
  }
  draftedCoachName = data.draftedCoachName;
  tournamentState = data.tournamentState;
  careerState = data.careerState || { seasonNumber: 1, titlesWon: 0 }; // ältere Spielstände (v1) hatten das Feld noch nicht
  careerRosterPlayers = data.careerRosterPlayers || null;
  careerReservePlayers = data.careerReservePlayers || null; // ältere Spielstände (v1-v6) hatten das noch nicht
  careerCoach = data.careerCoach || null;
  careerBotTeams = data.careerBotTeams || null; // ältere Spielstände (v1/v2) hatten das noch nicht
  careerRivalRecords = data.careerRivalRecords || {};
  negotiatedPremiumPlayers = data.negotiatedPremiumPlayers || {}; // ältere Spielstände (v1-v3) hatten das noch nicht
  negotiationBlocklist = data.negotiationBlocklist || {}; // ältere Spielstände (v1-v4) hatten das noch nicht
  transferLog = data.transferLog || []; // ältere Spielstände (v1-v5) hatten das noch nicht
  playersTradedThisSeason = new Set(data.playersTradedThisSeason || []); // ältere Spielstände (v1-v6) hatten das noch nicht
  careerPlaytimeSeconds = data.careerPlaytimeSeconds || 0; // ältere Spielstände kannten noch keine Spielzeit
  // ältere Spielstände (v1-v9) kannten die Vertragsklauseln noch nicht --
  // Fallback: deaktiviert/ungesperrt, wie es vor dieser Runde immer war.
  ceoFireable = data.ceoFireable || false;
  achievementsEnabled = data.achievementsEnabled || false;
  consecutivePoorSeasons = data.consecutivePoorSeasons || 0;
  careerEnded = data.careerEnded || false;
  transfersLockedUntil = data.transfersLockedUntil || null;
  unlockedAchievements = data.unlockedAchievements || [];
  careerDate = data.careerDate || '2026-01-01'; // ältere Spielstände (v1-v9) kannten das Dashboard-Datum noch nicht
  // ältere Spielstände (v1-v11) kannten die Finanzen-Seite noch nicht. Ab
  // v27 sind financeAllocation-Werte feste €-Beträge statt Prozente (siehe
  // financeUnallocated()-Kommentar) -- `financeAllocationIsEuro` markiert
  // explizit, ob ein Spielstand schon migriert ist (verlässlicher als über
  // die reinen Zahlenwerte zu raten). Fehlt das Flag, waren es Prozente:
  // einmalig in €-Beträge umgerechnet, mit dem BEIM SPEICHERN gültigen
  // assignedOrg.budget (danach bleiben es feste Beträge, wachsen nie wieder
  // automatisch mit).
  if (data.financeAllocation && !data.financeAllocationIsEuro) {
    const oldPct = data.financeAllocation;
    const baseBudget = Math.max(0, assignedOrg ? assignedOrg.budget : 0);
    financeAllocation = {
      transfers: Math.round(baseBudget * (oldPct.transfers || 0) / 100),
      salaries: Math.round(baseBudget * (oldPct.salaries || 0) / 100),
      marketing: Math.round(baseBudget * (oldPct.marketing || 0) / 100),
      operations: Math.round(baseBudget * (oldPct.operations || 0) / 100),
    };
  } else {
    financeAllocation = data.financeAllocation || { transfers: 0, salaries: 0, marketing: 0, operations: 0 };
  }
  careerSeasonIncomeTotal = data.careerSeasonIncomeTotal || 0;
  // ältere Spielstände (v1-v13) kannten den Sponsoring-Lebenszyklus noch
  // nicht (nur das alte, flache signedSponsors-Array aus Runde 38, das jetzt
  // komplett durch sponsorState ersetzt ist -- bewusst NICHT migriert, da
  // Runde 38 noch kein produktiv genutztes Feature war).
  sponsorState = data.sponsorState || {};
  careerTotalWins = data.careerTotalWins || 0;
  careerTotalLosses = data.careerTotalLosses || 0;
  careerSponsorIncomeTotal = data.careerSponsorIncomeTotal || 0;
  // v14-Spielstände kannten nur die alte Kalendermonat-Quote (monthlySponsor-
  // Requests/-Month, siehe Runde 40) -- die lässt sich nicht verlustfrei in
  // einzelne Anfragedaten zurückrechnen, daher bewusst NICHT migriert (Spieler
  // startet nach dem Update mit allen 5 Slots frei, nie schlechter gestellt).
  sponsorRequestLog = data.sponsorRequestLog || [];
  // v16-Spielstände kannten noch die alte Zufallslotterie
  // (openQualifierAssignments/-DrawnSeason, Runde 44) statt echter
  // Regional-Brackets -- bewusst NICHT migriert (rein transiente
  // Saison-Zuteilung, kein Verlust für den Spieler), v1-v15 kannten das
  // Feature noch gar nicht. Fallback: keine Anmeldungen.
  openQualifierRegistrations = data.openQualifierRegistrations || {};
  // v1-v17-Spielstände kannten das Saison-Leaderboard noch nicht (Runde 82).
  seasonPoints = data.seasonPoints || {};
  // v1-v18-Spielstände kannten die automatische Turnier-Auflösung noch nicht
  // (Runde 85).
  seasonTournamentResults = data.seasonTournamentResults || {};
  // v1-v19-Spielstände kannten die Formkurven noch nicht (Runde 88).
  teamForm = data.teamForm || {};
  // v1-v20-Spielstände kannten die kanonische Match-Datenbank noch nicht
  // (Runde 89).
  matchHistory = data.matchHistory || [];
  // v1-v27-Spielstände kannten die karrierelangen Org-Statistiken (Majors/
  // Worlds gewonnen, Playoff-Teilnahmen) noch nicht -- Statistiken-Seite, diese Runde.
  careerOrgStats = data.careerOrgStats || {};
  seasonQualifiedTeams = data.seasonQualifiedTeams || {}; // v1-v21 kannten den Open Qualifier noch nicht (Runde 92)
  // v1-v22-Spielstände kannten den "schon live gezeigt"-Merker noch nicht (Runde 98) -- ohne
  // Fallback wäre bei jedem Ladevorgang eines alten Saves das jeweils letzte enthüllte eigene
  // Match (egal ob Sieg oder Niederlage) sofort wieder neu ausgelöst worden.
  shownOwnMatchSteps = data.shownOwnMatchSteps || {};
  pendingOwnMatch = null; // Runde 99: reines Session-UI-Detail, siehe Deklaration -- nie Teil des Save-Formats
  // v1-v23-Spielstände kannten die verzögerte Preisgeld-Auszahlung noch nicht (Runde 101).
  pendingPrizePayouts = data.pendingPrizePayouts || [];
  // v1-v24-Spielstände kannten das Schritt-für-Schritt-Reveal noch nicht (Runde 102) --
  // ohne Fallback würde nach dem Laden höchstens einmal eine bereits bekannte Stage
  // erneut (harmlos, aber unnötig) Match für Match animiert statt sofort komplett gefüllt.
  cascadeRevealedSteps = data.cascadeRevealedSteps || {};
  seasonSkipUsed = data.seasonSkipUsed || false; // v1-v24-Spielstände kannten den Season-Skip noch nicht
  financeMonthlyLedger = data.financeMonthlyLedger || {}; // v1-v26-Spielstände kannten die monatsgenaue Cashflow-Grafik noch nicht
  financeTransactionLog = data.financeTransactionLog || []; // v1-v31-Spielstände kannten die itemisierte Transaktionsliste noch nicht (Runde 121)
  pendingPlayerArrivals = data.pendingPlayerArrivals || []; // v1-v32-Spielstände kannten die 7-Tage-Ankunftsverzögerung noch nicht (Runde 122)
  // v1-v28-Spielstände kannten die Spieler-Entwicklung noch nicht (Runde 113).
  // ORGANIZATIONS wird bei jedem App-Start komplett neu aus den Rohdaten
  // aufgebaut (siehe organizations.js) -- reapplyPlayerDevelopmentToRosters()
  // MUSS deshalb hier laufen, bevor irgendein weiteres Turnier simuliert wird
  // (siehe checkTournamentResolutions() gleich danach), sonst würden neue
  // Entwicklungs-Deltas auf den falschen, unentwickelten Baseline-Werten
  // aufbauen.
  playerDevelopment = data.playerDevelopment || {};
  reapplyPlayerDevelopmentToRosters();
  // v1-v29-Spielstände kannten noch keine Personal-Verpflichtungen (Runde 117)
  // -- betrifft NUR fremde Bot-Orgs (assignedOrg wird ja bereits komplett als
  // Objekt geladen, siehe oben), dieselbe Notwendigkeit wie bei
  // playerDevelopment: ORGANIZATIONS wird bei jedem App-Start neu aufgebaut.
  staffTransferReplacements = data.staffTransferReplacements || {};
  reapplyStaffTransferReplacements();
  // v1-v30-Spielstände kannten noch keine Spieler-Käufe/Free Agents (Runde 120)
  // -- dasselbe Nachbau-Problem wie bei staffTransferReplacements oben.
  playerTransferReplacements = data.playerTransferReplacements || {};
  reapplyPlayerTransferReplacements();
  signedFreeAgentPlayers = new Set(data.signedFreeAgentPlayers || []);
  signedFreeAgentStaff = new Set(data.signedFreeAgentStaff || []);
  // Nachhol-Sicherheitsnetz: falls beim Speichern ein fälliges Turnier noch
  // nicht aufgelöst war (z.B. sehr alte Spielstände von vor Runde 85), wird
  // das beim Laden sofort nachgeholt statt dauerhaft offen zu bleiben.
  checkTournamentResolutions();
  startPlaytimeTracking();

  if (careerEnded) {
    stopPlaytimeTracking();
    renderGameOverScreen();
  } else if (tournamentState) {
    renderTournamentScreen();
    showScreen('screen-tournament');
  } else {
    // User-Wunsch: "Fortsetzen" soll direkt zur Dashboard-Startseite führen,
    // nicht mehr zum alten Draft-Screen -- derselbe Wechsel, der beim
    // Anlegen einer NEUEN Karriere schon länger gilt (siehe confirmOrgAndProceed()
    // weiter oben, "nach der Unterschrift geht es jetzt zum neuen Dashboard").
    renderAll();
    goToDashboard();
  }
}

// Baut die Logo-Wand im Hintergrund des Hauptmenüs aus den bereits
// vorhandenen Team-Logo-Dateien (User-Wunsch: durchlaufende "Plakatleinwand",
// die dauerhaft von rechts nach links zieht) -- rein dekorativ, läuft
// einmalig beim Programmstart und hängt nicht vom Spielzustand ab.
// Jede Reihe bekommt ihre eigene, zufällig gemischte Kachel-Sequenz ZWEIMAL
// hintereinander im DOM (siehe .mainmenu-logowall-row-CSS: Animation
// verschiebt um genau -50%, das ist bei verdoppeltem Inhalt eine perfekt
// nahtlose Endlosschleife -- kein sichtbarer Rand/Sprung, egal wie breit das
// Fenster ist).
const MENU_LOGOWALL_ROWS = 12;
const MENU_LOGOWALL_TILES_PER_ROW = 26;

// Container-ID ist parametrisiert, auch wenn aktuell nur noch EIN Aufruf
// existiert (#shared-logowall in #app-atmosphere, siehe index.html) -- die
// Logo-Wand+Trophäe wurden bewusst aus den einzelnen .screen-Elementen
// herausgelöst in ein gemeinsames, dauerhaft lebendiges Element, damit der
// Hintergrund beim Wechsel zwischen Hauptmenü und Slot-Sidebar nicht neu
// aufgebaut wird und seine Loop-Animation nie unterbrochen wird (siehe
// showScreen()/SHARED_ATMOSPHERE_SCREENS).
function renderMenuLogoWall(containerId) {
  const wall = document.getElementById(containerId || 'shared-logowall');
  if (!wall) return;
  const withLogo = ORGANIZATIONS.filter((o) => o.logo);
  const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

  const rowsHtml = [];
  for (let r = 0; r < MENU_LOGOWALL_ROWS; r++) {
    const seq = [];
    while (seq.length < MENU_LOGOWALL_TILES_PER_ROW) seq.push(...shuffle(withLogo));
    const rowTiles = seq.slice(0, MENU_LOGOWALL_TILES_PER_ROW);
    const tilesHtml = rowTiles.map((org) =>
      '<div class="mainmenu-logowall-tile"><img src="assets/team-logos/' + encodeURIComponent(org.logo) + '" alt=""></div>'
    ).join('');
    const duration = 42 + r * 4; // pro Reihe leicht anderes Tempo -- wirkt organischer als starrer Gleichtakt
    rowsHtml.push('<div class="mainmenu-logowall-row" style="animation-duration:' + duration + 's;">' + tilesHtml + tilesHtml + '</div>');
  }
  wall.innerHTML = rowsHtml.join('');
}
renderMenuLogoWall('shared-logowall');

// User-Wunsch: Logo soll mittig ÜBER DEN MENÜPUNKTEN sitzen. Reines CSS-
// Zentrieren (align-self:center) zentriert stattdessen über die volle Breite
// des linken Panels (bis zu 460px), die deutlich breiter ist als der
// eigentliche Nav-Textblock (~200-290px, je nach Fenstergröße/Zoom) -- das
// Logo landete dadurch sichtbar zu weit rechts. Fix: tatsächliche
// Nav-Breite per JS messen und das Logo per margin-left exakt darüber
// zentrieren (Nav ist width:fit-content, seine Breite entspricht also dem
// breitesten Menüpunkt). Läuft nach dem ersten Render UND bei jedem
// Fenster-Resize erneut, da sich die Nav-Breite bei geändertem UI-Scale
// (siehe Einstellungen) leicht verschieben kann.
function centerMenuLogoOverNav() {
  const logo = document.querySelector('.mainmenu-logo-img');
  const nav = document.querySelector('.mainmenu-nav');
  if (!logo || !nav) return;
  const navWidth = nav.getBoundingClientRect().width;
  const logoWidth = logo.getBoundingClientRect().width;
  logo.style.marginLeft = Math.max(0, (navWidth - logoWidth) / 2) + 'px';
}
window.addEventListener('resize', centerMenuLogoOverNav);

// User-Wunsch: "Fortsetzen" soll NUR erscheinen, wenn bereits ein Spielstand
// existiert (statt wie vorher immer sichtbar, nur deaktiviert) -- daneben
// wird das Logo (bzw. Farb-Badge-Fallback, siehe orgBadgeColor()) der Org
// des Spielstands gezeigt. Bei mehreren belegten Slots wird der erste
// gefundene als Vorschau gezeigt -- der Klick öffnet wie bisher die
// Slot-Auswahl (openSlotPicker('continue')), dort kann gezielt gewählt werden.
async function initContinueButton() {
  const slots = await window.electronAPI.listSaveSlots();
  const btn = document.getElementById('btn-continue');
  const existing = slots.find((s) => s.exists);

  if (!existing) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  btn.dataset.slotId = existing.slotId; // User-Wunsch: Klick lädt DIREKT diesen Slot statt erst die Slot-Auswahl zu öffnen

  // Logo direkt aus dem Spielstand (existing.orgLogo/-LogoUrl, siehe
  // list-save-slots in main.js) statt über findOrgByName() -- eine selbst
  // erstellte Org steht NIE in der festen 87er-Liste, der Namens-Lookup
  // würde für sie immer ins Leere laufen (siehe resolveOrgLogoUrl()).
  const logoUrl = resolveOrgLogoUrl({ logo: existing.orgLogo, logoUrl: existing.orgLogoUrl });
  const logoSlot = document.getElementById('mainmenu-continue-logo');
  logoSlot.style.background = '';
  if (logoUrl) {
    logoSlot.textContent = '';
    logoSlot.innerHTML = '<img src="' + logoUrl + '" alt="">';
  } else {
    logoSlot.innerHTML = '';
    logoSlot.style.background = orgBadgeColor(existing.orgName);
    logoSlot.textContent = existing.orgName.trim().charAt(0).toUpperCase();
  }
  document.getElementById('mainmenu-continue-sub').textContent = 'als ' + existing.characterName + ' — ' + existing.orgName;
}
initContinueButton();

// ── Feedback (Discord-Webhook, siehe main.js send-feedback) ─────────────
// Button bleibt deaktiviert, bis main.js bestätigt, dass eine echte
// Webhook-URL konfiguriert ist (discord-webhook.local.json) -- fehlt sie
// (z.B. bei jemandem, der das Repo ohne eigenen Webhook klont), bleibt
// Feedback ausgegraut statt mit einem funktionslosen Button zu verwirren.
async function initFeedbackButton() {
  const btn = document.getElementById('btn-feedback');
  const ready = await window.electronAPI.isFeedbackReady();
  btn.disabled = !ready;
  btn.title = ready ? 'Feedback geben' : 'Feedback-Kanal ist in diesem Build nicht konfiguriert';
}
initFeedbackButton();

let feedbackRatingValue = 0;
let feedbackSending = false;

function renderFeedbackStars(hoverValue) {
  const value = hoverValue || feedbackRatingValue;
  document.querySelectorAll('.feedback-star').forEach((star) => {
    star.classList.toggle('is-active', Number(star.dataset.value) <= value);
  });
}

function setFeedbackStatus(text, kind) {
  const el = document.getElementById('feedback-status');
  el.textContent = text;
  el.className = 'update-check-status' + (kind ? ' feedback-status-' + kind : '');
}

function openFeedbackModal() {
  feedbackRatingValue = 0;
  document.getElementById('feedback-message').value = '';
  document.getElementById('feedback-char-count').textContent = '0 / 800';
  setFeedbackStatus('');
  renderFeedbackStars(0);
  document.getElementById('btn-feedback-send').disabled = false;
  document.getElementById('feedback-modal').classList.remove('hidden');
}

function hideFeedbackModal() {
  document.getElementById('feedback-modal').classList.add('hidden');
}

async function sendFeedback() {
  if (feedbackSending) return;
  const message = document.getElementById('feedback-message').value.trim();
  if (!message) {
    setFeedbackStatus('Bitte eine Nachricht eingeben.', 'error');
    return;
  }
  feedbackSending = true;
  document.getElementById('btn-feedback-send').disabled = true;
  setFeedbackStatus('Wird gesendet...');

  const result = await window.electronAPI.sendFeedback({ rating: feedbackRatingValue, message });

  feedbackSending = false;
  if (result.ok) {
    setFeedbackStatus('Danke für dein Feedback!', 'ok');
    setTimeout(hideFeedbackModal, 1500);
  } else {
    setFeedbackStatus(result.error || 'Senden fehlgeschlagen — bitte später erneut versuchen.', 'error');
    document.getElementById('btn-feedback-send').disabled = false;
  }
}

// ── Einstellungen (Hauptmenü-Popup) ───────────────────────────────────────
// KEIN Auto-Save und KEINE Live-Vorschau mehr (User-Wunsch): das Popup
// arbeitet auf einer lokalen Kopie (`draftSettings`), die frei angeklickt
// werden kann, OHNE dass sich am laufenden Fenster/Ticker irgendetwas
// ändert. Erst ein Klick auf "Speichern" schreibt den kompletten Entwurf weg
// UND wendet ihn an (Anzeigemodus, Fenstergröße, UI-Größe, Standard-
// Match-Geschwindigkeit, alles zusammen). "Abbrechen" verwirft den Entwurf
// ersatzlos — da nie etwas live angewendet wurde, muss dafür auch nichts
// zurückgesetzt werden.
let draftSettings = null;

async function initSettings() {
  appSettings = await window.electronAPI.getSettings();
  setMatchSpeed(appSettings.defaultMatchSpeed);
}
initSettings();

function renderSettingsModal() {
  // Musik-Regler zeigt Live-Vorschau (wie der "🔊 Test"-Button beim
  // Sound-Effekte-Regler) -- Hintergrundmusik läuft ja bereits, während
  // dieser Screen offen ist, im Gegensatz zum Intro-Video-Regler daneben.
  const musicVolumePct = Math.round(draftSettings.musicVolume * 100);
  const musicVolumeSlider = document.getElementById('settings-music-volume');
  musicVolumeSlider.value = musicVolumePct;
  document.getElementById('settings-music-volume-value').textContent = musicVolumePct + '%';
  document.getElementById('bg-music').volume = draftSettings.musicVolume;
  musicVolumeSlider.oninput = () => {
    draftSettings.musicVolume = Number(musicVolumeSlider.value) / 100;
    document.getElementById('settings-music-volume-value').textContent = musicVolumeSlider.value + '%';
    document.getElementById('bg-music').volume = draftSettings.musicVolume;
  };

  const displayWrap = document.getElementById('settings-display-mode-options');
  displayWrap.innerHTML = SETTINGS_DISPLAY_MODE_OPTIONS.map((o) =>
    '<button class="settings-speed-btn' + (draftSettings.displayMode === o.id ? ' is-active' : '') + '" data-display-mode="' + o.id + '">' + o.label + '</button>'
  ).join('');
  displayWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSettings.displayMode = btn.dataset.displayMode;
      renderSettingsModal();
    });
  });

  const windowSizeSelect = document.getElementById('settings-window-size');
  windowSizeSelect.value = draftSettings.windowSize;
  windowSizeSelect.onchange = () => {
    draftSettings.windowSize = windowSizeSelect.value;
  };

  const uiScaleWrap = document.getElementById('settings-ui-scale-options');
  uiScaleWrap.innerHTML = SETTINGS_UI_SCALE_OPTIONS.map((o) =>
    '<button class="settings-speed-btn' + (draftSettings.uiScale === o.value ? ' is-active' : '') + '" data-ui-scale="' + o.value + '">' + o.label + '</button>'
  ).join('');
  uiScaleWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSettings.uiScale = Number(btn.dataset.uiScale);
      renderSettingsModal();
    });
  });

  document.getElementById('settings-remember-bounds').checked = draftSettings.rememberWindowBounds;

  document.getElementById('settings-sound-enabled').checked = draftSettings.soundEnabled;
  const volumePct = Math.round(draftSettings.soundVolume * 100);
  const volumeSlider = document.getElementById('settings-sound-volume');
  volumeSlider.value = volumePct;
  document.getElementById('settings-sound-volume-value').textContent = volumePct + '%';
  volumeSlider.oninput = () => {
    draftSettings.soundVolume = Number(volumeSlider.value) / 100;
    document.getElementById('settings-sound-volume-value').textContent = volumeSlider.value + '%';
  };

  const introVolumePct = Math.round(draftSettings.introVideoVolume * 100);
  const introVolumeSlider = document.getElementById('settings-intro-volume');
  introVolumeSlider.value = introVolumePct;
  document.getElementById('settings-intro-volume-value').textContent = introVolumePct + '%';
  introVolumeSlider.oninput = () => {
    draftSettings.introVideoVolume = Number(introVolumeSlider.value) / 100;
    document.getElementById('settings-intro-volume-value').textContent = introVolumeSlider.value + '%';
  };

  const speedWrap = document.getElementById('settings-speed-options');
  speedWrap.innerHTML = SETTINGS_SPEED_OPTIONS.map((s) =>
    '<button class="settings-speed-btn' + (draftSettings.defaultMatchSpeed === s ? ' is-active' : '') + '" data-speed="' + s + '">×' + s + '</button>'
  ).join('');
  speedWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSettings.defaultMatchSpeed = Number(btn.dataset.speed);
      renderSettingsModal();
    });
  });

  const paceWrap = document.getElementById('settings-pace-options');
  paceWrap.innerHTML = SETTINGS_PACE_OPTIONS.map((o) =>
    '<button class="settings-speed-btn' + (draftSettings.quickSimPace === o.id ? ' is-active' : '') + '" data-pace="' + o.id + '">' + o.label + '</button>'
  ).join('');
  paceWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      draftSettings.quickSimPace = btn.dataset.pace;
      renderSettingsModal();
    });
  });

  document.getElementById('settings-auto-update').checked = draftSettings.autoCheckUpdates;
}

// Einstellungen sind jetzt eine Sidebar (wie die Slot-Auswahl, teilt sich
// #app-atmosphere) statt eines Tab-Modals -- eine einzige durchgehende Liste
// statt Kategorie-Tabs, siehe index.html. openSettingsScreen()/
// closeSettingsSidebar() spiegeln openSlotPicker()/closeSlotPicker() 1:1.
// Kategorien als Button-Reihe oben statt einer langen, gequetscht wirkenden
// durchgehenden Liste (User-Wunsch) -- nur die aktive Kategorie zeigt ihre
// .settings-row-Inhalte, Rest bleibt per display:none unsichtbar.
function showSettingsCategory(categoryId) {
  document.querySelectorAll('.settings-category-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.settingsCategory === categoryId);
  });
  document.querySelectorAll('.settings-category-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.settingsPanel === categoryId);
  });
}

function openSettingsScreen() {
  draftSettings = { ...appSettings };
  renderSettingsModal();
  showSettingsCategory('lautstaerke');
  document.getElementById('settings-sidebar').classList.remove('is-closing');
  showScreen('screen-settings');
}

// Spielt die Slide-out-Animation ab, BEVOR tatsächlich zurück ins Menü
// gewechselt wird -- #app-atmosphere bleibt währenddessen sichtbar (siehe
// SHARED_ATMOSPHERE_SCREENS), läuft also ohne Unterbrechung weiter.
function closeSettingsSidebar(afterClose) {
  const sidebar = document.getElementById('settings-sidebar');
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sidebar.classList.remove('is-closing');
    afterClose();
  }
  sidebar.classList.add('is-closing');
  sidebar.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 500);
}

// Verwirft den Entwurf — da nichts live angewendet wurde, reicht reines Verwerfen.
function cancelSettingsModal() {
  closeSettingsSidebar(() => {
    // Musik-Live-Vorschau (siehe renderSettingsModal()) auf den zuletzt
    // gespeicherten Wert zurücksetzen, da der Entwurf jetzt verworfen wird.
    document.getElementById('bg-music').volume = appSettings.musicVolume;
    draftSettings = null;
    goToMenu();
  });
}

// Schreibt den Entwurf dauerhaft weg und wendet ALLES auf einmal an
// (Anzeige-Einstellungen + Standard-Match-Geschwindigkeit).
function saveSettingsModal() {
  closeSettingsSidebar(async () => {
    appSettings = { ...draftSettings };
    draftSettings = null;
    await window.electronAPI.saveSettings(appSettings);
    await window.electronAPI.applyDisplaySettings();
    setMatchSpeed(appSettings.defaultMatchSpeed);
    goToMenu();
  });
}

function resetSettingsToDefaults() {
  draftSettings = {
    autoCheckUpdates: true, defaultMatchSpeed: 1, quickSimPace: 'normal',
    displayMode: 'windowed', windowSize: '1280x800', uiScale: 1, rememberWindowBounds: true, windowBounds: null,
    soundEnabled: true, soundVolume: 0.5, introVideoVolume: 0.7, musicVolume: 0.3,
  };
  renderSettingsModal();
}

// Der "Fortsetzen"-Button wird nur bei App-Start einmalig geprüft — ohne diesen
// Refresh bliebe er nach dem ERSTEN Speicherstand der Session fälschlich
// deaktiviert, da sich sein disabled-Status sonst nie mehr aktualisiert.
function goToMenu() {
  stopPlaytimeTracking();
  showScreen('screen-menu');
  initContinueButton();
  centerMenuLogoOverNav();
}

// Öffnet die Speicherstand-Auswahl. 'new': jeder Slot wählbar (Überschreiben
// wird bei belegten Slots bestätigt), 'continue': nur belegte Slots wählbar.
function openSlotPicker(mode) {
  slotPickerMode = mode;
  document.getElementById('slots-title').textContent = 'Speicherplatz wählen';
  document.getElementById('slots-sidebar').classList.remove('is-closing');
  showScreen('screen-slots');
  renderSlotsList();
}

// Schließt die Slot-Sidebar mit einer Slide-out-Animation (Umkehrung von
// .slots-sidebar-slide-in), BEVOR tatsächlich zum Hauptmenü gewechselt wird
// -- #app-atmosphere bleibt währenddessen laut showScreen() durchgehend
// sichtbar (Menü UND Slots stehen beide in SHARED_ATMOSPHERE_SCREENS), der
// Hintergrund läuft also ohne jede Unterbrechung weiter.
function closeSlotPicker() {
  const sidebar = document.getElementById('slots-sidebar');
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sidebar.classList.remove('is-closing');
    goToMenu();
  }
  sidebar.classList.add('is-closing');
  sidebar.addEventListener('animationend', finish, { once: true });
  // Sicherheitsnetz: 'animationend' kann in nicht-fokussierten Fenstern
  // ausbleiben (bekanntes Muster in diesem Projekt) -- spätestens nach
  // Animationsdauer + Puffer trotzdem schließen.
  setTimeout(finish, 500);
}

// "Spielzeit" (echte akkumulierte Zeit, siehe careerPlaytimeSeconds/
// startPlaytimeTracking()) und "Gespeichert" (Datei-mtime, siehe
// list-save-slots in main.js) fürs Slot-Karten-Layout aus dem Referenz-
// Screenshot.
function formatPlaytime(seconds) {
  const s = seconds || 0;
  const days = Math.floor(s / 86400);
  if (days >= 1) return days + ' Tg.';
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return hours + ' Std.';
  return Math.floor(s / 60) + ' Min.';
}

function formatSavedAt(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Kartenlayout nach Referenz-Screenshot: Org-Logo links, Name/Org/Spielzeit/
// Gespeichert in der Mitte, eigener Charakter-Avatar rechts. Leere Slots
// werden NICHT mehr als eigene Karten gezeigt (siehe "+ Neuen Slot
// erstellen"-Button) -- deutlich aufgeräumter als die alte "3 Karten,
// manche leer/deaktiviert"-Darstellung.
async function renderSlotsList() {
  const slots = await window.electronAPI.listSaveSlots();
  const container = document.getElementById('slots-list');
  container.innerHTML = '';

  const createBtn = document.getElementById('btn-create-slot');
  const firstEmptySlot = slots.find((s) => !s.exists);
  if (slotPickerMode === 'new') {
    createBtn.classList.remove('hidden');
    createBtn.disabled = !firstEmptySlot;
    createBtn.title = firstEmptySlot ? '' : 'Alle Speicherplätze sind belegt — lösche zuerst einen Speicherstand';
  } else {
    createBtn.classList.add('hidden');
  }

  const existingSlots = slots.filter((s) => s.exists);
  existingSlots.forEach((slot) => {
    const card = document.createElement('div');
    card.className = 'slot-card';

    // Logo direkt aus dem Spielstand (slot.orgLogo/-LogoUrl) statt über
    // findOrgByName() -- siehe initContinueButton() für denselben Fix/Grund.
    const initial = slot.orgName.trim().charAt(0).toUpperCase();
    const slotLogoUrl = resolveOrgLogoUrl({ logo: slot.orgLogo, logoUrl: slot.orgLogoUrl });
    const logoHtml = slotLogoUrl
      ? '<img class="slot-card-logo" src="' + slotLogoUrl + '" alt="">'
      : '<div class="slot-card-logo slot-card-logo-badge" style="background:' + orgBadgeColor(slot.orgName) + ';">' + initial + '</div>';

    // Echtes Portrait (auch ein hochgeladenes eigenes) hat Vorrang vor dem
    // Emoji-Avatar-Fallback -- User-Wunsch, spiegelt dieselbe Priorität wie
    // renderManagerPickerList().
    const avatar = CHARACTER_AVATARS.find((a) => a.id === slot.avatarId);
    const avatarHtml = slot.portraitUrl
      ? '<img class="slot-card-avatar" src="' + slot.portraitUrl + '" alt="">'
      : avatar
        ? '<div class="slot-card-avatar" style="background:' + avatar.color + '33;">' + avatar.emoji + '</div>'
        : '<div class="slot-card-avatar">👤</div>';

    const userLine = (slot.firstName ? slot.firstName + ' ' : '') + '"' + slot.characterName + '"';

    card.innerHTML =
      logoHtml +
      '<div class="slot-card-info">' +
        '<div class="slot-card-user">' + userLine + '</div>' +
        '<div class="slot-org">' + slot.orgName.toUpperCase() + '</div>' +
        '<div class="slot-meta">Spielzeit <strong>' + formatPlaytime(slot.playtimeSeconds) + '</strong></div>' +
        '<div class="slot-meta">Gespeichert <span class="slot-saved-at">' + formatSavedAt(slot.savedAt) + '</span></div>' +
      '</div>' +
      avatarHtml;

    const delBtn = document.createElement('button');
    delBtn.className = 'slot-delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Speicherstand löschen';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.deleteSave(slot.slotId);
      renderSlotsList();
      initContinueButton();
    });
    card.appendChild(delBtn);

    card.addEventListener('click', () => onSlotChosen(slot));
    container.appendChild(card);
  });

  if (existingSlots.length === 0) {
    container.innerHTML = '<p class="slot-empty-label">Noch keine Speicherstände vorhanden.</p>';
  }
}

function onSlotChosen(slot) {
  if (slotPickerMode === 'new') {
    if (slot.exists) {
      showConfirmModal(
        'Speicherstand überschreiben?',
        'Speicherstand ' + slot.slotId + ' (' + slot.orgName + ', Saison ' + slot.seasonNumber + ') wirklich überschreiben? Der bisherige Fortschritt geht dabei unwiderruflich verloren.',
        () => { currentSlotId = slot.slotId; goToCharacterCreation(); },
        { confirmLabel: 'Überschreiben', danger: true }
      );
      return;
    }
    currentSlotId = slot.slotId;
    goToCharacterCreation();
  } else {
    currentSlotId = slot.slotId;
    loadGameState();
  }
}

// ── Generisches Bestätigungs-Popup (ersetzt window.confirm — passt sonst
// nicht zum Spiel-Design, sondern zeigt den nackten Betriebssystem-Dialog) ──
function showConfirmModal(title, bodyText, onConfirm, opts) {
  opts = opts || {};
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-body').textContent = bodyText;
  const wrap = document.getElementById('confirm-modal-buttons');
  wrap.innerHTML = '';

  if (!opts.hideCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'menu-btn';
    cancelBtn.textContent = opts.cancelLabel || 'Abbrechen';
    cancelBtn.addEventListener('click', hideConfirmModal);
    wrap.appendChild(cancelBtn);
  }

  const okBtn = document.createElement('button');
  okBtn.className = 'menu-btn menu-btn-primary' + (opts.danger ? ' menu-btn-danger' : '');
  okBtn.textContent = opts.confirmLabel || 'Bestätigen';
  okBtn.addEventListener('click', () => { hideConfirmModal(); onConfirm(); });
  wrap.appendChild(okBtn);

  document.getElementById('confirm-modal').classList.remove('hidden');
}

// ── Saison-Ablauf-Erklärung ───────────────────────────────────────────────
// Die volle RLCS-Saisonstruktur (3 Opens -> Major -> Last Chance Qualifier
// oder direkt -> Weltmeisterschaft, ~19 Teilstufen) ist deutlich komplexer als
// das frühere Einzel-Turnier — ohne kurze Vorab-Erklärung müsste man sich die
// Zusammenhänge (wofür Punkte zählen, welche Cutoffs es gibt) erst über eine
// ganze Saison hinweg selbst erschließen. Wird beim allerersten Turnier-Start
// einer Karriere automatisch gezeigt (siehe startTournament()), danach
// jederzeit über den "❓ Saison-Ablauf"-Button auf dem Turnier-Screen abrufbar.
const SEASON_GUIDE_STEPS = [
  { icon: '🥊', html: '<strong>3 Open Qualifier</strong> — jeder läuft über 4 Formate nacheinander: Doppel-K.O. → Swiss → GSL-Gruppen → Playoffs. Deine Platzierung bringt Punkte.' },
  { icon: '📊', html: 'Nach den 3 Opens zählen deine <strong>Gesamtpunkte</strong>: die Top 16 aller Teams qualifizieren sich fürs Major.' },
  { icon: '🥇', html: '<strong>Major</strong> — Swiss → Playoffs, bringt nochmal deutlich mehr Punkte.' },
  { icon: '🌍', html: 'Nach dem Major zählen die Gesamtpunkte erneut: <strong>Top 12</strong> sind direkt für die WM qualifiziert, Rang 13-20 bekommen im <strong>Last Chance Qualifier</strong> eine letzte Chance.' },
  { icon: '👑', html: '<strong>Weltmeisterschaft</strong> — GSL-Gruppen → Playoffs. Der Sieger wird Weltmeister der Saison.' },
];

function showSeasonGuide() {
  const container = document.getElementById('season-guide-steps');
  container.innerHTML = SEASON_GUIDE_STEPS.map((s) =>
    '<div class="season-guide-step"><span class="season-guide-step-icon">' + s.icon + '</span><span>' + s.html + '</span></div>'
  ).join('') + '<div class="season-guide-footnote">Reichen deine Punkte irgendwo nicht, endet deine Saison dort — die nächste Saison startet danach ganz normal mit deinem weiterentwickelten Kader.</div>';
  document.getElementById('season-guide-modal').classList.remove('hidden');
}

function hideSeasonGuide() {
  document.getElementById('season-guide-modal').classList.add('hidden');
  if (careerState && !careerState.seasonGuideShown) {
    careerState.seasonGuideShown = true;
    saveGameState();
  }
}

function hideConfirmModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
}

// ── Auto-Update (GitHub Releases) ────────────────────────────────────────
// Läuft nur in gepackten/installierten Builds (main.js prüft app.isPackaged);
// im Dev-Modus (electron .) meldet checkForUpdates() { skipped: true }.
function showUpdateModal(title, bodyHtml) {
  document.getElementById('update-modal-title').textContent = title;
  document.getElementById('update-modal-body').innerHTML = bodyHtml;
  document.getElementById('update-modal').classList.remove('hidden');
}

function hideUpdateModal() {
  document.getElementById('update-modal').classList.add('hidden');
}

function setUpdateModalButtons(buttons) {
  const wrap = document.getElementById('update-modal-buttons');
  wrap.innerHTML = '';
  buttons.forEach(([label, primary, onClick]) => {
    const btn = document.createElement('button');
    btn.className = 'menu-btn' + (primary ? ' menu-btn-primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    wrap.appendChild(btn);
  });
}

function showUpdateCheckStatus(text) {
  const el = document.getElementById('update-check-status');
  el.textContent = text;
  clearTimeout(el._statusTimeout);
  el._statusTimeout = setTimeout(() => { el.textContent = ''; }, 4000);
}

window.electronAPI.onUpdateAvailable((info) => {
  showUpdateModal(
    'Update verfügbar — v' + info.version,
    'Eine neue Version von RLCS Legends ist verfügbar. Jetzt herunterladen und beim nächsten Neustart installieren?'
  );
  setUpdateModalButtons([
    ['Jetzt aktualisieren', true, () => {
      window.electronAPI.downloadUpdate();
      showUpdateModal('Update wird geladen…', '<div id="update-progress-text">0%</div>');
      setUpdateModalButtons([]);
    }],
    ['Später', false, hideUpdateModal],
  ]);
});

window.electronAPI.onUpdateProgress((pct) => {
  const el = document.getElementById('update-progress-text');
  if (el) el.textContent = pct + '%';
});

window.electronAPI.onUpdateDownloaded(() => {
  showUpdateModal('Update bereit', 'Die neue Version wurde heruntergeladen. Jetzt neu starten, um sie zu installieren?');
  setUpdateModalButtons([
    ['Jetzt neu starten', true, () => window.electronAPI.installUpdate()],
    ['Später', false, hideUpdateModal],
  ]);
});

window.electronAPI.onUpdateNotAvailable(() => showUpdateCheckStatus('Du hast bereits die neueste Version.'));
window.electronAPI.onUpdateError(() => showUpdateCheckStatus('Update-Prüfung fehlgeschlagen.'));

async function manualCheckForUpdates() {
  showUpdateCheckStatus('Suche nach Updates…');
  const result = await window.electronAPI.checkForUpdates();
  if (result.skipped) showUpdateCheckStatus('Update-Prüfung nur in installierten Versionen verfügbar.');
}

document.getElementById('btn-check-update').addEventListener('click', manualCheckForUpdates);

// User-Wunsch: "Neues Spiel" führt direkt zur Slot-Auswahl (keine eigene
// Modus-Auswahl-Seite mehr dazwischen) -- Randomizer Challenge ist ohnehin
// "Kommt noch" und nie klickbar, Karriere war also faktisch schon immer die
// einzige echte Wahl. #screen-mode-select bleibt im Code bestehen (falls
// später mit einem echten zweiten Modus wieder gebraucht), ist aber von
// hier aus nicht mehr erreichbar.
document.getElementById('btn-new-game').addEventListener('click', () => { gameMode = 'career'; openSlotPicker('new'); });
document.getElementById('btn-create-slot').addEventListener('click', async () => {
  const slots = await window.electronAPI.listSaveSlots();
  const emptySlot = slots.find((s) => !s.exists);
  if (emptySlot) onSlotChosen(emptySlot);
});
document.getElementById('btn-back-to-menu-mode').addEventListener('click', goToMenu);
document.getElementById('mode-card-career').addEventListener('click', () => { gameMode = 'career'; openSlotPicker('new'); });
// mode-card-randomizer bleibt bewusst ohne Klick-Handler — "Kommt noch", nicht spielbar.
// User-Wunsch: "Fortsetzen" lädt DIREKT den zuvor per initContinueButton()
// ermittelten (und in der Karte angezeigten) Spielstand, statt erst die
// Slot-Auswahl-Sidebar zu öffnen -- "Spielstand laden" bleibt der Weg, um
// gezielt einen ANDEREN Slot zu wählen.
document.getElementById('btn-continue').addEventListener('click', () => {
  const slotId = Number(document.getElementById('btn-continue').dataset.slotId);
  if (!slotId) return;
  currentSlotId = slotId;
  loadGameState();
});
document.getElementById('btn-load-game').addEventListener('click', () => openSlotPicker('continue'));
document.getElementById('btn-back-to-menu-slots').addEventListener('click', closeSlotPicker);
document.getElementById('btn-spin').addEventListener('click', spinReel);
document.getElementById('btn-modal-continue').addEventListener('click', confirmOrgAndProceed);
document.getElementById('btn-quit').addEventListener('click', () => window.electronAPI.quitApp());
document.getElementById('btn-back-to-menu-intro').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-character').addEventListener('click', closeCharacterOverlay);
document.getElementById('btn-back-to-menu-orgselect').addEventListener('click', goToOrgModeSelect);
document.getElementById('btn-org-mode-back').addEventListener('click', goToCharacterCreation);
document.getElementById('org-mode-existing').addEventListener('click', (e) => selectOrgMode('existing', e.currentTarget));
document.getElementById('org-mode-create').addEventListener('click', (e) => selectOrgMode('create', e.currentTarget));
document.getElementById('btn-org-mode-continue').addEventListener('click', () => {
  if (selectedOrgMode === 'existing') goToOrgSelection();
  else if (selectedOrgMode === 'create') goToOrgCreate();
});
document.getElementById('btn-back-to-menu-orgcreate').addEventListener('click', goToOrgModeSelect);
document.getElementById('btn-org-contract-back').addEventListener('click', () => showScreen(contractBackScreen));
document.getElementById('btn-org-contract-continue').addEventListener('click', () => {
  if (!contractSigned) {
    document.getElementById('org-contract-signature-error').classList.remove('hidden');
    return;
  }
  confirmOrgAndProceed();
});
document.getElementById('btn-org-contract-clear-signature').addEventListener('click', clearContractSignature);
document.getElementById('opt-ceo-fireable').addEventListener('click', (e) => e.currentTarget.classList.toggle('is-active'));
document.querySelectorAll('.org-contract-lock-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.org-contract-lock-option').forEach((b) => b.classList.toggle('is-active', b === btn));
  });
});
document.getElementById('org-create-nation-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('org-create-nation-menu').classList.toggle('hidden');
});
document.getElementById('org-create-color-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('org-create-color-menu').classList.toggle('hidden');
});
document.querySelectorAll('#org-create-difficulty-options .org-create-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedOrgCreateDifficulty = btn.dataset.value;
    document.querySelectorAll('#org-create-difficulty-options .org-create-option').forEach((b) => b.classList.toggle('is-active', b === btn));
  });
});
document.getElementById('btn-org-create-fill-agents').addEventListener('click', (e) => {
  orgCreateFillAgents = !orgCreateFillAgents;
  e.currentTarget.classList.toggle('is-active', orgCreateFillAgents);
});
document.getElementById('btn-org-create-logo-random').addEventListener('click', randomizeOrgCreateAll);
document.getElementById('btn-org-create-logo-upload').addEventListener('click', async () => {
  const fileUrl = await window.electronAPI.selectTeamLogoImage();
  if (fileUrl) {
    selectedOrgCreateLogoUrl = fileUrl;
    renderOrgCreateLogoPreview();
  }
});
document.getElementById('btn-org-create-logo-select').addEventListener('click', openOrgLogoPicker);
document.getElementById('btn-org-logo-picker-close').addEventListener('click', () => closeOrgLogoPicker(false));
document.getElementById('btn-org-create-submit').addEventListener('click', submitOrgCreate);
document.getElementById('btn-open-achievements').addEventListener('click', () => { renderAchievements(); showScreen('screen-achievements'); });
document.getElementById('btn-back-to-draft-achievements').addEventListener('click', () => showScreen('screen-draft'));
document.getElementById('btn-gameover-menu').addEventListener('click', goToMenu);
// Runde 99: ein gemerktes eigenes Match (pendingOwnMatch) hat Vorrang -- der
// Klick startet dann den Ticker statt den Tag weiter voranzuschieben (siehe
// triggerPendingOwnMatch()/advanceDashboardDay()).
document.getElementById('btn-dashboard-advance-day').addEventListener('click', () => {
  if (pendingOwnMatch) triggerPendingOwnMatch();
  else advanceDashboardDay();
});
// Runde 100: Schnellvorlauf-Pfeil -- ist ohnehin ausgeblendet, solange
// pendingOwnMatch offen ist (siehe renderDashboardTopbar()), der Guard in
// fastForwardToNextEventDay() selbst ist nur eine zusätzliche Absicherung.
document.getElementById('btn-dashboard-fast-forward').addEventListener('click', fastForwardToNextEventDay);
document.getElementById('btn-season-skip').addEventListener('click', onSeasonSkipClick);
document.querySelectorAll('.dashboard-sidebar-item').forEach((btn) => {
  btn.addEventListener('click', () => selectDashboardPage(btn.dataset.page));
});
document.getElementById('dashboard-settings-music-volume').addEventListener('input', (e) => {
  appSettings.musicVolume = Number(e.target.value) / 100;
  document.getElementById('dashboard-settings-music-volume-value').textContent = e.target.value + '%';
  document.getElementById('bg-music').volume = appSettings.musicVolume; // Live-Vorschau, läuft ja bereits
});
document.getElementById('dashboard-settings-music-volume').addEventListener('change', persistAppSettings);
document.getElementById('dashboard-settings-sound-volume').addEventListener('input', (e) => {
  appSettings.soundVolume = Number(e.target.value) / 100;
  document.getElementById('dashboard-settings-sound-volume-value').textContent = e.target.value + '%';
});
document.getElementById('dashboard-settings-sound-volume').addEventListener('change', persistAppSettings);
document.getElementById('dashboard-settings-intro-volume').addEventListener('input', (e) => {
  appSettings.introVideoVolume = Number(e.target.value) / 100;
  document.getElementById('dashboard-settings-intro-volume-value').textContent = e.target.value + '%';
});
document.getElementById('dashboard-settings-intro-volume').addEventListener('change', persistAppSettings);
document.getElementById('dashboard-settings-window-size').addEventListener('change', (e) => {
  appSettings.windowSize = e.target.value;
  persistAppSettings();
});
document.getElementById('dashboard-settings-ui-scale').addEventListener('change', (e) => {
  appSettings.uiScale = Number(e.target.value);
  persistAppSettings();
});
document.getElementById('dashboard-settings-fullscreen').addEventListener('click', () => {
  appSettings.displayMode = appSettings.displayMode === 'fullscreen' ? 'windowed' : 'fullscreen';
  renderDashboardSettingsPanel();
  persistAppSettings();
});
// User-Wunsch: "Beenden zum Menü" speichert automatisch den Spielstand und
// führt direkt zurück ins Hauptmenü.
document.getElementById('btn-dashboard-settings-exit').addEventListener('click', () => {
  saveGameState();
  goToMenu();
});
// User-Wunsch: kein Regler darf über das insgesamt verfügbare Geld hinaus
// nach rechts gezogen werden -- Obergrenze ist "eigener aktueller Betrag PLUS
// aktuell noch nicht eingeteiltes Geld" (siehe financeSliderCap()). Neues
// Einkommen erhöht NIE automatisch einen Regler, nur "nicht eingeteiltes
// Geld" wächst (siehe financeUnallocated()) -- der Spieler entscheidet
// manuell, wann/wohin er es verschiebt. Bug-Fix (siehe renderFinanceAllocSliders()-
// Kommentar): die Deckelung passiert jetzt rein hier im Handler ("Gummiband"
// -- zieht man über die eigene Kapazität hinaus, schnappt der Regler auf den
// tatsächlich noch verfügbaren Betrag zurück), das <input>-`max` selbst
// bleibt immer das volle Budget und schrumpft nie mehr pro Regler-Bewegung.
FINANCE_ALLOC_KEYS.forEach((key) => {
  const slider = document.getElementById('dashboard-finance-' + key + '-slider');
  slider.addEventListener('input', (e) => {
    const raw = Number(e.target.value);
    const cap = financeSliderCap(key);
    const clamped = Math.min(raw, cap);
    if (clamped !== raw) e.target.value = clamped; // nur korrigieren, wenn tatsächlich über die eigene Kapazität hinaus gezogen wurde
    financeAllocation[key] = clamped;
    renderFinanceAllocSliders(key); // eigenen Regler während der laufenden Geste nicht anfassen
  });
  slider.addEventListener('change', () => {
    renderFinanceAllocSliders(); // nach Loslassen alle 4 (inkl. des eigenen) sauber synchronisieren
    saveGameState();
    refreshDashboardSidebarBadges();
  });
});
document.querySelectorAll('.dashboard-sponsors-subtab').forEach((btn) => {
  btn.addEventListener('click', () => selectSponsorSubtab(btn.dataset.subtab));
});
document.querySelectorAll('.dashboard-sponsors-tier-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectSponsorTier(btn.dataset.tier));
});
document.getElementById('btn-tournament-cal-prev').addEventListener('click', () => shiftTournamentCalendarMonth(-1));
document.getElementById('btn-tournament-cal-next').addEventListener('click', () => shiftTournamentCalendarMonth(1));
document.getElementById('btn-tournament-detail-back').addEventListener('click', closeTournamentDetail);
document.querySelectorAll('.dashboard-tournament-detail-tab').forEach((btn) => {
  btn.addEventListener('click', () => selectTournamentDetailTab(btn.dataset.detailTab));
});
document.querySelectorAll('.dashboard-stats-region-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectStatsRegion(btn.dataset.statsRegion));
});
// Bug-Fix (live gefunden beim Bau der Transfers-Seite, Runde 114): war bisher
// über die reine CSS-Klasse `.dashboard-stats-tab` selektiert -- die Klasse
// wird aber (rein fürs Aussehen, bewusst) auch von den Transfers-Seite-Tabs
// wiederverwendet (siehe dort). Ein Klick auf einen Transfers-Tab (kein
// `data-stats-tab`-Attribut) löste dadurch UNBEABSICHTIGT auch
// `selectStatsTab(undefined)` aus und zerstörte `statsActiveTab` seitenweit,
// selbst wenn Statistiken gar nicht offen war. Attribut-Selektor statt reiner
// Klasse behebt das an der Wurzel, unabhängig davon, welche anderen Seiten
// künftig dieselbe Optik wiederverwenden.
document.querySelectorAll('[data-stats-tab]').forEach((btn) => {
  btn.addEventListener('click', () => selectStatsTab(btn.dataset.statsTab));
});
document.getElementById('dashboard-stats-search').addEventListener('input', (e) => {
  statsSearchQuery = e.target.value;
  if (statsActiveTab === 'teams') { statsPage = 1; renderStatsTable(); }
  else { statsPlayerPage = 1; renderStatsPlayerTable(); }
});
document.getElementById('btn-dashboard-stats-search-clear').addEventListener('click', () => {
  statsSearchQuery = '';
  document.getElementById('dashboard-stats-search').value = '';
  if (statsActiveTab === 'teams') { statsPage = 1; renderStatsTable(); }
  else { statsPlayerPage = 1; renderStatsPlayerTable(); }
});
document.getElementById('btn-dashboard-stats-more-info').addEventListener('click', () => {
  if (selectedStatsOrgName) openTeamInfo(selectedStatsOrgName);
});
// Keine eigene Spieler-Detail-Unterseite gebaut (Scope-Begrenzung, siehe
// Abschlussbericht) -- Stub-Hinweis statt totem Button, gleiches Muster wie
// die übrigen showConfirmModal(...)-Aufrufe in diesem Projekt.
document.getElementById('btn-dashboard-stats-player-more-info').addEventListener('click', () => {
  if (selectedStatsPlayerKey) openPersonInfoFromDevKey(selectedStatsPlayerKey, { page: 'stats' });
});
document.getElementById('btn-team-info-back').addEventListener('click', closeTeamInfo);
document.getElementById('btn-person-info-back').addEventListener('click', closePersonInfo);
document.querySelectorAll('[data-transfers-tab]').forEach((btn) => {
  btn.addEventListener('click', () => selectTransfersTab(btn.dataset.transfersTab));
});
document.querySelectorAll('[data-scouting-tab]').forEach((btn) => {
  btn.addEventListener('click', () => selectScoutingTab(btn.dataset.scoutingTab));
});
document.getElementById('dashboard-scouting-search').addEventListener('input', (e) => {
  scoutingSearchQuery = e.target.value;
  scoutingPage = 1;
  scoutingStaffPage = 1;
  renderActiveScoutingView();
});
document.getElementById('btn-dashboard-scouting-search-clear').addEventListener('click', () => {
  scoutingSearchQuery = '';
  document.getElementById('dashboard-scouting-search').value = '';
  scoutingPage = 1;
  scoutingStaffPage = 1;
  renderActiveScoutingView();
});
document.getElementById('btn-dashboard-scouting-filter').addEventListener('click', toggleScoutingFilterPanel);
document.getElementById('dashboard-scouting-filter-region').addEventListener('change', (e) => {
  scoutingRegionFilter = e.target.value;
  scoutingPage = 1;
  scoutingStaffPage = 1;
  renderActiveScoutingView();
});
document.getElementById('dashboard-scouting-filter-rating').addEventListener('change', (e) => {
  scoutingMinRating = Number(e.target.value);
  scoutingPage = 1;
  scoutingStaffPage = 1;
  renderActiveScoutingView();
});
// ── Dashboard-Seite "Kader" (Runde 119, User-Vorgabe: UI wie CS2-Referenz-
// Screenshot "Teamkader" + physischer Zustand/Moral/sprachliche
// Verständigung mit echtem Einfluss auf die Spieler UND die simulierten
// Spiele, siehe teamChemistryBonusPct()-Kopfkommentar bei
// simulateBotSeries()). Angepasst von CS2 auf Rocket League: IGL-Checkbox
// und die 5 CS2-Rollenlabels (AWPer/Rifler/Lurker/IGL/Support) haben keine
// RL-Entsprechung und wurden bewusst weggelassen -- Starter/Sub ist die
// einzige reale Rollen-Unterscheidung in diesem Projekt (wie überall sonst,
// siehe resolvePersonByIdentity()).
//
// Die "Glücklich"/"Unzufrieden"-Pille zeigt bewusst den EINEN echten Team-
// Moral-Wert (computeTeamMorale()) für jede Karte -- es gibt keine
// persistierte Pro-Spieler-Moral in diesem Projekt, eine erfundene wäre
// keine echte Auswirkung von irgendetwas. Das ist eine bewusste, ehrliche
// Vereinfachung, keine verdeckte.
function kaderCardHtml(person, isStarter, starterIndex) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === person.avatarId) || CHARACTER_AVATARS[0];
  const isHappy = computeTeamMorale(assignedOrg) >= 60;
  const moveBtn = isStarter
    ? '<button type="button" class="dashboard-roster-card-move-btn is-down" data-kader-swap="' + starterIndex + '" title="Auf die Ersatzbank setzen">↓</button>'
    : '<button type="button" class="dashboard-roster-card-move-btn is-up" data-kader-swap="0" title="In den Hauptkader aufstellen">↑</button>';
  return (
    '<div class="dashboard-roster-card">' +
      '<button type="button" class="dashboard-roster-card-info-btn" data-kader-info="' + person.name + '" data-kader-role="' + (isStarter ? 'Starter' : 'Sub') + '" title="Profil ansehen">?</button>' +
      '<div class="dashboard-roster-card-avatar" style="background:' + avatar.color + '33">' + avatar.emoji + '</div>' +
      '<img class="dashboard-roster-card-flag" src="assets/flags/' + (person.country || '').toLowerCase() + '.svg" alt="">' +
      '<div class="dashboard-roster-card-name">' + person.name + '</div>' +
      '<div class="dashboard-roster-card-pills">' +
        '<span class="dashboard-roster-card-pill ' + (isStarter ? 'is-active' : 'is-bench') + '">' + (isStarter ? 'Aktiv' : 'Ersatzbank') + '</span>' +
        '<span class="dashboard-roster-card-pill ' + (isHappy ? 'is-happy' : 'is-unhappy') + '">' + (isHappy ? 'Glücklich' : 'Unzufrieden') + '</span>' +
      '</div>' +
      moveBtn +
    '</div>'
  );
}

// Runde 122: eine Reserve-Karte zeigt bewusst nur EINE Pille ("Reserve",
// keine Glücklich/Unzufrieden-Pille wie bei Starter/Bank) -- die Team-Moral
// ist ein Team-weiter Wert und für Spieler, die ohnehin nicht mitspielen,
// keine sinnvolle Zusatzinfo.
// Runde 124, User-Vorgabe ("kann Reserve-Spieler nicht verschieben ... zu
// Sub und/oder zu Kader"): der EINE Pfeil (immer "irgendein schwächster
// Slot") war zu unklar/unvorhersehbar -- jetzt ZWEI eindeutige, benannte
// Ziele statt einem automatisch geratenen. "→ Sub" tauscht gezielt mit dem
// Ersatzspieler, "→ Kader" gezielt mit dem schwächsten STARTER (nicht Sub) --
// siehe promoteReservePlayer(reserveIndex, targetType).
function kaderReserveCardHtml(person, index) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === person.avatarId) || CHARACTER_AVATARS[0];
  return (
    '<div class="dashboard-roster-card">' +
      '<button type="button" class="dashboard-roster-card-info-btn" data-kader-info="' + person.name + '" data-kader-role="Reserve" title="Profil ansehen">?</button>' +
      '<div class="dashboard-roster-card-avatar" style="background:' + avatar.color + '33">' + avatar.emoji + '</div>' +
      '<img class="dashboard-roster-card-flag" src="assets/flags/' + (person.country || '').toLowerCase() + '.svg" alt="">' +
      '<div class="dashboard-roster-card-name">' + person.name + '</div>' +
      '<div class="dashboard-roster-card-pills">' +
        '<span class="dashboard-roster-card-pill is-bench">Reserve</span>' +
      '</div>' +
      '<div class="dashboard-roster-reserve-actions">' +
        '<button type="button" class="dashboard-roster-reserve-action-btn" data-kader-promote="' + index + '" data-kader-promote-target="sub" title="Tauscht mit dem aktuellen Ersatzspieler (Sub)">→ Sub</button>' +
        '<button type="button" class="dashboard-roster-reserve-action-btn" data-kader-promote="' + index + '" data-kader-promote-target="starter" title="Tauscht mit dem aktuell schwächsten Starter">→ Kader</button>' +
      '</div>' +
    '</div>'
  );
}

// Kompakte, bewusst NICHT interaktive Zeile für einen noch unterwegs
// befindlichen Neuzugang (User-Vorgabe: "Hinweistext dass Spieler erst in
// 7 Tagen erscheinen wird, soll dann auch wirklich so sein") -- zeigt das
// ECHTE Ankunftsdatum aus pendingPlayerArrivals, kein Platzhaltertext.
function kaderPendingArrivalHtml(entry) {
  const avatar = CHARACTER_AVATARS.find((a) => a.id === entry.player.avatarId) || CHARACTER_AVATARS[0];
  return (
    '<div class="dashboard-roster-pending-item">' +
      '<div class="dashboard-roster-pending-avatar" style="background:' + avatar.color + '33">' + avatar.emoji + '</div>' +
      '<span class="dashboard-roster-pending-name">' + entry.player.name + '</span>' +
      '<span class="dashboard-roster-pending-eta">Ankunft: ' + formatContractDate(entry.availableDate) + '</span>' +
    '</div>'
  );
}

function renderDashboardKaderPanel() {
  const org = assignedOrg;
  document.getElementById('dashboard-roster-header-logo').innerHTML = statsRowLogoHtml(org);
  document.getElementById('dashboard-roster-header-flag').src = 'assets/flags/' + (org.country || '').toLowerCase() + '.svg';
  document.getElementById('dashboard-roster-header-name').textContent = org.name;
  const region = orgRegion(org.country);
  const rows = statsTeamRows(region);
  const rank = rows.findIndex((r) => r.org.name === org.name) + 1;
  const points = seasonPoints[org.name] || 0;
  document.getElementById('dashboard-roster-header-rank').textContent = '#' + (rank || '-');
  document.getElementById('dashboard-roster-header-points').textContent = points + ' Pkt.';
  document.getElementById('dashboard-roster-header-stars').innerHTML = starsHtml(orgStarRating(org.strength));

  const condition = computeTeamPhysicalCondition(org);
  const morale = computeTeamMorale(org);
  const language = computeTeamLanguageUnderstanding(org);
  document.getElementById('dashboard-roster-chem-condition-value').textContent = condition + '%';
  document.getElementById('dashboard-roster-chem-condition-fill').style.width = condition + '%';
  document.getElementById('dashboard-roster-chem-morale-value').textContent = morale + '%';
  document.getElementById('dashboard-roster-chem-morale-fill').style.width = morale + '%';
  document.getElementById('dashboard-roster-chem-language-value').textContent = language + '%';
  document.getElementById('dashboard-roster-chem-language-fill').style.width = language + '%';

  const starters = (org.roster && org.roster.starters) || [];
  document.getElementById('dashboard-roster-starters').innerHTML = starters.length > 0
    ? starters.map((p, i) => kaderCardHtml(p, true, i)).join('')
    : '<div class="dashboard-team-info-results-empty">Noch keine Starter im Kader -- befördere Spieler aus der Reserve.</div>';
  const sub = org.roster && org.roster.sub;
  document.getElementById('dashboard-roster-bench').innerHTML = sub
    ? kaderCardHtml(sub, false, null)
    : '<div class="dashboard-team-info-results-empty">Kein Ersatzspieler im Kader.</div>';

  const reserve = (org.roster && org.roster.reserve) || [];
  document.getElementById('dashboard-roster-reserve-count').textContent = '(' + reserve.length + '/' + KADER_RESERVE_SLOTS + ')';
  document.getElementById('dashboard-roster-reserve').innerHTML = reserve.length > 0
    ? reserve.map((p, i) => kaderReserveCardHtml(p, i)).join('')
    : '<div class="dashboard-team-info-results-empty">Keine Reserve-Spieler -- gekaufte Neuzugänge landen hier.</div>';
  document.getElementById('dashboard-roster-pending').innerHTML = pendingPlayerArrivals.length > 0
    ? '<div class="dashboard-roster-pending-title">Unterwegs</div>' + pendingPlayerArrivals.map(kaderPendingArrivalHtml).join('')
    : '';

  document.querySelectorAll('[data-kader-info]').forEach((btn) => {
    btn.addEventListener('click', () => openPersonInfo(org.name, btn.dataset.kaderInfo, btn.dataset.kaderRole, { page: 'roster' }));
  });
  document.querySelectorAll('[data-kader-swap]').forEach((btn) => {
    btn.addEventListener('click', () => swapKaderRosterSlot(Number(btn.dataset.kaderSwap)));
  });
  document.querySelectorAll('[data-kader-promote]').forEach((btn) => {
    btn.addEventListener('click', () => promoteReservePlayer(Number(btn.dataset.kaderPromote), btn.dataset.kaderPromoteTarget));
  });
}

// Ein einziger, symmetrischer Tausch-Mechanismus für BEIDE Pfeile: der rote
// Runter-Pfeil auf einer Starter-Karte tauscht diesen konkreten Starter-
// Slot mit dem Ersatzspieler, der grüne Rauf-Pfeil auf der Bank-Karte
// tauscht den Ersatzspieler IMMER mit Starter-Slot 0 (bei genau 3 Startern +
// 1 Sub und nur einem Bank-Pfeil im Referenz-Screenshot gibt es keine
// eindeutigere Standardauswahl ohne zusätzliche, dort nicht gezeigte UI).
// Bleibt dadurch IMMER bei exakt 3 Startern + 1 Sub -- reiner Slot-Tausch,
// kein Hinzufügen/Entfernen.
function swapKaderRosterSlot(starterIndex) {
  const roster = assignedOrg.roster;
  if (!roster || !roster.sub || !roster.starters[starterIndex]) return;
  const starter = roster.starters[starterIndex];
  roster.starters[starterIndex] = roster.sub;
  roster.sub = starter;
  assignedOrg.strength = computeOrgStrengthFromRoster(roster);
  saveGameState();
  renderDashboardKaderPanel();
}

// Runde 122, überarbeitet Runde 124 (gezielte Sub-/Kader-Buttons statt eines
// unklaren Auto-Pfeils), Bug-Fix Runde 125 (User-Meldung: "wenn ich bei
// Kader kein Spieler habe ... wird nur einer verschoben, kann nicht alle
// drei einzeln reinverschieben"): die alte Fassung ging IMMER von einem
// bereits VOLLEN Slot aus (Starter/Sub durch Reserve-Spieler ERSETZEN). Bei
// einer neu erstellten Org OHNE Free-Agent-Auffüllung ist roster.starters
// aber anfangs leer bzw. unter 3 Einträgen und roster.sub kann null sein --
// `roster.starters[weakestIdx] = reservePlayer` überschrieb dabei IMMER
// index 0 (statt die Lücken 1/2 zu füllen), und der leere Sub-Fall brach
// sogar komplett ab (`if (!roster.sub) return;`), sodass buchstäblich nichts
// passierte. Füllt jetzt zuerst echte LEERE Plätze (push statt Ersetzen),
// bevor überhaupt ein bestehender Spieler verdrängt wird.
function promoteReservePlayer(reserveIndex, targetType) {
  const roster = assignedOrg.roster;
  const reservePlayer = roster.reserve && roster.reserve[reserveIndex];
  if (!reservePlayer) return;

  if (targetType === 'sub') {
    const demoted = roster.sub;
    roster.sub = reservePlayer;
    if (demoted) roster.reserve[reserveIndex] = demoted;
    else roster.reserve.splice(reserveIndex, 1); // Sub-Slot war leer -- kein Tausch-Partner, Reserve schrumpft
  } else if (roster.starters.length < MAIN_SIZE) {
    roster.starters.push(reservePlayer); // freier Starter-Platz -- einfach auffüllen, nichts zu ersetzen
    roster.reserve.splice(reserveIndex, 1);
  } else {
    const weakestIdx = roster.starters.reduce((minIdx, p, i, arr) => (p.overall < arr[minIdx].overall ? i : minIdx), 0);
    const demoted = roster.starters[weakestIdx];
    roster.starters[weakestIdx] = reservePlayer;
    roster.reserve[reserveIndex] = demoted;
  }

  assignedOrg.strength = computeOrgStrengthFromRoster(roster);
  saveGameState();
  renderDashboardKaderPanel();
}

document.getElementById('btn-dashboard-roster-details').addEventListener('click', () => {
  if (assignedOrg) openTeamInfo(assignedOrg.name, 'roster');
});

document.getElementById('btn-sponsor-request-close').addEventListener('click', closeSponsorRequestPopup);
document.getElementById('btn-sponsor-request-cancel').addEventListener('click', closeSponsorRequestPopup);
document.getElementById('btn-sponsor-request-confirm').addEventListener('click', confirmSponsorRequest);
document.getElementById('btn-character-continue').addEventListener('click', confirmCharacterAndProceed);
document.getElementById('char-nick-input').addEventListener('input', updateCharacterContinueState);
document.getElementById('char-firstname-input').addEventListener('input', updateCharacterContinueState);
document.getElementById('char-lastname-input').addEventListener('input', updateCharacterContinueState);
document.getElementById('char-nation-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('char-nation-menu').classList.toggle('hidden');
});
document.getElementById('org-select-region-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('org-select-region-menu').classList.toggle('hidden');
});
document.getElementById('org-select-search-input').addEventListener('input', (e) => {
  orgSelectSearchQuery = e.target.value;
  orgSelectPage = 1;
  renderOrgSelectList();
});
document.getElementById('org-select-prev').addEventListener('click', () => {
  if (orgSelectPage > 1) { orgSelectPage--; renderOrgSelectList(); }
});
document.getElementById('org-select-next').addEventListener('click', () => {
  orgSelectPage++;
  renderOrgSelectList();
});
// Generisch für ALLE .char-dropdown-Instanzen (Nation bei der Charakter-
// erstellung, Regionsfilter bei der Org-Auswahl, künftige weitere) -- ein
// Klick außerhalb eines Dropdowns schließt dessen Menü.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.char-dropdown').forEach((dropdown) => {
    if (!dropdown.contains(e.target)) {
      const menu = dropdown.querySelector('.char-dropdown-menu');
      if (menu) menu.classList.add('hidden');
    }
  });
});
document.getElementById('char-birthday-day').addEventListener('change', updateCharacterContinueState);
document.getElementById('char-birthday-month').addEventListener('change', updateCharacterContinueState);
document.getElementById('char-birthday-year').addEventListener('change', updateCharacterContinueState);
document.getElementById('btn-character-random-birthdate').addEventListener('click', randomizeCharacterBirthdate);
document.getElementById('btn-character-randomize-traits').addEventListener('click', randomizeCharacterTraits);
document.getElementById('btn-character-randomize-all').addEventListener('click', randomizeAllCharacterFields);
document.getElementById('btn-character-quickstart').addEventListener('click', openManagerPicker);
document.querySelectorAll('.character-gender-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedCharacterGender = btn.dataset.gender;
    document.querySelectorAll('.character-gender-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    assignCharacterAvatar();
    assignRandomPortrait(); // neues Geschlecht -> neues, passendes Zufalls-Portrait
    // Portrait-Sidebar live neu filtern, falls sie gerade offen ist -- User-
    // Wunsch: F/M-Umschalten zeigt sofort die passenden Vorlagen.
    if (!document.getElementById('portrait-picker-sidebar').classList.contains('hidden')) {
      renderPortraitPickerGrid();
    }
  });
});
document.getElementById('btn-character-randomize-identity').addEventListener('click', randomizeCharacterIdentity);
document.getElementById('btn-character-portrait-upload').addEventListener('click', async () => {
  const fileUrl = await window.electronAPI.selectPortraitImage();
  if (fileUrl) {
    selectedCharacterPortraitUrl = fileUrl;
    renderCharacterPortraitPreview();
  }
});
document.getElementById('btn-character-portrait-select').addEventListener('click', openPortraitPicker);
document.getElementById('btn-portrait-picker-close').addEventListener('click', () => closePortraitPicker(false));
document.getElementById('btn-manager-picker-close').addEventListener('click', () => closeManagerPicker(false));
document.getElementById('btn-back-to-menu-draft').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-match').addEventListener('click', () => matchOnFinished && matchOnFinished());
document.getElementById('btn-match-continue').addEventListener('click', () => matchOnFinished && matchOnFinished());
document.getElementById('btn-start-match').addEventListener('click', startTournament);
document.getElementById('btn-speed-1').addEventListener('click', () => setMatchSpeed(1));
document.getElementById('btn-speed-2').addEventListener('click', () => setMatchSpeed(2));
document.getElementById('btn-speed-4').addEventListener('click', () => setMatchSpeed(4));
document.getElementById('btn-speed-8').addEventListener('click', () => setMatchSpeed(8));
document.getElementById('btn-speed-16').addEventListener('click', () => setMatchSpeed(16));
document.getElementById('btn-speed-32').addEventListener('click', () => setMatchSpeed(32));
document.getElementById('btn-instant-sim').addEventListener('click', instantFinishCurrentGame);
document.getElementById('btn-back-to-menu-tournament').addEventListener('click', goToMenu);
document.getElementById('btn-tournament-action').addEventListener('click', onTournamentActionClick);
document.getElementById('btn-quick-sim-round').addEventListener('click', quickSimulateCurrentRound);
document.getElementById('btn-quick-sim-all').addEventListener('click', quickSimulateEntireTournament);
document.getElementById('btn-season-guide').addEventListener('click', showSeasonGuide);
document.getElementById('btn-season-guide-close').addEventListener('click', hideSeasonGuide);
document.getElementById('btn-standings').addEventListener('click', showStandings);
document.getElementById('btn-standings-close').addEventListener('click', hideStandings);
document.getElementById('btn-settings').addEventListener('click', openSettingsScreen);
document.getElementById('btn-settings-cancel').addEventListener('click', cancelSettingsModal);
document.getElementById('btn-settings-save').addEventListener('click', saveSettingsModal);
document.getElementById('btn-settings-reset').addEventListener('click', resetSettingsToDefaults);
document.querySelectorAll('.settings-category-btn').forEach((btn) => {
  btn.addEventListener('click', () => showSettingsCategory(btn.dataset.settingsCategory));
});
document.getElementById('settings-auto-update').addEventListener('change', (e) => {
  draftSettings.autoCheckUpdates = e.target.checked;
});
document.getElementById('settings-remember-bounds').addEventListener('change', (e) => {
  draftSettings.rememberWindowBounds = e.target.checked;
});
document.getElementById('settings-sound-enabled').addEventListener('change', (e) => {
  draftSettings.soundEnabled = e.target.checked;
});
document.getElementById('btn-settings-sound-test').addEventListener('click', () => {
  // Testton hört bewusst den ENTWURFSWERT (nicht den gespeicherten) — sonst
  // könnte man eine neue Lautstärke vor dem Speichern nie ausprobieren.
  playTestSound(draftSettings.soundEnabled ? draftSettings.soundVolume : 0);
});
document.getElementById('btn-negotiation-cancel').addEventListener('click', hideNegotiationModal);
document.getElementById('btn-negotiation-send').addEventListener('click', sendNegotiationOffer);
document.getElementById('btn-feedback').addEventListener('click', openFeedbackModal);
document.getElementById('btn-feedback-cancel').addEventListener('click', hideFeedbackModal);
document.getElementById('btn-feedback-send').addEventListener('click', sendFeedback);
document.querySelectorAll('.feedback-star').forEach((star) => {
  star.addEventListener('click', () => {
    feedbackRatingValue = Number(star.dataset.value);
    renderFeedbackStars();
  });
  star.addEventListener('mouseenter', () => renderFeedbackStars(Number(star.dataset.value)));
});
document.getElementById('feedback-stars').addEventListener('mouseleave', () => renderFeedbackStars());
document.getElementById('feedback-message').addEventListener('input', (e) => {
  document.getElementById('feedback-char-count').textContent = e.target.value.length + ' / 800';
});
document.getElementById('btn-incoming-offer-decline').addEventListener('click', declineIncomingOffer);
document.getElementById('btn-incoming-offer-counter').addEventListener('click', sendIncomingOfferCounter);
document.getElementById('btn-incoming-offer-accept').addEventListener('click', () => acceptIncomingOffer(currentIncomingOffer.offerPrice));
document.getElementById('btn-open-transfers').addEventListener('click', () => { renderTransferLog(); showScreen('screen-transfers'); });
document.getElementById('btn-back-to-draft-transfers').addEventListener('click', () => showScreen('screen-draft'));
document.getElementById('btn-back-to-draft-roster').addEventListener('click', () => showScreen('screen-draft'));
