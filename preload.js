const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getEnv: () => ipcRenderer.invoke('env:get'),
  openWindow: (file) => ipcRenderer.send('open-window', file),
});
