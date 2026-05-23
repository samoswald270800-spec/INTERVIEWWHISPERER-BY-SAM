/**
 * Input Simulator — Native Windows mouse/keyboard simulation
 * Uses PowerShell with .NET interop for user32.dll calls
 * A persistent PowerShell process is spawned to avoid per-event latency
 */

import { spawn } from 'child_process';
import { screen as electronScreen } from 'electron';

let psProcess = null;
let isReady = false;

// Boot script: loads required .NET types once
const BOOT_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class InputSim {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
Write-Output "READY"
`;

// Key name → Windows Virtual Key code mapping
const VK_MAP = {
    'Enter': 0x0D, 'Tab': 0x09, 'Escape': 0x1B, 'Backspace': 0x08,
    'Delete': 0x2E, 'Insert': 0x2D, 'Home': 0x24, 'End': 0x23,
    'PageUp': 0x21, 'PageDown': 0x22,
    'ArrowUp': 0x26, 'ArrowDown': 0x28, 'ArrowLeft': 0x25, 'ArrowRight': 0x27,
    'Shift': 0x10, 'Control': 0x11, 'Alt': 0x12, 'Meta': 0x5B,
    'CapsLock': 0x14, 'NumLock': 0x90, 'ScrollLock': 0x91,
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
    'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
    'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
    ' ': 0x20, 'Space': 0x20,
};

/**
 * Start the persistent PowerShell process
 */
export function startInputSimulator() {
    if (psProcess) return;

    psProcess = spawn('powershell.exe', [
        '-NoProfile', '-NoLogo', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', '-'  // Read from stdin
    ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });

    // Wait for READY signal
    psProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text.includes('READY')) {
            isReady = true;
            console.log('[InputSim] PowerShell ready');
        }
    });

    psProcess.stderr.on('data', (data) => {
        console.error('[InputSim] PS Error:', data.toString());
    });

    psProcess.on('exit', (code) => {
        console.log('[InputSim] PS exited:', code);
        psProcess = null;
        isReady = false;
    });

    // Send the boot script
    psProcess.stdin.write(BOOT_SCRIPT + '\n');
}

/**
 * Stop the PowerShell process
 */
export function stopInputSimulator() {
    if (psProcess) {
        psProcess.stdin.end();
        psProcess.kill();
        psProcess = null;
        isReady = false;
    }
}

/**
 * Execute a command in the persistent PS process
 */
function exec(cmd) {
    if (!psProcess || !isReady) return;
    psProcess.stdin.write(cmd + '\n');
}

/**
 * Get screen dimensions for coordinate mapping
 */
function getScreenSize() {
    const primary = electronScreen.getPrimaryDisplay();
    return { width: primary.size.width, height: primary.size.height };
}

/**
 * Handle an input event from the admin
 * @param {Object} event - { type, x, y, button, key, code, ctrlKey, shiftKey, altKey, metaKey }
 */
export function handleInputEvent(event) {
    if (!isReady) return;

    const { type } = event;

    switch (type) {
        case 'mousemove': {
            const scr = getScreenSize();
            const px = Math.round(event.x * scr.width);
            const py = Math.round(event.y * scr.height);
            exec(`[InputSim]::SetCursorPos(${px}, ${py})`);
            break;
        }
        case 'click':
        case 'mousedown': {
            const scr = getScreenSize();
            const px = Math.round(event.x * scr.width);
            const py = Math.round(event.y * scr.height);
            exec(`[InputSim]::SetCursorPos(${px}, ${py})`);
            if (event.button === 2) {
                exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)`);
                if (type === 'click') {
                    exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)`);
                }
            } else {
                exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)`);
                if (type === 'click') {
                    exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)`);
                }
            }
            break;
        }
        case 'mouseup': {
            if (event.button === 2) {
                exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)`);
            } else {
                exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)`);
            }
            break;
        }
        case 'dblclick': {
            const scr = getScreenSize();
            const px = Math.round(event.x * scr.width);
            const py = Math.round(event.y * scr.height);
            exec(`[InputSim]::SetCursorPos(${px}, ${py})`);
            // Double click = two rapid click sequences
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)`);
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)`);
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)`);
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)`);
            break;
        }
        case 'contextmenu': {
            const scr = getScreenSize();
            const px = Math.round(event.x * scr.width);
            const py = Math.round(event.y * scr.height);
            exec(`[InputSim]::SetCursorPos(${px}, ${py})`);
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)`);
            exec(`[InputSim]::mouse_event([InputSim]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)`);
            break;
        }
        case 'keydown': {
            // Handle modifier keys
            if (event.ctrlKey) exec(`[InputSim]::keybd_event(0x11, 0, 0, [IntPtr]::Zero)`);
            if (event.shiftKey) exec(`[InputSim]::keybd_event(0x10, 0, 0, [IntPtr]::Zero)`);
            if (event.altKey) exec(`[InputSim]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)`);

            const vk = getVirtualKeyCode(event.key, event.code);
            if (vk !== null) {
                exec(`[InputSim]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`);
            }
            break;
        }
        case 'keyup': {
            const vk = getVirtualKeyCode(event.key, event.code);
            if (vk !== null) {
                exec(`[InputSim]::keybd_event(${vk}, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)`);
            }
            // Release modifiers
            if (event.ctrlKey) exec(`[InputSim]::keybd_event(0x11, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)`);
            if (event.shiftKey) exec(`[InputSim]::keybd_event(0x10, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)`);
            if (event.altKey) exec(`[InputSim]::keybd_event(0x12, 0, [InputSim]::KEYEVENTF_KEYUP, [IntPtr]::Zero)`);
            break;
        }
    }
}

/**
 * Convert browser key/code to Windows VK code
 */
function getVirtualKeyCode(key, code) {
    // Check named keys first
    if (VK_MAP[key]) return VK_MAP[key];

    // Single character → use ASCII/VK mapping
    if (key && key.length === 1) {
        const upper = key.toUpperCase();
        const charCode = upper.charCodeAt(0);
        // A-Z → 0x41-0x5A
        if (charCode >= 65 && charCode <= 90) return charCode;
        // 0-9 → 0x30-0x39
        if (charCode >= 48 && charCode <= 57) return charCode;
        // Common symbols
        const symbolMap = {
            '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD,
            '\\': 0xDC, ';': 0xBA, "'": 0xDE, ',': 0xBC,
            '.': 0xBE, '/': 0xBF, '`': 0xC0,
        };
        if (symbolMap[key]) return symbolMap[key];
    }

    // Fallback: code-based mapping
    if (code) {
        if (code.startsWith('Key')) return code.charCodeAt(3); // KeyA → 65
        if (code.startsWith('Digit')) return code.charCodeAt(5) + 0; // Digit0 → 48
    }

    return null;
}
