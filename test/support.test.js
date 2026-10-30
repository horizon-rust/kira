// #horizon-support (Ludovic, 2026-10-30): the forum and its permissions, Kira's first answer and the note for 🤝 Support
// (one ping at most every 15 minutes), replies only from the poster and 🤝 Support, and #horizon-bugs posts that are
// requests for help pointed there instead of filed. A fake model and a fake GitHub; no Discord connection, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits as P } from 'discord.js';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-support-')), 'state.json');
process.env.KIRA_AI = 'mentions';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
process.env.GITHUB_TOKEN = 'test-token-not-used';
const { LAYOUT, GITHUB, ROLES, SUPPORT, GUILD_ID } = await import('../src/config.js');
const { overwrites } = await import('../src/permissions.js');
const issuekit = await import('../src/issuekit.js');
const core = await import('../src/core.js');
const ai = await import('../src/features/ai.js');
const github = await import('../src/features/github.js');
const support = await import('../src/features/support.js');
const kit = await import('../src/support-kit.js');

const spec = LAYOUT.flatMap((g) => g.channels).find((c) => c.key === 'horizonsupport');
core.client.user = { id: 'kira' };
Object.assign(core.state.channels, { horizonsupport: 'sup', horizonbugs: 'bugs', modlog: 'ml' });
Object.assign(core.state.roles, { support: 'R-support', team: 'R-team' });
const logs = [];
core.client.channels.cache.set('ml', { send: async (m) => { logs.push(m); return m; } });

const member = ({ staff = false, roles = [] } = {}) => ({ permissions: { has: () => staff }, roles: { cache: new Set(roles) } });
let n = 0;
function thread({ parent = 'sup', owner = 'u1', name = 'Black screen after Play', tags = [] } = {}) {
  const said = [];
  const t = {
    id: `t${++n}`, guildId: GUILD_ID, parentId: parent, name, ownerId: owner, appliedTags: tags, locked: false,
    parent: { name: parent === 'sup' ? 'horizon-support' : 'horizon-bugs', availableTags: tags.map((name) => ({ id: name, name })) },
    isThread: () => true,
    send: async (m) => { said.push(m); return { ...m, delete: async () => {} }; },
    guild: { members: { fetch: async () => member() } },
  };
  t.said = said;
  core.client.channels.cache.set(t.id, t);
  return t;
}
const starterOf = (t, content, user = 'u1') => ({ id: t.id, content, channel: t, author: { id: user, username: 'sam' }, member: { displayName: 'Sam' }, attachments: new Map(), embeds: [], reactions: { cache: new Map() } });

test('the forum: in 🌅 horizon after #horizon-bugs, a template, a solved tag only helpers set, never a GitHub issue', () => {
  const horizon = LAYOUT.find((g) => g.key === 'horizon').channels.map((c) => c.key);
  assert.equal(horizon.indexOf('horizonsupport'), horizon.indexOf('horizonbugs') + 1);
  assert.equal(spec.type, 'forum');
  assert.deepEqual(spec.helpers, ['support']);
  assert.equal(spec.done, '✅ solved');
  assert.ok(spec.tags.some(([, name, staff]) => name === 'solved' && staff));
  for (const t of ['launcher', "can't start", 'performance', 'account', 'multiplayer', 'other']) assert.ok(spec.tags.some(([, name]) => name === t), t);
  assert.ok(!Object.keys(GITHUB.forums).includes('horizonsupport'), 'support posts never become issues');
  const roles = ROLES.map((r) => r.key);
  assert.ok(roles.indexOf('support') < roles.indexOf('mod'), '🤝 Support sits below 🛡️ Mod');
  assert.equal(ROLES.find((r) => r.key === 'support').permissions, undefined, 'no server-wide permission');
});

test('permissions: everyone posts as usual; 🤝 Support writes in every post and manages threads, in this channel only', () => {
  const ids = { everyone: 'E', mod: 'M', kira: 'K', owner: 'O', roles: { support: 'S', team: 'T' } };
  const ow = overwrites(ids, spec);
  assert.ok(!ow.some((o) => o.id === 'E'), '@everyone keeps the server defaults: open posts, write in them');
  const s = ow.find((o) => o.id === 'S');
  assert.deepEqual(s.allow, [P.SendMessagesInThreads, P.ManageThreads]);
  const bugs = overwrites(ids, LAYOUT.flatMap((g) => g.channels).find((c) => c.key === 'horizonbugs'));
  assert.ok(!bugs.some((o) => o.id === 'S'), 'nothing for 🤝 Support elsewhere');
});

