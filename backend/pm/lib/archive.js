// Closing out a project: re-check it is ready, build the packet, file it in the archive drive, confirm the upload
// by reading it back, and ONLY THEN shrink the project to a stub and clear its logs. Any failure before that
// point leaves the project exactly as it was.
const crypto = require('crypto');
const pool = require('../config/db');
const actor = require('../../lib/actor');
const store = require('./boardStore');
const makeCalc = require('./calc');
const packet = require('./packet');
const drive = require('./drive');

const LOCK_MS = 150000;
let lock = null;
const isClosing = () => !!(lock && Date.now() - lock.at < LOCK_MS);
const fail = (status, error, message, extra) => Object.assign(new Error(message), { status, body: Object.assign({ error, message }, extra || {}) });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

async function readBoard() {
  const [rows] = await pool.query('SELECT data_json, revision FROM board_data WHERE id = 1');
  if (!rows.length) throw fail(404, 'no_board', 'There is no board data yet.');
  return { row: rows[0], board: JSON.parse(rows[0].data_json) };
}
async function logsFor(projectId) {
  const [ev] = await pool.query('SELECT created_at, role, user_id, user_name, user_username, field, kind, old_value, new_value FROM project_events WHERE project_id = ? ORDER BY id ASC', [projectId]);
  const [ar] = await pool.query('SELECT created_at, role, user_id, user_name, user_username, path, kind, old_value, new_value FROM money_archive WHERE project_id = ? ORDER BY id ASC', [projectId]);
  return {
    events: ev.map(r => ({ at: Number(r.created_at), by: r.role, byName: actor.labelOf(r.user_name, r.user_username), byUserId: r.user_id == null ? null : Number(r.user_id), field: r.field, kind: r.kind, oldValue: r.old_value, newValue: r.new_value })),
    archive: ar.map(r => ({ at: Number(r.created_at), by: r.role, byName: actor.labelOf(r.user_name, r.user_username), byUserId: r.user_id == null ? null : Number(r.user_id), path: r.path, kind: r.kind, oldValue: r.old_value, newValue: r.new_value })),
  };
}
function findProject(board, projectId) {
  const p = (board.projects || []).find(x => x && x.id === projectId);
  if (!p) throw fail(404, 'no_project', 'That project was not found.');
  return p;
}

// A test packet: same document, nothing closed, moved or changed.
async function preview(projectId) {
  const { board } = await readBoard();
  const p = findProject(board, projectId);
  const calc = makeCalc(board), logs = await logsFor(projectId);
  const pk = await packet.buildPacket(board, p, calc, { events: logs.events, archive: logs.archive, preview: true, generatedAt: new Date().toISOString() });
  return { name: pk.pdfName, pdf: pk.pdf };
}

// The Collections handoff PDF (any role that can close a project). Changes nothing.
async function handoffPdf(projectId, to) {
  const { board } = await readBoard();
  const p = findProject(board, projectId);
  const r = await packet.buildHandoff(board, p, makeCalc(board), { generatedAt: new Date().toISOString(), toName: to && to.name, toEmail: to && to.email });
  return { name: r.name, pdf: r.pdf };
}

// What the project keeps once it is closed out.
function stubFor(p, info, snap) {
  const keep = ['id', 'code', 'name', 'customer', 'storeNumber', 'address', 'city', 'state', 'lat', 'lon', 'plannedStart', 'plannedEnd', 'completedAt', 'crewNeeded', 'manDays', 'handoff'];
  const stub = {};
  keep.forEach(k => { if (p[k] !== undefined) stub[k] = p[k]; });
  stub.status = 'Completed';
  stub.assignedIds = []; stub.requiredSkills = []; stub.blockers = []; stub.contacts = [];
  stub.phases = (p.phases || []).map(ph => ({ id: ph.id, number: ph.number, status: ph.status, plannedStart: ph.plannedStart, plannedEnd: ph.plannedEnd }));
  stub.money = { contractOriginal: 0, percentComplete: 100, changeOrders: [], payApps: [], subDeals: [], notes: '' };
  stub.closed = { at: info.closedAt, by: info.role, byName: actor.label(actor.current()), byUserId: actor.current() ? actor.current().id : null, packetName: info.pdfName, packetId: info.packetId, summary: snap.summary, years: snap.years };
  return stub;
}

