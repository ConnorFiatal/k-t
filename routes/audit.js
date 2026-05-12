const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { action, resource_type, q, limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit) || 100, 500);

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (action) { query += ' AND action = ?'; params.push(action); }
  if (resource_type) { query += ' AND resource_type = ?'; params.push(resource_type); }
  if (q) {
    query += ' AND (resource_name LIKE ? OR staff_name LIKE ? OR performed_by LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY performed_at DESC LIMIT ?';
  params.push(limit);

  const entries = db.prepare(query).all(...params);
  res.render('audit', { title: 'Audit Log', entries, filters: { action, resource_type, q, limit }, limit });
});

module.exports = router;
