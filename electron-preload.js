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
    // "Type it in": type code into the focused editor with a human-like cadence.
    // Resolves { ok, cancelled } when typing finishes or is cancelled.
    typeCode: (text) => ipcRenderer.invoke('rc:type-human', { text }),
    cancelTypeCode: () => ipcRenderer.send('rc:type-human-cancel'),
    // Native clipboard write — focus-independent, unlike navigator.clipboard,
    // which the content-protected overlay can't use. Resolves true on success.
    copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
    relayAudio: {
        getStatus: () => ipcRenderer.invoke('relay-audio:get-status'),
    },
    virtualCamera: {
        getStatus: () => ipcRenderer.invoke('virtual-camera:get-status'),
        install: () => ipcRenderer.invoke('virtual-camera:install'),
        remove: () => ipcRenderer.invoke('virtual-camera:remove'),
        start: (options) => ipcRenderer.invoke('virtual-camera:start', options),
        stop: () => ipcRenderer.invoke('virtual-camera:stop'),
        sendFrame: (frame) => ipcRenderer.send('virtual-camera:frame', frame),
        onFrameReady: (callback) => {
            const listener = () => callback();
            ipcRenderer.on('virtual-camera:frame-ready', listener);
            return () => ipcRenderer.removeListener('virtual-camera:frame-ready', listener);
        },
    },
});
