const { app, BrowserWindow, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Der Intro-Sound spielt automatisch beim Start, BEVOR der Nutzer irgendeine
// Geste (Klick/Tastendruck) gemacht hat — Chromiums Standard-Autoplay-Policy
// würde AudioContext bis zur ersten Interaktion stummschalten. Da es sich um
// reinen, selbst erzeugten App-Inhalt handelt (kein Fremd-/Web-Content), ist
// diese Lockerung unbedenklich.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

Menu.setApplicationMenu(null);

const appIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
if (process.platform === 'darwin' && app.dock) app.dock.setIcon(appIcon);
autoUpdater.autoDownload = false; // Nutzer entscheidet selbst per Popup, ob/wann geladen wird

ipcMain.on('quit-app', () => app.quit());

// Mehrere Speicherstände (Slots) statt einem einzigen Autosave — jeder Slot
// ist eine eigene JSON-Datei in userData.
// Bug-Fix (Audit Runde 5): dasselbe Tmp-Datei+renameSync-Muster, das für
// save-game bereits als Fix etabliert ist (siehe Kommentar dort), gilt genauso
// für manager-templates.json/settings.json -- ein Prozessabbruch mittendrin
// hinterließ dort bisher eine abgeschnittene/kaputte JSON-Datei. Gemeinsame
// Hilfsfunktion statt das Muster dreimal zu duplizieren.
function atomicWriteFileSync(target, contents) {
  const tmpPath = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, target);
}

const SAVE_SLOT_COUNT = 3;
const slotPath = (slotId) => path.join(app.getPath('userData'), 'save-slot-' + slotId + '.json');
// Bug-Fix (Audit Runde 5): slotId floss bisher ungeprüft in slotPath() ein --
// über die normale UI kommt sie zwar immer aus list-save-slots (feste
// Ganzzahlen 1-3), aber der Renderer zeigt an mehreren Stellen frei getippte
// Spielernamen ungesäubert per innerHTML an (Charakter-/Orga-Erstellung,
// landen 1:1 im Save). Ein darüber eingeschleustes Skript hätte vollen
// Zugriff auf window.electronAPI und könnte mit einer manipulierten
// (z.B. "../../../irgendwo") slotId außerhalb von userData schreiben/lesen/
// löschen. Zusätzliche, billige Absicherung direkt an der Quelle.
const isValidSlotId = (slotId) => Number.isInteger(slotId) && slotId >= 1 && slotId <= SAVE_SLOT_COUNT;

// Bug-Fix (Audit): schrieb vorher direkt in die Zieldatei -- bricht der
// Prozess mittendrin ab (Absturz, Stromausfall, Task-Kill), bleibt eine
// abgeschnittene/kaputte JSON-Datei zurück, die load-game/list-save-slots
// danach stillschweigend als "existiert nicht" behandelt hätten (siehe
// unten) -- kompletter, unbemerkter Fortschrittsverlust. Erst in eine
// temporäre Datei im selben Verzeichnis schreiben, dann atomar per
// fs.renameSync ersetzen: entweder liegt am Ende die alte ODER die neue,
// vollständige Version da, nie ein Zwischenzustand.
ipcMain.handle('save-game', (_event, slotId, data) => {
  if (!isValidSlotId(slotId)) return;
  const target = slotPath(slotId);
  const tmpPath = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, target);
});

// Bug-Fix (Audit): ein JSON.parse-Fehler wurde bisher nicht von "Datei
// existiert nicht" unterschieden -- eine durch einen alten Bug/Absturz
// beschädigte, aber vorhandene Speicherdatei wurde dadurch identisch zu
// einem leeren Slot behandelt und konnte anschließend anstandslos
// überschrieben werden (endgültiger Datenverlust, ohne dass der Spieler
// je eine Fehlermeldung sah). Jetzt wird zwischen "fehlt" (ENOENT -> null)
// und "ist da, aber kaputt" (-> { corrupted: true }) unterschieden.
ipcMain.handle('load-game', (_event, slotId) => {
  if (!isValidSlotId(slotId)) return null;
  let raw;
  try {
    raw = fs.readFileSync(slotPath(slotId), 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { corrupted: true };
  }
});

ipcMain.handle('delete-save', (_event, slotId) => {
  if (!isValidSlotId(slotId)) return;
  try {
    fs.unlinkSync(slotPath(slotId));
  } catch {}
});

// ── Erzwungener Tutorial-Spielstand (User-Vorgabe: "erzwungener Tutorial-
// Spielstand, um Probleme wie Hängenbleiben in bestimmten Tutorial-Segmenten
// zu vermeiden") ─────────────────────────────────────────────────────────
// Eigener, fester Dateiname statt einer der 3 normalen Slots -- taucht
// dadurch NIE in list-save-slots()/der normalen Speicherplatz-Auswahl auf
// (die nur i=1..SAVE_SLOT_COUNT durchläuft) und kann folglich auch nie
// versehentlich einen echten Spielstand überschreiben. Kein slotId-Parameter
// nötig (nur EIN fester Pfad) -- entzieht sich damit vollständig der unter
// isValidSlotId() dokumentierten Pfad-Injection-Angriffsfläche.
const tutorialSlotPath = () => path.join(app.getPath('userData'), 'save-slot-tutorial.json');

ipcMain.handle('save-tutorial-slot', (_event, data) => {
  const target = tutorialSlotPath();
  const tmpPath = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, target);
});

ipcMain.handle('load-tutorial-slot', () => {
  let raw;
  try {
    raw = fs.readFileSync(tutorialSlotPath(), 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { corrupted: true };
  }
});

// ── Manager-Portraits (Charaktererstellung) ─────────────────────────────────
// Hochgeladene Bilder werden in userData KOPIERT (nicht nur der gewählte Pfad
// gemerkt) -- der Speicherstand darf nicht davon abhängen, dass eine vom
// Nutzer irgendwo auf der Platte ausgewählte Originaldatei dort liegen
// bleibt. Vorlagen-Portraits (list-portrait-presets) liegen dagegen im
// Projekt selbst (assets/portraits/) und werden nur GELESEN, nie kopiert --
// die Ordner-Existenz ist bewusst optional (fs.readdirSync im try/catch),
// solange der Nutzer dort noch keine Vorlagenbilder abgelegt hat.
const PORTRAITS_DIR = path.join(app.getPath('userData'), 'portraits');

ipcMain.handle('select-portrait-image', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Portrait auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const srcPath = result.filePaths[0];
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  const destPath = path.join(PORTRAITS_DIR, 'custom-' + Date.now() + path.extname(srcPath).toLowerCase());
  fs.copyFileSync(srcPath, destPath);
  return pathToFileURL(destPath).href;
});

// Geschlecht wird aus dem Dateinamens-Präfix gelesen (frau_*.png / mann_*.png,
// wie vom User in assets/Manager_Portrai/ abgelegt) -- renderer.js filtert
// die Vorlagen-Sidebar damit passend zum gewählten Geschlecht, ohne dass hier
// eine feste Namensliste gepflegt werden müsste.
ipcMain.handle('list-portrait-presets', () => {
  try {
    const dir = path.join(__dirname, 'assets', 'Manager_Portrai');
    return fs.readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .sort()
      .map((f) => ({
        id: f,
        url: pathToFileURL(path.join(dir, f)).href,
        gender: /^frau/i.test(f) ? 'F' : /^mann/i.test(f) ? 'M' : null,
      }));
  } catch {
    return [];
  }
});

// ── Team-Logos (eigene Organisation erstellen) ──────────────────────────────
// Spiegelt die Manager-Portrait-Logik oben 1:1, aber für eine eigene
// Vorlagenkategorie -- assets/team-logos/ enthält bereits echte, vom User
// bereitgestellte Marken-Logos der BESTEHENDEN 87 Orgas und darf dafür nicht
// zweckentfremdet werden, deshalb ein eigener Ordner für generische Logo-
// VORLAGEN (assets/wappen-eigener_verein/, vom User befüllt), die man einer
// selbst erstellten Org geben kann.
const TEAM_LOGOS_CUSTOM_DIR = path.join(app.getPath('userData'), 'team-logos-custom');

ipcMain.handle('select-team-logo-image', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Teamlogo auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const srcPath = result.filePaths[0];
  fs.mkdirSync(TEAM_LOGOS_CUSTOM_DIR, { recursive: true });
  const destPath = path.join(TEAM_LOGOS_CUSTOM_DIR, 'custom-' + Date.now() + path.extname(srcPath).toLowerCase());
  fs.copyFileSync(srcPath, destPath);
  return pathToFileURL(destPath).href;
});

ipcMain.handle('list-team-logo-presets', () => {
  try {
    const dir = path.join(__dirname, 'assets', 'wappen-eigener_verein');
    return fs.readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .sort()
      .map((f) => ({ id: f, url: pathToFileURL(path.join(dir, f)).href }));
  } catch {
    return [];
  }
});

// ── Manager-Vorlagen (Charaktere, die je bei "Manager erstellen" fertig
// angelegt wurden) ──────────────────────────────────────────────────────────
// Eigenständig von den Speicherständen (save-slot-N.json) -- eine dauerhafte
// Bibliothek über ALLE Karrieren/Slots hinweg, damit man einen einmal
// erstellten Manager (Name/Regler/Portrait) später erneut auswählen kann,
// ohne alles neu einzutippen (siehe btn-character-quickstart/openManagerPicker()
// in renderer.js).
const MANAGER_TEMPLATES_PATH = path.join(app.getPath('userData'), 'manager-templates.json');

