// /gh: triage of Horizon's issues and pull requests by the trusted reviewers, through Kira (fake GitHub, fake Discord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-triage-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { OWNER_ID, TRIAGE } = await import('../src/config.js');
const core = await import('../src/core.js');
const t = await import('../src/features/triage.js');
const kit = await import('../src/triage-kit.js');

// A fake Horizon: issues, labels, and every write recorded.
const writes = [];
const items = new Map();
const labels = new Set(['bug', 'enhancement', 'duplicate', 'release-now', 'release-blocker', 'skip-release', 'in progress', 'good first issue']);
const item = (n, o = {}) => items.set(n, { number: n, state: 'open', html_url: `https://github.com/ludovic111/horizon/issues/${n}`, labels: [], user: { login: 'someone' }, ...o });
const fake = {
  get: async (path) => {
    const issue = path.match(/\/issues\/(\d+)$/);
    if (issue) return items.get(Number(issue[1])) ?? null;
    const label = path.match(/\/labels\/(.+)$/);
    if (label) { const name = decodeURIComponent(label[1]); return [...labels].find((l) => l.toLowerCase() === name.toLowerCase()) ? { name: [...labels].find((l) => l.toLowerCase() === name.toLowerCase()) } : null; }
    return null;
  },
  write: async (method, path, body) => { writes.push([method, path.replace('/repos/ludovic111/horizon', ''), body]); return {}; },
};
t._test.setGitHub(fake);
const logged = [];
core.client.channels.cache.set('LOG', { send: async (m) => logged.push(m.embeds[0].data) });
core.state.channels.modlog = 'LOG';

const work = (core.state.work ??= {});
work.links = { kac: 'kacpherek', rdbt: 'rdbtCVS', rando: 'rando-gh', nover: 'Online5277' };
work.verified = { kac: 'kacpherek', rdbt: 'rdbtCVS', rando: 'rando-gh' };

const run = async (userId, sub, opts = {}, { staff = false } = {}) => {
  const out = [];
  await t.handlers.gh({
    user: { id: userId }, member: { permissions: { has: () => staff } },
    options: { getSubcommand: () => sub, getInteger: (k) => opts[k] ?? null, getString: (k) => opts[k] ?? null },
    deferReply: async () => {}, editReply: async (m) => out.push(m.content),
  });
  return out.at(-1);
};
const reset = () => { t._test.setGitHub(fake); writes.length = 0; logged.length = 0; items.clear(); t._test.triage.log = {}; t._test.triage.paused = null; };

