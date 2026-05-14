const PERMISSION_GROUPS = [
  {
    label: 'Staff',
    permissions: [
      { key: 'staff.view',   label: 'View staff directory' },
      { key: 'staff.create', label: 'Add new staff' },
      { key: 'staff.edit',   label: 'Edit staff records' },
      { key: 'staff.delete', label: 'Delete / terminate staff' },
    ],
  },
  {
    label: 'Key Systems',
    permissions: [
      { key: 'key_systems.view',   label: 'View key systems' },
      { key: 'key_systems.create', label: 'Add key systems' },
      { key: 'key_systems.edit',   label: 'Edit key systems' },
      { key: 'key_systems.delete', label: 'Delete key systems' },
    ],
  },
  {
    label: 'Keys',
    permissions: [
      { key: 'keys.view',   label: 'View keys' },
      { key: 'keys.create', label: 'Add keys' },
      { key: 'keys.edit',   label: 'Edit keys' },
      { key: 'keys.delete', label: 'Delete keys' },
    ],
  },
  {
    label: 'Physical Key Copies',
    permissions: [
      { key: 'physical_keys.view',   label: 'View physical key copies' },
      { key: 'physical_keys.create', label: 'Add physical key copies' },
      { key: 'physical_keys.edit',   label: 'Edit physical key records' },
      { key: 'physical_keys.delete', label: 'Delete physical key records' },
    ],
  },
  {
    label: 'Key Transactions',
    permissions: [
      { key: 'key_transactions.view',   label: 'View transaction history' },
      { key: 'key_transactions.create', label: 'Create transactions (check in / out)' },
    ],
  },
  {
    label: 'Key Agreements',
    permissions: [
      { key: 'key_agreements.view',   label: 'View key agreements' },
      { key: 'key_agreements.create', label: 'Create key agreements' },
      { key: 'key_agreements.delete', label: 'Delete key agreements' },
    ],
  },
  {
    label: 'Doors & Access Points',
    permissions: [
      { key: 'doors.view',   label: 'View doors' },
      { key: 'doors.create', label: 'Add doors' },
      { key: 'doors.edit',   label: 'Edit door records' },
      { key: 'doors.delete', label: 'Delete doors' },
    ],
  },
  {
    label: 'FOB Profiles',
    permissions: [
      { key: 'fob_profiles.view',   label: 'View fob profiles' },
      { key: 'fob_profiles.create', label: 'Create fob profiles' },
      { key: 'fob_profiles.edit',   label: 'Edit fob profiles' },
      { key: 'fob_profiles.delete', label: 'Delete fob profiles' },
    ],
  },
  {
    label: 'KeyTrak Keyrings',
    permissions: [
      { key: 'keyrings.view',     label: 'View keyrings' },
      { key: 'keyrings.create',   label: 'Create keyrings' },
      { key: 'keyrings.edit',     label: 'Edit keyring records' },
      { key: 'keyrings.delete',   label: 'Delete keyrings' },
      { key: 'keyrings.checkout', label: 'Check in / out keyrings' },
    ],
  },
  {
    label: 'Ring Checkout',
    permissions: [
      { key: 'ring_checkout.view',    label: 'View ring checkout records' },
      { key: 'ring_checkout.operate', label: 'Perform ring check-in / check-out' },
    ],
  },
  {
    label: 'Safes',
    permissions: [
      { key: 'safes.view',   label: 'View safes and combinations' },
      { key: 'safes.create', label: 'Add safes' },
      { key: 'safes.edit',   label: 'Edit safe records' },
      { key: 'safes.delete', label: 'Delete safes' },
    ],
  },
  {
    label: 'System Accounts',
    permissions: [
      { key: 'system_accounts.view',          label: 'View system accounts (passwords masked)' },
      { key: 'system_accounts.view_passwords', label: 'Reveal system account passwords' },
      { key: 'system_accounts.create',         label: 'Add system accounts' },
      { key: 'system_accounts.edit',           label: 'Edit system accounts' },
      { key: 'system_accounts.delete',         label: 'Delete system accounts' },
    ],
  },
  {
    label: 'Floor Plans',
    permissions: [
      { key: 'floor_plans.view',   label: 'View floor plans' },
      { key: 'floor_plans.create', label: 'Upload floor plans' },
      { key: 'floor_plans.edit',   label: 'Edit floor plan door placements' },
      { key: 'floor_plans.delete', label: 'Delete floor plans' },
    ],
  },
  {
    label: 'Reports',
    permissions: [
      { key: 'reports.view', label: 'View and generate reports' },
    ],
  },
  {
    label: 'Audit Log',
    permissions: [
      { key: 'audit.view', label: 'View audit log' },
    ],
  },
  {
    label: 'Data Import / Export',
    permissions: [
      { key: 'data.import', label: 'Import data from CSV' },
      { key: 'data.export', label: 'Export data to CSV' },
    ],
  },
  {
    label: 'Administration',
    permissions: [
      { key: 'admin.users', label: 'Manage admin user accounts' },
      { key: 'admin.roles', label: 'Manage roles and permissions' },
      { key: 'admin.plan',  label: 'View and configure plan settings' },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

// Built-in role permission sets
const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,

  admin: ALL_PERMISSIONS.filter(p => !['admin.roles', 'admin.plan'].includes(p)),

  manager: [
    'staff.view', 'staff.create', 'staff.edit', 'staff.delete',
    'key_systems.view',
    'keys.view', 'keys.create', 'keys.edit',
    'physical_keys.view', 'physical_keys.create', 'physical_keys.edit',
    'key_transactions.view', 'key_transactions.create',
    'key_agreements.view', 'key_agreements.create',
    'doors.view', 'doors.create', 'doors.edit',
    'fob_profiles.view', 'fob_profiles.create', 'fob_profiles.edit',
    'keyrings.view', 'keyrings.create', 'keyrings.edit', 'keyrings.checkout',
    'ring_checkout.view', 'ring_checkout.operate',
    'safes.view',
    'system_accounts.view',
    'floor_plans.view',
    'reports.view',
    'audit.view',
    'data.export',
  ],

  key_clerk: [
    'staff.view',
    'key_systems.view',
    'keys.view',
    'physical_keys.view', 'physical_keys.create', 'physical_keys.edit',
    'key_transactions.view', 'key_transactions.create',
    'key_agreements.view', 'key_agreements.create',
    'doors.view',
    'keyrings.view', 'keyrings.checkout',
    'ring_checkout.view', 'ring_checkout.operate',
  ],

  viewer: [
    'staff.view',
    'key_systems.view',
    'keys.view',
    'physical_keys.view',
    'key_transactions.view',
    'key_agreements.view',
    'doors.view',
    'fob_profiles.view',
    'keyrings.view',
    'ring_checkout.view',
    'safes.view',
    'system_accounts.view',
    'floor_plans.view',
    'reports.view',
    'audit.view',
  ],
};

module.exports = { PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS };
