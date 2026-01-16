const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    // Use env var if available (packaged), otherwise fallback to localhost for dev
    apiUrl: process.env.VITE_API_URL || 'http://localhost:3000',
    setOpacity: (value) => ipcRenderer.send('set-opacity', value),
});
