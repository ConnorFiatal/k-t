function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.session.flash = { error: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
}

module.exports = { requireLogin };
