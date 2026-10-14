// The notices wired end to end (src/features/workboard.js): CI lines in #dev-log and the weekly digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-notices-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const core = await import('../src/core.js');
const wb = await import('../src/features/workboard.js');

const sent = [];
core.state.channels.devlog = '1000';
core.client.channels.cache.set('1000', { send: async (m) => { sent.push(m); return m; } });
const pull = (number, ci, sha, extra = {}) => ({ number, title: `PR ${number}`, html_url: `https://github.com/x/y/pull/${number}`, state: 'open', draft: false, user: { login: 'someone' }, head: { sha }, ci, reviews: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', ...extra });
const readme = Buffer.from('<img src="https://img.shields.io/badge/vanilla%20parity-97.5%25-F0795A"> 281 parity harnesses').toString('base64');
wb._test.setGitHub({ get: async (p) => (p.endsWith('/readme') ? { content: readme } : p.includes('/releases') ? [] : null), write: async () => ({}) });

test('CI failures and the digest reach #dev-log, once', async () => {
  const mon = Date.UTC(2026, 9, 12, 9);
  wb._test.setRaw({ repo: 'x/y', issues: [], pulls: [pull(1, 'failing', 'a')], branches: [] });
  await wb._test.notices(mon - 3_600_000); // first look: seeds, nothing posted
  assert.equal(sent.length, 0);
  wb._test.setRaw({ repo: 'x/y', issues: [{ number: 9, title: 'New issue', html_url: 'https://github.com/x/y/issues/9', state: 'open', created_at: new Date(mon - 86_400_000).toISOString(), labels: [], assignees: [] }],
    pulls: [pull(1, 'failing', 'a'), pull(2, 'failing', 'b'), pull(3, 'passing', 'c', { state: 'closed', merged_at: new Date(mon - 86_400_000).toISOString() })], branches: [] });
  await wb._test.notices(mon + 60_000); // after Monday 09:00: #2 fails, and the week's digest
  assert.equal(sent.filter((m) => typeof m.content === 'string' && /CI is failing on \[#2/.test(m.content)).length, 1);
  const digest = sent.find((m) => m.embeds);
  assert.ok(digest, 'digest posted');
  const e = digest.embeds[0].data;
  assert.match(e.title, /Horizon this week/);
  assert.match(e.description, /Vanilla parity: 97\.5%\*\* of 281 harnesses/);
  assert.match(e.description, /\[#3 PR 3\]/);
  assert.match(e.description, /\[#9 New issue\]/);
  assert.equal(typeof e.color, 'number');
  const n = sent.length;
  await wb._test.notices(mon + 120_000); // nothing new: nothing posted
  assert.equal(sent.length, n);
});
