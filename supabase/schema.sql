-- ============================================================================
-- INTERVIEW WHISPERER v2 - MULTI-TENANT DATABASE SCHEMA
-- Super Admins: use USERNAME
-- Admins & Users: can use USERNAME or EMAIL
-- Run this in Supabase SQL Editor
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. SUPER ADMINS (Platform Owner - You)
-- ============================================================================
CREATE TABLE IF NOT EXISTS super_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_super_admins_username ON super_admins(username);

-- ============================================================================
-- 2. ADMINS (Consultancies)
-- Can login with either username OR email
-- ============================================================================
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    username TEXT UNIQUE,              -- Optional: for login
    email TEXT UNIQUE,                 -- Optional: for login
    password_hash TEXT NOT NULL,
    credits INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    -- At least one identifier must be set
    CONSTRAINT admins_identifier_check CHECK (username IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_status ON admins(status);

-- ============================================================================
-- 3. USERS (Candidates)
-- Can login with either username OR email
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    username TEXT,                     -- Optional: for login
    email TEXT,                        -- Optional: for login  
    password_hash TEXT NOT NULL,
    credits INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
    permissions JSONB DEFAULT '{"canExpand": true, "canAnalyze": true}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    -- At least one identifier must be set
    CONSTRAINT users_identifier_check CHECK (username IS NOT NULL OR email IS NOT NULL),
    -- Unique per admin
    UNIQUE(admin_id, username),
    UNIQUE(admin_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_admin_id ON users(admin_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- 4. SESSIONS (Interview tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    total_seconds INTEGER DEFAULT 0,
    credits_used INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_admin_id ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC);

-- ============================================================================
-- 5. CREDIT TRANSACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    super_admin_id UUID REFERENCES super_admins(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('assign', 'reclaim', 'consume', 'refund', 'admin_refill', 'admin_deduct', 'screen_analysis')),
    amount INTEGER NOT NULL,
    balance_after INTEGER,
    description TEXT,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_admin_id ON credit_transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);

-- ============================================================================
-- 6. AUDIT LOGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('super_admin', 'admin', 'user', 'system')),
    actor_id UUID,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- 7. SYSTEM SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description) VALUES
    ('credit_rate', '{"tokens_per_hour": 10, "min_charge_minutes": 10}'::jsonb, 'Credit consumption rates'),
    ('screen_analysis_cost', '{"minutes": 3}'::jsonb, 'Screen analysis cost'),
    ('max_session_hours', '4'::jsonb, 'Max session duration')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- DONE!
-- Super Admins: use USERNAME
-- Admins & Users: can use USERNAME or EMAIL (whichever is set)
-- ============================================================================
