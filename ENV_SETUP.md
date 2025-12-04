# Environment Variables Setup

## Required Variables

### OpenAI
```
OPENAI_API_KEY=sk-...
```
Required for GPT-4o Realtime sessions and vision analysis.

### Redis
```
REDIS_URL=redis://localhost:6379
```
Or for production with TLS:
```
REDIS_URL=rediss://default:password@host:port
```
Required for session storage, temp users, and rate limiting.

### Session & Auth
```
SESSION_SECRET=your-random-secret-here
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```
Required for secure sessions and admin console access.

### Node Environment
```
NODE_ENV=production
```

## Optional Variables

### Anthropic (Claude)
```
ANTHROPIC_API_KEY=sk-ant-...
```
Optional. Enables Claude 3.5 Sonnet as a fallback for screen analysis.

### Supabase
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
Optional. Ready for future database features (transcripts, analytics, etc.).

Get your keys from: https://supabase.com/dashboard/project/_/settings/api

---

## Setup Instructions

1. Copy these variables to your `.env` file locally
2. On Render/Railway, add them in the Environment Variables section
3. Restart your service after adding new variables

