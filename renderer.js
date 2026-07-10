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

// Spielmodus — aktuell nur 'career' spielbar, 'randomizer' ist als zweiter
// Modus angekündigt (ausgegraut in der Auswahl) aber noch nicht implementiert.
// Wird pro Speicherstand mitgespeichert, damit die Fortsetzen-Liste zeigt,
// welcher Modus in welchem Slot läuft.
let gameMode = 'career';

// ── Einstellungen (globale App-Präferenzen, siehe main.js settings.json) ──
let appSettings = { autoCheckUpdates: true, defaultMatchSpeed: 1, quickSimPace: 'normal' };
const SETTINGS_SPEED_OPTIONS = [1, 2, 4, 8, 16, 32];
const SETTINGS_PACE_OPTIONS = [
  { id: 'normal', label: 'Normal', ms: 700 },
  { id: 'fast', label: 'Schnell', ms: 250 },
  { id: 'instant', label: 'Sofort', ms: 0 },
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

// Rivalitäten: Bot-Teams bleiben über die gesamte Karriere bestehen (statt
// jedes Turnier neu gewürfelt zu werden) und entwickeln sich zwischen Saisons
// weiter (developBotTeams() in bot-teams.js). careerRivalRecords trackt die
// Kopf-an-Kopf-Bilanz gegen jede einzelne Bot-Org, keyed nach Org-Name.
let careerBotTeams = null;
let careerRivalRecords = {};

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
  priceEl.textContent = price.toLocaleString('de-DE') + ' Cr';
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
    ' unter Vertrag. Aktuelle Forderung: ' + Math.round(askPrice).toLocaleString('de-DE') + ' Cr.';
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
  appendNegotiationLine('user', 'Angebot: ' + offer.toLocaleString('de-DE') + ' Cr.');
  messageInput.value = '';

  if (offer > getRemaining()) {
    appendNegotiationLine('system', 'Das kannst du dir nicht leisten — dein Budget reicht dafür nicht aus.');
    return; // zählt nicht als Verhandlungsversuch, ist nur eine UI-Validierung
  }

  st.attempts += 1;
  const ratio = offer / st.askPrice;

  if (ratio < NEGOTIATION_INSTANT_REJECT_RATIO) {
    appendNegotiationLine('org', 'Das ist unverschämt wenig — wir verlangen ' + Math.round(st.askPrice).toLocaleString('de-DE') + ' Cr, kein Grund für uns, darüber überhaupt nachzudenken.');
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
      appendNegotiationLine('org', 'Abgemacht — ' + player.name + ' wechselt für ' + offer.toLocaleString('de-DE') + ' Cr zu ' + assignedOrg.name + '.');
      appendNegotiationLine('player', 'Neue Herausforderung, neues Kapitel. Ich bin dabei.');
      completeNegotiationSuccess(offer);
      return;
    }
    st.frustration = Math.min(NEGOTIATION_FRUSTRATION_MAX, st.frustration + 15 * findCharacterPath(careerCharacter.pathId).frustrationMultiplier);
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
    st.frustration = Math.min(NEGOTIATION_FRUSTRATION_MAX, st.frustration + (25 - messageBonus * 100) * findCharacterPath(careerCharacter.pathId).frustrationMultiplier);
    if (Math.round(st.askPrice) < Math.round(oldAsk)) {
      appendNegotiationLine('org', 'Das ist uns noch zu wenig, aber wir bewegen uns: ' + Math.round(oldAsk).toLocaleString('de-DE') + ' Cr -> ' + Math.round(st.askPrice).toLocaleString('de-DE') + ' Cr wäre inzwischen unsere Untergrenze.');
    } else {
      appendNegotiationLine('org', 'Weiter unter unserer Schmerzgrenze von ' + Math.round(st.askPrice).toLocaleString('de-DE') + ' Cr — mehr geht bei uns gerade nicht runter.');
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

function generateBotTrades() {
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

    const price = Math.round(calculatePrice(bestPlayer.overall) * (1 + Math.random() * 0.5) / 5) * 5;
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
      const offerPrice = Math.round(calculatePrice(best.overall) * multiplier / 5) * 5;
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
    weakest.name + ' (' + weakest.overall + ' Overall). Erstes Angebot: ' + offerPrice.toLocaleString('de-DE') + ' Cr.';

  document.getElementById('incoming-offer-log').innerHTML = '';
  appendIncomingOfferLine('org', 'Wir würden uns über ' + player.name + ' in unserem Kader sehr freuen. Wärt ihr für ' + offerPrice.toLocaleString('de-DE') + ' Cr bereit, ihn/sie ziehen zu lassen?');

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
  appendIncomingOfferLine('user', 'Unsere Forderung: ' + counterPrice.toLocaleString('de-DE') + ' Cr.');
  messageInput.value = '';

  // Je mehr über dem ursprünglichen Angebot gefordert wird, desto unwilliger
  // wird die Org — dasselbe Prinzip wie beim Abwerben, nur umgekehrt.
  const demandSurplus = (counterPrice - offerPrice) / Math.max(1, offerPrice);
  const messageBonus = analyzeNegotiationMessage(message);
  let chance = 0.6 - demandSurplus * 0.5 + messageBonus;
  chance = Math.max(0.05, Math.min(0.9, chance));

  if (Math.random() < chance) {
    appendIncomingOfferLine('org', 'Abgemacht — wir zahlen ' + counterPrice.toLocaleString('de-DE') + ' Cr für ' + player.name + '.');
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

  const pro = document.createElement('div');
  pro.className = 'org-line org-pro';
  pro.textContent = '+ ' + assignedOrg.pro;
  panel.appendChild(pro);

  const con = document.createElement('div');
  con.className = 'org-line org-con';
  con.textContent = '– ' + assignedOrg.con;
  panel.appendChild(con);
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
  remainingChip.textContent = 'Verbleibend: ' + remaining.toLocaleString('de-DE') + ' Cr / ' + BUDGET + ' Cr';
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
    '<span class="slot-price">' + price + ' Cr</span>';
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
}

// ── Screen-Wechsel ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

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
      '<span class="transfer-row-price">' + entry.price.toLocaleString('de-DE') + ' Cr</span>';
    container.appendChild(row);
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
// eigenen Charakter (Name/Geburtsdatum/Herkunft/Weg). Der Weg bringt einen
// klaren spielmechanischen Effekt (siehe data/character-paths.js), nicht nur
// Flavourtext. "Manager" im UI wird ab hier durch den Charakternamen ersetzt.
let careerCharacter = null; // { name, birthdate, region, pathId }
let selectedCharacterPathId = null; // transiente Auswahl während der Erstellung

function goToCharacterCreation() {
  careerCharacter = null;
  document.getElementById('char-name-input').value = '';
  document.getElementById('char-birthdate-input').value = '';
  document.getElementById('char-region-select').value = 'EU';
  document.getElementById('character-error').classList.add('hidden');
  selectedCharacterPathId = null;
  renderCharacterPathList();
  updateCharacterContinueState();
  showScreen('screen-character');
}

function renderCharacterPathList() {
  const container = document.getElementById('character-path-list');
  container.innerHTML = '';
  CHARACTER_PATHS.forEach((path) => {
    const card = document.createElement('div');
    card.className = 'character-path-card' + (path.id === selectedCharacterPathId ? ' selected' : '');
    const effectClass = path.budgetMultiplier > 1 || path.developmentBonus > 0 || path.seasonIncomeBonus > 0 || path.frustrationMultiplier < 1
      ? 'effect-bonus'
      : path.budgetMultiplier < 1
        ? 'effect-malus'
        : 'effect-neutral';
    card.innerHTML =
      '<div class="character-path-title">' + path.title + '</div>' +
      '<div class="character-path-desc">' + path.description + '</div>' +
      '<div class="character-path-effect ' + effectClass + '">' + path.effectLabel + '</div>';
    card.addEventListener('click', () => {
      selectedCharacterPathId = path.id;
      renderCharacterPathList();
      updateCharacterContinueState();
    });
    container.appendChild(card);
  });
}

function updateCharacterContinueState() {
  const name = document.getElementById('char-name-input').value.trim();
  const ready = name.length > 0 && !!selectedCharacterPathId;
  document.getElementById('btn-character-continue').disabled = !ready;
}

function confirmCharacterAndProceed() {
  const name = document.getElementById('char-name-input').value.trim();
  if (!name || !selectedCharacterPathId) {
    const err = document.getElementById('character-error');
    err.textContent = 'Bitte Name eingeben und einen Weg auswählen.';
    err.classList.remove('hidden');
    return;
  }
  careerCharacter = {
    name,
    birthdate: document.getElementById('char-birthdate-input').value || null,
    region: document.getElementById('char-region-select').value,
    pathId: selectedCharacterPathId,
  };
  goToOrgSelection();
}

// ── Org-Auswahlmenü (ersetzt den Zufalls-Automat in der Karriere) ────────
// User-Wunsch: statt einer zufälligen Zuweisung wählt man seine Org jetzt
// selbst aus einem Menü, das alle Boni/Mali zeigt. Der alte Zufalls-Automat
// (goToOrgIntro()/spinReel(), weiter unten) bleibt im Code erhalten, wird
// aber im Karriere-Modus nicht mehr aufgerufen — er ist für den späteren
// Randomizer-Challenge-Modus vorgesehen (der genau diese Zufallszuweisung
// nutzen soll).
function goToOrgSelection() {
  document.getElementById('org-select-heading').textContent = 'Willkommen, ' + careerCharacter.name;
  renderOrgSelectGrid();
  showScreen('screen-org-select');
}

function renderOrgSelectGrid() {
  const grid = document.getElementById('org-select-grid');
  grid.innerHTML = '';

  ORGANIZATIONS.slice().sort((a, b) => b.strength - a.strength).forEach((org) => {
    const instance = instantiateOrg(org);
    const card = document.createElement('div');
    card.className = 'org-select-card';
    card.innerHTML =
      '<div class="org-select-card-header">' +
        '<span class="org-select-card-name">' + org.name + '</span>' +
        '<span class="org-select-card-strength">Stärke ' + org.strength + '</span>' +
      '</div>' +
      '<div class="org-select-card-budget">Startbudget: ' + org.budget.toLocaleString('de-DE') + ' Cr</div>' +
      '<div class="org-select-card-line line-pro">+ ' + instance.pro + '</div>' +
      '<div class="org-select-card-line line-con">– ' + instance.con + '</div>';
    card.addEventListener('click', () => {
      pendingOrg = instance;
      showOrgModal(pendingOrg);
    });
    grid.appendChild(card);
  });

  const customCard = document.createElement('div');
  customCard.className = 'org-select-card org-select-card-disabled';
  customCard.innerHTML =
    '<div class="org-select-card-header"><span class="org-select-card-name">Eigene Organisation</span></div>' +
    '<div class="org-select-card-soon">Kommt noch...</div>';
  grid.appendChild(customCard);
  // customCard bekommt bewusst KEINEN Klick-Handler — "Kommt noch", nicht wählbar.
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
    '<div class="org-line org-pro">+ ' + org.pro + '</div>' +
    '<div class="org-line org-con">– ' + org.con + '</div>' +
    '<div class="modal-budget">Startbudget: ' + org.budget.toLocaleString('de-DE') + ' Cr</div>';
  document.getElementById('org-modal').classList.remove('hidden');
}

function confirmOrgAndProceed() {
  document.getElementById('org-modal').classList.add('hidden');
  assignedOrg = pendingOrg;
  gameMode = 'career'; // aktuell der einzige spielbare Modus
  const charPath = findCharacterPath(careerCharacter.pathId);
  BUDGET = Math.round(assignedOrg.budget * charPath.budgetMultiplier / 10) * 10;
  rosterSlots = { main: emptySlotArray(MAIN_SIZE), sub: emptySlotArray(SUB_SIZE), reserve: emptySlotArray(RESERVE_SIZE) };
  draftedCoachName = null;
  negotiatedPremiumPlayers = {};
  negotiationBlocklist = {};
  playersTradedThisSeason = new Set();
  transferLog = [];
  tournamentState = null;
  careerState = { seasonNumber: 1, titlesWon: 0, seasonGuideShown: false };
  careerRosterPlayers = null;
  careerReservePlayers = null;
  careerCoach = null;
  // Bot-Teams (inkl. Vertrags-Zuordnung echter Spieler) schon HIER erzeugen,
  // nicht erst bei startTournament() — die Markt-/Draft-Ansicht muss von
  // Anfang an wissen, welche Spieler schon anderswo unter Vertrag sind.
  careerBotTeams = generateBotTeams(TOURNAMENT_TEAM_COUNT - 1, assignedOrg.name);
  careerRivalRecords = {};
  showScreen('screen-draft');
  renderAll();
  saveGameState();
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
    { sub: playerTeam.sub, coach: playerTeam.coach, orgMatchBonusPct: assignedOrg.matchBonusPct }
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
  const charPath = findCharacterPath(careerCharacter.pathId);
  STAT_LABELS.forEach(([key]) => {
    const drift = Math.round((Math.random() * 6 - 2.5) + performanceFactor * 4) + charPath.developmentBonus;
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
  let income = 250 + Math.round(winRatio * 400);
  if (wasChampion) income += 500;
  const charPath = findCharacterPath(careerCharacter.pathId);
  income += charPath.seasonIncomeBonus;
  return income;
}

function startNextSeason() {
  const playerTeam = findTournamentTeam('player');
  const wasChampion = seasonState.finalChampionId === 'player';
  // Erfolgsfaktor über die GESAMTE Saison (alle Events, nicht nur das letzte
  // gespielte) — seasonState.playerWins/-Losses akkumulieren das laufend
  // (siehe accumulatePlayerRecord(), aufgerufen am Ende jedes Events).
  const performanceFactor = seasonState.playerWins / Math.max(1, seasonState.playerWins + seasonState.playerLosses); // 0..1

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
  careerState.seasonNumber += 1;
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
    version: 9, gameMode, careerCharacter, assignedOrg, BUDGET, rosterSlots, draftedCoachName, tournamentState,
    careerState, careerRosterPlayers, careerReservePlayers, careerCoach, careerBotTeams, careerRivalRecords,
    negotiatedPremiumPlayers, negotiationBlocklist, transferLog,
    playersTradedThisSeason: Array.from(playersTradedThisSeason),
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
  gameMode = data.gameMode || 'career'; // ältere Spielstände (v1-v7) kannten nur Karriere
  // ältere Spielstände (v1-v8) kannten noch keinen Charakter — Fallback auf
  // neutralen Weg, damit findCharacterPath() nirgends auf null trifft.
  careerCharacter = data.careerCharacter || { name: 'Manager', birthdate: null, region: 'EU', pathId: 'newcomer' };
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

  if (tournamentState) {
    renderTournamentScreen();
    showScreen('screen-tournament');
  } else {
    renderAll();
    showScreen('screen-draft');
  }
}

async function initContinueButton() {
  const slots = await window.electronAPI.listSaveSlots();
  const btn = document.getElementById('btn-continue');
  const hasSave = slots.some((s) => s.exists);
  btn.disabled = !hasSave;
  if (hasSave) btn.removeAttribute('title');
  else btn.title = 'Noch kein Spielstand vorhanden';
}
initContinueButton();

// ── Einstellungen (Hauptmenü-Popup) ───────────────────────────────────────
async function initSettings() {
  appSettings = await window.electronAPI.getSettings();
  setMatchSpeed(appSettings.defaultMatchSpeed);
}
initSettings();

function renderSettingsModal() {
  const speedWrap = document.getElementById('settings-speed-options');
  speedWrap.innerHTML = SETTINGS_SPEED_OPTIONS.map((s) =>
    '<button class="settings-speed-btn' + (appSettings.defaultMatchSpeed === s ? ' is-active' : '') + '" data-speed="' + s + '">×' + s + '</button>'
  ).join('');
  speedWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appSettings.defaultMatchSpeed = Number(btn.dataset.speed);
      setMatchSpeed(appSettings.defaultMatchSpeed);
      window.electronAPI.saveSettings(appSettings);
      renderSettingsModal();
    });
  });

  const paceWrap = document.getElementById('settings-pace-options');
  paceWrap.innerHTML = SETTINGS_PACE_OPTIONS.map((o) =>
    '<button class="settings-speed-btn' + (appSettings.quickSimPace === o.id ? ' is-active' : '') + '" data-pace="' + o.id + '">' + o.label + '</button>'
  ).join('');
  paceWrap.querySelectorAll('.settings-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appSettings.quickSimPace = btn.dataset.pace;
      window.electronAPI.saveSettings(appSettings);
      renderSettingsModal();
    });
  });

  document.getElementById('settings-auto-update').checked = appSettings.autoCheckUpdates;
}

