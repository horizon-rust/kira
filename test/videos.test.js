// Unit tests for the YouTube video posts. No network, no Discord: the feed is a recorded Atom answer
// (Ludovic's channel, trimmed, with a Short and a stream added), `send` is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as videos from '../src/videos.js';
import { VIDEOS, LAYOUT, LINKS } from '../src/config.js';

const FEED = readFileSync(new URL('./fixtures/youtube-feed.xml', import.meta.url), 'utf8');
const quiet = { log() {}, error() {} };
const entry = (id, published, title = id) => ({ id, title, published });
const feedOf = (entries) => `<feed>${entries.map((e) => `<entry><yt:videoId>${e.id}</yt:videoId><title>${e.title}</title><published>${e.published}</published></entry>`).join('')}</feed>`;
const serving = (xml) => async () => new Response(xml, { status: 200 });

test('the feed: video id, title (entities decoded) and date of every entry, the channel header skipped', () => {
  const got = videos.parseFeed(FEED);
  assert.deepEqual(got.map((v) => v.id), ['SHORTshort1', 'cykDpzoYMSA', 'OeQl91EckYI']); // Short and stream included
  assert.equal(got[0].title, 'Rust & wgpu: 5x "faster" <3 #shorts');
  assert.equal(got[1].title, "this isn't minecraft (it's 5x faster)");
  assert.equal(got[1].published, '2026-10-16T11:30:11.000Z');
  assert.deepEqual(videos.parseFeed(''), []);
  assert.deepEqual(videos.parseFeed('<html>not a feed</html>'), []);
  // an entry without a usable id, title or date is skipped, the others are kept
  const bad = '<feed><entry><yt:videoId>x</yt:videoId><title>t</title><published>2026-10-01T00:00:00Z</published></entry>'
    + '<entry><yt:videoId>abcdefghijk</yt:videoId><title></title><published>2026-10-01T00:00:00Z</published></entry>'
    + '<entry><yt:videoId>abcdefghijl</yt:videoId><title>no date</title></entry>'
    + '<entry><yt:videoId>abcdefghijm</yt:videoId><title><![CDATA[ok & fine]]></title><published>2026-10-01T00:00:00Z</published></entry></feed>';
  assert.deepEqual(videos.parseFeed(bad).map((v) => [v.id, v.title]), [['abcdefghijm', 'ok & fine']]);
});

test('the post: one line with the title, then the watch link alone on its line, no mentions', () => {
  const m = videos.message(entry('cykDpzoYMSA', '2026-10-16T11:30:11.000Z', "this isn't minecraft (it's 5x faster)"));
  assert.equal(m.content, "🎬 New video: **this isn't minecraft (it's 5x faster)**\nhttps://www.youtube.com/watch?v=cykDpzoYMSA");
  assert.deepEqual(m.allowedMentions, { parse: [], roles: [] }); // no role known: nobody is pinged
  // Markdown in a title is plain text; so are masked links and mentions
  const odd = videos.message(entry('abcdefghijk', '2026-10-16T00:00:00Z', '**bold** [x](https://evil.example) @everyone _a_'));
  assert.equal(odd.content.split('\n').length, 2);
  assert.equal(odd.content, '🎬 New video: **\\*\\*bold\\*\\* \\[x\\](https://evil.example) @everyone \\_a\\_**\nhttps://www.youtube.com/watch?v=abcdefghijk');
  assert.deepEqual(odd.allowedMentions, { parse: [], roles: [] });
});

test('fresh: not posted yet, not older than the first run, oldest first', () => {
  const list = [entry('c', '2026-10-25T12:00:00Z'), entry('b', '2026-10-25T11:00:00Z'), entry('a', '2026-10-25T10:00:00Z'), entry('old', '2026-10-01T00:00:00Z')];
  assert.deepEqual(videos.fresh(list, [], '2026-10-25T00:00:00Z').map((v) => v.id), ['a', 'b', 'c']);
  assert.deepEqual(videos.fresh(list, ['b'], '2026-10-25T00:00:00Z').map((v) => v.id), ['a', 'c']);
  assert.deepEqual(videos.fresh(list, ['a', 'b', 'c'], '2026-10-25T00:00:00Z'), []);
  assert.deepEqual(videos.fresh(undefined, [], '2026-10-25T00:00:00Z'), []);
  assert.deepEqual(videos.remember(videos.remember([], 'x'), 'x'), ['x']);
  assert.equal(Array.from({ length: 300 }, (_, i) => String(i)).reduce(videos.remember, []).length, videos.KEEP);
  assert.ok(videos.KEEP > 15); // more ids kept than the feed lists (15)
});

