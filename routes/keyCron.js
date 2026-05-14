/**
 * routes/keyCron.js
 * Nightly cron job that checks for expired physical key copies
 * and logs warnings / sends email notifications.
 * Call setupKeyCron() once at server startup.
 */
const cron = require('node-cron');
const { db } = require('../db');

let sendEmail;
try {
  sendEmail = require('./email').sendEmail;
} catch (_) {
  sendEmail = null;
}

function setupKeyCron() {
  // Run daily at 06:00 server local time
  cron.schedule('0 6 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[keycron] ${new Date().toISOString()} — checking for expired/expiring key copies`);

    // ── Overdue (past expiry, still active) ───────────────────────────────
    const overdue = db.prepare(`
      SELECT pk.id, pk.stamp_number, pk.expiry_date,
             k.key_number, ks.name AS system_name,
             s.id AS staff_id, s.first_name, s.last_name, s.email
      FROM physical_keys pk
      JOIN keys k ON k.id = pk.key_type_id
      JOIN key_systems ks ON ks.id = k.key_system_id
      LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
      LEFT JOIN staff s ON s.id = ka.staff_id
      WHERE pk.status = 'active'
        AND pk.expiry_date IS NOT NULL
        AND pk.expiry_date < ?
    `).all(today);

    if (overdue.length > 0) {
      console.warn(`[keycron] ⚠  ${overdue.length} OVERDUE key copy/copies:`);
      for (const key of overdue) {
        const holder = key.first_name ? `— held by ${key.first_name} ${key.last_name}` : '— no current holder';
        console.warn(`[keycron]   • ${key.stamp_number} (${key.key_number} / ${key.system_name}) expired ${key.expiry_date} ${holder}`);

        if (sendEmail && key.email) {
          await sendEmail(
            key.email,
            `[KeyDog] Key Return Overdue — ${key.stamp_number}`,
            'key-expiry',
            {
              staffName:  `${key.first_name} ${key.last_name}`,
              stampNumber: key.stamp_number,
              keyNumber:  key.key_number,
              systemName: key.system_name,
              expiryDate: key.expiry_date,
              appUrl:     process.env.APP_URL || 'http://localhost:3000',
            }
          ).catch(err => console.error(`[keycron] Email failed for ${key.email}:`, err.message));
        }
      }
    } else {
      console.log('[keycron] No overdue key copies found.');
    }

    // ── Expiring within 7 days ────────────────────────────────────────────
    const expiringSoon = db.prepare(`
      SELECT pk.stamp_number, pk.expiry_date,
             k.key_number, ks.name AS system_name,
             s.first_name, s.last_name
      FROM physical_keys pk
      JOIN keys k ON k.id = pk.key_type_id
      JOIN key_systems ks ON ks.id = k.key_system_id
      LEFT JOIN key_agreements ka ON ka.physical_key_id = pk.id AND ka.returned_date IS NULL
      LEFT JOIN staff s ON s.id = ka.staff_id
      WHERE pk.status = 'active'
        AND pk.expiry_date IS NOT NULL
        AND pk.expiry_date >= ?
        AND pk.expiry_date <= date(?, '+7 days')
    `).all(today, today);

    if (expiringSoon.length > 0) {
      console.log(`[keycron] ℹ  ${expiringSoon.length} key copy/copies expiring within 7 days:`);
      for (const key of expiringSoon) {
        const holder = key.first_name ? `${key.first_name} ${key.last_name}` : 'unissued';
        console.log(`[keycron]   • ${key.stamp_number} (${key.key_number}) expires ${key.expiry_date} — ${holder}`);
      }
    }
  });

  console.log('[keycron] Nightly expiry check scheduled (06:00 daily)');
}

function runAuditRetention() {
  try {
    const setting = db.prepare("SELECT value FROM plan_settings WHERE key = 'audit_retention_days'").get();
    const days = parseInt(setting?.value);
    if (!days || days <= 0) return;
    const result = db.prepare(
      "DELETE FROM audit_log WHERE performed_at < datetime('now', '-' || ? || ' days')"
    ).run(days);
    if (result.changes > 0) console.log(`[keycron] Pruned ${result.changes} audit log entries older than ${days} days`);
  } catch (err) {
    console.error('[keycron] Audit retention error:', err.message);
  }
}

function setupAuditRetentionCron() {
  cron.schedule('30 6 * * *', runAuditRetention);
  console.log('[keycron] Audit retention scheduled (06:30 daily)');
}

module.exports = { setupKeyCron, setupAuditRetentionCron };
