const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  onSessions: (cb) => ipcRenderer.on('sessions', (_e, data) => cb(data)),
  onStats: (cb) => ipcRenderer.on('stats', (_e, data) => cb(data)),
  setNotify: (on) => ipcRenderer.send('notify-enabled', !!on),
});