function readManagerTemplates() {
  try {
    return JSON.parse(fs.readFileSync(MANAGER_TEMPLATES_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

ipcMain.handle('list-manager-templates', () => readManagerTemplates());

ipcMain.handle('save-manager-template', (_event, character) => {
  const list = readManagerTemplates();
  list.push({ id: Date.now(), ...character });
  atomicWriteFileSync(MANAGER_TEMPLATES_PATH, JSON.stringify(list));
  return list;
});

ipcMain.handle('delete-manager-template', (_event, id) => {
  const list = readManagerTemplates().filter((m) => m.id !== id);
  atomicWriteFileSync(MANAGER_TEMPLATES_PATH, JSON.stringify(list));
  return list;
});

// Liefert für jeden Slot eine leichte Zusammenfassung (für die Slot-Auswahl-
// Ansicht) statt der vollen Roster-/Turnier-Daten.
ipcMain.handle('list-save-slots', () => {
  const slots = [];
  for (let i = 1; i <= SAVE_SLOT_COUNT; i++) {
    let raw;
    try {
      raw = fs.readFileSync(slotPath(i), 'utf-8');
    } catch {
      slots.push({ slotId: i, exists: false });
      continue;
    }
    // Bug-Fix (Audit): eine vorhandene, aber durch einen Absturz beschädigte
    // Speicherdatei wurde hier bisher identisch zu "Slot existiert nicht"
    // behandelt (derselbe catch-Block wie oben) -- der Slot erschien in der
    // Auswahl als leer und ließ sich anstandslos überschreiben, obwohl noch
    // echter (nur nicht mehr lesbarer) Fortschritt darunterlag. Jetzt bleibt
    // er sichtbar und als beschädigt markiert.
    try {
      const data = JSON.parse(raw);
      slots.push({
        slotId: i,
        exists: true,
        orgName: data.assignedOrg ? data.assignedOrg.name : '?',
        // Direkt aus dem Spielstand statt über findOrgByName() nachzuschlagen --
        // eine selbst erstellte Org (siehe "Organisation erstellen") steht NIE
        // in der festen 87er-Liste, der Namens-Lookup würde für sie immer
        // fehlschlagen. orgLogo (Dateiname) bei den festen Orgas, orgLogoUrl
        // (fertige URL, ggf. eigener PC-Upload) bei selbst erstellten.
        orgLogo: data.assignedOrg ? data.assignedOrg.logo || null : null,
        orgLogoUrl: data.assignedOrg ? data.assignedOrg.logoUrl || null : null,
        characterName: data.careerCharacter ? data.careerCharacter.name : 'Manager', // ältere Spielstände kannten noch keinen Charakter
        firstName: data.careerCharacter ? data.careerCharacter.firstName : '',
        avatarId: data.careerCharacter ? data.careerCharacter.avatarId : null,
        portraitUrl: data.careerCharacter ? data.careerCharacter.portraitUrl : null,
        seasonNumber: data.careerState ? data.careerState.seasonNumber : 1,
        titlesWon: data.careerState ? data.careerState.titlesWon : 0,
        gameMode: data.gameMode || 'career', // ältere Spielstände kannten nur Karriere
        playtimeSeconds: data.careerPlaytimeSeconds || 0, // ältere Spielstände kannten noch keine Spielzeit
        savedAt: fs.statSync(slotPath(i)).mtime.toISOString(),
      });
    } catch {
      slots.push({ slotId: i, exists: true, corrupted: true, orgName: '?', characterName: 'Beschädigter Speicherstand', firstName: '', playtimeSeconds: 0, savedAt: fs.statSync(slotPath(i)).mtime.toISOString() });
    }
  }
  return slots;
});

// ── Feedback (Discord-Webhook) ───────────────────────────────────────────
// Die echte Webhook-URL liegt in einer gitignored lokalen Datei
// (discord-webhook.local.json), NICHT direkt im Quellcode -- sonst würde sie
// beim nächsten Push öffentlich im GitHub-Repo landen und jeder, der sie
// dort findet, könnte beliebige Nachrichten in den Discord-Kanal posten.
// Fehlt die Datei (z.B. bei jemandem, der das Repo frisch klont, ohne
// eigenen Webhook), ist Feedback einfach deaktiviert statt hart zu crashen.
let feedbackWebhookUrl = null;
try {
  const feedbackConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'discord-webhook.local.json'), 'utf-8'));
  feedbackWebhookUrl = feedbackConfig.feedbackWebhookUrl || null;
} catch {}

ipcMain.handle('is-feedback-ready', () => !!feedbackWebhookUrl);

function feedbackRatingColor(rating) {
  if (rating >= 4) return 0x3ecf72; // grün — zufrieden
  if (rating === 3) return 0xe0a83e; // amber — neutral
  if (rating >= 1) return 0xe8543e; // rot — unzufrieden
  return 0x4c6fff; // blau — keine Bewertung abgegeben
}

// Postet Bewertung+Nachricht als Discord-Embed über das Node-eigene
// https-Modul (keine zusätzliche Dependency nötig). Rating/Nachricht werden
// serverseitig nochmal validiert/begrenzt, nicht nur im Renderer (Textarea-
// maxlength dort ist nur UX-Komfort, kein echter Schutz).
ipcMain.handle('send-feedback', (_event, feedback) => {
  if (!feedbackWebhookUrl) {
    return Promise.resolve({ ok: false, error: 'Feedback ist in diesem Build nicht konfiguriert.' });
  }
  const rating = Math.max(0, Math.min(5, Math.round(Number(feedback && feedback.rating) || 0)));
  const message = String((feedback && feedback.message) || '').slice(0, 800).trim();
  if (!message) {
    return Promise.resolve({ ok: false, error: 'Bitte eine Nachricht eingeben.' });
  }

  const ratingText = rating > 0
    ? '⭐'.repeat(rating) + '☆'.repeat(5 - rating) + ' (' + rating + '/5)'
    : 'Keine Bewertung abgegeben';
  const payload = JSON.stringify({
    username: 'RLCS Legends Feedback',
    embeds: [{
      title: 'Neues Spieler-Feedback',
      color: feedbackRatingColor(rating),
      fields: [
        { name: 'Bewertung', value: ratingText, inline: true },
        { name: 'Version', value: app.getVersion(), inline: true },
        { name: 'Plattform', value: process.platform, inline: true },
        { name: 'Nachricht', value: message },
      ],
      timestamp: new Date().toISOString(),
    }],
  });

  return new Promise((resolve) => {
    let webhookUrl;
    try {
      webhookUrl = new URL(feedbackWebhookUrl);
    } catch {
      resolve({ ok: false, error: 'Webhook-URL ist ungültig konfiguriert.' });
      return;
    }
    const req = https.request({
      hostname: webhookUrl.hostname,
      port: webhookUrl.port || 443,
      path: webhookUrl.pathname + webhookUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      // Discord-Webhooks antworten bei Erfolg mit 204 (kein Body).
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    // Bug-Fix (Audit Runde 5): ohne Timeout (anders als das bereits
    // bestehende 20s-Watchdog-Muster bei den Update-Prüfungen) hängt der
    // Feedback-Button bei einer toten Verbindung (kein 'error'-Event, einfach
    // Stille) für immer auf "Wird gesendet…", ohne Fehlermeldung/Retry-
    // Möglichkeit außer App-Neustart.
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, error: 'Zeitüberschreitung -- keine Antwort vom Server.' });
    });
    req.write(payload);
    req.end();
  });
});

// ── Einstellungen (globale App-Präferenzen, getrennt von den Speicherständen —
// gelten karrieren-/slot-übergreifend, z.B. bevor überhaupt eine Karriere
// existiert) ──────────────────────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  autoCheckUpdates: true,
  defaultMatchSpeed: 1,
  quickSimPace: 'normal',
  // displayMode: 'windowed' | 'fullscreen' | 'borderless' (rahmenloses Vollbild)
  displayMode: 'windowed',
  windowSize: '1280x800', // eine der WINDOW_SIZE_PRESETS-Schlüssel, oder 'maximized'
  uiScale: 1,
  rememberWindowBounds: true,
  windowBounds: null, // { x, y, width, height } — nur genutzt, wenn rememberWindowBounds
  soundEnabled: true,
  soundVolume: 0.5, // 0..1
  introVideoVolume: 0.7, // 0..1 -- eigener Regler, unabhängig von soundVolume (Button-Sounds)
  musicVolume: 0.3, // 0..1 -- Hintergrundmusik (#bg-music in index.html), läuft app-weit durch
};

function loadSettingsSync() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsSync(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  atomicWriteFileSync(settingsPath, JSON.stringify(merged));
  return merged;
}

ipcMain.handle('get-settings', () => loadSettingsSync());
ipcMain.handle('save-settings', (_event, settings) => saveSettingsSync(settings));

// Bug-Fix (Audit): Hauptmenü zeigte bisher einen hart eingetippten
// Versionstext (index.html), der bei jedem Release manuell nachgezogen
// werden musste und dabei mehrfach veraltete -- liest jetzt live aus
// package.json über app.getVersion(), exakt dieselbe Quelle wie der
// bereits bestehende Discord-Feedback-Versionswert.
ipcMain.handle('get-app-version', () => app.getVersion());

// ── Fenster-/Anzeigemodus ────────────────────────────────────────────────
// Electron kann den `frame`-Wert eines BrowserWindow nicht nachträglich
// ändern (nur bei der Erstellung festlegbar) — deshalb braucht der Wechsel
// von/zu "Rahmenloser Vollbildmodus" (frame:false) eine Fensterneuerstellung.
// Zwischen "Fenstermodus" und "Vollbild" (beide frame:true) reicht dagegen
// ein einfaches setFullScreen() ohne Neuerstellung.
const WINDOW_SIZE_PRESETS = {
  '1280x800': { width: 1280, height: 800 },
  '1366x768': { width: 1366, height: 768 },
  '1600x900': { width: 1600, height: 900 },
  '1920x1080': { width: 1920, height: 1080 },
};

let mainWindow = null;
let mainWindowIsBorderless = false;
let boundsPersistTimer = null;

// Bug-Fix (Audit Runde 5): gespeicherte windowBounds wurden bisher blind per
// Object.assign übernommen, ohne Abgleich mit den aktuell angeschlossenen
// Displays -- wechselt die Monitor-Konfiguration zwischen zwei Sitzungen
// (externer Monitor abgesteckt, Auflösung geändert), konnte das Fenster
// komplett außerhalb jedes sichtbaren Bereichs starten (Prozess läuft,
// Taskleisten-Icon da, aber nichts sichtbar -- kein Wiederherstellungsweg
// außer manuellem Löschen von settings.json).
function boundsOverlapAnyDisplay(bounds) {
  return screen.getAllDisplays().some((d) => {
    const r = d.bounds;
    return bounds.x < r.x + r.width && bounds.x + bounds.width > r.x
      && bounds.y < r.y + r.height && bounds.y + bounds.height > r.y;
  });
}

