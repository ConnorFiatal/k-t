const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

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
      notes TEXT
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

  // Migration: add email column to admin_users if it doesn't exist yet
  try { db.exec('ALTER TABLE admin_users ADD COLUMN email TEXT'); } catch (_) {}

  const count = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get();
  if (count.c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('Default admin created: admin / admin123 — CHANGE THIS PASSWORD IMMEDIATELY');
  }
}

function auditLog(action, resourceType, resourceId, resourceName, staffId, staffName, performedBy, notes = null) {
  db.prepare(`
    INSERT INTO audit_log (action, resource_type, resource_id, resource_name, staff_id, staff_name, performed_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(action, resourceType, resourceId, resourceName, staffId, staffName, performedBy, notes);
}

initializeDatabase();

module.exports = { db, auditLog };
