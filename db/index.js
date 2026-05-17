const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } = require('../middleware/permissions');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'credential-manager.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      employee_id TEXT UNIQUE,
      department TEXT,
      title TEXT,
      email TEXT,
      phone TEXT,
      start_date DATE,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS safes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      combination TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS safe_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      safe_id INTEGER NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      granted_by TEXT NOT NULL,
      UNIQUE(safe_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS keyrings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ring_number TEXT NOT NULL UNIQUE,
      description TEXT,
      location TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS keyring_authorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyring_id INTEGER NOT NULL REFERENCES keyrings(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      granted_by TEXT NOT NULL,
      UNIQUE(keyring_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS system_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_name TEXT NOT NULL,
      account_username TEXT NOT NULL,
      account_password TEXT,
      url TEXT,
      category TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_account_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES system_accounts(id) ON DELETE CASCADE,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      granted_by TEXT NOT NULL,
      UNIQUE(account_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id INTEGER,
      resource_name TEXT,
      staff_id INTEGER,
      staff_name TEXT,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS key_systems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      manufacturer TEXT,
      keyway TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_system_id INTEGER NOT NULL REFERENCES key_systems(id),
      key_number TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'CHANGE',
      parent_key_id INTEGER REFERENCES keys(id),
      bitting TEXT,
      keyway TEXT,
      key_blank TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(key_system_id, key_number)
    );

    CREATE TABLE IF NOT EXISTS doors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      door_number TEXT,
      location TEXT,
      building TEXT,
      floor TEXT,
      access_type TEXT NOT NULL DEFAULT 'KEYED',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS key_door_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
      door_id INTEGER NOT NULL REFERENCES doors(id) ON DELETE CASCADE,
      UNIQUE(key_id, door_id)
    );

    CREATE TABLE IF NOT EXISTS fob_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fob_profile_doors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fob_profile_id INTEGER NOT NULL REFERENCES fob_profiles(id) ON DELETE CASCADE,
      door_id INTEGER NOT NULL REFERENCES doors(id) ON DELETE CASCADE,
      UNIQUE(fob_profile_id, door_id)
    );

    CREATE TABLE IF NOT EXISTS keyring_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyring_id INTEGER NOT NULL REFERENCES keyrings(id) ON DELETE CASCADE,
      key_id INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_by TEXT NOT NULL,
      UNIQUE(keyring_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS keyring_fob_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyring_id INTEGER NOT NULL REFERENCES keyrings(id) ON DELETE CASCADE,
      fob_profile_id INTEGER NOT NULL REFERENCES fob_profiles(id) ON DELETE CASCADE,
      fob_serial TEXT,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_by TEXT NOT NULL,
      UNIQUE(keyring_id, fob_profile_id)
    );

    CREATE TABLE IF NOT EXISTS floor_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      building TEXT,
      floor TEXT,
      filename TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS floor_plan_doors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_plan_id INTEGER NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
      door_id INTEGER NOT NULL REFERENCES doors(id) ON DELETE CASCADE,
      x_pct REAL NOT NULL,
      y_pct REAL NOT NULL,
      UNIQUE(floor_plan_id, door_id)
    );
  `);

  // ── Physical Key Copy Tracking tables ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS physical_keys (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      stamp_number   TEXT NOT NULL UNIQUE,
      key_type_id    INTEGER NOT NULL REFERENCES keys(id),
      status         TEXT NOT NULL DEFAULT 'active',
      keytrak_ring_id INTEGER REFERENCES keyrings(id),
      notes          TEXT,
      expiry_date    DATE,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS key_transactions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      physical_key_id     INTEGER NOT NULL REFERENCES physical_keys(id),
      transaction_type    TEXT NOT NULL,
      transaction_date    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      performed_by        TEXT NOT NULL,
      assigned_to_staff_id INTEGER REFERENCES staff(id),
      notes               TEXT,
      receipt_filename    TEXT,
      linked_key_id       INTEGER REFERENCES physical_keys(id),
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS key_agreements (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      physical_key_id           INTEGER NOT NULL REFERENCES physical_keys(id),
      staff_id                  INTEGER NOT NULL REFERENCES staff(id),
      issued_date               DATE NOT NULL,
      returned_date             DATE,
      expiry_date               DATE,
      acknowledgment_text       TEXT,
      signed_agreement_filename TEXT,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS key_custody_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      physical_key_id  INTEGER NOT NULL REFERENCES physical_keys(id),
      from_staff_id    INTEGER REFERENCES staff(id),
      to_staff_id      INTEGER REFERENCES staff(id),
      transferred_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      performed_by     TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      notes            TEXT
    );
  `);

  // ── Roles & Permissions ────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      description TEXT,
      is_system   INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_id, permission)
    );
  `);

  // ── Plan Settings ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ── Audit log integrity: prevent deletion and modification ────────────────
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log entries cannot be deleted');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log entries cannot be modified');
    END;
  `);

  // ── Migrations: keyrings checkout columns ─────────────────────────────────
  try { db.exec('ALTER TABLE keyrings ADD COLUMN current_holder_staff_id INTEGER REFERENCES staff(id)'); } catch (_) {}
  try { db.exec('ALTER TABLE keyrings ADD COLUMN checked_out_date DATETIME'); } catch (_) {}
  try { db.exec('ALTER TABLE keyrings ADD COLUMN checked_out_notes TEXT'); } catch (_) {}

  // Migration: add email column to admin_users if it doesn't exist yet
  try { db.exec('ALTER TABLE admin_users ADD COLUMN email TEXT'); } catch (_) {}

  // Migration: add role_id to admin_users
  try { db.exec('ALTER TABLE admin_users ADD COLUMN role_id INTEGER REFERENCES roles(id)'); } catch (_) {}

  // SOC2: track authentication timestamps on admin_users
  try { db.exec('ALTER TABLE admin_users ADD COLUMN last_login_at DATETIME'); } catch (_) {}
  try { db.exec('ALTER TABLE admin_users ADD COLUMN password_changed_at DATETIME'); } catch (_) {}

  // SOC2: capture origin context on audit events
  try { db.exec('ALTER TABLE audit_log ADD COLUMN ip_address TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE audit_log ADD COLUMN user_agent TEXT'); } catch (_) {}

  // ── Migration 002: SSO / SAML support ─────────────────────────────────────
  try {
    const migrationPath = path.join(__dirname, 'migrations', '002_sso.sql');
    if (fs.existsSync(migrationPath)) {
      // Strip line comments before splitting so a ';' inside a comment can't
      // break statement boundaries.
      const sql = fs.readFileSync(migrationPath, 'utf8')
        .split('\n')
        .map(line => line.replace(/--.*$/, ''))
        .join('\n');
      for (const statement of sql.split(';')) {
        const trimmed = statement.trim();
        if (!trimmed) continue;
        // ALTER TABLE fails if the column already exists — expected, idempotent.
        try { db.exec(trimmed); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[db] SSO migration failed:', e.message);
  }

  // ── Seed default roles ─────────────────────────────────────────────────────
  const systemRoles = [
    { name: 'super_admin', label: 'Super Admin', description: 'Full access to everything. Cannot be modified.', is_system: 1 },
    { name: 'admin',       label: 'Admin',       description: 'Full access except role and plan management.', is_system: 1 },
    { name: 'manager',     label: 'Manager',     description: 'View, create, and edit most records. No delete or admin access.', is_system: 1 },
    { name: 'key_clerk',   label: 'Key Clerk',   description: 'Focused on physical key checkout and transaction operations.', is_system: 1 },
    { name: 'viewer',      label: 'Viewer',       description: 'Read-only access across all modules.', is_system: 1 },
  ];

  const insertRole = db.prepare(`
    INSERT INTO roles (name, label, description, is_system)
    VALUES (@name, @label, @description, @is_system)
    ON CONFLICT(name) DO NOTHING
  `);
  const insertPerm = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)
  `);
  const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');

  for (const role of systemRoles) {
    insertRole.run(role);
    const row = getRoleId.get(role.name);
    if (row) {
      const perms = DEFAULT_ROLE_PERMISSIONS[role.name] || [];
      for (const perm of perms) insertPerm.run(row.id, perm);
    }
  }

  // ── Seed default plan settings (Starter) ──────────────────────────────────
  const defaultPlanSettings = {
    max_admin_users:          '3',
    max_buildings:            '1',
    audit_retention_days:     '30',
    // active flags (what's turned on within the license)
    feature_floor_plans:      '0',
    feature_key_agreements:   '0',
    feature_ring_checkout:    '0',
    feature_csv_import_export:'1',
    feature_email_alerts:     '1',
    feature_priority_support: '0',
    // license flags (what's been purchased — all on by default for existing installs)
    licensed_floor_plans:      '1',
    licensed_key_agreements:   '1',
    licensed_ring_checkout:    '1',
    licensed_csv_import_export:'1',
    licensed_email_alerts:     '1',
    licensed_priority_support: '1',
  };

  const upsertSetting = db.prepare(`
    INSERT INTO plan_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [key, value] of Object.entries(defaultPlanSettings)) {
    upsertSetting.run(key, value);
  }

  // ── Default admin user ─────────────────────────────────────────────────────
  const count = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get();
  if (count.c === 0) {
    const superAdminRole = getRoleId.get('super_admin');
    const hash = bcrypt.hashSync('admin123', 12);
    db.prepare('INSERT INTO admin_users (username, password_hash, role_id) VALUES (?, ?, ?)').run('admin', hash, superAdminRole?.id ?? null);
    console.log('Default admin created: admin / admin123 — CHANGE THIS PASSWORD IMMEDIATELY');
  }

  // Ensure existing admin user (no role assigned) gets super_admin role
  const superAdminRow = getRoleId.get('super_admin');
  if (superAdminRow) {
    db.prepare('UPDATE admin_users SET role_id = ? WHERE role_id IS NULL').run(superAdminRow.id);
  }

  // Encrypt any plaintext credentials left over from before encryption was introduced
  if (process.env.ENCRYPTION_KEY) {
    const { encrypt, isEncrypted } = require('../lib/encrypt');

    const safeRows = db.prepare('SELECT id, combination FROM safes WHERE combination IS NOT NULL').all();
    const updateSafe = db.prepare('UPDATE safes SET combination = ? WHERE id = ?');
    for (const row of safeRows) {
      if (!isEncrypted(row.combination)) updateSafe.run(encrypt(row.combination), row.id);
    }

    const acctRows = db.prepare('SELECT id, account_password FROM system_accounts WHERE account_password IS NOT NULL').all();
    const updateAcct = db.prepare('UPDATE system_accounts SET account_password = ? WHERE id = ?');
    for (const row of acctRows) {
      if (!isEncrypted(row.account_password)) updateAcct.run(encrypt(row.account_password), row.id);
    }
  }
}

function auditLog(action, resourceType, resourceId, resourceName, staffId, staffName, performedBy, notes = null, ip = null, ua = null) {
  db.prepare(`
    INSERT INTO audit_log (action, resource_type, resource_id, resource_name, staff_id, staff_name, performed_by, notes, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(action, resourceType, resourceId, resourceName, staffId, staffName, performedBy, notes, ip, ua);
}

initializeDatabase();

module.exports = { db, auditLog };
