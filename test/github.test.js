import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGitHub, makePublicGitHub, persistEtags, _budget, _appBudget, _anonBudget, KEEP, FLOOR, PUBLIC_KEEP } from '../src/github.js';
import { appToken, githubToken } from '../src/github-app.js';

// A fake GitHub: answers 304 when the request's If-None-Match matches the path's current ETag.
function fakeGitHub({ remaining = 4000 } = {}) {
  const calls = [];
  const etags = { '/a': '"1"' };
  const fetchImpl = async (url, { method, headers }) => {
    const path = url.replace('https://api.github.com', '');
    calls.push([method, path, headers['If-None-Match'] ?? null]);
    const h = new Headers({ 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) });
    if (etags[path]) h.set('etag', etags[path]);
    if (method === 'GET' && etags[path] && headers['If-None-Match'] === etags[path]) return new Response(null, { status: 304, headers: h });
    return new Response(JSON.stringify({ path, n: calls.length }), { status: 200, headers: h });
  };
  return { calls, etags, fetchImpl };
}

test('a repeated GET is conditional and a 304 returns the cached body', async () => {
  _budget.remaining = Infinity;
  const f = fakeGitHub();
  const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl });
  const first = await gh.get('/a');
  assert.deepEqual(await gh.get('/a'), first);
  assert.deepEqual(f.calls.map((c) => c[2]), [null, '"1"']);
  f.etags['/a'] = '"2"'; // it changed on GitHub: the new body comes back
  assert.equal((await gh.get('/a')).n, 3);
});

test('below KEEP calls left, GETs wait for the reset but writes still go', async () => {
  const f = fakeGitHub({ remaining: KEEP - 1 });
  const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl });
  await gh.get('/b'); // learns the budget from the answer
  await assert.rejects(gh.get('/b'), /holding back/);
  await gh.write('POST', '/c', { x: 1 });
  assert.deepEqual(f.calls.map((c) => c[0] + ' ' + c[1]), ['GET /b', 'POST /c']);
  _budget.remaining = Infinity;
});

test("inside the reserve, a person's GET still goes; below FLOOR it waits too", async () => {
  const f = fakeGitHub({ remaining: KEEP - 1 });
  const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl });
  await gh.get('/b');
  await assert.rejects(gh.get('/b'), /holding back/);
  await gh.get('/b', { person: true });
  _budget.remaining = FLOOR - 1;
  await assert.rejects(gh.get('/b', { person: true }), /holding back/);
  assert.deepEqual(f.calls.map((c) => c[0] + ' ' + c[1]), ['GET /b', 'GET /b']);
  _budget.remaining = Infinity;
});

