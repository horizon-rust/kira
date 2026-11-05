// Logins for the staff dashboards: passwords each member sets through a one-time link Kira DMs them, sessions,
// and the links themselves (setting a password, and applying: src/applications.js). No Discord, no network.
//
// Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt), never stored or logged in clear. Links and sessions are 32
// random bytes (base64url) of which only the SHA-256 is kept. Who may log in (the roles) is checked by the caller
// on every request; this file only knows accounts.
import { randomBytes, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const SESSION_IDLE = 12 * HOUR;
export const SESSION_MAX = 7 * DAY;
export const LINK_TTL = { password: 30 * MIN, apply: DAY };
// Failed logins: per account and per address (rateLimiter buckets in src/agents.js).
export const LOGIN_LIMITS = { staffUser: [5, 15 * MIN], staffIp: [20, MIN] };

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password, stored) {
  const [kind, N, r, p, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt' || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(String(password).normalize('NFC'), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(want, got);
}
// Checked against when the name is unknown, so a wrong name takes as long as a wrong password.
const DUMMY = hashPassword(secret());

// Why a new password is refused (null: fine).
export function passwordProblem(password, name = '') {
  const p = String(password ?? '');
  if ([...p].length < 12) return 'At least 12 characters.';
  if (p.length > 200) return 'At most 200 characters.';
  if (name && p.toLowerCase().includes(String(name).toLowerCase())) return 'It must not contain your username.';
  return null;
}

// A one-time link's token for `user`. `purpose`: 'password' or 'apply' (with `role`). A new link voids the one
// before it for the same purpose (and role).
export function issueLink(store, { user, purpose, role = null, by = user }, now = Date.now()) {
  const token = secret();
  store.update((d) => {
    for (const [h, l] of Object.entries(d.links)) {
      if ((l.user === user && l.purpose === purpose && l.role === role) || l.expiresAt <= now) delete d.links[h];
    }
    d.links[sha(token)] = { user, purpose, role, by, createdAt: now, expiresAt: now + LINK_TTL[purpose] };
  });
  return { token, expiresAt: now + LINK_TTL[purpose] };
}

// The link behind a token, without using it up (null: unknown, expired, or another purpose).
export function peekLink(store, token, purpose, now = Date.now()) {
  if (!TOKEN.test(String(token))) return null;
  const l = store.data.links[sha(token)];
  return l && l.purpose === purpose && l.expiresAt > now ? { user: l.user, role: l.role, by: l.by, expiresAt: l.expiresAt } : null;
}

// Uses a link up: it works once.
export function useLink(store, token, purpose, now = Date.now()) {
  const link = peekLink(store, token, purpose, now);
  if (link) store.update((d) => { delete d.links[sha(token)]; });
  return link;
}

// Sets `user`'s password (the link was checked by the caller) and ends their other sessions.
export async function setPassword(store, { user, name, password }, now = Date.now()) {
  const problem = passwordProblem(password, name);
  if (problem) return { ok: false, why: problem };
  const hash = await hashPassword(password);
  store.update((d) => {
    d.accounts[user] = { name: String(name).toLowerCase(), hash, setAt: now };
    for (const [h, s] of Object.entries(d.sessions)) if (s.user === user) delete d.sessions[h];
  });
  return { ok: true };
}

const accountByName = (store, name) => Object.entries(store.data.accounts).find(([, a]) => a.name === String(name ?? '').trim().toLowerCase());

// Name + password → a new session ({ ok, user, token, csrf }) or { ok: false }. The same answer and about the same
// time whether the name or the password is wrong. Rate limits are the caller's.
export async function login(store, { name, password }, now = Date.now()) {
  const hit = accountByName(store, name);
  const good = await checkPassword(String(password ?? ''), hit ? hit[1].hash : await DUMMY);
  if (!hit || !good) return { ok: false };
  const token = secret();
  const csrf = secret();
  store.update((d) => {
    for (const [h, s] of Object.entries(d.sessions)) if (expired(s, now)) delete d.sessions[h];
    d.sessions[sha(token)] = { user: hit[0], csrf, createdAt: now, seenAt: now };
  });
  return { ok: true, user: hit[0], token, csrf };
}

const expired = (s, now) => now - s.seenAt > SESSION_IDLE || now - s.createdAt > SESSION_MAX;

// The session behind a cookie ({ user, csrf, createdAt }) or null. Marks it seen (written at most once a minute).
export function session(store, token, now = Date.now()) {
  if (!TOKEN.test(String(token ?? ''))) return null;
  const h = sha(token);
  const s = store.data.sessions[h];
  if (!s) return null;
  if (expired(s, now)) { store.update((d) => { delete d.sessions[h]; }); return null; }
  if (now - s.seenAt > MIN) store.update(() => { s.seenAt = now; });
  return { user: s.user, csrf: s.csrf, createdAt: s.createdAt };
}

export const csrfOk = (sess, header) => {
  const a = Buffer.from(String(sess?.csrf ?? ''));
  const b = Buffer.from(String(header ?? ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

export function logout(store, token) {
  if (TOKEN.test(String(token ?? ''))) store.update((d) => { delete d.sessions[sha(token)]; });
}

// Every session of `user` (sign out everywhere). Returns how many.
export function logoutAll(store, user) {
  return store.update((d) => {
    let n = 0;
    for (const [h, s] of Object.entries(d.sessions)) if (s.user === user) { delete d.sessions[h]; n++; }
    return n;
  });
}

// `user` lost every role that opens a dashboard, or left: password, sessions and password links go. Returns
// whether there was anything to remove.
export function forget(store, user) {
  const d = store.data;
  const had = !!d.accounts[user] || Object.values(d.sessions).some((s) => s.user === user) || Object.values(d.links).some((l) => l.user === user && l.purpose === 'password');
  if (!had) return false;
  store.update((d) => {
    delete d.accounts[user];
    for (const [h, s] of Object.entries(d.sessions)) if (s.user === user) delete d.sessions[h];
    for (const [h, l] of Object.entries(d.links)) if (l.user === user && l.purpose === 'password') delete d.links[h];
  });
  return true;
}
