// Unit tests for the release announcements. No network: the releases are recorded GitHub answers
// (ludovic111/horizon and kimchi, trimmed to the fields Kira reads).
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

test('drafts, prereleases and releases from before the switch are never announced', () => {
  const draft = { ...byTag('launcher-v0.1.1'), id: 1, tag_name: 'launcher-v0.1.2', draft: true, published_at: null };
  const pre = { ...byTag('v2026.10.13.1'), id: 2, prerelease: true };
  const tags = rel.fresh([draft, pre, ...horizon], [], SINCE).map((r) => r.tag_name);
  assert.deepEqual(tags, ['v2026.10.13', 'launcher-v0.1.1', 'v2026.10.13.1']); // oldest first; 2026.10.12 is older than SINCE
  assert.deepEqual(rel.fresh(horizon, []).map((r) => r.tag_name), ['v2026.10.13.1']); // the real cut-over
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
  assert.equal(Array.from({ length: 150 }, (_, i) => i).reduce(rel.remember, []).length, 100);
});

test('newReleases reads the REST API, with or without a token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return new Response(JSON.stringify(horizon), { status: 200 });
  };
  const got = await newReleases(makeGitHub({ fetchImpl }), 'horizon', []);
  assert.deepEqual(got.map((r) => r.tag_name), ['v2026.10.13.1']);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/ludovic111\/horizon\/releases/);
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
  assert.equal(e.url, 'https://github.com/ludovic111/horizon/releases/tag/v2026.10.13.1');
  assert.equal(e.color, 0xf2a33a);
  assert.match(e.description, /Update from the Horizon launcher: it installs new versions by itself/);
  const field = (n) => e.fields.find((f) => f.name === n).value;
  assert.match(field('New'), /^• \*\*Horizon's own menus:\*\* a new title screen/);
  assert.match(field('New'), /Graphics settings, Simple and Advanced/);
  assert.match(field('Fixed'), /• \*\*No sound on Linux\*\*/);
  assert.match(field('Fixed'), /Missing swing animations/);
  assert.equal(field('Fixed').split('\n').length, 8);
  for (const l of field('New').split('\n')) assert.ok(l.length <= 112, l);
  assert.match(field('Links'), /\(https:\/\/github\.com\/ludovic111\/horizon\/releases\/tag\/v2026\.10\.13\.1\)/);
  assert.match(field('Links'), /\(https:\/\/playhorizon\.dev\)/);
  assert.match(field('Links'), /\(https:\/\/github\.com\/ludovic111\/horizon\/releases\?q=launcher&expanded=true\)/);
  assert.match(m.content, new RegExp(`^<@&${ROLE}> \\*\\*Horizon 2026\\.10\\.13\\.1`));
});

test('a launcher release: its own small embed, even with empty notes', () => {
  const m = rel.releaseMessage('horizon', { ...byTag('launcher-v0.1.1'), tag_name: 'launcher-v0.1.2', body: '### Fixed\n- **Downloads resume** after a dropped connection.\n- The window remembers its size.' }, ROLE);
  const [e] = m.embeds;
  assert.equal(e.title, 'Horizon launcher 0.1.2');
  assert.equal(e.fields, undefined);
  assert.match(e.description, /^• \*\*Downloads resume\*\*\n• The window remembers its size\./);
  assert.match(e.description, /Your launcher updates itself; new here\? \[Download it\]\(https:\/\/github\.com\/ludovic111\/horizon\/releases\?q=launcher&expanded=true\)/);
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
    assert.match(d, /3 claimed issues at a time/);
    assert.doesNotMatch(`${p.content} ${d}`, /@everyone|@here/);
    assert.equal(p.role, undefined);
  }
  assert.ok(agentSnippets('https://x/mcp', 'kira_t').includes('Bearer kira_t'));
});

