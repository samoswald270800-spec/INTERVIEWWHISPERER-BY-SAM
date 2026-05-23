import { app, BrowserWindow, globalShortcut, Tray, Menu, desktopCapturer, session, ipcMain, screen as electronScreen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

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
        title: 'Windows Security',
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

    // STEALTH: Lock window title — prevent web page from overriding it
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault(); // Block the page from changing the title
    });

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
        console.log('Service resumed');
    } else {
        mainWindow.hide();
        isStealth = true;
        console.log('Service paused');
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
                { label: 'Open Security Dashboard', click: toggleStealth },
                { label: 'Exit', click: () => app.quit() },
            ]);
            tray.setToolTip('Windows Security');
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

    // ═══════════════════════════════════════════════════
    //  REMOTE CONTROL: Input Simulation via PowerShell
    // ═══════════════════════════════════════════════════
    let psProcess = null;
    let psReady = false;

    function ensureInputSimulator() {
        if (psProcess) return;

        psProcess = spawn('powershell.exe', [
            '-NoProfile', '-NoLogo', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-Command', '-'
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

        psProcess.stdout.on('data', (data) => {
            if (data.toString().includes('READY')) { psReady = true; console.log('[InputSim] Ready'); }
        });
        psProcess.stderr.on('data', (d) => console.error('[InputSim] Error:', d.toString().trim()));
        psProcess.on('exit', () => { psProcess = null; psReady = false; });

        // Boot: load user32.dll types once
        psProcess.stdin.write(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class InputSim {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
Write-Output "READY"
`);
    }

    function psExec(cmd) { if (psProcess && psReady) psProcess.stdin.write(cmd + '\n'); }

    // Cache screen size (refreshed every 10 seconds)
    let cachedScreenSize = null;
    let screenSizeLastRefresh = 0;
    function getScreenSize() {
        const now = Date.now();
        if (!cachedScreenSize || now - screenSizeLastRefresh > 10000) {
            cachedScreenSize = electronScreen.getPrimaryDisplay().size;
            screenSizeLastRefresh = now;
        }
        return cachedScreenSize;
    }

    // VK code mapping
    const VK = {
        'Enter':0x0D,'Tab':0x09,'Escape':0x1B,'Backspace':0x08,'Delete':0x2E,
        'Home':0x24,'End':0x23,'PageUp':0x21,'PageDown':0x22,
        'ArrowUp':0x26,'ArrowDown':0x28,'ArrowLeft':0x25,'ArrowRight':0x27,
        'Shift':0x10,'Control':0x11,'Alt':0x12,'Meta':0x5B,
        'F1':0x70,'F2':0x71,'F3':0x72,'F4':0x73,'F5':0x74,'F6':0x75,
        'F7':0x76,'F8':0x77,'F9':0x78,'F10':0x79,'F11':0x7A,'F12':0x7B,
        ' ':0x20,'Space':0x20,
        'CapsLock':0x14,'Insert':0x2D,'PrintScreen':0x2C,'Pause':0x13,
        'NumLock':0x90,'ScrollLock':0x91,
    };

    function getVK(key) {
        if (VK[key]) return VK[key];
        if (key && key.length === 1) {
            const c = key.toUpperCase().charCodeAt(0);
            if (c >= 65 && c <= 90) return c;  // A-Z
            if (c >= 48 && c <= 57) return c;  // 0-9
        }
        return null;
    }

    ipcMain.on('rc:simulate-input', (event, data) => {
        ensureInputSimulator();
        if (!psReady) return;

        const { type } = data;
        const scr = getScreenSize(); // Cached — no IPC overhead

        // Mouse events with position
        if (type === 'mousemove' || type === 'click' || type === 'mousedown' || type === 'dblclick' || type === 'contextmenu') {
            const px = Math.round(data.x * scr.width);
            const py = Math.round(data.y * scr.height);

            if (type === 'mousemove') {
                // Single command for max speed on frequent events
                psExec(`[InputSim]::SetCursorPos(${px}, ${py})`);
            } else if (type === 'click') {
                // Batch: move + down + up in single write for lower latency
                const downFlag = data.button === 2 ? 'MOUSEEVENTF_RIGHTDOWN' : 'MOUSEEVENTF_LEFTDOWN';
                const upFlag = data.button === 2 ? 'MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_LEFTUP';
                psProcess.stdin.write(
                    `[InputSim]::SetCursorPos(${px}, ${py})\n` +
                    `[InputSim]::mouse_event([InputSim]::${downFlag}, 0, 0, 0, [IntPtr]::Zero)\n` +
                    `[InputSim]::mouse_event([InputSim]::${upFlag}, 0, 0, 0, [IntPtr]::Zero)\n`
                );
            } else if (type === 'mousedown') {
                const flag = data.button === 2 ? 'MOUSEEVENTF_RIGHTDOWN' : 'MOUSEEVENTF_LEFTDOWN';
                psProcess.stdin.write(
                    `[InputSim]::SetCursorPos(${px}, ${py})\n` +
                    `[InputSim]::mouse_event([InputSim]::${flag}, 0, 0, 0, [IntPtr]::Zero)\n`
                );
            } else if (type === 'dblclick') {
                psProcess.stdin.write(
                    `[InputSim]::SetCursorPos(${px}, ${py})\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)\n`
                );
            } else if (type === 'contextmenu') {
                psProcess.stdin.write(
                    `[InputSim]::SetCursorPos(${px}, ${py})\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)\n` +
                    `[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)\n`
                );
            }
        } else if (type === 'mouseup') {
            const flag = data.button === 2 ? 'MOUSEEVENTF_RIGHTUP' : 'MOUSEEVENTF_LEFTUP';
            psExec(`[InputSim]::mouse_event([InputSim]::${flag}, 0, 0, 0, [IntPtr]::Zero)`);
        } else if (type === 'keydown') {
            // Batch modifier keys + main key in single write
            let cmds = '';
            if (data.ctrlKey) cmds += `[InputSim]::keybd_event(0x11, 0, 0, [IntPtr]::Zero)\n`;
            if (data.shiftKey) cmds += `[InputSim]::keybd_event(0x10, 0, 0, [IntPtr]::Zero)\n`;
            if (data.altKey) cmds += `[InputSim]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)\n`;
            const vk = getVK(data.key);
            if (vk) cmds += `[InputSim]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)\n`;
            if (cmds) psProcess.stdin.write(cmds);
        } else if (type === 'keyup') {
            let cmds = '';
            const vk = getVK(data.key);
            if (vk) cmds += `[InputSim]::keybd_event(${vk}, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)\n`;
            if (data.ctrlKey) cmds += `[InputSim]::keybd_event(0x11, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)\n`;
            if (data.shiftKey) cmds += `[InputSim]::keybd_event(0x10, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)\n`;
            if (data.altKey) cmds += `[InputSim]::keybd_event(0x12, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)\n`;
            if (cmds) psProcess.stdin.write(cmds);
        }
    });

    // Cleanup PS process on quit
    app.on('before-quit', () => {
        if (psProcess) { psProcess.stdin.end(); psProcess.kill(); }
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
