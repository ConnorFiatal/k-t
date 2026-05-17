const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, auditLog } = require('../db');
const { passport, samlStrategy } = require('../lib/saml');
const { isSsoOnly, isSsoConfigured } = require('../lib/authConfig');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true, // only count failed attempts
  handler: (req, res) => {
    req.session.flash = { error: 'Too many login attempts. Please wait 15 minutes and try again.' };
    res.redirect('/login');
  }
});

function renderLogin(req, res, flash, status) {
  if (status) res.status(status);
  res.render('login', {
    title: 'Login',
    flash: flash || null,
    user: null,
    currentPath: '/login',
    ssoEnabled: isSsoConfigured(),
    ssoOnly: isSsoOnly(),
  });
}

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  // The global locals middleware already consumed req.session.flash into
  // res.locals.flash. A session flash takes precedence over an ?error= query.
  let flash = res.locals.flash || null;
  if (!flash && req.query.error === 'sso_failed') {
    flash = { error: 'SSO sign-in failed. Contact your administrator.' };
  } else if (!flash && req.query.error === 'sso_not_configured') {
    flash = { error: 'SSO is not configured for this deployment. Contact your administrator.' };
  }
  renderLogin(req, res, flash);
});

router.post('/login', loginLimiter, (req, res) => {
  // sso_only deployments disable local login at the route level for everyone.
  if (isSsoOnly()) {
    return renderLogin(req, res,
      { error: 'This deployment requires SSO. Local login is disabled.' }, 403);
  }

  const { username, password } = req.body;
  if (!username || !password) {
    req.session.flash = { error: 'Username and password are required.' };
    return res.redirect('/login');
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    auditLog('FAILED_LOGIN', 'AUTH', null, username.trim(), null, null, username.trim(),
      'Invalid username or password', req.ip, req.get('user-agent'));
    req.session.flash = { error: 'Invalid username or password.' };
    return res.redirect('/login');
  }

  // Mixed mode: an account flagged sso-only must not authenticate with a password.
  if (user.auth_mode === 'sso') {
    req.session.flash = { error: "Your account uses SSO. Use the 'Sign in with your institution' button." };
    return res.redirect('/login');
  }

  // passport's req.login regenerates the session, preventing session fixation.
  req.login(user, (err) => {
    if (err) return res.redirect('/login');
    db.prepare('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    auditLog('LOGIN', 'AUTH', user.id, user.username, null, null, user.username,
      null, req.ip, req.get('user-agent'));
    const dest = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(dest);
  });
});

// ── SAML SSO ────────────────────────────────────────────────────────────────

router.get('/auth/saml', (req, res, next) => {
  if (!isSsoConfigured() || !samlStrategy) {
    return res.redirect('/login?error=sso_not_configured');
  }
  passport.authenticate('saml', { failureRedirect: '/login?error=sso_failed' })(req, res, next);
});

router.post('/auth/saml/callback', (req, res, next) => {
  if (!samlStrategy) return res.redirect('/login?error=sso_not_configured');
  // Custom callback so passport-saml failures (bad cert, clock skew, missing
  // assertion, unknown user) become a clean redirect rather than a 500.
  passport.authenticate('saml', (err, user, info) => {
    if (err || !user) {
      req.session.flash = { error: (info && info.message) || 'SSO sign-in failed. Contact your administrator.' };
      return res.redirect('/login?error=sso_failed');
    }
    req.login(user, (loginErr) => {
      if (loginErr) return res.redirect('/login?error=sso_failed');
      auditLog('SSO_LOGIN', 'user', req.user.id, req.user.username, null, null,
        req.user.email || req.user.username, 'SSO login via SAML', req.ip, req.get('user-agent'));
      const dest = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(dest);
    });
  })(req, res, next);
});

router.get('/auth/saml/metadata', (req, res) => {
  if (!samlStrategy) {
    return res.status(503).type('text/plain').send('SAML is not configured for this deployment.');
  }
  const spCert = process.env.SAML_SP_CERT || null;
  res.type('application/xml');
  res.send(samlStrategy.generateServiceProviderMetadata(spCert, spCert));
});

// ── Logout ──────────────────────────────────────────────────────────────────

function doLogout(req, res) {
  const { id: userId, username } = req.session.user || {};
  const ip = req.ip;
  const ua = req.get('user-agent');
  req.logout((err) => {
    req.session.destroy(() => {
      if (username) {
        auditLog('LOGOUT', 'AUTH', userId || null, username, null, null, username, null, ip, ua);
      }
      res.redirect('/login');
    });
  });
}

router.get('/auth/logout', doLogout);
router.post('/logout', doLogout);

module.exports = router;
