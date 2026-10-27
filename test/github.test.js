import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGitHub, _budget, KEEP } from '../src/github.js';

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