function showSettingsModal() {
  renderSettingsModal();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function hideSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function resetSettingsToDefaults() {
  appSettings = { autoCheckUpdates: true, defaultMatchSpeed: 1, quickSimPace: 'normal' };
  setMatchSpeed(appSettings.defaultMatchSpeed);
  window.electronAPI.saveSettings(appSettings);
  renderSettingsModal();
}

// Der "Fortsetzen"-Button wird nur bei App-Start einmalig geprüft — ohne diesen
// Refresh bliebe er nach dem ERSTEN Speicherstand der Session fälschlich
// deaktiviert, da sich sein disabled-Status sonst nie mehr aktualisiert.
function goToMenu() {
  showScreen('screen-menu');
  initContinueButton();
}

// Öffnet die Speicherstand-Auswahl. 'new': jeder Slot wählbar (Überschreiben
// wird bei belegten Slots bestätigt), 'continue': nur belegte Slots wählbar.
function openSlotPicker(mode) {
  slotPickerMode = mode;
  document.getElementById('slots-title').textContent =
    mode === 'new' ? 'Neues Spiel — Speicherstand wählen' : 'Fortsetzen — Speicherstand wählen';
  showScreen('screen-slots');
  renderSlotsList();
}

async function renderSlotsList() {
  const slots = await window.electronAPI.listSaveSlots();
  const container = document.getElementById('slots-list');
  container.innerHTML = '';

  slots.forEach((slot) => {
    const card = document.createElement('div');
    const canSelect = slotPickerMode === 'new' || slot.exists;
    card.className = 'slot-card' + (slot.exists ? '' : ' slot-empty') + (canSelect ? '' : ' slot-disabled');

    if (slot.exists) {
      const modeLabel = slot.gameMode === 'randomizer' ? 'Randomizer Challenge' : 'Karriere';
      card.innerHTML =
        '<div class="slot-org">Speicherstand ' + slot.slotId + ' — ' + slot.characterName + ' (' + slot.orgName + ')' +
        '<span class="slot-mode-tag">' + modeLabel + '</span></div>' +
        '<div class="slot-meta">Saison ' + slot.seasonNumber + ' — ' + slot.titlesWon + ' Titel</div>';

      const delBtn = document.createElement('button');
      delBtn.className = 'slot-delete-btn';
      delBtn.textContent = '✕ Löschen';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.electronAPI.deleteSave(slot.slotId);
        renderSlotsList();
        initContinueButton();
      });
      card.appendChild(delBtn);
    } else {
      card.innerHTML = '<div class="slot-empty-label">Speicherstand ' + slot.slotId + ' — leer</div>';
    }

    if (canSelect) card.addEventListener('click', () => onSlotChosen(slot));
    container.appendChild(card);
  });
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

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'menu-btn';
  cancelBtn.textContent = opts.cancelLabel || 'Abbrechen';
  cancelBtn.addEventListener('click', hideConfirmModal);

  const okBtn = document.createElement('button');
  okBtn.className = 'menu-btn menu-btn-primary' + (opts.danger ? ' menu-btn-danger' : '');
  okBtn.textContent = opts.confirmLabel || 'Bestätigen';
  okBtn.addEventListener('click', () => { hideConfirmModal(); onConfirm(); });

  wrap.appendChild(cancelBtn);
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