test('first run: the videos already out are recorded and nothing is posted', async () => {
  const state = {};
  const sent = [];
  const now = Date.parse('2026-10-25T12:00:00Z');
  const got = await videos.poll({ state, send: async (m) => sent.push(m), fetchImpl: serving(FEED), log: quiet, now });
  assert.deepEqual(got, []);
  assert.deepEqual(sent, []);
  assert.deepEqual(new Set(state.videos.ids), new Set(['SHORTshort1', 'cykDpzoYMSA', 'OeQl91EckYI']));
  assert.equal(state.videos.since, '2026-10-25T12:00:00.000Z');
  // the next poll with the same feed posts nothing either
  assert.deepEqual(await videos.poll({ state, send: async (m) => sent.push(m), fetchImpl: serving(FEED), log: quiet, now }), []);
  assert.deepEqual(sent, []);
});

test('a new video is posted once, then never again; several new ones go oldest first', async () => {
  const state = { videos: { since: '2026-10-25T00:00:00.000Z', ids: ['oldvideo001'] } };
  const sent = [];
  let saves = 0;
  const run = (xml) => videos.poll({ state, save: () => saves++, send: async (m) => { sent.push(m.content); return { id: String(sent.length) }; }, fetchImpl: serving(xml), log: quiet });
  const one = entry('video000001', '2026-10-25T08:00:00Z', 'first');
  assert.equal((await run(feedOf([one, entry('oldvideo001', '2026-10-20T00:00:00Z')]))).length, 1);
  assert.deepEqual(sent, ['🎬 New video: **first**\nhttps://www.youtube.com/watch?v=video000001']);
  assert.equal((await run(feedOf([one]))).length, 0); // no duplicate on the next poll
  assert.equal(sent.length, 1);
  // three at once, listed newest first by YouTube
  const feed = feedOf([entry('video000004', '2026-10-25T11:00:00Z', 'D'), entry('video000003', '2026-10-25T10:00:00Z', 'C'), entry('video000002', '2026-10-25T09:00:00Z', 'B'), one]);
  assert.deepEqual((await run(feed)).map((v) => v.title), ['B', 'C', 'D']);
  assert.deepEqual(sent.slice(1).map((c) => c.split('**')[1]), ['B', 'C', 'D']);
  assert.equal((await run(feed)).length, 0);
  assert.equal(sent.length, 4);
  assert.ok(saves >= 4);
  // a video published before the first run is never posted, even if it was not in the feed then
  assert.equal((await run(feedOf([entry('video000009', '2026-10-24T23:00:00Z', 'before')]))).length, 0);
  assert.equal(sent.length, 4);
});

test('a failed send posts nothing twice: the rest waits, in order, for the next poll', async () => {
  const state = { videos: { since: '2026-10-25T00:00:00.000Z', ids: [] } };
  const feed = feedOf([entry('video000003', '2026-10-25T11:00:00Z', 'C'), entry('video000002', '2026-10-25T10:00:00Z', 'B'), entry('video000001', '2026-10-25T09:00:00Z', 'A')]);
  const sent = [];
  let fail = 'B';
  const send = async (m) => { const t = m.content.split('**')[1]; if (t === fail) throw new Error('Missing Access'); sent.push(t); return { id: t }; };
  await videos.poll({ state, send, fetchImpl: serving(feed), log: quiet });
  assert.deepEqual(sent, ['A']); // B failed: C does not jump the queue
  fail = null;
  await videos.poll({ state, send, fetchImpl: serving(feed), log: quiet });
  assert.deepEqual(sent, ['A', 'B', 'C']);
});

test('feed errors are logged quietly and retried: HTTP errors, network errors, nonsense', async () => {
  const errors = [];
  const log = { log() {}, error: (...a) => errors.push(a.join(' ')) };
  const state = {};
  const send = async () => assert.fail('nothing may be posted');
  for (const fetchImpl of [async () => new Response('', { status: 503 }), async () => { throw new Error('ECONNRESET'); }]) {
    assert.deepEqual(await videos.poll({ state, send, fetchImpl, log }), []);
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /HTTP 503/);
  assert.equal(state.videos, undefined); // a failed first fetch is not the first run: nothing recorded yet
  // an empty (but valid) answer on the first run still starts the baseline; later videos are posted
  assert.deepEqual(await videos.poll({ state, send, fetchImpl: serving('<feed></feed>'), log, now: Date.parse('2026-10-25T12:00:00Z') }), []);
  assert.deepEqual(state.videos.ids, []);
  const sent = [];
  await videos.poll({ state, send: async (m) => sent.push(m), fetchImpl: serving(feedOf([entry('video000001', '2026-10-25T13:00:00Z', 'new')])), log });
  assert.equal(sent.length, 1);
});

