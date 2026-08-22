// Bot Ecosystem V6 — Headless Simulation Engine (Phase 1-3).
//
// Lädt die ECHTE index.html + alle ECHTEN <script>-Tags (data/*.js, match.js,
// sound.js, renderer.js) über jsdom in einer realen JS-VM-Context -- KEINE
// zweite/vereinfachte Simulation, dieselbe Produktionslogik wie im
// Electron-Fenster. Der einzige Unterschied zur Electron-UI: kein echtes
// OS-Fenster, kein Chromium, kein `window.electronAPI` über IPC/preload.js
// (contextBridge funktioniert nicht in jsdom) -- wird hier durch einen
// funktionsgleichen In-Node-Stub ersetzt (identische JSON.stringify/parse-
// Serialisierung wie main.js' ipcMain-Handler für 'save-game'/'load-game').
//
// KEIN Electron-Fenster => KEIN OS-Fokus/Sichtbarkeits-Throttling moeglich
// (das V5-Problem existiert hier strukturell nicht, nicht nur "umgangen").
//
// Wichtig (Lektion aus V3/V4/V5): renderer.js deklariert seine Top-Level-
// Variablen (ORGANIZATIONS, assignedOrg, careerState, ...) mit `let`/`const`.
// Solche Bindings haengen NICHT an `window` (nur `var`/Funktionsdeklarationen
// tun das) -- weder in einem echten Browser noch in jsdom. Zugriff von
// AUSSEN funktioniert daher nicht über `dom.window.ORGANIZATIONS`, sondern
// nur durch Code, der IM SELBEN VM-Context läuft (dom.getInternalVMContext()),
// exakt wie es Playwright's `page.evaluate()` bereits vorher implizit tat.

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// Deterministische Seeds (Bot Ecosystem V6, Phase 2): dieselbe mulberry32/
// hashString-Kombination, die das Projekt bereits für per-Org-deterministische
// Kader-Generierung nutzt (siehe data/org-rosters.js), hier eigenständig
// dupliziert (reiner Node-Code, läuft VOR dem Laden irgendeines Skripts,
// kann daher nicht aus der noch nicht existierenden VM-Context importiert
// werden). Ersetzt bei gesetztem `seed` GLOBAL `Math.random` im VM-Context --
// Production-Code bleibt komplett unverändert (weiterhin echtes Math.random()
// in einem echten Spiel), nur der Headless-QA-Host überschreibt die globale
// Quelle selbst, kein einziger Math.random()-Aufruf in renderer.js/data/*.js
// muss dafür angefasst werden ("nicht blind alles ersetzen").
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const INDEX_HTML = path.join(PROJECT_ROOT, 'index.html');

