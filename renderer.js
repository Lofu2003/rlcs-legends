const MAIN_SIZE = 3;
const SUB_SIZE = 1;
const TOTAL_PLAYER_PICKS = MAIN_SIZE + SUB_SIZE;

const STAT_LABELS = [
  ['mechanics', 'MEC'],
  ['gameSense', 'GS'],
  ['speed', 'SPD'],
  ['shooting', 'SHO'],
  ['defending', 'DEF'],
  ['boostMgmt', 'BST'],
];

const COACH_STAT_LABELS = [
  ['taktik', 'TAK'],
  ['teamgeist', 'TMG'],
  ['entwicklung', 'ENT'],
];

// Wird erst bei "Neues Spiel" gesetzt (siehe startNewGame())
let assignedOrg = null;
let BUDGET = 0;

let draftedPlayerNames = [];   // Reihenfolge zählt: erste MAIN_SIZE = Starter, Rest = Sub
let draftedCoachName = null;

// ── Karriere-Kontinuität über mehrere Saisons ────────────────────────────
// careerState existiert ab der ersten Saison und trackt Saison-Nummer + Titel.
// careerRosterPlayers/careerCoach enthalten die AKTUELLE (ggf. weiterentwickelte)
// Version der eigenen Kader-Spieler — als eigenständige Kopien, NICHT als
// Referenz auf TEST_PLAYERS, damit Entwicklung den geteilten Spieler-Pool nicht
// dauerhaft verändert (sonst würde ein späteres "Neues Spiel" in derselben
// App-Sitzung bereits hochentwickelte Spieler im Pool vorfinden).
let careerState = null;
let careerRosterPlayers = null;
let careerCoach = null;

function tierForOverall(overall) {
  if (overall >= 85) return 'tier-diamond';
  if (overall >= 78) return 'tier-gold';
  if (overall >= 70) return 'tier-silver';
  return 'tier-bronze';
}

// Karriere-entwickelte Version hat Vorrang vor dem statischen Pool — dadurch
// zeigen draftedPlayerNames/findPlayer(name) automatisch überall (Kader,
// Preisberechnung, Pool-Anzeige) den aktuellen Entwicklungsstand, ohne dass
// jede aufrufende Stelle das extra wissen muss.
function findPlayer(name) {
  const developed = careerRosterPlayers && careerRosterPlayers.find((p) => p.name === name);
  return developed || TEST_PLAYERS.find((p) => p.name === name);
}
function findCoach(name) {
  if (careerCoach && careerCoach.name === name) return careerCoach;
  return TEST_COACHES.find((c) => c.name === name);
}

function getSpent() {
  const playerSpend = draftedPlayerNames.reduce((sum, n) => sum + calculatePrice(findPlayer(n).overall), 0);
  const coachSpend = draftedCoachName ? calculatePrice(findCoach(draftedCoachName).overall) : 0;
  return playerSpend + coachSpend;
}

function getRemaining() { return BUDGET - getSpent(); }

