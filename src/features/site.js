// The website follows GitHub within a minute (Xmilon, 2026-11-01: "commits on the site don't update"). playhorizon.dev
// caches what it reads from GitHub for 15 minutes or more; when GitHub's webhook (src/webhook.js) says something it
// shows changed, Kira calls the site's POST /api/revalidate with the cache tags of that data (horizon-site's
// components/github-fresh.ts), then loads the pages that show it once so the next visitor gets them fresh, and has
// #updates read the journal again. Off without KIRA_SITE_REVALIDATE_SECRET.
import { GITHUB, SITE } from '../config.js';
import { timingSafeEqual } from 'node:crypto';
import * as webhook from '../webhook.js';
import { makePublicGitHub } from '../github.js';
import { appToken } from '../github-app.js';
import { clientIp } from '../agents.js';

const SECRET = process.env.KIRA_SITE_REVALIDATE_SECRET?.trim() || null;
export const enabled = !!SECRET;
const DRY = process.env.KIRA_SITE_DRY_RUN === '1';
const ACTIONS_THAT_SHOW = new Set(['opened', 'closed', 'reopened', 'edited', 'labeled', 'unlabeled', 'ready_for_review', 'converted_to_draft', 'deleted', 'transferred']);

// A delivery → the site's tags it changes.
export function tagsFor(name, p) {
  const repo = webhook.repoOf(p);
  if (String(p?.repository?.owner?.login ?? GITHUB.owner).toLowerCase() !== GITHUB.owner.toLowerCase()) return [];
  if (repo === 'horizon') {
    if (webhook.pushToMain(name, p)) return ['github:horizon:main'];
    if ((name === 'issues' || name === 'pull_request') && ACTIONS_THAT_SHOW.has(p.action)) return ['github:horizon:issues'];
    if (name === 'release') return ['github:horizon:releases'];
  }
  if (repo === 'horizon-mods' && webhook.pushToMain(name, p)) return ['github:horizon-mods:main'];
  return [];
}

let fetchImpl = (...a) => fetch(...a);
let afterWarm = () => {};
async function revalidate(tags) {
  if (DRY) return void console.log(`site dry-run: revalidate ${tags.join(', ')}`);
  const res = await fetchImpl(`${SITE.url}/api/revalidate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', 'User-Agent': 'Kira' },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`site revalidate: HTTP ${res.status}`);
  const paths = [...new Set(tags.flatMap((t) => SITE.warm[t] ?? []))];
  for (const path of paths) await fetchImpl(`${SITE.url}${path}`, { headers: { 'User-Agent': 'Kira (warming the cache)' }, signal: AbortSignal.timeout(30_000) }).then((r) => r.arrayBuffer?.()).catch(() => {});
  console.log(`site: revalidated ${tags.join(', ')}; ${paths.length} pages loaded`);
  afterWarm(tags);
}

// One throttle per tag: a busy hour of pushes and issues makes at most one call every SITE.gapMs for each.
const pending = new Map(); // tag → throttled call
function poke(tag, delayMs = 0) {
  const key = `${tag}:${delayMs}`;
  if (!pending.has(key)) pending.set(key, webhook.throttle(() => revalidate([tag]).catch((e) => console.error(e.message)), SITE.gapMs, { delayMs }));
  pending.get(key)();
}

export function onDelivery(name, p) {
  for (const tag of tagsFor(name, p)) {
    poke(tag);
    // The mod registry's index is rebuilt by GitHub Pages after the push: once more when it's out.
    if (tag === 'github:horizon-mods:main') poke(tag, SITE.modsDelayMs);
  }
}

if (enabled) webhook.on(onDelivery);

// After a revalidation: what else follows the fresh data (#updates reads the journal).
export const afterRevalidate = (fn) => { afterWarm = fn; };

export function setup() {
  console.log(`site: ${enabled ? `revalidates ${SITE.url} on GitHub's webhook${DRY ? ' (dry run)' : ''}` : 'off (KIRA_SITE_REVALIDATE_SECRET is not set)'}`);
}

// ── The site's GitHub reads, through Kira ─────────────────────────────────────
// The site has no GitHub token of its own (60 requests an hour for Railway's address): with revalidations on every
// change it would run out. It reads through GET /github/proxy/<API path> instead, with the same bearer secret: Kira's
// GitHub App client with its ETag cache (a 304 costs nothing) and its public reserve (src/github.js makePublicGitHub).
// Only the few public reads the site makes are allowed.
const PROXY_PATH = /^\/repos\/horizon-rust\/(horizon|horizon-mods)\/(issues|releases|releases\/latest|contributors|commits\/main)$/;
const PROXY_QUERY = new Set(['state', 'sort', 'direction', 'per_page', 'page']);
let proxyGh = null;
// The API path a proxy request may read, or null.
export function proxyTarget(url) {
  const u = new URL(url, 'http://x');
  const path = u.pathname.replace(/^\/github\/proxy/, '');
  if (!PROXY_PATH.test(path)) return null;
  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (!PROXY_QUERY.has(k) || !/^[\w-]{1,20}$/.test(v)) return null;
    q.append(k, v);
  }
  q.sort();
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}
const bearerOk = (header) => {
  const got = Buffer.from(String(header ?? '').startsWith('Bearer ') ? String(header).slice(7).trim() : '');
  const want = Buffer.from(SECRET ?? '');
  return !!SECRET && got.length === want.length && timingSafeEqual(got, want);
};
export function routes({ limiter } = {}) {
  if (!SECRET) return {};
  proxyGh ??= makePublicGitHub({ appToken: appToken() });
  const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const handler = async (req, res) => {
    if (!bearerOk(req.headers.authorization)) {
      const limited = limiter && !limiter.take(clientIp(req), 'auth');
      return reply(res, limited ? 429 : 401, { error: limited ? 'too many attempts' : 'unauthorized' });
    }
    const target = proxyTarget(req.url);
    if (!target) return reply(res, 404, { error: 'not allowed' });
    try {
      const accept = req.headers['x-github-accept'] === 'full' ? 'application/vnd.github.full+json' : null;
      const data = await proxyGh.get(target, accept ? { accept } : undefined);
      if (data === null) return reply(res, 404, { error: 'not found' });
      return reply(res, 200, data);
    } catch (e) {
      console.error('site proxy', target, e.message);
      return reply(res, 502, { error: 'GitHub did not answer' });
    }
  };
  const out = {};
  for (const repo of ['horizon', 'horizon-mods']) {
    for (const what of ['issues', 'releases', 'releases/latest', 'contributors', 'commits/main']) out[`GET /github/proxy/repos/horizon-rust/${repo}/${what}`] = handler;
  }
  return out;
}

export const commands = [];
export const handlers = {};
export const _test = { setFetch: (f) => { fetchImpl = f; }, revalidate, setProxyGitHub: (g) => { proxyGh = g; } };
