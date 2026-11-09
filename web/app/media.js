/* Files panel shared by the Estimator (bids) and the PM (projects):  MediaPanel.mount(el, { type:'bid'|'project', id, api, token, me })
   Nothing is ever deleted. The Owner can HIDE a file; hidden files drop into a collapsed group at the bottom. */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const when = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const IMG = /^(jpe?g|png|gif|webp)$/, ORDER = ['Drawings', 'Bid documents', 'Contracts', 'Reports', 'Photos', 'Other'];
  const ICON = { pdf: '📄', dwg: '📐', dxf: '📐', xls: '📊', xlsx: '📊', csv: '📊', doc: '📝', docx: '📝', zip: '🗜', mp4: '🎞', mov: '🎞' };
  const css = `.mp{border:1px solid var(--line,#ddd);border-radius:10px;background:var(--panel,#fff);margin:6px 0 14px}.mp-h{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line,#ddd)}.mp-h b{font-size:14px}.mp-h .sp{flex:1}
  .mp-drop{margin:12px 14px;padding:14px;border:2px dashed var(--line,#ccc);border-radius:10px;text-align:center;font-size:12.5px;color:var(--text-dim,#666)}.mp-drop.over{border-color:var(--brand-blue,#013CAE);background:var(--panel-2,#eef)}
  .mp-g{padding:4px 14px 8px}.mp-g h4{margin:12px 0 4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-faint,#888)}
  .mp-r{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line,#eee);font-size:13px}.mp-r:first-of-type{border-top:0}.mp-r .nm{flex:1;min-width:0}.mp-r .nm a{color:var(--brand-blue,#013CAE);font-weight:600;cursor:pointer;word-break:break-all}
  .mp-r small{display:block;color:var(--text-dim,#777);font-size:11px;margin-top:1px}.mp-ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:20px;border-radius:6px;background:var(--panel-2,#eef);overflow:hidden;flex-shrink:0}.mp-ic img{width:100%;height:100%;object-fit:cover}
  .mp-tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:#FFDC4B55;margin-left:6px}.mp-hid{opacity:.65}.mp-b{border:0;background:none;color:var(--text-dim,#777);cursor:pointer;font-size:12px;padding:4px 6px;border-radius:6px}.mp-b:hover{background:var(--panel-2,#eef)}
  .mp-prog{height:5px;background:var(--line,#ddd);border-radius:3px;margin-top:6px;overflow:hidden}.mp-prog i{display:block;height:100%;width:0;background:var(--brand-blue,#013CAE)}
  .mp-lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#fff}.mp-lb img{max-width:92vw;max-height:84vh;object-fit:contain}.mp-lb button{background:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:600}`;
  if(!document.getElementById('mpcss')){ const s = document.createElement('style'); s.id = 'mpcss'; s.textContent = css; document.head.appendChild(s); }

  function mount(el, o){
    const A = o.api + '/api/media', tok = () => typeof o.token === 'function' ? o.token() : o.token, H = () => ({ Authorization: 'Bearer ' + tok() });
    const blobs = {}; let S = null, showHidden = false;
    const get = async path => { const r = await fetch(A + path, { headers: H() }); const j = await r.json().catch(() => ({})); if(!r.ok) throw Object.assign(new Error(j.error || 'failed'), j); return j; };
    const post = async (path, body) => { const r = await fetch(A + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if(!r.ok) throw Object.assign(new Error(j.error || 'failed'), j); return j; };
    const blobOf = async (f, dl) => { const r = await fetch(A + '/' + f.id + '/file' + (dl ? '?download=1' : ''), { headers: H() }); if(!r.ok) throw new Error('Could not open the file'); return URL.createObjectURL(await r.blob()); };
    async function open(f){
      try{ const u = await blobOf(f, !/^(pdf|jpe?g|png|gif|webp)$/.test(f.ext));
        if(IMG.test(f.ext)){ const lb = document.createElement('div'); lb.className = 'mp-lb'; lb.innerHTML = `<img src="${u}" alt=""><div>${esc(f.name)} <button type="button">Close</button> <button type="button" data-d>Download</button></div>`;
          lb.querySelector('button').onclick = () => lb.remove(); lb.querySelector('[data-d]').onclick = () => save(f); lb.onclick = e => { if(e.target === lb) lb.remove(); }; document.body.appendChild(lb); }
        else if(f.ext === 'pdf') window.open(u, '_blank'); else { const a = document.createElement('a'); a.href = u; a.download = f.name; a.click(); } }
      catch(e){ alert(e.message); }
    }
    async function save(f){ const u = await blobOf(f, true), a = document.createElement('a'); a.href = u; a.download = f.name; a.click(); }
    async function thumbs(){ for(const f of S.files.filter(f => IMG.test(f.ext) && f.size < 8e6).slice(0, 60)){ const t = el.querySelector(`[data-t="${f.id}"]`); if(!t) continue;
      try{ blobs[f.id] = blobs[f.id] || await blobOf(f); t.innerHTML = `<img src="${blobs[f.id]}" alt="">`; }catch(e){} } }
    function row(f){
      const mine = S.me === f.uploadedById;
      return `<div class="mp-r ${f.hidden ? 'mp-hid' : ''}"><div class="mp-ic" data-t="${f.id}">${ICON[f.ext] || '📎'}</div>
        <div class="nm"><a data-o="${f.id}">${esc(f.name)}</a>${f.fromBid ? `<span class="mp-tag">From bid</span>` : ''}${f.hidden ? '<span class="mp-tag" style="background:#ddd">Hidden</span>' : ''}
        <small>${size(f.size)} · ${esc(f.uploadedBy || 'Unknown')} · ${when(f.uploadedAt)}${f.caption ? ' · ' + esc(f.caption) : ''}${f.hidden ? ` · hidden by ${esc(f.hiddenBy)}${f.hiddenReason ? ' (' + esc(f.hiddenReason) + ')' : ''}` : ''}</small></div>
        <button class="mp-b" data-d="${f.id}" type="button" title="Download">⬇</button>
        ${mine || S.canHide ? `<button class="mp-b" data-c="${f.id}" type="button" title="Edit note">✎</button>` : ''}
        ${S.canHide ? (f.hidden ? `<button class="mp-b" data-u="${f.id}" type="button">Restore</button>` : `<button class="mp-b" data-h="${f.id}" type="button" title="Hide (Owner only). Nothing is deleted.">Hide</button>`) : ''}</div>`;
    }
    function draw(){
      const vis = S.files.filter(f => !f.hidden), hid = S.files.filter(f => f.hidden);
      const kinds = ORDER.filter(k => vis.some(f => f.kind === k)).concat([...new Set(vis.map(f => f.kind))].filter(k => !ORDER.includes(k)));
      el.innerHTML = `<div class="mp"><div class="mp-h"><b>Files</b><span class="mp-tag" style="margin:0;background:var(--panel-2,#eef)">${vis.length}</span><span class="sp"></span>
        ${S.canAdd ? `<select id="mpk" style="font-size:12px;padding:4px" title="Category for the files you add"><option value="">Category: automatic</option>${S.kinds.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select><button class="btn small primary" id="mpb" type="button">Add files</button><input type="file" id="mpf" multiple hidden>` : ''}</div>
        ${S.canAdd ? `<div class="mp-drop" id="mpd">Drag drawings, PDFs or photos here, or use “Add files”. Up to ${S.maxMb} MB each. Files are never deleted.<div id="mpp"></div></div>` : ''}
        <div class="mp-g">${kinds.length ? kinds.map(k => `<h4>${esc(k)}</h4>${vis.filter(f => f.kind === k).map(row).join('')}`).join('') : '<div style="padding:10px 0;color:var(--text-dim,#777);font-size:13px">No files yet.</div>'}
        ${hid.length ? `<h4 style="margin-top:16px"><a id="mph" style="cursor:pointer">${showHidden ? '▾' : '▸'} Hidden files (${hid.length})</a></h4>${showHidden ? hid.map(row).join('') : ''}` : ''}</div></div>`;
      el.querySelectorAll('[data-o]').forEach(a => a.onclick = () => open(S.files.find(f => f.id == a.dataset.o)));
      el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => save(S.files.find(f => f.id == b.dataset.d)));
      el.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => { const why = prompt('Why hide this file? (optional - it stays on record)'); if(why === null) return; await post('/' + b.dataset.h + '/hide', { reason: why }).catch(e => alert(e.message)); load(); });
      el.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => { await post('/' + b.dataset.u + '/unhide').catch(e => alert(e.message)); load(); });
      el.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => { const f = S.files.find(x => x.id == b.dataset.c), c = prompt('Note for this file:', f.caption || ''); if(c === null) return;
        await fetch(A + '/' + f.id, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: JSON.stringify({ caption: c }) }); load(); });
      const mph = el.querySelector('#mph'); if(mph) mph.onclick = () => { showHidden = !showHidden; draw(); };
      if(S.canAdd){ const inp = el.querySelector('#mpf'), drop = el.querySelector('#mpd');
        el.querySelector('#mpb').onclick = () => inp.click(); inp.onchange = () => upload([...inp.files]);
        ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => upload([...e.dataTransfer.files])); }
      thumbs();
    }
    function one(file){ return new Promise(res => {
      const k = el.querySelector('#mpk') ? el.querySelector('#mpk').value : '', pr = el.querySelector('#mpp'), bar = document.createElement('div'); bar.className = 'mp-prog'; bar.innerHTML = '<i></i>'; const lab = document.createElement('div'); lab.style.cssText = 'font-size:11px;margin-top:6px'; lab.textContent = file.name; pr.append(lab, bar);
      const x = new XMLHttpRequest(); x.open('POST', A + '?type=' + o.type + '&id=' + encodeURIComponent(o.id) + '&name=' + encodeURIComponent(file.name) + (k ? '&kind=' + encodeURIComponent(k) : ''));
      x.setRequestHeader('Authorization', 'Bearer ' + tok()); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => { if(e.lengthComputable) bar.firstChild.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
      x.onload = () => { let j = {}; try{ j = JSON.parse(x.responseText); }catch(e){} if(x.status === 200){ lab.textContent = '✓ ' + file.name + (j.duplicateOf ? ' (same content as ' + j.duplicateOf + ')' : ''); }
        else lab.innerHTML = '<span style="color:#D32F2F">✗ ' + esc(file.name) + ': ' + esc(x.status === 415 ? 'file type not allowed' : x.status === 413 ? 'too large' : (j.error || 'failed')) + '</span>'; res(); };
      x.onerror = () => { lab.innerHTML = '<span style="color:#D32F2F">✗ ' + esc(file.name) + ': network error</span>'; res(); }; x.send(file); }); }
    async function upload(files){ for(const f of files){ if(f.size > S.maxMb * 1048576){ const pr = el.querySelector('#mpp'); pr.insertAdjacentHTML('beforeend', `<div style="color:#D32F2F;font-size:11px;margin-top:6px">✗ ${esc(f.name)}: over ${S.maxMb} MB</div>`); continue; } await one(f); } await load(true); }
    async function load(keepNotes){ try{ S = await get('?type=' + o.type + '&id=' + encodeURIComponent(o.id)); S.me = (o.me && o.me()) || null; const prog = keepNotes && el.querySelector('#mpp') ? el.querySelector('#mpp').innerHTML : ''; draw(); if(prog && el.querySelector('#mpp')) el.querySelector('#mpp').innerHTML = prog; }
      catch(e){ el.innerHTML = `<div class="mp"><div class="mp-h"><b>Files</b></div><div class="mp-g" style="color:var(--text-dim,#777);font-size:13px">${e.error === 'forbidden' ? 'You do not have access to these files.' : 'Files could not be loaded.'}</div></div>`; } }
    el.innerHTML = '<div class="mp"><div class="mp-h"><b>Files</b></div><div class="mp-g" style="font-size:13px;color:#777">Loading…</div></div>'; load();
  }
  window.MediaPanel = { mount };
})();
