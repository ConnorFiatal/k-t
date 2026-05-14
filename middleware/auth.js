function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.session.flash = { error: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
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
    req.session.flash = { error: 'You do not have permission to perform this action.' };
    // Redirect back or to dashboard
    const ref = req.get('Referer');
    res.redirect(ref && !ref.includes(req.path) ? ref : '/');
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

module.exports = { requireLogin, requirePermission, requirePlanFeature, userCan };