test('only a verified link to a listed reviewer may triage', async () => {
  reset(); item(5);
  assert.match(await run('nobody', 'close', { number: 5 }), /Link your GitHub account/);
  assert.match(await run('nover', 'close', { number: 5 }), /Verify your GitHub account/);
  assert.match(await run('rando', 'close', { number: 5 }), /rando-gh.* not on the list/);
  assert.equal(writes.length, 0);
  assert.match(await run('kac', 'close', { number: 5 }), /closed #5/);
});

test('label add and remove: the comment is "Kira, on behalf of", the staff log has a line, the label must exist', async () => {
  reset(); item(7, { labels: [{ name: 'enhancement' }] });
  assert.match(await run('kac', 'label', { number: 7, action: 'add', label: 'Bug' }), /added label/);
  assert.deepEqual(writes[0], ['POST', '/issues/7/labels', { labels: ['bug'] }], 'GitHub\'s own spelling of the label');
  const [method, path, body] = writes[1];
  assert.equal(`${method} ${path}`, 'POST /issues/7/comments');
  assert.match(body.body, /🤖 Kira, on behalf of @kacpherek: added the label `bug`\./);
  assert.match(body.body, /<!-- kira -->/, 'never relayed to Discord');
  assert.equal(logged.length, 1);
  assert.match(logged[0].description, /<@kac> \(\*\*kacpherek\*\*\): added label `Bug` to #7/);
  assert.match(await run('kac', 'label', { number: 7, action: 'add', label: 'enhancement' }), /already has/);
  assert.match(await run('kac', 'label', { number: 7, action: 'remove', label: 'bug' }), /doesn't have/);
  assert.match(await run('kac', 'label', { number: 7, action: 'add', label: 'made up' }), /no label `made up`/);
  writes.length = 0;
  assert.match(await run('rdbt', 'label', { number: 7, action: 'remove', label: 'enhancement' }), /removed label/);
  assert.equal(writes[0][0] + ' ' + writes[0][1], 'DELETE /issues/7/labels/enhancement');
});

test('release labels and Kira\'s claim label are never touched', async () => {
  reset(); item(8, { labels: [{ name: 'release-now' }] });
  for (const label of ['release-now', 'Release-Blocker', 'skip-release', 'in progress']) {
    for (const action of ['add', 'remove']) assert.match(await run('kac', 'label', { number: 8, action, label }), /release label|claim label/, `${action} ${label}`);
  }
  assert.equal(writes.length, 0);
  assert.equal(kit.labelRefusal('good first issue', TRIAGE), null);
});

test('close with a reason and a note; reopen; a duplicate closes as not planned and points at the original', async () => {
  reset(); item(10); item(11); item(12, { state: 'closed' });
  assert.match(await run('kac', 'close', { number: 10, reason: 'not_planned', note: 'see @someone and fixes #3' }), /closed #10 \(not planned\)/);
  assert.deepEqual(writes[0], ['PATCH', '/issues/10', { state: 'closed', state_reason: 'not_planned' }]);
  assert.match(writes[1][2].body, /on behalf of @kacpherek: closed this as not planned\. Note: see `@someone` and .*`#3`/s, 'free text cannot ping or cross-reference');
  writes.length = 0;
  assert.match(await run('kac', 'close', { number: 12 }), /already closed/);
  assert.match(await run('kac', 'reopen', { number: 10 }), /already open/);
  assert.match(await run('kac', 'reopen', { number: 12 }), /reopened #12/);
  assert.deepEqual(writes[0], ['PATCH', '/issues/12', { state: 'open' }]);
  writes.length = 0;
  assert.match(await run('rdbt', 'duplicate', { number: 11, of: 10 }), /closed #11 as a duplicate of #10/);
  assert.deepEqual(writes.map((w) => `${w[0]} ${w[1]}`), ['POST /issues/11/labels', 'PATCH /issues/11', 'POST /issues/11/comments']);
  assert.deepEqual(writes[1][2], { state: 'closed', state_reason: 'not_planned' });
  assert.match(writes[2][2].body, /closed this as a duplicate of #10\./);
  assert.match(await run('rdbt', 'duplicate', { number: 11, of: 11 }), /itself/);
  assert.match(await run('rdbt', 'duplicate', { number: 11, of: 99 }), /no #99/);
  assert.match(await run('rdbt', 'close', { number: 404 }), /no such issue/);
});

test('never Ludovic\'s pull requests, never a merged one; his issues and others\' pull requests are fine; there is no merge', async () => {
  reset();
  item(20, { pull_request: {}, user: { login: 'ludovic111' } });
  item(21, { pull_request: { merged_at: '2026-10-27T00:00:00Z' }, state: 'closed' });
  item(22, { pull_request: {}, user: { login: 'contrib' } });
  item(23, { user: { login: 'ludovic111' } });
  for (const [sub, o] of [['close', {}], ['reopen', {}], ['duplicate', { of: 22 }], ['label', { action: 'add', label: 'bug' }]]) {
    assert.match(await run('kac', sub, { number: 20, ...o }), /by ludovic111 are not for triage/, sub);
  }
  assert.match(await run('kac', 'reopen', { number: 21 }), /already merged/);
  assert.equal(writes.length, 0);
  assert.match(await run('kac', 'close', { number: 22 }), /closed #22/);
  assert.deepEqual(writes[0], ['PATCH', '/issues/22', { state: 'closed' }], 'a pull request has no close reason');
  assert.match(await run('kac', 'close', { number: 23 }), /closed #23/);
  const { commands } = t;
  assert.deepEqual(commands[0].toJSON().options.map((o) => o.name), ['label', 'close', 'reopen', 'duplicate', 'pause', 'resume']);
  assert.ok(writes.every(([, path]) => !/merge/.test(path)));
});

test('60 actions in 24 hours per reviewer; older ones stop counting; a GitHub refusal gives the action back', async () => {
  reset(); item(30);
  const now = Date.now();
  t._test.triage.log = { kacpherek: Array.from({ length: 59 }, (_, i) => now - 1000 - i), rdbtcvs: Array.from({ length: 60 }, () => now - 25 * 3600_000) };
  assert.match(await run('kac', 'label', { number: 30, action: 'add', label: 'bug' }), /added label/); // the 60th
  assert.match(await run('kac', 'close', { number: 30 }), /used your 60 actions/);
  assert.equal(writes.length, 2, 'the 61st does nothing on GitHub');
  assert.match(await run('rdbt', 'label', { number: 30, action: 'add', label: 'enhancement' }), /added label/);
  assert.equal(kit.usedToday(t._test.triage.log, 'rdbtCVS', Date.now()), 1, 'the 60 actions of 25 hours ago do not count');
  assert.equal(kit.usedToday(t._test.triage.log, 'kacpherek', Date.now()), 60);
  // GitHub refuses (no permission): nothing counted
  const before = kit.usedToday(t._test.triage.log, 'rdbtCVS', Date.now());
  t._test.setGitHub({ get: async (p) => (p.endsWith('/issues/30') ? items.get(30) : null), write: async () => { throw new Error('HTTP 403'); } });
  assert.match(await run('rdbt', 'close', { number: 30 }), /refused that.*Nothing was changed/);
  assert.equal(kit.usedToday(t._test.triage.log, 'rdbtCVS', Date.now()), before);
});

test('/gh pause stops everyone until /gh resume; only Ludovic and mods', async () => {
  reset(); item(40);
  assert.match(await run('kac', 'pause', {}), /Only Ludovic and the mods/);
  assert.match(await run('kac', 'close', { number: 40 }), /closed #40/);
  item(41);
  assert.match(await run('mod', 'pause', { reason: 'cleaning up' }, { staff: true }), /paused for everyone/);
  assert.match(await run('rdbt', 'close', { number: 41 }), /paused by the mods.*cleaning up/);
  assert.match(await run(OWNER_ID, 'resume', {}), /on again/);
  assert.match(await run('rdbt', 'close', { number: 41 }), /closed #41/);
  assert.ok(logged.some((e) => e.title === 'GitHub triage paused') && logged.some((e) => e.title === 'GitHub triage resumed'));
});
