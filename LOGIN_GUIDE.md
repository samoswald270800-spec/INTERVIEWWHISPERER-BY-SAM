# 🔐 Login & Authentication Guide

## ✅ Your Current Setup

Your app has **3 authentication modes** that work across **both web and desktop**:

### **1. Regular Users (Candidates)** 👤
- **Login Type**: "Candidate" tab (default)
- **Credentials**: From Supabase database (shared with your other repo)
- **Database**: Your Supabase users table
- **Redirects to**: Main interview app (`/`)

### **2. Business/Admin (Consultancy)** 💼
- **Login Type**: "Business" tab
- **Credentials**: From Supabase admins table
- **Database**: Your Supabase admins table  
- **Redirects to**: Admin dashboard (`/admin-dashboard`)

### **3. Super Admin** 🔐
- **Login Type**: Hidden "Admin" tab (Easter egg!)
- **How to reveal**: Click "About this tool" **5 times in 3 seconds**
- **Credentials**: Environment variables (`SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`)
- **Redirects to**: Super Admin panel (`/super-admin`)

---

## 🎯 How Users Login (Shared Database)

Since you're using the **same Supabase database** across repos:

1. ✅ Users created in your **production repo**
2. ✅ Can login in **this desktop/Railway deployment**
3. ✅ Authentication checks Supabase `users` table
4. ✅ Same credentials work everywhere!

**This is already working!** As long as both repos use the same `SUPABASE_URL` and `SUPABASE_KEY`.

---

## 🔓 Super Admin Access (Easter Egg)

### **How to Access:**

1. **Go to login page** (web or desktop)
2. **Click "About this tool"** at the bottom **5 times quickly** (within 3 seconds)
3. **Super Admin tab appears!** (🔐 Admin button)
4. **Switch to that tab**
5. **Login with**:
   - Username: Value of `SUPER_ADMIN_USERNAME` env var
   - Password: Value of `SUPER_ADMIN_PASSWORD` env var

### **Super Admin Page:**

After login, you'll be redirected to:
```
https://your-railway-url.up.railway.app/super-admin
```

This gives you access to:
- Platform-wide statistics
- Manage all admins (consultancies)
- View all users across all admins
- Credit management
- Force logout users
- Audit logs

---

## ⚙️ Environment Variables Needed

### **Railway (Already Set):**

```env
# Supabase (shared database)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=your_supabase_anon_key

# Super Admin Credentials
SUPER_ADMIN_USERNAME=your_super_admin_username
SUPER_ADMIN_PASSWORD=your_super_admin_password

# Redis (for sessions)
REDIS_URL=redis://your-redis-cloud-url

# OpenAI
OPENAI_API_KEY=sk-proj-xxxxx
```

---

## 🧪 Testing Login

### **Test User Login:**

1. Make sure you have a user in your Supabase `users` table
2. Go to login page
3. Click "Candidate" tab (default)
4. Enter username/password from Supabase
5. Should redirect to interview app!

### **Test Super Admin:**

1. Go to login page
2. Click "About this tool" 5 times fast
3. Click the "🔐 Admin" tab that appears
4. Enter your `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`
5. Should redirect to `/super-admin` dashboard!

---

## 🐛 If Login Doesn't Work

### **For Users:**

**Check Supabase:**
1. Go to Supabase dashboard
2. Check `users` table has the user
3. Verify `password` column is correct (bcrypt hash)
4. Check `status` = `'active'`

**Check Railway logs:**
- Should show: `✅ Supabase client initialized`
- If not, check `SUPABASE_URL` and `SUPABASE_KEY` env vars

### **For Super Admin:**

**Check environment variables:**
1. Railway → Variables
2. Verify `SUPER_ADMIN_USERNAME` is set
3. Verify `SUPER_ADMIN_PASSWORD` is set
4. Redeploy if you just added them

---

## 📋 Current Status Checklist

- ✅ **Railway deployed** with Redis
- ✅ **Supabase connected** (shared database)
- ✅ **Login page** with easter egg
- ✅ **3 login modes** working
- ✅ **Desktop app** connects to Railway
- ✅ **Super admin panel** accessible at `/super-admin`

---

## 🎯 What You Need to Do

1. **Set Super Admin credentials** in Railway:
   ```
   SUPER_ADMIN_USERNAME=admin
   SUPER_ADMIN_PASSWORD=YourSecurePassword123
   ```

2. **Test user login**:
   - Use existing Supabase users
   - They should work immediately!

3. **Test super admin**:
   - Click "About this tool" 5 times
   - Login with env creds

---

**Everything is already configured!** Just need to set the super admin environment variables in Railway. 🚀