test('an answer from the search API does not count against the shared hour', async () => {
  _budget.remaining = Infinity;
  const fetchImpl = async () => new Response('{}', { status: 200, headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-resource': 'search', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) } });
  const gh = makeGitHub({ token: 't', fetchImpl });
  await gh.get('/search/issues?q=x');
  assert.equal(_budget.remaining, Infinity);
  await gh.get('/repos/a/b'); // not held back
  const core = async () => new Response('{}', { status: 200, headers: { 'x-ratelimit-remaining': '3999', 'x-ratelimit-resource': 'core', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) } });
  await makeGitHub({ token: 't', fetchImpl: core }).get('/repos/a/c');
  assert.equal(_budget.remaining, 3999);
  _budget.remaining = Infinity;
});

// Kira's AI sources (src/features/ai.js): public reads through the App, else without a token, never Ludovic's token.
function headersOf(calls, left = { remaining: '4000' }) {
  return async (url, { headers }) => {
    calls.push(headers.Authorization ?? 'none');
    return new Response('{"ok":1}', { status: 200, headers: { 'x-ratelimit-remaining': left.remaining, 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
  };
}

test('public reads: through the GitHub App, with a small reserve of its own; held back, the same GET goes without a token', async () => {
  _appBudget.remaining = Infinity; _anonBudget.remaining = Infinity; _budget.remaining = Infinity;
  const calls = [];
  const left = { remaining: '4000' };
  const logs = [];
  const gh = makePublicGitHub({ appToken: async () => 'ghs_app', fetchImpl: headersOf(calls, left), log: (m) => logs.push(m) });
  await gh.get('/repos/horizon-rust/horizon/releases');
  assert.deepEqual(calls, ['Bearer ghs_app']);
  // The App's hour below the board's reserve but above the sources' one: the sources still read through it.
  _appBudget.remaining = KEEP - 500; _appBudget.reset = Date.now() + 600_000;
  left.remaining = String(KEEP - 500);
  await gh.get('/repos/horizon-rust/horizon/readme?ref=main');
  assert.deepEqual(calls, ['Bearer ghs_app', 'Bearer ghs_app']);
  // Below PUBLIC_KEEP: tokenless, logged once for the streak, and Ludovic's hour is never touched.
  _appBudget.remaining = PUBLIC_KEEP - 1;
  left.remaining = '55';
  await gh.get('/repos/horizon-rust/horizon/contents/docs?ref=main');
  await gh.get('/repos/horizon-rust/horizon/releases?per_page=100');
  assert.deepEqual(calls.slice(2), ['none', 'none']);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /without a token until the GitHub App works again \(.*holding back/);
  assert.equal(_anonBudget.remaining, 55);
  assert.equal(_budget.remaining, Infinity, 'tokenless answers are not Ludovic\'s hour');
  // The App's hour resets: through the App again, logged once.
  _appBudget.remaining = Infinity;
  left.remaining = '4999';
  await gh.get('/x');
  assert.equal(calls.at(-1), 'Bearer ghs_app');
  assert.match(logs[1], /through the GitHub App again/);
  _appBudget.remaining = Infinity; _anonBudget.remaining = Infinity;
});

test('public reads: an App that fails to mint a token falls back too; tokenless reads stop at 0 left', async () => {
  _anonBudget.remaining = Infinity;
  const calls = [];
  const gh = makePublicGitHub({ appToken: async () => { throw new Error('GitHub App POST: HTTP 401'); }, fetchImpl: headersOf(calls, { remaining: '0' }), log: () => {} });
  await gh.get('/a');
  assert.deepEqual(calls, ['none']);
  await assert.rejects(gh.get('/b'), /holding back, 0 calls left/);
  assert.equal(calls.length, 1, 'no call GitHub would refuse');
  _anonBudget.remaining = Infinity;
});

test('public reads: without the App, tokenless; appToken never gives GITHUB_TOKEN (githubToken still does)', async () => {
  _anonBudget.remaining = Infinity;
  const env = { GITHUB_TOKEN: 'github_pat_ludovic' };
  assert.equal(appToken(env), null);
  assert.equal(githubToken(env), 'github_pat_ludovic');
  const calls = [];
  await makePublicGitHub({ appToken: appToken(env), fetchImpl: headersOf(calls) }).get('/a');
  assert.deepEqual(calls, ['none']);
  _anonBudget.remaining = Infinity;
});

test('the ETag cache survives a restart: a new client sends If-None-Match on its first GET and a 304 returns the saved body', async () => {
  _budget.remaining = Infinity;
  const file = join(mkdtempSync(join(tmpdir(), 'kira-etags-')), 'github-etags.json');
  const f = fakeGitHub();
  const before = persistEtags(file);
  const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl });
  const first = await gh.get('/a');
  before.save();
  before.stop(); // the process ends here

  const after = persistEtags(file);
  const fresh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl }); // made after the load
  assert.deepEqual(await fresh.get('/a'), first);
  assert.deepEqual(f.calls.map((c) => c[2]), [null, '"1"']);
  // Another identity has its own entries: the tokenless client got nothing from the user's list.
  const anon = makeGitHub({ fetchImpl: f.fetchImpl });
  await anon.get('/a');
  assert.equal(f.calls.at(-1)[2], null);
  after.stop();
});

test('a client made before the load is seeded too; a changed ETag still brings the new body', async () => {
  _budget.remaining = Infinity;
  const file = join(mkdtempSync(join(tmpdir(), 'kira-etags-')), 'github-etags.json');
  writeFileSync(file, JSON.stringify({ user: [['/a', { etag: '"1"', body: { saved: true } }]] }));
  const f = fakeGitHub();
  const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl }); // at import time, before bot.js loads the file
  const p = persistEtags(file);
  assert.deepEqual(await gh.get('/a'), { saved: true });
  f.etags['/a'] = '"2"';
  assert.equal((await gh.get('/a')).n, 2);
  p.stop();
});

test('a missing or corrupt ETag file is an empty cache, not a crash; huge bodies are not saved', async () => {
  _budget.remaining = Infinity;
  const dir = mkdtempSync(join(tmpdir(), 'kira-etags-'));
  const logs = [];
  for (const [name, text] of [['missing.json', null], ['corrupt.json', '{"user": [[['], ['wrong.json', '{"user":"x","app":[1,null,["/a",{}]]}']]) {
    const file = join(dir, name);
    if (text != null) writeFileSync(file, text);
    const f = fakeGitHub();
    const p = persistEtags(file, { log: (...a) => logs.push(a.join(' ')) });
    const gh = makeGitHub({ token: 't', fetchImpl: f.fetchImpl });
    await gh.get('/a');
    assert.equal(f.calls[0][2], null);
    p.save();
    p.stop();
  }
  assert.equal(logs.filter((l) => /not read/.test(l)).length, 1); // the corrupt file; a missing one is silent
  const big = join(dir, 'big.json');
  const p = persistEtags(big);
  const gh = makeGitHub({ token: 't', fetchImpl: async () => new Response(JSON.stringify({ x: 'y'.repeat(300_000) }), { status: 200, headers: { etag: '"big"' } }) });
  await gh.get('/big');
  p.save();
  p.stop();
  assert.deepEqual(JSON.parse(readFileSync(big, 'utf8')).user.filter(([path]) => path === '/big'), []);
});
