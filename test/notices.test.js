// CI failures wired end to end (src/features/workboard.js): a DM to the author who turned them on, once per failing
// commit, and nothing posted in any channel (#dev-log is gone; #updates is the journal's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-notices-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const core = await import('../src/core.js');
const wb = await import('../src/features/workboard.js');

const dms = [];
const posted = [];
core.client.users.fetch = async (id) => ({ id, send: async (m) => { dms.push({ id, m }); } });
core.client.channels.cache.set('1000', { send: async (m) => { posted.push(m); return m; } });
core.state.channels.updates = '1000';
const pull = (number, ci, sha, login) => ({ number, title: `PR ${number}`, html_url: `https://github.com/x/y/pull/${number}`, state: 'open', draft: false, user: { login }, head: { sha }, ci });

test('CI failing: one DM per failing commit to a linked author who asked, nothing in a channel', async () => {
  wb._test.work.links['55'] = 'alice';
  (wb._test.work.notify ??= {})['55'] = true;
  wb._test.setRaw({ repo: 'x/y', issues: [], pulls: [pull(1, 'failing', 'a', 'alice')], branches: [] });
  await wb._test.notices(); // first look: seeds
  assert.equal(dms.length, 0);
  wb._test.setRaw({ repo: 'x/y', issues: [], pulls: [pull(1, 'failing', 'a', 'alice'), pull(2, 'failing', 'b', 'alice'), pull(3, 'failing', 'c', 'bob')], branches: [] });
  await wb._test.notices();
  await wb._test.notices();
  assert.deepEqual(dms.map((d) => d.id), ['55']);
  assert.match(dms[0].m.content, /CI is failing on your Horizon pull request #2/);
  assert.deepEqual(dms[0].m.allowedMentions, { parse: [] });
  assert.equal(posted.length, 0);
});
