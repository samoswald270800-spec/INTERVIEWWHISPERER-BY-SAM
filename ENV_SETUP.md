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
Required for session storage, active sessions, and rate limiting.

### Session & Auth
```
SESSION_SECRET=your-random-secret-here
```
Required for secure session cookies.

### Node Environment
```
NODE_ENV=production
```

## Multi-Tenant System Variables

### Supabase (Required for multi-tenant features)
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
**Required** for the multi-tenant dashboard system (Super Admin, Admin, Users).

Get your keys from: https://supabase.com/dashboard/project/_/settings/api

### Super Admin Seeding
```
SUPER_ADMIN_EMAIL=admin@yourcompany.com
SUPER_ADMIN_PASSWORD=your-secure-password
```
On first boot, the server will create a Super Admin account with these credentials.
This is the platform owner account with full system access.

## Optional Variables

### Anthropic (Claude)
```
ANTHROPIC_API_KEY=sk-ant-...
```
Optional. Enables Claude 3.5 Sonnet as a fallback for screen analysis.

### Legacy Admin (Backward Compatibility)
```
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```
Legacy admin credentials for the old admin console. 
Will be deprecated in favor of Supabase-based Super Admin.

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
3. Visit `/login` and use the easter egg (click "About this tool" 5 times fast) to access Super Admin login

### 4. Dashboard Access
- **Super Admin**: `/super-admin` (hidden, requires easter egg)
- **Admin (Business)**: `/admin-dashboard`
- **User (Candidate)**: Main app at `/`

---

## Role Hierarchy

```
Super Admin (Platform Owner)
    └── Creates & manages Admins
    └── Full system access
    └── Credit management

Admin (Consultancy/Business)
    └── Creates & manages Users
    └── Assigns credits
    └── Monitors usage

User (Candidate)
    └── Uses interview tool
    └── Consumes credits
    └── Views own sessions
```

