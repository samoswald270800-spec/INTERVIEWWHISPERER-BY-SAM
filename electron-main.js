import { app, BrowserWindow, globalShortcut, Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Handle __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let tray = null;
let isStealth = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'electron-preload.js'),
        },
        // Advanced stealth configuration
        alwaysOnTop: true,           // Stays on top of other windows
        skipTaskbar: true,            // Hides from taskbar
        frame: true,                  // Keep frame for user visibility
        transparent: false,           // Keep opaque for user
        // icon: path.join(__dirname, 'public/favicon.ico'),
    });

    // STEALTH MODE: Prevents window from appearing in screen captures
    mainWindow.setContentProtection(true);
    mainWindow.setAlwaysOnTop(true);

    const isDev = !app.isPackaged;

    // Use Railway URL if configured, otherwise localhost for dev
    const RAILWAY_URL = process.env.RAILWAY_URL || 'http://localhost:3000';

    if (isDev) {
        mainWindow.loadURL(`${RAILWAY_URL}/login.html`);
    } else {
        // Check for login.html in build output
        const loginDistPath = path.join(__dirname, 'public/build/login.html');
        if (fs.existsSync(loginDistPath)) {
            mainWindow.loadFile(loginDistPath);
        } else {
            // Fallback to index.html
            mainWindow.loadFile(path.join(__dirname, 'public/build/index.html'));
        }
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function toggleStealth() {
    if (!mainWindow) return;

    if (isStealth) {
        mainWindow.show();
        mainWindow.setOpacity(1);
        isStealth = false;
        console.log('Stealth Mode: OFF');
    } else {
        mainWindow.hide();
        isStealth = true;
        console.log('Stealth Mode: ON');
    }
}

app.whenReady().then(() => {
    createWindow();

    try {
        const ret = globalShortcut.register('CommandOrControl+Shift+H', toggleStealth);
        if (!ret) console.log('Shortcut registration failed');
    } catch (e) { console.error(e); }

    try {
        const iconPath = path.join(__dirname, 'public/favicon.ico');
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
