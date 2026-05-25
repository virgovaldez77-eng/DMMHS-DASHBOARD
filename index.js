// Load environment variables FIRST
require('dotenv').config();

// Validate critical secrets before starting
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('❌ PRODUCTION ERROR: JWT_SECRET must be set to at least 32 characters');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('❌ PRODUCTION ERROR: SESSION_SECRET must be set to at least 32 characters');
    process.exit(1);
  }
  console.log('✅ Security: JWT and Session secrets validated');
} else {
  console.log('⚠️  Development mode - using .env file for secrets');
}

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { loadConfig, getConfig, printSecurityChecklist } = require('./config/env');
const {
  applySecurityMiddleware,
  authMiddleware,
  requireRole,
  signToken,
  getAuthCookieOptions,
  COOKIE_NAME
} = require('./config/security');
const {
  initRateLimiter,
  applyStaticRateLimit,
  isAccountLocked,
  recordLoginFailure,
  recordLoginSuccess,
  getClientIp
} = require('./middleware/rateLimiter');
const { validateLogin } = require('./middleware/validation');   // ← ADD THIS LINE
const {
  getMasterData,
  saveMasterData,
  addActivityLog,
  getActivityLogs,
  findUserByEmail,
  listUsers,
  createUser,
  updateUser,
  deleteUser
} = require('./db');
const { fetchGoogleSheetCsv } = require('./sheets-fetch');

const useHttpsCli = ['1', 'true', 'yes'].includes(
  String(process.env.USE_HTTPS || '').toLowerCase()
);

/** @type {ReturnType<typeof loadConfig>} */
let cfg;
/** @type {Awaited<ReturnType<typeof initRateLimiter>>} */
let rateLimiters;

function handleLogin(req, res) {
  const { email, password } = req.body || {};
  const ip = getClientIp(req);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (isAccountLocked(normalizedEmail)) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many attempts. Please try again later.'
    });
  }

  const user = findUserByEmail(normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordLoginFailure(normalizedEmail, ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  recordLoginSuccess(normalizedEmail, ip);
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const token = signToken(payload, cfg);
  res.cookie(COOKIE_NAME, token, getAuthCookieOptions(cfg));
  addActivityLog({
    user_email: user.email,
    role: user.role,
    action: 'login',
    details: 'User signed in'
  });
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, name: user.name }
  });
}

async function bootstrap() {
  try {
    cfg = loadConfig({ useHttpsCli });
  } catch (err) {
    console.error('\n[FATAL] Environment validation failed:\n', err.message, '\n');
    process.exit(1);
  }

  rateLimiters = await initRateLimiter();

  const app = express();

  if (cfg.trustProxy || cfg.tls.enabled) {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin: cfg.isProduction
        ? process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) || false
        : true,
      credentials: true
    })
  );
  app.use(cookieParser(cfg.sessionSecret));
  app.use(express.json({ limit: '5mb' }));
  applySecurityMiddleware(app, cfg, rateLimiters);

  // Serve the standalone dashboard at the root URL
  app.get('/', (_req, res) => {
    return res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
  });

  if (cfg.tls.enabled) {
    app.use((req, res, next) => {
      if (req.secure) return next();
      const host = req.headers.host || `${cfg.host}:${cfg.port}`;
      return res.redirect(301, `https://${host}${req.url}`);
    });
  }

  applyStaticRateLimit(app, rateLimiters);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  async function handleSheetsImport(req, res) {
    const sheetLink = req.query.sheet || req.query.url;
    if (!sheetLink || !/docs\.google\.com\/spreadsheets/i.test(String(sheetLink))) {
      return res.status(400).json({ error: 'Invalid Google Sheets link' });
    }
    try {
      const csv = await fetchGoogleSheetCsv(String(sheetLink));
      res.type('text/csv').send(csv);
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || 'Failed to fetch sheet' });
    }
  }

  app.get('/api/health', (_req, res) => {
    const { getSecurityChecklist } = require('./config/env');
    res.json({
      ok: true,
      service: 'DMMHS Platform API',
      database: 'sqlite',
      dbFile: 'server/dmmhs.db',
      environment: cfg.nodeEnv,
      https: cfg.tls.enabled,
      security: getSecurityChecklist(cfg).map(i => ({ name: i.name, ok: i.ok })),
      rateLimit: rateLimiters.getStatus()
    });
  });

  app.get('/api/sheets/import', handleSheetsImport);
  app.get('/api/sheets/csv', handleSheetsImport);

  app.post('/api/auth/login', validateLogin, handleLogin);
