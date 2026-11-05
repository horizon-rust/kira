// Ludovic's YouTube videos → #ludovic-videos. The source is the channel's public Atom feed (no key, no quota):
// `https://www.youtube.com/feeds/videos.xml?channel_id=…` lists the newest 15 uploads, Shorts and live streams
// included. Each video is posted once, oldest first, by its video id. This file has no Discord and no global
// state, so it can be tested: bot.js passes the channel's `send` and the state.
import { VIDEOS } from './config.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) => {
  if (name) return ENTITIES[name.toLowerCase()];
  const code = dec ? Number(dec) : parseInt(hex, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim() : null;
};

// The videos of an Atom feed, in feed order (newest first): { id, title, published } where `published` is an
// ISO date. Entries without a valid video id, title or date are skipped.
export function parseFeed(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const id = tag(m[1], 'yt:videoId');
    const title = tag(m[1], 'title')?.replace(/\s+/g, ' ');
    const at = Date.parse(tag(m[1], 'published'));
    if (!id || !/^[\w-]{11}$/.test(id) || !title || Number.isNaN(at)) continue;
    out.push({ id, title, published: new Date(at).toISOString() });
  }
  return out;
}

// What to post now, oldest first: not posted yet, and published at or after `since` (the first run's time).
export function fresh(entries, posted = [], since) {
  const done = new Set(posted);
  const from = Date.parse(since);
  return (entries ?? [])
    .filter((v) => !done.has(v.id) && Date.parse(v.published) >= from)
    .sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
}

// Records a posted video; returns the new list of ids (more are kept than the feed lists, so none comes back).
export const KEEP = 200;
export const remember = (posted = [], id) => [id, ...posted.filter((x) => x !== id)].slice(0, KEEP);

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// The message for one video: the 🎬 Videos role (when its id is known), a line, then the bare link on its own
// line so Discord shows the player. The title is plain text (Markdown and mentions in it do nothing): the only
// mention that can fire is that one role, the only one `allowedMentions` lets through.
export function message(video, role = null) {
  const title = video.title.replace(/([\\*_~`|>[\]])/g, '\\$1');
  const ping = role ? `<@&${role}> ` : '';
  return { content: `${ping}🎬 New video: **${title.length > 300 ? title.slice(0, 299) + '…' : title}**\n${watchUrl(video.id)}`, allowedMentions: { parse: [], roles: role ? [role] : [] } };
}

export async function fetchFeed(fetchImpl = fetch, channelId = VIDEOS.channelId) {
  const res = await fetchImpl(`${VIDEOS.feedUrl}?channel_id=${channelId}`, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'kira (Horizon Discord bot)' } });
  if (!res.ok) throw new Error(`youtube feed: HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// One poll. `state.videos` = { since, ids }. The first successful fetch only records what is already out
// (nothing is posted) and sets `since`: nothing published before that is ever posted. Then each new video is
// sent oldest first and remembered right after its send, so a failure half-way posts the rest next time and
// never a video twice. `role`: the id of the role to ping. Returns the videos posted. Feed errors are logged and retried at the next poll.
export async function poll({ state, send, role = null, save = () => {}, fetchImpl, log = console, now = Date.now() }) {
  let entries;
  try {
    entries = await fetchFeed(fetchImpl);
  } catch (e) {
    log.error('videos', e.message);
    return [];
  }
  if (!state.videos) {
    state.videos = { since: new Date(now).toISOString(), ids: entries.reduce((ids, v) => remember(ids, v.id), []) };
    save();
    log.log(`videos: first run, ${entries.length} videos already out recorded, none posted`);
    return [];
  }
  const posted = [];
  for (const video of fresh(entries, state.videos.ids, state.videos.since)) {
    try {
      const msg = await send(message(video, role));
      state.videos.ids = remember(state.videos.ids, video.id);
      save();
      posted.push(video);
      log.log(`video posted: ${video.id} ${video.title} → message ${msg?.id}`);
    } catch (e) {
      log.error('videos', video.id, e.message);
      break; // keep the order: the rest waits for the next poll
    }
  }
  return posted;
}