function toggleDraftPlayer(player) {
  const idx = draftedPlayerNames.indexOf(player.name);
  if (idx >= 0) {
    draftedPlayerNames.splice(idx, 1);
  } else {
    if (draftedPlayerNames.length >= TOTAL_PLAYER_PICKS) return;
    if (calculatePrice(player.overall) > getRemaining()) return;
    draftedPlayerNames.push(player.name);
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

function buildCard({ overall, name, price, isDrafted, isLocked, statPairs, extraClass, onClick }) {
  const card = document.createElement('div');
  card.className = 'player-card ' + tierForOverall(overall) + (extraClass ? ' ' + extraClass : '');
  if (isDrafted) card.classList.add('is-drafted');
  if (isLocked) card.classList.add('is-locked');
  card.addEventListener('click', onClick);

  if (isDrafted) {
    const badge = document.createElement('div');
    badge.className = 'drafted-badge';
    badge.textContent = '✓ GEDRAFTET';
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

function buildPlayerCard(p) {
  const price = calculatePrice(p.overall);
  const isDrafted = draftedPlayerNames.includes(p.name);
  const rosterFull = draftedPlayerNames.length >= TOTAL_PLAYER_PICKS;
  const canAfford = price <= getRemaining();
  const isLocked = !isDrafted && (rosterFull || !canAfford);

  return buildCard({
    overall: p.overall,
    name: p.name,
    price,
    isDrafted,
    isLocked,
    statPairs: STAT_LABELS.map(([key, label]) => [key, label, p[key]]),
    onClick: () => toggleDraftPlayer(p),
  });
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
  const startersCount = Math.min(draftedPlayerNames.length, MAIN_SIZE);
  const subCount = Math.max(0, Math.min(draftedPlayerNames.length - MAIN_SIZE, SUB_SIZE));

  const makeChip = (text) => {
    const chip = document.createElement('span');
    chip.className = 'budget-chip';
    chip.textContent = text;
    return chip;
  };

  bar.appendChild(makeChip('Spieler: ' + startersCount + ' / ' + MAIN_SIZE));
  bar.appendChild(makeChip('Sub: ' + subCount + ' / ' + SUB_SIZE));
  bar.appendChild(makeChip('Coach: ' + (draftedCoachName ? '1' : '0') + ' / 1'));

  const remainingChip = document.createElement('span');
  remainingChip.className = 'budget-chip budget-remaining' + (remaining < 0 ? ' budget-over' : '');
  remainingChip.textContent = 'Verbleibend: ' + remaining.toLocaleString('de-DE') + ' Cr / ' + BUDGET + ' Cr';
  bar.appendChild(remainingChip);
}

function renderMatchButton() {
  const btn = document.getElementById('btn-start-match');
  const startersReady = draftedPlayerNames.length >= MAIN_SIZE;
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

  for (let i = 0; i < MAIN_SIZE; i++) {
    const name = draftedPlayerNames[i];
    renderRosterSlot(slots, 'Starter ' + (i + 1), () =>
      name ? buildSlotContent(name, calculatePrice(findPlayer(name).overall)) : null);
  }
  for (let i = MAIN_SIZE; i < MAIN_SIZE + SUB_SIZE; i++) {
    const name = draftedPlayerNames[i];
    renderRosterSlot(slots, 'Sub', () =>
      name ? buildSlotContent(name, calculatePrice(findPlayer(name).overall)) : null);
  }
  renderRosterSlot(slots, 'Coach', () =>
    draftedCoachName ? buildSlotContent(draftedCoachName, calculatePrice(findCoach(draftedCoachName).overall)) : null);

  section.appendChild(slots);
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

// ── Org-Zuweisung: Intro-Seite → Spielautomat → Popup → Kader ───────────
const REEL_ITEM_HEIGHT = 60;
const REEL_LAPS = 5;

let pendingOrg = null; // schon zufällig bestimmt, aber dem Spieler noch nicht gezeigt

function goToOrgIntro() {
  pendingOrg = assignRandomOrg();
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
  BUDGET = assignedOrg.budget;
  draftedPlayerNames = [];
  draftedCoachName = null;
  tournamentState = null;
  careerState = { seasonNumber: 1, titlesWon: 0 };
  careerRosterPlayers = null;
  careerCoach = null;
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
}

// ── Turnier: echtes Swiss-Bracket-Format (r1 → r2w/r2l → r3-Decider → Playoffs) ──
let tournamentState = null;
let tournamentAutoSimRunning = false; // true während "Turnier sofort simulieren" läuft

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function findTournamentTeam(id) {
  return tournamentState.teams.find((t) => t.id === id);
}

// Liefert die Matches der aktuell zu spielenden Stufe als flache Liste.
function getCurrentStageMatches() {
  const ts = tournamentState;
  if (ts.stage === 'r1') return ts.r1;
  if (ts.stage === 'r2') return ts.r2w.concat(ts.r2l);
  if (ts.stage === 'r3') return ts.r3;
  if (ts.stage === 'playoff-semi') return [ts.sf1, ts.sf2];
  if (ts.stage === 'playoff-final') return [ts.final];
  return [];
}

function findPlayerMatch() {
  return getCurrentStageMatches().find((m) => m.aId === 'player' || m.bId === 'player');
}

function startTournament() {
  const myStarters = draftedPlayerNames.slice(0, MAIN_SIZE).map(findPlayer);
  const subName = draftedPlayerNames[MAIN_SIZE];
  const mySub = subName ? findPlayer(subName) : null;
  const myCoach = draftedCoachName ? findCoach(draftedCoachName) : null;

  const botTeams = generateBotTeams(7);
  const teams = [
    createTournamentTeam('player', assignedOrg.name, true, myStarters, mySub, myCoach),
    ...botTeams.map((b, i) => createTournamentTeam('bot' + i, b.name, false, b.players, null, null)),
  ];

  tournamentState = {
    teams,
    stage: 'r1',
    r1: pairGroup(teams, SWISS_BEST_OF),
    r2w: null, r2l: null, r3: null, sf1: null, sf2: null, final: null,
    stageMatchPlayed: false,
    playerStatusNote: null,
    playerEliminated: false,
    champion: null,
  };

  renderTournamentScreen();
  showScreen('screen-tournament');
  saveGameState();
}

function stageTitle(ts) {
  if (ts.stage === 'r1') return 'Swiss-Stage — Runde 1 (0-0, Bo5)';
  if (ts.stage === 'r2') return 'Swiss-Stage — Runde 2 (1-0 / 0-1, Bo5)';
  if (ts.stage === 'r3') return 'Swiss-Stage — Decider-Runde (1-1, Bo5)';
  if (ts.stage === 'playoff-semi') return 'Playoffs — Halbfinale (Bo7)';
  if (ts.stage === 'playoff-final') return 'Playoffs — Finale (Bo7)';
  return '';
}

function renderTournamentScreen() {
  const ts = tournamentState;
  const titleEl = document.getElementById('tournament-title');
  const banner = document.getElementById('tournament-champion-banner');
  const actionBtn = document.getElementById('btn-tournament-action');
  const quickSimRoundBtn = document.getElementById('btn-quick-sim-round');
  const quickSimAllBtn = document.getElementById('btn-quick-sim-all');

  if (ts.stage === 'complete') {
    const totalTitles = careerState.titlesWon + (ts.champion.isPlayer ? 1 : 0);
    titleEl.textContent = 'Saison ' + careerState.seasonNumber + ' beendet';
    banner.classList.remove('hidden');
    banner.textContent = '🏆 ' + ts.champion.name + ' ist Champion!' + (ts.champion.isPlayer ? ' (das bist du!)' : '')
      + ' — Titel gesamt: ' + totalTitles;
    actionBtn.textContent = 'Nächste Saison starten';
    quickSimRoundBtn.classList.add('hidden');
    quickSimAllBtn.classList.add('hidden');
  } else {
    banner.classList.add('hidden');
    let title = stageTitle(ts);
    if (ts.playerStatusNote) title += ' — ' + ts.playerStatusNote;
    titleEl.textContent = title;
    actionBtn.textContent = ts.stageMatchPlayed ? 'Weiter' : 'Match spielen';
    quickSimRoundBtn.classList.toggle('hidden', ts.stageMatchPlayed || tournamentAutoSimRunning);
    quickSimAllBtn.classList.toggle('hidden', tournamentAutoSimRunning);
  }

  actionBtn.disabled = tournamentAutoSimRunning;
  renderSwissBracket();
}

function onTournamentActionClick() {
  const ts = tournamentState;

  if (ts.stage === 'complete') {
    startNextSeason();
    return;
  }

  if (!ts.stageMatchPlayed) {
    const playerMatch = findPlayerMatch();
    const stageMatches = getCurrentStageMatches();

    if (!playerMatch) {
      // Spieler ist ausgeschieden ODER schon qualifiziert und wartet — die gesamte
      // Stufe läuft ohne Ticker durch, er sieht nur die Ergebnisse.
      stageMatches.forEach((m) => simulateFullSeriesInstant(ts.teams, m, simulateMatch));
      ts.stageMatchPlayed = true;
      renderTournamentScreen();
      saveGameState();
      return;
    }

    // Alle Bot-vs-Bot-Serien dieser Stufe sofort simulieren (kein Ticker nötig)
    stageMatches.forEach((m) => {
      if (m === playerMatch) return;
      simulateFullSeriesInstant(ts.teams, m, simulateMatch);
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
function quickSimulateCurrentRound() {
  const ts = tournamentState;
  if (ts.stage === 'complete' || ts.stageMatchPlayed) return;
  getCurrentStageMatches().forEach((m) => simulateFullSeriesInstant(ts.teams, m, simulateMatch));
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
  if (tournamentState.stage === 'complete' || tournamentAutoSimRunning) return;

  tournamentAutoSimRunning = true;
  renderTournamentScreen();

  while (tournamentState.stage !== 'complete') {
    const ts = tournamentState;
    if (!ts.stageMatchPlayed) {
      getCurrentStageMatches().forEach((m) => simulateFullSeriesInstant(ts.teams, m, simulateMatch));
      ts.stageMatchPlayed = true;
      renderTournamentScreen();
      await sleep(700);
    }
    advanceTournamentStage(); // rendert + speichert bereits selbst
    if (tournamentState.stage !== 'complete') await sleep(700);
  }

  tournamentAutoSimRunning = false;
  renderTournamentScreen();
}

// Spielt EIN Einzelspiel innerhalb der aktuellen Bo5/Bo7-Serie des Spielers.
// Ist die Serie danach noch nicht entschieden, führt der "Weiter"-Button auf
// dem Match-Screen direkt ins nächste Einzelspiel derselben Serie (statt
// zurück zum Turnier-Screen) — der Spieler bleibt also auf dem Match-Screen,
// bis die Serie entschieden ist.
function playNextSeriesGame(match, opponent, playerIsA) {
  const ts = tournamentState;
  const playerTeam = findTournamentTeam('player');
  const preGameWinsA = match.seriesWinsA;
  const preGameWinsB = match.seriesWinsB;
  const gameNumber = match.games.length + 1;

  const result = simulateMatch(
    playerTeam.players, opponent.players, playerTeam.name, opponent.name,
    { sub: playerTeam.sub, coach: playerTeam.coach, orgMatchBonusPct: assignedOrg.matchBonusPct }
  );

  // result.scoreA/-B beziehen sich immer auf "playerTeam vs. opponent" (so wurde
  // simulateMatch aufgerufen) — für die Serie (aId/bId) muss das je nach
  // playerIsA in der richtigen Reihenfolge eingetragen werden.
  const goalsA = playerIsA ? result.scoreA : result.scoreB;
  const goalsB = playerIsA ? result.scoreB : result.scoreA;
  recordSeriesGame(ts.teams, match, goalsA, goalsB);

  const seriesDone = match.played;
  if (seriesDone) ts.stageMatchPlayed = true;
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
      seriesDone,
      continueLabel: seriesDone ? 'Weiter zum Turnier' : 'Nächstes Spiel (Serie ' + playerSeriesWins + ':' + opponentSeriesWins + ')',
    }
  );
}

function advanceTournamentStage() {
  const ts = tournamentState;

  if (ts.stage === 'r1') {
    const winners = ts.r1.map((m) => winnerOf(ts.teams, m));
    const losers = ts.r1.map((m) => loserOf(ts.teams, m));
    ts.r2w = pairGroup(winners, SWISS_BEST_OF);
    ts.r2l = pairGroup(losers, SWISS_BEST_OF);
    ts.stage = 'r2';
    ts.stageMatchPlayed = false;
  } else if (ts.stage === 'r2') {
    const qual20 = ts.r2w.map((m) => winnerOf(ts.teams, m));
    const elim02 = ts.r2l.map((m) => loserOf(ts.teams, m));
    const decider = [...ts.r2w.map((m) => loserOf(ts.teams, m)), ...ts.r2l.map((m) => winnerOf(ts.teams, m))];
    ts.qual20 = qual20; // für Playoff-Seeding gebraucht
    ts.elim02 = elim02;
    ts.r3 = pairGroup(decider, SWISS_BEST_OF);
    ts.stage = 'r3';
    ts.stageMatchPlayed = false;

    if (elim02.some((t) => t.id === 'player')) ts.playerEliminated = true;
  } else if (ts.stage === 'r3') {
    const qual21 = ts.r3.map((m) => winnerOf(ts.teams, m));
    const elim12 = ts.r3.map((m) => loserOf(ts.teams, m));
    const seeded = seedPlayoffs(ts.qual20, qual21);
    ts.sf1 = createSeriesMatch(seeded[0], seeded[3], PLAYOFF_BEST_OF);
    ts.sf2 = createSeriesMatch(seeded[1], seeded[2], PLAYOFF_BEST_OF);
    ts.stage = 'playoff-semi';
    ts.stageMatchPlayed = false;

    if (elim12.some((t) => t.id === 'player')) ts.playerEliminated = true;
  } else if (ts.stage === 'playoff-semi') {
    const w1 = winnerOf(ts.teams, ts.sf1);
    const w2 = winnerOf(ts.teams, ts.sf2);
    ts.final = createSeriesMatch(w1, w2, PLAYOFF_BEST_OF);
    ts.stage = 'playoff-final';
    ts.stageMatchPlayed = false;

    const playerWasInSemis = ts.sf1.aId === 'player' || ts.sf1.bId === 'player' ||
                              ts.sf2.aId === 'player' || ts.sf2.bId === 'player';
    if (playerWasInSemis && w1.id !== 'player' && w2.id !== 'player') ts.playerEliminated = true;
  } else if (ts.stage === 'playoff-final') {
    ts.champion = winnerOf(ts.teams, ts.final);
    ts.stage = 'complete';
  }

  // Status-Hinweis wird IMMER frisch abgeleitet (nicht nur beim Übergang selbst
  // gesetzt) — sonst geht die "ausgeschieden"-Meldung in einer späteren Stufe
  // verloren, in der der Spieler ohnehin nicht mehr mitspielt.
  if (ts.stage !== 'complete') {
    const player = findTournamentTeam('player');
    const inCurrentStage = getCurrentStageMatches().some((m) => m.aId === 'player' || m.bId === 'player');
    if (inCurrentStage) {
      ts.playerStatusNote = null;
    } else if (ts.playerEliminated) {
      ts.playerStatusNote = 'du bist ausgeschieden (' + player.wins + '-' + player.losses + ') — das Turnier läuft weiter';
    } else {
      ts.playerStatusNote = 'du bist qualifiziert (' + player.wins + '-' + player.losses + ') — wartest auf die nächste Runde';
    }
  }

  renderTournamentScreen();
  saveGameState();
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
  STAT_LABELS.forEach(([key]) => {
    const drift = Math.round((Math.random() * 6 - 2.5) + performanceFactor * 4);
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
  return income;
}

function startNextSeason() {
  const ts = tournamentState;
  const playerTeam = findTournamentTeam('player');
  const wasChampion = ts.champion.id === 'player';
  const performanceFactor = playerTeam.wins / Math.max(1, playerTeam.wins + playerTeam.losses); // 0..1

  const developedStarters = playerTeam.players.map((p) => developPlayer(p, performanceFactor));
  const developedSub = playerTeam.sub ? developPlayer(playerTeam.sub, performanceFactor) : null;
  const developedCoach = playerTeam.coach ? developCoach(playerTeam.coach, performanceFactor) : null;

  careerRosterPlayers = developedSub ? [...developedStarters, developedSub] : developedStarters;
  careerCoach = developedCoach;

  const income = calculateSeasonIncome(playerTeam, wasChampion);
  const rosterValue = careerRosterPlayers.reduce((sum, p) => sum + calculatePrice(p.overall), 0)
    + (careerCoach ? calculatePrice(careerCoach.overall) : 0);
  BUDGET = rosterValue + income;

  draftedPlayerNames = developedStarters.map((p) => p.name).concat(developedSub ? [developedSub.name] : []);
  draftedCoachName = developedCoach ? developedCoach.name : null;

  if (wasChampion) careerState.titlesWon += 1;
  careerState.seasonNumber += 1;

  tournamentState = null;
  showScreen('screen-draft');
  renderAll();
  saveGameState();
}

// ── Swiss-Bracket-Visualisierung (SVG) — angelehnt an Lykon Regional Grid ────
const BR_HH  = 30;   // Kopfzeilen-Höhe
const BR_MH  = 38;   // Match-Zeilen-Höhe ("Team1 vs Team2")
const BR_SH  = 32;   // Slot-Zeilen-Höhe (einzelnes Team)
const BR_MS  = 3;    // Abstand zwischen Matches innerhalb einer Gruppe
const BR_GG  = 16;   // Abstand zwischen Gruppen-Boxen in derselben Spalte
const BR_W1  = 220;  // Breite Spalte 1 (0-0, alle 8 Teams)
const BR_W2  = 200;  // Breite Spalten 2-4
const BR_CG  = 50;   // Spaltenabstand

const BR_C1X = 10;
const BR_C2X = BR_C1X + BR_W1 + BR_CG;
const BR_C3X = BR_C2X + BR_W2 + BR_CG;
const BR_C4X = BR_C3X + BR_W2 + BR_CG;

const BR_R1H    = BR_HH + 4 * BR_MH + 3 * BR_MS;
const BR_R2H    = BR_HH + 2 * BR_MH + 1 * BR_MS;
const BR_SLOT2H = BR_HH + 2 * BR_SH;

const BR_TOP  = 20;
const BR_R2W_Y = BR_TOP;
const BR_R2L_Y = BR_TOP + BR_R2H + BR_GG;
const BR_R1_Y  = BR_TOP + Math.round(((BR_R2H * 2 + BR_GG) - BR_R1H) / 2);

const BR_QUAL20_Y = BR_TOP;
const BR_R3_Y     = BR_TOP + BR_SLOT2H + BR_GG;
const BR_ELIM02_Y = BR_R3_Y + BR_R2H + BR_GG;

const BR_R3_CY_VAL = BR_R3_Y + BR_R2H / 2;
const BR_C4_SPAN    = BR_SLOT2H * 2 + BR_GG;
const BR_QUAL21_Y  = Math.round(BR_R3_CY_VAL - BR_C4_SPAN / 2);
const BR_ELIM12_Y  = BR_QUAL21_Y + BR_SLOT2H + BR_GG;

const COL_BLUE = '#3b82f6', COL_GREEN = '#22c55e', COL_AMBER = '#f59e0b',
      COL_RED = '#ef4444', COL_GOLD = '#f59e0b', COL_PURPLE = '#7c3aed';

function brMatchY(groupY, i) { return groupY + BR_HH + i * (BR_MH + BR_MS); }
function brSlotY(groupY, i)  { return groupY + BR_HH + i * BR_SH; }

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function truncateName(name) {
  return name.length > 15 ? name.slice(0, 14) + '…' : name;
}

function svgLine(x1, y1, x2, y2, color) {
  const mx = Math.round((x1 + x2) / 2);
  return '<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2 + '" ' +
    'stroke="' + color + '" stroke-width="2" fill="none" opacity="0.85" />';
}

function svgGroupBox(x, y, w, h, label, sublabel, color, innerSvg) {
  const hasSubLabel = !!sublabel;
  const labelY = hasSubLabel ? y + BR_HH / 2 + 1 : y + BR_HH / 2 + 5;
  const sublabelY = y + BR_HH - 6;
  return (
    '<rect x="' + (x - 1) + '" y="' + (y - 1) + '" width="' + (w + 2) + '" height="' + (h + 2) + '" rx="7" fill="none" stroke="' + color + '" stroke-opacity="0.12" stroke-width="3" />' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="#080f1e" stroke="' + color + '" stroke-opacity="0.5" stroke-width="1.5" />' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + BR_HH + '" rx="6" fill="' + color + '" fill-opacity="0.2" />' +
    '<rect x="' + (x + 6) + '" y="' + (y + BR_HH - 1) + '" width="' + (w - 12) + '" height="1" fill="' + color + '" fill-opacity="0.35" />' +
    '<text x="' + (x + w / 2) + '" y="' + labelY + '" text-anchor="middle" fill="' + color + '" font-size="' + (hasSubLabel ? 11 : 12) + '" font-family="monospace" font-weight="700" letter-spacing="2" opacity="0.95">' + label + '</text>' +
    (sublabel ? '<text x="' + (x + w / 2) + '" y="' + sublabelY + '" text-anchor="middle" fill="' + color + '" font-size="7.5" font-family="monospace" font-weight="700" letter-spacing="1.5" opacity="0.65">' + sublabel + '</text>' : '') +
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

function renderSwissBracket() {
  const ts = tournamentState;
  const container = document.getElementById('bracket-container');

  const r1cy  = BR_R1_Y + BR_R1H / 2;
  const r2wcy = BR_R2W_Y + BR_R2H / 2;
  const r2lcy = BR_R2L_Y + BR_R2H / 2;
  const q20cy = BR_QUAL20_Y + BR_SLOT2H / 2;
  const r3cy  = BR_R3_Y + BR_R2H / 2;
  const e02cy = BR_ELIM02_Y + BR_SLOT2H / 2;
  const q21cy = BR_QUAL21_Y + BR_SLOT2H / 2;
  const e12cy = BR_ELIM12_Y + BR_SLOT2H / 2;

  const r1_rx = BR_C1X + BR_W1;
  const r2_rx = BR_C2X + BR_W2;
  const r3_rx = BR_C3X + BR_W2;

  const svgH = Math.max(BR_R1_Y + BR_R1H, BR_R2L_Y + BR_R2H, BR_ELIM02_Y + BR_SLOT2H, BR_ELIM12_Y + BR_SLOT2H) + 20;
  const svgW = BR_C4X + BR_W2 + 10;

  const hasR2 = ts.r2w !== null;
  const hasR3 = ts.r3 !== null;
  const hasPlayoffs = ts.stage === 'playoff-semi' || ts.stage === 'playoff-final' || ts.stage === 'complete';

  const qual20 = ts.qual20 || [null, null];
  const elim02 = ts.elim02 || [null, null];
  const qual21 = hasR3 ? ts.r3.map((m) => winnerOf(ts.teams, m)) : [null, null];
  const elim12 = hasR3 ? ts.r3.map((m) => loserOf(ts.teams, m)) : [null, null];

  let svg = '';

  if (hasR2) {
    svg += svgLine(r1_rx, r1cy, BR_C2X, r2wcy, '#ffffff');
    svg += svgLine(r1_rx, r1cy, BR_C2X, r2lcy, '#ffffff');
  }
  if (hasR3) {
    svg += svgLine(r2_rx, r2wcy, BR_C3X, q20cy, '#ffffff');
    svg += svgLine(r2_rx, r2wcy, BR_C3X, r3cy, '#ffffff');
    svg += svgLine(r2_rx, r2lcy, BR_C3X, r3cy, '#ffffff');
    svg += svgLine(r2_rx, r2lcy, BR_C3X, e02cy, '#ffffff');
  }
  if (hasPlayoffs) {
    svg += svgLine(r3_rx, r3cy, BR_C4X, q21cy, '#ffffff');
    svg += svgLine(r3_rx, r3cy, BR_C4X, e12cy, '#ffffff');
  }

  let c1Inner = '';
  for (let i = 0; i < 4; i++) c1Inner += svgMatchRow(BR_C1X, brMatchY(BR_R1_Y, i), BR_W1, ts.r1[i], i > 0);
  svg += svgGroupBox(BR_C1X, BR_R1_Y, BR_W1, BR_R1H, '0 – 0', 'BO5', COL_BLUE, c1Inner);

  if (hasR2) {
    let c2wInner = '';
    for (let i = 0; i < 2; i++) c2wInner += svgMatchRow(BR_C2X, brMatchY(BR_R2W_Y, i), BR_W2, ts.r2w[i], i > 0);
    svg += svgGroupBox(BR_C2X, BR_R2W_Y, BR_W2, BR_R2H, '1 – 0', 'BO5', COL_GREEN, c2wInner);

    let c2lInner = '';
    for (let i = 0; i < 2; i++) c2lInner += svgMatchRow(BR_C2X, brMatchY(BR_R2L_Y, i), BR_W2, ts.r2l[i], i > 0);
    svg += svgGroupBox(BR_C2X, BR_R2L_Y, BR_W2, BR_R2H, '0 – 1', 'BO5', COL_AMBER, c2lInner);
  }

  if (hasR3) {
    let q20Inner = '';
    for (let i = 0; i < 2; i++) q20Inner += svgSlotRow(BR_C3X, brSlotY(BR_QUAL20_Y, i), BR_W2, qual20[i], i > 0);
    svg += svgGroupBox(BR_C3X, BR_QUAL20_Y, BR_W2, BR_SLOT2H, '2 – 0', 'QUALIFIZIERT', COL_GREEN, q20Inner);

    let r3Inner = '';
    for (let i = 0; i < 2; i++) r3Inner += svgMatchRow(BR_C3X, brMatchY(BR_R3_Y, i), BR_W2, ts.r3[i], i > 0);
    svg += svgGroupBox(BR_C3X, BR_R3_Y, BR_W2, BR_R2H, '1 – 1', 'BO5', COL_AMBER, r3Inner);

    let e02Inner = '';
    for (let i = 0; i < 2; i++) e02Inner += svgSlotRow(BR_C3X, brSlotY(BR_ELIM02_Y, i), BR_W2, elim02[i], i > 0);
    svg += svgGroupBox(BR_C3X, BR_ELIM02_Y, BR_W2, BR_SLOT2H, '0 – 2', 'ELIMINIERT', COL_RED, e02Inner);
  }

  if (hasPlayoffs) {
    let q21Inner = '';
    for (let i = 0; i < 2; i++) q21Inner += svgSlotRow(BR_C4X, brSlotY(BR_QUAL21_Y, i), BR_W2, qual21[i], i > 0);
    svg += svgGroupBox(BR_C4X, BR_QUAL21_Y, BR_W2, BR_SLOT2H, '2 – 1', 'QUALIFIZIERT', COL_GREEN, q21Inner);

    let e12Inner = '';
    for (let i = 0; i < 2; i++) e12Inner += svgSlotRow(BR_C4X, brSlotY(BR_ELIM12_Y, i), BR_W2, elim12[i], i > 0);
    svg += svgGroupBox(BR_C4X, BR_ELIM12_Y, BR_W2, BR_SLOT2H, '1 – 2', 'ELIMINIERT', COL_RED, e12Inner);
  }

  let html = '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" style="width:100%;max-width:1000px;display:block;">' + svg + '</svg>';

  if (hasPlayoffs) html += renderPlayoffSvg();

  container.innerHTML = html;
}

const PP_W    = 220;
const PP_CG   = 60;
const PP_BH   = BR_HH + BR_MH;
const PP_GAP  = 20;
const PP_SX   = 10;
const PP_FX   = PP_SX + PP_W + PP_CG;
const PP_SF1_Y = 10;
const PP_SF2_Y = PP_SF1_Y + PP_BH + PP_GAP;
const PP_FIN_Y = Math.round((PP_SF1_Y + PP_SF2_Y) / 2);
const PP_SVG_H = Math.max(PP_SF2_Y + PP_BH, PP_FIN_Y + PP_BH) + 16;
const PP_SVG_W = PP_FX + PP_W + 10;

function renderPlayoffSvg() {
  const ts = tournamentState;
  let svg = '';
  svg += svgLine(PP_SX + PP_W, PP_SF1_Y + PP_BH / 2, PP_FX, PP_FIN_Y + PP_BH / 2, COL_GOLD);
  svg += svgLine(PP_SX + PP_W, PP_SF2_Y + PP_BH / 2, PP_FX, PP_FIN_Y + PP_BH / 2, COL_GOLD);

  svg += svgGroupBox(PP_SX, PP_SF1_Y, PP_W, PP_BH, 'HALBFINALE 1', 'BO7', COL_PURPLE, svgMatchRow(PP_SX, PP_SF1_Y + BR_HH, PP_W, ts.sf1, false));
  svg += svgGroupBox(PP_SX, PP_SF2_Y, PP_W, PP_BH, 'HALBFINALE 2', 'BO7', COL_PURPLE, svgMatchRow(PP_SX, PP_SF2_Y + BR_HH, PP_W, ts.sf2, false));
  svg += svgGroupBox(PP_FX, PP_FIN_Y, PP_W, PP_BH, 'FINALE', 'BO7', COL_GOLD, ts.final ? svgMatchRow(PP_FX, PP_FIN_Y + BR_HH, PP_W, ts.final, false) : '');

  return '<div style="margin-top:24px;"><svg viewBox="0 0 ' + PP_SVG_W + ' ' + PP_SVG_H + '" style="width:60%;max-width:460px;display:block;">' + svg + '</svg></div>';
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
    version: 2, assignedOrg, BUDGET, draftedPlayerNames, draftedCoachName, tournamentState,
    careerState, careerRosterPlayers, careerCoach,
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
  BUDGET = data.BUDGET;
  draftedPlayerNames = data.draftedPlayerNames;
  draftedCoachName = data.draftedCoachName;
  tournamentState = data.tournamentState;
  careerState = data.careerState || { seasonNumber: 1, titlesWon: 0 }; // ältere Spielstände (v1) hatten das Feld noch nicht
  careerRosterPlayers = data.careerRosterPlayers || null;
  careerCoach = data.careerCoach || null;

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
      card.innerHTML =
        '<div class="slot-org">Speicherstand ' + slot.slotId + ' — ' + slot.orgName + '</div>' +
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
    if (slot.exists && !window.confirm('Diesen Speicherstand überschreiben?')) return;
    currentSlotId = slot.slotId;
    goToOrgIntro();
  } else {
    currentSlotId = slot.slotId;
    loadGameState();
  }
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

document.getElementById('btn-new-game').addEventListener('click', () => openSlotPicker('new'));
document.getElementById('btn-continue').addEventListener('click', () => openSlotPicker('continue'));
document.getElementById('btn-back-to-menu-slots').addEventListener('click', goToMenu);
document.getElementById('btn-spin').addEventListener('click', spinReel);
document.getElementById('btn-modal-continue').addEventListener('click', confirmOrgAndProceed);
document.getElementById('btn-quit').addEventListener('click', () => window.electronAPI.quitApp());
document.getElementById('btn-back-to-menu-intro').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-draft').addEventListener('click', goToMenu);
document.getElementById('btn-back-to-menu-match').addEventListener('click', () => matchOnFinished && matchOnFinished());
document.getElementById('btn-match-continue').addEventListener('click', () => matchOnFinished && matchOnFinished());
document.getElementById('btn-start-match').addEventListener('click', startTournament);
document.getElementById('btn-speed-1').addEventListener('click', () => setMatchSpeed(1));
document.getElementById('btn-speed-2').addEventListener('click', () => setMatchSpeed(2));
document.getElementById('btn-speed-4').addEventListener('click', () => setMatchSpeed(4));
document.getElementById('btn-speed-8').addEventListener('click', () => setMatchSpeed(8));
document.getElementById('btn-instant-sim').addEventListener('click', instantFinishCurrentGame);
document.getElementById('btn-back-to-menu-tournament').addEventListener('click', goToMenu);
document.getElementById('btn-tournament-action').addEventListener('click', onTournamentActionClick);
document.getElementById('btn-quick-sim-round').addEventListener('click', quickSimulateCurrentRound);
document.getElementById('btn-quick-sim-all').addEventListener('click', quickSimulateEntireTournament);