function windowCreateOptionsFor(settings) {
  const isBorderless = settings.displayMode === 'borderless';
  const opts = {
    minWidth: 1000,
    minHeight: 680,
    frame: !isBorderless,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (isBorderless) {
    const bounds = screen.getPrimaryDisplay().bounds;
    Object.assign(opts, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, resizable: false, fullscreenable: false });
  } else if (settings.rememberWindowBounds && settings.windowBounds && boundsOverlapAnyDisplay(settings.windowBounds)) {
    Object.assign(opts, settings.windowBounds);
  } else {
    const preset = WINDOW_SIZE_PRESETS[settings.windowSize] || WINDOW_SIZE_PRESETS['1280x800'];
    Object.assign(opts, { width: preset.width, height: preset.height });
  }
  return { opts, isBorderless };
}

// ── Maus-Einfang im Vollbild-Modus (ClipCursor) ─────────────────────────────
// Chromium/Electron bieten keine API, um den System-Mauszeiger auf den
// Fensterbereich zu begrenzen (nur die Pointer-Lock-API mit RELATIVEN
// Bewegungen — für ein UI-lastiges Spiel mit Drag&Drop-Kader-Ansicht nicht
// praktikabel, da jeder Klick/Drag neu gebaut werden müsste). Für "echtes"
// Einfangen (Maus bleibt im Fenster, Cursor bleibt normal/absolut
// positionierbar) rufen wir die native Win32-Funktion ClipCursor() über
// einen persistenten PowerShell-Hilfsprozess auf (kein natives npm-Modul/
// node-gyp-Build nötig — läuft nur unter Windows, reicht für dieses reine
// NSIS-Win32-Target).
//
// SICHERHEITSKRITISCH: ClipCursor() wirkt SYSTEMWEIT, nicht nur für unser
// Fenster — bliebe es versehentlich aktiv während der Nutzer wegwechselt,
// wäre die Maus für ALLE Anwendungen auf den alten Fensterbereich beschränkt.
// Deshalb wird bei JEDEM denkbaren Verlassen-Pfad (Fokusverlust, Minimieren,
// Vollbild verlassen, Fenster schließen, App-Beenden) sofort wieder
// freigegeben, plus ein Watchdog-Intervall als Netz falls doch mal ein Event
// verpasst wird. Tastatur-Task-Switching (Windows-Taste, Alt+Tab) wird von
// ClipCursor() nie blockiert — bleibt also immer als Fluchtweg verfügbar,
// selbst wenn die Maus-Freigabe aus irgendeinem Grund hängen würde.
let cursorClipProc = null;
let cursorClipActive = false;

// WICHTIG: das Skript wird als `-Command`-ARGUMENT übergeben (argv), NICHT
// über stdin (`-Command -`) — dabei würde PowerShell den GESAMTEN
// stdin-Stream bis EOF als Befehlstext lesen, bevor überhaupt etwas
// ausgeführt wird, und könnte die spätere `[Console]::In.ReadLine()`-
// Laufzeitschleife (für die CLIP/RELEASE-Befehle) nicht sauber vom eigenen
// Quelltext unterscheiden. Als argv-Argument startet die Ausführung sofort,
// stdin bleibt frei für die Laufzeit-Befehle. Inline `-Command`-Skripte
// unterliegen (anders als `.ps1`-Dateien) nicht der Script-Execution-Policy
// — braucht also keinerlei Policy-Änderung/-Bypass.
function getCursorClipProcess() {
  if (cursorClipProc && !cursorClipProc.killed) return cursorClipProc;
  const script = [
    '$sig = @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class RlcsClipCursor {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '  [DllImport("user32.dll", EntryPoint="ClipCursor")]',
    '  public static extern bool ClipCursorRect(ref RECT rect);',
    '  [DllImport("user32.dll", EntryPoint="ClipCursor")]',
    '  public static extern bool ClipCursorRelease(IntPtr rect);',
    '}',
    '\'@',
    'Add-Type -TypeDefinition $sig -Language CSharp',
    'while ($true) {',
    '  $line = [Console]::In.ReadLine()',
    '  if ($line -eq $null) { break }',
    '  if ($line -eq "RELEASE") {',
    '    [RlcsClipCursor]::ClipCursorRelease([IntPtr]::Zero) | Out-Null',
    '  } elseif ($line.StartsWith("CLIP ")) {',
    '    $p = $line.Substring(5).Split(",")',
    '    $rect = New-Object RlcsClipCursor+RECT',
    '    $rect.Left = [int]$p[0]; $rect.Top = [int]$p[1]; $rect.Right = [int]$p[2]; $rect.Bottom = [int]$p[3]',
    '    [RlcsClipCursor]::ClipCursorRect([ref]$rect) | Out-Null',
    '  }',
    '}',
  ].join('\n');

  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
  proc.on('error', () => { cursorClipProc = null; }); // z.B. PowerShell nicht verfügbar — Feature wird dann einfach übersprungen
  proc.on('exit', () => { if (cursorClipProc === proc) cursorClipProc = null; });
  cursorClipProc = proc;
  return proc;
}

function clipCursorToWindow(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const proc = getCursorClipProcess();
    const b = win.getBounds();
    proc.stdin.write('CLIP ' + b.x + ',' + b.y + ',' + (b.x + b.width) + ',' + (b.y + b.height) + '\n');
    cursorClipActive = true;
  } catch {}
}

function releaseCursorClip() {
  if (!cursorClipActive || process.platform !== 'win32') return;
  try {
    if (cursorClipProc && !cursorClipProc.killed) cursorClipProc.stdin.write('RELEASE\n');
  } catch {}
  cursorClipActive = false;
}

function attachCursorClipHandlers(win) {
  win.on('focus', () => { if (win.isFullScreen()) clipCursorToWindow(win); });
  win.on('blur', releaseCursorClip);
  win.on('minimize', releaseCursorClip);
  win.on('leave-full-screen', releaseCursorClip);
  win.on('enter-full-screen', () => { if (win.isFocused()) clipCursorToWindow(win); });

  // Watchdog: gleicht den Klemm-Zustand alle 2s gegen die tatsächlichen
  // Fokus-/Vollbild-Eigenschaften ab — Netz für den seltenen Fall, dass ein
  // Fokus-/Vollbild-Event mal nicht feuert.
  const watchdog = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(watchdog); return; }
    const shouldBeClipped = win.isFullScreen() && win.isFocused();
    if (shouldBeClipped && !cursorClipActive) clipCursorToWindow(win);
    else if (!shouldBeClipped && cursorClipActive) releaseCursorClip();
  }, 2000);
  win.on('closed', () => { clearInterval(watchdog); releaseCursorClip(); });
}

app.on('before-quit', releaseCursorClip);
app.on('will-quit', () => {
  releaseCursorClip();
  if (cursorClipProc && !cursorClipProc.killed) cursorClipProc.kill();
  stopAiServer();
});

function persistWindowBounds(win) {
  clearTimeout(boundsPersistTimer);
  boundsPersistTimer = setTimeout(() => {
    if (win.isDestroyed() || mainWindowIsBorderless || win.isFullScreen()) return;
    const current = loadSettingsSync();
    if (!current.rememberWindowBounds) return;
    saveSettingsSync({ ...current, windowBounds: win.getBounds() });
  }, 400);
}

function createWindow() {
  const settings = loadSettingsSync();
  const { opts, isBorderless } = windowCreateOptionsFor(settings);
  const win = new BrowserWindow(opts);
  mainWindowIsBorderless = isBorderless;
  win.loadFile('index.html');
  mainWindow = win;

  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.uiScale || 1));

  if (!isBorderless && settings.displayMode === 'fullscreen') {
    win.setFullScreen(true);
  } else if (!isBorderless && settings.windowSize === 'maximized') {
    win.maximize();
  }

  win.on('resize', () => persistWindowBounds(win));
  win.on('move', () => persistWindowBounds(win));
  attachCursorClipHandlers(win);

  // Renderer-Konsole (inkl. JS-Fehler) auch im Terminal sichtbar machen —
  // sonst landen sie nur in den (unsichtbaren) DevTools.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log('[renderer:' + tag + ']', message, sourceId ? '(' + sourceId + ':' + line + ')' : '');
  });
}

// Wendet die aktuell GESPEICHERTEN Anzeige-Einstellungen auf das laufende
// Fenster an — erstellt es neu, falls sich der Rahmen-Modus (rahmenlos vs.
// normal) geändert hat (siehe Kommentar oben), sonst live ohne Neustart.
// Wird NUR nach einem Klick auf "Speichern" im Einstellungen-Popup gerufen
// (User-Wunsch: keine Live-Vorschau mehr beim bloßen Antesten der Optionen).
function ensureWindowMatchesDisplaySettings() {
  const settings = loadSettingsSync();
  const { isBorderless } = windowCreateOptionsFor(settings);

  if (isBorderless !== mainWindowIsBorderless) {
    const old = mainWindow;
    createWindow();
    // WICHTIG: alte Fenster erst im NÄCHSTEN Tick schließen, nicht sofort.
    // Wird diese Funktion selbst über IPC von genau DIESEM (alten) Fenster
    // aus aufgerufen (z.B. Klick auf "Rahmenloser Vollbildmodus" im
    // Einstellungen-Popup, das im alten Fenster läuft), muss die IPC-Antwort
    // erst zurück zum Renderer geschickt werden können, bevor sein Fenster
    // zerstört wird — sonst hängt das wartende `ipcRenderer.invoke(...)`-
    // Promise für immer, weil die Antwort nie ankommt (beobachtet: Testlauf
    // blieb exakt hier für immer hängen, bis der Prozess extern gekillt wurde).
    if (old && !old.isDestroyed()) {
      setImmediate(() => { if (!old.isDestroyed()) old.close(); });
    }
    return;
  }

  if (isBorderless) {
    const bounds = screen.getPrimaryDisplay().bounds;
    mainWindow.setBounds(bounds);
  } else if (settings.displayMode === 'fullscreen') {
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    if (settings.windowSize === 'maximized') {
      mainWindow.maximize();
    } else {
      mainWindow.unmaximize();
      const preset = WINDOW_SIZE_PRESETS[settings.windowSize] || WINDOW_SIZE_PRESETS['1280x800'];
      mainWindow.setSize(preset.width, preset.height);
      mainWindow.center();
    }
  }
  mainWindow.webContents.setZoomFactor(settings.uiScale || 1);
}