// In-Memory-Save-Store je Runner-Instanz (kein Ueberschreiben echter
// Spielstaende auf der Festplatte des Nutzers) -- dieselbe JSON.stringify/
// JSON.parse-Serialisierung wie main.js, nur ohne Datei-I/O, fuer maximale
// Test-Geschwindigkeit bei 20x-Save/Load-Zyklen. Optional auf echte Dateien
// umschaltbar (persistDir), falls ein Test das explizit braucht.
function createElectronApiStub(opts) {
  opts = opts || {};
  const memStore = new Map();
  const persistDir = opts.persistDir || null;
  if (persistDir) fs.mkdirSync(persistDir, { recursive: true });
  const slotPath = (slotId) => path.join(persistDir, 'slot-' + slotId + '.json');
  // Bug-Fix (Headless-Runner-Aufbau): echte Electron-IPC (ipcRenderer.invoke)
  // braucht IMMER mindestens einen echten Makrotask-Umlauf (Round-Trip zum
  // Main-Prozess) -- renderer.js verlässt sich an einer Stelle (playIntro()
  // -> initSettings() -> setMatchSpeed(), ganz am Dateianfang aufgerufen)
  // implizit darauf: das await auf getSettings() darf erst NACH dem Ende des
  // gesamten synchronen Skript-Durchlaufs fortsetzen, sonst referenziert
  // setMatchSpeed() ein `let matchSpeed` (Zeile ~18901), das an dieser Stelle
  // noch nicht initialisiert ist (TDZ-ReferenceError). Ein simples
  // `async () => {}` (reine Mikrotask-Aufloesung) ist SCHNELLER als das,
  // deshalb hier bewusst ein `setTimeout(0)` (echter Makrotask) statt eines
  // reinen Promise.resolve() -- reproduziert exakt die Timing-Garantie der
  // echten IPC-Bridge, ohne renderer.js selbst anzufassen.
  const macrotask = (fn) => new Promise((resolve) => setTimeout(() => resolve(fn()), 0));
  // Realistische Default-Settings (identische Form wie appSettings' Default,
  // siehe renderer.js ~Zeile 43) -- ein leeres {} würde defaultMatchSpeed
  // etc. als `undefined` liefern und nachgelagerte Logik verfälschen.
  const defaultSettings = {
    autoCheckUpdates: false, defaultMatchSpeed: 1, quickSimPace: 'normal',
    displayMode: 'windowed', windowSize: '1280x800', uiScale: 1, rememberWindowBounds: true, windowBounds: null,
    soundEnabled: false, soundVolume: 0, introVideoVolume: 0, musicVolume: 0,
  };
  return {
    quitApp: () => {},
    saveGame: (slotId, data) => macrotask(() => {
      const json = JSON.stringify(data);
      if (persistDir) fs.writeFileSync(slotPath(slotId), json);
      else memStore.set(slotId, json);
    }),
    loadGame: (slotId) => macrotask(() => {
      let raw;
      if (persistDir) {
        try { raw = fs.readFileSync(slotPath(slotId), 'utf-8'); } catch { return null; }
      } else {
        raw = memStore.get(slotId);
        if (raw === undefined) return null;
      }
      try { return JSON.parse(raw); } catch { return { corrupted: true }; }
    }),
    deleteSave: (slotId) => macrotask(() => { memStore.delete(slotId); if (persistDir) { try { fs.unlinkSync(slotPath(slotId)); } catch {} } }),
    listSaveSlots: () => macrotask(() => []),
    selectPortraitImage: () => macrotask(() => null),
    listPortraitPresets: () => macrotask(() => []),
    selectTeamLogoImage: () => macrotask(() => null),
    listTeamLogoPresets: () => macrotask(() => []),
    listManagerTemplates: () => macrotask(() => []),
    saveManagerTemplate: () => macrotask(() => {}),
    deleteManagerTemplate: () => macrotask(() => {}),
    isFeedbackReady: () => macrotask(() => false),
    sendFeedback: () => macrotask(() => ({ ok: false, error: 'headless' })),
    getSettings: () => macrotask(() => ({ ...defaultSettings })),
    saveSettings: () => macrotask(() => {}),
    getAppVersion: () => macrotask(() => '0.0.0-headless'),
    applyDisplaySettings: () => macrotask(() => {}),
    checkForUpdates: () => macrotask(() => {}),
    downloadUpdate: () => {},
    installUpdate: () => {},
    onUpdateAvailable: () => {},
    onUpdateNotAvailable: () => {},
    onUpdateError: () => {},
    onUpdateProgress: () => {},
    onUpdateDownloaded: () => {},
    aiGetStatus: () => macrotask(() => ({ ready: false })),
    aiEnsureReady: () => macrotask(() => ({ ready: false })),
    aiChat: () => macrotask(() => ({ text: '' })),
    aiChatStream: () => macrotask(() => ({ text: '' })),
    onAiChatChunk: () => {},
    aiSetupDownload: () => macrotask(() => {}),
    onAiSetupProgress: () => {},
  };
}

