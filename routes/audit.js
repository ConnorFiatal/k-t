const express = require('express');
const { db } = require('../db');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

function buildAuditQuery({ action, resource_type, q, performed_by, date_from, date_to }) {
  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (action) { query += ' AND action = ?'; params.push(action); }
  if (resource_type) { query += ' AND resource_type = ?'; params.push(resource_type); }
  if (performed_by) { query += ' AND performed_by = ?'; params.push(performed_by); }
  if (date_from) { query += ' AND performed_at >= ?'; params.push(date_from); }
  if (date_to) { query += ' AND performed_at <= ?'; params.push(`${date_to} 23:59:59`); }
  if (q) {
    query += ' AND (resource_name LIKE ? OR staff_name LIKE ? OR performed_by LIKE ? OR notes LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  return { query, params };
}

// CSV export — must be defined before the '/' GET so Express doesn't treat 'export' as an :id param
router.get('/export', requirePermission('audit.view'), (req, res) => {
  const filters = {
    action: req.query.action,
    resource_type: req.query.resource_type,
    q: req.query.q,
    performed_by: req.query.performed_by,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
  };

  const { query, params } = buildAuditQuery(filters);
  const entries = db.prepare(query + ' ORDER BY performed_at DESC').all(...params);

  const csvRows = [
    ['ID', 'Timestamp', 'Action', 'Resource Type', 'Resource Name', 'Staff ID', 'Staff Name', 'Performed By', 'Notes'],
    ...entries.map(e => [
      e.id, e.performed_at, e.action, e.resource_type,
      e.resource_name || '', e.staff_id || '', e.staff_name || '',
      e.performed_by, e.notes || '',
    ]),
  ];

  const csv = csvRows.map(r =>
    r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.get('/', requirePermission('audit.view'), (req, res) => {
  const filters = {
    action: req.query.action,
    resource_type: req.query.resource_type,
    q: req.query.q,
    performed_by: req.query.performed_by,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
  };
  const limit = Math.min(parseInt(req.query.limit) || 100, 2000);

  const { query, params } = buildAuditQuery(filters);
  const entries = db.prepare(query + ' ORDER BY performed_at DESC LIMIT ?').all(...params, limit);

  const performers = db.prepare('SELECT DISTINCT performed_by FROM audit_log ORDER BY performed_by').all()
    .map(r => r.performed_by);

  res.render('audit', { title: 'Audit Log', entries, filters, limit, performers });
});

module.exports = router;