// Persistiert + wendet an (nach Klick auf "Speichern" im Einstellungen-Popup).
ipcMain.handle('apply-display-settings', () => {
  ensureWindowMatchesDisplaySettings();
  return loadSettingsSync();
});

// ── Lokale Game-KI (llama.cpp + GGUF-Modell) ────────────────────────────
// Masterprompt-Auftrag: echte generative KI, komplett lokal/offline, ohne
// dass der Endnutzer Ollama/Python/Terminal braucht. Runtime + Modell sind
// GETRENNT vom Spiel versioniert (AI_RUNTIME_VERSION/AI_MODEL_VERSION) --
// ein normales Game-Update lädt NIE das mehrere-GB-große Modell neu.
//
// Auflösung der Dateipfade: zuerst der Entwicklungs-Ordner tools/ai/ im
// Projekt selbst (dort liegt es während der Entwicklung, siehe .gitignore --
// wird NIE ins Repo committed), sonst userData (dort landet es beim
// Endnutzer nach dem Auto-Setup-Download, gleicher Ort wie Spielstände/
// Einstellungen -- bleibt bei einer Neuinstallation erhalten, anders als
// das Programmverzeichnis, das i.d.R. nicht beschreibbar ist).
const AI_RUNTIME_VERSION = '1.0.0';
const AI_MODEL_VERSION = '1.0.0';
const AI_CONTEXT_SCHEMA_VERSION = 2;
const AI_MODEL_FILENAME = 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
// Qwen3-4B-Instruct-2507, Apache-2.0 (kommerzielle Nutzung + Redistribution
// erlaubt), Q4_K_M-Quantisierung von unsloth -- siehe Abschlussbericht für
// die vollständige Lizenz-/Größenbegründung.
// Auf einen konkreten Commit gepinnt (nicht "resolve/main/...") -- Abschnitt
// 21: eine "main"-URL könnte durch einen künftigen Push im fremden Repo auf
// eine andere Datei zeigen, ohne dass hier je etwas geändert wurde. SHA-256
// unten bleibt trotzdem die eigentliche Integritätsprüfung.
const AI_MODEL_DOWNLOAD_URL = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const AI_MODEL_SIZE_BYTES = 2497281120;
const AI_MODEL_SHA256 = '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597';
// Abschnitt 5/6/9 (Runde V5): reale, tatsächlich existierende Backend-Builds
// DERSELBEN llama.cpp-Release (b10411), geprüft über die echten GitHub-
// Release-Assets -- keine erfundenen Optionen. CUDA/SYCL entfallen (keine
// NVIDIA-/Intel-GPU zu bedienen, bewusst geprüft). ROCm(HIP) wurde real
// heruntergeladen und geprüft, dann verworfen: das Windows-ROCm-Release
// bündelt eine 924 MB große ggml-hip.dll (kompletter statischer HIP/
// rocBLAS-Runtime-Klumpen) -- fast 4x die Modellgröße allein für die
// Runtime, für einen optionalen Endnutzer-Download unverhältnismäßig.
// Vulkan braucht dagegen NUR den ohnehin vorhandenen GPU-Treiber (kein
// separates CUDA-Toolkit/ROCm/Python/Compiler beim Endnutzer, Abschnitt 6/8)
// und lief im echten Benchmark dieser Runde stabil mit ~12x der CPU-
// Generierungsgeschwindigkeit -- siehe Abschlussbericht.
const AI_RUNTIME_VARIANTS = {
  cpu: {
    dirName: 'cpu',
    zipUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10411/llama-b10411-bin-win-cpu-x64.zip',
  },
  vulkan: {
    dirName: 'vulkan',
    zipUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10411/llama-b10411-bin-win-vulkan-x64.zip',
    zipSha256: '6d0f5dd7747560cdbbe8a90c950d2d0059e2c8d6211b10952e1a7cc090795080',
  },
};
// Hochzählen, falls sich die Erkennungs-/Auswahllogik künftig ändert --
// erzwingt bei bereits eingerichteten Spielern eine Neukalibrierung.
const AI_HARDWARE_PROFILE_VERSION = 1;
const AI_SERVER_PORT = 8734; // bewusst kein Standardport (8080/3000/...), localhost-only
const AI_SERVER_HOST = '127.0.0.1';
// Bug-Fix (Performance-Benchmark dieser Runde): 45s reichten bei Standard-
// Threadzahl (4,6 Tok/s Generierung) für lange Antworten nicht -- zwei von
// sieben Testanfragen liefen live in den Timeout und fielen auf den
// Fehler-Fallback zurück. Mit der jetzt korrigierten Threadzahl (8,8 Tok/s,
// siehe ensureAiServerRunning()) reicht 45s meist, 60s bleibt als Sicherheits-
// marge für einen kalten ersten Request nach dem Serverstart.
const AI_CHAT_TIMEOUT_MS = 60000; // Abschnitt 42: Spiel darf nie hängen bleiben

// Variant-Parameter (Runde V5): 'cpu' (Standard, unverändertes Verzeichnis --
// keine Migration für bereits eingerichtete Spieler nötig) oder 'vulkan'
// (neu, eigenes Verzeichnis, nur wenn das Hardwareprofil es empfiehlt).
function aiDevRuntimeDir(variant) { return path.join(__dirname, 'tools', 'ai', 'runtime', variant || 'cpu'); }
function aiDevModelDir() { return path.join(__dirname, 'tools', 'ai', 'models'); }
function aiUserRuntimeDir(variant) { return path.join(app.getPath('userData'), (variant && variant !== 'cpu') ? ('ai-runtime-' + variant) : 'ai-runtime'); }
function aiUserModelDir() { return path.join(app.getPath('userData'), 'ai-models'); }

function resolveAiServerExeForVariant(variant) {
  const devPath = path.join(aiDevRuntimeDir(variant), 'llama-server.exe');
  if (fs.existsSync(devPath)) return devPath;
  const userPath = path.join(aiUserRuntimeDir(variant), 'llama-server.exe');
  if (fs.existsSync(userPath)) return userPath;
  return null;
}
// Bleibt bewusst auf 'cpu' fixiert: das ist die Pflicht-Baseline (Abschnitt
// 12), die jede bestehende "ist die KI grundsätzlich installiert?"-Prüfung
// (deriveAiState, app.whenReady()-Warmup) unverändert weiter beantwortet.
function resolveAiServerExe() { return resolveAiServerExeForVariant('cpu'); }
function resolveAiModelFile() {
  const devPath = path.join(aiDevModelDir(), AI_MODEL_FILENAME);
  if (fs.existsSync(devPath)) return devPath;
  const userPath = path.join(aiUserModelDir(), AI_MODEL_FILENAME);
  if (fs.existsSync(userPath)) return userPath;
  return null;
}

// ── Hardware-Erkennung & automatische Backend-Wahl (Runde V5) ───────────────
// Abschnitt 4/10/33/34: EINMALIGE Erkennung während der Ersteinrichtung,
// danach gecacht (ai-hardware-profile.json in userData) -- kein erneuter
// Hardware-Scan bei jedem Spielstart. dxdiag /t liefert die tatsächliche
// GPU-VRAM-Größe zuverlässig; Win32_VideoController.AdapterRAM ist für
// Karten >4GB ein bekannter 32-Bit-Overflow-Bug in Windows (meldete am
// Entwicklungs-PC 4 GB für eine tatsächlich 16 GB große Karte -- per dxdiag
// korrekt als 16338 MB verifiziert).
function aiHardwareProfilePath() { return path.join(app.getPath('userData'), 'ai-hardware-profile.json'); }

function detectGpuHardware() {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), 'rlcs-ai-dxdiag-' + Date.now() + '.txt');
    let done = false;
    const finish = (result) => { if (done) return; done = true; try { fs.unlinkSync(tmpFile); } catch {} resolve(result); };
    let proc;
    try { proc = spawn('dxdiag.exe', ['/t', tmpFile], { windowsHide: true }); }
    catch { finish(null); return; }
    const timer = setTimeout(() => { try { proc.kill(); } catch {} finish(null); }, 15000);
    proc.on('error', () => { clearTimeout(timer); finish(null); });
    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        const text = fs.readFileSync(tmpFile, 'utf8');
        // "Card name: X" gefolgt (innerhalb desselben Geräte-Eintrags) von
        // "Dedicated Memory: N MB" -- bei mehreren Monitoren an derselben
        // Karte taucht der Block mehrfach identisch auf, das max() unten
        // macht das unschädlich. Kein separates GPU-Erkennungstool nötig,
        // dxdiag ist auf jedem Windows-System bereits vorhanden.
        const re = /Card name:\s*(.+?)\r?\n[\s\S]{0,600}?Dedicated Memory:\s*(\d+)\s*MB/g;
        let match; let best = null;
        while ((match = re.exec(text))) {
          const vramMB = parseInt(match[2], 10);
          if (!best || vramMB > best.vramMB) {
            const name = match[1].trim();
            let vendor = 'unknown';
            if (/nvidia/i.test(name)) vendor = 'nvidia';
            else if (/amd|radeon/i.test(name)) vendor = 'amd';
            else if (/intel/i.test(name)) vendor = 'intel';
            best = { name, vendor, vramMB };
          }
        }
        finish(best);
      } catch { finish(null); }
    });
  });
}

