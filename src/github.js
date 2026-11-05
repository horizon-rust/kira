import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// A small GitHub REST client for Kira's issues feature. Writes are only logged in dry-run mode.
//
// With GITHUB_TOKEN only (a fine-grained one of Ludovic's), every call Kira makes comes out of his 5000 an hour, which
// his agents and merge scripts need too; the GitHub App (src/github-app.js) has an hour of its own. Two things keep
// the share small:
// - GETs are conditional (If-None-Match with the last ETag): GitHub doesn't count a 304 answer, so a board refresh
//   that finds nothing new is almost free.
// - Below KEEP calls left in the hour, GETs stop until the hour resets (writes still go: they are a person's
//   command). The board just waits for the next refresh. A GET made for a person's command (`person: true`:
//   /link-github, a claim, an agent's task_get) is one call: it only stops below FLOOR.
export const KEEP = Number(process.env.KIRA_GITHUB_KEEP ?? 1500);
export const FLOOR = 100;
// The reserve of makePublicGitHub's App client: its few reads an hour (Kira's AI sources) go on long after the board
// has stopped for the hour, and a held-back one is read without a token instead.
export const PUBLIC_KEEP = Number(process.env.KIRA_GITHUB_PUBLIC_KEEP ?? 100);
const CACHE_MAX = 2000;

// Shared by every client in the process that uses the same identity: they all spend the same hour. `token` is a
// string (Ludovic's token) or a function giving the GitHub App's current installation token (src/github-app.js),
// which has an hour of its own. No token: public reads only, 60 an hour for the host's IP; they stop at 0.
const userBudget = { remaining: Infinity, reset: 0 };
const appBudget = { remaining: Infinity, reset: 0 };
const anonBudget = { remaining: Infinity, reset: 0 };
export const _budget = userBudget; // for tests
export const _appBudget = appBudget;
export const _anonBudget = anonBudget;

// The ETag caches survive a restart: a deploy would otherwise start with none, and the first board refresh, the polls
// and the releases fetch would all count against the hour where a 304 is free (five deploys in an hour drained the
// App's on 2026-10-30). One file, an entry list per identity (the same three as the budgets): an ETag names a
// representation, so any client with that identity can use another's. Only a 304 ever returns a cached body.
const ETAG_BODY_MAX = 200_000; // a body whose JSON is longer than this is not saved
const ETAG_FILE_MAX = 8_000_000; // nor more than this much in total (newest first)
const live = { user: new Set(), app: new Set(), anon: new Set() }; // every client's cache, by identity
let saved = null; // { user: [[path, entry]…], app, anon } as loaded; null: nothing is persisted
let lastWritten = '';

function bodySize(entry) {
  try {
    return JSON.stringify(entry.body).length;
  } catch {
    return Infinity;
  }
}

function seed(cache, entries) {
  for (const [path, entry] of entries ?? []) if (!cache.has(path)) cache.set(path, entry);
}

// Call once at start, after the clients exist or before them. Loads `file` (a missing or corrupt one is an empty
// cache), then saves it every `every` ms, and `save()` is for shutdown. `stop()` ends the timer and forgets the file.
export function persistEtags(file, { every = 5 * 60_000, log = console.error } = {}) {
  saved = { user: [], app: [], anon: [] };
  lastWritten = '';
  try {
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    for (const kind of Object.keys(saved)) {
      if (!Array.isArray(disk[kind])) continue;
      saved[kind] = disk[kind].filter((pair) => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1]?.etag === 'string' && pair[1].body !== undefined);
      for (const cache of live[kind]) seed(cache, saved[kind]);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') log('github etags: saved copy not read', e.message);
  }
  function save() {
    try {
      const out = {};
      let room = ETAG_FILE_MAX;
      for (const kind of Object.keys(live)) {
        const merged = new Map(saved[kind]); // clients made later or never asked keep what was loaded
        for (const cache of live[kind]) for (const [path, e] of cache) { merged.delete(path); merged.set(path, e); }
        const keep = [];
        for (const pair of [...merged].reverse().slice(0, CACHE_MAX)) {
          const size = bodySize(pair[1]);
          if (size > ETAG_BODY_MAX || size > room) continue;
          room -= size;
          keep.unshift(pair);
        }
        out[kind] = keep;
      }
      const text = JSON.stringify(out);
      if (text === lastWritten) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file + '.tmp', text, { mode: 0o600 });
      renameSync(file + '.tmp', file);
      lastWritten = text;
    } catch (e) {
      log('github etags: not saved', e.message);
    }
  }
  const timer = setInterval(save, every);
  timer.unref();
  return { save, stop() { clearInterval(timer); saved = null; } };
}

export function makeGitHub({ token, keep: reserve = KEEP, dryRun = false, fetchImpl = fetch, log = console.log } = {}) {
  const cache = new Map(); // GET path → { etag, body }
  const kind = typeof token === 'function' ? 'app' : token ? 'user' : 'anon';
  live[kind].add(cache);
  if (saved) seed(cache, saved[kind]);
  const budget = typeof token === 'function' ? appBudget : token ? userBudget : anonBudget;
  const floor = token ? reserve : 1;
  // `accept`: another media type (the site's releases want body_html: 'application/vnd.github.full+json').
  async function call(method, path, body, { cache: keep = true, person = false, accept = null } = {}) {
    const get = method === 'GET';
    if (get && budget.remaining < (person ? Math.min(floor, FLOOR) : floor) && Date.now() < budget.reset) {
      throw new Error(`GitHub GET ${path}: holding back, ${budget.remaining} calls left until ${new Date(budget.reset).toISOString()}`);
    }
    const auth = typeof token === 'function' ? await token() : token;
    const key = accept ? `${accept} ${path}` : path;
    const cached = get && keep ? cache.get(key) : undefined;
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: accept ?? 'application/vnd.github+json',
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
      cache.delete(key); // re-inserted last: the oldest entry goes first when the cache is full
      cache.set(key, { etag, body: data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return data;
  }
  return {
    dryRun,
    // `cache: false`: big one-off answers (a long search) are not kept for conditional requests. `person: true`: a
    // person waits on this answer, so it goes even inside the board's reserve.
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

// Reads of public horizon-rust content (Kira's AI sources: docs, README, releases). Through the GitHub App when it is
// set up (`appToken`, src/github-app.js), with the small PUBLIC_KEEP reserve; when the App isn't set up, or its GET
// fails or is held back, the same GET goes without a token. Never Ludovic's token: other tools drain its hour.
// Switching to tokenless reads and back is logged once each way.
export function makePublicGitHub({ appToken, keep = PUBLIC_KEEP, fetchImpl = fetch, log = console.log } = {}) {
  const app = appToken ? makeGitHub({ token: appToken, keep, fetchImpl }) : null;
  const anon = makeGitHub({ fetchImpl });
  let tokenless = false;
  return {
    async get(path, opts) {
      if (app) {
        try {
          const data = await app.get(path, opts);
          if (tokenless) log('github public reads: through the GitHub App again');
          tokenless = false;
          return data;
        } catch (e) {
          if (!tokenless) log(`github public reads: without a token until the GitHub App works again (${e.message})`);
          tokenless = true;
        }
      }
      return anon.get(path, opts);
    },
  };
}
