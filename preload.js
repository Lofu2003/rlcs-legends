const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quitApp: () => ipcRenderer.send('quit-app'),
  saveGame: (slotId, data) => ipcRenderer.invoke('save-game', slotId, data),
  loadGame: (slotId) => ipcRenderer.invoke('load-game', slotId),
  deleteSave: (slotId) => ipcRenderer.invoke('delete-save', slotId),
  listSaveSlots: () => ipcRenderer.invoke('list-save-slots'),

  selectPortraitImage: () => ipcRenderer.invoke('select-portrait-image'),
  listPortraitPresets: () => ipcRenderer.invoke('list-portrait-presets'),

  selectTeamLogoImage: () => ipcRenderer.invoke('select-team-logo-image'),
  listTeamLogoPresets: () => ipcRenderer.invoke('list-team-logo-presets'),

  listManagerTemplates: () => ipcRenderer.invoke('list-manager-templates'),
  saveManagerTemplate: (character) => ipcRenderer.invoke('save-manager-template', character),
  deleteManagerTemplate: (id) => ipcRenderer.invoke('delete-manager-template', id),

  isFeedbackReady: () => ipcRenderer.invoke('is-feedback-ready'),
  sendFeedback: (feedback) => ipcRenderer.invoke('send-feedback', feedback),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  applyDisplaySettings: () => ipcRenderer.invoke('apply-display-settings'),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update:not-available', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, msg) => cb(msg)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, pct) => cb(pct)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', () => cb()),
});
