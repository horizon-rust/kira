// /notify: the rules (src/notify-kit.js) and the feature end to end (src/features/notify.js) against a fake Discord,
// a fake GitHub and signed webhook deliveries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'kira-notify-'));
process.env.KIRA_STATE = join(dir, 'state.json');
// A member who turned on the old CI-only /notify (state.work.notify) before this feature.
writeFileSync(process.env.KIRA_STATE, JSON.stringify({ work: { notify: { old: true }, links: {}, verified: {} } }));
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.KIRA_GITHUB_WEBHOOK_SECRET = 'webhook-test-secret';
const kit = await import('../src/notify-kit.js');
const core = await import('../src/core.js');
const notify = await import('../src/features/notify.js');
const webhook = await import('../src/webhook.js');

const SECRET = 'webhook-test-secret';
const ORG = { login: 'horizon-rust' };
const REPO = { name: 'horizon', full_name: 'horizon-rust/horizon', default_branch: 'main', private: false, owner: ORG };
const MODS = { name: 'horizon-mods', full_name: 'horizon-rust/horizon-mods', default_branch: 'main', private: false, owner: ORG };
const MIXINS = { name: 'horizon-mixins', full_name: 'horizon-rust/horizon-mixins', default_branch: 'main', private: false, owner: ORG };
const KIRA = { name: 'kira', full_name: 'horizon-rust/kira', default_branch: 'main', private: true, owner: ORG };
const prOf = (number, author, extra = {}) => ({ number, title: `Fix thing ${number}`, html_url: `https://github.com/horizon-rust/horizon/pull/${number}`, user: { login: author }, state: 'open', head: { sha: `sha${number}` }, ...extra });
const issueOf = (number, author, extra = {}) => ({ number, title: `Bug ${number}`, html_url: `https://github.com/horizon-rust/horizon/issues/${number}`, user: { login: author }, state: 'open', ...extra });
const user = (login, type = 'User') => ({ login, type });

// ── The rules ────────────────────────────────────────────────────────────────

test('plain(): no Markdown, mentions, masked links or line breaks', () => {
  assert.equal(kit.plain('**hi** [x](https://evil.example) @everyone <@123>\nnext'), 'hi x(link) @​everyone @​123 next');
  assert.equal(kit.plain('a'.repeat(100), 10).length, 10);
  assert.equal(kit.link('https://github.com/horizon-rust/horizon/pull/5#pullrequestreview-9'), '<https://github.com/horizon-rust/horizon/pull/5#pullrequestreview-9>');
  assert.equal(kit.link('https://evil.example/pull/5'), '');
});

test('signatureOk(): the HMAC of the body with the secret, nothing else', () => {
  const body = Buffer.from('{"a":1}');
  const sig = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  assert.equal(kit.signatureOk(SECRET, body, sig), true);
  assert.equal(kit.signatureOk(SECRET, Buffer.from('{"a":2}'), sig), false);
  assert.equal(kit.signatureOk('other', body, sig), false);
  assert.equal(kit.signatureOk(SECRET, body, undefined), false);
  assert.equal(kit.signatureOk(null, body, sig), false);
});

