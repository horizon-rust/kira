// GitHub's webhook for every feature (src/webhook.js): the signed route, the listeners, the throttle, the fallback
// pace; and what reacts to it: the website's revalidation (src/features/site.js), the board's refresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-webhook-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GITHUB_WEBHOOK_SECRET = 'hook-secret';
process.env.KIRA_SITE_REVALIDATE_SECRET = 'site-secret';
const webhook = await import('../src/webhook.js');
const site = await import('../src/features/site.js');
const wb = await import('../src/features/workboard.js');
const { SITE } = await import('../src/config.js');

const ORG = { login: 'horizon-rust' };
const repo = (name, extra = {}) => ({ name, full_name: `horizon-rust/${name}`, default_branch: 'main', private: false, owner: ORG, ...extra });
async function deliver(route, event, payload, secret = 'hook-secret') {
  const body = Buffer.from(JSON.stringify(payload));
  const req = Object.assign(Readable.from([body]), { headers: { 'x-github-event': event, 'x-github-delivery': String(Math.random()), 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }, socket: { remoteAddress: '1.2.3.4' } });
  const res = { status: 0, writeHead(s) { this.status = s; }, end() {} };
  await route(req, res);
  return res.status;
}

test('routes: signed deliveries of the org reach every listener; others don\'t; no secret, no route', async () => {
  assert.deepEqual(webhook.routes({ secret: '' }), {});
  const seen = [];
  webhook.on((name, p) => seen.push([name, p.repository?.name]));
  const route = webhook.routes({ secret: 'hook-secret', owner: 'horizon-rust' })['POST /github/webhook'];
  assert.equal(webhook.healthy(), false, 'nothing delivered yet');
  assert.equal(await deliver(route, 'push', { repository: repo('horizon-site') }, 'wrong'), 401);
  assert.equal(webhook.healthy(), false);
  assert.equal(await deliver(route, 'push', { repository: repo('horizon-site') }), 202);
  assert.equal(await deliver(route, 'push', { repository: repo('x', { owner: { login: 'someone' }, full_name: 'someone/x' }) }), 202);
  assert.deepEqual(seen.filter(([n]) => n === 'push'), [['push', 'horizon-site']]);
  assert.equal(webhook.healthy(), true);
  assert.equal(webhook.every(1, 2), 2, 'slow polling while deliveries come');
  webhook._test.setLast(Date.now() - webhook.HEALTHY_MS - 1);
  assert.equal(webhook.every(1, 2), 1, 'fast polling again when they stop');
});

test('throttle(): one run per gap, a call inside the gap runs once at its end, never none', async () => {
  let clock = 0;
  const timers = [];
  let runs = 0;
  const poke = webhook.throttle(() => { runs++; }, 60, { delayMs: 5, now: () => clock, timers: { set: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; } } });
  const tick = async (to) => { clock = to; for (const t of timers.filter((t) => !t.done && t.at <= clock)) { t.done = true; await t.fn(); } };
  poke(); poke(); poke();
  await tick(5);
  assert.equal(runs, 1);
  for (let t = 10; t <= 50; t += 10) { poke(); await tick(t); }
  assert.equal(runs, 1, 'inside the gap: waits');
  await tick(65);
  assert.equal(runs, 2, 'then once');
  await tick(500);
  assert.equal(runs, 2);
});

test('site: which deliveries expire which of the site\'s tags', () => {
  const t = (name, p) => site.tagsFor(name, p);
  assert.deepEqual(t('push', { ref: 'refs/heads/main', repository: repo('horizon') }), ['github:horizon:main']);
  assert.deepEqual(t('push', { ref: 'refs/heads/feature', repository: repo('horizon') }), []);
  assert.deepEqual(t('pull_request', { action: 'closed', repository: repo('horizon') }), ['github:horizon:issues']);
  assert.deepEqual(t('pull_request', { action: 'synchronize', repository: repo('horizon') }), []);
  assert.deepEqual(t('issues', { action: 'labeled', repository: repo('horizon') }), ['github:horizon:issues']);
  assert.deepEqual(t('release', { action: 'published', repository: repo('horizon') }), ['github:horizon:releases']);
  assert.deepEqual(t('push', { ref: 'refs/heads/main', repository: repo('horizon-mods') }), ['github:horizon-mods:main']);
  assert.deepEqual(t('push', { ref: 'refs/heads/main', repository: repo('horizon-mixins') }), []);
  assert.deepEqual(t('check_run', { action: 'completed', repository: repo('horizon') }), []);
});

