const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    railwayUrl: 'https://interviewwhisperer-by-sam-production.up.railway.app',
    setOpacity: (value) => ipcRenderer.send('set-opacity', value),
});
