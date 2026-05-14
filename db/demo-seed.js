const bcrypt = require('bcryptjs');
const { db } = require('./index');
const { encrypt } = require('../lib/encrypt');

function seedDemoData() {
  const already = db.prepare("SELECT value FROM plan_settings WHERE key = 'demo_seeded'").get();
  if (already) return;

  console.log('[demo] Seeding demo data...');

  const getRoleId = (name) => db.prepare('SELECT id FROM roles WHERE name = ?').get(name)?.id;
  const superAdminId = getRoleId('super_admin');
  const managerId    = getRoleId('manager');
  const keyClerkId   = getRoleId('key_clerk');
  const viewerId     = getRoleId('viewer');

  // ── Demo admin users (passwords never used — demo auth bypasses login) ──────
  const fakeHash = bcrypt.hashSync('demo-not-used', 4);
  const insertUser = db.prepare('INSERT OR IGNORE INTO admin_users (username, password_hash, role_id) VALUES (?, ?, ?)');
  insertUser.run('demo_admin',   fakeHash, superAdminId);
  insertUser.run('demo_manager', fakeHash, managerId);
  insertUser.run('demo_clerk',   fakeHash, keyClerkId);
  insertUser.run('demo_viewer',  fakeHash, viewerId);

  // ── Staff ─────────────────────────────────────────────────────────────────
  const insertStaff = db.prepare(`
    INSERT INTO staff (first_name, last_name, employee_id, department, title, email, phone, start_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const staffRows = [
    ['Sarah',    'Johnson',   'EMP-001', 'Facilities',     'Facilities Director',        'sjohnson@example.com',   '555-0101', '2019-03-15', 'active'],
    ['Marcus',   'Chen',      'EMP-002', 'IT',             'IT Administrator',           'mchen@example.com',      '555-0102', '2020-06-01', 'active'],
    ['Patricia', 'Williams',  'EMP-003', 'Security',       'Security Manager',           'pwilliams@example.com',  '555-0103', '2018-11-01', 'active'],
    ['David',    'Martinez',  'EMP-004', 'Facilities',     'Maintenance Technician',     'dmartinez@example.com',  '555-0104', '2021-02-20', 'active'],
    ['Jennifer', 'Thompson',  'EMP-005', 'Administration', 'Office Manager',             'jthompson@example.com',  '555-0105', '2017-09-10', 'active'],
    ['Robert',   'Kim',       'EMP-006', 'IT',             'Systems Engineer',           'rkim@example.com',       '555-0106', '2022-01-15', 'active'],
    ['Amanda',   'Foster',    'EMP-007', 'Security',       'Security Officer',           'afoster@example.com',    '555-0107', '2021-07-01', 'active'],
    ['Carlos',   'Rodriguez', 'EMP-008', 'Facilities',     'Maintenance Lead',           'crodriguez@example.com', '555-0108', '2019-05-15', 'active'],
    ['Lisa',     'Anderson',  'EMP-009', 'Administration', 'Administrative Assistant',   'landerson@example.com',  '555-0109', '2023-03-01', 'active'],
    ['Michael',  'Brown',     'EMP-010', 'IT',             'IT Support Specialist',      'mbrown@example.com',     '555-0110', '2020-09-01', 'terminated'],
  ];
  const sid = {};
  for (const row of staffRows) {
    sid[row[2]] = insertStaff.run(...row).lastInsertRowid;
  }

  // ── Key Systems ───────────────────────────────────────────────────────────
  const insertSys = db.prepare('INSERT INTO key_systems (name, description, manufacturer, keyway, notes) VALUES (?, ?, ?, ?, ?)');
  const sys1 = insertSys.run(
    'Corbin-Russwin Grand Master System',
    'Primary building access control system covering all main building entrances and interior spaces',
    'Corbin-Russwin', 'C-K4',
    'Main building locks. Do not duplicate without written authorization from Facilities Director.'
  ).lastInsertRowid;
  const sys2 = insertSys.run(
    'Medeco High Security System',
    'Server room and restricted area access — high-security patented keyway',
    'Medeco', 'M-1',
    'All keys require signed authorization form and background check. Duplicates not available commercially.'
  ).lastInsertRowid;

  // ── Keys ─────────────────────────────────────────────────────────────────
  const ik = db.prepare('INSERT INTO keys (key_system_id, key_number, level, parent_key_id, bitting, notes) VALUES (?, ?, ?, ?, ?, ?)');

  // System 1 hierarchy
  const k1000 = ik.run(sys1, 'K1000', 'GMK',        null,  '12345', 'Grand Master — restricted to Facilities Director').lastInsertRowid;
  const k1100 = ik.run(sys1, 'K1100', 'MK',         k1000, '12340', 'Facilities Master Key').lastInsertRowid;
  const k1110 = ik.run(sys1, 'K1110', 'SUB_MASTER', k1100, '12300', 'South Wing Sub-Master').lastInsertRowid;
  const k1111 = ik.run(sys1, 'K1111', 'CHANGE',     k1110, '12310', 'Conference Room A').lastInsertRowid;
  const k1112 = ik.run(sys1, 'K1112', 'CHANGE',     k1110, '12320', 'Break Room').lastInsertRowid;
  const k1120 = ik.run(sys1, 'K1120', 'SUB_MASTER', k1100, '12400', 'North Wing Sub-Master').lastInsertRowid;
  const k1121 = ik.run(sys1, 'K1121', 'CHANGE',     k1120, '12410', 'Training Room').lastInsertRowid;
  const k1130 = ik.run(sys1, 'K1130', 'SUB_MASTER', k1100, '12500', 'Mechanical Sub-Master').lastInsertRowid;
  const k1131 = ik.run(sys1, 'K1131', 'CHANGE',     k1130, '12510', 'Mechanical Room').lastInsertRowid;
  const k1132 = ik.run(sys1, 'K1132', 'CHANGE',     k1130, '12520', 'Storage Room').lastInsertRowid;
  const k1200 = ik.run(sys1, 'K1200', 'MK',         k1000, '13000', 'Administrative Master Key').lastInsertRowid;
  const k1210 = ik.run(sys1, 'K1210', 'SUB_MASTER', k1200, '13100', 'Admin Suite Sub-Master').lastInsertRowid;
  const k1211 = ik.run(sys1, 'K1211', 'CHANGE',     k1210, '13110', "Director's Office").lastInsertRowid;
  const k1212 = ik.run(sys1, 'K1212', 'CHANGE',     k1210, '13120', 'Records Room').lastInsertRowid;
  const k1300 = ik.run(sys1, 'K1300', 'MK',         k1000, '14000', 'Security Operations Master').lastInsertRowid;
  const k1310 = ik.run(sys1, 'K1310', 'SUB_MASTER', k1300, '14100', 'Security Office Sub-Master').lastInsertRowid;
  const k1311 = ik.run(sys1, 'K1311', 'CHANGE',     k1310, '14110', 'Security Office').lastInsertRowid;
  const k1312 = ik.run(sys1, 'K1312', 'CHANGE',     k1310, '14120', 'Security Vault').lastInsertRowid;

  // System 2 hierarchy
  const k2000 = ik.run(sys2, 'K2000', 'GMK',    null,  '87654', 'Server Room Grand Master — IT Director only').lastInsertRowid;
  const k2100 = ik.run(sys2, 'K2100', 'MK',     k2000, '87600', 'Server Room Master').lastInsertRowid;
  const k2110 = ik.run(sys2, 'K2110', 'CHANGE', k2100, '87610', 'Server Room A').lastInsertRowid;
  const k2111 = ik.run(sys2, 'K2111', 'CHANGE', k2100, '87620', 'Server Room B').lastInsertRowid;
  const k2112 = ik.run(sys2, 'K2112', 'CHANGE', k2100, '87630', 'Network Equipment Room').lastInsertRowid;

  // ── Doors ─────────────────────────────────────────────────────────────────
  const id_ = db.prepare('INSERT INTO doors (name, door_number, location, building, floor, access_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const idk = db.prepare('INSERT OR IGNORE INTO key_door_access (key_id, door_id) VALUES (?, ?)');

  const doors = [
    ['Main Entrance',           'D-001', 'Front lobby',        'Main Building', '1', 'FOB',   'Primary public entrance — card readers on both sides'],
    ['South Entrance',          'D-002', 'South parking lot',  'Main Building', '1', 'FOB',   'Staff entrance — south parking'],
    ['Loading Dock',            'D-003', 'Rear of building',   'Main Building', '1', 'KEYED', 'Delivery access — escort required after 6pm'],
    ['Facilities Office',       'D-004', 'Room 110',           'Main Building', '1', 'KEYED', null],
    ['Conference Room A',       'D-005', 'Room 120',           'Main Building', '1', 'KEYED', 'Seats 12 — reservable via calendar'],
    ['Break Room',              'D-006', 'Room 122',           'Main Building', '1', 'KEYED', null],
    ['Training Room',           'D-007', 'Room 201',           'Main Building', '2', 'KEYED', 'Seats 24 — AV equipment inside'],
    ["Director's Office",       'D-008', 'Room 305',           'Main Building', '3', 'KEYED', null],
    ['Admin Suite',             'D-009', 'Room 300',           'Main Building', '3', 'KEYED', null],
    ['Records Room',            'D-010', 'Room 310',           'Main Building', '3', 'KEYED', 'Fire-rated door — keep closed'],
    ['Server Room A',           'D-011', 'Room B-01',          'Main Building', 'B', 'BOTH',  'Primary compute — biometric + key backup'],
    ['Server Room B',           'D-012', 'Room B-02',          'Main Building', 'B', 'BOTH',  'Storage and backup systems'],
    ['Network Equipment Room',  'D-013', 'Room B-03',          'Main Building', 'B', 'BOTH',  'Core networking gear — do not prop open'],
    ['Mechanical Room',         'D-014', 'Room B-10',          'Main Building', 'B', 'KEYED', 'HVAC and electrical — licensed personnel only'],
    ['Storage Room',            'D-015', 'Room 115',           'Main Building', '1', 'KEYED', 'General supply storage'],
    ['Security Office',         'D-016', 'Room 105',           'Main Building', '1', 'BOTH',  null],
    ['Security Vault',          'D-017', 'Room 106',           'Main Building', '1', 'KEYED', 'Master key storage and lost-property'],
    ['Parking Garage Entrance', 'D-018', 'Garage Level 1',     'Main Building', 'G', 'FOB',   'Barrier arm + FOB reader'],
    ['Rooftop Access',          'D-019', 'Stairwell 3',        'Main Building', 'R', 'KEYED', 'HVAC access — authorized maintenance only'],
  ];
  const did = {};
  for (const row of doors) {
    did[row[1]] = id_.run(...row).lastInsertRowid;
  }

  // Key → door assignments
  idk.run(k1100, did['D-003']); idk.run(k1100, did['D-004']); idk.run(k1100, did['D-014']); idk.run(k1100, did['D-015']); idk.run(k1100, did['D-019']);
  idk.run(k1110, did['D-004']); idk.run(k1110, did['D-014']); idk.run(k1110, did['D-015']);
  idk.run(k1111, did['D-005']);
  idk.run(k1112, did['D-006']);
  idk.run(k1120, did['D-007']); idk.run(k1121, did['D-007']);
  idk.run(k1130, did['D-014']); idk.run(k1130, did['D-015']); idk.run(k1130, did['D-019']);
  idk.run(k1131, did['D-014']); idk.run(k1132, did['D-015']);
  idk.run(k1200, did['D-009']); idk.run(k1200, did['D-008']); idk.run(k1200, did['D-016']);
  idk.run(k1210, did['D-009']); idk.run(k1210, did['D-008']);
  idk.run(k1211, did['D-008']); idk.run(k1212, did['D-010']);
  idk.run(k1300, did['D-016']); idk.run(k1300, did['D-017']);
  idk.run(k1310, did['D-016']); idk.run(k1310, did['D-017']);
  idk.run(k1311, did['D-016']); idk.run(k1312, did['D-017']);
  idk.run(k2100, did['D-011']); idk.run(k2100, did['D-012']); idk.run(k2100, did['D-013']);
  idk.run(k2110, did['D-011']); idk.run(k2111, did['D-012']); idk.run(k2112, did['D-013']);

  // ── FOB Profiles ──────────────────────────────────────────────────────────
  const ifob  = db.prepare('INSERT INTO fob_profiles (name, description, notes) VALUES (?, ?, ?)');
  const ifobd = db.prepare('INSERT OR IGNORE INTO fob_profile_doors (fob_profile_id, door_id) VALUES (?, ?)');

  const fob1 = ifob.run('Standard Employee',    'General staff access to common areas',           'Assigned to all permanent staff on hire').lastInsertRowid;
  const fob2 = ifob.run('IT Staff Access',      'Extended access including server and network rooms', 'Requires IT manager approval').lastInsertRowid;
  const fob3 = ifob.run('Security Personnel',   'Full facility access for security team',          'Includes all monitored areas and emergency exits').lastInsertRowid;

  for (const d of ['D-001','D-002','D-018'])                    ifobd.run(fob1, did[d]);
  for (const d of ['D-001','D-002','D-011','D-012','D-013','D-018']) ifobd.run(fob2, did[d]);
  for (const d of ['D-001','D-002','D-016','D-017','D-018'])    ifobd.run(fob3, did[d]);

  // ── Keyrings ─────────────────────────────────────────────────────────────
  const iR  = db.prepare('INSERT INTO keyrings (ring_number, description, location, notes) VALUES (?, ?, ?, ?)');
  const iRk = db.prepare('INSERT OR IGNORE INTO keyring_keys (keyring_id, key_id) VALUES (?, ?)');
  const iRf = db.prepare('INSERT OR IGNORE INTO keyring_fob_profiles (keyring_id, fob_profile_id) VALUES (?, ?)');
  const iRa = db.prepare('INSERT OR IGNORE INTO keyring_authorizations (keyring_id, staff_id, granted_by) VALUES (?, ?, ?)');

  const ring1 = iR.run('FM-01',    'Facilities Master Ring',  'Facilities Office cabinet',  'Primary ring — sign-out logbook required').lastInsertRowid;
  const ring2 = iR.run('IT-01',    'IT Operations Ring',      'IT Department key box',       'Server room access ring — must return same day').lastInsertRowid;
  const ring3 = iR.run('SEC-01',   'Security Operations Ring','Security Office key cabinet', 'Security staff operational ring').lastInsertRowid;
  const ring4 = iR.run('MAINT-01', 'Maintenance Ring',        'Facilities Office cabinet',  'General maintenance access').lastInsertRowid;
  const ring5 = iR.run('ADM-01',   'Admin Suite Ring',        'Admin Office',                'Administrative area access').lastInsertRowid;

  iRk.run(ring1, k1000); iRk.run(ring1, k1100); iRk.run(ring1, k1110); iRk.run(ring1, k1120); iRk.run(ring1, k1130);
  iRk.run(ring2, k2000); iRk.run(ring2, k2100); iRk.run(ring2, k2110); iRk.run(ring2, k2111); iRk.run(ring2, k2112);
  iRk.run(ring3, k1300); iRk.run(ring3, k1310); iRk.run(ring3, k1311); iRk.run(ring3, k1312);
  iRk.run(ring4, k1110); iRk.run(ring4, k1120); iRk.run(ring4, k1130); iRk.run(ring4, k1131); iRk.run(ring4, k1132);
  iRk.run(ring5, k1210); iRk.run(ring5, k1211); iRk.run(ring5, k1212);

  iRf.run(ring1, fob1); iRf.run(ring2, fob2); iRf.run(ring3, fob3);

  iRa.run(ring1, sid['EMP-001'], 'admin'); iRa.run(ring1, sid['EMP-004'], 'admin'); iRa.run(ring1, sid['EMP-008'], 'admin');
  iRa.run(ring2, sid['EMP-002'], 'admin'); iRa.run(ring2, sid['EMP-006'], 'admin');
  iRa.run(ring3, sid['EMP-003'], 'admin'); iRa.run(ring3, sid['EMP-007'], 'admin');
  iRa.run(ring4, sid['EMP-004'], 'admin'); iRa.run(ring4, sid['EMP-008'], 'admin');
  iRa.run(ring5, sid['EMP-005'], 'admin'); iRa.run(ring5, sid['EMP-009'], 'admin');

  // Ring SEC-01 is currently checked out to Patricia
  db.prepare('UPDATE keyrings SET current_holder_staff_id=?, checked_out_date=?, checked_out_notes=? WHERE id=?')
    .run(sid['EMP-003'], '2026-05-12 08:00:00', 'Routine overnight security patrol coverage', ring3);

  // ── Physical Keys ─────────────────────────────────────────────────────────
  const ipk  = db.prepare('INSERT INTO physical_keys (stamp_number, key_type_id, status, notes, expiry_date) VALUES (?, ?, ?, ?, ?)');
  const itx  = db.prepare('INSERT INTO key_transactions (physical_key_id, transaction_type, transaction_date, performed_by, assigned_to_staff_id, notes) VALUES (?, ?, ?, ?, ?, ?)');
  const icl  = db.prepare('INSERT INTO key_custody_log (physical_key_id, from_staff_id, to_staff_id, transferred_date, performed_by, transaction_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const mk = (stamp, typeId, status, notes, expiry = null) => ipk.run(stamp, typeId, status, notes, expiry).lastInsertRowid;

  // Grand Master
  const pk_gm1 = mk('GMK-001', k1000, 'active', 'Original — authorized for Facilities Director');
  itx.run(pk_gm1, 'issue_from_locksmith', '2022-01-10', 'admin', null, 'Received from Corbin-Russwin dealer');
  itx.run(pk_gm1, 'issue_to_staff', '2022-01-15', 'admin', sid['EMP-001'], 'Issued to Facilities Director');
  icl.run(pk_gm1, null, sid['EMP-001'], '2022-01-15', 'admin', 'issue_to_staff', null);

  // Facilities Master copies
  const pk_fm1 = mk('FM-001', k1100, 'active', 'Assigned to ring FM-01');
  itx.run(pk_fm1, 'issue_from_locksmith', '2022-01-15', 'admin', null, 'Received from locksmith');
  const pk_fm2 = mk('FM-002', k1100, 'active', 'Spare — stored in Facilities safe');
  itx.run(pk_fm2, 'issue_from_locksmith', '2022-01-15', 'admin', null, 'Spare copy received');

  // South Wing Sub-Master — issued to David
  const pk_sw1 = mk('SW-001', k1110, 'active', null);
  itx.run(pk_sw1, 'issue_from_locksmith', '2022-02-01', 'admin', null, null);
  itx.run(pk_sw1, 'issue_to_staff', '2022-02-10', 'admin', sid['EMP-004'], 'Issued to Maintenance Technician');
  icl.run(pk_sw1, null, sid['EMP-004'], '2022-02-10', 'admin', 'issue_to_staff', null);

  const pk_sw2 = mk('SW-002', k1110, 'active', null);
  itx.run(pk_sw2, 'issue_from_locksmith', '2022-02-01', 'admin', null, null);
  itx.run(pk_sw2, 'issue_to_staff', '2023-01-10', 'admin', sid['EMP-008'], 'Issued to Maintenance Lead');
  icl.run(pk_sw2, null, sid['EMP-008'], '2023-01-10', 'admin', 'issue_to_staff', null);
  itx.run(pk_sw2, 'return', '2024-03-01', 'admin', null, 'Returned during annual key audit');
  icl.run(pk_sw2, sid['EMP-008'], null, '2024-03-01', 'admin', 'return', 'Returned during annual audit');

  // Conference Room A
  const pk_cra1 = mk('CRA-001', k1111, 'active', null);
  itx.run(pk_cra1, 'issue_from_locksmith', '2022-02-01', 'admin', null, null);
  const pk_cra2 = mk('CRA-002', k1111, 'active', null);
  itx.run(pk_cra2, 'issue_from_locksmith', '2022-02-01', 'admin', null, null);
  itx.run(pk_cra2, 'issue_to_staff', '2023-06-01', 'admin', sid['EMP-005'], 'Issued to Office Manager');
  icl.run(pk_cra2, null, sid['EMP-005'], '2023-06-01', 'admin', 'issue_to_staff', null);

  // Break Room
  const pk_br1 = mk('BR-001', k1112, 'active', null);
  itx.run(pk_br1, 'issue_from_locksmith', '2022-02-01', 'admin', null, null);

  // Training Room — expires end of year
  const pk_tr1 = mk('TR-001', k1121, 'active', 'Temporary — annual renewal required', '2026-12-31');
  itx.run(pk_tr1, 'issue_from_locksmith', '2023-01-01', 'admin', null, null);

  // Admin Master — issued to Patricia
  const pk_am1 = mk('AM-001', k1200, 'active', null);
  itx.run(pk_am1, 'issue_from_locksmith', '2022-01-15', 'admin', null, null);
  itx.run(pk_am1, 'issue_to_staff', '2022-01-20', 'admin', sid['EMP-003'], 'Issued to Security Manager');
  icl.run(pk_am1, null, sid['EMP-003'], '2022-01-20', 'admin', 'issue_to_staff', null);

  // Director's Office — issued to Jennifer
  const pk_do1 = mk('DO-001', k1211, 'active', "Director's office key");
  itx.run(pk_do1, 'issue_from_locksmith', '2022-01-15', 'admin', null, null);
  itx.run(pk_do1, 'issue_to_staff', '2022-01-20', 'admin', sid['EMP-005'], 'Issued to Office Manager for after-hours access');
  icl.run(pk_do1, null, sid['EMP-005'], '2022-01-20', 'admin', 'issue_to_staff', null);

  // Records Room — one active, one lost
  const pk_rr1 = mk('RR-001', k1212, 'active', null);
  itx.run(pk_rr1, 'issue_from_locksmith', '2022-01-15', 'admin', null, null);
  const pk_rr2 = mk('RR-002', k1212, 'lost', 'Reported lost by Michael Brown upon termination');
  itx.run(pk_rr2, 'issue_from_locksmith', '2022-01-15', 'admin', null, null);
  itx.run(pk_rr2, 'issue_to_staff', '2022-03-01', 'admin', sid['EMP-010'], 'Issued to IT Support');
  icl.run(pk_rr2, null, sid['EMP-010'], '2022-03-01', 'admin', 'issue_to_staff', null);
  itx.run(pk_rr2, 'lost', '2024-01-15', 'admin', null, 'Reported lost upon employment termination — lock change recommended');

  // Security Operations Master — issued to Amanda
  const pk_sec1 = mk('SEC-001', k1300, 'active', null);
  itx.run(pk_sec1, 'issue_from_locksmith', '2022-01-15', 'admin', null, null);
  itx.run(pk_sec1, 'issue_to_staff', '2022-01-22', 'admin', sid['EMP-007'], 'Issued to Security Officer');
  icl.run(pk_sec1, null, sid['EMP-007'], '2022-01-22', 'admin', 'issue_to_staff', null);

  // Server Room GMK — issued to Marcus
  const pk_sr_gm = mk('SR-GMK-001', k2000, 'active', 'Medeco GMK — held by IT Administrator');
  itx.run(pk_sr_gm, 'issue_from_locksmith', '2021-11-01', 'admin', null, 'Received from Medeco authorized dealer');
  itx.run(pk_sr_gm, 'issue_to_staff', '2021-11-05', 'admin', sid['EMP-002'], 'Issued to IT Administrator');
  icl.run(pk_sr_gm, null, sid['EMP-002'], '2021-11-05', 'admin', 'issue_to_staff', null);

  const pk_sra = mk('SR-A-001', k2110, 'active', 'Server Room A — spare key in IT safe');
  itx.run(pk_sra, 'issue_from_locksmith', '2021-11-01', 'admin', null, null);
  const pk_srb = mk('SR-B-001', k2111, 'active', 'Server Room B');
  itx.run(pk_srb, 'issue_from_locksmith', '2021-11-01', 'admin', null, null);
  const pk_net = mk('NET-001', k2112, 'active', 'Network Room key');
  itx.run(pk_net, 'issue_from_locksmith', '2021-11-01', 'admin', null, null);
  itx.run(pk_net, 'issue_to_staff', '2023-04-01', 'admin', sid['EMP-006'], 'Issued to Systems Engineer');
  icl.run(pk_net, null, sid['EMP-006'], '2023-04-01', 'admin', 'issue_to_staff', null);

  // Destroyed key
  const pk_old = mk('FM-000', k1100, 'destroyed', 'Old copy — superseded');
  itx.run(pk_old, 'issue_from_locksmith', '2018-06-01', 'admin', null, 'Original facilities master from previous locksmith');
  itx.run(pk_old, 'destroy', '2022-01-14', 'admin', null, 'Destroyed during key system upgrade — replaced with FM-001/FM-002');

  // ── Key Agreements ────────────────────────────────────────────────────────
  const iag = db.prepare(`
    INSERT INTO key_agreements
      (physical_key_id, staff_id, issued_date, expiry_date, acknowledgment_text)
    VALUES (?, ?, ?, ?, ?)
  `);
  const agreementText = 'I acknowledge receipt of the above key and accept responsibility for its safekeeping. I understand that this key must not be duplicated or transferred without written authorization. I agree to report any loss immediately and to return this key upon request or upon ending my employment.';

  iag.run(pk_sw1,   sid['EMP-004'], '2022-02-10', null,         agreementText);
  iag.run(pk_cra2,  sid['EMP-005'], '2023-06-01', null,         agreementText);
  iag.run(pk_do1,   sid['EMP-005'], '2022-01-20', null,         agreementText);
  iag.run(pk_am1,   sid['EMP-003'], '2022-01-20', null,         agreementText);
  iag.run(pk_sr_gm, sid['EMP-002'], '2021-11-05', null,         agreementText);
  iag.run(pk_net,   sid['EMP-006'], '2023-04-01', '2026-03-31', agreementText);
  // Returned agreement
  db.prepare(`
    INSERT INTO key_agreements
      (physical_key_id, staff_id, issued_date, returned_date, acknowledgment_text)
    VALUES (?, ?, ?, ?, ?)
  `).run(pk_rr2, sid['EMP-010'], '2022-03-01', '2024-01-15', agreementText);

  // ── Safes ─────────────────────────────────────────────────────────────────
  const isf = db.prepare('INSERT INTO safes (name, location, combination, notes) VALUES (?, ?, ?, ?)');
  const isa = db.prepare('INSERT OR IGNORE INTO safe_access (safe_id, staff_id, granted_by) VALUES (?, ?, ?)');

  const safe1 = isf.run("Director's Office Safe",  'Room 305',  encrypt('47-23-09'), 'Document safe — quarterly rotation required').lastInsertRowid;
  const safe2 = isf.run('IT Department Safe',       'Room B-05', encrypt('92-67-31'), 'Stores server room credentials and spare access cards').lastInsertRowid;
  const safe3 = isf.run('Security Vault Safe',      'Room 106',  encrypt('15-88-42'), 'Master key storage and emergency access documents').lastInsertRowid;
  const safe4 = isf.run('Petty Cash Safe',          'Room 300',  encrypt('63-11-77'), 'Petty cash fund — reconcile weekly').lastInsertRowid;

  isa.run(safe1, sid['EMP-003'], 'admin'); isa.run(safe1, sid['EMP-005'], 'admin');
  isa.run(safe2, sid['EMP-002'], 'admin'); isa.run(safe2, sid['EMP-006'], 'admin');
  isa.run(safe3, sid['EMP-003'], 'admin'); isa.run(safe3, sid['EMP-007'], 'admin');
  isa.run(safe4, sid['EMP-005'], 'admin'); isa.run(safe4, sid['EMP-009'], 'admin');

  // ── System Accounts ───────────────────────────────────────────────────────
  const iact = db.prepare('INSERT INTO system_accounts (system_name, account_username, account_password, url, category, notes) VALUES (?, ?, ?, ?, ?, ?)');
  const iacc = db.prepare('INSERT OR IGNORE INTO system_account_access (account_id, staff_id, granted_by) VALUES (?, ?, ?)');

  const acct1 = iact.run('Building Management System', 'bms_admin',     encrypt('Bms@2024!Secure'),   'http://bms.internal:8080',   'Facilities', 'Siemens Desigo CC — HVAC, lighting, and building automation. Contact vendor for API docs.').lastInsertRowid;
  const acct2 = iact.run('IP Camera System',           'cctv_admin',    encrypt('Cctv#Secure2024'),   'http://cctv.internal',       'Security',   'Milestone XProtect — 64 cameras across 3 buildings. Retention: 30 days.').lastInsertRowid;
  const acct3 = iact.run('Access Control System',      'acs_admin',     encrypt('Acs!Admin2024'),     'http://acs.internal:9000',   'Security',   'Lenel OnGuard — FOB programming and access group management.').lastInsertRowid;
  const acct4 = iact.run('Network Infrastructure',     'netadmin',      encrypt('Net!w0rk@Secure'),   'http://switch.internal',     'IT',         'Cisco IOS — core switches, router, and firewall management console.').lastInsertRowid;
  const acct5 = iact.run('Visitor Management System',  'visitor_admin', encrypt('Visitor@2024Sys'),   'http://visitor.internal',   'Administration', 'Envoy — visitor pre-registration, badge printing, and NDA capture.').lastInsertRowid;
  const acct6 = iact.run('Backup & DR Console',        'backup_admin',  encrypt('Backup#DR2024!'),    'https://backup.internal',   'IT',         'Veeam Backup — daily VM snapshots and offsite replication status.').lastInsertRowid;

  iacc.run(acct1, sid['EMP-001'], 'admin'); iacc.run(acct1, sid['EMP-004'], 'admin');
  iacc.run(acct2, sid['EMP-003'], 'admin'); iacc.run(acct2, sid['EMP-007'], 'admin');
  iacc.run(acct3, sid['EMP-003'], 'admin'); iacc.run(acct3, sid['EMP-007'], 'admin');
  iacc.run(acct4, sid['EMP-002'], 'admin'); iacc.run(acct4, sid['EMP-006'], 'admin');
  iacc.run(acct5, sid['EMP-005'], 'admin'); iacc.run(acct5, sid['EMP-009'], 'admin');
  iacc.run(acct6, sid['EMP-002'], 'admin'); iacc.run(acct6, sid['EMP-006'], 'admin');

  // ── Audit Log ─────────────────────────────────────────────────────────────
  const ial = db.prepare(`
    INSERT INTO audit_log
      (action, resource_type, resource_id, resource_name, staff_id, staff_name, performed_by, performed_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const al = (action, rt, rid, rn, si, sn, by, at, notes = null) =>
    ial.run(action, rt, rid, rn, si, sn, by, at, notes);

  // System setup
  al('CREATE','KEY_SYSTEM',sys1,'Corbin-Russwin Grand Master System',null,null,'admin','2022-01-10 09:00:00');
  al('CREATE','KEY_SYSTEM',sys2,'Medeco High Security System',null,null,'admin','2022-01-10 09:10:00');
  al('CREATE','KEY',k1000,'K1000',null,null,'admin','2022-01-10 09:20:00');
  al('CREATE','KEY',k1100,'K1100',null,null,'admin','2022-01-10 09:25:00');
  al('CREATE','KEY',k1200,'K1200',null,null,'admin','2022-01-10 09:30:00');
  al('CREATE','KEY',k2000,'K2000',null,null,'admin','2022-01-10 09:35:00');

  // Staff creation
  al('CREATE','STAFF',sid['EMP-001'],'Sarah Johnson',   null,null,'admin','2022-01-15 10:00:00');
  al('CREATE','STAFF',sid['EMP-002'],'Marcus Chen',     null,null,'admin','2022-01-15 10:05:00');
  al('CREATE','STAFF',sid['EMP-003'],'Patricia Williams',null,null,'admin','2022-01-15 10:10:00');
  al('CREATE','STAFF',sid['EMP-004'],'David Martinez',  null,null,'admin','2022-01-15 10:15:00');
  al('CREATE','STAFF',sid['EMP-005'],'Jennifer Thompson',null,null,'admin','2022-01-15 10:20:00');
  al('CREATE','STAFF',sid['EMP-006'],'Robert Kim',      null,null,'admin','2022-06-01 09:00:00');
  al('CREATE','STAFF',sid['EMP-007'],'Amanda Foster',   null,null,'admin','2022-07-01 09:00:00');
  al('CREATE','STAFF',sid['EMP-008'],'Carlos Rodriguez',null,null,'admin','2022-01-15 10:25:00');

  // Key issuances
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_gm1,'GMK-001',sid['EMP-001'],'Sarah Johnson','admin','2022-01-15 11:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_am1,'AM-001', sid['EMP-003'],'Patricia Williams','admin','2022-01-20 09:30:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_do1,'DO-001', sid['EMP-005'],'Jennifer Thompson','admin','2022-01-20 09:35:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_sr_gm,'SR-GMK-001',sid['EMP-002'],'Marcus Chen','admin','2021-11-05 08:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_sw1,'SW-001', sid['EMP-004'],'David Martinez','admin','2022-02-10 11:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_cra2,'CRA-002',sid['EMP-005'],'Jennifer Thompson','admin','2023-06-01 14:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_net,'NET-001',sid['EMP-006'],'Robert Kim','admin','2023-04-01 09:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_sec1,'SEC-001',sid['EMP-007'],'Amanda Foster','admin','2022-01-22 10:00:00');

  // Access grants
  al('GRANT_SAFE_ACCESS','SAFE',safe1,"Director's Office Safe",sid['EMP-003'],'Patricia Williams','admin','2022-02-01 14:00:00');
  al('GRANT_SAFE_ACCESS','SAFE',safe1,"Director's Office Safe",sid['EMP-005'],'Jennifer Thompson','admin','2022-02-01 14:05:00');
  al('GRANT_SAFE_ACCESS','SAFE',safe2,'IT Department Safe',sid['EMP-002'],'Marcus Chen','admin','2022-02-01 14:10:00');
  al('GRANT_SAFE_ACCESS','SAFE',safe3,'Security Vault Safe',sid['EMP-003'],'Patricia Williams','admin','2022-02-01 14:15:00');
  al('GRANT_KEYRING_AUTH','KEYRING',ring1,'FM-01',sid['EMP-001'],'Sarah Johnson','admin','2022-02-01 15:00:00');
  al('GRANT_KEYRING_AUTH','KEYRING',ring2,'IT-01',sid['EMP-002'],'Marcus Chen','admin','2022-02-01 15:05:00');
  al('GRANT_KEYRING_AUTH','KEYRING',ring3,'SEC-01',sid['EMP-003'],'Patricia Williams','admin','2022-02-01 15:10:00');
  al('GRANT_ACCOUNT_ACCESS','SYSTEM_ACCOUNT',acct2,'IP Camera System',sid['EMP-003'],'Patricia Williams','admin','2022-03-01 15:00:00');
  al('GRANT_ACCOUNT_ACCESS','SYSTEM_ACCOUNT',acct4,'Network Infrastructure',sid['EMP-002'],'Marcus Chen','admin','2022-03-01 15:05:00');
  al('GRANT_KEYRING_AUTH','KEYRING',ring2,'IT-01',sid['EMP-006'],'Robert Kim','admin','2022-06-01 09:30:00');

  // Operations over time
  al('VIEW_SECRET','SYSTEM_ACCOUNT',acct1,'Building Management System',null,null,'demo_manager','2024-09-12 09:15:00','Password viewed');
  al('VIEW_SECRET','SYSTEM_ACCOUNT',acct3,'Access Control System',null,null,'demo_admin','2024-10-01 10:22:00','Password viewed');
  al('UPDATE','SYSTEM_ACCOUNT',acct2,'IP Camera System',null,null,'demo_admin','2024-10-01 10:30:00','Quarterly password rotation');
  al('KEY_RETURNED','PHYSICAL_KEY',pk_sw2,'SW-002',sid['EMP-008'],'Carlos Rodriguez','admin','2024-03-01 14:00:00','Returned during annual key audit');
  al('RING_CHECKOUT','KEYRING',ring3,'SEC-01',sid['EMP-003'],'Patricia Williams','demo_admin','2024-11-15 07:45:00','Checked out for night patrol');
  al('RING_CHECKIN','KEYRING',ring3,'SEC-01',sid['EMP-003'],'Patricia Williams','demo_admin','2024-11-15 16:30:00','Returned after patrol');

  // Termination workflow
  al('CREATE','STAFF',sid['EMP-010'],'Michael Brown',null,null,'admin','2020-09-01 09:00:00');
  al('KEY_ISSUED_TO_STAFF','PHYSICAL_KEY',pk_rr2,'RR-002',sid['EMP-010'],'Michael Brown','admin','2022-03-01 10:00:00');
  al('KEY_LOST','PHYSICAL_KEY',pk_rr2,'RR-002',sid['EMP-010'],'Michael Brown','admin','2024-01-15 16:00:00','Reported lost upon termination');
  al('TERMINATE','STAFF',sid['EMP-010'],'Michael Brown',null,null,'admin','2024-01-15 16:30:00','Employment terminated — all access revoked');

  // Recent logins
  al('LOGIN','AUTH',null,'demo_admin',null,null,'demo_admin','2026-05-14 08:00:00');
  al('LOGIN','AUTH',null,'demo_manager',null,null,'demo_manager','2026-05-14 08:30:00');
  al('VIEW_SECRET','SYSTEM_ACCOUNT',acct2,'IP Camera System',null,null,'demo_manager','2026-05-14 08:45:00','Password viewed');
  al('RING_CHECKOUT','KEYRING',ring3,'SEC-01',sid['EMP-003'],'Patricia Williams','demo_admin','2026-05-12 08:00:00','Routine overnight security patrol coverage');

  // ── Enable all plan features for demo ─────────────────────────────────────
  db.prepare("UPDATE plan_settings SET value='1' WHERE key LIKE 'feature_%'").run();
  db.prepare("UPDATE plan_settings SET value='1' WHERE key LIKE 'licensed_%'").run();
  db.prepare("UPDATE plan_settings SET value='99' WHERE key='max_admin_users'").run();
  db.prepare("UPDATE plan_settings SET value='5'  WHERE key='max_buildings'").run();
  db.prepare("UPDATE plan_settings SET value='365' WHERE key='audit_retention_days'").run();

  // Mark seeded
  db.prepare("INSERT INTO plan_settings (key, value) VALUES ('demo_seeded','1') ON CONFLICT(key) DO NOTHING").run();

  console.log('[demo] Demo data seeded: 10 staff, 2 key systems, 22 keys, 19 doors, 5 keyrings, 19 physical keys, 4 safes, 6 system accounts.');
}

module.exports = { seedDemoData };
