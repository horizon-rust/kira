import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../src/features/perfsweep.js';

test('the sweep posts to the site with the token, and does nothing without one', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ deleted: 3 }) }; };
  assert.equal(await sweep({ token: '', fetchImpl }), null);
  assert.equal(calls.length, 0);
  assert.equal(await sweep({ token: 's3cret', fetchImpl }), 3);
  assert.equal(calls[0].url, 'https://playhorizon.dev/api/perf/sweep');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer s3cret');
  await assert.rejects(sweep({ token: 's3cret', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});

test('every feature bot.js loads exports a commands list (a missing one crashed Kira at start)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8');
  const list = src.match(/const FEATURES = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim());
  for (const name of list) {
    const file = src.match(new RegExp(`import \\* as ${name} from '\\./features/([\\w-]+)\\.js'`))?.[1];
    if (!file) continue;
    const m = await import(`../src/features/${file}.js`);
    assert.ok(Array.isArray(m.commands), `${file}.js exports no commands array`);
  }
});
