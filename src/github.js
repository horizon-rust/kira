// A small GitHub REST client for Kira's issues feature. Writes are only logged in dry-run mode.
//
// The token is a fine-grained one of Ludovic's, so every call Kira makes comes out of his 5000 an hour, which his
// agents and merge scripts need too. Two things keep Kira's share small:
// - GETs are conditional (If-None-Match with the last ETag): GitHub doesn't count a 304 answer, so a board refresh
//   that finds nothing new is almost free.
// - Below KEEP calls left in the hour, GETs stop until the hour resets (writes still go: they are a person's
//   command). The board just waits for the next refresh.
export const KEEP = Number(process.env.KIRA_GITHUB_KEEP ?? 1500);
const CACHE_MAX = 2000;

// Shared by every client in the process: they all spend the same token's hour.
const budget = { remaining: Infinity, reset: 0 };
export const _budget = budget; // for tests

export function makeGitHub({ token, dryRun = false, fetchImpl = fetch, log = console.log } = {}) {
  const cache = new Map(); // GET path → { etag, body }
  async function call(method, path, body) {
    const get = method === 'GET';
    if (get && token && budget.remaining < KEEP && Date.now() < budget.reset) {
      throw new Error(`GitHub GET ${path}: holding back, ${budget.remaining} calls left until ${new Date(budget.reset).toISOString()}`);
    }
    const cached = get ? cache.get(path) : undefined;
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Kira (Discord bot of ludovic\'s server)',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cached ? { 'If-None-Match': cached.etag } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    // Only the core pool is the shared hour: the search API has its own 30 a minute, and its small number must
    // not make every other GET hold back.
    const left = res.headers?.get?.('x-ratelimit-remaining');
    const resource = res.headers?.get?.('x-ratelimit-resource');
    if (left != null && (resource == null || resource === 'core')) {
      budget.remaining = Number(left);
      budget.reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    }
    if (res.status === 304 && cached) return cached.body;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = res.status === 204 ? {} : await res.json();
    const etag = get ? res.headers?.get?.('etag') : null;
    if (etag) {
      cache.delete(path); // re-inserted last: the oldest entry goes first when the cache is full
      cache.set(path, { etag, body: data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return data;
  }
  return {
    dryRun,
    get: (path) => call('GET', path),
    async write(method, path, body) {
      if (dryRun) {
        log(`github dry-run: ${method} ${path} ${body ? JSON.stringify(body).slice(0, 600) : ''}`);
        return null;
      }
      return call(method, path, body);
    },
  };
}
