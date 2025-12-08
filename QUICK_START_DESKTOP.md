# 🚀 QUICK START - Desktop App

## Run the Desktop App (3 Steps)

### **Step 1: Make sure .env file exists**
```bash
# Check if you have a .env file with these variables:
OPENAI_API_KEY=sk-proj-xxxxx
REDIS_URL=redis://your-redis-cloud-url
SESSION_SECRET=random-secret
```

### **Step 2: Double-click the batch file**
```
start-desktop.bat
```

### **Step 3: Wait for the app to open!**
- Backend server will start (Terminal window)
- Electron app will launch (Desktop window)
- Login with your credentials

---

## ✨ Special Desktop Features

### **🕵️ Stealth Mode (Invisible Window)**

Your app has a **stealth mode** that makes it invisible during screen shares!

**Keyboard Shortcut:**
```
Ctrl + Shift + H
```

- **OFF** → Window is visible (normal mode)
- **ON** → Window is hidden from screen capture but still accessible to you!

**System Tray:**
- Right-click the tray icon → Show/Hide
- Click tray icon to toggle stealth mode

---

## 🎯 What Happens When You Run It

1. **Terminal Window Opens** → Backend server starting
2. **Wait 5 seconds** → Server initializing
3. **Electron Window Opens** → Desktop app launches
4. **Login Page Loads** → Ready to use!

---

## 🔧 Troubleshooting

### **"Backend server won't start"**
- Check your `.env` file has all required variables
- Make sure Redis URL is correct
- Try running manually: `npm run dev`

### **"Electron window is blank"**
- Wait for backend to fully start (look for "Server running on port 3000")
- Refresh: Press `Ctrl+R` in Electron window
- Open DevTools: `Ctrl+Shift+I` to see errors

### **"Cannot find module"**
Run:
```bash
npm install
```

---

## 📝 Full Documentation

- **Desktop App Guide**: `DESKTOP_APP_GUIDE.md`
- **Deployment Guide**: `DEPLOYMENT_FIX.md`
- **Railway Redis Setup**: `RAILWAY_REDIS_SETUP.md`

---

## 💡 Pro Tips

1. **Always run the backend first** before opening Electron
2. **Use Ctrl+Shift+H** to quickly hide/show during interviews
3. **System tray icon** lets you control the app even when hidden
4. **Keep it always on top** feature is enabled by default

---

**Ready?** Just double-click `start-desktop.bat` and you're good to go! 🎉
