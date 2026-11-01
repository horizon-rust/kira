// Unit tests for the official server's market pages (src/smp-kit.js): the panel read, its cache and its limits, and
// the daily summary posted once. No Discord, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReader, summaryToPost, summaryText, TTL_MS } from '../src/smp-kit.js';

const page = (extra = {}) => ({ schema: 1, generated: 1_800_000_000_000, items: [], ...extra });
const panel = (bodies) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const next = bodies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return { ok: false, status: next, text: async () => '' };
    return { ok: true, status: 200, text: async () => (typeof next === 'string' ? next : JSON.stringify(next)) };
  };
  return { calls, fetchImpl };
};

test('smp: reads the page from the panel once a minute, only the two names, with the read-only key', async () => {
  let now = 0;
  const p = panel([page({ n: 1 }), page({ n: 2 })]);
  const read = makeReader({ panel: 'https://panel.x', server: 'abc', key: 'k1', fetchImpl: p.fetchImpl, now: () => now });
  assert.equal((await read('market.json')).doc.n, 1);
  assert.equal((await read('market.json')).doc.n, 1, 'cached');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, 'https://panel.x/api/client/servers/abc/files/contents?file=%2Fworld%2Fhorizon-smp%2Fweb%2Fmarket.json');
  assert.equal(p.calls[0].auth, 'Bearer k1');
  now += TTL_MS;
  assert.equal((await read('market.json')).doc.n, 2);
  for (const bad of ['server.toml', '../ops.json', 'market.json/../x', 'world/level.dat']) assert.equal(await read(bad), null, bad);
  assert.equal(p.calls.length, 2, 'nothing else is ever asked for');
});

test('smp: concurrent readers share one request; a failed read serves the last good page, marked stale', async () => {
  let now = 0;
  const p = panel([page({ n: 1 }), 503, new Error('timeout')]);
  const read = makeReader({ panel: 'https://panel.x', server: 'abc', key: 'k', fetchImpl: p.fetchImpl, now: () => now });
  const [a, b] = await Promise.all([read('economy.json'), read('economy.json')]);
  assert.equal(p.calls.length, 1);
  assert.deepEqual([a.doc.n, b.doc.n], [1, 1]);
  now += TTL_MS;
  const stale = await read('economy.json');
  assert.deepEqual([stale.doc.n, stale.stale], [1, true]);
  // Never a good copy: the error goes up.
  await assert.rejects(read('market.json'), /timeout/);
});

test('smp: only the SMP\'s own page passes (schema 1 and a time), and not a huge one', async () => {
  for (const body of ['not json', JSON.stringify({ schema: 2, generated: 1 }), JSON.stringify([1]), JSON.stringify({ schema: 1 })]) {
    const read = makeReader({ panel: 'p', server: 's', key: 'k', fetchImpl: panel([body]).fetchImpl });
    await assert.rejects(read('market.json'), undefined, body);
  }
  const read = makeReader({ panel: 'p', server: 's', key: 'k', fetchImpl: panel(['x'.repeat(9 * 1024 * 1024)]).fetchImpl });
  await assert.rejects(read('market.json'), /too big/);
});

test('smp: the day\'s summary is posted once, never an old one after a restart, and pings nobody', () => {
  const day = Date.parse('2026-11-02T00:00:00Z');
  const doc = page({ daily_summary: { day, lines: ['Market today: up Diamond ▲ 4.0%', 'News: @everyone supply up', 7, ''] } });
  const first = summaryToPost(doc, 0, day + 60_000);
  assert.deepEqual(first, { day, lines: ['Market today: up Diamond ▲ 4.0%', 'News: @everyone supply up'] });
  assert.deepEqual(summaryToPost(doc, day, day + 120_000), { day, lines: [] }, 'already posted');
  assert.deepEqual(summaryToPost(doc, 0, day + 7 * 3_600_000), { day, lines: [] }, 'too old: only marked as seen');
  assert.deepEqual(summaryToPost(page(), 5, day), { day: 5, lines: [] }, 'no summary yet');
  const text = summaryText(first.lines);
  assert.ok(!text.includes('@everyone') && text.includes('@‍everyone'), text);
  assert.ok(summaryText(Array(100).fill('x'.repeat(100))).length <= 1900);
});
