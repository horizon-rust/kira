// GitHub releases → #releases. The source is the REST API (`GET /repos/<owner>/<repo>/releases`), not
// the Atom feed: the feed lists bare tags and drafts, so Kira once announced a launcher still being built.
// Published releases are posted by release id (a draft keeps its id when it is published), each one once.
// Horizon has one release channel since 2026-10-23 (Ludovic: no more Alpha and Stable), and since 2026-10-28 it is the
// Nightly (Ludovic: Horizon ships only the Nightly): each Nightly, the `nightly` pre-release, is the game's release,
// published a few times a day (its earlier builds are renamed `nightly-<date>`, keeping their id, so never reposted). One post per release; @Releases is pinged at most once a day, by the
// first game release published after 20:00 UTC, and that post lists what came out since the last ping. Every
// other post is @silent. This file is pure (no Discord, no network) so it can be tested; bot.js sends.
import { COLOR, LINKS, GITHUB } from './config.js';

const RELEASE_BLUE = 0x5aa9ff; // the 📦 Releases role's colour, for the other repos

// Releases published before this are never posted (again). It moved from 2026-10-13T18:00Z (the old Atom feed)
// on 2026-10-23, after the repost cascade below: everything before is in #releases already, and 0.2.0 came after.
export const SINCE = '2026-10-23T00:00:00Z';
// Posted ids remembered per repo. It must stay above the releases listed (feeds.js: up to 200): with 100,
// each new post pushed the oldest id out while that release was still listed, so it was posted again,
// which pushed the next one out (2026-10-23: about 130 old releases reposted in #releases).
export const KEEP = 400;
export const SUPPRESS_NOTIFICATIONS = 1 << 12; // Discord's @silent message flag (4096): no push for anyone

// The releases of `list` to post now, oldest first. `announced`: the ids already posted. `earlier`: ids posted
// before the single channel as Alpha posts (state.nightlies), never posted again either, whatever happens to
// them (a pre-release edited into a release keeps its id). Pre-releases are posted only for Horizon's game.
export function fresh(list, announced = [], since = SINCE, earlier = [], repo = 'horizon') {
  const done = new Set([...(announced ?? []), ...(earlier ?? [])]);
  return (list ?? [])
    .filter((r) => !r.draft && r.published_at && Date.parse(r.published_at) >= Date.parse(since) && !done.has(r.id)
      && (!r.prerelease || kind(repo, r.tag_name) === 'game'))
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
}

// Records a posted release; returns the new list of ids.
export const remember = (announced = [], id) => [id, ...announced.filter((x) => x !== id)].slice(0, KEEP);

// Horizon's tags: `nightly` (and before 2026-10-28 `v0.2.5`, before 0.2 `v2026.10.13.1`) is the game,
// `launcher@0.2.5` (before: `launcher-v0.1.2`) the launcher. The last week's `nightly-<date>` were posted as `nightly`.
export function kind(repo, tag) {
  if (repo !== 'horizon') return 'generic';
  if (/^launcher(?:@|-v)/.test(tag)) return 'launcher';
  if (tag === NIGHTLY || /^v\d/.test(tag)) return 'game';
  return 'generic';
}

export const NIGHTLY = 'nightly';

// Whether #releases announces it: Horizon's game and launcher releases only.
export const announced = (repo, release) => kind(repo, release.tag_name) !== 'generic';

// Cut to `n` characters with an ellipsis, at a word boundary when one is close.
const clipTo = (s, n) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return (space > n - 25 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
};

