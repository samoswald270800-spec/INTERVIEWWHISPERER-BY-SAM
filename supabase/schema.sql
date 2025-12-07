-- Uniqueness protections to prevent duplicate usernames even under concurrent requests

-- Admin usernames must be globally unique
CREATE UNIQUE INDEX IF NOT EXISTS admins_username_key ON admins (username);

-- User usernames must be unique per admin/organization
CREATE UNIQUE INDEX IF NOT EXISTS users_admin_id_username_key ON users (admin_id, username);