function detectCpuPhysicalCores() {
  return new Promise((resolve) => {
    const logical = Math.max(1, os.cpus().length);
    let proc;
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command',
        '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum'], { windowsHide: true });
    } catch { resolve(logical); return; }
    let out = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(logical); }, 8000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => { clearTimeout(timer); resolve(logical); });
    proc.on('exit', () => {
      clearTimeout(timer);
      const n = parseInt(out.trim(), 10);
      resolve(Number.isFinite(n) && n > 0 ? n : logical);
    });
  });
}

// Kurzer echter Testlauf (Abschnitt 33: wenige Sekunden, nicht minutenlang)
// gegen einen bereits gestarteten llama-server -- misst die TATSÄCHLICHE
// Generierungsgeschwindigkeit dieser Konfiguration statt sie zu schätzen.
function measureGenerationSpeed(port) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ prompt: 'Erklaere in einem Satz, warum Teamkommunikation im Esport wichtig ist.', n_predict: 40, temperature: 0.1, cache_prompt: false });
    const req = http.request({ host: AI_SERVER_HOST, port, path: '/completion', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const t = parsed.timings || {};
          resolve({ ok: true, genTokPerSec: t.predicted_per_second || 0, promptTokPerSec: t.prompt_per_second || 0 });
        } catch { resolve({ ok: false }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
    req.write(body); req.end();
  });
}

// Abschnitt 11: NICHT hart hardcodiert nach Hardware-Annahme, sondern aus dem
// echten Kalibrierungs-Benchmark abgeleitet. Schwellen orientieren sich an
// den real gemessenen Werten dieser Runde (CPU-Baseline ~9 Tok/s landet
// bewusst in MEDIUM, GPU-Vulkan ~113 Tok/s in VERY_HIGH).
function classifyPerformanceTier(genTokPerSec) {
  if (genTokPerSec >= 50) return 'VERY_HIGH';
  if (genTokPerSec >= 15) return 'HIGH';
  if (genTokPerSec >= 5) return 'MEDIUM';
  return 'LOW';
}

// Abschnitt 26/27 (Runde V5, echter Benchmark): auf dem Entwicklungs-PC
// (8 physische / 16 logische Kerne, SMT) lieferten 12 Threads wiederholt
// ~9,5-10,0 Tok/s gegenüber ~9,1-9,2 Tok/s bei allen 16 logischen Threads --
// ein kleiner, aber über mehrere Läufe konsistenter Vorteil. Bei diesem
// speicherbandbreitenlimitierten Workload konkurrieren Hyperthreads auf
// denselben physischen Kernen eher um Bandbreite, statt echten zusätzlichen
// Durchsatz zu liefern. physische Kerne * 1,5 (aufgerundet, gedeckelt auf die
// logische Kernzahl) reproduziert das ohne die logischen Kerne fest zu
// hardcodieren -- passt sich also automatisch an andere CPU-Layouts an.
function computeRecommendedThreads(physicalCores, logicalCores) {
  const logical = Math.max(1, logicalCores || 1);
  if (!physicalCores || physicalCores <= 0) return logical; // unbekannt -- sicherer alter Default
  return Math.max(1, Math.min(logical, Math.round(physicalCores * 1.5)));
}

function loadCachedHardwareProfile() {
  try {
    const raw = fs.readFileSync(aiHardwareProfilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.profileVersion === AI_HARDWARE_PROFILE_VERSION) return parsed;
  } catch {}
  return null;
}
function saveHardwareProfile(profile) {
  try { fs.writeFileSync(aiHardwareProfilePath(), JSON.stringify(profile, null, 2)); } catch {}
}
// Abschnitt 35: ändert sich CPU-Modell oder GPU zwischen zwei Starts (z.B.
// externe GPU getauscht, Spielstand auf neuen PC übertragen), weicht die
// Signatur ab -- die aufrufende Stelle kann dann gezielt neu kalibrieren.
function hardwareSignature(cpuModel, gpu) {
  return cpuModel + '|' + (gpu ? gpu.vendor + ':' + gpu.name + ':' + gpu.vramMB : 'none');
}

