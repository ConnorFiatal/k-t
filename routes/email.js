/**
 * routes/email.js
 *
 * Exports:  sendEmail(to, subject, templateName, variables)
 * Router:   POST /email/test  — sends a test email (admin use)
 *
 * Set SMTP_HOST in .env to enable sending.
 * Leave SMTP_HOST blank to run in "log-only" mode (safe default).
 */

const express      = require('express');
const nodemailer   = require('nodemailer');
const path         = require('path');
const fs           = require('fs');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_TEMPLATES = new Set(['welcome', 'key-assigned', 'key-removed', 'key-expiry']);

// ── Transporter ────────────────────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

// ── Template renderer ──────────────────────────────────────────────────────
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

function renderTemplate(templateName, variables = {}) {
  const filePath = path.join(TEMPLATE_DIR, `${templateName}.html`);
  if (!fs.existsSync(filePath)) throw new Error(`Email template not found: ${templateName}`);

  let html = fs.readFileSync(filePath, 'utf8');

  // Replace {{variable}} placeholders — unknown keys become empty string
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    variables[key] !== undefined ? String(variables[key]) : ''
  );
  return html;
}

// ── sendEmail ──────────────────────────────────────────────────────────────
/**
 * Send a templated email.
 *
 * @param {string}  to           Recipient address, e.g. "Jane Smith <jane@example.com>"
 * @param {string}  subject      Email subject line
 * @param {string}  templateName Filename (without .html) inside /templates/
 * @param {object}  variables    Key→value map for {{placeholder}} substitution
 * @returns {Promise<object>}    Nodemailer info object, or { skipped: true } if SMTP not configured
 */
async function sendEmail(to, subject, templateName, variables = {}) {
  // Always inject common variables
  const merged = {
    appName:  'KeyDog',
    appUrl:   process.env.APP_URL || 'http://localhost:3000',
    year:     new Date().getFullYear(),
    ...variables,
  };

  const t = getTransporter();

  if (!t) {
    console.log(`[email] SMTP not configured. Would have sent "${subject}" to ${to} (template: ${templateName})`);
    return { skipped: true };
  }

  const html = renderTemplate(templateName, merged);

  // Plain-text fallback: strip tags
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();

  try {
    const info = await t.sendMail({
      from:    process.env.FROM_EMAIL || process.env.SMTP_USER,
      to,
      subject,
      html,
      text,
    });
    console.log(`[email] Sent "${subject}" to ${to} — messageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
    throw err;
  }
}

// ── Admin test endpoint ────────────────────────────────────────────────────
// POST /email/test  { to, template }
router.post('/test', requirePermission('admin.users'), async (req, res) => {
  const { to, template = 'welcome' } = req.body;
  if (!ALLOWED_TEMPLATES.has(template)) {
    req.session.flash = { error: 'Invalid email template.' };
    return res.redirect('/admin/users');
  }
  if (!to) {
    req.session.flash = { error: 'Recipient email address is required.' };
    return res.redirect('/admin/users');
  }
  try {
    const result = await sendEmail(to, `[KeyDog] Test email — ${template}`, template, {
      username:   req.session.user.username,
      loginUrl:   `${process.env.APP_URL || 'http://localhost:3000'}/login`,
      createdBy:  req.session.user.username,
      staffName:  'Test Staff',
      keyNumber:  'TEST-01',
      systemName: 'Test System',
      ringNumber: 'RING-01',
      assignedBy: req.session.user.username,
      removedBy:  req.session.user.username,
      date:       new Date().toLocaleDateString(),
    });
    const msg = result.skipped
      ? 'SMTP not configured — email logged to console instead.'
      : `Test email sent to ${to}.`;
    req.session.flash = { success: msg };
  } catch (err) {
    req.session.flash = { error: `Email failed: ${err.message}` };
  }
  res.redirect('/admin/users');
});

module.exports = router;
module.exports.sendEmail = sendEmail;
