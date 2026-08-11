const { app, BrowserWindow, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
