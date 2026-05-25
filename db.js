const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'dmmhs.db');
const JSON_STORE = path.join(__dirname, 'data-store.json');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS master_data (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    role TEXT,
    action TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function getDefaultMasterPayload() {
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
  for (const yr of schoolYears) {
    if (yr !== '2025-2026') strandEnrollment[yr] = {};
  }
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
    { email: 'admin@dmmhs.edu.ph', password: 'admin123', role: 'admin', name: 'System Administrator' },
    { email: 'editor@dmmhs.edu.ph', password: 'editor123', role: 'editor', name: 'Data Editor' },
    { email: 'viewer@dmmhs.edu.ph', password: 'viewer123', role: 'viewer', name: 'Report Viewer' }
  ];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)'
  );
  for (const u of users) {
    insert.run(u.email, bcrypt.hashSync(u.password, 10), u.role, u.name);
  }
}

function seedMasterData() {
  const row = db.prepare('SELECT id FROM master_data WHERE id = 1').get();
  if (!row) {
    let payload = getDefaultMasterPayload();
    if (fs.existsSync(JSON_STORE)) {
      try {
        payload = { ...payload, ...JSON.parse(fs.readFileSync(JSON_STORE, 'utf8')) };
      } catch {
        /* use defaults */
      }
    }
    db.prepare('INSERT INTO master_data (id, payload) VALUES (1, ?)').run(JSON.stringify(payload));
  }
}

seedUsers();
seedMasterData();

function getMasterData() {
  const row = db.prepare('SELECT payload FROM master_data WHERE id = 1').get();
  return row ? JSON.parse(row.payload) : getDefaultMasterPayload();
}

function saveMasterData(payload) {
  db.prepare(
    "UPDATE master_data SET payload = ?, updated_at = datetime('now') WHERE id = 1"
  ).run(JSON.stringify(payload));
}

function addActivityLog(entry) {
  db.prepare(
    'INSERT INTO activity_logs (user_email, role, action, details) VALUES (?, ?, ?, ?)'
  ).run(entry.user_email, entry.role, entry.action, entry.details || '');
}

function getActivityLogs(limit = 100) {
  return db
    .prepare(
      'SELECT id, user_email, role, action, details, created_at FROM activity_logs ORDER BY id DESC LIMIT ?'
    )
    .all(limit);
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function listUsers() {
  return db
    .prepare('SELECT id, email, role, name, created_at FROM users ORDER BY id')
    .all();
}

function createUser({ email, password, role, name }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(email, hash, role, name || email);
  return info.lastInsertRowid;
}

function updateUser(id, { role, name, password }) {
  if (password) {
    db.prepare('UPDATE users SET role = ?, name = ?, password_hash = ? WHERE id = ?').run(
      role,
      name,
      bcrypt.hashSync(password, 10),
      id
    );
  } else {
    db.prepare('UPDATE users SET role = ?, name = ? WHERE id = ?').run(role, name, id);
  }
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = {
  db,
  getMasterData,
  saveMasterData,
  addActivityLog,
  getActivityLogs,
  findUserByEmail,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getDefaultMasterPayload
};
