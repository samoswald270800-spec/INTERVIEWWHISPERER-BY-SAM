import { app, BrowserWindow, globalShortcut, Tray, Menu, desktopCapturer, session, ipcMain, screen as electronScreen, systemPreferences } from 'electron';
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

// macOS system-audio (loopback) capture is handled natively by Electron 39+
// (Apple CoreAudio Tap, the default). It only needs audio:'loopback' in the
// display-media handler + the NSAudioCaptureUsageDescription Info.plist key
// (set in package.json) + macOS 13+. Do NOT force the older ScreenCaptureKit
// feature flags here — on Electron 39 they conflict and break capture.

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
let virtualCameraBridgeProcess = null;
let virtualCameraBackpressured = false;
let virtualCameraSequence = 0n;

function nativeResourcePath(...parts) {
    const root = app.isPackaged ? process.resourcesPath : __dirname;
    return path.join(root, 'native', ...parts);
}

function fourCC(value) {
    if (typeof value !== 'string' || value.length !== 4) return 0;
    return value.charCodeAt(0)
        | (value.charCodeAt(1) << 8)
        | (value.charCodeAt(2) << 16)
        | (value.charCodeAt(3) << 24);
}

function virtualCameraStatus() {
    const bridgePath = nativeResourcePath('windows-virtual-camera', 'WhisperVirtualCameraBridge.exe');
    const installedMarker = nativeResourcePath('windows-virtual-camera', 'virtual-camera-installed.json');
    const bridgeReady = process.platform === 'win32' && fs.existsSync(bridgePath);
    const driverInstalled = bridgeReady && fs.existsSync(installedMarker);

    return {
        platform: process.platform,
        supported: process.platform === 'win32',
        deviceName: 'Whisper Virtual Camera',
        bridgePath,
        bridgeReady,
        driverInstalled,
        message: driverInstalled
            ? 'Whisper Virtual Camera is ready for Zoom and Teams.'
            : 'The browser relay is ready; the signed Windows Media Foundation camera component still needs to be built and installed.',
    };
}

function stopVirtualCameraBridge() {
    if (!virtualCameraBridgeProcess) return;
    try { virtualCameraBridgeProcess.stdin.end(); } catch { /* process already closed */ }
    try { virtualCameraBridgeProcess.kill(); } catch { /* process already closed */ }
    virtualCameraBridgeProcess = null;
    virtualCameraBackpressured = false;
}