// Erstellt eine vollstaendig initialisierte Headless-Spiel-Instanz. Gibt ein
// Handle zurueck, dessen `run(code)` beliebigen Code IM SELBEN VM-Context
// wie renderer.js ausfuehrt (bare Top-Level-Identifier funktionieren, siehe
// Kommentar oben) -- exakt das Gegenstueck zu Playwright's `page.evaluate()`,
// nur ohne Browser/Electron.
async function createHeadlessGame(opts) {
  opts = opts || {};
  const virtualConsole = new (require('jsdom').VirtualConsole)();
  if (opts.forwardConsole) virtualConsole.sendTo(console, { omitJSDOMErrors: true });

  // Bug-Fix (Headless-Runner-Aufbau): jsdoms eigene <script src>-Fetch-
  // Pipeline (runScripts:'dangerously' + resources:'usable') fuehrt die
  // Skripte NICHT als einen einzigen atomaren synchronen Durchlauf pro Datei
  // aus -- ein `await`, das in renderer.js ganz am Dateianfang (playIntro())
  // ausgeloest wird, konnte selbst mit einem echten setTimeout(0)-Makrotask
  // VOR dem Ende des restlichen Datei-Inhalts fortsetzen (TDZ-ReferenceError
  // auf ein erst viel spaeter deklariertes `let`). Root-Cause nicht weiter
  // in jsdom-Internals verfolgt (auszerhalb des Projekt-Scopes) -- stattdessen
  // 'outside-only': jsdom baut NUR die DOM-Struktur aus index.html, fuehrt
  // aber KEIN <script> selbst aus. Die Skript-Dateien werden unten manuell,
  // in derselben Reihenfolge wie in index.html, per vm.Script.runInContext()
  // EIN EINZIGES MAL SYNCHRON pro Datei ausgefuehrt -- garantiert exakt das
  // Timing-Verhalten, auf das renderer.js sich verlaesst (echter Browser:
  // <script src> blockiert bis zum Ende des kompletten Dateiinhalts, bevor
  // das naechste <script> drankommt).
  const dom = await JSDOM.fromFile(INDEX_HTML, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
    url: 'file://' + PROJECT_ROOT.replace(/\\/g, '/') + '/index.html',
    beforeParse(window) {
      // electronAPI MUSS schon vor dem ersten <script>-Tag existieren --
      // renderer.js registriert top-level electronAPI-Listener (z.B.
      // onUpdateAvailable) sofort beim Laden, nicht erst in einer Funktion.
      window.electronAPI = createElectronApiStub({ persistDir: opts.persistDir });
      if (opts.seed !== undefined && opts.seed !== null) {
        const rng = mulberry32(hashString(String(opts.seed)));
        window.Math.random = rng;
      }
      // jsdom implementiert HTMLMediaElement.play()/AudioContext nicht --
      // beides wird nur von UI-Sound-/Video-Code aufgerufen (playTone() prueft
      // appSettings.soundEnabled/Volume VOR dem AudioContext-Zugriff, siehe
      // sound.js), im reinen Simulationspfad nie erreicht. Trotzdem defensiv
      // No-Op-Stubs, falls ein Test versehentlich UI-Funktionen aufruft.
      if (window.HTMLMediaElement) {
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.HTMLMediaElement.prototype.pause = () => {};
        window.HTMLMediaElement.prototype.load = () => {};
      }
      window.AudioContext = window.AudioContext || function () {
        return { state: 'running', resume: () => {}, currentTime: 0, createOscillator: () => ({ connect: () => {}, start: () => {}, stop: () => {}, type: 'sine', frequency: { value: 0 } }), createGain: () => ({ connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }), destination: {} };
      };
      window.scrollTo = () => {};
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }));
      if (typeof window.ResizeObserver === 'undefined') {
        window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      }
      // jsdom liefert ohne das native `canvas`-Paket kein echtes 2D-Rendering
      // (getContext('2d') => null) -- betrifft rein kosmetische UI-Init-
      // Funktionen (z.B. initContractSignatureCanvas()), niemals den
      // Simulationspfad. No-Op-Mock statt einer schweren nativen Abhängigkeit,
      // deckt alle im Projekt verwendeten Canvas-2D-Aufrufe ab.
      if (window.HTMLCanvasElement) {
        const noopCtx2d = new Proxy({}, {
          get(_t, prop) {
            if (prop === 'canvas') return undefined;
            if (typeof prop === 'string' && /^(fillStyle|strokeStyle|lineWidth|lineCap|lineJoin|font|textAlign|textBaseline|globalAlpha|shadowBlur|shadowColor)$/.test(prop)) return '';
            return () => {};
          },
          set() { return true; },
        });
        window.HTMLCanvasElement.prototype.getContext = () => noopCtx2d;
      }
    },
  });

  const pageErrors = [];
  dom.window.addEventListener('error', (e) => {
    pageErrors.push(String((e && e.error && e.error.stack) || (e && e.message) || e));
  });
  dom.window.addEventListener('unhandledrejection', (e) => {
    pageErrors.push('unhandledrejection: ' + String((e && e.reason && e.reason.stack) || (e && e.reason) || e));
  });

  const context = dom.getInternalVMContext();
  function run(codeOrFn, ...args) {
    if (typeof codeOrFn === 'function') {
      // Funktion wird als Quelltext neu ausgewertet, damit sie im ECHTEN
      // VM-Context (nicht im Node-Context des Aufrufers) laeuft -- Closures
      // ueber Node-Variablen funktionieren dadurch NICHT (wie bei
      // page.evaluate() auch), Argumente werden explizit durchgereicht.
      const argNames = args.map((_, i) => '__arg' + i);
      const wrapped = '(' + codeOrFn.toString() + ')(' + argNames.join(',') + ')';
      const script = new vm.Script(wrapped, { filename: 'headless-run.js' });
      argNames.forEach((n, i) => { context[n] = args[i]; });
      return script.runInContext(context);
    }
    const script = new vm.Script(codeOrFn, { filename: 'headless-run.js' });
    return script.runInContext(context);
  }

  // Echte <script src="...">-Reihenfolge aus dem geladenen index.html lesen
  // (Single Source of Truth -- kein hart codiertes Duplikat dieser Liste,
  // bleibt automatisch synchron, falls sich index.html je aendert). Jede
  // Datei wird EINMAL, komplett synchron (ein einziger vm.Script-Aufruf pro
  // Datei, keine Zwischen-Awaits zwischen den Dateien) ausgefuehrt -- exakt
  // das Timing, auf das renderer.js sich verlaesst (siehe Kommentar oben).
  const scriptSrcs = [...dom.window.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scriptSrcs) {
    const filePath = path.join(PROJECT_ROOT, src);
    const code = fs.readFileSync(filePath, 'utf-8');
    try {
      const script = new vm.Script(code, { filename: filePath });
      script.runInContext(context);
    } catch (err) {
      throw new Error('Headless-Skriptausführung fehlgeschlagen bei ' + src + ': ' + (err && err.stack || err));
    }
  }

  // Nach dem synchronen Laden ALLER Skripte: ausstehende Mikro-/Makrotasks
  // (playIntro() -> initSettings(), initMainMenuVersion(), etc.) einmal
  // abklingen lassen, damit sie nicht mitten in der ersten echten Simulation
  // dazwischenfunken. Diese Pfade sind für Headless irrelevant (kein Intro-
  // Video, kein Hauptmenü-Rendering wird je angeschaut), aber sollen sauber
  // durchlaufen statt als spätere unhandledrejection aufzutauchen.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Gemeinsamer, korrekter Karriere-Init für alle Headless-QA-Skripte
  // (Determinismus-Diagnose, Bot Ecosystem V6): buildCustomOrgFromForm()
  // seedet intern mit Date.now() (echte Wanduhrzeit), unabhängig vom
  // Math.random()-Seed-Override oben -- macht jede damit erzeugte Org nicht-
  // reproduzierbar, selbst bei identischem `seed`. Für Bot-Kosmos-Audits
  // (die den Bot-Kosmos verfolgen, nicht eine frisch erstellte Spieler-Org)
  // wird stattdessen eine bereits deterministisch generierte Org aus
  // ORGANIZATIONS als nominale assignedOrg verwendet (per Index wählbar,
  // Standard: erste Org) -- diese Org bekommt dadurch KEINE Bot-KI-
  // Wirtschaftsentscheidungen mehr (dieselbe Sonderbehandlung wie eine echte
  // Spieler-Org), bleibt also über die Laufzeit inert; wird deshalb aus
  // Original-Bottom-10/Top-10-Kohorten ausgeschlossen (siehe Audit-Skripte).
  function initHeadlessCareer(opts2) {
    opts2 = opts2 || {};
    const orgIndex = opts2.assignedOrgIndex !== undefined ? opts2.assignedOrgIndex : 0;
    const startDate = opts2.startDate || '2026-01-01';
    // Save/Load Integrity V1: fuer Tests, die die Spieler-Org SELBST pruefen
    // (nicht nur den Bot-Kosmos drumherum), realOwnOrg:true verwenden --
    // erzeugt eine ECHTE, ueber buildCustomOrgFromForm() korrekt
    // initialisierte Org (financeAllocation/ceoFireable/etc. gesetzt, wie bei
    // einem echten Spielstart) statt einer zweckentfremdeten Bot-Org. Live
    // verifiziert: eine zweckentfremdete Bot-Org als assignedOrg fehlte
    // financeAllocation komplett -- das liess assignedOrg.budget beim ERSTEN
    // Load auf einen kleinen Fallback-Wert einbrechen (reines Testaufbau-
    // Artefakt, siehe Save/Load-Integrity-Bericht, KEIN echter Produktions-
    // Bug -- ein normal gestarteter Spieler durchlaeuft immer
    // buildCustomOrgFromForm()).
    if (opts2.realOwnOrg) {
      return run((date) => {
        selectedOrgCreateDifficulty = 'normal';
        selectedOrgCreateNation = 'DE'; selectedOrgCreateColor = 0; selectedOrgCreateLogoUrl = ''; orgCreateFillAgents = true;
        const org = buildCustomOrgFromForm('CS', 'Headless QA Org', 'x');
        assignedOrg = org;
        gameMode = 'career';
        careerCharacter = { name: 'HeadlessQA', traits: defaultCharacterTraits() };
        careerState = { seasonNumber: 1, titlesWon: 0, seasonGuideShown: false };
        careerDate = date; transferLog = []; currentSlotId = 1; careerEnded = false;
        messagingToastsSuppressed = true; postToastsSuppressed = true; trainingToastsSuppressed = true;
        goToDashboard();
        return { assignedOrgName: assignedOrg.name };
      }, startDate);
    }
    return run((idx, date) => {
      assignedOrg = ORGANIZATIONS[idx];
      gameMode = 'career';
      careerCharacter = { name: 'HeadlessQA', traits: defaultCharacterTraits() };
      careerState = { seasonNumber: 1, titlesWon: 0, seasonGuideShown: false };
      careerDate = date; transferLog = []; currentSlotId = 1; careerEnded = false;
      messagingToastsSuppressed = true; postToastsSuppressed = true; trainingToastsSuppressed = true;
      goToDashboard();
      return { assignedOrgName: assignedOrg.name };
    }, orgIndex, startDate);
  }

  return { dom, context, run, initHeadlessCareer, pageErrors };
}

module.exports = { createHeadlessGame, createElectronApiStub, PROJECT_ROOT };
