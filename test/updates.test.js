// #updates (src/journal.js, src/features/updates.js, the board's summary) and the export of the channels it
// replaces (src/archive.js). No Discord connection, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-updates-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
const journal = await import('../src/journal.js');
const archive = await import('../src/archive.js');
const core = await import('../src/core.js');
const updates = await import('../src/features/updates.js');
const hubFeature = await import('../src/features/hub.js');

const HUB = 'https://playhorizon.dev/hub';
const J = { entries: [
  { id: 'weekly-2026-43', kind: 'weekly', date: '2026-10-26T09:00:00Z', title: 'The week of 19 October', plain: 'Faster frames, server dialogs.', url: 'https://playhorizon.dev/hub#journal' },
  { id: 'release-v0.2.61', kind: 'release', date: '2026-10-25T20:00:00Z', tag: 'v0.2.61', title: 'v0.2.61', plain: 'Smoother frames.', url: 'https://github.com/ludovic111/horizon/releases/tag/v0.2.61' },
  { id: 'shipped-smooth', kind: 'shipped', date: '2026-10-25T20:01:00Z', item: 'smooth-frames', title: 'Steady frames', plain: 'Smooth at 32 chunks.', post: 'Horizon now keeps steady frames at 32 chunks.', shipped_in: 'v0.2.61', announce: true },
  { id: 'merge-1760', kind: 'merge', date: '2026-10-25T10:00:00Z', item: 'smooth-frames', number: 1760, title: 'Free structure starts', plain: 'Worlds generate without queueing.', url: 'https://github.com/ludovic111/horizon/pull/1760' },
  { id: 'merge-1778', kind: 'merge', date: '2026-10-25T11:00:00Z', item: 'smooth-frames', number: 1778, title: 'Leave one core', url: 'https://github.com/ludovic111/horizon/pull/1778' },
  { id: 'merge-1800', kind: 'merge', date: '2026-10-25T12:00:00Z', number: 1800, title: 'Fix a typo', url: 'https://evil.example/x' },
  { id: 'odd-1', kind: 'tweet', date: '2026-10-25T12:00:00Z', title: '?' },
] };

test('new entries: oldest first, each once, unknown kinds remembered and never shown', () => {
  const a = journal.newEntries(J, []);
  assert.deepEqual(a.entries.map((e) => e.id), ['merge-1760', 'merge-1778', 'merge-1800', 'release-v0.2.61', 'shipped-smooth', 'weekly-2026-43']);
  assert.ok(a.seen.includes('odd-1'));
  const b = journal.newEntries(J, a.seen);
  assert.deepEqual(b.entries, []);
  assert.equal(journal.isJournal({ entries: [{ id: 1 }] }), false);
});