async function closeProject(projectId, role, req) {
  if (isClosing()) throw fail(409, 'busy', 'Another project is closing right now. Try again in a moment.');
  lock = { projectId, at: Date.now() };
  try {
    const { row, board } = await readBoard();
    const project = findProject(board, projectId);
    if (project.closed) throw fail(409, 'already_closed', 'This project is already closed out.');
    const calc = makeCalc(board);
    const ready = calc.projectCloseReadiness(project);
    if (!ready.ready) throw fail(409, 'not_ready', 'This project is not ready to close out yet.', { checks: ready.checks });
    const conn = await drive.getConnection();
    if (!conn) throw fail(409, 'drive_not_connected', 'The archive drive is not connected yet. The Builder connects it under "Google Drive Connection".');

    const projectHash = sha(JSON.stringify(project));
    const closedAt = new Date().toISOString();
    const logs = await logsFor(projectId);
    const pk = await packet.buildPacket(board, project, calc, { events: logs.events, archive: logs.archive, by: role, byName: actor.label(actor.current()), byUserId: actor.current() ? actor.current().id : null, closedAt, generatedAt: closedAt });

    let pdfFile, jsonFile;
    try {
      const folder = await drive.yearFolder(new Date(closedAt).getFullYear());
      pdfFile = await drive.uploadVerified(folder, pk.pdfName, 'application/pdf', pk.pdf);
      jsonFile = await drive.uploadVerified(folder, pk.jsonName, 'application/json', pk.json);
    } catch (e) { throw fail(502, 'drive_failed', 'The packet could not be saved to Drive, so nothing was changed. ' + e.message); }

    const snap = calc.projectCloseSnapshot(project);
    const info = { closedAt, role, pdfName: pk.pdfName, packetId: pk.packetId };
    await pool.query('INSERT INTO closed_packets (created_at, project_id, project_code, project_name, closed_by, packet_id, pdf_name, json_name, pdf_file_id, json_file_id, pdf_link, sha256, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [Date.now(), projectId, project.code || '', String(project.name || '').slice(0, 200), role, pk.packetId, pk.pdfName, pk.jsonName, pdfFile.id, jsonFile.id, pdfFile.link, pk.sha256].concat(actor.cols()));

    // Shrink the project (compare-and-swap, same as every other save).
    let revision = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = attempt === 0 ? { row, board } : await readBoard();
      const live = findProject(cur.board, projectId);
      if (sha(JSON.stringify(live)) !== projectHash) throw fail(409, 'changed_during_close', 'The project was changed while it was closing, so it was left as it is. The packet that was filed is still in Drive. Try again.');
      await store.writeSnapshot(cur.row.data_json, cur.board, 'pre-close', role, true, 0);
      const next = structuredClone(cur.board);
      next.projects = next.projects.map(x => x.id === projectId ? stubFor(live, info, snap) : x);
      // People who were still on the job are released now, so their work history has an end time.
      (next.people || []).forEach(pe => { (pe.history || []).forEach(h => { if (h.projectId === projectId && !h.to) h.to = closedAt; }); });
      const curRev = Number.isInteger(cur.board.revision) ? cur.board.revision : 0;
      next.revision = curRev + 1;
      const [r] = await pool.query('UPDATE board_data SET data_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?', [JSON.stringify(next), cur.row.revision]);
      if (r.affectedRows === 1) { revision = next.revision; break; }
    }
    if (revision === null) throw fail(503, 'busy', 'The board was busy; nothing was removed from the project. The packet is safe in Drive. Try again.');

    await pool.query('DELETE FROM money_archive WHERE project_id = ?', [projectId]);
    await pool.query('DELETE FROM project_events WHERE project_id = ?', [projectId]);
    await pool.query('INSERT INTO project_events (created_at, role, project_id, project_code, project_name, field, kind, old_value, new_value, user_id, user_name, user_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [Date.now(), role, projectId, project.code || '', String(project.name || '').slice(0, 200), 'Project', 'changed', 'Completed', ('Closed out - packet ' + pk.pdfName).slice(0, 480)].concat(actor.cols()));
    return { ok: true, revision, name: pk.pdfName, packetId: pk.packetId, link: pdfFile.link, code: project.code };
  } finally { lock = null; }
}

module.exports = { isClosing, handoffPdf, preview, closeProject, logsFor };
