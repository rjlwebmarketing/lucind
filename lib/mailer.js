// Outbound e-mail through an HTTPS API (works on any Railway plan; SMTP does not). Provider is chosen by MAIL_PROVIDER:
//   resend  -> RESEND_API_KEY      (default when a key is present)
//   memory  -> keeps messages in an array (tests)
//   console -> prints to the server log (local development)
const FROM = () => process.env.MAIL_FROM || 'Lucas Industrial <no-reply@lucasindustrial.us>';
const outbox = [];

function provider(){
  if(process.env.MAIL_PROVIDER) return process.env.MAIL_PROVIDER;
  return process.env.RESEND_API_KEY ? 'resend' : 'console';
}
async function sendMail({ to, subject, text, html }){
  const p = provider();
  if(p === 'memory'){ outbox.push({ to, subject, text, html, at: Date.now() }); return { ok: true, provider: p }; }
  if(p === 'console'){ console.log(`[mail:console] to=${to} subject=${subject}\n${text}\n`); return { ok: true, provider: p }; }
  if(p === 'resend'){
    try{
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to: [to], subject, text, html })
      });
      if(!r.ok){ const body = await r.text().catch(() => ''); console.error('[mail] resend failed', r.status, body.slice(0, 300)); return { ok: false, provider: p, status: r.status }; }
      return { ok: true, provider: p };
    }catch(e){ console.error('[mail] resend error', e.message); return { ok: false, provider: p }; }
  }
  console.error('[mail] unknown MAIL_PROVIDER', p); return { ok: false, provider: p };
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function resetEmail({ name, link, hours, invite }){
  const subject = invite ? 'Your Lucas Industrial account is ready' : 'Reset your Lucas Industrial password';
  const lead = invite ? `An account has been created for you on the Lucas Industrial system. Use the link below to choose your password.` : `We got a request to reset your password. Use the link below to choose a new one.`;
  const text = `Hi ${name || 'there'},\n\n${lead}\n\n${link}\n\nThis link works once and expires in ${hours} hours. If you did not ask for this, you can ignore this email; nothing changes until the link is used.\n\nLucas Industrial`;
  const html = `<p>Hi ${esc(name || 'there')},</p><p>${esc(lead)}</p><p><a href="${esc(link)}">${invite ? 'Choose your password' : 'Choose a new password'}</a></p><p style="color:#666">This link works once and expires in ${hours} hours. If you did not ask for this, you can ignore this email; nothing changes until the link is used.</p><p>Lucas Industrial</p>`;
  return { subject, text, html };
}
module.exports = { sendMail, resetEmail, outbox };