document.getElementById('btn-new-game').addEventListener('click', () => showScreen('screen-mode-select'));
document.getElementById('btn-back-to-menu-mode').addEventListener('click', goToMenu);
document.getElementById('mode-card-career').addEventListener('click', () => { gameMode = 'career'; openSlotPicker('new'); });
// mode-card-randomizer bleibt bewusst ohne Klick-Handler — "Kommt noch", nicht spielbar.
document.getElementById('btn-continue').addEventListener('click', () => openSlotPicker('continue'));
document.getElementById('btn-back-to-menu-slots').addEventListener('click', goToMenu);
document.getElementById('btn-spin').addEventListener('click', spinReel);
document.getElementById('btn-modal-continue').addEventListener('click', confirmOrgAndProceed);
document.getElementById('btn-quit').addEventListener('click', () => window.electronAPI.quitApp());
document.getElementById('btn-back-to-menu-intro').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-character').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-orgselect').addEventListener('click', goToMenu);
document.getElementById('btn-character-continue').addEventListener('click', confirmCharacterAndProceed);
document.getElementById('char-name-input').addEventListener('input', updateCharacterContinueState);
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
document.getElementById('btn-settings').addEventListener('click', showSettingsModal);
document.getElementById('btn-settings-close').addEventListener('click', hideSettingsModal);
document.getElementById('btn-settings-reset').addEventListener('click', resetSettingsToDefaults);
document.getElementById('settings-auto-update').addEventListener('change', (e) => {
  appSettings.autoCheckUpdates = e.target.checked;
  window.electronAPI.saveSettings(appSettings);
});
document.getElementById('btn-negotiation-cancel').addEventListener('click', hideNegotiationModal);
document.getElementById('btn-negotiation-send').addEventListener('click', sendNegotiationOffer);
document.getElementById('btn-incoming-offer-decline').addEventListener('click', declineIncomingOffer);
document.getElementById('btn-incoming-offer-counter').addEventListener('click', sendIncomingOfferCounter);
document.getElementById('btn-incoming-offer-accept').addEventListener('click', () => acceptIncomingOffer(currentIncomingOffer.offerPrice));
document.getElementById('btn-open-transfers').addEventListener('click', () => { renderTransferLog(); showScreen('screen-transfers'); });
document.getElementById('btn-back-to-draft-transfers').addEventListener('click', () => showScreen('screen-draft'));
document.getElementById('btn-back-to-draft-roster').addEventListener('click', () => showScreen('screen-draft'));
