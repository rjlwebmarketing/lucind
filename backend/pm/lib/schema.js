// Creates the new tables on startup (CREATE TABLE IF NOT EXISTS — safe to run
// on every boot, never touches board_data) and makes sure both access codes
// exist before the server starts accepting requests.

const pool = require('../config/db');

const DDL = [
  // Already exists on your live database (this does nothing there); only makes a
  // brand-new empty database start cleanly instead of crashing.
  `CREATE TABLE IF NOT EXISTS board_data (
    id INT NOT NULL PRIMARY KEY,
    data_json LONGTEXT NOT NULL,
    revision INT NOT NULL DEFAULT 1
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS board_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    reason VARCHAR(32) NOT NULL,
    saved_by VARCHAR(16) NULL,
    revision INT NULL,
    projects_n INT NOT NULL DEFAULT 0,
    people_n INT NOT NULL DEFAULT 0,
    skills_n INT NOT NULL DEFAULT 0,
    bytes INT NOT NULL DEFAULT 0,
    sha256 CHAR(64) NOT NULL,
    data_gz LONGBLOB NOT NULL,
    KEY idx_history_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    kind VARCHAR(24) NOT NULL,
    from_role VARCHAR(16) NULL,
    from_name VARCHAR(100) NULL,
    body VARCHAR(2000) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v16.2: "complete your profile" links. An invite is a one-time, expiring link
  // (only its hash is stored). A submission waits here, quarantined, until staff
  // review it — nothing a visitor types goes straight onto the board.
  `CREATE TABLE IF NOT EXISTS intake_invites (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    name_hint VARCHAR(100) NULL,
    email_hint VARCHAR(120) NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_by VARCHAR(16) NULL,
    used_at BIGINT NULL,
    KEY idx_invite_token (token_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS intake_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    kind VARCHAR(8) NOT NULL,
    invite_id BIGINT NULL,
    ip VARCHAR(64) NULL,
    data_json TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v20.5: "Submit your proposal" links. One revisitable link per invited sub per project (the link itself is
  // derived from a server secret, so staff can re-send it in a reminder; only the sub's own link opens their own
  // proposal). A submission is the sub's draft / sent proposal / decline; it never touches the board until the
  // PM confirms it.
  `CREATE TABLE IF NOT EXISTS app_secrets (
    name VARCHAR(40) NOT NULL PRIMARY KEY,
    value VARCHAR(200) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS proposal_links (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    invite_id VARCHAR(64) NOT NULL,
    person_id VARCHAR(64) NULL,
    created_at BIGINT NOT NULL,
    created_by VARCHAR(16) NULL,
    last_opened_at BIGINT NULL,
    open_count INT NOT NULL DEFAULT 0,
    UNIQUE (project_id, invite_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS proposal_submissions (
    link_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    status VARCHAR(12) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    handled_version INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    submitted_at BIGINT NULL,
    ip VARCHAR(64) NULL,
    data_json TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v16.5: standing "house rules" the Owner teaches the Assistant. Kept off the board on purpose, so the
  // PM's copy of the board never contains them; the AI proxy adds them to the Owner's and PM's Assistant on the server.
  // Every change to money (old value, new value, who, when). Read by Owner/Builder only.
  `CREATE TABLE IF NOT EXISTS money_archive (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    role VARCHAR(16) NULL,
    project_id VARCHAR(64) NULL,
    project_name VARCHAR(200) NULL,
    path VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    old_value VARCHAR(500) NULL,
    new_value VARCHAR(500) NULL,
    KEY idx_money_archive_created (created_at),
    KEY idx_money_archive_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v20: the change log for everything on a project that is not money (status, dates, crew, store number...).
  `CREATE TABLE IF NOT EXISTS project_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    role VARCHAR(16) NULL,
    project_id VARCHAR(64) NULL,
    project_code VARCHAR(16) NULL,
    project_name VARCHAR(200) NULL,
    field VARCHAR(120) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    old_value VARCHAR(500) NULL,
    new_value VARCHAR(500) NULL,
    KEY idx_project_events_created (created_at),
    KEY idx_project_events_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v20.1: the archive drive connection (one row) and the record of every packet filed to it.
  `CREATE TABLE IF NOT EXISTS drive_connection (
    id INT NOT NULL PRIMARY KEY,
    refresh_enc TEXT NOT NULL,
    email VARCHAR(200) NULL,
    root_folder_id VARCHAR(200) NULL,
    root_name VARCHAR(200) NULL,
    connected_at BIGINT NOT NULL,
    connected_by VARCHAR(16) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS closed_packets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    project_code VARCHAR(16) NULL,
    project_name VARCHAR(200) NULL,
    closed_by VARCHAR(16) NULL,
    packet_id VARCHAR(64) NULL,
    pdf_name VARCHAR(300) NOT NULL,
    json_name VARCHAR(300) NULL,
    pdf_file_id VARCHAR(200) NULL,
    json_file_id VARCHAR(200) NULL,
    pdf_link VARCHAR(500) NULL,
    sha256 CHAR(64) NULL,
    KEY idx_closed_packets_project (project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS house_rules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    author_role VARCHAR(16) NULL,
    body VARCHAR(300) NOT NULL,
    enabled TINYINT NOT NULL DEFAULT 1
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS suggestions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    from_name VARCHAR(100) NULL,
    body VARCHAR(2000) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // v20.6: an optional screenshot (a JPEG data URL) attached to a "Suggest a change". Kept after the suggestion
  // is folded into the Builder's backlog, so the backlog item can still show it.
  `CREATE TABLE IF NOT EXISTS suggestion_shots (
    suggestion_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    created_at BIGINT NOT NULL,
    image LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// Every record of an action also stores WHO did it: the person's id, name and username at that moment (the old
// 'role' columns stay, so records from before this change still read as pm / owner / builder).
const WHO_TABLES = ['project_events', 'money_archive', 'board_history', 'closed_packets', 'house_rules', 'proposal_links', 'requests', 'intake_invites', 'suggestions', 'drive_connection'];
async function ensureSchema() {
  for (const stmt of DDL) await pool.query(stmt);
  for (const t of WHO_TABLES) {
    for (const col of ['user_id BIGINT NULL', 'user_name VARCHAR(120) NULL', 'user_username VARCHAR(40) NULL']) {
      try { await pool.query('ALTER TABLE ' + t + ' ADD COLUMN ' + col); } catch (e) { /* already there */ }
    }
  }
}

module.exports = { ensureSchema, DDL };
