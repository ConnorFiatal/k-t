// Central helper for deployment-level auth decisions.
// Never inline process.env.AUTH_DEPLOYMENT_MODE checks elsewhere — import this.
module.exports = {
  isSsoOnly: () => process.env.AUTH_DEPLOYMENT_MODE === 'sso_only',
  isSsoConfigured: () => !!(process.env.SAML_ENTRY_POINT),
};