test('a new post: Kira\'s first answer when the sources settle it, then the note for 🤝 Support, pinging at most every 15 minutes', async () => {
  const answers = [{ status: 'answer', reply: 'Update your GPU driver, then start the launcher again.' }, { status: 'pass', reply: 'passed' }, { status: 'answer', reply: 'Try Performance.' }];
  ai._test.set({ sources: { refresh: async () => true, ready: () => true }, answer: async () => ({ models: ['claude-haiku-5-5'], cost: 0.001, ...answers.shift() }) });
  const t0 = 10_000_000;
  const a = thread();
  await support.newPost(a, starterOf(a, "**What's wrong:** black screen\n**OS, CPU, GPU:** Windows 11"), t0);
  assert.match(a.said[0].content, /^Update your GPU driver[\s\S]*first answer from Kira/);
  assert.deepEqual(a.said[0].allowedMentions, { parse: [] });
  assert.equal(a.said[1].content, '🤝 <@&R-support> a new question.');
  assert.deepEqual(a.said[1].allowedMentions.roles, ['R-support']);
  await support.newPost(a, starterOf(a, 'again'), t0 + 1000);
  assert.equal(a.said.length, 2, 'once per post');

  const b = thread();
  await support.newPost(b, starterOf(b, "**What's wrong:** can't sign in\n**OS:** Linux"), t0 + 60_000);
  assert.equal(b.said.length, 1, 'the model passed: no answer posted, 🤝 Support answers');
  assert.equal(b.said[0].content, '🤝 A Support member will answer here.');
  assert.deepEqual(b.said[0].allowedMentions.roles, [], 'within 15 minutes: no ping');

  const c = thread();
  await support.newPost(c, starterOf(c, "**What's wrong:** low fps\n**OS:** Windows"), t0 + SUPPORT.pingEveryMs);
  assert.match(c.said.at(-1).content, new RegExp(`^🤝 <@&R-support> a new question\\.\\nAlso waiting: <#${b.id}>$`));
  assert.deepEqual(support._test.store.waiting, []);
});

test('replies: the poster, 🤝 Support and the staff write; anyone else\'s reply is removed, with one note now and then', async () => {
  const t = thread({ owner: 'u1' });
  const removed = [];
  const msg = (user, m = member()) => ({ id: `m${++n}`, channel: t, channelId: t.id, author: { id: user, bot: false }, member: m, content: 'try reinstalling', delete: async () => { removed.push(user); } });
  assert.equal(await support.onMessage(msg('u1')), false);
  assert.equal(await support.onMessage(msg('helper', member({ roles: ['R-support'] }))), false);
  assert.equal(await support.onMessage(msg('mod', member({ staff: true }))), false);
  const before = t.said.length;
  assert.equal(await support.onMessage(msg('u2')), true);
  assert.equal(await support.onMessage(msg('u2')), true);
  assert.deepEqual(removed, ['u2', 'u2']);
  assert.equal(t.said.length, before + 1, 'one note per member every 10 minutes');
  assert.match(t.said.at(-1).content, /^<@u2> only the person who asked and <@&R-support> write in <#sup> posts[\s\S]*`\/apply`/);
  assert.deepEqual(t.said.at(-1).allowedMentions, { users: ['u2'] });
  const bugs = thread({ parent: 'bugs' });
  assert.equal(await support.onMessage({ ...msg('u2'), channel: bugs, channelId: bugs.id }), false, 'other forums are not touched');
});

test('a help request posted in #horizon-bugs: pointed to #horizon-support, not filed; "bug" from the poster files it', async () => {
  const writes = [];
  github._test.setGitHub({ get: async () => ({}), write: async (method, path, body) => { writes.push({ method, path, body }); return path.endsWith('/issues') ? { number: 88, html_url: 'https://github.com/horizon-rust/horizon/issues/88' } : {}; } });
  const t = thread({ parent: 'bugs', name: "Horizon won't start", tags: ['install / launch'] });
  const text = "**What I did:** clicked Play\n**What happened:** nothing, the game won't start\n**What I expected:** the game\n**OS, CPU, GPU:** Windows 11, RTX 3060";
  const starter = starterOf(t, text);
  t.fetchStarterMessage = async () => starter;
  assert.equal(await github._test.openIssue(t, starter), null);
  assert.equal(writes.length, 0);
  assert.match(t.said[0].content, /request for help[\s\S]*<#sup>[\s\S]*reply \*\*bug\*\*/);
  assert.equal(await github._test.openIssue(t, starter), null);
  assert.equal(t.said.length, 1, 'pointed once');
  await github._test.onMessage({ channelId: t.id, channel: t, id: 'r1', content: 'bug', author: { id: 'u1' }, attachments: new Map() });
  assert.equal(writes.filter((w) => w.path.endsWith('/issues')).length, 1, 'filed once the poster says it is a bug');

  const crash = thread({ parent: 'bugs', name: 'Game crashes on launch', tags: ['crash'] });
  const s2 = starterOf(crash, text.replace("won't start", 'crashes'));
  assert.ok(await github._test.openIssue(crash, s2), 'a crash is a bug: filed');
});

test('the help heuristic: help requests, not bugs in the game', () => {
  const help = (title, text, tags = ['install / launch']) => issuekit.looksLikeHelp(title, text, tags);
  assert.equal(help("Horizon won't start", 'click play, nothing'), true);
  assert.equal(help("I can't log in", 'Microsoft sign-in error'), true);
  assert.equal(help('how do I install mods?', ''), true);
  assert.equal(help('low fps on my laptop', 'Windows, Intel', ['performance']), true);
  assert.equal(help("Chest won't open", 'right click a chest', ['gameplay']), false, 'a game tag: a bug');
  assert.equal(help("chunks doesn't load", 'world', ['performance']), false);
  assert.equal(help('Launcher crashes when I click Play', "it can't start"), false, 'a crash: a bug');
  assert.equal(help('FPS drops near villages', '20 fps instead of 200', ['performance']), false);
  assert.equal(kit.mayReply({ isOwner: false, isHelper: false, isStaff: false, isBot: false }), false);
});
