const passport = require('passport');
const { Strategy: SamlStrategy } = require('@node-saml/passport-saml');
const { db } = require('../db');
const { isSsoOnly } = require('./authConfig');

// The IdP signing cert may be supplied as one cert or several comma-separated
// certs. Supplying multiple lets you stage an IdP signing-cert rotation: keep
// the outgoing and incoming certs active at the same time so logins keep
// working through the cutover window. node-saml's `idpCert` accepts a string
// or a string[], so we return whichever is appropriate.
function parseIdpCert(raw) {
  if (!raw) return raw;
  const certs = raw.split(',').map(c => c.trim()).filter(Boolean);
  if (certs.length === 0) return raw;
  return certs.length === 1 ? certs[0] : certs;
}

// Resolve SAML config: environment variables take precedence, falling back to
// the saml_config table (this supports a future admin-managed SSO UI).
function getSamlConfig() {
  if (process.env.SAML_ENTRY_POINT) {
    return {
      entryPoint: process.env.SAML_ENTRY_POINT,
      issuer: process.env.SAML_ISSUER,
      callbackUrl: process.env.SAML_CALLBACK_URL,
      idpCert: parseIdpCert(process.env.SAML_IDP_CERT),
      spCert: process.env.SAML_SP_CERT || null,
    };
  }
  try {
    const row = db.prepare('SELECT * FROM saml_config WHERE enabled = 1 ORDER BY id LIMIT 1').get();
    if (row) {
      return {
        entryPoint: row.entry_point,
        issuer: row.issuer,
        callbackUrl: row.callback_url,
        idpCert: parseIdpCert(row.idp_cert),
        spCert: null,
      };
    }
  } catch (_) {}
  return null;
}

// Build the session user object the rest of the app expects on req.session.user.
function buildUserData(user) {
  const roleRow = user.role_id
    ? db.prepare('SELECT id, name, is_system FROM roles WHERE id = ?').get(user.role_id)
    : null;
  const isSuperAdmin = roleRow?.name === 'super_admin';
  const permissions = isSuperAdmin
    ? []
    : db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?').all(user.role_id ?? 0).map(r => r.permission);
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    role_id: user.role_id ?? null,
    role_name: roleRow?.name ?? null,
    role_label: roleRow ? db.prepare('SELECT label FROM roles WHERE id = ?').get(user.role_id)?.label : null,
    is_super_admin: isSuperAdmin,
    permissions,
    auth_mode: user.auth_mode ?? 'local',
  };
}

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
    if (!user) return done(null, false);
    return done(null, buildUserData(user));
  } catch (e) {
    return done(e);
  }
});

let samlStrategy = null;
const cfg = getSamlConfig();
if (cfg) {
  try {
    samlStrategy = new SamlStrategy(
      {
        entryPoint: cfg.entryPoint,
        issuer: cfg.issuer,
        callbackUrl: cfg.callbackUrl,
        idpCert: cfg.idpCert,
        // Azure AD / some Okta configs need tolerance for clock drift.
        acceptedClockSkewMs: 300000,
      },
      (profile, done) => {
        try {
          const email = profile?.nameID;
          if (!email) {
            return done(null, false, { message: 'SSO sign-in failed. Contact your administrator.' });
          }
          const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
          if (!user) {
            return done(null, false, { message: 'No KeyDog account found for this email. Contact your administrator.' });
          }
          // In sso_only mode the per-user auth_mode is ignored entirely.
          if (!isSsoOnly() && user.auth_mode === 'local') {
            return done(null, false, { message: 'SSO login not enabled for this account. Contact your administrator.' });
          }
          db.prepare('UPDATE admin_users SET last_sso_login = CURRENT_TIMESTAMP, saml_name_id = ? WHERE id = ?')
            .run(email, user.id);
          return done(null, user);
        } catch (e) {
          return done(e);
        }
      }
    );
    passport.use('saml', samlStrategy);
  } catch (e) {
    console.warn('WARNING: failed to initialise SAML strategy:', e.message);
    samlStrategy = null;
  }
}

module.exports = { passport, samlStrategy, buildUserData };