function encodeVirtualCameraFrame(frame) {
    const formatCodes = {
        I420: fourCC('I420'),
        NV12: fourCC('NV12'),
        RGBA: fourCC('RGBA'),
        RGBX: fourCC('RGBX'),
        BGRA: fourCC('BGRA'),
        BGRX: fourCC('BGRX'),
    };
    const format = formatCodes[frame?.format];
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    const source = frame?.data;
    if (!format || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || !source) return null;

    const data = Buffer.from(source.buffer, source.byteOffset || 0, source.byteLength);
    if (!data.length || data.length > 16 * 1024 * 1024) return null;

    const layout = Array.isArray(frame.layout) ? frame.layout.slice(0, 4) : [];
    const header = Buffer.alloc(76);
    header.writeUInt32LE(fourCC('WVC1') >>> 0, 0);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(header.length, 6);
    header.writeUInt32LE(format >>> 0, 8);
    header.writeUInt32LE(width, 12);
    header.writeUInt32LE(height, 16);
    header.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(Number(frame.timestamp) || 0))), 20);
    header.writeBigUInt64LE(++virtualCameraSequence, 28);
    header.writeUInt32LE(data.length, 36);
    header.writeUInt32LE(layout.length, 40);
    layout.forEach((plane, index) => {
        const offset = 44 + (index * 8);
        header.writeUInt32LE(Math.max(0, Number(plane.offset) || 0), offset);
        header.writeUInt32LE(Math.max(0, Number(plane.stride) || 0), offset + 4);
    });
    return { header, data };
}

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
                // Auto-select the first screen (Primary Display).
                // Provide system-audio loopback ONLY when the page asked for audio
                // (the interview feature). The remote-control screen-share requests
                // audio:false, so it stays video-only. Loopback is supported on
                // Windows and, via ScreenCaptureKit, macOS 13+.
                const wantsAudio = request.audioRequested === true;
                const canLoopback = process.platform === 'win32' || process.platform === 'darwin';
                const audioOption = (wantsAudio && canLoopback) ? 'loopback' : false;
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

    const relayBridgePath = nativeResourcePath('windows-audio-bridge', 'WhisperAudioBridge.exe');
    ipcMain.handle('relay-audio:get-status', () => ({
        platform: process.platform,
        supported: process.platform === 'win32',
        deviceName: 'Whisper Virtual Microphone',
        sampleRate: 48000,
        channels: 2,
        bridgePath: relayBridgePath,
        bridgeReady: process.platform === 'win32' && fs.existsSync(relayBridgePath),
        driverInstalled: false,
        message: 'Windows audio relay scaffold is present; signed virtual microphone driver is not bundled yet.',
    }));

    ipcMain.handle('virtual-camera:get-status', () => virtualCameraStatus());
    ipcMain.handle('virtual-camera:start', (_event, options = {}) => {
        const status = virtualCameraStatus();
        if (!status.bridgeReady || !status.driverInstalled) return { ok: false, message: status.message };
        if (virtualCameraBridgeProcess) return { ok: true, alreadyRunning: true };

        const width = Math.max(320, Math.min(1920, Number(options.width) || 1280));
        const height = Math.max(180, Math.min(1080, Number(options.height) || 720));
        const fps = Math.max(15, Math.min(60, Number(options.fps) || 30));
        virtualCameraBridgeProcess = spawn(status.bridgePath, [
            '--width', String(width), '--height', String(height), '--fps', String(fps),
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        virtualCameraBridgeProcess.stderr.on('data', (chunk) => console.error('[VirtualCamera]', chunk.toString().trim()));
        virtualCameraBridgeProcess.on('error', (error) => {
            console.error('[VirtualCamera] Bridge failed to start:', error.message);
            virtualCameraBridgeProcess = null;
            virtualCameraBackpressured = false;
        });
        virtualCameraBridgeProcess.on('exit', () => {
            virtualCameraBridgeProcess = null;
            virtualCameraBackpressured = false;
        });
        virtualCameraBridgeProcess.stdin.on('error', (error) => {
            if (error.code !== 'EPIPE') console.error('[VirtualCamera] Frame pipe error:', error.message);
        });
        virtualCameraBridgeProcess.stdin.on('drain', () => { virtualCameraBackpressured = false; });
        return { ok: true, width, height, fps };
    });
    ipcMain.handle('virtual-camera:stop', () => {
        stopVirtualCameraBridge();
        return { ok: true };
    });
    ipcMain.on('virtual-camera:frame', (_event, frame) => {
        const input = virtualCameraBridgeProcess?.stdin;
        if (!input?.writable || virtualCameraBackpressured) return;
        const packet = encodeVirtualCameraFrame(frame);
        if (!packet) return;

        input.cork();
        const headerReady = input.write(packet.header);
        const frameReady = input.write(packet.data);
        input.uncork();
        virtualCameraBackpressured = !headerReady || !frameReady;
    });

    // ═══════════════════════════════════════════════════
    //  REMOTE CONTROL: Input Simulation via PowerShell
    //  Uses persistent PS process with user32.dll P/Invoke
    //  for native mouse/keyboard control.
    // ═══════════════════════════════════════════════════
    let psProcess = null;
    let psReady = false;
    const pendingCmds = []; // Queue commands while PS boots
    const MAX_QUEUE = 200;

    function ensureInputSimulator() {
        if (process.platform !== 'win32') return; // Windows-only (PowerShell + user32.dll)
        if (psProcess) return;
        console.log('[InputSim] Starting PowerShell process...');

        psProcess = spawn('powershell.exe', [
            '-NoProfile', '-NoLogo', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-Command', '-'
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

        psProcess.stdout.on('data', (data) => {
            const text = data.toString();
            if (text.includes('READY')) {
                psReady = true;
                console.log('[InputSim] PowerShell READY — draining', pendingCmds.length, 'queued commands');
                // Drain queued commands
                while (pendingCmds.length > 0) {
                    psProcess.stdin.write(pendingCmds.shift() + "\n");
                }
            }
        });

        psProcess.stderr.on('data', (d) => {
            console.error('[InputSim] PS Error:', d.toString().trim());
        });

        psProcess.on('exit', (code) => {
            console.warn('[InputSim] PowerShell exited with code', code, '— will restart on next event');
            psProcess = null;
            psReady = false;
        });

        psProcess.on('error', (err) => {
            console.error('[InputSim] Failed to spawn PowerShell:', err.message);
            psProcess = null;
            psReady = false;
        });

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
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
Write-Output "READY"
`);
    }

    function psExec(cmd) {
        if (psProcess && psReady) {
            psProcess.stdin.write(cmd + "\n");
        } else if (psProcess && !psReady) {
            // PS is booting — queue the command
            if (pendingCmds.length < MAX_QUEUE) pendingCmds.push(cmd);
        }
        // If psProcess is null, ensureInputSimulator will be called first
    }

    // Input is handled by the cross-platform nut-js engine on ALL platforms now
    // (see the rc:simulate-input handler below). The legacy Windows PowerShell
    // path is no longer pre-booted — it was unreliable and often blocked by
    // security software.

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

    // ═══════════════════════════════════════════════════
    //  Cross-platform input for macOS / Linux via nut-js.
    //  Windows keeps the PowerShell path above unchanged.
    //  nut-js is lazy-loaded so a missing/broken native
    //  binary can never crash app startup.
    // ═══════════════════════════════════════════════════
    let nutPromise = null;
    let nutFailed = false;
    function getNut() {
        if (nutFailed) return Promise.resolve(null);
        if (!nutPromise) {
            nutPromise = import('@nut-tree-fork/nut-js')
                .then((nut) => {
                    // No artificial delays — we want real-time control
                    nut.mouse.config.autoDelayMs = 0;
                    nut.keyboard.config.autoDelayMs = 0;
                    console.log('[InputSim] nut-js loaded (native input ready)');
                    return nut;
                })
                .catch((e) => {
                    console.error('[InputSim] nut-js load failed:', e.message);
                    nutFailed = true;
                    return null;
                });
        }
        return nutPromise;
    }

    function nutSpecialKey(Key, key) {
        const map = {
            Enter: Key.Enter, Tab: Key.Tab, Escape: Key.Escape, Backspace: Key.Backspace,
            Delete: Key.Delete, Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
            ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
            ' ': Key.Space, Spacebar: Key.Space,
            CapsLock: Key.CapsLock, Insert: Key.Insert,
            F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
            F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
        };
        return map[key];
    }

    function nutCharKey(Key, ch) {
        if (!ch || ch.length !== 1) return undefined;
        const c = ch.toUpperCase();
        if (c >= 'A' && c <= 'Z') return Key[c];
        if (c >= '0' && c <= '9') return Key['Num' + c];
        return undefined;
    }

    async function nativeKeyDown(nut, data) {
        const { keyboard, Key } = nut;
        const key = data.key;
        if (!key) return;
        // Standalone modifier presses are folded into chords below
        if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return;

        const mods = [];
        // On a Windows target, the Mac operator's Cmd (metaKey) should act as
        // Ctrl so copy/paste/select-all etc. work; elsewhere Cmd maps to Super.
        if (process.platform === 'win32') {
            if (data.ctrlKey || data.metaKey) mods.push(Key.LeftControl);
        } else {
            if (data.ctrlKey) mods.push(Key.LeftControl);
            if (data.metaKey) mods.push(Key.LeftSuper);
        }
        if (data.altKey) mods.push(Key.LeftAlt);

        const special = nutSpecialKey(Key, key);

        // Modifier chord (e.g. Ctrl+C, Cmd+V) — press then release together
        if (mods.length > 0) {
            if (data.shiftKey) mods.push(Key.LeftShift);
            const main = special !== undefined ? special : nutCharKey(Key, key);
            if (main !== undefined) {
                await keyboard.pressKey(...mods, main);
                await keyboard.releaseKey(...mods, main);
            }
            return;
        }

        // Special key tap (Enter, arrows, etc.)
        if (special !== undefined) {
            await keyboard.pressKey(special);
            await keyboard.releaseKey(special);
            return;
        }

        // Printable character — type it literally (shift/caps already baked into key)
        if (key.length === 1) {
            await keyboard.type(key);
        }
    }

    // nut-js reports the screen in its OWN coordinate space (physical pixels on
    // Windows), which is exactly what mouse.setPosition expects. Using this
    // instead of Electron's DIP size keeps the pointer aligned on scaled
    // (125%/150%) Windows displays. Falls back to the Electron size if needed.
    let nutScreenCache = null;
    let nutScreenAt = 0;
    async function getNutScreen(nut) {
        const now = Date.now();
        if (nutScreenCache && now - nutScreenAt < 10000) return nutScreenCache;
        try {
            const w = await nut.screen.width();
            const h = await nut.screen.height();
            if (w && h) { nutScreenCache = { width: w, height: h }; nutScreenAt = now; }
        } catch (e) {
            console.warn('[InputSim] nut screen size failed, using Electron size:', e.message);
        }
        return nutScreenCache || getScreenSize();
    }

    async function simulateInputNative(data) {
        const nut = await getNut();
        if (!nut) return;
        const { mouse, Button, Point } = nut;
        const scr = await getNutScreen(nut);
        const { type } = data;

        const point = () => new Point(Math.round(data.x * scr.width), Math.round(data.y * scr.height));
        const button = data.button === 2 ? Button.RIGHT : Button.LEFT;

        try {
            switch (type) {
                case 'mousemove':
                    await mouse.setPosition(point());
                    break;
                case 'mousedown':
                    await mouse.setPosition(point());
                    await mouse.pressButton(button);
                    break;
                case 'mouseup':
                    await mouse.releaseButton(button);
                    break;
                case 'click':
                    await mouse.setPosition(point());
                    await mouse.click(button);
                    break;
                case 'dblclick':
                    await mouse.setPosition(point());
                    await mouse.doubleClick(Button.LEFT);
                    break;
                case 'contextmenu':
                    await mouse.setPosition(point());
                    await mouse.click(Button.RIGHT);
                    break;
                case 'scroll':
                    if ((data.deltaY || 0) > 0) await mouse.scrollDown(3);
                    else await mouse.scrollUp(3);
                    break;
                case 'keydown':
                    await nativeKeyDown(nut, data);
                    break;
                // 'keyup' — handled within keydown (tap model); nothing to do
            }
        } catch (e) {
            console.error('[InputSim] native input error:', e.message);
        }
    }

    // Serialize native input so events run strictly in order — no races
    // between mouse move / press / release / click / keystroke. (On Windows
    // the PowerShell stdin pipe already guarantees FIFO ordering.)
    let nativeInputQueue = Promise.resolve();
    function enqueueNativeInput(data) {
        nativeInputQueue = nativeInputQueue
            .then(() => simulateInputNative(data))
            .catch((e) => console.error('[InputSim] native queue error:', e.message));
    }

    // macOS requires Accessibility permission to synthesize input — prompt early.
    ipcMain.on('rc:ensure-input-permission', () => {
        if (process.platform === 'darwin') {
            try {
                const trusted = systemPreferences.isTrustedAccessibilityClient(true);
                console.log('[InputSim] Accessibility trusted:', trusted);
            } catch (e) {
                console.error('[InputSim] Accessibility check failed:', e.message);
            }
        }
    });

    ipcMain.on('rc:simulate-input', (event, data) => {
        // All platforms use the cross-platform nut-js engine (ordered queue).
        // Windows previously used PowerShell + user32.dll, which was unreliable
        // and frequently blocked by security software; nut-js uses native
        // SendInput and is the same engine that already works on macOS/Linux.
        enqueueNativeInput(data);
    });

    // Cleanup PS process on quit
    app.on('before-quit', () => {
        stopVirtualCameraBridge();
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
