// The hub's verbs on Discord (src/hub.js, src/features/hub.js): "@Kira <verb>", the roadmap answer, the
// suggestion queue, the bug form. No Discord connection, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KIRA_STATE = join(mkdtempSync(join(tmpdir(), 'kira-hub-')), 'state.json');
process.env.GITHUB_TOKEN = 'test-token-not-used';
process.env.ROADMAP_SUGGESTIONS_CHANNEL_ID = '777';
process.env.HUB_TOKEN = 'hub-test-token';
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

const embedsOf = (messages) => messages.flatMap((m) => m.embeds ?? []);
// What Discord enforces on one message: 10 embeds, 6000 characters over all of them, 4096 in a description, 2000 in the content.
function assertDiscordLimits(messages) {
  for (const m of messages) {
    assert.deepEqual(m.allowedMentions, { parse: [] });
    assert.ok((m.content ?? '').length <= 2000, `content ${m.content.length}`);
    assert.ok((m.embeds ?? []).length <= 10, `${m.embeds.length} embeds`);
    let total = 0;
    for (const e of m.embeds ?? []) {
      assert.ok(e.description.length <= 4096 && e.title.length <= 256);
      total += e.title.length + e.description.length;
    }
    assert.ok(total <= 6000, `embeds total ${total}`);
  }
}

test('roadmap: every area in the roadmap\'s order, one embed each, items by status as links, Shipped as a count', () => {
  const messages = hub.roadmapMessages(ROADMAP, URL_);
  assertDiscordLimits(messages);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /<https:\/\/playhorizon\.dev\/hub>/);
  const [perf, servers] = embedsOf(messages);
  assert.deepEqual([perf.title, servers.title], ['Performance', 'Servers and multiplayer']);
  assert.equal(perf.description, [
    '**🔨 Now**',
    '• [Steady frames](https://playhorizon.dev/hub#smooth-frames)',
    '• [Faster block lookups](https://playhorizon.dev/hub#faster-lookups)',
    '',
    '**⏭️ Next**',
    '• [Modpacks](https://playhorizon.dev/hub#modpacks)',
  ].join('\n'));
  assert.match(servers.description, /🙋 Help wanted\*\*\n• \[A good first task\]/);
  assert.match(servers.description, /\n\n✅ 1 shipped$/);
  assert.doesNotMatch(servers.description, /Shipped thing|Pick me|Servers that show dialogs work/, 'titles only, shipped as a count');
  assert.match(hub.roadmapMessages(null, URL_)[0].content, /The roadmap is at https:\/\/playhorizon\.dev\/hub/);
  assert.match(hub.roadmapMessages({ items: 'nope' }, URL_)[0].content, /The roadmap is at/);
});