test('eventsOf(): reviews, comments, merges, closes, reopens, watched labels; never your own actions or bots\' comments', () => {
  const opts = { labels: ['needs-proof'] };
  const review = (state, body = '') => kit.eventsOf('pull_request_review', { action: 'submitted', repository: REPO, sender: user('bob'), pull_request: prOf(5, 'alice'), review: { state, body, html_url: 'https://github.com/horizon-rust/horizon/pull/5#pullrequestreview-1' } }, opts);
  assert.match(review('approved', 'LGTM')[0].line, /^✅ \*\*bob\*\* approved PR #5 Fix thing 5: “LGTM” <https:\/\/github\.com\/horizon-rust\/horizon\/pull\/5#pullrequestreview-1>$/);
  assert.match(review('changes_requested')[0].line, /🔁 \*\*bob\*\* requested changes on PR #5/);
  assert.match(review('commented')[0].line, /💬 \*\*bob\*\* reviewed PR #5/);
  assert.equal(review('approved')[0].author, 'alice');

  const comment = (sender, issue) => kit.eventsOf('issue_comment', { action: 'created', repository: REPO, sender, issue, comment: { id: 7, body: '🤖 Agent: rebased, please look', html_url: `${issue.html_url}#issuecomment-7` } }, opts);
  assert.match(comment(user('ludovic111'), issueOf(9, 'alice'))[0].line, /💬 \*\*ludovic111\*\* commented on issue #9 Bug 9: “🤖 Agent: rebased, please look”/);
  assert.match(comment(user('carol'), issueOf(9, 'alice', { pull_request: {} }))[0].line, /on PR #9/);
  assert.deepEqual(comment(user('Alice'), issueOf(9, 'alice')), [], 'your own comment');
  assert.deepEqual(comment(user('kira-horizon[bot]', 'Bot'), issueOf(9, 'alice')), [], 'a bot comment');

  const pr = (action, extra = {}, sender = user('ludovic111')) => kit.eventsOf('pull_request', { action, repository: REPO, sender, pull_request: prOf(5, 'alice', extra), ...extra.top }, opts);
  assert.match(pr('closed', { merged: true })[0].line, /🟣 \*\*ludovic111\*\* merged PR #5/);
  assert.match(pr('closed', { merged: false })[0].line, /⛔ \*\*ludovic111\*\* closed PR #5/);
  assert.match(pr('reopened')[0].line, /🔄 \*\*ludovic111\*\* reopened PR #5/);
  assert.deepEqual(pr('closed', { merged: true }, user('alice')), [], 'merged it yourself');
  assert.match(pr('labeled', { top: { label: { name: 'needs-proof' } } })[0].line, /🏷️ \*\*ludovic111\*\* added \*\*needs-proof\*\* to PR #5/);
  assert.deepEqual(pr('labeled', { top: { label: { name: 'perf' } } }), [], 'a label nobody asked for');
  assert.deepEqual(pr('synchronize'), []);

  const closedIssue = kit.eventsOf('issues', { action: 'closed', repository: REPO, sender: user('rdbtCVS'), issue: issueOf(3, 'alice', { state_reason: 'not_planned' }) }, opts);
  assert.match(closedIssue[0].line, /⛔ \*\*rdbtCVS\*\* closed issue #3 Bug 3 as not planned/);
  const mods = kit.eventsOf('pull_request', { action: 'reopened', repository: MODS, sender: user('bob'), pull_request: { ...prOf(2, 'alice'), html_url: 'https://github.com/horizon-rust/horizon-mods/pull/2' } }, opts);
  assert.match(mods[0].line, /PR #2 Fix thing 2 \(horizon-mods\) <https:\/\/github\.com\/horizon-rust\/horizon-mods\/pull\/2>/);
  assert.notEqual(mods[0].key, pr('reopened')[0].key, 'keys are per repo');
});

test('checkFailure(): only the watched checks that failed or timed out', () => {
  const run = (name, conclusion, repository = REPO) => kit.checkFailure('check_run', { action: 'completed', repository, check_run: { name, conclusion, head_sha: 'abc', html_url: 'u', pull_requests: [] } }, { horizon: ['verify', 'parity'], 'horizon-mods': ['check'] });
  assert.deepEqual(run('verify', 'failure'), { repo: 'horizon', sha: 'abc', name: 'verify', url: 'u', numbers: [] });
  assert.ok(run('parity', 'timed_out'));
  assert.equal(run('verify', 'success'), null);
  assert.equal(run('verify', 'cancelled'), null);
  assert.equal(run('label', 'failure'), null);
  assert.ok(run('check', 'failure', MODS));
  assert.equal(run('verify', 'failure', MODS), null);
});

test('conflictChanges(): MERGEABLE → CONFLICTING is news; the first look, UNKNOWN and already-conflicting are not', () => {
  const p = (number, mergeable) => ({ repo: 'horizon', number, title: 't', url: `https://github.com/horizon-rust/horizon/pull/${number}`, author: 'alice', mergeable });
  let r = kit.conflictChanges({}, [p(1, 'MERGEABLE'), p(2, 'CONFLICTING'), p(3, 'UNKNOWN')]);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.known, { 'horizon#1': 'MERGEABLE', 'horizon#2': 'CONFLICTING' });
  r = kit.conflictChanges(r.known, [p(1, 'UNKNOWN'), p(2, 'CONFLICTING')]);
  assert.deepEqual(r.events, []);
  assert.equal(r.known['horizon#1'], 'MERGEABLE', 'UNKNOWN keeps what was known');
  r = kit.conflictChanges(r.known, [p(1, 'CONFLICTING'), p(2, 'MERGEABLE')]);
  assert.equal(r.events.length, 1);
  assert.match(r.events[0].line, /⚠️ PR #1 t has merge conflicts/);
  r = kit.conflictChanges(r.known, [p(1, 'CONFLICTING')]);
  assert.deepEqual(r.events, []);
  assert.deepEqual(Object.keys(r.known), ['horizon#1'], 'closed pull requests are forgotten');
});

test('dmText(): one line per key, a header, the way out, under Discord\'s limit', () => {
  const e = (key, line) => ({ key, line });
  const text = kit.dmText([e('a', 'one'), e('a', 'one again'), e('b', 'two')]);
  assert.equal(text, '🔔 **Horizon**: 2 updates on your pull requests and issues\n• one\n• two\n-# You get these because you turned them on with `/notify`. `/notify dm:off` stops them.');
  const many = kit.dmText(Array.from({ length: 80 }, (_, n) => e(String(n), 'x'.repeat(60))));
  assert.ok(many.length <= 2000);
  assert.match(many, /…and \d+ more/);
});

test('makeBatcher(): one DM per window, never two within the gap', async () => {
  let clock = 0;
  const timers = [];
  const sent = [];
  const b = kit.makeBatcher({ windowMs: 100, gapMs: 500, now: () => clock, send: async (id, ev) => sent.push([id, ev.map((x) => x.key)]), timers: { set: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; }, clear: (t) => { t.dead = true; } } });
  const tick = async (to) => { clock = to; for (const t of timers.filter((t) => !t.dead && !t.done && t.at <= clock)) { t.done = true; await t.fn(); } };
  b.add('u', { key: 'a' });
  b.add('u', { key: 'b' });
  await tick(99);
  assert.equal(sent.length, 0);
  await tick(100);
  assert.deepEqual(sent, [['u', ['a', 'b']]]);
  b.add('u', { key: 'c' }); // 100 ms after the DM: waits for the gap
  await tick(300);
  assert.equal(sent.length, 1);
  await tick(600);
  assert.deepEqual(sent[1], ['u', ['c']]);
  b.add('v', { key: 'x' });
  b.drop('v');
  await tick(10_000);
  assert.equal(sent.length, 2, 'a dropped batch never goes');
});

// ── The feature ──────────────────────────────────────────────────────────────

const dms = [];
let dmClosed = new Set();
notify._test.setDm(async (id, content) => {
  if (dmClosed.has(id)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
  dms.push({ id, content });
});
const searches = [];
const gh = { search: () => [] };
notify._test.setGitHub({ graphql: async (query, vars) => { searches.push(vars.q); return { data: { search: { nodes: gh.search(vars.q) } } }; }, get: async () => null });
const work = notify._test.work;
const box = notify._test.box;
const verify = (id, login) => { work.links[id] = login; work.verified[id] = login; };

const route = webhook.routes({ secret: SECRET, owner: 'horizon-rust' })['POST /github/webhook'];
async function deliver(event, payload, { secret = SECRET, id = String(Math.random()) } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const req = Object.assign(Readable.from([body]), { headers: { 'x-github-event': event, 'x-github-delivery': id, 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }, socket: { remoteAddress: '1.2.3.4' } });
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  await route(req, res);
  return res;
}
const interaction = (id, dm) => {
  const out = [];
  return { out, user: { id }, options: { getString: () => dm ?? null }, reply: async (m) => out.push(m.content), deferReply: async () => {}, editReply: async (m) => out.push(m.content) };
};

test('the old CI-only opt-ins carry over', () => {
  assert.ok(box.users.old);
  assert.equal(work.notify, undefined);
});

test('/notify: only for a verified account; on sends a first DM; status; off', async () => {
  let i = interaction('m1', 'on');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /Link your GitHub account first/);
  work.links.m1 = 'alice';
  i = interaction('m1', 'on');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /Verify that \*\*alice\*\* is yours first/);
  assert.equal(box.users.m1, undefined);
  verify('m1', 'alice');
  i = interaction('m1', 'on');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /On for GitHub \*\*alice\*\*: I just sent you a first DM/);
  assert.equal(dms.length, 1);
  assert.match(dms[0].content, /Notifications are on/);
  i = interaction('m1');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /🔔 Notifications are on for GitHub \*\*alice\*\*/);
  i = interaction('m1', 'off');
  await notify.handlers.notify(i);
  assert.equal(box.users.m1, undefined);
  i = interaction('m1', 'status');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /🔕 Notifications are off/);
});

test('/notify dm:on with DMs closed: noted and said', async () => {
  verify('m2', 'carol');
  dmClosed.add('m2');
  const i = interaction('m2', 'on');
  await notify.handlers.notify(i);
  assert.match(i.out[0], /I can't DM you/);
  assert.ok(box.users.m2.closedAt);
  const s = interaction('m2');
  await notify.handlers.notify(s);
  assert.match(s.out[0], /your DMs were closed/);
  dmClosed = new Set();
});

test('webhook: signed deliveries become one batched DM; unsigned ones are refused; redeliveries count once', async () => {
  dms.length = 0;
  verify('m3', 'dana');
  box.users.m3 = { since: 1 };
  const bad = await deliver('issue_comment', {}, { secret: 'wrong' });
  assert.equal(bad.status, 401);
  const review = { action: 'submitted', repository: REPO, sender: user('bob'), pull_request: prOf(40, 'dana'), review: { state: 'changes_requested', body: 'see inline', html_url: 'https://github.com/horizon-rust/horizon/pull/40#pullrequestreview-2' } };
  assert.equal((await deliver('pull_request_review', review, { id: 'd1' })).status, 202);
  assert.equal(JSON.parse((await deliver('pull_request_review', review, { id: 'd1' })).body).duplicate, true);
  await deliver('issue_comment', { action: 'created', repository: REPO, sender: user('dana'), issue: issueOf(40, 'dana', { pull_request: {} }), comment: { id: 1, body: 'thanks' } });
  await deliver('pull_request', { action: 'labeled', repository: REPO, sender: user('ludovic111'), label: { name: 'needs-proof' }, pull_request: prOf(40, 'dana') });
  await deliver('pull_request', { action: 'closed', repository: REPO, sender: user('ludovic111'), pull_request: prOf(41, 'erin', { merged: true }) }); // not a subscriber
  await deliver('pull_request', { action: 'closed', repository: { ...REPO, full_name: 'someone/else', owner: { login: 'someone' } }, sender: user('x'), pull_request: prOf(42, 'dana', { merged: true }) }); // another account's repo
  await deliver('pull_request', { action: 'closed', repository: KIRA, sender: user('x'), pull_request: prOf(43, 'dana', { merged: true }) }); // a private repo of the org
  await deliver('pull_request', { action: 'closed', repository: MIXINS, sender: user('ludovic111'), pull_request: { ...prOf(9, 'dana', { merged: true }), html_url: 'https://github.com/horizon-rust/horizon-mixins/pull/9' } }); // any public repo of the org
  assert.equal(notify._test.batch.pending('m3').length, 3);
  await notify._test.batch.flush('m3');
  assert.equal(dms.length, 1);
  assert.match(dms[0].content, /3 updates/);
  assert.match(dms[0].content, /🟣 \*\*ludovic111\*\* merged PR #9 Fix thing 9 \(horizon-mixins\)/);
  assert.doesNotMatch(dms[0].content, /#4[23]/);
  assert.match(dms[0].content, /🔁 \*\*bob\*\* requested changes on PR #40/);
  assert.match(dms[0].content, /🏷️ \*\*ludovic111\*\* added \*\*needs-proof\*\*/);
  assert.doesNotMatch(dms[0].content, /thanks/);
});

test('webhook: a failed required check on a fork\'s head finds its pull request once, then DMs', async () => {
  dms.length = 0;
  searches.length = 0;
  gh.search = (q) => (q.includes('forksha') ? [{ number: 77, title: 'From a fork', url: 'https://github.com/horizon-rust/horizon/pull/77', headRefOid: 'forksha', author: { login: 'dana' } }] : []);
  const run = (name) => ({ action: 'completed', repository: REPO, sender: user('github-actions[bot]', 'Bot'), check_run: { name, conclusion: 'failure', head_sha: 'forksha', html_url: 'u', pull_requests: [] } });
  await deliver('check_run', run('verify'));
  await deliver('check_run', run('verify'), {}); // a second delivery of the same failure: the same key
  await deliver('check_run', run('jfr-analysis')); // not watched
  assert.equal(searches.length, 1, 'the head is searched once');
  await notify._test.batch.flush('m3');
  assert.equal(dms.length, 1);
  assert.match(dms[0].content, /• ❌ \*\*verify\*\* failed on PR #77 From a fork <https:\/\/github\.com\/horizon-rust\/horizon\/pull\/77>/);
  assert.doesNotMatch(dms[0].content, /updates/);
});

test('merge conflicts: news when an open pull request of a subscriber starts conflicting', async () => {
  dms.length = 0;
  let state = 'MERGEABLE';
  gh.search = (q) => (q.includes('author:dana') ? [{ number: 40, title: 'Fix thing 40', url: 'https://github.com/horizon-rust/horizon/pull/40', mergeable: state, author: { login: 'dana' }, repository: { name: 'horizon', isPrivate: false } }, { number: 5, title: 'Private', url: 'https://github.com/horizon-rust/kira/pull/5', mergeable: state === 'MERGEABLE' ? 'MERGEABLE' : 'CONFLICTING', author: { login: 'dana' }, repository: { name: 'kira', isPrivate: true } }] : []);
  await notify.checkConflicts();
  assert.equal(notify._test.batch.pending('m3').length, 0);
  assert.match(searches.at(-1), /^is:pr is:open archived:false org:horizon-rust .*author:dana/);
  state = 'CONFLICTING';
  await notify.checkConflicts();
  await notify.checkConflicts();
  await notify._test.batch.flush('m3');
  assert.equal(dms.length, 1);
  assert.match(dms[0].content, /⚠️ PR #40 Fix thing 40 has merge conflicts/);
  assert.doesNotMatch(dms[0].content, /Private/, 'private repos stay out');
});

test('closed DMs at delivery: noted, nothing more is queued for that member', async () => {
  dms.length = 0;
  dmClosed.add('m3');
  await deliver('pull_request', { action: 'reopened', repository: REPO, sender: user('bob'), pull_request: prOf(40, 'dana') });
  await notify._test.batch.flush('m3');
  assert.ok(box.users.m3.closedAt);
  await deliver('pull_request', { action: 'closed', repository: REPO, sender: user('bob'), pull_request: prOf(40, 'dana') });
  assert.equal(notify._test.batch.pending('m3').length, 0);
  assert.equal(dms.length, 0);
});

test('with the webhook on, the board\'s CI look sends nothing (its check runs do)', () => {
  assert.equal(notify.webhookOn(), true);
  assert.equal(notify.fromBoardCi({ number: 1, title: 't', url: 'u', login: 'dana', sha: 's' }), false);
});
