import {createHmac, timingSafeEqual, createHash} from 'node:crypto';
import {check} from './domain.js';
const digest = value => createHash('sha256').update(value).digest();
export const safeEqual = (a,b) => timingSafeEqual(digest(a),digest(b));
function secret() {
  check(process.env.ADMIN_PASSWORD?.length >= 12 && process.env.SESSION_SECRET?.length >= 32,
    'Set ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters) on the server', 503);
  return process.env.SESSION_SECRET;
}
function sign(payload) {return createHmac('sha256', secret()).update(payload).digest('base64url');}
export function token() {const payload = Buffer.from(JSON.stringify({expires:Date.now()+8*60*60*1000})).toString('base64url');return `${payload}.${sign(payload)}`;}
export function authenticated(req) {
  secret();
  const cookie = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('jms_session='));
  const [payload,sig] = (cookie?.slice(12) || '').split('.');
  if (!payload || !sig || !safeEqual(sign(payload),sig)) return false;
  try {return JSON.parse(Buffer.from(payload,'base64url').toString()).expires > Date.now();} catch {return false;}
}
export function cookie(value, clear = false) {
  return `jms_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 28800}${process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function validPassword(password) {secret();return typeof password === 'string' && safeEqual(password,process.env.ADMIN_PASSWORD);}
