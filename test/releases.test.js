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
  assert.match(field('Links'), /\(https:\/\/github\.com\/ludovic111\/horizon\/releases\?q=launcher-v&expanded=true\)/);
  assert.match(m.content, new RegExp(`^<@&${ROLE}> \\*\\*Horizon 2026\\.10\\.13\\.1`));
});

test('a launcher release: its own small embed, even with empty notes', () => {
  const m = rel.releaseMessage('horizon', { ...byTag('launcher-v0.1.1'), tag_name: 'launcher-v0.1.2', body: '### Fixed\n- **Downloads resume** after a dropped connection.\n- The window remembers its size.' }, ROLE);
  const [e] = m.embeds;
  assert.equal(e.title, 'Horizon launcher 0.1.2');
  assert.equal(e.fields, undefined);
  assert.match(e.description, /^• \*\*Downloads resume\*\*\n• The window remembers its size\./);
  assert.match(e.description, /Your launcher updates itself; new here\? \[Download it\]\(https:\/\/github\.com\/ludovic111\/horizon\/releases\?q=launcher-v&expanded=true\)/);
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
    assert.deepEqual(m.allowedMentions, { parse: [], roles: [ROLE] });
  }
  assert.deepEqual(rel.releaseMessage('kimchi', fixture('kimchi-releases')[0], ROLE).allowedMentions, { parse: [], roles: [ROLE] });
  const silent = rel.releaseMessage('kimchi', fixture('kimchi-releases')[0], undefined);
  assert.deepEqual(silent.allowedMentions, { parse: [], roles: [] });
  assert.doesNotMatch(silent.content, /<@&/);
});

test('one-off announcements: unique keys, within Discord limits, the Horizon role only', async () => {
  const { ONE_OFFS } = await import('../src/config.js');
  assert.equal(new Set(ONE_OFFS.map((p) => p.key)).size, ONE_OFFS.length);
  for (const p of ONE_OFFS) {
    assert.equal(p.role, 'horizon');
    assert.ok(p.embed.title.length <= 256 && p.embed.description.length <= 4096);
    for (const f of p.embed.fields) assert.ok(f.value.length <= 1024 && f.name.length <= 256);
    const total = p.embed.title.length + p.embed.description.length + p.embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000);
  }
});
