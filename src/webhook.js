// GitHub's webhook, for every feature: POST /github/webhook (signed with KIRA_GITHUB_WEBHOOK_SECRET) checks each
// delivery, then hands it to every listener (`on`). Features use it to act at once (/notify's DMs, the board's refresh,
// releases, forum answers, the website's revalidation) and keep their polling only as a slow fallback while deliveries
// keep coming (`healthy`). No Discord here.
import { clientIp } from './agents.js';
import { signatureOk } from './notify-kit.js';

const MAX_BODY = 10 * 1024 * 1024; // GitHub sends at most 25 MB; the events Kira reads are far smaller
export const HEALTHY_MS = 30 * 60_000; // a delivery this recent: the webhook works, polling can slow down

const listeners = [];
let lastDelivery = 0;
const deliveries = new Set(); // X-GitHub-Delivery ids already handled (GitHub redelivers on a timeout)

// `fn(name, payload)`: called for every checked delivery, in the order listeners were added. Errors are logged.
export const on = (fn) => void listeners.push(fn);
export const configured = (env = process.env) => !!env.KIRA_GITHUB_WEBHOOK_SECRET?.trim();
// The webhook is set up and delivered something lately: polling only as a fallback.
export const healthy = (now = Date.now()) => configured() && now - lastDelivery < HEALTHY_MS;
// The slower of two intervals while the webhook is healthy.
export const every = (fastMs, slowMs, now = Date.now()) => (healthy(now) ? slowMs : fastMs);

export async function emit(name, payload) {
  for (const fn of listeners) {
    try {
      await fn(name, payload);
    } catch (e) {
      console.error('webhook listener', name, e.message);
    }
  }
}

// At most one run every `gapMs`: a call inside the gap schedules one run at its end (a stream of deliveries, a check
// run every few seconds, gives one run a minute, not none). `delayMs`: the first run waits that long too.
export function throttle(fn, gapMs, { delayMs = 0, now = () => Date.now(), timers = { set: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; } } } = {}) {
  let last = -Infinity;
  let timer = null;
  return function poke() {
    if (timer) return;
    const wait = Math.max(delayMs, last + gapMs - now());
    timer = timers.set(async () => {
      timer = null;
      last = now();
      try { await fn(); } catch (e) { console.error('webhook throttle', e.message); }
    }, wait);
  };
}

// The repository a delivery is about, and whether it is the default branch being pushed.
export const repoOf = (p) => p?.repository?.name ?? null;
export const pushToMain = (name, p) => name === 'push' && p?.ref === `refs/heads/${p?.repository?.default_branch ?? 'main'}`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

// POST /github/webhook (only with a secret). `owner`: deliveries from another account's repositories are dropped.
// Bad signatures count in the "auth" rate limit.
export function routes({ limiter, owner, secret = process.env.KIRA_GITHUB_WEBHOOK_SECRET?.trim(), now = () => Date.now() } = {}) {
  if (!secret) return {};
  const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  return {
    'POST /github/webhook': async (req, res) => {
      let body;
      try { body = await readBody(req); } catch (e) { return reply(res, e.status ?? 400, { error: 'bad body' }); }
      if (!signatureOk(secret, body, req.headers['x-hub-signature-256'])) {
        const limited = limiter && !limiter.take(clientIp(req), 'auth');
        return reply(res, limited ? 429 : 401, { error: limited ? 'too many attempts' : 'bad signature' });
      }
      lastDelivery = now();
      const id = String(req.headers['x-github-delivery'] ?? '');
      if (id && deliveries.has(id)) return reply(res, 200, { ok: true, duplicate: true });
      if (id) { deliveries.add(id); if (deliveries.size > 2000) deliveries.delete(deliveries.values().next().value); }
      let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { return reply(res, 400, { error: 'not JSON' }); }
      const name = String(req.headers['x-github-event'] ?? '');
      reply(res, 202, { ok: true }); // GitHub waits 10 s at most: the work goes on after the answer
      const from = payload?.repository?.owner?.login ?? payload?.organization?.login;
      if (owner && from && from.toLowerCase() !== owner.toLowerCase()) return;
      await emit(name, payload);
    },
  };
}

export const _test = { reset() { listeners.length = 0; lastDelivery = 0; deliveries.clear(); }, setLast: (t) => { lastDelivery = t; } };