// Startet nacheinander (nie gleichzeitig, um sich nicht gegenseitig VRAM/CPU
// wegzunehmen) jeden verfügbaren Backend-Kandidaten auf einem separaten Port
// (stört einen eventuell parallel laufenden Produktivserver nicht), wartet
// auf Health-Check und misst dann die echte Tokens/s-Geschwindigkeit.
// Abschnitt 16: mehrere Anfragen wären "sicherer", aber bei einer einmaligen
// Kalibrierung im Sekundenbereich reicht ein kurzer, echter Messwert pro
// Kandidat -- kein synthetischer Schätzwert.
async function runLocalAiCalibration(candidateExePaths, modelPath, threadCount) {
  const results = {};
  for (const variant of ['cpu', 'vulkan']) {
    const exePath = candidateExePaths[variant];
    if (!exePath) continue;
    const testPort = AI_SERVER_PORT + 1;
    const ngl = variant === 'vulkan' ? 999 : 0;
    let crashed = false;
    let proc;
    try {
      proc = spawn(exePath, [
        '-m', modelPath, '--port', String(testPort), '--host', AI_SERVER_HOST,
        '-c', '2048', '-ngl', String(ngl), '--threads', String(threadCount), '--threads-batch', String(threadCount), '--no-webui',
      ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    } catch { results[variant] = null; continue; }
    proc.on('error', () => { crashed = true; });
    proc.on('exit', () => { crashed = true; });
    const deadline = Date.now() + 20000;
    let healthy = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (crashed) break;
      const ok = await new Promise((resolve) => {
        const req = http.get({ host: AI_SERVER_HOST, port: testPort, path: '/health', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ok) { healthy = true; break; }
    }
    if (healthy) {
      results[variant] = await measureGenerationSpeed(testPort);
      if (!results[variant].ok) results[variant] = null;
    } else {
      results[variant] = null;
      // Abschnitt 13: Fallback nicht verstecken -- Development-Log, keine Nutzer-Fehlermeldung nötig (CPU bleibt Pflicht-Fallback, Abschnitt 12).
      console.log('[LocalAI] Backend "' + variant + '" wurde während der Kalibrierung nicht rechtzeitig gesund (Absturz oder Timeout) -> wird nicht empfohlen.');
    }
    try { if (proc && !proc.killed) proc.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 800)); // Port sauber freigeben, bevor der nächste Kandidat startet
  }
  return results;
}

// Abschnitt 16: nicht blind die höchste Tok/s-Zahl wählen -- ein GPU-Backend
// muss deutlich (>30%) schneller sein als CPU, um die zusätzliche
// Backend-Komplexität/den zusätzlichen Download zu rechtfertigen. Bei einem
// nur marginalen oder verrauschten Unterschied bleibt CPU (die portablere,
// bereits vollständig verifizierte Wahl) die Empfehlung.
function decideBackendFromCalibration(results) {
  const cpu = results.cpu;
  const vulkan = results.vulkan;
  if (vulkan && vulkan.genTokPerSec > 0 && (!cpu || vulkan.genTokPerSec > cpu.genTokPerSec * 1.3)) {
    return { backend: 'vulkan', genTokPerSec: vulkan.genTokPerSec, promptTokPerSec: vulkan.promptTokPerSec };
  }
  if (cpu && cpu.genTokPerSec > 0) return { backend: 'cpu', genTokPerSec: cpu.genTokPerSec, promptTokPerSec: cpu.promptTokPerSec };
  return { backend: 'cpu', genTokPerSec: 0, promptTokPerSec: 0 }; // nichts messbar -- CPU bleibt Pflicht-Fallback (Abschnitt 12)
}

let aiServerProc = null;
let aiServerStarting = null; // Promise, verhindert doppelten Start bei gleichzeitigen Anfragen
let aiServerReady = false;
// Abschnitt 20: benannte Zustandsmaschine statt loser Booleans -- die UI soll
// nie eine Anfrage senden, solange der Zustand nicht READY/RUNNING ist.
let aiLastError = null;
let aiActiveBackend = 'cpu'; // Runde V5: welches Backend tatsächlich läuft (für Settings-Anzeige/Dev-Profiler)
let aiLastGpuFallbackReason = null;
function deriveAiState(runtimeReady, modelReady) {
  if (aiSetupInProgress) return aiSetupStage === 'verify' ? 'VERIFYING' : 'DOWNLOADING';
  if (!runtimeReady || !modelReady) return aiLastError ? 'ERROR' : 'NOT_INSTALLED';
  if (aiServerReady) return 'RUNNING';
  if (aiServerStarting) return 'LOADING';
  if (aiLastError) return 'ERROR';
  return 'READY';
}

function aiServerHealthCheck() {
  return new Promise((resolve) => {
    const req = http.get({ host: AI_SERVER_HOST, port: AI_SERVER_PORT, path: '/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Startet llama-server als Kindprozess (gleiches Muster wie
// getCursorClipProcess() oben: windowsHide, stdio ignoriert, Referenz +
// error/exit-Handler). Wartet per Health-Check-Polling, bis das Modell
// tatsächlich geladen ist, statt sofort "bereit" zu melden.
// Bug-Fix (Runde V7, Teil G, live als echtes Problem erkannt -- UND live per
// eigenem Test korrigiert): ein EINMALIGER GPU-Fehlschlag markierte das
// Profil bisher DAUERHAFT auf 'cpu' -- selbst nach einem App-Neustart mit
// wieder funktionierender GPU würde nie wieder Vulkan versucht (Abschnitt
// G3). Ein erster Fix-Versuch mit einem reinen Zeit-Cooldown (15 Minuten)
// war noch FALSCH kalibriert: ein Testneustart Sekunden nach dem
// Fehlschlag fiel weiterhin in den Cooldown und blieb fälschlich auf CPU --
// die eigentliche Erwartung aus Abschnitt G2 ("App beenden... App starten")
// ist an den PROZESS-Neustart gekoppelt, nicht an eine feste Wartezeit.
// Fix: ein reiner IN-MEMORY-Flag (nicht persistiert) -- pro App-Sitzung wird
// GPU genau EINMAL versucht; scheitert es, bleibt es für den Rest DIESER
// Sitzung bei CPU (keine wiederholten Fehlversuche bei jeder Chat-
// Nachricht), aber ein echter Neustart (frischer Prozess, Flag zurück auf
// false) probiert automatisch wieder GPU. gpuFallbackAt/-Reason bleiben im
// Profil rein zu Diagnose-/Anzeigezwecken erhalten.
let aiGpuRetriedThisSession = false;

// Abschnitt 10/12: Backend aus dem gecachten Hardwareprofil, mit hartem
// CPU-Fallback, falls kein Profil existiert oder die empfohlene GPU-Runtime
// lokal fehlt -- die KI darf NIE eine GPU voraussetzen.
function desiredAiBackend() {
  const p = loadCachedHardwareProfile();
  if (!p || p.recommendedBackend !== 'vulkan' || !resolveAiServerExeForVariant('vulkan')) return 'cpu';
  if (aiGpuRetriedThisSession) return 'cpu'; // in dieser Sitzung schon erfolglos versucht
  return 'vulkan';
}

async function ensureAiServerRunning() {
  // Bug-Fix (Runde V5, live gefunden): der frühere Kurzschluss prüfte NUR
  // "läuft bereits + gesund" -- lief der Server (z.B. durch den Warmstart
  // beim App-Start, der immer mit CPU startet, bevor überhaupt ein
  // Hardwareprofil existiert) schon VOR einer frisch abgeschlossenen
  // Kalibrierung, wechselte er nie mehr auf das neu empfohlene GPU-Backend --
  // die Einrichtung endete am Ende trotz "vulkan empfohlen" real auf CPU.
  // Der Kurzschluss gilt jetzt nur noch, wenn das AKTIVE Backend auch dem
  // aktuell empfohlenen entspricht.
  if (aiServerReady && aiActiveBackend === desiredAiBackend() && (await aiServerHealthCheck())) return { ok: true };
  if (aiServerStarting) return aiServerStarting;
  const modelPath = resolveAiModelFile();
  if (!resolveAiServerExe() || !modelPath) return { ok: false, reason: 'missing-files' };

  aiServerStarting = (async () => {
    if (aiServerProc && !aiServerProc.killed) {
      try { aiServerProc.kill(); } catch {}
      aiServerProc = null;
      aiServerReady = false;
    }
    // Benchmark V4 (Ryzen 7 5700X, 8C/16T): Standard-Threadzahl von llama-
    // server lag klar unter dem Optimum -- auf ALLE logischen Kerne gesetzt
    // verdoppelte fast den Durchsatz. Benchmark V5 verfeinerte das weiter
    // (siehe computeRecommendedThreads()): 12 statt 16 Threads maßen auf
    // demselben PC nochmal ~5-6% schneller. Threadzahl kommt jetzt aus dem
    // gecachten Hardwareprofil (dort mit derselben Formel berechnet); ohne
    // Profil (z.B. Hintergrund-Warmstart vor der ersten Einrichtung) bleibt
    // der alte, sichere Default (alle logischen Kerne).
    // Bug-Fix (Runde V7, Teil H, live gefunden): ein beschädigtes/manuell
    // manipuliertes Profil mit z.B. recommendedThreads:-5 wurde bisher UNGEPRÜFT
    // an "--threads" durchgereicht -- eine negative Zahl ist zwar "truthy" in JS
    // (der bisherige "|| Fallback" griff also NICHT), hätte aber llama-server.exe
    // mit einem ungültigen Kommandozeilen-Argument gestartet. Jetzt echte
    // Plausibilitäts-Prüfung (positive ganze Zahl, gedeckelt auf das
    // Doppelte der logischen Kernzahl als großzügige Obergrenze) statt nur "ist
    // truthy" -- ein ungültiger Wert im Profil fällt automatisch auf den
    // sicheren Default zurück, kein Crash/Fehlstart von llama-server.exe.
    const logicalCoresNow = Math.max(1, os.cpus().length);
    const cachedProfileForThreads = loadCachedHardwareProfile();
    const cachedThreads = cachedProfileForThreads && cachedProfileForThreads.recommendedThreads;
    const threadCount = (Number.isInteger(cachedThreads) && cachedThreads >= 1 && cachedThreads <= logicalCoresNow * 2)
      ? cachedThreads
      : logicalCoresNow;

    let backend = desiredAiBackend();
    let exePath = resolveAiServerExeForVariant(backend);
    if (!exePath) { backend = 'cpu'; exePath = resolveAiServerExeForVariant('cpu'); }
    if (!exePath) return { ok: false, reason: 'missing-files' };

    const attempt = async (variant, variantExePath) => {
      const ngl = variant === 'vulkan' ? 999 : 0; // volle GPU-Auslagerung (Abschnitt 14: VRAM des Entwicklungs-PCs deckt Modell+Kontext bequem, siehe Abschlussbericht)
      let proc;
      try {
        // Bug-Fix (Runde V5, live gefunden, Abschnitt 72/96): spawn() kann bei
        // einer defekten/keiner echten Windows-Exe SYNCHRON werfen ("spawn
        // UNKNOWN") statt nur asynchron ein 'error'-Event zu feuern. Ohne
        // dieses try/catch riss das die gesamte ensureAiServerRunning()-Kette
        // und damit den ai-ensure-ready-IPC-Aufruf mit sich -- der Renderer
        // bekam einen harten Fehler statt des vorgesehenen CPU-Fallbacks.
        proc = spawn(variantExePath, [
          '-m', modelPath,
          '--port', String(AI_SERVER_PORT),
          '--host', AI_SERVER_HOST,
          '-c', '8192', // Kontextfenster -- reicht für Systemprompt + relevanten Game-State + kurze Konversation
          '-ngl', String(ngl),
          '--threads', String(threadCount),
          '--threads-batch', String(threadCount),
          '--no-webui',
        ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
      } catch {
        return { ok: false, reason: 'spawn-failed' };
      }
      proc.on('error', () => { aiServerReady = false; if (aiServerProc === proc) aiServerProc = null; });
      proc.on('exit', () => { aiServerReady = false; if (aiServerProc === proc) aiServerProc = null; });
      aiServerProc = proc;
      // Abschnitt 28/29: normale statt hohe Prozesspriorität -- die KI-
      // Inferenz darf das eigentliche Spiel (Matchsimulation, UI, Audio) nie
      // ausbremsen. ABOVE_NORMAL bevorzugt sie nur leicht gegenüber echten
      // Hintergrundprozessen, niemals HIGH/REALTIME.
      try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}

      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 700));
        if (!aiServerProc) return { ok: false, reason: 'crashed' }; // Prozess ist währenddessen abgestürzt
        if (await aiServerHealthCheck()) {
          aiServerReady = true; aiLastError = null; aiActiveBackend = variant;
          // GPU lief gerade erfolgreich -- ein evtl. gesetztes Session-Flag/
          // Diagnose-Timestamp aus einem früheren Fehlschlag ist überholt.
          if (variant === 'vulkan') {
            aiGpuRetriedThisSession = false;
            const cached = loadCachedHardwareProfile();
            if (cached && cached.gpuFallbackAt) { delete cached.gpuFallbackAt; delete cached.gpuFallbackReason; saveHardwareProfile(cached); }
          }
          return { ok: true };
        }
      }
      return { ok: false, reason: 'timeout' };
    };

    let result = await attempt(backend, exePath);
    if (!result.ok && backend === 'vulkan') {
      // Abschnitt 12/13: GPU darf nie zur Voraussetzung werden -- sichtbar
      // geloggter, automatischer CPU-Fallback statt einer kaputten KI.
      console.log('[LocalAI] GPU-Backend (vulkan) wurde nicht rechtzeitig gesund (' + result.reason + ') -> Fallback auf CPU.');
      aiLastGpuFallbackReason = result.reason;
      if (aiServerProc && !aiServerProc.killed) { try { aiServerProc.kill(); } catch {} aiServerProc = null; }
      const cpuExe = resolveAiServerExeForVariant('cpu');
      if (cpuExe) {
        const cpuResult = await attempt('cpu', cpuExe);
        if (cpuResult.ok) {
          // Session-Flag setzen (siehe aiGpuRetriedThisSession/desiredAiBackend()
          // oben) -- verhindert wiederholte Fehlversuche bei jeder weiteren
          // Chat-Nachricht DIESER Sitzung, ohne die Empfehlung im Profil
          // dauerhaft zu ändern (ein Neustart probiert automatisch neu, Abschnitt G2).
          aiGpuRetriedThisSession = true;
          const cached = loadCachedHardwareProfile();
          if (cached) { cached.gpuFallbackAt = new Date().toISOString(); cached.gpuFallbackReason = result.reason; saveHardwareProfile(cached); } // nur zu Diagnose-/Anzeigezwecken (Settings-UI)
        }
        result = cpuResult;
      }
    }
    return result;
  })();
  const result = await aiServerStarting;
  aiServerStarting = null;
  if (!result.ok) aiLastError = result.reason || 'unknown';
  return result;
}

function stopAiServer() {
  if (aiServerProc && !aiServerProc.killed) {
    try { aiServerProc.kill(); } catch {}
  }
  aiServerProc = null;
  aiServerReady = false;
}

ipcMain.handle('ai-get-status', async () => {
  const runtimeReady = !!resolveAiServerExe();
  const modelReady = !!resolveAiModelFile();
  return {
    runtimeReady, modelReady,
    serverRunning: aiServerReady,
    state: deriveAiState(runtimeReady, modelReady),
    lastError: aiLastError,
    aiRuntimeVersion: AI_RUNTIME_VERSION, aiModelVersion: AI_MODEL_VERSION,
    modelSizeBytes: AI_MODEL_SIZE_BYTES,
    // Runde V5 (Abschnitt 36/37): für die erweiterte Settings-Anzeige +
    // Dev-Profiler -- activeBackend ist das TATSÄCHLICH laufende Backend
    // (kann nach einem GPU-Fallback von hardwareProfile.recommendedBackend abweichen).
    activeBackend: aiActiveBackend,
    gpuFallbackReason: aiLastGpuFallbackReason,
    hardwareProfile: loadCachedHardwareProfile(),
  };
});

ipcMain.handle('ai-ensure-ready', async () => ensureAiServerRunning());

// Kernaufruf für den Chat -- proxied über den Hauptprozess (gleiches
// Sicherheitsprinzip wie der bestehende Discord-Feedback-Call: der Renderer
// bekommt nie direkten Netzwerkzugriff, alles läuft über einen geprüften
// IPC-Handler). OpenAI-kompatibles /v1/chat/completions-Format, das
// llama-server nativ bereitstellt.
ipcMain.handle('ai-chat', async (_event, payload) => {
  const readiness = await ensureAiServerRunning();
  if (!readiness.ok) return { ok: false, error: 'ai-not-ready', reason: readiness.reason };
  const body = JSON.stringify({
    messages: (payload && payload.messages) || [],
    temperature: (payload && typeof payload.temperature === 'number') ? payload.temperature : 0.75,
    max_tokens: (payload && payload.maxTokens) || 220,
    stream: false,
  });
  return new Promise((resolve) => {
    const req = http.request({
      host: AI_SERVER_HOST, port: AI_SERVER_PORT, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: AI_CHAT_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
          if (!text) { resolve({ ok: false, error: 'empty-response' }); return; }
          // Runde V5 (Abschnitt 85): llama-server hängt "timings" auch an die
          // OpenAI-kompatible Antwort an -- für den Dev-Profiler durchreichen.
          resolve({ ok: true, text: text.trim(), timings: parsed.timings || null, backend: aiActiveBackend });
        } catch {
          resolve({ ok: false, error: 'invalid-response' });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', () => resolve({ ok: false, error: 'connection-failed' }));
    req.write(body);
    req.end();
  });
});

// Streaming-Variante für den interaktiven Chat (Abschnitt 18): llama-server
// unterstützt SSE ("data: {...}\n\n"-Zeilen) über denselben OpenAI-kompatiblen
// Endpunkt, nur mit stream:true. Jedes Text-Delta geht sofort per Event an
// den Renderer (ai:chat-chunk), damit die Bubble Wort für Wort befüllt werden
// kann statt 10-40s auf die komplette Antwort zu warten -- das eigentliche
// Tempo (Tokens/Sekunde) ändert sich dadurch nicht, aber die gefühlte
// Reaktionszeit sinkt auf die Zeit bis zum ERSTEN Token (TTFT), nicht bis zur
// letzten Zeile. Das ipcMain.handle()-Promise liefert am Ende trotzdem den
// kompletten Text zurück (für Aktions-Parsing/History), Events sind nur die
// Zwischenanzeige.
ipcMain.handle('ai-chat-stream', async (event, payload) => {
  const readiness = await ensureAiServerRunning();
  if (!readiness.ok) return { ok: false, error: 'ai-not-ready', reason: readiness.reason };
  const requestId = payload && payload.requestId;
  const body = JSON.stringify({
    messages: (payload && payload.messages) || [],
    temperature: (payload && typeof payload.temperature === 'number') ? payload.temperature : 0.75,
    max_tokens: (payload && payload.maxTokens) || 220,
    stream: true,
  });
  return new Promise((resolve) => {
    let full = '';
    let settled = false;
    let lastTimings = null; // Runde V5 (Abschnitt 85): llama-server hängt "timings" an den letzten SSE-Chunk an
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const req = http.request({
      host: AI_SERVER_HOST, port: AI_SERVER_PORT, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: AI_CHAT_TIMEOUT_MS,
    }, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!rawEvent.startsWith('data:')) continue;
          const dataStr = rawEvent.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (delta) {
              full += delta;
              if (event.sender && !event.sender.isDestroyed()) event.sender.send('ai:chat-chunk', { requestId, delta });
            }
            if (json.timings) lastTimings = json.timings;
          } catch {}
        }
      });
      res.on('end', () => finish(full ? { ok: true, text: full.trim(), timings: lastTimings, backend: aiActiveBackend } : { ok: false, error: 'empty-response' }));
      res.on('error', () => finish({ ok: false, error: 'connection-failed' }));
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
    req.on('error', () => finish({ ok: false, error: 'connection-failed' }));
    req.write(body);
    req.end();
  });
});

// ── AI-Setup (Erstinstallation beim Endnutzer) ──────────────────────────
// Läuft NUR auf expliziten Nutzer-Klick (nicht automatisch beim Start --
// ~2,5 GB Download soll niemanden überraschen). Runtime-Zip wird per
// PowerShell Expand-Archive entpackt (gleiches Muster wie der bestehende
// C#-Cursor-Clip-Helper oben: kein zusätzliches npm-Package für Zip-Handling
// nötig, das Spiel ist ohnehin Windows-only, siehe package.json "win"-Target).
function aiSetupSend(payload) { send('ai:setup-progress', payload); }

function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirectsLeft) => {
      https.get(requestUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) { reject(new Error('too-many-redirects')); return; }
          res.resume();
          doRequest(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error('http-' + res.statusCode)); return; }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const tmpPath = destPath + '.tmp-' + process.pid;
        const fileStream = fs.createWriteStream(tmpPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            fs.renameSync(tmpPath, destPath);
            resolve();
          });
        });
        fileStream.on('error', (err) => { try { fs.unlinkSync(tmpPath); } catch {} reject(err); });
        res.on('error', (err) => { try { fs.unlinkSync(tmpPath); } catch {} reject(err); });
      }).on('error', reject);
    };
    doRequest(url, 5);
  });
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function extractZipWithPowerShell(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const script = 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + destDir + '" -Force';
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script], { windowsHide: true });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('expand-archive-exit-' + code))));
  });
}

