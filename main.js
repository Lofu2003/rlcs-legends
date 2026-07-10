const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

Menu.setApplicationMenu(null);
autoUpdater.autoDownload = false; // Nutzer entscheidet selbst per Popup, ob/wann geladen wird

ipcMain.on('quit-app', () => app.quit());

// Mehrere Speicherstände (Slots) statt einem einzigen Autosave — jeder Slot
// ist eine eigene JSON-Datei in userData.
const SAVE_SLOT_COUNT = 3;
const slotPath = (slotId) => path.join(app.getPath('userData'), 'save-slot-' + slotId + '.json');

ipcMain.handle('save-game', (_event, slotId, data) => {
  fs.writeFileSync(slotPath(slotId), JSON.stringify(data));
});

ipcMain.handle('load-game', (_event, slotId) => {
  try {
    return JSON.parse(fs.readFileSync(slotPath(slotId), 'utf-8'));
  } catch {
    return null;
  }
});

ipcMain.handle('delete-save', (_event, slotId) => {
  try {
    fs.unlinkSync(slotPath(slotId));
  } catch {}
});

// Liefert für jeden Slot eine leichte Zusammenfassung (für die Slot-Auswahl-
// Ansicht) statt der vollen Roster-/Turnier-Daten.
ipcMain.handle('list-save-slots', () => {
  const slots = [];
  for (let i = 1; i <= SAVE_SLOT_COUNT; i++) {
    try {
      const data = JSON.parse(fs.readFileSync(slotPath(i), 'utf-8'));
      slots.push({
        slotId: i,
        exists: true,
        orgName: data.assignedOrg ? data.assignedOrg.name : '?',
        characterName: data.careerCharacter ? data.careerCharacter.name : 'Manager', // ältere Spielstände kannten noch keinen Charakter
        seasonNumber: data.careerState ? data.careerState.seasonNumber : 1,
        titlesWon: data.careerState ? data.careerState.titlesWon : 0,
        gameMode: data.gameMode || 'career', // ältere Spielstände kannten nur Karriere
      });
    } catch {
      slots.push({ slotId: i, exists: false });
    }
  }
  return slots;
});

// ── Einstellungen (globale App-Präferenzen, getrennt von den Speicherständen —
// gelten karrieren-/slot-übergreifend, z.B. bevor überhaupt eine Karriere
// existiert) ──────────────────────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = { autoCheckUpdates: true, defaultMatchSpeed: 1, quickSimPace: 'normal' };

function loadSettingsSync() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

ipcMain.handle('get-settings', () => loadSettingsSync());
ipcMain.handle('save-settings', (_event, settings) => {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  fs.writeFileSync(settingsPath, JSON.stringify(merged));
  return merged;
});

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
  mainWindow = win;

  // Renderer-Konsole (inkl. JS-Fehler) auch im Terminal sichtbar machen —
  // sonst landen sie nur in den (unsichtbaren) DevTools.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log('[renderer:' + tag + ']', message, sourceId ? '(' + sourceId + ':' + line + ')' : '');
  });
}

// ── Auto-Update (GitHub Releases) ────────────────────────────────────────
// autoDownload ist aus (siehe oben) — der Nutzer bekommt immer erst ein Popup
// und entscheidet "Jetzt aktualisieren" oder "Später". Ob eine Prüfung manuell
// (Button im Hauptmenü) oder automatisch (Start) ausgelöst wurde, wird per
// isManualCheck getrackt: nur bei manueller Prüfung wird "kein Update
// verfügbar" auch aktiv gemeldet — sonst würde das jeden Start nerven.
let isManualCheck = false;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }));
autoUpdater.on('update-not-available', () => { if (isManualCheck) send('update:not-available'); });
autoUpdater.on('error', (err) => { if (isManualCheck) send('update:error', String(err)); });
autoUpdater.on('download-progress', (progress) => send('update:progress', Math.round(progress.percent)));
autoUpdater.on('update-downloaded', () => send('update:downloaded'));

ipcMain.handle('check-for-updates', () => {
  if (!app.isPackaged) return { skipped: true };
  isManualCheck = true;
  autoUpdater.checkForUpdates().finally(() => { isManualCheck = false; });
  return { skipped: false };
});

ipcMain.on('download-update', () => autoUpdater.downloadUpdate());
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  createWindow();
  // Stille Prüfung beim Start — respektiert die "Automatisch nach Updates
  // suchen"-Einstellung (Standard: an).
  if (app.isPackaged && loadSettingsSync().autoCheckUpdates) autoUpdater.checkForUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
