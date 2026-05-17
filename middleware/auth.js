const { auditLog } = require('../db');

// Primary authentication gate — backed by passport. Both local password login
// and SAML SSO establish a passport session, so req.isAuthenticated() is the
// single source of truth for "is this request logged in".
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  req.session.flash = { error: 'Please log in to continue.' };
  return res.redirect('/login');
}

// Restricts a route tree to administrators. super_admin is treated as an
// administrator (it is a strict superset of admin), otherwise super_admins
// would be locked out of /admin.
function requireAdmin(req, res, next) {
  const u = req.session.user;
  if (u && (u.is_super_admin || u.role_name === 'admin' || u.role_name === 'super_admin')) {
    return next();
  }
  if (u) {
    auditLog('PERMISSION_DENIED', 'ACCESS', null, 'admin', null, null, u.username,
      `${req.method} ${req.path}`, req.ip, req.get('user-agent'));
  }
  req.session.flash = { error: 'Administrator access required.' };
  return res.redirect('/');
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.session.flash = { error: 'Please log in to continue.' };
      return res.redirect('/login');
    }
    const u = req.session.user;
    if (u.is_super_admin || (Array.isArray(u.permissions) && u.permissions.includes(permission))) {
      return next();
    }
    auditLog('PERMISSION_DENIED', 'ACCESS', null, permission, null, null, u.username,
      `${req.method} ${req.path}`, req.ip, req.get('user-agent'));
    req.session.flash = { error: 'You do not have permission to perform this action.' };
    const ref = req.get('Referer');
    let target = '/';
    if (ref) {
      try {
        const u = new URL(ref);
        if (u.host === req.get('Host') && !ref.includes(req.path)) target = ref;
      } catch {}
    }
    res.redirect(target);
  };
}

function requirePlanFeature(feature) {
  return (req, res, next) => {
    const licenseKey = feature.replace(/^feature_/, '');
    if (res.locals.planLicensed?.[licenseKey] === '1') return next();
    req.session.flash = { error: 'This feature is not available on your current plan.' };
    res.redirect('/');
  };
}

// Helper used in templates — checks if the current user has a permission
function userCan(user, permission) {
  if (!user) return false;
  return user.is_super_admin || (Array.isArray(user.permissions) && user.permissions.includes(permission));
}

module.exports = { requireAuth, requireAdmin, requirePermission, requirePlanFeature, userCan };