let aiSetupInProgress = false;
let aiSetupStage = null; // Abschnitt 20: 'runtime'|'model'|'verify'|'starting'|'ready' -- fließt in deriveAiState()
ipcMain.handle('ai-setup-download', async () => {
  if (aiSetupInProgress) return { ok: false, error: 'already-running' };
  aiSetupInProgress = true;
  aiLastError = null;
  try {
    const runtimeDir = aiUserRuntimeDir();
    const modelDir = aiUserModelDir();
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });

    // Speicherplatz vorab prüfen (Abschnitt 47) -- Modell + Zip + Reserve.
    const needed = AI_MODEL_SIZE_BYTES + 50 * 1024 * 1024;
    try {
      const check = fs.statfsSync ? fs.statfsSync(app.getPath('userData')) : null;
      if (check && check.bavail * check.bsize < needed) {
        aiSetupInProgress = false; aiSetupStage = null; aiLastError = 'not-enough-disk-space';
        return { ok: false, error: 'not-enough-disk-space' };
      }
    } catch {} // statfsSync nicht auf jeder Node-Version verfügbar -- dann ohne Vorabprüfung fortfahren

    if (!resolveAiServerExe()) {
      aiSetupStage = 'runtime';
      aiSetupSend({ stage: 'runtime', receivedBytes: 0, totalBytes: 0 });
      const zipPath = path.join(runtimeDir, 'llama-cpu.zip');
      await downloadFileWithProgress(AI_RUNTIME_VARIANTS.cpu.zipUrl, zipPath, (received, total) => {
        aiSetupSend({ stage: 'runtime', receivedBytes: received, totalBytes: total });
      });
      await extractZipWithPowerShell(zipPath, runtimeDir);
      try { fs.unlinkSync(zipPath); } catch {}
      if (!resolveAiServerExe()) { aiSetupInProgress = false; aiSetupStage = null; aiLastError = 'runtime-extract-failed'; return { ok: false, error: 'runtime-extract-failed' }; }
    }

    if (!resolveAiModelFile()) {
      aiSetupStage = 'model';
      aiSetupSend({ stage: 'model', receivedBytes: 0, totalBytes: AI_MODEL_SIZE_BYTES });
      const modelPath = path.join(modelDir, AI_MODEL_FILENAME);
      await downloadFileWithProgress(AI_MODEL_DOWNLOAD_URL, modelPath, (received, total) => {
        aiSetupSend({ stage: 'model', receivedBytes: received, totalBytes: total || AI_MODEL_SIZE_BYTES });
      });
      aiSetupStage = 'verify';
      aiSetupSend({ stage: 'verify', receivedBytes: 0, totalBytes: 0 });
      const actualHash = await sha256OfFile(modelPath);
      if (actualHash !== AI_MODEL_SHA256) {
        try { fs.unlinkSync(modelPath); } catch {}
        aiSetupInProgress = false; aiSetupStage = null; aiLastError = 'hash-mismatch';
        return { ok: false, error: 'hash-mismatch' };
      }
    }

    // Runde V5 (Abschnitt 4/10/33/34/35/78): Hardware wird bei JEDEM Aufruf
    // dieses NUTZERAUSGELÖSTEN Handlers (Ersteinrichtung ODER "Erneut
    // prüfen"-Klick -- NIE automatisch bei jedem Spielstart) neu und günstig
    // erkannt (CPU-Kerne + dxdiag, ~1-2s) und mit der zuletzt gecachten
    // Signatur verglichen. Nur bei einer ECHTEN Abweichung (neue/andere GPU,
    // anderer PC) oder fehlendem Profil folgt der teurere Schritt (GPU-
    // Runtime-Download + Kalibrierungs-Testläufe) -- ein unveränderter PC
    // durchläuft die teure Kalibrierung kein zweites Mal.
    {
      const existingProfile = loadCachedHardwareProfile();
      aiSetupStage = 'hardware-detect';
      aiSetupSend({ stage: 'hardware-detect', receivedBytes: 0, totalBytes: 0 });
      const cpuCores = await detectCpuPhysicalCores();
      const gpu = await detectGpuHardware();
      const currentCpuModel = (os.cpus()[0] || {}).model || 'unknown';
      const currentSignature = hardwareSignature(currentCpuModel, gpu);
      if (existingProfile && existingProfile.signature === currentSignature) {
        aiSetupStage = null; // Hardware unverändert -- Profil bleibt gültig, keine erneute Kalibrierung nötig
      } else {
      const gpuCandidate = !!(gpu && gpu.vramMB >= 4096); // Modell (~2,5 GB) + Kontext + Sicherheitsmarge

      if (gpuCandidate && !resolveAiServerExeForVariant('vulkan')) {
        try {
          aiSetupStage = 'gpu-runtime';
          aiSetupSend({ stage: 'gpu-runtime', receivedBytes: 0, totalBytes: 0 });
          const vRuntimeDir = aiUserRuntimeDir('vulkan');
          fs.mkdirSync(vRuntimeDir, { recursive: true });
          const vZipPath = path.join(vRuntimeDir, 'llama-vulkan.zip');
          await downloadFileWithProgress(AI_RUNTIME_VARIANTS.vulkan.zipUrl, vZipPath, (received, total) => {
            aiSetupSend({ stage: 'gpu-runtime', receivedBytes: received, totalBytes: total });
          });
          const actualZipHash = await sha256OfFile(vZipPath);
          if (actualZipHash !== AI_RUNTIME_VARIANTS.vulkan.zipSha256) {
            try { fs.unlinkSync(vZipPath); } catch {} // beschädigt -- kein harter Fehler, CPU bleibt Fallback
          } else {
            await extractZipWithPowerShell(vZipPath, vRuntimeDir);
            try { fs.unlinkSync(vZipPath); } catch {}
          }
        } catch { /* GPU-Runtime-Download fehlgeschlagen -- CPU bleibt Fallback, kein harter Fehler (Abschnitt 12) */ }
      }

      aiSetupStage = 'calibrating';
      aiSetupSend({ stage: 'calibrating', receivedBytes: 0, totalBytes: 0 });
      const calibModelPath = resolveAiModelFile();
      const logicalCores = Math.max(1, os.cpus().length);
      // Abschnitt 26/27: aus physischen Kernen abgeleitet (siehe
      // computeRecommendedThreads()), nicht blind die logische Kernzahl --
      // die Kalibrierung misst damit direkt die Threadzahl, die später auch
      // wirklich im Spiel verwendet wird.
      const threadCount = computeRecommendedThreads(cpuCores, logicalCores);
      const candidates = { cpu: resolveAiServerExeForVariant('cpu'), vulkan: resolveAiServerExeForVariant('vulkan') };
      const calibResults = await runLocalAiCalibration(candidates, calibModelPath, threadCount);
      const decision = decideBackendFromCalibration(calibResults);
      const cpuModel = (os.cpus()[0] || {}).model || 'unknown';
      saveHardwareProfile({
        profileVersion: AI_HARDWARE_PROFILE_VERSION,
        cpu: { model: cpuModel, physicalCores: cpuCores, logicalCores },
        ramTotalGB: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
        gpu,
        recommendedBackend: decision.backend,
        recommendedGpuLayers: decision.backend === 'vulkan' ? 999 : 0,
        recommendedThreads: threadCount,
        estimatedTier: classifyPerformanceTier(decision.genTokPerSec),
        calibration: { cpuGenTokPerSec: calibResults.cpu ? calibResults.cpu.genTokPerSec : null, gpuGenTokPerSec: calibResults.vulkan ? calibResults.vulkan.genTokPerSec : null },
        signature: hardwareSignature(cpuModel, gpu),
        calibratedAt: new Date().toISOString(),
      });
      }
    }

    aiSetupStage = 'starting';
    aiSetupSend({ stage: 'starting', receivedBytes: 0, totalBytes: 0 });
    const result = await ensureAiServerRunning();
    aiSetupInProgress = false; aiSetupStage = null;
    if (!result.ok) { aiLastError = 'server-start-failed'; return { ok: false, error: 'server-start-failed', reason: result.reason }; }
    aiSetupSend({ stage: 'ready', receivedBytes: 0, totalBytes: 0 });
    return { ok: true };
  } catch (err) {
    aiSetupInProgress = false; aiSetupStage = null; aiLastError = 'exception';
    return { ok: false, error: 'exception', message: String(err && err.message || err) };
  }
});

