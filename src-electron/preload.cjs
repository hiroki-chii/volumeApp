const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVolume: () => ipcRenderer.invoke('get-volume'),
  setVolume: (volume) => ipcRenderer.invoke('set-volume', volume),
  getMute: () => ipcRenderer.invoke('get-mute'),
  setMute: (mute) => ipcRenderer.invoke('set-mute', mute),
  onVolumeUpdated: (callback) => ipcRenderer.on('volume-updated', (event, value) => callback(value)),
  onMuteUpdated: (callback) => ipcRenderer.on('mute-updated', (event, value) => callback(value)),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  resizeWindow: (w, h) => ipcRenderer.send('resize-window', w, h),
});
