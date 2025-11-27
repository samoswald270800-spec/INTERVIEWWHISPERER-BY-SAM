# 🚀 QUICK SETUP GUIDE - Interview Whisperer

## ⚡ Quick Start (5 Minutes)

### Step 1: Install Dependencies ✅

This has already been done! Both root and React dependencies are installed.

### Step 2: Configure Environment Variables 🔧

**You need to create a `.env` file with the following:**

1. Copy the example file:
   ```bash
   copy .env.example .env
   ```

2. Edit `.env` and fill in these **REQUIRED** values:

   #### 🔑 OpenAI API Key
   - Get it from: https://platform.openai.com/api-keys
   - Required for: AI-powered interview answers
   ```
   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
   ```

   #### 🗄️ Redis URL
   - **Option A - Free Cloud Redis (Recommended):**
     - Sign up at https://upstash.com (free tier)
     - Create a Redis database
     - Copy the connection URL
   
   - **Option B - Local Redis:**
     - Install Redis locally
     - Use: `redis://localhost:6379`
   
   ```
   REDIS_URL=redis://your-redis-url-here
   ```

   #### 🔐 Session Secret
   - Generate a random string
   - Run this to generate one:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   ```
   SESSION_SECRET=your_generated_secret_here
   ```

   #### 👤 Admin Credentials
   - Set your login credentials
   ```
   ADMIN_USER=admin
   ADMIN_PASS=YourSecurePassword123
   ```

### Step 3: Build the React App 🏗️

Already done! The production build is in `public/build/`

If you want to rebuild:
```bash
cd public
npm run build
cd ..
```

### Step 4: Start the Server 🚀

**Production Mode:**
```bash
npm start
```
Or double-click: `start.bat`

**Development Mode:**
```bash
# This starts both backend and frontend with hot reload
```
Or double-click: `start-dev.bat`

### Step 5: Open the App 🌐

Visit: **http://localhost:3000**

Login with the credentials you set in `.env`

---

## 📋 Checklist

Before starting the server, make sure you have:

- [x] ✅ Installed dependencies (`npm install` in root)
- [x] ✅ Installed React dependencies (`npm install` in public/)
- [x] ✅ Built the React app (`npm run build` in public/)
- [ ] ⚠️ Created `.env` file with all required values
- [ ] ⚠️ Set up Redis (either cloud or local)
- [ ] ⚠️ Got OpenAI API key
- [ ] ⚠️ Set admin credentials

---

## 🆘 Common Issues

### "OpenAI is not a constructor" or "MODULE_NOT_FOUND"
- **Solution:** Make sure `.env` file exists with `OPENAI_API_KEY`

### "Redis connection failed"
- **Solution:** Check your `REDIS_URL` in `.env`
- Make sure Redis is running (if local)
- Or verify your cloud Redis URL is correct

### "Invalid username or password" on login
- **Solution:** Check `ADMIN_USER` and `ADMIN_PASS` in `.env`

### Page shows "Cannot GET /"
- **Solution:** Make sure you ran `npm run build` in the `public/` folder

---

## 🎨 Features Ready to Use

Once you start the app, you'll have access to:

✅ **Smart Mode / God Mode** - Toggle between concise and detailed answers  
✅ **Audio Capture** - Capture interview audio from browser tab  
✅ **Screen Analysis** - AI analyzes shared screens for context  
✅ **Job Description** - Paste JD to tailor answers  
✅ **Real-time Q&A** - See questions and AI-generated answers live  
✅ **Dark/Light Mode** - Toggle between themes  
✅ **Professional UI** - Clean, modern, glassmorphic design  

---

## 📞 Need Help?

1. Check that all `.env` values are set correctly
2. Make sure Redis is accessible
3. Verify OpenAI API key is valid
4. Check the terminal for error messages

---

**Once configured, just run `start.bat` and you're ready to ace interviews! 🎯**
