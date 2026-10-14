// /agent connect, end to end in-process: an ephemeral answer with a working token and the setups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kira-connect-'));
process.env.KIRA_STATE = join(dir, 'state.json');
process.env.KIRA_AGENTS = join(dir, 'agents.json');
process.env.KIRA_AGENT_ISSUANCE = 'on';
process.env.KIRA_MCP_URL = 'https://kira.example.test/mcp';
const feat = await import('../src/features/agents.js');
const ag = await import('../src/agents.js');
const { MessageFlags } = await import('discord.js');

const interaction = (sub, opts = {}, user = '181818181818181818') => {
  const replies = [];
  return {
    replies,
    user: { id: user, username: 'tester' },
    member: { displayName: 'Tester', permissions: { has: () => false }, roles: { cache: { has: () => false } } },
    options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getUser: () => null },
    reply: async (r) => { replies.push(r); },
  };
};

test('/agent connect answers privately with a token that works, the setups and how to revoke', async () => {
  const i = interaction('connect', { scope: 'write', label: 'laptop' });
  await feat.handlers.agent(i);
  const r = i.replies[0];
  assert.ok(r.flags & MessageFlags.Ephemeral);
  const token = r.content.match(/kira_[0-9a-f]{8}_[A-Za-z0-9_-]{43}/)[0];
  const v = ag.verify(feat.store, token);
  assert.deepEqual([v.ok, v.user, v.scope], [true, '181818181818181818', 'write']);
  assert.ok(r.content.includes(`claude mcp add --transport http kira https://kira.example.test/mcp --header "Authorization: Bearer ${token}"`));
  assert.match(r.content, /\[mcp_servers\.kira\]/);
  assert.match(r.content, /\/agent revoke id:/);
  assert.ok(r.content.length <= 2000);
  assert.deepEqual(r.allowedMentions, { parse: [] });
});

test('/agent connect: maintain needs the role; the daily cap holds', async () => {
  const m = interaction('connect', { scope: 'maintain' }, '191919191919191919');
  await feat.handlers.agent(m);
  assert.match(m.replies[0].content, /Only maintainers/);
  for (let n = 0; n < 2; n++) await feat.handlers.agent(interaction('connect', {}, '181818181818181818'));
  const fourth = interaction('connect', {}, '181818181818181818');
  await feat.handlers.agent(fourth);
  assert.match(fourth.replies[0].content, /3 tokens in the last 24 hours/);
});