test('pings: a game release with New pings the role; fix-only game releases and launcher releases are quiet', () => {
  const ping = (tag, body) => rel.releaseMessage('horizon', { tag_name: tag, name: tag, html_url: 'u', body }, ROLE);
  const feature = ping('v2026.10.15', '### New\n- **Controllers:** play with a pad.\n### Fixed\n- A crash.');
  assert.match(feature.content, new RegExp(`^<@&${ROLE}> `));
  assert.deepEqual(feature.allowedMentions, { parse: [], roles: [ROLE] });
  const fixes = ping('v2026.10.15.1', '### Fixed\n- Composters take items.');
  assert.doesNotMatch(fixes.content, /<@&/);
  assert.deepEqual(fixes.allowedMentions, { parse: [], roles: [] });
  const launcher = ping('launcher-v0.1.9', '### New\n- A logs button.');
  assert.doesNotMatch(launcher.content, /<@&/);
  assert.deepEqual(launcher.allowedMentions, { parse: [], roles: [] });
});

test('@Releases is pinged at most once every 6 hours; the next ping lists what came in between', () => {
  const hour = 60 * 60 * 1000;
  const game = (tag, added) => ({ tag_name: tag, name: tag, html_url: 'u', body: `### New\n- ${added}\n\n### Fixed\n- A fix.` });
  const first = rel.pingDecision('horizon', game('v2026.10.15', 'Zoom'), {}, 0);
  assert.equal(first.ping, true);
  const quiet = rel.pingDecision('horizon', game('v2026.10.15.1', 'Minimap'), first.pings, 2 * hour);
  assert.equal(quiet.ping, false);
  assert.equal(quiet.applies, true);
  assert.deepEqual(quiet.pings.pending, ['Minimap']);
  const fixOnly = rel.pingDecision('horizon', { tag_name: 'v2026.10.15.2', name: 'x', body: '### Fixed\n- A fix.' }, quiet.pings, 3 * hour);
  assert.equal(fixOnly.applies, false);
  assert.equal(fixOnly.pings, quiet.pings);
  const next = rel.pingDecision('horizon', game('v2026.10.15.3', 'Keystrokes'), quiet.pings, 6 * hour);
  assert.equal(next.ping, true);
  assert.deepEqual(next.earlier, ['Minimap']);
  assert.deepEqual(next.pings, { lastAt: 6 * hour, pending: [] });
  const m = rel.releaseMessage('horizon', game('v2026.10.15.3', 'Keystrokes'), ROLE, next.earlier);
  assert.match(m.content, new RegExp(`<@&${ROLE}>`));
  const field = m.embeds[0].fields.find((f) => f.name === 'Also new since the last ping');
  assert.equal(field.value, '• Minimap');
  const silent = rel.releaseMessage('horizon', game('v2026.10.15.1', 'Minimap'), null);
  assert.doesNotMatch(silent.content, /<@&/);
  assert.deepEqual(silent.allowedMentions.roles, []);
  assert.equal(rel.pingDecision('kimchi', { tag_name: 'v1', body: '### New\n- x' }, {}, 0).applies, false, 'other repos keep their pings');
});

const NOTES = '### New\n- **Zoom:** hold C to zoom in, like OptiFine does.\n### Fixed\n- Composters take items.';
const beta = (id, tag, at, extra = {}) => ({ id, tag_name: tag, name: `Horizon ${tag.slice(1)}`, prerelease: true, draft: false,
  published_at: at, html_url: `https://github.com/ludovic111/horizon/releases/tag/${tag}`, body: NOTES, ...extra });

