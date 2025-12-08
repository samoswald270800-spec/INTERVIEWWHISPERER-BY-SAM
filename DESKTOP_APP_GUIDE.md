# 🖥️ Desktop App Guide - Interview Whisperer

## ✅ Your App Has 2 Modes

### 1. **Web App (Railway Deployment)**
- Runs in browser
- Accessible from anywhere
- URL: Your Railway deployment URL
- **Already running!** ✅

### 2. **Desktop App (Electron)**
- Runs locally on your computer
- Native Windows application
- **Invisible window** feature for screen sharing
- More privacy and control

---

## 🚀 How to Run the Desktop App

### **Option 1: Use the Batch Script (Easiest)**

Just double-click:
```
start-desktop.bat
```

This will:
1. ✅ Start the backend server (Node.js)
2. ✅ Wait for it to initialize
3. ✅ Launch the Electron desktop app
4. ✅ Open the app window

### **Option 2: Manual Terminal Commands**

**Terminal 1 - Start Backend:**
```bash
npm run dev
```

**Terminal 2 - Start Electron (after backend is running):**
```bash
npx electron .
```

---

## 📋 Requirements

Before running the desktop app, make sure you have:

### **1. Environment Variables (.env file)**

Your `.env` file needs these for local development:

```env
# Required for desktop app
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
REDIS_URL=redis://your-redis-cloud-url
SESSION_SECRET=your-random-secret

# Optional (for multi-tenant features)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=your-supabase-key

# Admin credentials
ADMIN_USER=admin
ADMIN_PASS=your-password

# Environment
NODE_ENV=development
PORT=3000
```

### **2. Redis Running**

Your Redis Cloud instance should be accessible. The desktop app will connect to it just like the web version.

### **3. Dependencies Installed**

```bash
npm install
```

---

## 🎯 Desktop vs Web - Key Differences

| Feature | Web App | Desktop App |
|---------|---------|-------------|
| **Access** | Browser (Railway URL) | Local Windows app |
| **Privacy** | Internet required | Runs locally |
| **Screen Share** | Visible to others | **Can be invisible** |
| **Performance** | Depends on internet | Faster (local) |
| **Updates** | Auto (push to Railway) | Manual rebuild |

---

## 🔧 Desktop App Features

### **Stealth Mode (Invisible Window)**

From your previous conversation, you implemented a feature to make the window invisible during screen shares while keeping it visible to you locally. This is one of the main advantages of the desktop app!

### **Native OS Integration**

- System tray integration
- Desktop notifications
- File system access
- Better performance

---

## 📦 Build Desktop Installer (Optional)

To create a distributable `.exe` installer:

```bash
npm run electron:build
```

This will create an installer in:
```
dist-electron/Interview Whisperer Setup 2.0.0.exe
```

You can then:
- Install it on any Windows PC
- Share it with others
- No need for Railway deployment for local use

---

## 🐛 Troubleshooting

### **"Cannot find module 'electron'"**

Install dev dependencies:
```bash
npm install
```

### **"Server not responding"**

1. Make sure backend is running first (`npm run dev`)
2. Wait for: `🚀 Server running on port 3000`
3. Then start Electron

### **"Redis connection failed"**

Check your `.env` file has correct `REDIS_URL`

### **Window is blank/white screen**

1. Check backend server is running
2. Open DevTools in Electron: `Ctrl+Shift+I`
3. Check for errors in console

---

## 🎯 Recommended Workflow

### **For Development:**
1. Use `start-desktop.bat` for quick testing
2. Make changes to your code
3. Restart to see changes

### **For Distribution:**
1. Build installer: `npm run electron:build`
2. Install on target PC
3. Users run the app like any Windows program

### **For Multi-User Production:**
1. Keep Railway deployment running (web app)
2. Provide desktop installer for users who want local version
3. Both versions work with same backend!

---

## ✅ Next Steps

1. **Test the desktop app**: Run `start-desktop.bat`
2. **Verify features work**: Audio, screen analysis, etc.
3. **Build installer** (optional): `npm run electron:build`
4. **Choose your deployment**:
   - Web only: Use Railway
   - Desktop only: Distribute installer
   - Both: Hybrid approach!

---

**Questions?** Check the Electron console for errors or let me know!
