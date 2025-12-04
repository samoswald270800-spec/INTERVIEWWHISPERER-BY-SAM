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
Required for secure sessions and legacy admin console access.

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
Required for multi-tenant features. Get keys from: https://supabase.com/dashboard/project/_/settings/api

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

1. Copy these variables to your `.env` file locally
2. On Render/Railway, add them in the Environment Variables section
3. Run the SQL schema in Supabase: `supabase/schema.sql`
4. Restart your service after adding new variables

---

## Complete .env Template

```env
# Required
OPENAI_API_KEY=sk-...
REDIS_URL=rediss://default:password@host:port
SESSION_SECRET=your-random-secret-here
NODE_ENV=production

# Legacy Admin Console
ADMIN_USER=admin
ADMIN_PASS=your-secure-password

# Multi-Tenant (Supabase)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=your-super-admin-password

# Optional
ANTHROPIC_API_KEY=sk-ant-...
```
