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
  if (vol <= 0) return;
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
  } catch {}
}

function playHoverSound() { playTone(720, 45, 0.5, 'sine'); }
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
