// The hub's verbs on Discord (src/hub.js, src/features/hub.js): "@Kira <verb>", the roadmap answer, the
// suggestion queue, the bug form. No Discord connection, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-hub-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.ROADMAP_SUGGESTIONS_CHANNEL_ID = '777';
const hub = await import('../src/hub.js');
const { LAYOUT, HUB } = await import('../src/config.js');
const core = await import('../src/core.js');
const feature = await import('../src/features/hub.js');

const ROADMAP = {
  areas: [{ id: 'performance', name: 'Performance' }, { id: 'servers', name: 'Servers and multiplayer' }],
  items: [
    { id: 'smooth-frames', title: 'Steady frames', status: 'now', area: 'performance', focus: true, plain: 'Smooth camera at 32 chunks.', dev: 'Frame pacing.', links: ['#678'] },
    { id: 'faster-lookups', title: 'Faster block lookups', status: 'now', area: 'performance', plain: 'Less time finding blocks.', dev: '', links: [] },
    { id: 'server-dialogs', title: 'Server dialogs', status: 'now', area: 'servers', focus: true, plain: 'Servers that show dialogs work.', dev: '', links: [] },
    { id: 'modpacks', title: 'Modpacks', status: 'next', area: 'performance', plain: 'Port big packs.', dev: '', links: [] },
    { id: 'tidy', title: 'A good first task', status: 'help-wanted', area: 'servers', plain: 'Pick me.', dev: '', links: [] },
    { id: 'old', title: 'Shipped thing', status: 'shipped', area: 'servers', plain: 'Done.', dev: '', links: [], shipped_in: 'v0.2.58' },
  ],
};
const URL_ = 'https://playhorizon.dev/hub';

test('"@Kira <verb>": only a message that starts with the mention; unknown verbs get the help', () => {
  assert.deepEqual(hub.parseVerb('<@42> roadmap servers', '42'), { verb: 'roadmap', rest: 'servers' });
  assert.deepEqual(hub.parseVerb('<@!42>  Suggest  a minimap\nwith waypoints', '42'), { verb: 'suggest', rest: 'a minimap\nwith waypoints' });
  assert.deepEqual(hub.parseVerb('<@42> /claim 12', '42'), { verb: 'claim', rest: '12' });
  assert.deepEqual(hub.parseVerb('<@42>', '42'), { verb: 'help', rest: '' });
  assert.deepEqual(hub.parseVerb('<@42> hello there', '42'), { verb: 'help', rest: '' });
  assert.equal(hub.parseVerb('hey <@42> roadmap', '42'), null);
  assert.equal(hub.parseVerb('<@43> roadmap', '42'), null);
  for (const v of ['report', 'suggest', 'roadmap', 'claim', 'status']) assert.ok(hub.VERBS.includes(v));
});

test('roadmap: the focus Now items and Next, in plain words, with the link; no roadmap yet → the link alone', () => {
  const text = hub.roadmapText(ROADMAP, URL_);
  assert.match(text, /\*\*🔨 Now\*\*/);
  assert.match(text, /Steady frames/);
  assert.match(text, /Server dialogs/);
  assert.doesNotMatch(text, /Faster block lookups/, 'only the focus items when some are marked');
  assert.match(text, /⏭️ Next[\s\S]*Modpacks/);
  assert.doesNotMatch(text, /Shipped thing|Frame pacing/, 'shipped items and dev text stay out');
  assert.match(text, /<https:\/\/playhorizon\.dev\/hub>/);
  assert.match(text, /playhorizon\.dev\/hub#smooth-frames/);
  assert.match(hub.roadmapText(null, URL_), /The roadmap is at https:\/\/playhorizon\.dev\/hub/);
  assert.match(hub.roadmapText({ items: 'nope' }, URL_), /The roadmap is at/);
});

test('roadmap <area>: by id, name or prefix; that area\'s Now, Next and Help wanted; an unknown one lists the areas', () => {
  const perf = hub.roadmapText(ROADMAP, URL_, 'perf');
  assert.match(perf, /Now in Performance/);
  assert.match(perf, /Faster block lookups/);
  assert.doesNotMatch(perf, /Server dialogs/);
  const servers = hub.roadmapText(ROADMAP, URL_, 'Servers and multiplayer');
  assert.match(servers, /🙋 Help wanted[\s\S]*A good first task/);
  assert.match(hub.roadmapText(ROADMAP, URL_, 'cooking'), /No area called "cooking"\. Areas: `performance`, `servers`/);
});

test('roadmap answers fit one Discord message, whatever the roadmap', () => {
  const big = { areas: [], items: Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, title: 'T'.repeat(90), status: i % 2 ? 'next' : 'now', area: 'x', plain: 'p'.repeat(240) })) };
  const text = hub.roadmapText(big, URL_);
  assert.ok(text.length <= 1990, String(text.length));
  assert.match(text, /playhorizon\.dev\/hub>/);
});