// ── Auto-Update (GitHub Releases) ────────────────────────────────────────
// autoDownload ist aus (siehe oben) — der Nutzer bekommt immer erst ein Popup
// und entscheidet "Jetzt aktualisieren" oder "Später". Ob eine Prüfung manuell
// (Button im Hauptmenü) oder automatisch (Start) ausgelöst wurde, wird per
// isManualCheck getrackt: nur bei manueller Prüfung wird "kein Update
// verfügbar" auch aktiv gemeldet — sonst würde das jeden Start nerven.
// isDownloading getrackt separat: ein Download wird IMMER erst durch einen
// expliziten Nutzer-Klick ausgelöst (nie automatisch, autoDownload ist aus),
// ein währenddessen auftretender Fehler muss deshalb IMMER gemeldet werden,
// unabhängig vom (zu diesem Zeitpunkt meist schon wieder falschen)
// isManualCheck-Stand der VORHERIGEN Prüfung -- sonst bleibt das Update-Modal
// bei einem echten Download-Fehler stumm bei "0%" hängen (Bug, live gemeldet).
let isManualCheck = false;
let isDownloading = false;
// Bug-Fix (Audit): weder der Button noch der IPC-Handler verhinderten
// bisher, dass zwei checkForUpdates()-Aufrufe auf derselben autoUpdater-
// Instanz gleichzeitig liefen (z.B. manueller Klick kurz nach der stillen
// Prüfung beim App-Start) -- welches der später eintreffenden Events zu
// welcher Anfrage gehörte, ließ sich am gemeinsamen isManualCheck-Flag nicht
// mehr sicher unterscheiden. isCheckInProgress lässt eine zweite Prüfung
// erst gar nicht starten, solange eine läuft.
let isCheckInProgress = false;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }));
autoUpdater.on('update-not-available', () => { if (isManualCheck) send('update:not-available'); });
autoUpdater.on('error', (err) => {
  if (isManualCheck || isDownloading) send('update:error', String(err));
  isDownloading = false;
});
autoUpdater.on('download-progress', (progress) => send('update:progress', Math.round(progress.percent)));
autoUpdater.on('update-downloaded', () => { isDownloading = false; send('update:downloaded'); });

// Bug-Fix (Audit, Regressions-Fund): autoUpdater.checkForUpdates() kann bei
// einem stillen Netzwerkproblem (DNS-/Proxy-Hänger) theoretisch nie settlen
// -- ohne dieses Sicherheitsnetz (Watchdog, spiegelt den bereits
// bestehenden 20s-Stillstands-Timeout auf der Download-Seite) würde
// isCheckInProgress dann für den Rest der Session hängen bleiben, jede
// weitere Prüfung (auch nach erneutem manuellem Klick) sofort abweisen,
// ohne dass der Nutzer je einen echten Fehler oder Erfolg sieht.
// Bug-Fix (Audit, Regressions-Fund Runde 3): der Watchdog-Timer lag in EINER
// gemeinsamen Variable. Traf eine neue Prüfung ein während eine ältere noch
// (verspätet) offen war, überschrieb beginUpdateCheck() den Timer der alten
// Prüfung. Löste die alte Prüfung danach ihr .finally() aus, rief sie
// endUpdateCheck() auf und löschte damit den Timer der NEUEN Prüfung --
// deren Sicherheitsnetz war weg, und isCheckInProgress wurde fälschlich
// zurückgesetzt, obwohl die neue Prüfung noch lief (eine dritte, überlappende
// Prüfung wäre dann wieder möglich gewesen). Ein Token pro Anfrage (analog zu
// loadStateRequestId im Renderer) lässt nur die zuletzt gestartete Prüfung
// ihren eigenen Watchdog/Abschluss tatsächlich wirksam werden.
let checkInProgressWatchdog = null;
let updateCheckRequestId = 0;
function beginUpdateCheck() {
  const requestId = ++updateCheckRequestId;
  isCheckInProgress = true;
  clearTimeout(checkInProgressWatchdog);
  checkInProgressWatchdog = setTimeout(() => {
    if (requestId === updateCheckRequestId) isCheckInProgress = false;
  }, 20000);
  return requestId;
}
function endUpdateCheck(requestId) {
  if (requestId !== updateCheckRequestId) return;
  clearTimeout(checkInProgressWatchdog);
  isCheckInProgress = false;
}

ipcMain.handle('check-for-updates', () => {
  if (!app.isPackaged) return { skipped: true, reason: 'dev' };
  if (isCheckInProgress) return { skipped: true, reason: 'busy' };
  isManualCheck = true;
  const requestId = beginUpdateCheck();
  autoUpdater.checkForUpdates().finally(() => { isManualCheck = false; endUpdateCheck(requestId); });
  return { skipped: false };
});

// Bug-Fix (Audit): der .catch() setzte bisher nur isDownloading zurück, ohne
// selbst etwas an den Renderer zu senden -- ob der Nutzer informiert wurde,
// hing komplett davon ab, dass electron-updater beim selben Fehler ZUSÄTZLICH
// noch ein separates 'error'-Event auslöst. Ist das bei einem bestimmten
// Fehlerpfad nicht der Fall, sah der Nutzer bis zu 20s lang (bis der
// clientseitige Stillstands-Timeout greift) unnötig "Verbindung wird
// hergestellt…" bei einem eigentlich längst bekannten sofortigen Fehlschlag.
ipcMain.on('download-update', () => {
  isDownloading = true;
  autoUpdater.downloadUpdate().catch((err) => {
    isDownloading = false;
    send('update:error', String(err));
  });
});
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  createWindow();
  // Stille Prüfung beim Start — respektiert die "Automatisch nach Updates
  // suchen"-Einstellung (Standard: an). isCheckInProgress mitgeführt, damit
  // ein manueller Klick kurz nach dem Start (siehe check-for-updates-Handler)
  // nicht mit dieser Prüfung überlappt.
  if (app.isPackaged && loadSettingsSync().autoCheckUpdates) {
    const requestId = beginUpdateCheck();
    autoUpdater.checkForUpdates().finally(() => { endUpdateCheck(requestId); });
  }
  // Lokale KI: nur STARTEN, wenn Runtime+Modell bereits vorhanden sind (nie
  // automatisch herunterladen -- der ~2,5 GB-Download läuft ausschließlich
  // über einen expliziten Klick, siehe ai-setup-download). Läuft im
  // Hintergrund, blockiert das Fensteröffnen nicht.
  if (resolveAiServerExe() && resolveAiModelFile()) {
    ensureAiServerRunning().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
