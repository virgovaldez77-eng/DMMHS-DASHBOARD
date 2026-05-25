/**
 * Zero-dependency DMMHS API server (Node.js built-ins only).
 * Run: node server/simple-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchGoogleSheetCsv } = require('./sheets-fetch');

const PORT = process.env.PORT || 3847;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(__dirname, 'data-store.json');
const USERS_FILE = path.join(__dirname, 'users-store.json');
const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

function resolveJwtSecret() {
  const provided = process.env.JWT_SECRET?.trim();
  if (IS_PRODUCTION) {
    if (!provided || provided.length < 64) {
      console.error('[FATAL] JWT_SECRET required in production (min 64 characters). No hardcoded fallback.');
      process.exit(1);
    }
    return provided;
  }
  if (provided) return provided;
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn('[security] JWT_SECRET not set — using ephemeral dev secret for simple-server.');
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + JWT_SECRET).digest('hex');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function defaultMaster() {
  const schoolYears = ['2021-2022', '2022-2023', '2023-2024', '2024-2025', '2025-2026'];
  const defaultEnrol = {
    '2021-2022': [475, 465, 548, 558, 445, 340],
    '2022-2023': [422, 424, 508, 482, 465, 342],
    '2023-2024': [313, 335, 392, 413, 340, 413],
    '2024-2025': [402, 318, 305, 367, 368, 340],
    '2025-2026': [432, 380, 300, 294, 323, 338]
  };
  const defaultRepeaters = {
    '2021-2022': [5, 9, 15, 5, 3, 0],
    '2022-2023': [4, 53, 15, 2, 7, 2],
    '2023-2024': [5, 16, 12, 11, 43, 0],
    '2024-2025': [12, 11, 3, 2, 0, 0],
    '2025-2026': [14, 9, 18, 8, 0, 0]
  };
  const defaultDropouts = {
    '2021-2022': [33, 14, 28, 17, 4, 0],
    '2022-2023': [20, 12, 26, 0, 23, 0],
    '2023-2024': [15, 14, 16, 16, 7, 10],
    '2024-2025': [16, 17, 22, 11, 5, 0],
    '2025-2026': [9, 10, 31, 9, 14, 2]
  };
  const defaultTeacherJHS = {
    '2021-2022': [8, 8, 8, 8, 8, 4, 10, 11],
    '2022-2023': [8, 8, 8, 8, 8, 4, 11, 11],
    '2023-2024': [7, 8, 8, 8, 8, 4, 10, 11],
    '2024-2025': [7, 6, 8, 6, 6, 6, 9, 9],
    '2025-2026': [6, 6, 7, 6, 7, 5, 8, 8]
  };
  const enrolleesData = {};
  const repeatersData = {};
  const dropoutsData = {};
  const teacherJHS = {};
  for (const yr of schoolYears) {
    enrolleesData[yr] = defaultEnrol[yr];
    repeatersData[yr] = defaultRepeaters[yr];
    dropoutsData[yr] = defaultDropouts[yr];
    teacherJHS[yr] = defaultTeacherJHS[yr];
  }
  const strandEnrollment = {
    '2025-2026': {
      STEM: { g11: 69, g12: 70 },
      ABM: { g11: 42, g12: 52 },
      HUMSS: { g11: 102, g12: 103 },
      GAS: { g11: 0, g12: 0 },
      'ICT/CSS': { g11: 65, g12: 67 },
      EIM: { g11: 31, g12: 33 },
      HBC: { g11: 14, g12: 14 }
    }
  };
  for (const yr of schoolYears) if (yr !== '2025-2026') strandEnrollment[yr] = {};
  return {
    schoolYears,
    enrolleesData,
    repeatersData,
    dropoutsData,
    teacherJHS,
    shsAcademic: [10, 11, 12, 12, 14],
    shsTVL: [10, 11, 12, 12, 11],
    strandEnrollment,
    activityLogs: []
  };
}

function seedUsers() {
  const users = [
    { id: 1, email: 'admin@dmmhs.edu.ph', password_hash: hashPassword('admin123'), role: 'admin', name: 'System Administrator' },
    { id: 2, email: 'editor@dmmhs.edu.ph', password_hash: hashPassword('editor123'), role: 'editor', name: 'Data Editor' },
    { id: 3, email: 'viewer@dmmhs.edu.ph', password_hash: hashPassword('viewer123'), role: 'viewer', name: 'Report Viewer' }
  ];
  writeJson(USERS_FILE, users);
}

if (!fs.existsSync(DATA_FILE)) writeJson(DATA_FILE, defaultMaster());
if (!fs.existsSync(USERS_FILE)) seedUsers();

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5e6) reject(new Error('too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid json')); }
    });
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  });
  res.end(body);
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream';
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? verifyToken(token) : null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, service: 'DMMHS Platform API (simple)' });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { email, password } = await parseBody(req);
      const users = readJson(USERS_FILE, []);
      const user = users.find(u => u.email === String(email || '').trim().toLowerCase());
      if (!user || user.password_hash !== hashPassword(password || '')) {
        return send(res, 401, { error: 'Invalid credentials' });
      }
      const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
      return send(res, 200, { token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    }

    const user = auth(req);

    if (pathname === '/api/data' && req.method === 'GET') {
      if (!user) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, readJson(DATA_FILE, defaultMaster()));
    }

    if (pathname === '/api/data' && req.method === 'PUT') {
      if (!user) return send(res, 401, { error: 'Unauthorized' });
      if (!['admin', 'editor'].includes(user.role)) return send(res, 403, { error: 'Forbidden' });
      const body = await parseBody(req);
      writeJson(DATA_FILE, body);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Forbidden' });
      const users = readJson(USERS_FILE, []).map(({ password_hash, ...u }) => u);
      return send(res, 200, users);
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Forbidden' });
      const body = await parseBody(req);
      const users = readJson(USERS_FILE, []);
      if (users.some(u => u.email === body.email)) return send(res, 409, { error: 'User exists' });
      const id = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
      users.push({ id, email: body.email, password_hash: hashPassword(body.password), role: body.role, name: body.name || body.email });
      writeJson(USERS_FILE, users);
      return send(res, 201, { id });
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && req.method === 'PATCH') {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Forbidden' });
      const id = parseInt(userMatch[1], 10);
      const body = await parseBody(req);
      const users = readJson(USERS_FILE, []);
      const idx = users.findIndex(u => u.id === id);
      if (idx < 0) return send(res, 404, { error: 'Not found' });
      users[idx].role = body.role || users[idx].role;
      users[idx].name = body.name ?? users[idx].name;
      if (body.password) users[idx].password_hash = hashPassword(body.password);
      writeJson(USERS_FILE, users);
      return send(res, 200, { ok: true });
    }

    if (userMatch && req.method === 'DELETE') {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Forbidden' });
      const id = parseInt(userMatch[1], 10);
      if (id === user.id) return send(res, 400, { error: 'Cannot delete yourself' });
      writeJson(USERS_FILE, readJson(USERS_FILE, []).filter(u => u.id !== id));
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/logs' && req.method === 'POST') {
      if (!user) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, { ok: true });
    }

    if ((pathname === '/api/sheets/import' || pathname === '/api/sheets/csv') && req.method === 'GET') {
      const sheetLink = url.searchParams.get('sheet') || url.searchParams.get('url');
      if (!sheetLink || !/docs\.google\.com\/spreadsheets/i.test(sheetLink)) {
        return send(res, 400, { error: 'Invalid Google Sheets link' });
      }
      try {
        const csv = await fetchGoogleSheetCsv(sheetLink);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        });
        return res.end(csv);
      } catch (e) {
        return send(res, e.status || 502, { error: e.message || 'Failed to fetch sheet' });
      }
    }

    let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC, 'index.html');
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime(filePath) });
    res.end(content);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`DMMHS Platform (simple server) at http://localhost:${PORT}`);
});
