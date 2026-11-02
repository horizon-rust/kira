// The X poster (src/xposter.js, src/features/x.js): what is posted, its length, once, the token refresh, the dry run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Minutes before now: entries older than 48 h are never posted (src/journal.js MAX_AGE_MS).
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kira-x-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.X_DRY_RUN = '1';
const xp = await import('../src/xposter.js');
const feature = await import('../src/features/x.js');
const core = await import('../src/core.js');

const HUB = 'https://playhorizon.dev/hub';
const long = 'Horizon now keeps steady frames at render distance 32 on most computers, because world generation no longer queues structure starts behind the render thread and the worker pool leaves one core free, as vanilla does. ' .repeat(2);
const entries = [
  { id: 'r1', kind: 'release', date: ago(960), tag: 'v0.2.61', plain: long, url: 'https://github.com/horizon-rust/horizon/releases/tag/v0.2.61' },
  { id: 'w1', kind: 'weekly', date: ago(180), title: 'The week of 19 October', plain: 'Faster frames and server dialogs. Thanks @someone!' },
  { id: 's1', kind: 'shipped', date: ago(959), item: 'smooth-frames', title: 'Steady frames', post: 'Steady frames at 32 chunks are in Horizon v0.2.61.', announce: true },
  { id: 's2', kind: 'shipped', date: ago(958), item: 'quiet', title: 'Quiet thing', plain: 'Not for X.' },
  { id: 'm1', kind: 'merge', date: ago(1560), title: 'A merge', url: 'https://evil.example' },
];

test('only releases, weekly summaries and announced shipped items; 240 characters at most, with the link; no mentions', () => {
  assert.deepEqual(entries.filter(xp.forX).map((e) => e.id), ['r1', 'w1', 's1']);
  const r = xp.xText(entries[0], HUB);
  assert.ok(r.length <= 240, String(r.length));
  assert.match(r, /^Horizon v0\.2\.61 is out: Horizon now keeps steady frames[^\n]*…\nhttps:\/\/github\.com\/horizon-rust\/horizon\/releases\/tag\/v0\.2\.61$/);
  assert.doesNotMatch(r, / …/, 'cut at a word, no dangling space');
  const w = xp.xText(entries[1], HUB);
  assert.equal(w, 'The week of 19 October: Faster frames and server dialogs. Thanks @​someone!\nhttps://playhorizon.dev/hub');
  assert.equal(xp.xText(entries[2], HUB), 'Steady frames at 32 chunks are in Horizon v0.2.61.\nhttps://playhorizon.dev/hub#smooth-frames');
  assert.equal(xp.xText(entries[3], HUB), null);
  assert.equal(xp.xText(entries[4], HUB), null);
});

test('the feature: first look records, then each new entry once, 3 a round; the dry run prints', async () => {
  const printed = [];
  feature._test.setPoster(xp.makePoster({ tokens: {}, dryRun: true, log: (l) => printed.push(l) }));
  await feature.onNewJournal({ entries: entries.slice(0, 1) });
  assert.equal(printed.length, 0);
  const more = [...entries, ...[1, 2, 3].map((n) => ({ id: `r${n + 1}`, kind: 'release', date: ago(60 - n * 10), tag: `v0.2.6${n + 1}`, url: 'https://github.com/horizon-rust/horizon/releases' }))];
  await feature.onNewJournal({ entries: more });
  assert.equal(printed.length, 3);
  assert.match(printed[0], /^x dry-run: "Steady frames/); // oldest first
  await feature.onNewJournal({ entries: more });
  assert.equal(printed.length, 5, 'the two left over, then nothing twice');
  await feature.onNewJournal({ entries: more });
  assert.equal(printed.length, 5);
  assert.ok(core.state.x.seen.includes('m1'));
});

test('posting: a 401 refreshes once, keeps the rotated pair in a mode-600 file, and retries; errors never echo a token', async () => {
  const file = join(dir, 'x-tokens.json');
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' }) };
    if (opts.headers.Authorization === 'Bearer old-access') return { ok: false, status: 401, text: async () => '' };
    return { ok: true, status: 201, json: async () => ({ data: { id: '99' } }) };
  };
  const tokens = { access: 'old-access', refresh: 'old-refresh', clientId: 'cid', clientSecret: null };
  const p = xp.makePoster({ tokens, file, fetchImpl });
  assert.deepEqual(await p.post('Hello'), { id: '99' });
  assert.equal(calls.length, 3);
  assert.match(calls[1].opts.body, /grant_type=refresh_token&refresh_token=old-refresh&client_id=cid/);
  assert.deepEqual(JSON.parse(calls[2].opts.body), { text: 'Hello' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).refresh, 'new-refresh');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(xp.loadTokens(file, { X_ACCESS_TOKEN: 'env' }).access, 'new-access', 'the refreshed pair wins over the variables');
  assert.equal(xp.loadTokens(join(dir, 'none.json'), {}), null, 'no credentials: off');
  await assert.rejects(p.post('x'.repeat(241)), /over 240/);
  const bad = xp.makePoster({ tokens: { access: null, refresh: 'r', clientId: 'c' }, fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'refresh_token=r' }) });
  await assert.rejects(bad.post('hi'), (e) => /HTTP 400/.test(e.message) && !/refresh_token=r/.test(e.message));
});
