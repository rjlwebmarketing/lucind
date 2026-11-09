// The page an outside person sees when they open a share link. Plain HTML, no scripts, no logins, nothing but the files they were sent.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const size = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const when = ms => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const CSS = `*{box-sizing:border-box}body{margin:0;background:#f3f3f1;color:#1d1d1d;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.w{max-width:620px;margin:0 auto;padding:28px 16px 60px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px;font-weight:800;letter-spacing:.04em;font-size:15px;color:#013CAE}
.card{background:#fff;border:1px solid #dcdcd8;border-radius:14px;padding:22px}h1{font-size:20px;margin:0 0 6px}.sub{color:#5b5b57;font-size:14px;margin:0 0 16px}
.note{background:#f7f6f0;border-left:4px solid #FFDC4B;border-radius:6px;padding:10px 12px;margin:0 0 16px;font-size:14.5px;white-space:pre-wrap}
.f{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid #ececea}.f:first-of-type{border-top:0}.f .n{flex:1;min-width:0;word-break:break-word}.f small{display:block;color:#6b6b66;font-size:12.5px}
a.b,button.b{display:inline-block;border:0;border-radius:9px;padding:9px 14px;font:600 14px/1 inherit;font-family:inherit;text-decoration:none;cursor:pointer;background:#013CAE;color:#fff}a.b.g{background:#eef0f6;color:#013CAE}
input[type=password]{width:100%;padding:11px 12px;border:1px solid #bdbdb8;border-radius:9px;font-size:16px;margin:6px 0 12px}.err{color:#b3261e;font-size:14px;margin:0 0 10px}.foot{margin-top:18px;color:#7a7a75;font-size:12.5px;text-align:center}`;
const shell = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="w"><div class="brand">LUCAS INDUSTRIAL</div>${inner}<div class="foot">Lucas Industrial, LLC · Murfreesboro, TN · (615) 209-0188</div></div></body></html>`;
// state: 'files' | 'passcode' | 'gone'
function render(o){
  if(o.state === 'gone') return shell('Link not available', `<div class="card"><h1>This link is no longer available</h1><p class="sub">It may have expired or been withdrawn. Please contact the person who sent it to you for a new one.</p></div>`);
  if(o.state === 'passcode') return shell('Enter passcode', `<div class="card"><h1>Enter the passcode</h1><p class="sub">${o.from ? esc(o.from) + ' at Lucas Industrial shared ' + (o.count === 1 ? 'a file' : o.count + ' files') + ' with you.' : 'Files have been shared with you.'} Enter the passcode you were given to open ${o.count === 1 ? 'it' : 'them'}.</p>
    ${o.error ? '<p class="err">' + esc(o.error) + '</p>' : ''}<form method="post" action="${esc(o.action)}" autocomplete="off"><label for="pc">Passcode</label><input id="pc" name="passcode" type="password" autofocus required><button class="b" type="submit">Open</button></form></div>`);
  const rows = o.files.map(f => `<div class="f"><div class="n"><b>${esc(f.name)}</b><small>${size(f.size)}</small></div><a class="b g" href="${esc(f.viewUrl)}" target="_blank" rel="noopener">View</a>${o.allowDownload ? `<a class="b" href="${esc(f.downloadUrl)}">Download</a>` : ''}</div>`).join('');
  return shell('Shared files', `<div class="card"><h1>${o.files.length === 1 ? 'A file' : o.files.length + ' files'} shared with you${o.recipient ? ', ' + esc(o.recipient) : ''}</h1><p class="sub">${o.from ? 'From ' + esc(o.from) + ', Lucas Industrial. ' : ''}Available until ${esc(when(o.expiresAt))}.</p>${o.note ? '<div class="note">' + esc(o.note) + '</div>' : ''}${rows}</div>`);
}
module.exports = { render };
