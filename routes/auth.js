const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');

const router = express.Router();

// Issue 5 — rate-limit login attempts: max 20 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true, // only count failed attempts
  handler: (req, res) => {
    req.session.flash = { error: 'Too many login attempts. Please wait 15 minutes and try again.' };
    res.redirect('/login');
  }
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Login', flash: req.session.flash || null, user: null, currentPath: '/login' });
  delete req.session.flash;
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.session.flash = { error: 'Username and password are required.' };
    return res.redirect('/login');
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { error: 'Invalid username or password.' };
    return res.redirect('/login');
  }

  // Issue 4 — regenerate session ID after login to prevent session fixation
  const userData = { id: user.id, username: user.username };
  req.session.regenerate((err) => {
    if (err) return res.redirect('/login');
    req.session.user = userData;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
