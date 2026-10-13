// Ludovic's YouTube uploads (Atom feed) and the GitHub releases of his public repos (REST API).
// The first time the YouTube feed is read, everything in it is marked as seen, so nothing old is posted.
import { GITHUB, YOUTUBE_CHANNEL_ID } from './config.js';
import { fresh } from './releases.js';

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();

function entries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: decode(e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? ''),
    title: decode(e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    url: e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '',
  })).filter((x) => x.id && x.url);
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Kira (Discord bot of ludovic\'s server)' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return entries(await res.text());
}

export const FEEDS = [
  { key: 'youtube', kind: 'video', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}` },
];

// Returns the new items of one feed, oldest first, and records them as seen in `seen`.
export async function poll(feed, seen) {
  const items = await fetchFeed(feed.url);
  const first = !seen[feed.key];
  const known = new Set(seen[feed.key] ?? []);
  const fresh = first ? [] : items.filter((i) => !known.has(i.id)).reverse();
  seen[feed.key] = items.map((i) => i.id).slice(0, 50);
  return fresh;
}

// The releases of one repo to announce now, oldest first (published, not prereleases, not posted yet).
// `gh` is a client from github.js; `announced` the ids already posted for this repo.
export async function newReleases(gh, repo, announced) {
  return fresh(await gh.get(`/repos/${GITHUB.owner}/${repo}/releases?per_page=20`), announced);
}
