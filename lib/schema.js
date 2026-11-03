// Creates the platform tables on startup (CREATE TABLE IF NOT EXISTS: safe on every boot) and seeds the first data.
// Principle: people are NEVER deleted. A person who leaves is disabled (seat freed); their name and e-mail stay on every
// record they touched, and a new hire gets a new person record in the seat.
const pool = require('../config/db');
const { ROLE_DEFAULTS, expand, PANE_KEYS } = require('./catalog');
const { hashPassword, randomPassword } = require('./password');
const { newToken, sha256 } = require('./tokens');

const DDL = [
  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS roles (
    role_key VARCHAR(32) NOT NULL PRIMARY KEY,
    label VARCHAR(80) NOT NULL,
    is_system INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_key VARCHAR(32) NOT NULL,
    perm_key VARCHAR(64) NOT NULL,
    level VARCHAR(8) NOT NULL,
    PRIMARY KEY (role_key, perm_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    role_key VARCHAR(32) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'active',
    password_hash VARCHAR(255) NULL,
    must_change_password INT NOT NULL DEFAULT 1,
    failed_count INT NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    seat_id INT NULL,
    last_login_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    created_by BIGINT NULL,
    disabled_at BIGINT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS user_permissions (
    user_id BIGINT NOT NULL,
    perm_key VARCHAR(64) NOT NULL,
    level VARCHAR(8) NOT NULL,
    PRIMARY KEY (user_id, perm_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS seats (
    id INT NOT NULL PRIMARY KEY,
    label VARCHAR(60) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS seat_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    seat_id INT NOT NULL,
    user_id BIGINT NOT NULL,
    user_name VARCHAR(120) NOT NULL,
    user_email VARCHAR(190) NOT NULL,
    assigned_at BIGINT NOT NULL,
    released_at BIGINT NULL,
    KEY idx_seat (seat_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    ip VARCHAR(64) NULL,
    ua VARCHAR(255) NULL,
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    kind VARCHAR(12) NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT NULL,
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Who did what, when. The name and e-mail are copied onto each row so the record stays readable after a person leaves.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    at BIGINT NOT NULL,
    user_id BIGINT NULL,
    user_name VARCHAR(120) NULL,
    user_email VARCHAR(190) NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40) NULL,
    entity_id VARCHAR(64) NULL,
    detail TEXT NULL,
    ip VARCHAR(64) NULL,
    KEY idx_at (at),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function getSetting(k, dflt){ const [r] = await pool.query('SELECT v FROM settings WHERE k = ?', [k]); return r.length ? r[0].v : dflt; }
async function setSetting(k, v){
  const [r] = await pool.query('SELECT k FROM settings WHERE k = ?', [k]);
  if(r.length) await pool.query('UPDATE settings SET v = ? WHERE k = ?', [String(v), k]);
  else await pool.query('INSERT INTO settings (k, v) VALUES (?, ?)', [k, String(v)]);
}

async function seedRoles(){
  const [have] = await pool.query('SELECT role_key FROM roles');
  const haveSet = new Set(have.map(r => r.role_key));
  for(const [key, def] of Object.entries(ROLE_DEFAULTS)){
    if(haveSet.has(key)) continue;
    await pool.query('INSERT INTO roles (role_key, label, is_system) VALUES (?, ?, ?)', [key, def.label, def.system ? 1 : 0]);
    const full = expand(def.perms);
    for(const k of PANE_KEYS) await pool.query('INSERT INTO role_permissions (role_key, perm_key, level) VALUES (?, ?, ?)', [key, k, full[k]]);
  }
}
async function seedSeats(){
  const n = Math.max(1, Number(await getSetting('seat_count', '10')) || 10);
  await setSetting('seat_count', n);
  const [have] = await pool.query('SELECT id FROM seats');
  const haveSet = new Set(have.map(r => Number(r.id)));
  for(let i = 1; i <= n; i++) if(!haveSet.has(i)) await pool.query('INSERT INTO seats (id, label) VALUES (?, ?)', [i, 'Seat ' + i]);
}
// First boot only: create the Builder account. The Builder has no seat (seats are for staff) and cannot be locked out by role edits.
async function bootstrapBuilder(){
  const [n] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if(Number(n[0].c) > 0) return;
  const email = String(process.env.BUILDER_EMAIL || '').trim().toLowerCase();
  if(!email){ console.warn('[setup] No users yet. Set BUILDER_EMAIL (and BUILDER_INITIAL_PASSWORD) and restart to create the Builder account.'); return; }
  const name = process.env.BUILDER_NAME || 'Builder';
  const pw = process.env.BUILDER_INITIAL_PASSWORD || '';
  const now = Date.now();
  const hash = pw ? await hashPassword(pw) : null;
  const [ins] = await pool.query('INSERT INTO users (email, name, role_key, status, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [email, name, 'builder', 'active', hash, 1, now]);
  await pool.query('INSERT INTO audit_log (at, user_id, user_name, user_email, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [now, null, 'System', null, 'user.bootstrap_builder', 'user', String(ins.insertId), JSON.stringify({ email })]);
  if(!pw){
    // No password supplied: write a one-time setup link to the server log (valid 24h).
    const token = newToken();
    await pool.query('INSERT INTO password_resets (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha256(token), ins.insertId, 'invite', now, now + 24 * 3600 * 1000]);
    const base = process.env.APP_URL || 'https://go.lucasindustrial.us';
    console.log(`[setup] Builder created for ${email}. One-time password setup link (24h): ${base}/#/reset?token=${token}`);
  } else console.log(`[setup] Builder created for ${email}. They must change the initial password at first login.`);
}
async function ensureSchema(){
  for(const sql of DDL) await pool.query(sql);
  await seedRoles(); await seedSeats(); await bootstrapBuilder();
}
module.exports = { ensureSchema, getSetting, setSetting };
