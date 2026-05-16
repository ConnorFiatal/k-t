const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logStream = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });

// Paths that carry no audit value and would flood the log
const SKIP_PREFIXES = ['/public', '/favicon'];

function accessLog(req, res, next) {
  if (SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const start = Date.now();
  const ip = req.ip;
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ua = req.get('user-agent') || null;

  res.on('finish', () => {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      method,
      url,
      status: res.statusCode,
      ms: Date.now() - start,
      ip,
      user: req.session?.user?.username || null,
      ua,
    }) + '\n';

    logStream.write(entry, (err) => {
      if (err) console.error('[accessLog] write error:', err.message);
    });

    // Echo to stdout in development for visibility
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(entry);
    }
  });

  next();
}

module.exports = { accessLog };