app.post('/api/login', validateLogin, handleLogin);

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { ...getAuthCookieOptions(cfg), maxAge: 0 });
    res.json({ ok: true });
  });

  app.get('/api/admin/rate-limit', authMiddleware, requireRole('admin'), (_req, res) => {
    res.json(rateLimiters.getStatus());
  });

  app.get('/api/data', authMiddleware, (_req, res) => {
    res.json(getMasterData());
  });

  app.put('/api/data', authMiddleware, requireRole('admin', 'editor'), (req, res) => {
    const payload = req.body;
    if (!payload || !payload.schoolYears) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    saveMasterData(payload);
    addActivityLog({
      user_email: req.user.email,
      role: req.user.role,
      action: 'data_sync',
      details: 'Master dataset updated via API'
    });
    res.json({ ok: true });
  });

  app.get('/api/logs', authMiddleware, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    res.json(getActivityLogs(limit));
  });

  app.post('/api/logs', authMiddleware, (req, res) => {
    const { action, details } = req.body || {};
    addActivityLog({
      user_email: req.user.email,
      role: req.user.role,
      action: action || 'note',
      details: details || ''
    });
    res.json({ ok: true });
  });

  app.get('/api/users', authMiddleware, requireRole('admin'), (_req, res) => {
    res.json(listUsers());
  });

  app.post('/api/users', authMiddleware, requireRole('admin'), (req, res) => {
    const { email, password, role, name } = req.body || {};
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, role required' });
    }
    try {
      const id = createUser({
        email: email.trim().toLowerCase(),
        password,
        role,
        name
      });
      addActivityLog({
        user_email: req.user.email,
        role: req.user.role,
        action: 'user_create',
        details: `Created user ${email}`
      });
      res.status(201).json({ id });
    } catch {
      res.status(409).json({ error: 'User already exists' });
    }
  });

  app.patch('/api/users/:id', authMiddleware, requireRole('admin'), (req, res) => {
    const id = parseInt(req.params.id, 10);
    updateUser(id, req.body || {});
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', authMiddleware, requireRole('admin'), (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    deleteUser(id);
    res.json({ ok: true });
  });
// ==================== BACKUP ROUTES ====================
const BackupService = require('./services/backupService');

// Initialize backup service
const backupService = new BackupService(
  path.join(__dirname, 'dmmhs.db'),
  process.env.BACKUP_PATH || path.join(__dirname, 'backups')
);

// Create a backup manually
app.post('/api/backup/create', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await backupService.createBackup('manual');
    addActivityLog({
      user_email: req.user.email,
      role: req.user.role,
      action: 'backup_create',
      details: `Created backup: ${result.filename}`
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all available backups
app.get('/api/backup/list', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    res.json(backups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore a backup
app.post('/api/backup/restore/:filename', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await backupService.restoreBackup(filename);
    addActivityLog({
      user_email: req.user.email,
      role: req.user.role,
      action: 'backup_restore',
      details: `Restored from backup: ${filename}`
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clean up old backups (older than retention days)
app.delete('/api/backup/cleanup', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
    const result = await backupService.cleanupOldBackups(retentionDays);
    addActivityLog({
      user_email: req.user.email,
      role: req.user.role,
      action: 'backup_cleanup',
      details: `Cleaned up ${result.deleted} old backups`
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

/** @type {import('http').Server | import('https').Server | null} */
let httpsServer = null;
/** @type {import('http').Server | null} */
let httpRedirectServer = null;

function readTlsCredentials() {
  try {
    return {
      key: fs.readFileSync(cfg.tls.keyPath),
      cert: fs.readFileSync(cfg.tls.certPath)
    };
  } catch (err) {
    throw new Error(`Failed to load TLS certificates: ${err.message}`);
  }
}

function createHttpRedirectServer() {
  return http.createServer((req, res) => {
    const host = (req.headers.host || `${cfg.host}:${cfg.port}`).replace(/:\d+$/, '');
    const target = `https://${host}:${cfg.port}${req.url}`;
    res.writeHead(301, { Location: target, 'Content-Type': 'text/plain' });
    res.end(`Redirecting to ${target}\n`);
  });
}

function startServers(app) {
  printSecurityChecklist(cfg);

  const scheme = cfg.tls.enabled ? 'https' : 'http';
  const baseUrl = `${scheme}://${cfg.host}:${cfg.port}`;

  if (cfg.tls.enabled) {
    const credentials = readTlsCredentials();
    httpsServer = https.createServer(credentials, app);
    httpsServer.listen(cfg.port, () => {
      console.log(`DMMHS Platform running at ${baseUrl}`);
      console.log(`TLS certificate: ${cfg.tls.certPath}`);
      if (cfg.tls.devGenerated) {
        console.log('  (self-signed — browser will show a security warning; expected for development)');
      }
      console.log(`SQLite database: ${path.join(__dirname, 'dmmhs.db')}`);
      console.log(`Environment: ${cfg.nodeEnv}`);
      if (cfg.isProduction) {
        console.log('Default logins disabled in production — use configured accounts only.');
      } else {
        console.log('Dev logins: admin@dmmhs.edu.ph / admin123');
      }
    });

    if (cfg.httpPort !== cfg.port) {
      httpRedirectServer = createHttpRedirectServer();
      httpRedirectServer.listen(cfg.httpPort, () => {
        console.log(`HTTP redirect: http://${cfg.host}:${cfg.httpPort} → ${baseUrl}`);
      });
    }
  } else {
    httpsServer = app.listen(cfg.port, () => {
      console.log(`DMMHS Platform running at ${baseUrl}`);
      console.log(`SQLite database: ${path.join(__dirname, 'dmmhs.db')}`);
      console.log(`Environment: ${cfg.nodeEnv}`);
      console.log('Dev logins: admin@dmmhs.edu.ph / admin123');
      if (cfg.isProduction) {
        console.warn('[security] WARNING: Production should use HTTPS. Set HTTPS_KEY_PATH and HTTPS_CERT_PATH.');
      }
    });
  }
}

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  const close = server =>
    new Promise(resolve => {
      if (!server || !server.close) return resolve();
      server.close(() => resolve());
    });

  Promise.all([close(httpsServer), close(httpRedirectServer)])
    .then(() => {
      console.log('Server stopped.');
      process.exit(0);
    })
    .catch(() => process.exit(1));

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bootstrap()
  .then(app => startServers(app))
  .catch(err => {
    console.error('[FATAL] Server bootstrap failed:', err.message);
    process.exit(1);
  });
