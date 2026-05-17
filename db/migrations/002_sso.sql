-- Migration 002 - SSO / SAML 2.0 support
-- Note: the admin users table in this codebase is admin_users, not users.
-- Applied on startup by db/index.js. ALTER statements that fail because the
-- column already exists are swallowed, so this migration is idempotent.

ALTER TABLE admin_users ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'local';

ALTER TABLE admin_users ADD COLUMN saml_name_id TEXT;

ALTER TABLE admin_users ADD COLUMN last_sso_login DATETIME;

CREATE TABLE IF NOT EXISTS saml_config (
  id INTEGER PRIMARY KEY,
  entry_point TEXT NOT NULL,
  issuer TEXT NOT NULL,
  idp_cert TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