test('an Alpha is a silent post: no role, no mentions, the @silent flag, the compact notes and the link', () => {
  const m = rel.alphaMessage('horizon', beta(1, 'v0.2.5', '2026-10-23T10:00:00Z'));
  assert.equal(m.content, '🧪 Alpha v0.2.5');
  assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.equal(m.flags, 4096);
  assert.equal(rel.SUPPRESS_NOTIFICATIONS, 4096);
  const [e] = m.embeds;
  assert.equal(e.title, 'Horizon 0.2.5');
  assert.equal(e.url, 'https://github.com/ludovic111/horizon/releases/tag/v0.2.5');
  assert.match(e.description, /^• \*\*Zoom:\*\* hold C to zoom in, like OptiFine does\.\n• Composters take items\./);
  assert.match(e.description, /Alpha\*\* channel/);
  assert.match(e.description, /\[Release notes\]\(https:\/\/github\.com\/ludovic111\/horizon\/releases\/tag\/v0\.2\.5\)/);
  assert.doesNotMatch(JSON.stringify(m), /<@|@everyone|@here/);
  const bare = rel.alphaMessage('horizon', beta(2, 'v0.2.6', '2026-10-23T10:10:00Z', { name: '', body: 'Just a build.' }));
  assert.equal(bare.embeds[0].title, 'v0.2.6');
  assert.match(bare.embeds[0].description, /^Just a build\./);
  // the stable post keeps today's format: no flags, the role pinged
  const stable = rel.releaseMessage('horizon', { ...beta(1, 'v0.2.5', '2026-10-23T10:00:00Z'), prerelease: false }, ROLE);
  assert.equal(stable.flags, undefined);
  assert.match(stable.content, new RegExp(`^<@&${ROLE}> \\*\\*Horizon 0\\.2\\.5\\*\\* is out`));
});

test('Alpha then Stable: each id is posted once per channel, across restarts and a promotion in place', () => {
  const at = (h, m) => `2026-10-23T${h}:${m}:00Z`;
  const a = beta(11, 'v0.2.5', at('10', '00'));
  const b = beta(12, 'v0.2.6', at('10', '10'));
  const launcher = { ...beta(13, 'launcher@0.2.1', at('10', '05')), prerelease: false };
  const tags = (list, stable, nights) => rel.fresh(list, stable, SINCE, nights).map((r) => `${r.prerelease ? 'alpha' : 'stable'} ${r.tag_name}`);
  // without an Alpha list (other repos), pre-releases stay unposted
  assert.deepEqual(tags([a, b, launcher], [], null), ['stable launcher@0.2.1']);
  // new pre-releases: Alpha, oldest first; the launcher (not a pre-release) is stable as today
  assert.deepEqual(tags([b, launcher, a], [], []), ['alpha v0.2.5', 'stable launcher@0.2.1', 'alpha v0.2.6']);
  // after posting them, a restart (same state) posts nothing
  let nights = [11, 12].reduce((ids, id) => rel.rememberAlpha(ids, id), []);
  let stable = rel.remember([], 13);
  assert.deepEqual(tags([a, b, launcher], stable, nights), []);
  // v0.2.5 is promoted in place: same id, no longer a pre-release, notes rewritten: posted once as Stable
  const promoted = { ...a, prerelease: false, body: '### New\n- **Zoom:** rewritten.' };
  assert.deepEqual(tags([b, promoted, launcher], stable, nights), ['stable v0.2.5']);
  stable = rel.remember(stable, 11);
  assert.deepEqual(tags([b, promoted, launcher], stable, nights), []); // never twice, even though the Alpha list still has it
  // an Alpha id forgotten from the list (never) would repost; 400 ids are kept
  assert.equal(Array.from({ length: 500 }, (_, i) => i).reduce((ids, id) => rel.rememberAlpha(ids, id), []).length, 400);
  // drafts, old releases and non-game pre-releases are never Alpha posts
  const odd = [beta(21, 'v0.2.7', at('11', '00'), { draft: true, published_at: null }), beta(22, 'v0.2.8', '2026-10-01T00:00:00Z'),
    beta(23, 'launcher@0.2.2', at('11', '30')), beta(24, 'archive/wip', at('11', '40'))];
  assert.deepEqual(tags(odd, [], []), []);
  assert.equal(rel.isAlpha('horizon', a), true);
  assert.equal(rel.isAlpha('kimchi', a), false);
  assert.equal(rel.isAlpha('horizon', promoted), false);
});

test('newReleases reads a second page when the first is full, and passes the Alpha list', async () => {
  const mk = (n, off) => Array.from({ length: n }, (_, i) => beta(1000 + off + i, `v0.2.${off + i}`, `2026-10-23T10:${String(i % 60).padStart(2, '0')}:00Z`));
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
  assert.equal((await newReleases(gh, 'horizon', [], null)).length, 1); // other repos: no Alpha
  assert.equal((await newReleases(gh, 'kimchi', [], [])).filter((r) => r.prerelease).length, 0);
});