test('site: the call carries the secret and the tags, then loads the pages that show them and tells #updates', async () => {
  const calls = [];
  site._test.setFetch(async (url, opts = {}) => { calls.push([url, opts.method ?? 'GET', opts.headers?.Authorization, opts.body]); return { ok: true, status: 200, arrayBuffer: async () => {} }; });
  let after = null;
  site.afterRevalidate((tags) => { after = tags; });
  await site._test.revalidate(['github:horizon:releases']);
  assert.deepEqual(calls[0], [`${SITE.url}/api/revalidate`, 'POST', 'Bearer site-secret', '{"tags":["github:horizon:releases"]}']);
  assert.deepEqual(calls.slice(1).map(([u, m]) => [u.replace(SITE.url, ''), m]), SITE.warm['github:horizon:releases'].map((p) => [p, 'GET']));
  assert.ok(calls.slice(1).every(([, , auth]) => auth === undefined), 'the secret only goes to the revalidate call');
  assert.deepEqual(after, ['github:horizon:releases']);
  site._test.setFetch(async () => ({ ok: false, status: 401 }));
  await assert.rejects(site._test.revalidate(['github:horizon:main']), /HTTP 401/);
});

test('board: Horizon\'s issues, pull requests, reviews, finished checks and main refresh it; nothing else does', () => {
  const h = repo('horizon');
  assert.equal(wb.boardEvent('issues', { action: 'opened', repository: h }), true);
  assert.equal(wb.boardEvent('pull_request', { action: 'synchronize', repository: h }), true);
  assert.equal(wb.boardEvent('pull_request_review', { action: 'submitted', repository: h }), true);
  assert.equal(wb.boardEvent('check_run', { action: 'completed', repository: h }), true);
  assert.equal(wb.boardEvent('check_run', { action: 'created', repository: h }), false);
  assert.equal(wb.boardEvent('push', { ref: 'refs/heads/main', repository: h }), true);
  assert.equal(wb.boardEvent('push', { ref: 'refs/heads/topic', repository: h }), false);
  assert.equal(wb.boardEvent('issues', { action: 'opened', repository: repo('horizon-mods') }), false);
});

test('site proxy: only the site (bearer), only its few public reads, through Kira\'s GitHub client', async () => {
  const asked = [];
  site._test.setProxyGitHub({ get: async (path, opts) => { asked.push([path, opts?.accept ?? null]); return path.includes('releases/latest') ? null : [{ ok: path }]; } });
  const routes = site.routes({});
  const call = async (url, headers = {}) => {
    const route = routes[`GET ${new URL(url, 'http://x').pathname}`];
    if (!route) return { status: 404 };
    const res = { status: 0, body: '', writeHead(st) { this.status = st; }, end(b) { this.body = b; } };
    await route({ url, headers, socket: { remoteAddress: '1.2.3.4' } }, res);
    return res;
  };
  const auth = { authorization: 'Bearer site-secret' };
  assert.equal((await call('/github/proxy/repos/horizon-rust/horizon/issues?state=open&per_page=100&page=2', {})).status, 401);
  const ok = await call('/github/proxy/repos/horizon-rust/horizon/issues?state=open&per_page=100&page=2', auth);
  assert.equal(ok.status, 200);
  assert.deepEqual(asked.at(-1), ['/repos/horizon-rust/horizon/issues?page=2&per_page=100&state=open', null]);
  await call('/github/proxy/repos/horizon-rust/horizon/releases?per_page=50', { ...auth, 'x-github-accept': 'full' });
  assert.deepEqual(asked.at(-1), ['/repos/horizon-rust/horizon/releases?per_page=50', 'application/vnd.github.full+json']);
  assert.equal((await call('/github/proxy/repos/horizon-rust/horizon/releases/latest', auth)).status, 404);
  assert.equal((await call('/github/proxy/repos/horizon-rust/horizon/issues?labels=x', auth)).status, 404, 'unknown query');
  assert.equal((await call('/github/proxy/repos/horizon-rust/kira/issues', auth)).status, 404, 'a private repo');
  assert.equal((await call('/github/proxy/user', auth)).status, 404);
  assert.equal(site.proxyTarget('/github/proxy/repos/horizon-rust/horizon/issues?page=1;x'), null);
});
