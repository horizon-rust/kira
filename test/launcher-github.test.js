// GET /github/public/…: the launcher's GitHub reads when GitHub rate-limits it (src/launcher-github.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lg from '../src/launcher-github.js';
import { makeHandler } from '../src/mcp.js';
import { rateLimiter } from '../src/agents.js';

const fakeRes = () => ({ status: 0, headers: {}, body: '', writeHead(st, h) { this.status = st; this.headers = h ?? {}; }, end(b) { this.body = b; } });
const req = (url, ip = '1.2.3.4') => ({ method: 'GET', url, headers: { 'x-real-ip': ip }, socket: { remoteAddress: ip } });

test('only the launcher\'s release reads of horizon-rust/horizon are allowed', () => {
  const t = lg.target;
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases?per_page=100'), '/repos/horizon-rust/horizon/releases?per_page=100');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases?per_page=100&page=2'), '/repos/horizon-rust/horizon/releases?page=2&per_page=100');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases/latest'), '/repos/horizon-rust/horizon/releases/latest');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases/tags/launcher@0.2.33'), '/repos/horizon-rust/horizon/releases/tags/launcher@0.2.33');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases/tags/launcher%400.2.33'), '/repos/horizon-rust/horizon/releases/tags/launcher@0.2.33');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/git/matching-refs/tags/launcher@'), '/repos/horizon-rust/horizon/git/matching-refs/tags/launcher@');
  assert.equal(t('/github/public/repos/horizon-rust/horizon/commits/0c02067'), '/repos/horizon-rust/horizon/commits/0c02067');
  // Anything else: other repositories (private ones), other endpoints, other queries, path tricks.
  assert.equal(t('/github/public/repos/horizon-rust/kira/releases'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/issues'), null);
  assert.equal(t('/github/public/user'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases?per_page=100&access_token=x'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases?per_page=abc'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/releases/tags/a%2F..%2F..%2Fkira'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/commits/a/b'), null);
  assert.equal(t('/github/public/repos/horizon-rust/horizon/commits/%E0%A4%A'), null, 'bad escape');
  assert.equal(t('/github/proxy/repos/horizon-rust/horizon/releases'), null);
});

test('answers are kept a minute: a crowd of launchers costs one GitHub call per path', async () => {
  let clock = 0;
  const asked = [];
  const gh = { get: async (path) => { asked.push(path); return path.endsWith('/nope') ? null : [{ tag_name: 'nightly', n: asked.length }]; } };
  const route = lg.routes({ gh, now: () => clock })['GET /github/public/*'];
  const call = async (url) => { const res = fakeRes(); await route(req(url), res); return res; };
  const url = '/github/public/repos/horizon-rust/horizon/releases?per_page=100';
  const a = await call(url);
  assert.equal(a.status, 200);
  assert.deepEqual(JSON.parse(a.body), [{ tag_name: 'nightly', n: 1 }]);
  assert.match(a.headers['Cache-Control'], /public, max-age=60/);
  clock = lg.TTL_MS - 1;
  assert.deepEqual(JSON.parse((await call(url)).body), [{ tag_name: 'nightly', n: 1 }]);
  assert.equal(asked.length, 1);
  clock = lg.TTL_MS;
  assert.deepEqual(JSON.parse((await call(url)).body), [{ tag_name: 'nightly', n: 2 }]);
  // A 404 is kept too (no repeated misses on GitHub), and a refused path never reaches GitHub.
  assert.equal((await call('/github/public/repos/horizon-rust/horizon/releases/tags/nope')).status, 404);
  assert.equal((await call('/github/public/repos/horizon-rust/horizon/releases/tags/nope')).status, 404);
  assert.equal((await call('/github/public/repos/horizon-rust/horizon/pulls')).status, 404);
  assert.equal(asked.length, 3);
});

test('GitHub failing: the last answer, else 502', async () => {
  let clock = 0;
  let down = false;
  const gh = { get: async () => { if (down) throw new Error('GitHub GET: HTTP 403'); return { tag_name: 'v1' }; } };
  const route = lg.routes({ gh, now: () => clock })['GET /github/public/*'];
  const call = async (url) => { const res = fakeRes(); await route(req(url), res); return res; };
  await call('/github/public/repos/horizon-rust/horizon/releases/latest');
  down = true;
  clock = 10 * lg.TTL_MS;
  const stale = await call('/github/public/repos/horizon-rust/horizon/releases/latest');
  assert.equal(stale.status, 200);
  assert.deepEqual(JSON.parse(stale.body), { tag_name: 'v1' });
  assert.equal((await call('/github/public/repos/horizon-rust/horizon/releases/tags/v2')).status, 502);
});

test('each address is limited, and the HTTP handler reaches the prefix route', async () => {
  const limiter = rateLimiter({ launcherGithub: [2, 60_000] });
  const gh = { get: async () => [] };
  const handler = makeHandler({ store: {}, api: { snapshot: () => null }, limiter, routes: lg.routes({ limiter, gh }) });
  const call = async (url, ip) => { const res = fakeRes(); await handler(req(url, ip), res); return res; };
  const url = '/github/public/repos/horizon-rust/horizon/releases?per_page=100';
  assert.equal((await call(url, '9.9.9.9')).status, 200);
  assert.equal((await call(url, '9.9.9.9')).status, 200);
  const limited = await call(url, '9.9.9.9');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['Retry-After']) > 0);
  assert.equal((await call(url, '8.8.8.8')).status, 200, 'another address');
  assert.equal((await call('/github/publicx/repos/horizon-rust/horizon/releases', '7.7.7.7')).status, 404);
});
