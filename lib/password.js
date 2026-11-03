// Passwords: scrypt (built into Node, no extra package). Stored as scrypt$N$salt$hash. Never stored or logged in plain text.
const crypto = require('crypto');
const N = 16384, R = 8, P = 1, KEYLEN = 32;
const COMMON = new Set(['password', 'password1', 'password123', 'passw0rd', 'letmein123', 'welcome123', 'qwerty12345', 'lucasindustrial', 'lucas1234', 'admin12345', '1234567890', 'changeme123']);

function scrypt(pw, salt, n){
  return new Promise((res, rej) => crypto.scrypt(pw, salt, KEYLEN, { N: n, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
}
async function hashPassword(pw){
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, N);
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored){
  try{
    const [alg, n, saltHex, hashHex] = String(stored || '').split('$');
    if(alg !== 'scrypt') return false;
    const key = await scrypt(String(pw), Buffer.from(saltHex, 'hex'), Number(n));
    const want = Buffer.from(hashHex, 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  }catch(e){ return false; }
}
// A throwaway hash so "no such account" costs the same time as "wrong password" (no account guessing by timing).
let DUMMY = null;
async function burnTime(pw){ if(!DUMMY) DUMMY = await hashPassword('dummy-' + crypto.randomBytes(6).toString('hex')); await verifyPassword(pw, DUMMY); }

// Returns an error message, or '' if the password is acceptable.
function passwordProblem(pw, email){
  const p = String(pw || '');
  if(p.length < 10) return 'Use at least 10 characters.';
  if(p.length > 200) return 'That password is too long.';
  if(COMMON.has(p.toLowerCase())) return 'That password is too common. Pick something less guessable.';
  if(email && p.toLowerCase() === String(email).toLowerCase()) return 'The password cannot be your email address.';
  if(/^(.)\1+$/.test(p)) return 'Pick something less repetitive.';
  return '';
}
function randomPassword(){
  // readable, no look-alike characters
  const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(14); let out = '';
  for(const x of b) out += alpha[x % alpha.length];
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12) + '-' + out.slice(12);
}
module.exports = { hashPassword, verifyPassword, burnTime, passwordProblem, randomPassword };
