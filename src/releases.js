// GitHub releases → #releases. The source is the REST API (`GET /repos/<owner>/<repo>/releases`), not
// the Atom feed: the feed lists bare tags and drafts, so Kira once announced a launcher still being built.
// Only published, non-prerelease releases are posted, each once, by release id (a draft keeps its id when
// it is published). This file is pure (no Discord, no network) so it can be tested; bot.js sends.
import { COLOR, LINKS, GITHUB } from './config.js';

const RELEASE_BLUE = 0x5aa9ff; // the 📦 Releases role's colour, for the other repos

// Releases published before this were announced by the old Atom feed: never posted again.
export const SINCE = '2026-10-13T18:00:00Z';
const KEEP = 100; // ids remembered per repo

// The releases of `list` to announce now, oldest first. `announced` is the list of ids already posted.
export function fresh(list, announced = [], since = SINCE) {
  const done = new Set(announced);
  return (list ?? [])
    .filter((r) => !r.draft && !r.prerelease && r.published_at && Date.parse(r.published_at) >= Date.parse(since) && !done.has(r.id))
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
}

// Records a posted release; returns the new list of ids.
export const remember = (announced = [], id) => [id, ...announced.filter((x) => x !== id)].slice(0, KEEP);

// Horizon's tags: `v2026.10.13.1` is the game, `launcher-v0.1.2` the launcher.
export function kind(repo, tag) {
  if (repo !== 'horizon') return 'generic';
  if (/^launcher-v/.test(tag)) return 'launcher';
  if (/^v\d/.test(tag)) return 'game';
  return 'generic';
}

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

const launcherVersion = (tag) => tag.replace(/^launcher-v/, '');

// The message announcing one release: { content, embeds, allowedMentions }. `role` is the 📦 Releases role id.
// Horizon releases ship automatically and often (Ludovic, 2026-10-14): the role is pinged only for a game
// release with a "New" section (a new feature), never for fix-only game releases or launcher releases.
export function releaseMessage(repo, release, role) {
  if (role && (kind(repo, release.tag_name) === 'launcher'
    || (kind(repo, release.tag_name) === 'game' && !bullets(release.body, 'New').length))) role = null;
  const ping = role ? `<@&${role}> ` : '';
  const allowedMentions = { parse: [], roles: role ? [role] : [] };
  const tag = release.tag_name;
  const name = (release.name || tag).trim();
  const when = release.published_at;
  const footer = { text: `${GITHUB.owner}/${repo} · ${tag}` };

  switch (kind(repo, tag)) {
    case 'game': {
      const added = bullets(release.body, 'New');
      const fixed = bullets(release.body, 'Fixed');
      const fields = [];
      if (added.length) fields.push({ name: 'New', value: bulletField(added) });
      if (fixed.length) fields.push({ name: 'Fixed', value: bulletField(fixed) });
      const summary = fields.length ? '' : firstLines(release.body, 1200) + '\n\n';
      fields.push({ name: 'Links', value: `[Release notes](${release.html_url}) · [playhorizon.dev](${LINKS.horizonSite}) · [Download the launcher](${LINKS.horizonLauncher})` });
      return {
        content: `${ping}**${name}** is out`,
        embeds: [{
          color: COLOR, title: clipTo(name, 256), url: release.html_url,
          description: `${summary}Update from the Horizon launcher: it installs new versions by itself.`,
          fields, footer, timestamp: when,
        }],
        allowedMentions,
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
          footer, timestamp: when,
        }],
        allowedMentions,
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
          description: notes || undefined, footer, timestamp: when,
        }],
        allowedMentions,
      };
    }
  }
}
