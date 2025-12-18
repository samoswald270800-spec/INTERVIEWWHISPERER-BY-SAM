# Production Build Guide for Interview Whisperer

## 1. Prerequisites
- Ensure you have the VS Build Tools or necessary build chain (usually automatic on Windows).
- **Icon**: For a professional look, you need an application icon.
  - Create a file named `icon.ico` (256x256 recommended).
  - Place it in the `root` directory or `build` directory.
  - Update `package.json`:
    ```json
    "build": {
      "win": {
        "icon": "icon.ico"
      }
    }
    ```

## 2. Secrets & Environment
- Your app is currently configured to connect to the **Railway Backend** `https://interviewwhisperer-by-sam-production.up.railway.app`.
- This URL is hardcoded in `electron-preload.js` safe for distribution (client-side public URL).
- **Do NOT** package your `.env` file if it contains secret API keys. The Desktop App uses the remote backend, so it doesn't need the server keys locally.

## 3. Building the App
Run the following command to generate the Windows Installer (`.exe`):

```bash
npm run electron:build
```

### Troubleshooting Build Failures
If you see errors like `cache` or `network timeout`:
1. Delete the `dist-electron` folder.
2. Delete `C:\Users\YOUR_USER\AppData\Local\electron-builder` (cache).
3. Try running `npx electron-builder build --win` manually.
4. Ensure you have a stable internet connection (it downloads Electron binaries ~100MB).

## 4. Output
- The installer (Setup.exe) will be in `dist-electron/`.
- The unpacked executable (for testing without install) will be in `dist-electron/win-unpacked/Interview Whisperer.exe`.

## 5. Code Signing (Optional but Recommended)
- By default, Windows will warn users "Unknown Publisher".
- To fix this, you need to buy a Code Signing Certificate (e.g., from Sectigo, DigiCert) and configure `electron-builder` to sign your app.
- For personal use, you can ignore the warning.

## 6. Auto-Updates
- To enable auto-updates, you need to configure `publish` settings in `package.json` (e.g., to GitHub Releases) and use `electron-updater` in `electron-main.js`.