test('the feed request: Ludovic\'s channel id from the config', async () => {
  const calls = [];
  await videos.fetchFeed(async (url, init) => { calls.push(url); assert.ok(init.signal); return new Response(FEED, { status: 200 }); });
  assert.deepEqual(calls, ['https://www.youtube.com/feeds/videos.xml?channel_id=UCNpwCgIK6O6oct9ra9ohZ7w']);
  assert.equal(VIDEOS.channelId, 'UCNpwCgIK6O6oct9ra9ohZ7w');
  assert.equal(VIDEOS.everyMs, 10 * 60 * 1000);
  assert.match(LINKS.youtube, /@lu4ovic$/);
});

test('#ludovic-videos: read-only, in "start here" right after #announcements, with its topic', () => {
  const start = LAYOUT.find((g) => g.key === 'start');
  const keys = start.channels.map((c) => c.key);
  assert.equal(keys.indexOf('ludovicvideos'), keys.indexOf('announcements') + 1);
  const spec = start.channels.find((c) => c.key === 'ludovicvideos');
  assert.equal(spec.name, 'ludovic-videos');
  assert.equal(spec.type, 'announcement'); // an announcement channel on the live server
  assert.equal(spec.readonly, true);
  assert.equal(spec.topic, "Ludovic's new YouTube videos, posted by Kira as they come out.");
});

test('the post pings the 🎬 Videos role and only that role', async () => {
  const ROLE = '1559242159775940999';
  const m = videos.message(entry('cykDpzoYMSA', '2026-10-16T11:30:11.000Z', 'hello @everyone <@&123456789012345678>'), ROLE);
  assert.equal(m.content, `<@&${ROLE}> 🎬 New video: **hello @everyone <@&123456789012345678\\>**\nhttps://www.youtube.com/watch?v=cykDpzoYMSA`);
  assert.deepEqual(m.allowedMentions, { parse: [], roles: [ROLE] }); // a mention inside the title cannot fire
  assert.deepEqual(videos.message(entry('cykDpzoYMSA', '2026-10-16T11:30:11.000Z'), null).allowedMentions, { parse: [], roles: [] });
  // poll hands the role to every post
  const state = { videos: { since: '2026-10-25T00:00:00.000Z', ids: [] } };
  const sent = [];
  await videos.poll({ state, role: ROLE, send: async (x) => sent.push(x), fetchImpl: serving(feedOf([entry('video000001', '2026-10-25T13:00:00Z', 'new')])), log: quiet });
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, new RegExp(`^<@&${ROLE}> 🎬 New video: \\*\\*new\\*\\*\\n`));
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [ROLE] });
});

test('🎬 Videos: a role people pick (buttons, Onboarding), not the retired "videos" role', async () => {
  const { ROLES, RETIRED_ROLES } = await import('../src/config.js');
  const { rolesMessage } = await import('../src/texts.js');
  const spec = ROLES.find((r) => r.key === 'newvideos');
  assert.equal(spec.name, '🎬 Videos');
  assert.equal(spec.self, true);
  assert.ok(!RETIRED_ROLES.includes('newvideos')); // setup deletes retired roles by key; 'videos' is the old 🔔 Videos
  assert.ok(RETIRED_ROLES.includes('videos'));
  assert.notEqual(spec.name, '🔔 Videos');
  assert.equal(new Set(ROLES.map((r) => r.key)).size, ROLES.length);
  assert.equal(new Set(ROLES.map((r) => r.name)).size, ROLES.length);
  const keys = ROLES.map((r) => r.key);
  assert.ok(Math.abs(keys.indexOf('newvideos') - keys.indexOf('releases')) <= 2); // next to the other ping roles
  const ids = rolesMessage({ channels: {} }).components.flatMap((row) => row.components.map((b) => b.data.custom_id));
  assert.ok(ids.includes('role:newvideos'));
  assert.ok(ids.every((id) => ROLES.some((r) => `role:${r.key}` === id && r.self)));
  assert.match(rolesMessage({ channels: {} }).embeds[0].data.description, /🎬 every new video/);
});
