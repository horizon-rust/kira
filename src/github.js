// A small GitHub REST client for Kira's issues feature. Writes are only logged in dry-run mode.
//
// With GITHUB_TOKEN only (a fine-grained one of Ludovic's), every call Kira makes comes out of his 5000 an hour, which
// his agents and merge scripts need too; the GitHub App (src/github-app.js) has an hour of its own. Two things keep
// the share small:
// - GETs are conditional (If-None-Match with the last ETag): GitHub doesn't count a 304 answer, so a board refresh
//   that finds nothing new is almost free.
// - Below KEEP calls left in the hour, GETs stop until the hour resets (writes still go: they are a person's
//   command). The board just waits for the next refresh.
export const KEEP = Number(process.env.KIRA_GITHUB_KEEP ?? 1500);
const CACHE_MAX = 2000;

// Shared by every client in the process that uses the same identity: they all spend the same hour. `token` is a
// string (Ludovic's token) or a function giving the GitHub App's current installation token (src/github-app.js),
// which has an hour of its own.
const userBudget = { remaining: Infinity, reset: 0 };
const appBudget = { remaining: Infinity, reset: 0 };
export const _budget = userBudget; // for tests
export const _appBudget = appBudget;

export function makeGitHub({ token, dryRun = false, fetchImpl = fetch, log = console.log } = {}) {
  const cache = new Map(); // GET path → { etag, body }
  const budget = typeof token === 'function' ? appBudget : userBudget;
  async function call(method, path, body, { cache: keep = true } = {}) {
    const get = method === 'GET';
    if (get && token && budget.remaining < KEEP && Date.now() < budget.reset) {
      throw new Error(`GitHub GET ${path}: holding back, ${budget.remaining} calls left until ${new Date(budget.reset).toISOString()}`);
    }
    const auth = typeof token === 'function' ? await token() : token;
    const cached = get && keep ? cache.get(path) : undefined;
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Kira (Discord bot of ludovic\'s server)',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
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
    const etag = get && keep ? res.headers?.get?.('etag') : null;
    if (etag) {
      cache.delete(path); // re-inserted last: the oldest entry goes first when the cache is full
      cache.set(path, { etag, body: data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return data;
  }
  return {
    dryRun,
    // `cache: false`: big one-off answers (a long search) are not kept for conditional requests.
    get: (path, opts) => call('GET', path, undefined, opts),
    // A GraphQL read (never a dry run: it changes nothing). The answer as GitHub sends it: { data, errors }.
    graphql: (query, variables) => call('POST', '/graphql', { query, variables }, { cache: false }),
    async write(method, path, body) {
      if (dryRun) {
        log(`github dry-run: ${method} ${path} ${body ? JSON.stringify(body).slice(0, 600) : ''}`);
        return null;
      }
      return call(method, path, body);
    },
  };
}
