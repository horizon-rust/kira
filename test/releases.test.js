// Unit tests for the release announcements. No network: the releases are recorded GitHub answers
// (horizon-rust/horizon and kimchi, trimmed to the fields Kira reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as rel from '../src/releases.js';
import { newReleases } from '../src/feeds.js';
import { makeGitHub } from '../src/github.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const horizon = fixture('horizon-releases');
const byTag = (tag) => structuredClone(horizon.find((r) => r.tag_name === tag));
const ROLE = '1559242159775940619';
const SINCE = '2026-10-13T00:00:00Z';

test('drafts and releases from before the switch are never announced; pre-releases only for the game', () => {
  const draft = { ...byTag('launcher-v0.1.1'), id: 1, tag_name: 'launcher-v0.1.2', draft: true, published_at: null };
  const pre = { ...byTag('v2026.10.13.1'), id: 2, tag_name: 'v2026.10.13.2', prerelease: true, published_at: '2026-10-14T00:00:00Z' };
  const preLauncher = { ...byTag('launcher-v0.1.1'), id: 3, tag_name: 'launcher@0.2.9', prerelease: true };
  const tags = rel.fresh([draft, pre, preLauncher, ...horizon], [], SINCE).map((r) => r.tag_name);
  assert.deepEqual(tags, ['v2026.10.13', 'launcher-v0.1.1', 'v2026.10.13.1', 'v2026.10.13.2']); // oldest first; 2026.10.12 is older than SINCE
  assert.deepEqual(rel.fresh([pre], [], SINCE, [], 'kimchi'), []); // other repos' pre-releases: never
  // The real cut-over (since 2026-10-23): every release in the fixture is older, so none is posted again.
  assert.deepEqual(rel.fresh(horizon, []).map((r) => r.tag_name), []);
  assert.deepEqual(rel.fresh(horizon, [], '2026-10-13T18:00:00Z').map((r) => r.tag_name), ['v2026.10.13.1']);
});

test('once per release id: a draft that gets published is announced once', () => {
  const draft = { ...byTag('launcher-v0.1.1'), id: 777, tag_name: 'launcher-v0.1.2', draft: true, published_at: null };
  let announced = [];
  assert.equal(rel.fresh([draft], announced, SINCE).length, 0);
  const published = { ...draft, draft: false, published_at: '2026-10-13T19:05:00Z' };
  const now = rel.fresh([published], announced, SINCE);
  assert.deepEqual(now.map((r) => r.id), [777]);
  announced = rel.remember(announced, 777);
  assert.equal(rel.fresh([published], announced, SINCE).length, 0);
  assert.equal(rel.fresh([{ ...published, name: 'renamed', body: 'edited notes' }], announced, SINCE).length, 0);
  assert.deepEqual(rel.remember(rel.remember([], 1), 1), [1]);
  assert.equal(Array.from({ length: 500 }, (_, i) => i).reduce(rel.remember, []).length, rel.KEEP);
  // More ids kept than releases listed (feeds.js: two pages of 100), or a listed release falls out and is posted again.
  assert.ok(rel.KEEP > 200);
});

test('newReleases reads the REST API, with or without a token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return new Response(JSON.stringify(horizon), { status: 200 });
  };
  const got = await newReleases(makeGitHub({ fetchImpl }), 'horizon', []);
  assert.deepEqual(got.map((r) => r.tag_name), []); // all older than SINCE
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/horizon-rust\/horizon\/releases/);
  assert.equal(calls[0].auth, undefined);
  await newReleases(makeGitHub({ token: 't', fetchImpl }), 'horizon', []);
  assert.equal(calls[1].auth, 'Bearer t');
  const missing = makeGitHub({ fetchImpl: async () => new Response('', { status: 404 }) });
  assert.deepEqual(await newReleases(missing, 'gone', []), []);
});

test('tag routing: game, launcher, everything else', () => {
  assert.equal(rel.kind('horizon', 'v2026.10.13.1'), 'game');
  assert.equal(rel.kind('horizon', 'launcher-v0.1.2'), 'launcher');
  assert.equal(rel.kind('horizon', 'archive/wip-horizon-mobs-split'), 'generic');
  assert.equal(rel.kind('horizon', 'launcher@0.2.3'), 'launcher'); // the tags from 0.2
  assert.equal(rel.kind('horizon', 'v0.2.3'), 'game');
  assert.equal(rel.kind('horizon', 'launcher-0.2.3'), 'generic');
  assert.equal(rel.kind('lsuite', 'launcher@0.3.0'), 'generic');
  assert.equal(rel.kind('lsuite', 'launcher-v0.3.0'), 'generic'); // lsuite's launcher is not Horizon's
  assert.equal(rel.kind('kimchi', 'v0.10.0'), 'generic');
});

