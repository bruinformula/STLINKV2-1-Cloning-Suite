const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clonerApi', {
  getDefaultConfig: () => ipcRenderer.invoke('config:defaults'),
  checkEnvironment: (config) => ipcRenderer.invoke('env:check', config),
  runFlow: (config) => ipcRenderer.invoke('flow:run', config),
  runOptionBytesOnly: (config) => ipcRenderer.invoke('flow:runOptionBytesOnly', config),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  selectPath: (options) => ipcRenderer.invoke('shell:selectPath', options),
  onFlowEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('flow:event', wrapped);
    return () => ipcRenderer.removeListener('flow:event', wrapped);
  },
});