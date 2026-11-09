// Resumable big-file storage on disk (no file is ever held in memory). Used by routes/media.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const partialDir = dir => path.join(dir, '.partial');
const partialPath = (dir, id) => path.join(partialDir(dir), String(id).replace(/[^\w-]/g, '') + '.part');

async function begin(dir, id){ await fs.promises.mkdir(partialDir(dir), { recursive: true }); await fs.promises.writeFile(partialPath(dir, id), Buffer.alloc(0), { flag: 'wx' }); }
async function received(dir, id){ try{ return (await fs.promises.stat(partialPath(dir, id))).size; }catch(e){ return -1; } }
// Chunks must arrive in order. A repeated chunk (a retry after a dropped connection) is accepted without being written twice.
async function append(dir, id, offset, buf){
  const have = await received(dir, id);
  if(have < 0) return { ok: false, error: 'unknown_upload' };
  if(offset + buf.length <= have && offset < have) return { ok: true, received: have, repeated: true };
  if(offset !== have) return { ok: false, error: 'wrong_offset', received: have };
  await fs.promises.appendFile(partialPath(dir, id), buf);
  return { ok: true, received: have + buf.length };
}
async function head(dir, id, n){ const fh = await fs.promises.open(partialPath(dir, id), 'r'); try{ const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.slice(0, bytesRead); } finally { await fh.close(); } }
function sha256(file){ return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }
async function finish(dir, id, storedName){
  const from = partialPath(dir, id), to = path.join(dir, path.basename(storedName));
  const sha = await sha256(from); await fs.promises.rename(from, to); return { sha, size: (await fs.promises.stat(to)).size };
}
async function abort(dir, id){ try{ await fs.promises.unlink(partialPath(dir, id)); }catch(e){} }
async function sweep(dir, maxAgeMs){ let n = 0; try{ for(const f of await fs.promises.readdir(partialDir(dir))){ const p = path.join(partialDir(dir), f); if(Date.now() - (await fs.promises.stat(p)).mtimeMs > maxAgeMs){ await fs.promises.unlink(p); n++; } } }catch(e){} return n; }
module.exports = { begin, received, append, head, finish, abort, sweep, partialPath };