test('roadmap <area>: by id, name or prefix; every item of that area with its plain words; an unknown one lists the areas', () => {
  const perf = hub.roadmapMessages(ROADMAP, URL_, 'perf');
  assertDiscordLimits(perf);
  assert.equal(embedsOf(perf).length, 1);
  assert.match(embedsOf(perf)[0].description, /Steady frames\]\(https:\/\/playhorizon\.dev\/hub#smooth-frames\): Smooth camera at 32 chunks\./);
  assert.match(embedsOf(perf)[0].description, /Faster block lookups[\s\S]*Modpacks/);
  assert.doesNotMatch(embedsOf(perf)[0].description, /Server dialogs|Frame pacing/, 'dev text stays out');
  const servers = embedsOf(hub.roadmapMessages(ROADMAP, URL_, 'Servers and multiplayer'))[0].description;
  assert.match(servers, /🙋 Help wanted\*\*\n• \[A good first task\]\(https:\/\/playhorizon\.dev\/hub#tidy\): Pick me\./);
  assert.match(servers, /✅ Shipped\*\*\n• \[Shipped thing\]\(https:\/\/playhorizon\.dev\/hub#old\) \(v0\.2\.58\): Done\./, 'the shipped ones, with their release');
  assert.match(hub.roadmapMessages(ROADMAP, URL_, 'cooking')[0].content, /No area called "cooking"\. Areas: `performance`, `servers`/);
  assert.match(hub.roadmapMessages({ areas: [{ id: 'x', name: 'X' }], items: [] }, URL_, 'x')[0].content, /Nothing planned in this area yet/);
});

test('roadmap: text from the site is data: markdown, links, mentions and newlines in a title or a plain text cannot act', () => {
  const evil = { areas: [{ id: 'a', name: '**Area** @everyone' }], items: [
    { id: 'x', title: '*Bold* [click](https://evil.example) @everyone <@123> <#456> `code` ||spoiler|| ~~s~~ _i_\n# head', status: 'now', area: 'a', plain: '> quote\n@here <:e:1> [a](b) \\ end' },
  ] };
  for (const area of ['', 'a']) {
    const messages = hub.roadmapMessages(evil, URL_, area);
    assertDiscordLimits(messages);
    const e = embedsOf(messages)[0];
    assert.equal(e.title, '\\*\\*Area\\*\\* @​everyone');
    const line = e.description.split('\n')[1];
    assert.match(line, /^• \[\\\*Bold\\\* \\\[click\\\]\\\(https:\/\/evil\.example\\\) @​everyone \\<@123\\> \\<#456\\> \\`code\\` \\\|\\\|spoiler\\\|\\\| \\~\\~s\\~\\~ \\_i\\_ # head\]\(https:\/\/playhorizon\.dev\/hub#x\)/);
    assert.doesNotMatch(line, /\n/);
    if (area) assert.match(line, /: \\> quote @​here \\<:e:1\\> \\\[a\\\]\\\(b\\\) \\\\ end$/);
  }
  assert.equal(hub.mdEscape('a'.repeat(30), 10), `${'a'.repeat(9)}…`);
});

test('roadmap: the real one (90 items, 12 areas) comes out whole, in order, within Discord\'s limits', () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/roadmap.json', import.meta.url), 'utf8'));
  assert.equal(real.items.length, 90);
  assert.equal(real.areas.length, 12);
  const messages = hub.roadmapMessages(real, URL_);
  assertDiscordLimits(messages);
  const embeds = embedsOf(messages);
  assert.deepEqual(embeds.map((e) => e.title), real.areas.map((a) => a.name), 'one embed per area, in the roadmap\'s order');
  assert.ok(messages.length >= 2 && messages.length <= 4, `${messages.length} messages`);
  const text = embeds.map((e) => e.description).join('\n');
  for (const i of real.items.filter((i) => i.status !== 'shipped')) assert.ok(text.includes(`#${i.id})`), `${i.id} is linked`);
  for (const i of real.items.filter((i) => i.status === 'shipped')) assert.ok(!text.includes(`#${i.id})`), `${i.id} is only counted`);
  assert.equal([...text.matchAll(/✅ (\d+) shipped/g)].reduce((n, m) => n + Number(m[1]), 0), 9);
  assert.ok(text.indexOf('🔨 Now') < text.indexOf('⏭️ Next') && text.indexOf('⏭️ Next') < text.indexOf('🕰️ Later'));
  for (const a of real.areas) { // every area in full
    const full = hub.roadmapMessages(real, URL_, a.id);
    assertDiscordLimits(full);
    const t = embedsOf(full).map((e) => e.description).join('\n');
    for (const i of real.items.filter((i) => i.area === a.id)) assert.ok(t.includes(`#${i.id})`) && t.includes(mdEscapeFirst(i.plain)), `${a.id}/${i.id}`);
  }
});
const mdEscapeFirst = (s) => hub.mdEscape(s).slice(0, 40);

test('roadmap: a huge roadmap splits across messages and embeds without crossing a limit', () => {
  const areas = Array.from({ length: 12 }, (_, k) => ({ id: `a${k}`, name: `Area ${k} ${'N'.repeat(60)}` }));
  const items = Array.from({ length: 480 }, (_, k) => ({ id: `item-${k}-${'z'.repeat(30)}`, title: 'T*'.repeat(50), status: ['now', 'next', 'later', 'help-wanted', 'shipped'][k % 5], area: `a${k % 12}`, plain: 'p_'.repeat(150), shipped_in: 'v1' }));
  items.push({ id: 'lost', title: 'No area', status: 'next', area: 'nowhere', plain: '' });
  for (const area of ['', 'a3']) {
    const messages = hub.roadmapMessages({ areas, items }, URL_, area);
    assertDiscordLimits(messages);
    assert.ok(messages.length > 1);
    const text = embedsOf(messages).map((e) => e.description).join('\n');
    assert.equal(text.includes('#lost)'), !area, 'an item in no area goes under "Other"');
    assert.equal(messages.slice(1).every((m) => !m.content), true, 'only the first message has the intro');
  }
  const split = embedsOf(hub.roadmapMessages({ areas, items }, URL_, 'a3'));
  assert.ok(split.length > 1 && split.every((e, k) => e.title.endsWith(`(${k + 1}/${split.length})`)));
  assert.ok(split.every((e) => !/\*\*[^*\n]+\*\*$/.test(e.description)), 'a heading never ends an embed');
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
  const mods = await Promise.all(['moderation', 'levels', 'rooms', 'community', 'forums', 'github', 'workboard', 'agents', 'hub', 'updates', 'x'].map((f) => import(`../src/features/${f}.js`)));
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

test('the hub\'s suggestions: relayed into the queue oldest first, each once; a missing endpoint or a failed post waits for the next round', async () => {
  queued.length = 0;
  const asked = [];
  let answer = { status: 404, body: null };
  feature._test.setQueueFetch(async (url, token) => { asked.push({ url, token }); return answer; });
  assert.equal(await feature.relay(), 0, 'not live yet: nothing, no throw');
  assert.equal(queued.length, 0);
  assert.match(asked[0].url, /^https:\/\/telemetry\.playhorizon\.dev\/hub\/suggestions\?after=0&limit=100$/);
  assert.equal(asked[0].token, 'hub-test-token');
  feature._test.setQueueFetch(async () => { throw new Error('network down'); });
  assert.equal(await feature.relay(), 0);

  feature._test.setQueueFetch(async () => answer);
  answer = { status: 200, body: { suggestions: [
    { id: 3, text: 'A minimap @everyone [click](https://evil.example)', name: 'Sam', created_at: 'x' },
    { id: 4, text: 'Faster chunk loading please', item: 'smooth-frames' },
    { id: 'x', text: 'not an id' },
  ] } };
  assert.equal(await feature.relay(), 2);
  assert.equal(feature._test.relayState.after, 4);
  assert.equal(queued.length, 2);
  assert.doesNotMatch(queued[0].embeds[0].description, /@everyone|\[click\]\(/);
  assert.deepEqual(queued[0].allowedMentions, { parse: [] });
  assert.match(queued[0].embeds[0].fields[0].value, /^Sam$/);
  assert.match(queued[1].embeds[0].fields[0].value, /someone on the hub/);
  assert.match(queued[1].embeds[0].fields[1].value, /smooth-frames.*playhorizon\.dev\/hub#smooth-frames/);
  assert.equal(await feature.relay(), 0, 'the same answer again: nothing twice');

  const send = core.client.channels.fetch;
  core.client.channels.fetch = async () => null; // the queue channel is gone
  answer = { status: 200, body: { suggestions: [{ id: 5, text: 'Later one' }] } };
  assert.equal(await feature.relay(), 0);
  assert.equal(feature._test.relayState.after, 4, 'kept for the next round');
  core.client.channels.fetch = send;
  assert.equal(await feature.relay(), 1);
  assert.equal(feature._test.relayState.after, 5);
});

test('/roadmap and @Kira roadmap: the first message answers, the others follow in the same place; never a ping', async () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/roadmap.json', import.meta.url), 'utf8'));
  feature._test.setFetch(async () => real);
  const sent = [];
  const i = {
    options: { getString: () => '' },
    deferReply: async () => sent.push('defer'),
    editReply: async (m) => sent.push(['edit', m]),
    followUp: async (m) => sent.push(['follow', m]),
  };
  await feature.handlers.roadmap(i);
  assert.equal(sent[0], 'defer');
  assert.deepEqual(sent.slice(1).map(([k]) => k), ['edit', 'follow']);
  for (const [, m] of sent.slice(1)) assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.equal(sent.slice(1).reduce((n, [, m]) => n + m.embeds.length, 0), 12);

  core.client.user = { id: '42' };
  const said = [];
  const msg = {
    content: '<@42> roadmap servers',
    reply: async (m) => said.push(['reply', m]),
    channel: { send: async (m) => said.push(['send', m]) },
  };
  assert.equal(await feature.onMessage(msg), true);
  assert.deepEqual(said.map(([k]) => k), ['reply'], 'one area fits one message');
  assert.deepEqual(said[0][1].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(said[0][1].embeds[0].title, 'Servers and multiplayer');
  said.length = 0;
  await feature.onMessage({ ...msg, content: '<@42> roadmap' });
  assert.deepEqual(said.map(([k]) => k), ['reply', 'send']);
  assert.deepEqual(said[1][1].allowedMentions, { parse: [] });
});
