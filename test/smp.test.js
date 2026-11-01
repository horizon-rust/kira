// Unit tests for the official server's market pages (src/smp-kit.js, src/features/smp.js): what the server sends is
// checked and kept, served as sent, and the daily summary is posted once. No Discord, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { makeStore, tokenOk, summaryToPost, summaryText, MAX_BYTES } from '../src/smp-kit.js';

const page = (extra = {}) => JSON.stringify({ schema: 1, generated: 1_800_000_000_000, items: [], ...extra });

test('smp: only the server\'s token is accepted, compared whole', () => {
  assert.equal(tokenOk('s3cret-token', 'Bearer s3cret-token'), true);
  for (const bad of [undefined, '', 'Bearer', 'Bearer s3cret', 'Bearer s3cret-token2', 's3cret-token', 'Basic s3cret-token']) {
    assert.equal(tokenOk('s3cret-token', bad), false, String(bad));
  }
  assert.equal(tokenOk(null, 'Bearer '), false, 'no token configured accepts nothing');
});

test('smp: a page is checked, kept, never replaced by an older one, and survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kira-smp-'));
  try {
    const path = (name) => join(dir, `smp-${name}`);
    const store = makeStore({ path, now: () => 42 });
    assert.equal(store.get('market.json'), null);
    for (const [text, status] of [['not json', 400], [JSON.stringify({ schema: 2, generated: 1 }), 400], [JSON.stringify([1]), 400],
      [JSON.stringify({ schema: 1 }), 400], ['x'.repeat(MAX_BYTES + 1), 413]]) {
      assert.equal(store.put('market.json', text).status, status, text.slice(0, 40));
    }
    assert.equal(store.put('server.toml', page()).status, 404);
    assert.deepEqual(store.put('market.json', page({ n: 2 })), { status: 200 });
    assert.equal(store.get('market.json').doc.n, 2);
    assert.equal(store.get('market.json').at, 42);
    // A page from before (a delayed request) doesn't win.
    assert.equal(store.put('market.json', page({ n: 1, generated: 1 })).ignored, true);
    assert.equal(store.get('market.json').doc.n, 2);
    const again = makeStore({ path });
    assert.equal(again.get('market.json').doc.n, 2, 'read back after a restart');
    assert.equal(again.get('economy.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smp: the routes take the server\'s page with its token and serve it as sent', async () => {
  process.env.KIRA_SMP_INGEST_TOKEN = 'tok-123';
  const smp = await import(`../src/features/smp.js?${Date.now()}`);
  smp._test.setStore(makeStore());
  const routes = smp.routes();
  const call = async (key, { body = '', auth, gzip = false } = {}) => {
    const raw = gzip ? gzipSync(Buffer.from(body)) : Buffer.from(body);
    const req = Readable.from(body ? [raw] : []);
    req.headers = { ...(auth ? { authorization: auth } : {}), ...(gzip ? { 'content-encoding': 'gzip' } : {}) };
    req.socket = { remoteAddress: '1.2.3.4' };
    const res = { status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
    await routes[key](req, res);
    return res;
  };
  assert.equal((await call('GET /smp/market.json')).status, 503, 'nothing sent yet');
  assert.equal((await call('POST /smp/ingest/market.json', { body: page({ n: 1 }), auth: 'Bearer wrong' })).status, 401);
  assert.equal((await call('POST /smp/ingest/market.json', { body: page({ n: 1 }) })).status, 401);
  assert.equal((await call('POST /smp/ingest/market.json', { body: 'oops', auth: 'Bearer tok-123' })).status, 400);
  assert.equal((await call('POST /smp/ingest/market.json', { body: page({ n: 1 }), auth: 'Bearer tok-123' })).status, 200);
  const got = await call('GET /smp/market.json');
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body).n, 1);
  assert.equal(got.headers['Access-Control-Allow-Origin'], '*');
  // Gzipped, as the server sends it; a bomb that unpacks past the limit is refused.
  assert.equal((await call('POST /smp/ingest/market.json', { body: page({ n: 3, generated: 1_900_000_000_000 }), auth: 'Bearer tok-123', gzip: true })).status, 200);
  assert.equal(JSON.parse((await call('GET /smp/market.json')).body).n, 3);
  assert.equal((await call('POST /smp/ingest/market.json', { body: ' '.repeat(MAX_BYTES + 10), auth: 'Bearer tok-123', gzip: true })).status, 413);
  assert.equal((await call('POST /smp/ingest/market.json', { body: 'not gzip', auth: 'Bearer tok-123' , gzip: false })).status, 400);
  assert.ok(!routes['POST /smp/ingest/server.toml'] && !routes['GET /smp/ingest/market.json']);
});

test('smp: the day\'s summary is posted once, never an old one after a restart, and pings nobody', () => {
  const day = Date.parse('2026-11-02T00:00:00Z');
  const doc = JSON.parse(page({ daily_summary: { day, lines: ['Market today: up Diamond ▲ 4.0%', 'News: @everyone supply up', 7, ''] } }));
  const first = summaryToPost(doc, 0, day + 60_000);
  assert.deepEqual(first, { day, lines: ['Market today: up Diamond ▲ 4.0%', 'News: @everyone supply up'] });
  assert.deepEqual(summaryToPost(doc, day, day + 120_000), { day, lines: [] }, 'already posted');
  assert.deepEqual(summaryToPost(doc, 0, day + 7 * 3_600_000), { day, lines: [] }, 'too old: only marked as seen');
  assert.deepEqual(summaryToPost(JSON.parse(page()), 5, day), { day: 5, lines: [] }, 'no summary yet');
  const text = summaryText(first.lines);
  assert.ok(!text.includes('@everyone') && text.includes('@‍everyone'), text);
  assert.ok(summaryText(Array(100).fill('x'.repeat(100))).length <= 1900);
});
