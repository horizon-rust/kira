// The Horizon launcher's GitHub reads, when GitHub turns it away: GET /github/public/<API path>.
// Players behind a shared address (a school, a dorm, a carrier's NAT) run out of GitHub's 60 anonymous API calls an
// hour together, and then can't install or update (launcher/src/github.rs in horizon). The launcher asks GitHub
// first and comes here only after a rate-limit answer or no answer at all.
// Public and read-only: no token, only GETs of the few release reads the launcher makes, only on horizon-rust/horizon
// (a public repository). Each answer is kept TTL_MS, so a crowd of launchers costs one GitHub call per path a minute;
// the GitHub client behind it (makePublicGitHub) revalidates with ETags (a 304 is free) and keeps its own reserve.
// Each address may ask 60 times a minute (the launcherGithub bucket, src/agents.js LIMITS).
import { makePublicGitHub } from './github.js';
import { appToken } from './github-app.js';
import { clientIp } from './agents.js';

export const PREFIX = '/github/public';
export const TTL_MS = 60_000;
const MAX_KEPT = 500;
const NAME = '[A-Za-z0-9._@-]{1,100}';
// The reads the launcher makes (launcher/src/backend.rs, launcher/src/native_mods.rs): the release list, one release
// by tag, the newest tags with a prefix (launcher tags), and the commit a tag or Nightly was built from.
const PATHS = [
  /^\/repos\/horizon-rust\/horizon\/releases$/,
  /^\/repos\/horizon-rust\/horizon\/releases\/latest$/,
  new RegExp(`^/repos/horizon-rust/horizon/releases/tags/${NAME}$`),
  new RegExp(`^/repos/horizon-rust/horizon/git/matching-refs/tags/${NAME}$`),
  new RegExp(`^/repos/horizon-rust/horizon/commits/${NAME}$`),
];
const QUERY = new Set(['per_page', 'page']);

// The GitHub API path (with its sorted query) a request may read, or null.
export function target(url) {
  let u;
  let path;
  try {
    u = new URL(url, 'http://x');
    path = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (!path.startsWith(`${PREFIX}/`)) return null;
  path = path.slice(PREFIX.length);
  if (path.includes('..') || !PATHS.some((re) => re.test(path))) return null;
  const q = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (!QUERY.has(k) || !/^\d{1,3}$/.test(v)) return null;
    q.append(k, v);
  }
  q.sort();
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

// The routes: one prefix route (src/mcp.js matches `GET /prefix/*`). `gh`: a GitHub client with get(path) → JSON or
// null for a 404 (tests pass a fake); `now`: the clock.
export function routes({ limiter, gh = null, now = () => Date.now() } = {}) {
  const kept = new Map(); // path → { at, status, body }
  const reply = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? `public, max-age=${TTL_MS / 1000}` : 'no-store', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const handler = async (req, res) => {
    const ip = clientIp(req);
    if (limiter && !limiter.take(ip, 'launcherGithub')) {
      return reply(res, 429, { error: 'too many requests' }, { 'Retry-After': String(limiter.retryAfter(ip, 'launcherGithub')) });
    }
    const path = target(req.url);
    if (!path) return reply(res, 404, { error: 'not allowed' });
    const hit = kept.get(path);
    if (hit && now() - hit.at < TTL_MS) return reply(res, hit.status, hit.body);
    try {
      gh ??= makePublicGitHub({ appToken: appToken() });
      const data = await gh.get(path);
      const entry = data === null ? { status: 404, body: '{"error":"not found"}' } : { status: 200, body: JSON.stringify(data) };
      kept.delete(path);
      kept.set(path, { at: now(), ...entry });
      if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
      return reply(res, entry.status, entry.body);
    } catch (e) {
      console.error('launcher github', path, e.message);
      // GitHub is down or Kira's hour is spent: an older answer beats none.
      if (hit) return reply(res, hit.status, hit.body);
      return reply(res, 502, { error: 'GitHub did not answer' });
    }
  };
  return { [`GET ${PREFIX}/*`]: handler };
}
