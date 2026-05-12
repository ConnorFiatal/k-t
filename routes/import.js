const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { db, auditLog } = require('../db');

// ── Multer: memory storage (we parse the buffer directly) ──────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are accepted'));
    }
  }
});

// ── CSV parse helper ───────────────────────────────────────────────────────
function parseCSV(buffer) {
  return parse(buffer, {
    columns: true,          // first row = header
    skip_empty_lines: true,
    trim: true,
    bom: true               // strip UTF-8 BOM if present
  });
}

// ── GET /import  ─ redirect to static page ─────────────────────────────────
router.get('/', (req, res) => res.redirect('/import.html'));

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE DOWNLOADS
// ══════════════════════════════════════════════════════════════════════════════

const templates = {
  doors:           'name,building,floor,room,description,door_type\nMain Entrance,Building A,Ground,Lobby,Front door,KEYED\n',
  keys:            'key_number,system_name,level,parent_key_number,bitting,keyway,key_blank,notes\nA1,Main System,GMK,,,KW1,,Grand master key\n',
  users:           'first_name,last_name,employee_id,department,title,email,phone,start_date,notes\nJane,Smith,EMP001,Operations,Manager,jane@example.com,555-1234,2024-01-15,\n',
  combinations:    'key_number,system_name,door_name\nA1,Main System,Main Entrance\n',
  'system-accounts': 'account_name,username,password,url,category,notes\nPayroll System,admin,secret123,https://payroll.example.com,HR,Read-only access\n'
};

