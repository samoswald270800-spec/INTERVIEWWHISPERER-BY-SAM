import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    // Use env var if available, otherwise check NODE_ENV. If dev -> localhost, else -> Prod URL.
    apiUrl: process.env.VITE_API_URL || process.env.RAILWAY_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://interviewwhisperer-by-sam-production.up.railway.app'),
    setOpacity: (value) => ipcRenderer.send('set-opacity', value),
    // Remote control: forward input events to main process for native simulation
    simulateInput: (event) => ipcRenderer.send('rc:simulate-input', event),
    // Ask the OS for input-control permission (macOS Accessibility prompt)
    ensureInputPermission: () => ipcRenderer.send('rc:ensure-input-permission'),
});