test('the feed: merges grouped by roadmap item, a release points to #releases, shipped and the week; silent, no pings', () => {
  const posts = journal.feedPosts(journal.newEntries(J, []).entries, { hubUrl: HUB, releases: '42', titleOf: (id) => (id === 'smooth-frames' ? 'Steady frames at long render distances' : null) });
  assert.equal(posts.length, 5);
  assert.match(posts[0].content, /^🔀 \*\*\[Steady frames at long render distances\]\(<https:\/\/playhorizon\.dev\/hub#smooth-frames>\)\*\*/);
  assert.match(posts[0].content, /#1760 Worlds generate without queueing[\s\S]*#1778 Leave one core/, 'plain words first, the title when there are none');
  assert.match(posts[1].content, /^🔀 \*\*Other changes\*\*\n• #1800 Fix a typo$/, 'a link outside GitHub or the site is dropped');
  assert.match(posts[2].content, /📦 \*\*\[v0\.2\.61\]\(<https:\/\/github\.com\/ludovic111\/horizon\/releases\/tag\/v0\.2\.61>\)\*\* is out \(notes in <#42>\): Smoother frames\./);
  assert.match(posts[3].content, /✅ \*\*Shipped in v0\.2\.61: \[Steady frames\]\(<https:\/\/playhorizon\.dev\/hub#smooth-frames>\)\*\*\nHorizon now keeps steady frames/);
  assert.equal(posts[4].embeds[0].title, '🗓️ The week of 19 October');
  for (const p of posts) { assert.deepEqual(p.allowedMentions, { parse: [] }); assert.equal(p.flags, 4096); }
});

test('the board summary: counts, a few good first tasks, the hub', () => {
  const snap = { columns: [{ key: 'todo', cards: [1, 2, 3] }, { key: 'progress', cards: [1] }, { key: 'review', cards: [] }, { key: 'done', cards: [1, 2] }] };
  const s = journal.summaryText(snap, [{ number: 12, title: 'Sign glow', url: 'https://github.com/ludovic111/horizon/issues/12' }], HUB);
  assert.match(s.content, /To do \*\*3\*\* · 🔨 In progress \*\*1\*\* · 👀 Review \*\*0\*\* · ✅ Done this week \*\*2\*\*/);
  assert.match(s.content, /\[#12 Sign glow\]\(<https:\/\/github\.com/);
  assert.match(s.content, /<https:\/\/playhorizon\.dev\/hub>/);
  assert.match(journal.summaryText(snap, [], HUB).content, /No good first tasks/);
});

test('#updates: the first look only records; then each new entry is posted once; no channel yet → nothing recorded', async () => {
  hubFeature._test.setFetch(async () => null);
  let data = { entries: J.entries.slice(3) };
  updates._test.setFetch(async () => data);
  await updates.poll(); // no #updates yet
  assert.equal(updates._test.state.seeded, undefined);
  const sent = [];
  core.state.channels.updates = '900';
  core.client.channels.cache.set('900', { send: async (m) => { sent.push(m); return m; } });
  await updates.poll();
  assert.equal(sent.length, 0, 'first look: seeded quietly');
  data = J;
  await updates.poll();
  await updates.poll();
  assert.equal(sent.length, 3);
  assert.match(sent[0].content, /^📦/);
  assert.match(sent[1].content, /^✅/);
  assert.match(sent[2].embeds[0].title, /^🗓️ The week/);
});

test('the export before a channel is deleted: every page, oldest first, JSON and Markdown', async () => {
  const msgs = Array.from({ length: 230 }, (_, i) => ({ id: String(1000 + i), createdTimestamp: Date.UTC(2026, 9, 1) + i * 1000, author: { id: '7', username: 'kira', bot: true }, content: `line ${i}`, embeds: i === 5 ? [{ title: 'To do', description: 'cards' }] : [], attachments: new Map(), pinned: i === 5 }));
  const calls = [];
  const channel = { id: '55', messages: { fetch: async ({ limit, before }) => {
    calls.push(before ?? null);
    const older = msgs.filter((m) => !before || BigInt(m.id) < BigInt(before)).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, limit);
    return new Map(older.map((m) => [m.id, m]));
  } } };
  const dir = mkdtempSync(join(tmpdir(), 'kira-export-'));
  assert.equal(await archive.exportChannel(channel, 'dev-log', dir), 230);
  assert.equal(calls.length, 3);
  const saved = JSON.parse(readFileSync(join(dir, 'dev-log.json'), 'utf8'));
  assert.equal(saved.messages[0].content, 'line 0');
  assert.equal(saved.messages.at(-1).content, 'line 229');
  const md = readFileSync(join(dir, 'dev-log.md'), 'utf8');
  assert.match(md, /^# #dev-log\n\n230 messages/);
  assert.match(md, /pinned\n\nline 5\n\n\*\*To do\*\*\ncards/);
});

test('the board summary at the top of #updates: posted and pinned once, then edited in place', async () => {
  const wb = await import('../src/features/workboard.js');
  core.client.user = { id: 'kira' };
  const msgs = new Map();
  let pins = 0;
  core.client.channels.cache.set(core.state.channels.updates, { // the bot's saves keep setup's channel ids as on disk

    send: async (m) => { const msg = { id: `m${msgs.size + 1}`, ...m, pin: async () => { pins++; }, edit: async (p) => Object.assign(msg, p) }; msgs.set(msg.id, msg); return msg; },
    messages: { fetch: async (q) => (typeof q === 'string' ? msgs.get(q) ?? Promise.reject(new Error('gone')) : { filter: () => new Map() }) }, // a Collection
  });
  wb._test.setRaw({ repo: 'ludovic111/horizon', issues: [{ number: 4, title: 'Open one', html_url: 'https://github.com/ludovic111/horizon/issues/4', state: 'open', labels: [], assignees: [], created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }], pulls: [], branches: [] });
  wb._test.rebuild();
  await wb._test.render();
  await wb._test.render();
  assert.equal(msgs.size, 1);
  assert.equal(pins, 1);
  assert.match(msgs.get('m1').content, /To do \*\*1\*\*/);
  assert.equal(wb._test.work.summary, 'm1');
});

test('the pinned roadmap in #updates: posted and pinned once (the pin list in the roadmap\'s order), edited in place when the roadmap changes, a deleted message posted again', async () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/roadmap.json', import.meta.url), 'utf8'));
  let roadmapNow = real;
  hubFeature._test.setFetch(async () => roadmapNow);
  core.client.user = { id: 'kira' };
  const msgs = new Map();
  const pinned = [];
  const log = [];
  let made = 0;
  const channel = {
    send: async (m) => {
      const msg = { id: `r${++made}`, ...m, pinned: false, type: 0, author: { id: 'kira' },
        pin: async () => { msg.pinned = true; pinned.push(msg.id); }, edit: async (p) => { log.push(`edit ${msg.id}`); return Object.assign(msg, p); }, delete: async () => { msgs.delete(msg.id); } };
      msgs.set(msg.id, msg);
      return msg;
    },
    messages: { fetch: async (q) => {
      if (typeof q !== 'string') return { filter: () => new Map() };
      if (!msgs.has(q)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      return msgs.get(q);
    } },
  };
  core.client.channels.cache.set(core.state.channels.updates, channel);
  const before = JSON.stringify(Object.keys(core.state).sort());

  await updates.syncRoadmap();
  const ids = [...core.state.roadmapPin.ids];
  assert.equal(ids.length, 2, 'the real roadmap is two messages');
  assert.deepEqual(pinned, [ids[1], ids[0]], 'pinned last to first');
  assert.equal(msgs.get(ids[0]).embeds.length + msgs.get(ids[1]).embeds.length, 12);
  assert.deepEqual(msgs.get(ids[0]).allowedMentions, { parse: [] });
  assert.equal(msgs.get(ids[1]).flags, 4096);
  assert.equal(JSON.stringify(Object.keys(core.state).sort()), before, 'no other key of the state is added');

  await updates.syncRoadmap(); // unchanged: no call at all
  assert.deepEqual(log, []);
  assert.equal(msgs.size, 2);

  updates._test.forgetVerified(); // after a restart: checked, edited in place, never posted again
  await updates.syncRoadmap();
  assert.deepEqual(log, [`edit ${ids[0]}`, `edit ${ids[1]}`]);
  assert.equal(msgs.size, 2);

  roadmapNow = { ...real, items: real.items.map((i) => (i.id === 'smooth-frames' ? { ...i, title: 'Steady frames, renamed', status: 'shipped' } : i)) };
  hubFeature._test.setFetch(async () => roadmapNow);
  log.length = 0;
  await updates.syncRoadmap();
  assert.equal(log.length, 2);
  assert.deepEqual(core.state.roadmapPin.ids, ids);
  assert.doesNotMatch(msgs.get(ids[0]).embeds[0].description, /Steady frames at long render distances/);
  assert.equal(pinned.length, 2, 'already pinned: not pinned again');

  msgs.delete(ids[1]); // a moderator deleted one: noticed at the next start or change
  updates._test.forgetVerified();
  await updates.syncRoadmap();
  assert.equal(msgs.size, 2);
  assert.notEqual(core.state.roadmapPin.ids[1], ids[1]);
  assert.equal(core.state.roadmapPin.ids[0], ids[0]);
  assert.equal(pinned.length, 3, 'the new one is pinned');
  assert.equal(JSON.parse(readFileSync(process.env.KIRA_STATE, 'utf8')).roadmapPin.ids.length, 2, 'saved');
});