router.get('/template/:entity', (req, res) => {
  const tpl = templates[req.params.entity];
  if (!tpl) return res.status(404).send('Unknown entity');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-template.csv"`);
  res.send(tpl);
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT: DOORS
// ══════════════════════════════════════════════════════════════════════════════

router.post('/doors', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'No file uploaded' });

  let rows;
  try { rows = parseCSV(req.file.buffer); }
  catch (e) { return res.json({ error: 'CSV parse error: ' + e.message }); }

  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  const ACCESS_TYPES = new Set(['KEYED', 'FOB', 'BOTH']);

  const checkDoor = db.prepare('SELECT id FROM doors WHERE name = ?');
  const stmt = db.prepare(`
    INSERT INTO doors (name, building, floor, location, notes, access_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // account for header row

    const name        = (r.name        || '').trim();
    const access_type = (r.door_type   || 'KEYED').trim().toUpperCase();

    if (!name) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required field 'name'`);
      continue;
    }
    if (!ACCESS_TYPES.has(access_type)) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: door_type must be KEYED, FOB, or BOTH (got '${r.door_type}')`);
      continue;
    }

    try {
      if (checkDoor.get(name)) {
        result.skipped++;
        continue;
      }
      const info = stmt.run(
        name,
        (r.building    || '').trim() || null,
        (r.floor       || '').trim() || null,
        (r.room        || '').trim() || null,
        (r.description || '').trim() || null,
        access_type
      );
      auditLog('CREATE', 'door', info.lastInsertRowid, name, null, null, req.session.user?.username || 'import');
      result.inserted++;
    } catch (e) {
      result.failed++;
      result.errors.push(`Row ${rowNum} ("${name}"): ${e.message}`);
    }
  }

  res.json({ entity: 'Doors', ...result });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT: KEYS
// ══════════════════════════════════════════════════════════════════════════════

router.post('/keys', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'No file uploaded' });

  let rows;
  try { rows = parseCSV(req.file.buffer); }
  catch (e) { return res.json({ error: 'CSV parse error: ' + e.message }); }

  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  const LEVELS = new Set(['GMK', 'MK', 'SUB_MASTER', 'CHANGE']);

  const findOrCreateSystem = db.prepare('SELECT id FROM key_systems WHERE name = ?');
  const createSystem       = db.prepare('INSERT INTO key_systems (name) VALUES (?)');
  const findKey            = db.prepare('SELECT id FROM keys WHERE key_system_id = ? AND key_number = ?');
  const insertKey          = db.prepare(`
    INSERT OR IGNORE INTO keys (key_system_id, key_number, level, parent_key_id, bitting, keyway, key_blank, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    const key_number  = (r.key_number  || '').trim();
    const system_name = (r.system_name || '').trim();
    const level       = (r.level       || 'CHANGE').trim().toUpperCase();

    if (!key_number) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required field 'key_number'`);
      continue;
    }
    if (!system_name) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required field 'system_name'`);
      continue;
    }
    if (!LEVELS.has(level)) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: level must be GMK, MK, SUB_MASTER, or CHANGE (got '${r.level}')`);
      continue;
    }

    try {
      // Resolve or create key system
      let sys = findOrCreateSystem.get(system_name);
      if (!sys) {
        const info = createSystem.run(system_name);
        sys = { id: info.lastInsertRowid };
        auditLog('CREATE', 'key_system', sys.id, system_name, null, null, req.session.user?.username || 'import');
      }

      // Resolve optional parent key
      let parent_key_id = null;
      const parent_num = (r.parent_key_number || '').trim();
      if (parent_num) {
        const parentRow = findKey.get(sys.id, parent_num);
        if (!parentRow) {
          result.failed++;
          result.errors.push(`Row ${rowNum} ("${key_number}"): parent_key_number '${parent_num}' not found in system '${system_name}'`);
          continue;
        }
        parent_key_id = parentRow.id;
      }

      const info = insertKey.run(
        sys.id,
        key_number,
        level,
        parent_key_id,
        (r.bitting    || '').trim() || null,
        (r.keyway     || '').trim() || null,
        (r.key_blank  || '').trim() || null,
        (r.notes      || '').trim() || null
      );

      if (info.changes > 0) {
        auditLog('CREATE', 'key', info.lastInsertRowid, key_number, null, null, req.session.user?.username || 'import');
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`Row ${rowNum} ("${key_number}"): ${e.message}`);
    }
  }

  res.json({ entity: 'Keys', ...result });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT: USERS (staff)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/users', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'No file uploaded' });

  let rows;
  try { rows = parseCSV(req.file.buffer); }
  catch (e) { return res.json({ error: 'CSV parse error: ' + e.message }); }

  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO staff
      (first_name, last_name, employee_id, department, title, email, phone, start_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    const first_name = (r.first_name || '').trim();
    const last_name  = (r.last_name  || '').trim();

    if (!first_name || !last_name) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required fields 'first_name' and/or 'last_name'`);
      continue;
    }

    const employee_id = (r.employee_id || '').trim() || null;

    try {
      // Check for duplicate by employee_id (if provided) or name
      let exists = false;
      if (employee_id) {
        exists = !!db.prepare('SELECT id FROM staff WHERE employee_id = ?').get(employee_id);
      } else {
        exists = !!db.prepare('SELECT id FROM staff WHERE first_name = ? AND last_name = ?').get(first_name, last_name);
      }

      if (exists) {
        result.skipped++;
        continue;
      }

      const info = stmt.run(
        first_name,
        last_name,
        employee_id,
        (r.department || '').trim() || null,
        (r.title      || '').trim() || null,
        (r.email      || '').trim() || null,
        (r.phone      || '').trim() || null,
        (r.start_date || '').trim() || null,
        (r.notes      || '').trim() || null
      );

      if (info.changes > 0) {
        auditLog('CREATE', 'staff', info.lastInsertRowid, `${first_name} ${last_name}`, info.lastInsertRowid, `${first_name} ${last_name}`, req.session.user?.username || 'import');
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`Row ${rowNum} ("${first_name} ${last_name}"): ${e.message}`);
    }
  }

  res.json({ entity: 'Users (Staff)', ...result });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT: COMBINATIONS (key_door_access)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/combinations', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'No file uploaded' });

  let rows;
  try { rows = parseCSV(req.file.buffer); }
  catch (e) { return res.json({ error: 'CSV parse error: ' + e.message }); }

  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  const findKey  = db.prepare('SELECT k.id FROM keys k JOIN key_systems ks ON ks.id = k.key_system_id WHERE k.key_number = ? AND ks.name = ?');
  const findDoor = db.prepare('SELECT id FROM doors WHERE name = ?');
  const stmt     = db.prepare('INSERT OR IGNORE INTO key_door_access (key_id, door_id) VALUES (?, ?)');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    const key_number  = (r.key_number  || '').trim();
    const system_name = (r.system_name || '').trim();
    const door_name   = (r.door_name   || '').trim();

    if (!key_number || !door_name) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required fields 'key_number' and/or 'door_name'`);
      continue;
    }

    try {
      let keyRow;
      if (system_name) {
        keyRow = findKey.get(key_number, system_name);
        if (!keyRow) {
          result.failed++;
          result.errors.push(`Row ${rowNum}: key '${key_number}' in system '${system_name}' not found`);
          continue;
        }
      } else {
        // No system provided — match by key_number alone (first match wins)
        keyRow = db.prepare('SELECT id FROM keys WHERE key_number = ?').get(key_number);
        if (!keyRow) {
          result.failed++;
          result.errors.push(`Row ${rowNum}: key '${key_number}' not found (tip: add system_name column for precision)`);
          continue;
        }
      }

      const doorRow = findDoor.get(door_name);
      if (!doorRow) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: door '${door_name}' not found`);
        continue;
      }

      const info = stmt.run(keyRow.id, doorRow.id);
      if (info.changes > 0) {
        auditLog('GRANT', 'key_door_access', doorRow.id, door_name, null, `Key ${key_number}`, req.session.user?.username || 'import');
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: ${e.message}`);
    }
  }

  res.json({ entity: 'Combinations (Key→Door)', ...result });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT: SYSTEM ACCOUNTS
// ══════════════════════════════════════════════════════════════════════════════

router.post('/system-accounts', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'No file uploaded' });

  let rows;
  try { rows = parseCSV(req.file.buffer); }
  catch (e) { return res.json({ error: 'CSV parse error: ' + e.message }); }

  const result = { inserted: 0, skipped: 0, failed: 0, errors: [] };

  const checkAcct = db.prepare('SELECT id FROM system_accounts WHERE system_name = ? AND account_username = ?');
  const stmt = db.prepare(`
    INSERT INTO system_accounts (system_name, account_username, account_password, url, category, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    const system_name      = (r.account_name || '').trim();
    const account_username = (r.username     || '').trim();

    if (!system_name || !account_username) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: missing required fields 'account_name' and/or 'username'`);
      continue;
    }

    try {
      if (checkAcct.get(system_name, account_username)) {
        result.skipped++;
        continue;
      }
      const info = stmt.run(
        system_name,
        account_username,
        (r.password      || '').trim() || null,
        (r.url           || '').trim() || null,
        (r.access_level  || '').trim() || null,
        (r.notes         || '').trim() || null
      );
      auditLog('CREATE', 'system_account', info.lastInsertRowid, system_name, null, null, req.session.user?.username || 'import');
      result.inserted++;
    } catch (e) {
      result.failed++;
      result.errors.push(`Row ${rowNum} ("${system_name}"): ${e.message}`);
    }
  }

  res.json({ entity: 'System Accounts', ...result });
});

module.exports = router;
