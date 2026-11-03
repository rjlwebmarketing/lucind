// Creates the platform tables on startup (CREATE TABLE IF NOT EXISTS: safe on every boot) and seeds the first data.
// Principle: people are NEVER deleted. A person who leaves is turned off; their id, name, username and e-mail stay on every
// record they touched, and a new hire is always a new person record.
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
    username VARCHAR(40) NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    role_key VARCHAR(32) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'active',
    password_hash VARCHAR(255) NULL,
    must_change_password INT NOT NULL DEFAULT 1,
    failed_count INT NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
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

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    ip VARCHAR(64) NULL,
    ua VARCHAR(255) NULL,
    remember INT NOT NULL DEFAULT 0,
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
    user_username VARCHAR(40) NULL,
    user_email VARCHAR(190) NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40) NULL,
    entity_id VARCHAR(64) NULL,
    detail TEXT NULL,
    ip VARCHAR(64) NULL,
    KEY idx_at (at),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Extra roles for a person who does more than one job (their primary role stays in users.role_key). Access is the combination of all of them.
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT NOT NULL,
    role_key VARCHAR(32) NOT NULL,
    PRIMARY KEY (user_id, role_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS est_bids (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    store_number VARCHAR(40) NULL,
    customer VARCHAR(200) NULL,
    address VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(40) NULL,
    lat DOUBLE NULL,
    lon DOUBLE NULL,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'Draft',
    owner_id BIGINT NULL,
    owner_name VARCHAR(120) NULL,
    owner_username VARCHAR(40) NULL,
    bid_due VARCHAR(10) NULL,
    bid_submitted VARCHAR(10) NULL,
    decided_on VARCHAR(10) NULL,
    start_date VARCHAR(10) NULL,
    end_date VARCHAR(10) NULL,
    notes TEXT NULL,
    archived INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Every create/change/archive of a bid, kept forever, with who did it.
  `CREATE TABLE IF NOT EXISTS est_bid_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    bid_id BIGINT NOT NULL,
    at BIGINT NOT NULL,
    user_id BIGINT NULL,
    user_name VARCHAR(120) NULL,
    user_username VARCHAR(40) NULL,
    action VARCHAR(24) NOT NULL,
    changes TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS est_quotas (
    user_id BIGINT NOT NULL PRIMARY KEY,
    bid_target DECIMAL(14,2) NOT NULL,
    conv_target DOUBLE NOT NULL,
    updated_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
// First boot only: create the Builder account. The Builder cannot be locked out by role edits.
// One-time template upgrades for databases seeded by an earlier version.
async function upgradeRoleTemplates(){
  if(await getSetting('tpl_owner_users_write', '') === '1') return;
  // The Owner can add, turn off and reset people (never the Builder, never role templates or sensitive/admin access).
  await pool.query("UPDATE role_permissions SET level = 'write' WHERE role_key = 'owner' AND perm_key = 'admin.users' AND level = 'read'");
  await setSetting('tpl_owner_users_write', '1');
}
// v5: the Estimator branch. The Owner gets the new Analytics pane; the Estimator may view (not manage) crew & subs and see the calendar.
async function upgradeTemplatesV5(){
  if(await getSetting('tpl_v5_estimator', '') === '1') return;
  const set = async (role, key, level) => { await pool.query('DELETE FROM role_permissions WHERE role_key = ? AND perm_key = ?', [role, key]); await pool.query('INSERT INTO role_permissions (role_key, perm_key, level) VALUES (?, ?, ?)', [role, key, level]); };
  await set('owner', 'admin.analytics', 'write');
  // PMs are handed won jobs, not bids: no looking back into the Estimator unless the Owner grants view-only per person.
  await pool.query("DELETE FROM role_permissions WHERE role_key = 'pm' AND perm_key LIKE 'estimator.%'");
  await pool.query("DELETE FROM role_permissions WHERE role_key = 'estimator' AND perm_key = 'pm.proposals'");   // sub proposals are a PM-only screen
  await set('estimator', 'pm.people', 'read'); await set('estimator', 'pm.calendar', 'read');
  await setSetting('tpl_v5_estimator', '1');
}
async function bootstrapBuilder(){
  const [n] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if(Number(n[0].c) > 0) return;
  const email = String(process.env.BUILDER_EMAIL || '').trim().toLowerCase();
  if(!email){ console.warn('[setup] No users yet. Set BUILDER_EMAIL (and BUILDER_INITIAL_PASSWORD) and restart to create the Builder account.'); return; }
  const name = process.env.BUILDER_NAME || 'Builder';
  const pw = process.env.BUILDER_INITIAL_PASSWORD || '';
  const now = Date.now();
  const hash = pw ? await hashPassword(pw) : null;
  const uname = await freeUsername(String(process.env.BUILDER_USERNAME || '').trim().toLowerCase() || usernameFromEmail(email));
  const [ins] = await pool.query('INSERT INTO users (email, username, name, role_key, status, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [email, uname, name, 'builder', 'active', hash, 1, now]);
  await pool.query('INSERT INTO audit_log (at, user_id, user_name, user_email, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [now, null, 'System', null, 'user.bootstrap_builder', 'user', String(ins.insertId), JSON.stringify({ email })]);
  if(!pw){
    // No password supplied: write a one-time setup link to the server log (valid 24h).
    const token = newToken();
    await pool.query('INSERT INTO password_resets (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha256(token), ins.insertId, 'invite', now, now + 24 * 3600 * 1000]);
    const base = process.env.APP_URL || 'https://go.lucasindustrial.us';
    console.log(`[setup] Builder created for ${email}. One-time password setup link (24h): ${base}/#/reset?token=${token}`);
  } else console.log(`[setup] Builder created for ${email}. They must change the initial password at first login.`);
}
// Usernames: lowercase letters, digits, dot, dash, underscore. Sign-in accepts the username OR the email; resets always go to the email.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,38}$/;
const usernameFromEmail = e => String(e || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 30) || 'user';
async function freeUsername(base, exceptId){
  let name = base, n = 1;
  for(;;){
    const [r] = await pool.query('SELECT id FROM users WHERE username = ?' + (exceptId ? ' AND id <> ?' : ''), exceptId ? [name, exceptId] : [name]);
    if(!r.length) return name;
    n++; name = base.slice(0, 36) + n;
  }
}
// Databases created before usernames existed get the column added and filled in (from the email name) on the next boot.
async function migrateUsernames(){
  try{ await pool.query('ALTER TABLE users ADD COLUMN username VARCHAR(40) NULL'); }catch(e){ /* already there */ }
  try{ await pool.query('CREATE UNIQUE INDEX uq_users_username ON users (username)'); }catch(e){ /* already there */ }
  const [rows] = await pool.query('SELECT id, email FROM users WHERE username IS NULL');
  for(const u of rows) await pool.query('UPDATE users SET username = ? WHERE id = ?', [await freeUsername(usernameFromEmail(u.email), u.id), u.id]);
}
async function ensureSchema(){
  for(const sql of DDL) await pool.query(sql);
  try{ await pool.query('ALTER TABLE sessions ADD COLUMN remember INT NOT NULL DEFAULT 0'); }catch(e){ /* already there */ }
  try{ await pool.query('ALTER TABLE audit_log ADD COLUMN user_username VARCHAR(40) NULL'); }catch(e){ /* already there */ }
  await migrateUsernames();
  await seedRoles(); await upgradeRoleTemplates(); await upgradeTemplatesV5(); await bootstrapBuilder();
}
module.exports = { ensureSchema, getSetting, setSetting, USERNAME_RE, usernameFromEmail, freeUsername };
