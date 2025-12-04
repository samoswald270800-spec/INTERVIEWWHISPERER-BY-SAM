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
Required for session storage and rate limiting.

### Session Security
```
SESSION_SECRET=your-random-secret-here
```
Required for secure session cookies.

### Node Environment
```
NODE_ENV=production
```

## Multi-Tenant System (Supabase)

### Supabase Connection
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
**Required** for authentication. Get keys from: https://supabase.com/dashboard/project/_/settings/api

### Super Admin Seeding
```
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=your-secure-password
```
On first boot, creates the platform owner Super Admin account.

## Optional Variables

### Anthropic (Claude)
```
ANTHROPIC_API_KEY=sk-ant-...
```
Optional. Enables Claude 3.5 Sonnet as fallback for screen analysis.

---

## Setup Instructions

### 1. Supabase Setup
1. Create a project at https://supabase.com
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Copy your Project URL and anon/service key from Settings > API

### 2. Environment Configuration
1. Create a `.env` file locally with all required variables
2. On Render/Railway, add them in the Environment Variables section

### 3. First Boot
1. Deploy the application
2. The server will auto-create the Super Admin account
3. Login at `/login` with your Super Admin credentials

---

## Complete .env Template

```env
# Required
OPENAI_API_KEY=sk-...
REDIS_URL=rediss://default:password@host:port
SESSION_SECRET=your-random-secret-here
NODE_ENV=production

# Supabase (Required)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Super Admin
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=your-super-admin-password

# Optional
ANTHROPIC_API_KEY=sk-ant-...
```