test('a game release: its title, New and Fixed in short, the launcher line and the three links', () => {
  const m = rel.releaseMessage('horizon', byTag('v2026.10.13.1'), ROLE);
  const [e] = m.embeds;
  assert.equal(e.title, 'Horizon 2026.10.13.1: own menus, graphics settings, faster, many fixes');
  assert.equal(e.url, 'https://github.com/horizon-rust/horizon/releases/tag/v2026.10.13.1');
  assert.equal(e.color, 0xf2a33a);
  assert.match(e.description, /Update from the Horizon launcher: it installs new versions by itself/);
  const field = (n) => e.fields.find((f) => f.name === n).value;
  assert.match(field('New'), /^• \*\*Horizon's own menus:\*\* a new title screen/);
  assert.match(field('New'), /Graphics settings, Simple and Advanced/);
  assert.match(field('Fixed'), /• \*\*No sound on Linux\*\*/);
  assert.match(field('Fixed'), /Missing swing animations/);
  assert.equal(field('Fixed').split('\n').length, 8);
  for (const l of field('New').split('\n')) assert.ok(l.length <= 112, l);
  assert.match(field('Links'), /\(https:\/\/github\.com\/horizon-rust\/horizon\/releases\/tag\/v2026\.10\.13\.1\)/);
  assert.match(field('Links'), /\(https:\/\/playhorizon\.dev\)/);
  assert.match(field('Links'), /\(https:\/\/github\.com\/horizon-rust\/horizon\/releases\?q=launcher&expanded=true\)/);
  assert.match(m.content, new RegExp(`^<@&${ROLE}> \\*\\*Horizon 2026\\.10\\.13\\.1`));
});

test('a launcher release: its own small embed, even with empty notes', () => {
  const m = rel.releaseMessage('horizon', { ...byTag('launcher-v0.1.1'), tag_name: 'launcher-v0.1.2', body: '### Fixed\n- **Downloads resume** after a dropped connection.\n- The window remembers its size.' }, ROLE);
  const [e] = m.embeds;
  assert.equal(e.title, 'Horizon launcher 0.1.2');
  assert.equal(e.fields, undefined);
  assert.match(e.description, /^• \*\*Downloads resume\*\*\n• The window remembers its size\./);
  assert.match(e.description, /Your launcher updates itself; new here\? \[Download it\]\(https:\/\/github\.com\/horizon-rust\/horizon\/releases\?q=launcher&expanded=true\)/);
  const empty = rel.releaseMessage('horizon', byTag('launcher-v0.1.1'), ROLE).embeds[0];
  assert.equal(empty.title, 'Horizon launcher 0.1.1');
  assert.match(empty.description, /^Your launcher updates itself/);
});

test('other repos: a simple embed driven by the API', () => {
  const [k] = fixture('kimchi-releases');
  const m = rel.releaseMessage('kimchi', k, ROLE);
  assert.equal(m.embeds[0].title, 'kimchi v0.10.0');
  assert.equal(m.embeds[0].url, k.html_url);
  assert.ok(m.embeds[0].description.length <= 700);
  assert.match(m.embeds[0].description, /^• \*\*lsuite AI/);
  assert.equal(rel.releaseMessage('lsuite', { tag_name: 'v1', name: 'lsuite 1.0', html_url: 'u', body: '' }).embeds[0].title, 'lsuite 1.0');
});

test('notes trimming: Discord limits, "…and N more", first lines without headings', () => {
  const many = Array.from({ length: 60 }, (_, i) => `**Fix number ${i}** with some words`);
  const v = rel.bulletField(many);
  assert.ok(v.length <= 1024);
  assert.match(v, /\n…and \d+ more$/);
  assert.equal(rel.bulletField(['a', 'b']), '• a\n• b');
  assert.equal(rel.bulletField([]), '');
  const body = `## Title\n\n<!-- hidden -->\nLine one.\n\nLine two.\n---\n${'x'.repeat(2000)}`;
  const first = rel.firstLines(body, 100);
  assert.ok(first.startsWith('Line one.\nLine two.\nxxx'));
  assert.ok(first.length <= 100);
  assert.ok(first.endsWith('…'));
  assert.deepEqual(rel.bullets('### New\n- **A:** ' + 'y'.repeat(300) + '\n### Fixed\n- b', 'New').map((b) => b.length <= 110), [true]);
  assert.deepEqual(rel.bullets('nothing here', 'New'), []);
  const game = rel.releaseMessage('horizon', { tag_name: 'v9', name: 'v9', html_url: 'u', body: 'Just a line.' }, ROLE).embeds[0];
  assert.match(game.description, /^Just a line\.\n\nUpdate from the Horizon launcher/);
  assert.ok(game.description.length <= 4096 && game.title.length <= 256);
});

test('mentions: only the 📦 Releases role, never users or @everyone', () => {
  for (const r of horizon) {
    const m = rel.releaseMessage('horizon', r, ROLE);
    assert.ok([JSON.stringify({ parse: [], roles: [ROLE] }), JSON.stringify({ parse: [], roles: [] })].includes(JSON.stringify(m.allowedMentions)));
  }
  assert.deepEqual(rel.releaseMessage('kimchi', fixture('kimchi-releases')[0], ROLE).allowedMentions, { parse: [], roles: [ROLE] });
  const silent = rel.releaseMessage('kimchi', fixture('kimchi-releases')[0], undefined);
  assert.deepEqual(silent.allowedMentions, { parse: [], roles: [] });
  assert.doesNotMatch(silent.content, /<@&/);
});

test('one-off announcements: unique keys, within Discord limits, no ping or the Big news role only', async () => {
  const { ONE_OFFS } = await import('../src/config.js');
  assert.equal(new Set(ONE_OFFS.map((p) => p.key)).size, ONE_OFFS.length);
  for (const p of ONE_OFFS) {
    assert.ok(p.role === undefined || p.role === 'horizon');
    assert.ok(p.embed.title.length <= 256 && p.embed.description.length <= 4096);
    for (const f of p.embed.fields ?? []) assert.ok(f.value.length <= 1024 && f.name.length <= 256);
    const total = p.embed.title.length + p.embed.description.length + (p.embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000);
  }
});

test('the agents announcement: one endpoint value, the three setups, only once /agent connect is open', async () => {
  const { ONE_OFFS, MCP_URL, agentSnippets } = await import('../src/config.js');
  const posts = ONE_OFFS.filter((p) => p.when === 'agents');
  assert.deepEqual(posts.map((p) => [p.channel, p.editable, !!p.pin]), [['announcements', true, false], ['horizoninfo', true, true]]);
  for (const p of posts) {
    const d = p.embed.description;
    assert.ok(d.length <= 4096 && p.embed.title.length <= 256);
    assert.ok(d.includes(`claude mcp add --transport http kira ${MCP_URL} --header "Authorization: Bearer <your token>"`));
    assert.ok(d.includes(`[mcp_servers.kira]\nurl = "${MCP_URL}"\nbearer_token_env_var = "KIRA_TOKEN"`));
    assert.ok(d.includes(`"kira": { "url": "${MCP_URL}", "headers": { "Authorization": "Bearer \${env:KIRA_TOKEN}" } }`));
    assert.match(d, /\/agent connect/);
    assert.match(d, /\/agent revoke/);
    assert.match(d, /90 days/);
    assert.match(d, /8 claimed issues at a time/);
    assert.doesNotMatch(`${p.content} ${d}`, /@everyone|@here/);
    assert.equal(p.role, undefined);
  }
  assert.ok(agentSnippets('https://x/mcp', 'kira_t').includes('Bearer kira_t'));
});

const NOTES = '### New\n- **Zoom:** hold C to zoom in, like OptiFine does.\n### Fixed\n- Composters take items.';
const game = (id, tag, at, extra = {}) => ({ id, tag_name: tag, name: `Horizon ${tag.slice(1)}: Zoom`, prerelease: false, draft: false,
  published_at: at, html_url: `https://github.com/horizon-rust/horizon/releases/tag/${tag}`, body: NOTES, ...extra });

test('a post pings only when given the role; every other post is @silent, with no mention at all', () => {
  const pinged = rel.releaseMessage('horizon', game(1, 'v0.2.20', '2026-10-24T20:05:00Z'), ROLE);
  assert.match(pinged.content, new RegExp(`^<@&${ROLE}> \\*\\*Horizon 0\\.2\\.20: Zoom\\*\\* is out`));
  assert.deepEqual(pinged.allowedMentions, { parse: [], roles: [ROLE] });
  assert.equal(pinged.flags, undefined);
  for (const silent of [rel.releaseMessage('horizon', game(2, 'v0.2.21', '2026-10-24T20:10:00Z'), null),
    rel.releaseMessage('horizon', { ...game(3, 'launcher@0.2.4', '2026-10-24T20:10:00Z'), body: '### New\n- A logs button.' }, null),
    rel.releaseMessage('kimchi', fixture('kimchi-releases')[0], null)]) {
    assert.doesNotMatch(silent.content, /<@/);
    assert.deepEqual(silent.allowedMentions, { parse: [], roles: [] });
    assert.equal(silent.flags, rel.SUPPRESS_NOTIFICATIONS);
  }
  assert.equal(rel.SUPPRESS_NOTIFICATIONS, 4096);
});

test('no channel words and no dates in any post', () => {
  const at = '2026-10-24T20:05:00Z';
  const posts = [rel.releaseMessage('horizon', game(1, 'v0.2.20', at), ROLE, ['**0.2.19** Beds']),
    rel.releaseMessage('horizon', game(2, 'v0.2.21', at, { prerelease: true }), null),
    rel.releaseMessage('horizon', { ...game(3, 'launcher@0.2.4', at), body: '### Fixed\n- A fix.' }, null),
    ...horizon.map((r) => rel.releaseMessage('horizon', r, null))];
  for (const m of posts) {
    const text = JSON.stringify(m);
    assert.doesNotMatch(text, /\balpha\b|\bstable\b|nightly|\bbeta\b|about once a day/i, text);
    assert.equal(m.embeds[0].timestamp, undefined);
    assert.doesNotMatch(m.content + m.embeds[0].description, /2026-10-/);
  }
});

test('@Releases is pinged once a day: the first game release after 20:00 UTC, with what came out since', () => {
  const at = (day, h, m = 0) => Date.parse(`2026-10-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const iso = (t) => new Date(t).toISOString();
  assert.equal(rel.pingWindow(at(24, 20)), at(24, 20));
  assert.equal(rel.pingWindow(at(24, 19, 59)), at(23, 20));
  assert.equal(rel.pingWindow(at(25, 3)), at(24, 20));
  let pings = { lastAt: at(23, 20, 30), since: [] };
  const post = (id, tag, t, extra) => {
    const plan = rel.pingDecision('horizon', game(id, tag, iso(t), extra), pings);
    pings = plan.pings;
    return plan;
  };
  // the day: every release is silent and joins the list
  assert.equal(post(1, 'v0.2.20', at(24, 9)).ping, false);
  assert.equal(post(2, 'v0.2.21', at(24, 14), { name: 'Horizon 0.2.21: Beds, mobs and 3 more fixes' }).ping, false);
  assert.deepEqual(pings.since, ['**0.2.20** Zoom', '**0.2.21** Beds, mobs and 3 more fixes']);
  // the first release after 20:00 UTC pings, with that list, and starts a new one
  const evening = post(3, 'v0.2.22', at(24, 20, 7));
  assert.equal(evening.ping, true);
  assert.deepEqual(evening.since, ['**0.2.20** Zoom', '**0.2.21** Beds, mobs and 3 more fixes']);
  assert.deepEqual(pings, { lastAt: at(24, 20, 7), since: [] });
  // the rest of that window (until 20:00 UTC the next day) is silent, overnight too
  assert.equal(post(4, 'v0.2.23', at(24, 20, 30)).ping, false);
  assert.equal(post(5, 'v0.2.24', at(25, 19, 59)).ping, false);
  assert.equal(post(6, 'v0.2.25', at(25, 20)).ping, true);
  // a window with no release before 20:00: the first one in it pings, even the next morning
  assert.equal(post(7, 'v0.2.26', at(27, 6)).ping, true);
  assert.equal(post(8, 'v0.2.27', at(27, 7)).ping, false);
  // pre-releases, launcher releases and other repos never ping and leave the state as it is
  const before = pings;
  for (const [repo, r] of [['horizon', game(9, 'v0.2.28', iso(at(27, 21)), { prerelease: true })],
    ['horizon', game(10, 'launcher@0.2.5', iso(at(27, 21)))], ['kimchi', game(11, 'v1.0.0', iso(at(27, 21)))]]) {
    const plan = rel.pingDecision(repo, r, pings);
    assert.equal(plan.ping, false);
    assert.equal(plan.pings, before);
  }
  // no state yet: the first game release pings; the list stays short
  assert.equal(rel.pingDecision('horizon', game(12, 'v0.2.29', iso(at(28, 10))), {}).ping, true);
  const many = Array.from({ length: 60 }, (_, i) => `**0.2.${i}** Something`);
  assert.equal(rel.pingDecision('horizon', game(13, 'v0.2.99', iso(at(28, 10))), { lastAt: at(28, 9), since: many }).pings.since.length, 40);
  // the ping's post lists them
  const m = rel.releaseMessage('horizon', game(3, 'v0.2.22', iso(at(24, 20, 7))), ROLE, evening.since);
  const field = m.embeds[0].fields.find((f) => f.name === 'Out since the last ping');
  assert.equal(field.value, '• **0.2.20** Zoom\n• **0.2.21** Beds, mobs and 3 more fixes');
  assert.equal(rel.sinceLine({ tag_name: 'v0.2.30', name: '' }), '**0.2.30**');
});

test('one post per release id, across restarts; the old Alpha posts are never posted again', () => {
  const at = (h, m) => `2026-10-23T${h}:${m}:00Z`;
  const oldAlpha = game(11, 'v0.2.5', at('10', '00'), { prerelease: true });
  const newer = game(12, 'v0.2.13', at('12', '10'));
  const launcher = game(13, 'launcher@0.2.2', at('12', '05'));
  const earlier = [11]; // state.nightlies: posted as Alpha before the single channel
  const tags = (list, posted) => rel.fresh(list, posted, SINCE, earlier).map((r) => r.tag_name);
  assert.deepEqual(tags([newer, launcher, oldAlpha], []), ['launcher@0.2.2', 'v0.2.13']);
  let posted = [13, 12].reduce(rel.remember, []);
  assert.deepEqual(tags([newer, launcher, oldAlpha], posted), []);
  // an old Alpha edited into a release (same id) is not posted a second time
  assert.deepEqual(tags([{ ...oldAlpha, prerelease: false, body: '### New\n- rewritten' }, newer], posted), []);
  // a game pre-release made after the switch (by hand) is posted once, silently (pingDecision never pings it)
  const pre = game(14, 'v0.3.0-rc.1', at('13', '00'), { prerelease: true });
  assert.deepEqual(tags([pre, newer], posted), ['v0.3.0-rc.1']);
  posted = rel.remember(posted, 14);
  assert.deepEqual(tags([{ ...pre, prerelease: false }, newer], posted), []);
});

test('newReleases reads a second page when the first is full, and skips the old Alpha ids', async () => {
  const mk = (n, off) => Array.from({ length: n }, (_, i) => game(1000 + off + i, `v0.2.${off + i}`, `2026-10-23T10:${String(i % 60).padStart(2, '0')}:00Z`, { prerelease: true }));
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(url.endsWith('page=2') ? [{ ...mk(1, 200)[0], prerelease: false }] : mk(100, 0)), { status: 200 });
  };
  const gh = makeGitHub({ fetchImpl });
  const got = await newReleases(gh, 'horizon', [], []);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /releases\?per_page=100$/);
  assert.match(urls[1], /releases\?per_page=100&page=2$/);
  assert.equal(got.length, 101);
  assert.equal(got.filter((r) => !r.prerelease).length, 1);
  urls.length = 0;
  assert.equal((await newReleases(gh, 'horizon', [], [1000, 1001])).length, 99);
  assert.equal((await newReleases(gh, 'horizon', [])).length, 101);
  assert.equal((await newReleases(gh, 'kimchi', [], [])).filter((r) => r.prerelease).length, 0);
});

test('no repost cascade: a listed stable release stays announced while newer ones are posted', () => {
  // 200 stable releases listed (two pages), all after SINCE, then 150 new ones posted one by one.
  const at = (i) => new Date(Date.parse(rel.SINCE) + (i + 1) * 60_000).toISOString();
  const listed = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, tag_name: `v0.2.${i}`, prerelease: false, draft: false, published_at: at(i) }));
  let announced = listed.map((r) => r.id).reduce(rel.remember, []);
  for (let i = 200; i < 350; i++) {
    const list = [{ id: i + 1, tag_name: `v0.2.${i}`, prerelease: false, draft: false, published_at: at(i) }, ...listed.slice(i - 199)];
    const now = rel.fresh(list, announced);
    assert.deepEqual(now.map((r) => r.id), [i + 1]);
    announced = rel.remember(announced, i + 1);
    listed.push(list[0]);
  }
});