test('status of a roadmap item', () => {
  assert.match(hub.itemText(ROADMAP, URL_, 'old'), /Shipped thing\*\* · Shipped in v0\.2\.58/);
  assert.equal(hub.itemText(ROADMAP, URL_, 'nope'), null);
});

test('suggestions in the queue: no pings, no masked links, where they came from', () => {
  const p = hub.suggestionPost({ text: '@everyone look [here](https://evil.example) <@123>', who: 'Sam', whoId: '9', source: '#horizon-ideas', link: 'https://discord.com/channels/1/2' });
  assert.deepEqual(p.allowedMentions, { parse: [] });
  const d = p.embeds[0].description;
  assert.doesNotMatch(d, /@everyone|<@123>|(?<!\\)\]\(/);
  assert.match(p.embeds[0].fields[1].value, /#horizon-ideas · https:\/\/discord\.com/);
});

test('the bug form: 5 fields Discord accepts, written as the #horizon-bugs template (so it reads, and checks, like a post)', () => {
  assert.equal(hub.REPORT_FIELDS.length, 5); // a modal holds 5 at most
  for (const f of hub.REPORT_FIELDS) assert.ok(f.label.length <= 45, f.label); // Discord's limit for a label
  const body = hub.reportBody({ title: 'Water is black', steps: 'Open a world', happened: 'Black water', version: '', system: 'Linux, AMD RX 7600' });
  const bugs = LAYOUT.flatMap((g) => g.channels).find((c) => c.key === 'horizonbugs');
  for (const [label, re] of bugs.check.needs) assert.match(body, re, label);
  assert.match(body, /\*\*Horizon version:\*\* not given/);
  assert.ok(bugs.tags.some(([, name, staff]) => name === 'via /report' && staff), 'Kira tags the posts it makes');
});

test('idea issues: votes from Kira\'s line, pull requests left out', () => {
  const rows = hub.ideaRows([
    { number: 5, title: 'B', html_url: 'u5', body: 'x\n<!-- kira:votes -->👍 **3** on Discord', labels: [{ name: 'from-discord' }], created_at: '2026-10-20T00:00:00Z' },
    { number: 2, title: 'A', html_url: 'u2', body: null, labels: [], created_at: '2026-10-24T00:00:00Z' },
    { number: 9, title: 'PR', pull_request: {}, created_at: '2026-10-24T00:00:00Z' },
  ], Date.parse('2026-10-25T00:00:00Z'));
  assert.deepEqual(rows.map((r) => [r.number, r.votes, r.fromDiscord, r.days]), [[2, null, false, 1], [5, 3, true, 5]]);
});

// ── The feature, against fakes ──

const queued = [];
core.client.channels.fetch = async (id) => (id === '777' ? { isTextBased: () => true, send: async (m) => { queued.push(m); return { id: `q${queued.length}` }; } } : null);
const user = (id) => ({ id, username: `u${id}`, globalName: null });

test('the roadmap is fetched once per 5 minutes; a failure keeps the last good one', async () => {
  let calls = 0;
  feature._test.setFetch(async () => { calls++; return calls === 1 ? ROADMAP : null; });
  assert.equal(await feature.roadmap(1_000_000), ROADMAP);
  assert.equal(await feature.roadmap(1_000_000 + HUB.cacheMs - 1), ROADMAP);
  assert.equal(calls, 1);
  assert.equal(await feature.roadmap(1_000_000 + HUB.cacheMs), ROADMAP, 'a bad answer keeps the old roadmap');
  assert.equal(calls, 2);
});

test('suggest: into the queue with its source, 3 an hour per member, too short refused', async () => {
  queued.length = 0;
  assert.match(await feature.suggest(user('1'), null, 'hm', 'x'), /a sentence or two/);
  for (let n = 0; n < 3; n++) assert.match(await feature.suggest(user('1'), null, `An idea number ${n}, please`, 'Discord, /suggest', 'https://discord.com/channels/1/2'), /in the queue/);
  assert.match(await feature.suggest(user('1'), null, 'One idea too many today', 'x'), /3 suggestions this hour/);
  assert.equal(queued.length, 3);
  assert.match(queued[0].embeds[0].fields[1].value, /Discord, \/suggest/);
});

test('#horizon-ideas: a post that follows the template goes to the queue once, and Kira says so in the post', async () => {
  queued.length = 0;
  core.state.channels.horizonideas = '555';
  const said = [];
  const thread = { id: 't1', guildId: (await import('../src/config.js')).GUILD_ID, parentId: '555', name: 'Minimap', ownerId: '1', send: async (m) => said.push(m) };
  const starter = { content: '**The idea:** a minimap\n**Why:** less getting lost', author: user('1'), member: { displayName: 'Sam' } };
  await feature._test.ideaPost(thread, starter);
  await feature._test.ideaPost(thread, starter);
  assert.equal(queued.length, 1);
  assert.match(queued[0].embeds[0].description, /\*\*Minimap\*\*/);
  assert.equal(said.length, 1);
  assert.match(said[0].content, /suggestion queue[\s\S]*playhorizon\.dev\/hub/);
  assert.ok(core.state.suggestions.t1);
});

test('every slash command name is used once (Discord refuses the whole list otherwise); /report is the bug form', async () => {
  const mods = await Promise.all(['moderation', 'levels', 'rooms', 'community', 'forums', 'github', 'workboard', 'agents', 'hub', 'updates'].map((f) => import(`../src/features/${f}.js`)));
  for (const m of mods) assert.ok(Array.isArray(m.commands) && m.handlers, 'every feature exports commands and handlers (bot.js reads them)');
  const names = mods.flatMap((m) => m.commands).map((c) => c.toJSON().name);
  assert.equal(new Set(names).size, names.length, names.filter((n, i) => names.indexOf(n) !== i).join());
  for (const n of ['report', 'suggest', 'roadmap', 'claim', 'status', 'report-member', 'link-github']) assert.ok(names.includes(n), n);
  for (const m of mods) for (const c of m.commands) if (c.toJSON().type === undefined || c.toJSON().type === 1) assert.ok(m.handlers[c.toJSON().name], `handler for /${c.toJSON().name}`);
});

test('/report: the form becomes a post in #horizon-bugs (tagged, no ping) and a GitHub issue the member owns', async () => {
  const github = await import('../src/features/github.js');
  const writes = [];
  github._test.setGitHub({ get: async () => ({}), write: async (method, path, body) => { writes.push({ method, path, body }); return path.endsWith('/issues') ? { number: 77, html_url: 'https://github.com/ludovic111/horizon/issues/77' } : {}; } });
  core.state.channels.horizonbugs = '600';
  const made = [];
  core.client.channels.cache.set('600', {
    availableTags: [{ id: 'tg', name: 'via /report' }],
    threads: { create: async (opts) => { made.push(opts); return { id: 't9', url: 'https://discord.com/channels/1/t9', name: opts.name, parent: { name: 'horizon-bugs', availableTags: [{ id: 'tg', name: 'via /report' }] }, appliedTags: opts.appliedTags, send: async () => {} }; } },
  });
  const answers = [];
  const values = { title: 'Water\nis black', steps: 'Open a world', happened: 'Black water, expected blue', version: 'v0.2.60', system: 'Linux, RX 7600' };
  const i = {
    user: user('31'), member: { displayName: 'Sam' },
    fields: { getTextInputValue: (k) => values[k] },
    deferReply: async () => {}, editReply: async (m) => answers.push(m), reply: async (m) => answers.push(m),
  };
  await feature._test.submitReport(i);
  assert.equal(made[0].name, 'Water is black');
  assert.deepEqual(made[0].appliedTags, ['tg']);
  assert.deepEqual(made[0].message.allowedMentions, { parse: [] });
  assert.match(made[0].message.content, /^Reported by <@31> with \/report\./);
  const issue = writes.find((w) => w.path.endsWith('/issues'));
  assert.match(issue.body.body, /Black water, expected blue/);
  assert.doesNotMatch(issue.body.body, /<@31>/, 'no Discord mention in the issue');
  assert.deepEqual(issue.body.labels, ['bug', 'from-discord']);
  assert.equal(github.reportsOf('31')[0].number, 77);
  assert.match(answers.at(-1).content, /GitHub issue #77/);
});

test('#horizon-ideas posts no longer open issues (a mod\'s /issue still can)', async () => {
  const github = await import('../src/features/github.js');
  const writes = [];
  github._test.setGitHub({ get: async () => ({}), write: async (m, p, b) => { writes.push(p); return { number: 1, html_url: 'u' }; } });
  const thread = { id: 'idea1', parentId: core.state.channels.horizonideas, name: 'Minimap', appliedTags: [], parent: { name: 'horizon-ideas', availableTags: [] }, send: async () => {} };
  const starter = { content: 'The idea: a minimap. Why: less lost', author: user('5'), member: null, attachments: new Map(), reactions: { cache: new Map() } };
  assert.equal(await github._test.openIssue(thread, starter), null);
  assert.equal(writes.length, 0);
  assert.equal((await github._test.openIssue(thread, starter, { manual: true })).number, 1);
});
