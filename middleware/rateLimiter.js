const rateLimit = require('express-rate-limit');

// Broad application-level limiter — prevents scraping and brute-force on
// any endpoint beyond the dedicated login limiter.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  // Static assets served before this middleware are already excluded
});

module.exports = { globalLimiter };
