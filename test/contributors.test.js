// One identity per contributor: /link-github, and the pairs members agreed to show on the hub's contributors page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-credit-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const core = await import('../src/core.js');
const wb = await import('../src/features/workboard.js');

const members = new Map([['1', { displayName: 'Ana' }], ['2', { displayName: 'Bo' }], ['3', { displayName: 'Cy' }]]);
core.client.guilds.cache.set('g', { members: { cache: members } });
wb._test.setGitHub({ get: async (p) => ({ login: decodeURIComponent(p.split('/').pop()) }), write: async () => ({}) });

const link = async (userId, username, { credit = null, member = null, staff = false } = {}) => {
  const out = [];
  await wb.handlers['link-github']({
    user: { id: userId }, member: { permissions: { has: () => staff } },
    options: { getUser: () => (member ? { id: member } : null), getString: () => username, getBoolean: () => credit },
    deferReply: async () => {}, editReply: async (m) => out.push(m.content), reply: async (m) => out.push(m.content),
  });
  return out.at(-1);
};

test('only the members who said yes, with their GitHub login and Discord name, nothing else', async () => {
  assert.match(await link('1', 'ana-gh', { credit: true }), /shows on the hub's contributors page/);
  assert.match(await link('2', 'bo-gh'), /credit:True/, 'linking alone shows nothing, and says how');
  await link('3', 'cy-gh', { credit: true });
  members.delete('3'); // left the server
  assert.deepEqual(wb.creditedPairs(), [{ github: 'ana-gh', discord: 'Ana' }]);
  assert.deepEqual(Object.keys(wb.creditedPairs()[0]), ['github', 'discord']);
});

test('credit:False hides it; a mod linking someone never shows them (and resets their choice)', async () => {
  await link('1', 'ana-gh', { credit: false });
  assert.deepEqual(wb.creditedPairs(), []);
  await link('2', 'bo-gh', { credit: true });
  assert.equal(wb.creditedPairs().length, 1);
  await link('9', 'bo-gh2', { member: '2', staff: true, credit: true });
  assert.deepEqual(wb.creditedPairs(), []);
});
