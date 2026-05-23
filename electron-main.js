import { app, BrowserWindow, globalShortcut, Tray, Menu, desktopCapturer, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load environment variables only in development
if (!app.isPackaged) {
    try {
        const dotenv = await import('dotenv');
        dotenv.config();
    } catch (e) {
        // dotenv not available in production - that's fine
    }
}

// FIX: Disable HTTP cache to prevent "Access Denied" errors and blank pages
app.commandLine.appendSwitch('disable-http-cache');

// Handle __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SINGLE INSTANCE LOCK: Prevent multiple app windows from opening
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    // Another instance is already running — quit this one immediately
    app.quit();
}

let mainWindow;
let tray = null;
let isStealth = false;
let currentOpacity = 1.0;

// When a second instance is attempted, focus the existing window instead
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    }
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'electron-preload.js'),
            devTools: true, // Always enable DevTools for debugging
            webSecurity: true, // Enable web security in production
            sandbox: false // Sandbox off to ensure preload works for remote content
        },
        // Advanced stealth configuration
        alwaysOnTop: true,           // Stays on top of other windows
        skipTaskbar: true,            // Hides from taskbar
        frame: true,                  // Keep frame for user visibility
        transparent: false,           // Keep opaque for user
    });

    // STEALTH MODE: Prevents window from appearing in screen captures
    mainWindow.setContentProtection(true);
    mainWindow.setAlwaysOnTop(true);

    const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000/login.html');
    } else {
        // PROD: Load the live web app so updates are instant
        // Fallback to local file if offline (optional, but good practice)
        const PROD_URL = 'https://interviewwhisperer-by-sam-production.up.railway.app/login.html';

        mainWindow.loadURL(PROD_URL).catch(e => {
            console.log('Failed to load remote URL, falling back to local:', e);
            const loginDistPath = path.join(__dirname, 'public/build/login.html');
            if (fs.existsSync(loginDistPath)) {
                mainWindow.loadFile(loginDistPath);
            } else {
                mainWindow.loadFile(path.join(__dirname, 'public/build/index.html'));
            }
        });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function toggleStealth() {
    if (!mainWindow) return;

    if (isStealth) {
        mainWindow.show();
        // Restore user's preferred opacity
        mainWindow.setOpacity(currentOpacity);
        isStealth = false;
        console.log('Stealth Mode: OFF');
    } else {
        mainWindow.hide();
        isStealth = true;
        console.log('Stealth Mode: ON');
    }
}

app.whenReady().then(() => {
    // Handling media permissions (Video/Audio)
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'display-capture', 'mediaKeySystem', 'videoCapture', 'audioCapture'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            console.warn(`Permission denied: ${permission}`);
            callback(false);
        }
    });

    // Handling Screen Capture Requests (getDisplayMedia)
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            if (sources.length > 0) {
                // Auto-select the first screen (Primary Display)
                // NOTE: 'loopback' audio is Windows-only — omit on macOS to avoid crash
                const audioOption = process.platform === 'win32' ? 'loopback' : false;
                callback({ video: sources[0], audio: audioOption });
            } else {
                console.error('No screen sources found');
                callback(null);
            }
        }).catch((err) => {
            console.error('Error selecting media source:', err);
            callback(null);
        });
    });

    // CRITICAL FIX: Patch cookies to allow cross-site (file:// -> https://) persistence
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (details.responseHeaders && details.responseHeaders['set-cookie']) {
            details.responseHeaders['set-cookie'] = details.responseHeaders['set-cookie'].map(cookie => {
                let newCookie = cookie;
                // Force SameSite=None and Secure for cross-origin cookies in Electron
                if (!newCookie.includes('SameSite=None')) newCookie += '; SameSite=None';
                if (!newCookie.includes('Secure')) newCookie += '; Secure';
                return newCookie;
            });
        }
        callback({ responseHeaders: details.responseHeaders });
    });

    createWindow();

    try {
        const ret = globalShortcut.register('CommandOrControl+Shift+H', toggleStealth);
        if (!ret) {
            console.error('Shortcut Ctrl+Shift+H registration FAILED — another app may have claimed it.');
            // Fallback: try an alternative shortcut
            const fallback = globalShortcut.register('CommandOrControl+Shift+J', toggleStealth);
            if (fallback) {
                console.log('Fallback shortcut Ctrl+Shift+J registered successfully.');
            } else {
                console.error('Fallback shortcut Ctrl+Shift+J also failed.');
            }
        } else {
            console.log('Shortcut Ctrl+Shift+H registered successfully.');
        }
    } catch (e) { console.error('Shortcut registration error:', e); }

    try {
        const iconPath = path.join(__dirname, 'public/favicon.png');
        if (fs.existsSync(iconPath)) {
            tray = new Tray(iconPath);
            const contextMenu = Menu.buildFromTemplate([
                { label: 'Show/Hide', click: toggleStealth },
                { label: 'Quit', click: () => app.quit() },
            ]);
            tray.setToolTip('Interview Whisperer');
            tray.setContextMenu(contextMenu);
            tray.on('click', toggleStealth);
        }
    } catch (error) {
        console.log('Tray icon error:', error.message);
    }

    // IPC listener for Opacity
    ipcMain.on('set-opacity', (event, value) => {
        if (mainWindow) {
            currentOpacity = Math.max(0.2, Math.min(1, value)); // Store it
            mainWindow.setOpacity(currentOpacity);
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
