# 🚂 Railway Redis Setup Guide

## Problem
Your deployment is failing because Redis is not configured. You're seeing:
```
❌ Redis error: ECONNREFUSED 127.0.0.1:6379
```

## Solution

### Option 1: Add Redis Plugin on Railway (Easiest ⭐)

1. **Go to your Railway project**: https://railway.app/dashboard
2. **Click "New" in your project**
3. **Select "Database" → "Add Redis"**
4. Railway will automatically:
   - ✅ Create a Redis instance
   - ✅ Add `REDIS_URL` environment variable
   - ✅ Connect it to your app

5. **Your app will auto-redeploy with Redis configured!**

---

### Option 2: Use Upstash (Free External Redis)

If you want to use an external Redis service:

#### Step 1: Create Free Upstash Account
1. Go to: https://upstash.com
2. Sign up (it's free!)
3. Click "Create Database"
4. Choose:
   - **Name**: interview-whisperer-redis
   - **Type**: Regional (choose closest region)
   - **Eviction**: No eviction

#### Step 2: Get Redis URL
1. After creating, click on your database
2. Scroll to "REST API" section
3. Copy the **Redis URL** (starts with `rediss://`)
   - Example: `rediss://default:xxxxx@us1-xxxxx.upstash.io:6379`

#### Step 3: Add to Railway
1. Go to your Railway project
2. Click on your service
3. Go to "Variables" tab
4. Add new variable:
   - **Key**: `REDIS_URL`
   - **Value**: (paste your Upstash Redis URL)
5. Click "Add"
6. Your app will auto-redeploy!

---

## ✅ Verify It's Working

After adding Redis, check your deployment logs. You should see:

```
✅ Redis client ready
🔎 Redis PING: PONG
```

Instead of:
```
❌ Redis error: ECONNREFUSED
```

---

## 💡 Why Redis is Required

Your application uses Redis for:
- 🔐 **Session storage** (user login sessions)
- 📊 **Active session tracking** (concurrent user management)
- 💾 **Transcript caching** (interview transcripts)
- 🖼️ **Screen analysis storage** (analyzed screens)
- ⏱️ **Rate limiting** (API usage limits)

**It's essential for the app to function!**

---

## 🆘 Still Having Issues?

### Check your logs:
1. Railway Dashboard → Your Service → Deployments → Click latest deployment
2. Look for Redis connection messages

### Common Issues:

**"REDIS_URL is required"**
- ✅ Make sure you added the `REDIS_URL` variable
- ✅ Make sure it starts with `redis://` or `rediss://`

**"Redis connection timeout"**
- ✅ Check if Upstash database is active
- ✅ Try a different region

**"Authentication failed"**
- ✅ Copy the full Redis URL including password
- ✅ Don't modify the URL (use exactly as provided)

---

## 🎯 Recommended Approach

**For Railway deployment → Use Railway Redis Plugin**
- ✅ Automatic setup
- ✅ Same datacenter (faster)
- ✅ Integrated billing
- ✅ Zero configuration

**For multi-platform deployment → Use Upstash**
- ✅ Works everywhere
- ✅ Free tier generous
- ✅ Global distribution
- ✅ Platform independent

---

**Once Redis is added, your deployment will succeed!** 🚀
