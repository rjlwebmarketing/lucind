/* Files panel shared by the Estimator (bids) and the PM (projects):  MediaPanel.mount(el, { type:'bid'|'project', id, api, token, me })
   Nothing is ever deleted. The Owner can HIDE a file; hidden files drop into a collapsed group at the bottom. */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const when = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const IMG = /^(jpe?g|png|gif|webp)$/, ORDER = ['Drawings', 'Bid documents', 'Contracts', 'Reports', 'Photos', 'Other'];
  const ICON = { pdf: '📄', dwg: '📐', dxf: '📐', xls: '📊', xlsx: '📊', csv: '📊', doc: '📝', docx: '📝', zip: '🗜', mp4: '🎞', mov: '🎞' };
  const css2 = `.mp-md{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;overflow:auto}.mp-mc{background:var(--panel,#fff);color:var(--text,#1d1d1d);border-radius:14px;width:min(560px,100%);padding:20px}.mp-mc h3{margin:0 0 6px;font-size:17px}.mp-mc label{display:block;font-size:12.5px;font-weight:600;margin:12px 0 0}.mp-mc input:not([type=checkbox]),.mp-mc textarea,.mp-mc select{box-sizing:border-box;display:block;width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:8px;font:inherit;font-weight:400;background:var(--panel,#fff);color:inherit}.mp-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mp-ck{display:flex!important;gap:8px;align-items:center;font-weight:400!important}.mp-s{font-size:13px;color:var(--text-dim,#666);margin:4px 0}.mp-er{color:#b3261e;font-size:13px;min-height:18px;margin-top:8px}.mp-bt{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px}.mp-sl{display:flex;gap:8px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line,#eee);font-size:13px}.mp-sl small{display:block;color:var(--text-dim,#777);font-size:11.5px;margin-top:2px}.mp-lg{font-size:11.5px;color:var(--text-dim,#666);margin-top:6px}@media(max-width:520px){.mp-two{grid-template-columns:1fr}}`;
  const css = `.mp{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--panel,#fff);margin:6px 0 14px}.mp-h{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line,#ddd)}.mp-h b{font-size:14px}.mp-h .sp{flex:1}
  .mp-drop{margin:12px 14px;padding:14px;border:2px dashed var(--line,#ccc);border-radius:10px;text-align:center;font-size:12.5px;color:var(--text-dim,#666)}.mp-drop.over{border-color:var(--brand-blue,#013CAE);background:var(--panel-2,#eef)}
  .mp-g{padding:4px 14px 8px}.mp-g h4{margin:12px 0 4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-faint,#888)}
  .mp-r{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line,#eee);font-size:13px}.mp-r:first-of-type{border-top:0}.mp-r .nm{flex:1;min-width:0}.mp-r .nm a{color:var(--brand-blue,#013CAE);font-weight:600;cursor:pointer;word-break:break-all}
  .mp-r small{display:block;color:var(--text-dim,#777);font-size:11px;margin-top:1px}.mp-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:20px;border-radius:6px;background:var(--panel-2,#eef);overflow:hidden;flex-shrink:0}.mp-ic img{width:100%;height:100%;object-fit:cover}
  .mp-tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:#FFDC4B55;margin-left:6px}.mp-hid{opacity:.65}.mp-b{border:0;background:none;color:var(--text-dim,#777);cursor:pointer;font-size:12px;padding:4px 6px;border-radius:6px}.mp-b:hover{background:var(--panel-2,#eef)}
  .mp-prog{height:5px;background:var(--line,#ddd);border-radius:3px;margin-top:6px;overflow:hidden}.mp-prog i{display:block;height:100%;width:0;background:var(--brand-blue,#013CAE)}
  .mp-lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#fff}.mp-lb img{max-width:92vw;max-height:84vh;object-fit:contain}.mp-lb button{background:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:600}`;
  if(!document.getElementById('mpcss')){ const s = document.createElement('style'); s.id = 'mpcss'; s.textContent = css + css2; document.head.appendChild(s); }

  // Dropped files and whole folders -> a flat list of files (junk like .DS_Store skipped). Entries must be read before the first await.
  const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*)$/i;
  async function collect(dt){
    const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean), fallback = [...dt.files], out = [];
    const walk = async en => {
      if(en.isFile){ const f = await new Promise(r => en.file(r, () => r(null))); if(f) out.push(f); }
      else if(en.isDirectory){ const rd = en.createReader(); let batch; do{ batch = await new Promise(r => rd.readEntries(r, () => r([]))); for(const c of batch) await walk(c); }while(batch.length); }
    };
    if(entries.length) for(const en of entries) await walk(en); else out.push(...fallback);
    return out.filter(f => !JUNK.test(f.name));
  }
  function mount(el, o){
    const A = o.api + '/api/media', tok = () => typeof o.token === 'function' ? o.token() : o.token, H = () => ({ Authorization: 'Bearer ' + tok() });
    const blobs = {}; let S = null, showHidden = false;
    const get = async path => { const r = await fetch(A + path, { headers: H() }); const j = await r.json().catch(() => ({})); if(!r.ok) throw Object.assign(new Error(j.error || 'failed'), j); return j; };
    const post = async (path, body) => { const r = await fetch(A + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if(!r.ok) throw Object.assign(new Error(j.error || 'failed'), j); return j; };
    const blobOf = async (f, dl) => { const r = await fetch(A + '/' + f.id + '/file' + (dl ? '?download=1' : ''), { headers: H() }); if(!r.ok) throw new Error('Could not open the file'); return URL.createObjectURL(await r.blob()); };
    const linkOf = async (f, dl) => { const j = await post('/' + f.id + '/link', { download: !!dl }); return o.api + j.url + (dl ? '?download=1' : ''); };
    async function open(f){
      try{
        if(IMG.test(f.ext)){ const u = await linkOf(f); const lb = document.createElement('div'); lb.className = 'mp-lb'; lb.innerHTML = `<img src="${u}" alt=""><div>${esc(f.name)} <button type="button">Close</button> <button type="button" data-d>Download</button></div>`;
          lb.querySelector('button').onclick = () => lb.remove(); lb.querySelector('[data-d]').onclick = () => save(f); lb.onclick = e => { if(e.target === lb) lb.remove(); }; document.body.appendChild(lb); }
        else if(f.ext === 'pdf') window.open(await linkOf(f), '_blank'); else await save(f);
      }catch(e){ alert(e.message); }
    }
    async function save(f){ try{ const a = document.createElement('a'); a.href = await linkOf(f, true); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }catch(e){ alert(e.message); } }
    async function thumbs(){ for(const f of S.files.filter(f => IMG.test(f.ext) && f.size < 8e6).slice(0, 60)){ const t = el.querySelector(`[data-t="${f.id}"]`); if(!t) continue;
      try{ blobs[f.id] = blobs[f.id] || await blobOf(f); t.innerHTML = `<img src="${blobs[f.id]}" alt="">`; }catch(e){} } }
    function row(f){
      const mine = S.me === f.uploadedById;
      return `<div class="mp-r ${f.hidden ? 'mp-hid' : ''}"><div class="mp-ic" data-t="${f.id}">${ICON[f.ext] || '📎'}</div>
        <div class="nm"><a data-o="${f.id}">${esc(f.name)}</a>${f.fromBid ? `<span class="mp-tag" title="${esc(f.fromBid)}">From ${esc(f.fromCode || 'bid')}</span>` : ''}${f.hidden ? '<span class="mp-tag" style="background:#ddd">Hidden</span>' : ''}
        <small>${size(f.size)} · ${esc(f.uploadedBy || 'Unknown')} · ${when(f.uploadedAt)}${f.caption ? ' · ' + esc(f.caption) : ''}${f.hidden ? ` · hidden by ${esc(f.hiddenBy)}${f.hiddenReason ? ' (' + esc(f.hiddenReason) + ')' : ''}` : ''}</small></div>
        <button class="mp-b" data-d="${f.id}" type="button" title="Download">⬇</button>
        ${S.canShare && !f.hidden && f.source === 'project' ? (f.share && f.share.ok ? `<button class="mp-b" data-sh="${f.id}" type="button" title="Send this file to someone outside the company with a private link">Share</button>` : `<button class="mp-b" type="button" disabled style="opacity:.45" title="${esc((f.share && f.share.reason) || 'Not shareable')}">Share</button>`) : ''}
        ${S.canHide && S.canShare && !f.hidden && f.source === 'project' ? `<button class="mp-b" data-sr="${f.id}" type="button" title="Owner: decide whether this file may be shared outside the company">${f.share && f.share.ok ? 'Block sharing' : 'Allow sharing'}</button>` : ''}
        ${mine || S.canHide ? `<button class="mp-b" data-c="${f.id}" type="button" title="Edit note">✎</button>` : ''}
        ${S.canHide ? (f.hidden ? `<button class="mp-b" data-u="${f.id}" type="button">Restore</button>` : `<button class="mp-b" data-h="${f.id}" type="button" title="Hide (Owner only). Nothing is deleted.">Hide</button>`) : ''}</div>`;
    }
    function draw(){
      const vis = S.files.filter(f => !f.hidden), hid = S.files.filter(f => f.hidden);
      const kinds = ORDER.filter(k => vis.some(f => f.kind === k)).concat([...new Set(vis.map(f => f.kind))].filter(k => !ORDER.includes(k)));
      el.innerHTML = `<div class="mp"><div class="mp-h"><b>Files</b><span class="mp-tag" style="margin:0;background:var(--panel-2,#eef)">${vis.length}</span><span class="sp"></span>
        ${S.canShare ? '<button class="btn small" id="mpl" type="button" title="Links you have sent to people outside the company">Shared links</button>' : ''}
        ${S.canAdd ? `<select id="mpk" style="font-size:12px;padding:4px" title="Category for the files you add"><option value="">Category: automatic</option>${S.kinds.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select><button class="btn small primary" id="mpb" type="button">Add files</button><input type="file" id="mpf" multiple hidden>` : ''}</div>
        ${S.canAdd ? `<div class="mp-drop" id="mpd">Drag drawings, PDFs or photos here, or use “Add files”. Large drawing sets are fine (up to ${Math.round(S.maxMb / 1024)} GB each). Files are never deleted.<div id="mpp"></div></div>` : ''}
        <div class="mp-g">${kinds.length ? kinds.map(k => `<h4>${esc(k)}</h4>${vis.filter(f => f.kind === k).map(row).join('')}`).join('') : '<div style="padding:10px 0;color:var(--text-dim,#777);font-size:13px">No files yet.</div>'}
        ${hid.length ? `<h4 style="margin-top:16px"><a id="mph" style="cursor:pointer">${showHidden ? '▾' : '▸'} Hidden files (${hid.length})</a></h4>${showHidden ? hid.map(row).join('') : ''}` : ''}</div></div>`;
      el.querySelectorAll('[data-o]').forEach(a => a.onclick = () => open(S.files.find(f => f.id == a.dataset.o)));
      el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => save(S.files.find(f => f.id == b.dataset.d)));
      el.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => shareDialog(S.files.find(f => f.id == b.dataset.sh)));
      el.querySelectorAll('[data-sr]').forEach(b => b.onclick = async () => { const f = S.files.find(x => x.id == b.dataset.sr), wantOk = !(f.share && f.share.ok), defOk = f.kind !== 'Contracts';
        await post('/' + f.id + '/share-rule', { rule: wantOk === defOk ? 'default' : (wantOk ? 'allow' : 'block') }).catch(e => alert(e.message)); load(true); });
      const ml = el.querySelector('#mpl'); if(ml) ml.onclick = sharedLinks;
      el.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => { const why = prompt('Why hide this file? (optional - it stays on record)'); if(why === null) return; await post('/' + b.dataset.h + '/hide', { reason: why }).catch(e => alert(e.message)); load(); });
      el.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => { await post('/' + b.dataset.u + '/unhide').catch(e => alert(e.message)); load(); });
      el.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => { const f = S.files.find(x => x.id == b.dataset.c), c = prompt('Note for this file:', f.caption || ''); if(c === null) return;
        await fetch(A + '/' + f.id, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: JSON.stringify({ caption: c }) }); load(); });
      const mph = el.querySelector('#mph'); if(mph) mph.onclick = () => { showHidden = !showHidden; draw(); };
      if(S.canAdd){ const inp = el.querySelector('#mpf'), drop = el.querySelector('#mpd');
        el.querySelector('#mpb').onclick = () => inp.click(); inp.onchange = () => upload([...inp.files]);
        ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => { collect(e.dataTransfer).then(fs => { if(fs.length) upload(fs); }); }); }
      thumbs();
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const sendChunk = (uid, offset, blob, onProg) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('PUT', A + '/upload/' + uid + '?offset=' + offset); x.setRequestHeader('Authorization', 'Bearer ' + tok()); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => { if(e.lengthComputable) onProg(e.loaded); }; x.onload = () => { let j = {}; try{ j = JSON.parse(x.responseText); }catch(e){} x.status === 200 ? res(j) : rej(Object.assign(new Error(j.error || 'failed'), { status: x.status, body: j })); }; x.onerror = () => rej(Object.assign(new Error('network'), { status: 0 })); x.send(blob); });
    // Big files go up in 8 MB pieces; a dropped connection picks up where it left off instead of starting over.
    async function one(file){
      const k = el.querySelector('#mpk') ? el.querySelector('#mpk').value : '', pr = el.querySelector('#mpp'), bar = document.createElement('div'); bar.className = 'mp-prog'; bar.innerHTML = '<i></i>'; const lab = document.createElement('div'); lab.style.cssText = 'font-size:11px;margin-top:6px'; lab.textContent = file.name; pr.append(lab, bar);
      const fail = m => { lab.innerHTML = '<span style="color:#D32F2F">✗ ' + esc(file.name) + ': ' + esc(m) + '</span>'; };
      try{
        const st = await post('/upload', { type: o.type, id: o.id, name: file.name, size: file.size, kind: k });
        let off = 0, tries = 0; const pct = n => { bar.firstChild.style.width = Math.round(n / file.size * 100) + '%'; lab.textContent = file.name + ' — ' + Math.round(n / file.size * 100) + '%'; };
        while(off < file.size){
          const end = Math.min(off + st.chunk, file.size);
          try{ const r = await sendChunk(st.uploadId, off, file.slice(off, end), n => pct(off + n)); off = r.received; tries = 0; pct(off); }
          catch(e){
            if(e.status === 409 && e.body && typeof e.body.received === 'number'){ off = e.body.received; continue; }
            if(e.status && e.status < 500) throw e;
            if(++tries > 6) throw new Error('network problem - try again');
            await sleep(1000 * tries);
            try{ off = (await get('/upload/' + st.uploadId)).received; }catch(x){}
          }
        }
        const j = await post('/upload/' + st.uploadId + '/finish');
        bar.remove(); lab.textContent = '✓ ' + file.name + (j.duplicateOf ? ' (same content as ' + j.duplicateOf + ')' : '');
      }catch(e){ bar.remove(); fail(e.error === 'file_type_not_allowed' ? 'file type not allowed' : e.error === 'too_large' ? 'over the ' + S.maxMb + ' MB limit' : e.error === 'file_does_not_match_its_type' ? 'file does not match its type' : (e.message || 'failed')); }
    }
    async function upload(files){ for(const f of files){ if(f.size > S.maxMb * 1048576){ const pr = el.querySelector('#mpp'); pr.insertAdjacentHTML('beforeend', `<div style="color:#D32F2F;font-size:11px;margin-top:6px">✗ ${esc(f.name)}: over the size limit</div>`); continue; } await one(f); } await load(true); }
    // ---- share links: send a project file to someone outside the company (no Google Drive, no sign-in for them) ----
    const SH = o.api + '/api/shares';
    const shReq = async (method, path, body) => { const r = await fetch(SH + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if(!r.ok) throw Object.assign(new Error(j.message || j.error || 'failed'), j); return j; };
    const modal = html => { const m = document.createElement('div'); m.className = 'mp-md'; m.innerHTML = `<div class="mp-mc" role="dialog">${html}</div>`; m.onclick = e => { if(e.target === m) m.remove(); }; document.body.appendChild(m); return m; };
    const fmtDay = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), fmtTime = ms => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    function shareDialog(f){
      const m = modal(`<h3>Share “${esc(f.name)}”</h3><p class="mp-s">Creates a private link for someone outside the company. They need no sign-in and see only this file.</p>
        <label>Who is it for? (optional)<input id="shr" placeholder="e.g. Dana, Acme Steel"></label><label>Message they will see (optional)<textarea id="shn" rows="2" placeholder="e.g. Rev C drawings for your shop review"></textarea></label>
        <div class="mp-two"><label>Link works for<select id="shd"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
        <label>Passcode (optional)<span style="display:flex;gap:6px"><input id="shp" autocomplete="off" placeholder="none"><button type="button" class="btn small ghost" id="shg">Make one</button></span></label></div>
        <label class="mp-ck"><input type="checkbox" id="shdl" checked> Allow download (otherwise they can only view it in the browser)</label>
        <div id="she" class="mp-er"></div><div class="mp-bt"><button class="btn small ghost" id="shx" type="button">Cancel</button><button class="btn small primary" id="shc" type="button">Create link</button></div>`);
      const q = x => m.querySelector(x);
      q('#shx').onclick = () => m.remove();
      q('#shg').onclick = () => { const w = ['blue', 'steel', 'weld', 'beam', 'angle', 'pipe', 'bolt', 'plate']; q('#shp').value = w[Math.floor(Math.random() * w.length)] + '-' + (100 + Math.floor(Math.random() * 900)); };
      q('#shc').onclick = async () => {
        const b = q('#shc'); b.disabled = true; q('#she').textContent = '';
        try{
          const r = await shReq('POST', '', { projectId: o.id, fileIds: [f.id], days: Number(q('#shd').value), recipient: q('#shr').value, note: q('#shn').value, allowDownload: q('#shdl').checked, passcode: q('#shp').value });
          const pc = q('#shp').value;
          m.querySelector('.mp-mc').innerHTML = `<h3>Link ready</h3><p class="mp-s">Copy it now. For security the link cannot be shown again; if you lose it, make a new one. It works until ${esc(fmtDay(r.expiresAt))}.</p>
            <input id="shu" readonly value="${esc(r.url)}" style="width:100%"><div class="mp-bt" style="justify-content:flex-start"><button class="btn small primary" id="shcp" type="button">Copy link</button><span id="shok" class="mp-s"></span></div>
            ${pc ? `<p class="mp-s"><b>Passcode: ${esc(pc)}</b><br>Send the passcode separately (for example by text), not in the same message as the link.</p>` : ''}<div class="mp-bt"><button class="btn small" id="shd2" type="button">Done</button></div>`;
          const u = m.querySelector('#shu'); u.focus(); u.select();
          m.querySelector('#shcp').onclick = async () => { try{ await navigator.clipboard.writeText(r.url); m.querySelector('#shok').textContent = 'Copied.'; }catch(e){ u.select(); try{ document.execCommand('copy'); m.querySelector('#shok').textContent = 'Copied.'; }catch(x){ m.querySelector('#shok').textContent = 'Press Ctrl+C to copy.'; } } };
          m.querySelector('#shd2').onclick = () => m.remove();
        }catch(e){ b.disabled = false; q('#she').textContent = e.message || 'Could not create the link.'; }
      };
    }
    async function sharedLinks(){
      const m = modal('<h3>Shared links</h3><p class="mp-s">Loading…</p>');
      const paint = async () => {
        let r; try{ r = await shReq('GET', '?projectId=' + encodeURIComponent(o.id)); }catch(e){ m.querySelector('.mp-mc').innerHTML = '<h3>Shared links</h3><p class="mp-er">' + esc(e.message) + '</p>'; return; }
        m.querySelector('.mp-mc').innerHTML = `<h3>Shared links</h3><p class="mp-s">Links sent from this project. You can withdraw one at any time.</p>` + (r.shares.length ? r.shares.map(x => `<div class="mp-sl" data-s="${x.id}"><div style="flex:1;min-width:0"><b>${esc(x.recipient || 'No name given')}</b> <span class="mp-tag" style="background:${x.status === 'active' ? '#CDEFD6' : '#e4e4e0'}">${x.status}</span>${x.passcode ? '<span class="mp-tag">Passcode</span>' : ''}${x.allowDownload ? '' : '<span class="mp-tag">View only</span>'}
          <small>${esc(x.files.join(', '))}</small><small>Sent ${esc(fmtDay(x.createdAt))} by ${esc(x.by)} · ${x.status === 'expired' ? 'expired' : 'expires'} ${esc(fmtDay(x.expiresAt))} · opened ${x.opens} time${x.opens === 1 ? '' : 's'}${x.lastOpenAt ? ', last ' + esc(fmtTime(x.lastOpenAt)) : ''}</small><div class="mp-lg" id="lg${x.id}"></div></div>
          <button class="mp-b" data-lg="${x.id}" type="button">Activity</button>${x.status === 'active' ? `<button class="mp-b" data-rv="${x.id}" type="button">Withdraw</button>` : ''}</div>`).join('') : '<p class="mp-s">No links sent yet. Use “Share” next to a file.</p>') + '<div class="mp-bt"><button class="btn small" id="slx" type="button">Close</button></div>';
        m.querySelector('#slx').onclick = () => m.remove();
        m.querySelectorAll('[data-rv]').forEach(b => b.onclick = async () => { if(!confirm('Withdraw this link? The person will no longer be able to open it.')) return; try{ await shReq('POST', '/' + b.dataset.rv + '/revoke'); paint(); }catch(e){ alert(e.message); } });
        m.querySelectorAll('[data-lg]').forEach(b => b.onclick = async () => { const box = m.querySelector('#lg' + b.dataset.lg); if(box.dataset.open){ box.innerHTML = ''; box.dataset.open = ''; return; }
          try{ const l = await shReq('GET', '/' + b.dataset.lg + '/log'); box.dataset.open = '1'; box.innerHTML = l.log.length ? l.log.map(e => `<div>${esc(fmtTime(e.at))} · ${({ open: 'Opened the page', view: 'Viewed ' + esc(e.file), download: 'Downloaded ' + esc(e.file), passcode_fail: 'Wrong passcode tried' })[e.action] || esc(e.action)}${e.ip ? ' · ' + esc(e.ip) : ''}</div>`).join('') : '<div>Not opened yet.</div>'; }catch(e){ alert(e.message); } });
      };
      paint();
    }
    async function load(keepNotes){ try{ S = await get('?type=' + o.type + '&id=' + encodeURIComponent(o.id)); S.me = (o.me && o.me()) || null; const prog = keepNotes && el.querySelector('#mpp') ? el.querySelector('#mpp').innerHTML : ''; draw(); if(prog && el.querySelector('#mpp')) el.querySelector('#mpp').innerHTML = prog; }
      catch(e){ el.innerHTML = `<div class="mp"><div class="mp-h"><b>Files</b></div><div class="mp-g" style="color:var(--text-dim,#777);font-size:13px">${e.error === 'forbidden' ? 'You do not have access to these files.' : 'Files could not be loaded.'}</div></div>`; } }
    el.innerHTML = '<div class="mp"><div class="mp-h"><b>Files</b></div><div class="mp-g" style="font-size:13px;color:#777">Loading…</div></div>'; load().then(() => { if(o.pending && o.pending.length && S && S.canAdd){ const f = o.pending; o.pending = null; upload(f); } });
  }
  window.MediaPanel = { mount, collect, junk: JUNK };
})();
