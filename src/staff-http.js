// The staff dashboards' HTTP API, /staff/api/*, as routes for src/mcp.js's server. The website's Caddy proxies
// playhorizon.dev/staff/api/* here and adds two headers: X-Staff-Proxy-Key (a secret both sides hold) and
// X-Staff-Client-Ip (the browser's address). Without the right key every route answers 404, as if it did not
// exist: the API is only reachable through the website, where the cookie is first-party. No key configured
// (STAFF_PROXY_KEY unset): no routes at all.
//
// Every route says who may call it: 'public' (the application form: the link is the proof), 'any' (logged in,
// with either dashboard), 'team', 'mod'. Roles are asked from Discord on every request (`access`), never trusted
// from the session. Writes (every POST but login, setup and the form) need the session's CSRF token in X-Staff-Csrf;
// every POST needs the website's Origin.
import { timingSafeEqual, createHash } from 'node:crypto';
import * as auth from './staff-auth.js';

export const COOKIE = '__Host-staff';
const MAX_BODY = 64 * 1024;
const PREFIX = '/staff/api/';

const sameSecret = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export function cookieOf(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}
const setCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${auth.SESSION_MAX / 1000}`;
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Failed attempts in a sliding window, per key; only failures count.
export function failures(limits = auth.LOGIN_LIMITS) {
  const hits = new Map();
  const recent = (bucket, key, now) => (hits.get(`${bucket}:${key}`) ?? []).filter((t) => t > now - limits[bucket][1]);
  return {
    blocked: (bucket, key, now = Date.now()) => recent(bucket, key, now).length >= limits[bucket][0],
    fail(bucket, key, now = Date.now()) {
      if (hits.size > 5000) for (const [k, l] of hits) if (!l.some((t) => t > now - auth.HOUR)) hits.delete(k);
      hits.set(`${bucket}:${key}`, [...recent(bucket, key, now), now]);
    },
    retryAfter: (bucket, key, now = Date.now()) => {
      const l = recent(bucket, key, now);
      return l.length ? Math.max(1, Math.ceil((l[0] + limits[bucket][1] - now) / 1000)) : 0;
    },
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

// routes: { store, key, origin, access(userId) → { name, dashboards: ['team', 'mod'] } | null (no role, or not on
// the server), log(text) (one line for #mod-log; never secrets), extra: [{ method, path, role, handler(ctx) }] }.
// A handler returns { status?, body, headers? }; ctx: { user, name, dashboards, body, query, ip, now }.
export function staffRoutes({ store, key, origin = 'https://playhorizon.dev', access, log = () => {}, extra = [], limits = failures(), now = () => Date.now() }) {
  if (!key || String(key).length < 32) return {};

  const me = (user, a, sess) => ({ user, name: a.name, dashboards: a.dashboards, csrf: sess.csrf });

  async function login(ctx, req, res) {
    const name = String(ctx.body.name ?? '').trim().toLowerCase().slice(0, 64);
    if (limits.blocked('staffIp', ctx.ip) || limits.blocked('staffUser', name)) {
      const wait = Math.max(limits.retryAfter('staffIp', ctx.ip), limits.retryAfter('staffUser', name));
      return send(res, 429, { error: 'Too many failed attempts. Try again later.' }, { 'Retry-After': String(wait) });
    }
    const r = await auth.login(store, { name, password: ctx.body.password }, ctx.now);
    const a = r.ok ? await access(r.user) : null;
    if (!r.ok || !a?.dashboards.length) {
      if (r.ok) auth.logout(store, r.token);
      limits.fail('staffIp', ctx.ip);
      limits.fail('staffUser', name);
      console.log(`staff login refused for "${name}" from ${ctx.ip}${r.ok ? ' (no dashboard role)' : ''}`);
      return send(res, 401, { error: r.ok ? 'This account has no dashboard role any more.' : 'Wrong username or password.' });
    }
    log(`🔑 Staff login: <@${r.user}> (${a.dashboards.join(', ')})`);
    return send(res, 200, me(r.user, a, r), { 'Set-Cookie': setCookie(r.token) });
  }

  // { token } → who the link is for, without using it.
  async function setupPeek(ctx, req, res) {
    if (limits.blocked('staffIp', ctx.ip)) return send(res, 429, { error: 'Too many failed attempts. Try again later.' }, { 'Retry-After': String(limits.retryAfter('staffIp', ctx.ip)) });
    const link = auth.peekLink(store, ctx.body.token, 'password', ctx.now);
    if (!link) { limits.fail('staffIp', ctx.ip); return send(res, 404, { error: 'This link is unknown, used or expired. Ask Kira for a new one: /staff password.' }); }
    const a = await access(link.user);
    if (!a?.dashboards.length) return send(res, 403, { error: 'This account has no dashboard role.' });
    return send(res, 200, { name: a.name, expiresAt: link.expiresAt });
  }

  // { token, password } → the password is set, the link used up, and the member logged in.
  async function setup(ctx, req, res) {
    if (limits.blocked('staffIp', ctx.ip)) return send(res, 429, { error: 'Too many failed attempts. Try again later.' }, { 'Retry-After': String(limits.retryAfter('staffIp', ctx.ip)) });
    const link = auth.peekLink(store, ctx.body.token, 'password', ctx.now);
    if (!link) { limits.fail('staffIp', ctx.ip); return send(res, 404, { error: 'This link is unknown, used or expired. Ask Kira for a new one: /staff password.' }); }
    const a = await access(link.user);
    if (!a?.dashboards.length) return send(res, 403, { error: 'This account has no dashboard role.' });
    const problem = auth.passwordProblem(ctx.body.password, a.name);
    if (problem) return send(res, 400, { error: problem });
    if (!auth.useLink(store, ctx.body.token, 'password', ctx.now)) return send(res, 404, { error: 'This link was just used.' });
    await auth.setPassword(store, { user: link.user, name: a.name, password: ctx.body.password }, ctx.now);
    const r = await auth.login(store, { name: a.name, password: ctx.body.password }, ctx.now);
    log(`🔑 Staff password set: <@${link.user}>`);
    return send(res, 200, me(link.user, a, r), { 'Set-Cookie': setCookie(r.token) });
  }

  const builtIn = [
    { method: 'POST', path: 'login', role: 'public', raw: login },
    { method: 'POST', path: 'setup/peek', role: 'public', raw: setupPeek },
    { method: 'POST', path: 'setup', role: 'public', raw: setup },
    { method: 'GET', path: 'me', role: 'any', handler: (ctx) => ({ body: { user: ctx.user, name: ctx.name, dashboards: ctx.dashboards, csrf: ctx.csrf } }) },
    { method: 'POST', path: 'logout', role: 'any', raw: (ctx, req, res) => { auth.logout(store, ctx.token); send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }); } },
    { method: 'POST', path: 'logout-all', role: 'any', raw: (ctx, req, res) => {
      const n = auth.logoutAll(store, ctx.user);
      log(`🔑 Staff: <@${ctx.user}> signed out everywhere (${n} sessions)`);
      send(res, 200, { ok: true, sessions: n }, { 'Set-Cookie': clearCookie });
    } },
  ];

  const routes = {};
  for (const r of [...builtIn, ...extra]) {
    routes[`${r.method} ${PREFIX}${r.path}`] = async (req, res) => {
      try {
        // Only through the website's proxy.
        if (!sameSecret(req.headers['x-staff-proxy-key'] ?? '', key)) return send(res, 404, { error: 'not found' });
        const ip = String(req.headers['x-staff-client-ip'] ?? '').trim().slice(0, 64) || 'unknown';
        const at = now();
        if (r.method === 'POST' && req.headers.origin !== origin) return send(res, 403, { error: 'Wrong origin.' });
        const url = new URL(req.url, 'http://x');
        const body = r.method === 'POST' ? await readJson(req) : {};
        const ctx = { body, query: Object.fromEntries(url.searchParams), ip, now: at };
        if (r.role !== 'public') {
          const token = cookieOf(req);
          const sess = auth.session(store, token, at);
          if (!sess) return send(res, 401, { error: 'Not logged in.' }, token ? { 'Set-Cookie': clearCookie } : {});
          const a = await access(sess.user);
          if (!a?.dashboards.length) { auth.logoutAll(store, sess.user); return send(res, 401, { error: 'Not logged in.' }, { 'Set-Cookie': clearCookie }); }
          if (r.role !== 'any' && !a.dashboards.includes(r.role)) return send(res, 403, { error: 'Not for your role.' });
          if (r.method === 'POST' && !auth.csrfOk(sess, req.headers['x-staff-csrf'])) return send(res, 403, { error: 'Missing or wrong CSRF token: reload the page.' });
          Object.assign(ctx, { user: sess.user, name: a.name, dashboards: a.dashboards, csrf: sess.csrf, token });
        }
        if (r.raw) return await r.raw(ctx, req, res);
        const out = await r.handler(ctx);
        return send(res, out.status ?? 200, out.body, out.headers);
      } catch (e) {
        if (e.status) return send(res, e.status, { error: e.status === 413 ? 'Request too large.' : 'Bad request.' });
        if (e.expose) return send(res, 400, { error: e.message });
        console.error('staff', r.path, e.message);
        if (!res.headersSent) send(res, 500, { error: 'Internal error.' });
      }
    };
  }
  return routes;
}
