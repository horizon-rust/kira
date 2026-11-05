// CI failures wired end to end (src/features/workboard.js → src/features/notify.js, no webhook): a DM to a verified
// author who turned /notify on, once per failing commit, and nothing posted in any channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-notices-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
delete process.env.KIRA_GITHUB_WEBHOOK_SECRET;
const core = await import('../src/core.js');
const wb = await import('../src/features/workboard.js');
const notify = await import('../src/features/notify.js');

const dms = [];
const posted = [];
core.client.users.fetch = async (id) => ({ id, send: async (m) => { dms.push({ id, m }); } });
core.client.channels.cache.set('1000', { send: async (m) => { posted.push(m); return m; } });
core.state.channels.updates = '1000';
const pull = (number, ci, sha, login) => ({ number, title: `PR ${number}`, html_url: `https://github.com/x/y/pull/${number}`, state: 'open', draft: false, user: { login }, head: { sha }, ci });

test('CI failing: one batched DM per failing commit to a verified author who asked, nothing in a channel', async () => {
  wb._test.work.links['55'] = 'alice';
  (wb._test.work.verified ??= {})['55'] = 'alice';
  notify._test.box.users['55'] = { since: 1 };
  wb._test.setRaw({ repo: 'x/y', issues: [], pulls: [pull(1, 'failing', 'a', 'alice')], branches: [] });
  await wb._test.notices(); // first look: seeds
  assert.equal(notify._test.batch.pending('55').length, 0);
  wb._test.setRaw({ repo: 'x/y', issues: [], pulls: [pull(1, 'failing', 'a', 'alice'), pull(2, 'failing', 'b', 'alice'), pull(3, 'failing', 'c', 'bob')], branches: [] });
  await wb._test.notices();
  await wb._test.notices();
  await notify._test.batch.flush('55');
  assert.deepEqual(dms.map((d) => d.id), ['55']);
  assert.match(dms[0].m.content, /CI is failing on PR #2 PR 2/);
  assert.doesNotMatch(dms[0].m.content, /#3/);
  assert.deepEqual(dms[0].m.allowedMentions, { parse: [] });
  assert.equal(posted.length, 0);
});