// The bullets under a "### <name>" heading, compacted: "**Title:** detail" keeps the title and the start
// of the detail, so each one stays on a line or two.
export function bullets(body, name, each = 110) {
  const lines = (body ?? '').replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{2,4}\\s*${name}\\b`, 'i').test(l.trim()));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim();
    const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (!bold) { out.push(clipTo(text, each)); continue; }
    const title = bold[1].replace(/[:.]\s*$/, '');
    const rest = bold[2].trim();
    out.push(rest && bold[1].trim().endsWith(':') ? clipTo(`**${title}:** ${rest}`, each) : `**${title}**`);
  }
  return out;
}

// Bullets joined into one embed field (1024 characters at most), with "…and N more" if some don't fit.
export function bulletField(items, max = 1024) {
  const lines = items.map((b) => `• ${b}`);
  for (let n = lines.length; n > 0; n--) {
    const value = lines.slice(0, n).join('\n') + (n < lines.length ? `\n…and ${lines.length - n} more` : '');
    if (value.length <= max) return value;
  }
  return clipTo(lines[0] ?? '', max);
}

// The first lines of free-form notes: no headings, no blank lines, cut to `max` characters.
export function firstLines(body, max = 600, lines = 6) {
  const kept = (body ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n')
    .map((l) => l.trim()).filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*_]{3,}$/.test(l))
    .slice(0, lines).join('\n');
  return clipTo(kept, max);
}

const launcherVersion = (tag) => tag.replace(/^launcher(?:@|-v)/, '');

// The daily ping. Horizon releases as often as changes land, so @Releases is pinged once per day window, which
// starts at PING_HOUR UTC (20:00, the evening in Europe): the first Horizon game release published in a window
// pings, with a short list of the game releases posted since the last ping. Every other post is silent.
export const PING_HOUR = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SINCE = 40;

// The start of the day window holding `t` (ms): the last PING_HOUR:00 UTC at or before it.
export function pingWindow(t) {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PING_HOUR);
  return start > t ? start - DAY_MS : start;
}

// A game release in the ping's list: "**0.2.13** Beds, mobs and 3 more fixes".
export function sinceLine(release) {
  if (release.tag_name === NIGHTLY) return clipTo(`**${(release.name || NIGHTLY).trim()}**`, 110);
  const version = release.tag_name.replace(/^v/, '');
  const name = (release.name || '').trim();
  const line = name.includes(': ') ? name.slice(name.indexOf(': ') + 2) : '';
  return clipTo(line ? `**${version}** ${line}` : `**${version}**`, 110);
}

// Whether this post pings, the releases to list since the last ping, and the state to keep (state.releasePings:
// { lastAt, since }). Only Horizon's game releases count; pre-releases, launcher and other releases never ping
// and leave the state as it is. `at`: when the release was published, so a catch-up after a restart decides alike.
export function pingDecision(repo, release, pings = {}, at = Date.parse(release.published_at) || Date.now()) {
  const game = kind(repo, release.tag_name) === 'game' && (!release.prerelease || release.tag_name === NIGHTLY);
  if (repo !== 'horizon' || !game) return { ping: false, since: [], pings };
  const since = pings.since ?? [];
  if (pings.lastAt == null || pings.lastAt < pingWindow(at)) return { ping: true, since, pings: { lastAt: at, since: [] } };
  return { ping: false, since: [], pings: { lastAt: pings.lastAt, since: [...since, sinceLine(release)].slice(-MAX_SINCE) } };
}

// The message announcing one release: { content, embeds, allowedMentions, flags? }. `role`: the 📦 Releases role id
// when this post pings (pingDecision), else nothing and the post is @silent. `since`: the ping's list.
export function releaseMessage(repo, release, role, since = []) {
  const ping = role ? `<@&${role}> ` : '';
  const quiet = role ? {} : { flags: SUPPRESS_NOTIFICATIONS };
  const allowedMentions = { parse: [], roles: role ? [role] : [] };
  const tag = release.tag_name;
  const name = (release.name || tag).trim();
  const footer = { text: `${GITHUB.owner}/${repo} · ${tag}` };

  switch (kind(repo, tag)) {
    case 'game': {
      const added = bullets(release.body, 'New');
      const fixed = bullets(release.body, 'Fixed');
      const fields = [];
      if (added.length) fields.push({ name: 'New', value: bulletField(added) });
      if (fixed.length) fields.push({ name: 'Fixed', value: bulletField(fixed) });
      const picked = bullets(release.body, 'Not merged yet');
      if (picked.length) fields.push({ name: 'Picked by the Team, not merged yet', value: bulletField(picked, 700) });
      if (since.length) fields.push({ name: 'Out since the last ping', value: bulletField(since, 700) });
      const summary = fields.length ? '' : firstLines(release.body, 1200) + '\n\n';
      fields.push({ name: 'Links', value: `[Release notes](${release.html_url}) · [playhorizon.dev](${LINKS.horizonSite}) · [Download the launcher](${LINKS.horizonLauncher})` });
      return {
        content: `${ping}**${name}** is out`,
        embeds: [{
          color: COLOR, title: clipTo(name, 256), url: release.html_url,
          description: `${summary}Update from the Horizon launcher: it installs new versions by itself.`,
          fields, footer,
        }],
        allowedMentions, ...quiet,
      };
    }
    case 'launcher': {
      const title = `Horizon launcher ${launcherVersion(tag)}`;
      const changes = bullets(release.body, '(?:New|Fixed|Changed|Changes)');
      const what = changes.length ? bulletField(changes, 800) : firstLines(release.body, 800);
      return {
        content: `${ping}${title}`,
        embeds: [{
          color: COLOR, title, url: release.html_url,
          description: [what, `Your launcher updates itself; new here? [Download it](${LINKS.horizonLauncher}).`].filter(Boolean).join('\n\n'),
          footer,
        }],
        allowedMentions, ...quiet,
      };
    }
    default: {
      const highlights = [...bullets(release.body, 'New'), ...bullets(release.body, 'Fixed')];
      const notes = highlights.length ? bulletField(highlights, 700) : firstLines(release.body, 600);
      const title = name.toLowerCase().includes(repo.toLowerCase()) ? name : `${repo} ${name}`;
      return {
        content: `${ping}**${title}**`,
        embeds: [{
          color: RELEASE_BLUE, title: clipTo(title, 256), url: release.html_url,
          description: notes || undefined, footer,
        }],
        allowedMentions, ...quiet,
      };
    }
  }
}
