// Kurze, SYNTHETISCHE UI-Sounds (Web Audio API, Oszillator + Hüllkurve) —
// bewusst keine externen Audiodateien nötig (kein Lizenz-/Download-Risiko,
// minimaler Fußabdruck). Lautstärke/An-Aus kommt aus appSettings
// (renderer.js) und NIE aus einem Einstellungen-Entwurf — Button-Sounds
// spiegeln also immer den zuletzt GESPEICHERTEN Stand, nicht was gerade nur
// im Einstellungen-Popup angeklickt wurde (gleiche "kein Auto-Apply"-Regel
// wie für Anzeige/Match-Einstellungen).

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function currentSoundVolume() {
  if (typeof appSettings === 'undefined' || !appSettings || !appSettings.soundEnabled) return 0;
  return Math.max(0, Math.min(1, appSettings.soundVolume));
}

// Spielt einen kurzen Ton mit sanfter Attack/Release-Hüllkurve (sonst
// knackst/klickt es beim Ein-/Ausblenden). `volumeOverride` erlaubt dem
// Testton-Button im Einstellungen-Popup, den ENTWURFS-Lautstärkewert zu
// hören, bevor er gespeichert ist — eine bewusste, einzelne Ausnahme
// (explizite Nutzeraktion), keine automatische Live-Anwendung.
function playTone(freq, durationMs, volumeMultiplier, type, volumeOverride) {
  const vol = volumeOverride !== undefined ? volumeOverride : currentSoundVolume();
  if (vol <= 0) return null;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    const peak = vol * (volumeMultiplier || 1) * 0.25; // gedeckelt, damit es bei 100% nicht übersteuert
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
    return { osc, gain };
  } catch {
    return null;
  }
}

// Bug-Fix (Audit): schnelles Überstreichen mehrerer Buttons hintereinander
// (Sponsoren-Karten, Kalendertage, Kader-Kacheln, Sidebar-Kategorien) ließ
// jede neue playHoverSound()-Instanz unabhängig bis zum Ende ihrer eigenen
// Hüllkurve weiterlaufen -- bei kurzem Button-Abstand klangen dadurch
// mehrere 45ms-Töne hörbar überlagert. currentHoverVoice merkt sich die
// zuletzt gestartete Instanz; ein neuer Hover-Ton bricht eine noch laufende
// zuerst ab.
//
// Bug-Fix (Masterprompt-Audit): Der ursprüngliche Abbruch ließ die alte
// Instanz noch 30-40ms sanft ausklingen, während der neue Ton bereits
// innerhalb von 5ms auf vollen Pegel hochfuhr -- für dieses Zeitfenster
// hingen zwei Gain-Nodes gleichzeitig an ctx.destination, deren Pegel sich
// (Web-Audio-typisch) ADDIEREN, was beim sehr schnellen Überstreichen
// mehrerer eng benachbarter Buttons zu kurzzeitig deutlich lauteren,
// gestapelten Tönen führte. Fix hat zwei Teile: (1) der Abbruch der
// vorherigen Instanz ist jetzt praktisch sofort (kein hörbares Knacken bei
// einem 45ms-Sinuston), sodass beim Start des neuen Tons kein alter Pegel
// mehr aktiv ist; (2) ein sehr kurzes Rate-Limit verhindert, dass bei
// extrem schnellem Hovern (mehr als ~20 Buttons/Sekunde) überhaupt neue
// Töne angestoßen werden -- normales Hover-Tempo (Button-Wechsel typ.
// deutlich über 45ms auseinander) bleibt davon komplett unberührt.
let currentHoverVoice = null;
function stopHoverVoice() {
  if (!currentHoverVoice) return;
  try {
    const { osc, gain } = currentHoverVoice;
    const now = getAudioContext().currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.006);
    osc.stop(now + 0.008);
  } catch {}
  currentHoverVoice = null;
}

let lastHoverSoundAt = 0;
const HOVER_SOUND_MIN_INTERVAL_MS = 45;
function playHoverSound() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastHoverSoundAt < HOVER_SOUND_MIN_INTERVAL_MS) return;
  lastHoverSoundAt = now;
  stopHoverVoice();
  currentHoverVoice = playTone(720, 45, 0.5, 'sine');
}
function playClickSound() { playTone(480, 70, 1, 'triangle'); }
function playTestSound(volumeOverride) { playTone(600, 220, 1, 'triangle', volumeOverride); }

// ── Globale Button-Sound-Delegation ──────────────────────────────────────
// EIN Listener am document statt an jedem einzelnen Button in der gesamten
// App (davon gibt es hunderte, über sehr viele Screens verteilt) — deckt
// automatisch auch künftig neu hinzugefügte Buttons ab, ohne dass an jeder
// Button-Erzeugungsstelle im Code etwas ergänzt werden müsste.
let lastHoveredSoundEl = null;
document.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled || btn === lastHoveredSoundEl) return;
  lastHoveredSoundEl = btn;
  playHoverSound();
});
document.addEventListener('mouseout', (e) => {
  const btn = e.target.closest('button');
  if (btn && lastHoveredSoundEl === btn && (!e.relatedTarget || !btn.contains(e.relatedTarget))) {
    lastHoveredSoundEl = null;
  }
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  // Der Testton-Button spielt seinen eigenen (Entwurfs-)Ton — der generische
  // Klick-Sound würde sich sonst unschön damit überlagern.
  if (!btn || btn.disabled || btn.id === 'btn-settings-sound-test') return;
  playClickSound();
});
