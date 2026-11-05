// The hub (playhorizon.dev/hub) as Kira reads it: the roadmap and the journal the website publishes as JSON
// (the horizon repo's roadmap/README.md documents both), and the texts of the verbs Kira shares with the site
// (report, roadmap, claim, status; "suggest" only points to #horizon-ideas). No Discord here: src/features/hub.js does
// the talking.

import { COLOR } from './config.js';

export const VERBS = ['report', 'suggest', 'roadmap', 'claim', 'status'];
export const STATUS = { now: 'Now', next: 'Next', later: 'Later', 'help-wanted': 'Help wanted', shipped: 'Shipped' };

// "@Kira roadmap servers" → { verb: 'roadmap', rest: 'servers' }. Only a message that starts with Kira's
// mention is for Kira; anything else after it (or nothing) is { verb: 'help' }.
export function parseVerb(content, botId) {
  const m = String(content ?? '').match(new RegExp(`^\\s*<@!?${botId}>[\\s,:]*(\\S*)\\s*([\\s\\S]*)$`));
  if (!m) return null;
  const verb = m[1].toLowerCase().replace(/^\//, '');
  return VERBS.includes(verb) ? { verb, rest: m[2].trim() } : { verb: 'help', rest: '' };
}

// Text people wrote, safe to show in Discord: no pings, no masked links, one paragraph block at most `n` long.
export function plainText(s, n = 1000) {
  const text = String(s ?? '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<[@#][!&]?\d+>/g, '')
    .replace(/\\/g, '\\\\').replace(/[[\]]/g, (c) => `\\${c}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

// The roadmap's shape (roadmap.json): { url?, areas: [{ id, name }], items: [{ id, title, status, area, plain,
// dev, links, shipped_in?, focus? }] }. Anything else is treated as "no roadmap yet".
export function isRoadmap(r) {
  return !!r && Array.isArray(r.items) && r.items.every((i) => i && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.status === 'string');
}

export const itemUrl = (hubUrl, id) => `${hubUrl}#${encodeURIComponent(id)}`;

// The area someone typed ("servers", "Servers and multiplayer", "mods"): by id, then by name, then by a prefix.
export function findArea(roadmap, text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  const areas = roadmap.areas ?? [];
  return areas.find((a) => a.id.toLowerCase() === t)
    ?? areas.find((a) => a.name?.toLowerCase() === t)
    ?? areas.find((a) => a.id.toLowerCase().startsWith(t) || a.name?.toLowerCase().startsWith(t))
    ?? null;
}

// Text from the roadmap's JSON, shown in an embed: data, never markup. One line; every character Discord's markdown
// reads is escaped (so a title can't bold, link, quote or spoil), `<` too (mentions, channels, custom emoji), and
// @everyone / @here can't ping (allowedMentions is { parse: [] } on every send as well).
export function mdEscape(s, n = 1000) {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  return (text.length > n ? `${text.slice(0, n - 1)}…` : text)
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/[\\*_~`|[\]()<>]/g, '\\$&');
}

// Discord's limits for one message: 10 embeds, 6000 characters over all of them (title, description, footer…), 4096 in a
// description. Kept a little under, because Discord counts what it rendered.
export const LIMITS = { embeds: 10, total: 5800, description: 3900, content: 1900 };
const HEADINGS = [['now', '🔨 Now'], ['next', '⏭️ Next'], ['later', '🕰️ Later'], ['help-wanted', '🙋 Help wanted']];
const itemLink = (item, hubUrl) => `[${mdEscape(item.title, 100)}](${itemUrl(hubUrl, item.id).replace(/[()]/g, encodeURIComponent)})`;

// An area's lines, in order: the heading of each status that has items, then one line per item. `full`: also each
// item's one-line plain text, and the shipped items with the release (the whole roadmap shows Shipped as a count).
function areaLines(items, hubUrl, full) {
  const lines = [];
  for (const [status, heading] of [...HEADINGS, ...(full ? [['shipped', '✅ Shipped']] : [])]) {
    const list = items.filter((i) => i.status === status);
    if (!list.length) continue;
    if (lines.length) lines.push('');
    lines.push(`**${heading}**`);
    for (const i of list) {
      const plain = full && i.plain ? `: ${mdEscape(i.plain, 300)}` : '';
      const release = full && status === 'shipped' && i.shipped_in ? ` (${mdEscape(i.shipped_in, 40)})` : '';
      const text = `• ${itemLink(i, hubUrl)}${release}${plain}`;
      lines.push(text.length <= 1500 ? text : `• ${itemLink(i, hubUrl)}`);
    }
  }
  const shipped = items.filter((i) => i.status === 'shipped').length;
  if (!full && shipped) lines.push(...(lines.length ? [''] : []), `✅ ${shipped} shipped`);
  return lines;
}

// Lines → descriptions of at most `max` characters, cut between lines; a heading never ends a description.
function pack(lines, max) {
  const out = [];
  let cur = [];
  const len = (l) => l.join('\n').length;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (cur.length && len([...cur, line]) > max) {
      const orphan = cur.length > 1 && /^\*\*[^*]+\*\*$/.test(cur[cur.length - 1]) ? cur.pop() : null;
      while (cur.length && cur[cur.length - 1] === '') cur.pop();
      out.push(cur.join('\n'));
      cur = orphan ? [orphan] : [];
    }
    if (cur.length || line !== '') cur.push(line);
  }
  while (cur.length && cur[cur.length - 1] === '') cur.pop();
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const embedSize = (e) => (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text?.length ?? 0);

// The roadmap for Discord, as messages to send in order (the first one is the reply, the others follow it):
// `@Kira roadmap` and `/roadmap` → every area in the roadmap's order, one embed each (more when an area is long), its
// items by Now, Next, Later and Help wanted as titles linked to `<hub>#<id>`, Shipped as a count. With an area
// (`@Kira roadmap servers`): that area alone, every item with its plain words, and the shipped ones. No dates,
// ever: the roadmap has none. Every payload is { content?, embeds?, allowedMentions: { parse: [] } }.
export function roadmapMessages(roadmap, hubUrl, areaText = '') {
  const send = (content, embeds = []) => ({ content, ...(embeds.length ? { embeds } : {}), allowedMentions: { parse: [] } });
  if (!isRoadmap(roadmap)) return [send(`The roadmap is at ${hubUrl}: what's being done now, what's next, and how to help.`)];
  const area = areaText ? findArea(roadmap, areaText) : null;
  if (areaText && !area) {
    const names = (roadmap.areas ?? []).map((a) => `\`${a.id}\``).join(', ');
    return [send(`No area called "${plainText(areaText, 40)}". Areas: ${names || 'none yet'}. The whole roadmap: \`/roadmap\` or ${hubUrl}`)];
  }
  const known = new Set((roadmap.areas ?? []).map((a) => a.id));
  const areas = [...(roadmap.areas ?? []).filter((a) => a && typeof a.id === 'string')];
  if (!area && roadmap.items.some((i) => !known.has(i.area))) areas.push({ id: '', name: 'Other' });
  const embeds = [];
  for (const a of area ? [area] : areas) {
    const items = roadmap.items.filter((i) => (a.id ? i.area === a.id : !known.has(i.area)));
    if (!items.length) continue;
    const title = mdEscape(a.name ?? a.id, 200) || 'Other';
    const parts = pack(areaLines(items, hubUrl, !!area), LIMITS.description);
    parts.forEach((description, k) => embeds.push({ color: COLOR, title: parts.length > 1 ? `${title} (${k + 1}/${parts.length})` : title, description }));
  }
  const content = area
    ? `Everything in simple words, and how to help: <${hubUrl}> · the whole roadmap: \`/roadmap\``
    : `**Horizon's roadmap**: ${roadmap.items.filter((i) => i.status !== 'shipped').length} things planned or under way, ${roadmap.items.filter((i) => i.status === 'shipped').length} shipped. Each title opens it on the hub, in simple or technical words: <${hubUrl}> · one area in full: \`/roadmap area:<name>\``;
  if (!embeds.length) return [send(`Nothing planned in this area yet. The roadmap: <${hubUrl}>`)];
  const messages = [];
  let cur = [];
  let size = 0;
  for (const e of embeds) {
    if (cur.length && (cur.length >= LIMITS.embeds || size + embedSize(e) > LIMITS.total)) { messages.push(cur); cur = []; size = 0; }
    cur.push(e);
    size += embedSize(e);
  }
  messages.push(cur);
  return messages.map((list, k) => send(k === 0 ? content.slice(0, LIMITS.content) : '', list));
}

// One roadmap item by id ("status smooth-frames").
export function itemText(roadmap, hubUrl, id) {
  const item = isRoadmap(roadmap) && roadmap.items.find((i) => i.id === String(id).trim().toLowerCase());
  if (!item) return null;
  const shipped = item.status === 'shipped' && item.shipped_in ? ` in ${plainText(item.shipped_in, 40)}` : '';
  return `**${plainText(item.title, 100)}** · ${STATUS[item.status] ?? item.status}${shipped}\n${plainText(item.plain, 300)}\n<${itemUrl(hubUrl, item.id)}>`;
}

// A suggestion as the maintainers see it in the private queue (#roadmap-suggestions).
// `source`: where it came from, so the answer can go back there.
export function suggestionPost({ text, who, whoId, source, link }) {
  return {
    embeds: [{
      color: 0xf2a33a,
      title: '💡 Suggestion',
      description: plainText(text, 1500) || '*(no text)*',
      fields: [
        { name: 'From', value: `${plainText(who, 60)}${whoId ? ` (<@${whoId}>)` : ''}`, inline: true },
        { name: 'Where', value: link ? `${source} · ${link}` : source, inline: true },
      ],
      footer: { text: 'Triage: a good one becomes a roadmap item (a pull request to roadmap.toml), never an issue.' },
    }],
    allowedMentions: { parse: [] },
  };
}

// The bug report form (/report, and the button `@Kira report` answers with): the same fields as the hub's
// form, written as the #horizon-bugs template so the post reads like any other report.
export const REPORT_FIELDS = [
  { id: 'title', label: 'Title: what is broken, in a few words', style: 'short', max: 100, required: true },
  { id: 'steps', label: 'What did you do? (the steps)', style: 'paragraph', max: 1500, required: true },
  { id: 'happened', label: 'What happened, and what did you expect?', style: 'paragraph', max: 1500, required: true },
  { id: 'version', label: 'Horizon version (release or commit)', style: 'short', max: 60, required: false },
  { id: 'system', label: 'OS, CPU, GPU', style: 'short', max: 150, required: true },
];

// The report's text (the post's first message, after a "Reported by" line, and the issue's quoted text).
export function reportBody(fields) {
  const v = (k, n) => plainText(fields[k], n) || 'not given';
  return [
    `**What I did:**\n${v('steps', 1500)}`,
    `**What happened, and what I expected:**\n${v('happened', 1500)}`,
    `**Horizon version:** ${v('version', 60)}`,
    `**OS, CPU, GPU:** ${v('system', 150)}`,
  ].join('\n').slice(0, 1900);
}

// The roadmap is several long messages: outside #bot-commands it would flood the chat (Cosmic, 2026-10-29), so
// there only the person who asked sees it. With no #bot-commands channel known, it posts as before.
export function roadmapIsPrivate(channelId, botCommandsId) {
  return Boolean(botCommandsId) && channelId !== botCommandsId;
}

export function roadmapElsewhere(botCommandsId, hubUrl) {
  return `The roadmap is long, so I post it in <#${botCommandsId}> only. Run \`/roadmap\` here to see it just for you, or read it on ${hubUrl}.`;
}

export function helpText(hubUrl) {
  return [
    "I'm Kira, Horizon's front desk. The same things you can do on the hub:",
    '• `@Kira report` (or `/report`): a bug, which becomes a GitHub issue; you hear back in its post',
    '• `@Kira roadmap` (or `/roadmap`), `@Kira roadmap <area>`: the whole roadmap, or one area in full',
    '• `@Kira claim <issue>` (or `/claim`): tell everyone you are working on an issue',
    '• `@Kira status` (or `/status`): your claims and reports; `@Kira status #123` or `@Kira status <roadmap item>`',
    '• an idea: a post in #horizon-ideas, with its template; the maintainers read every one',
    `The hub: <${hubUrl}> · everything else: \`/help\``,
  ].join('\n');
}

// "@Kira suggest …": ideas are posts in #horizon-ideas now (Ludovic, 2026-10-30), so the votes and the talk stay with them.
export function ideasElsewhere(ideasId, hubUrl) {
  const where = ideasId ? `<#${ideasId}>` : '#horizon-ideas';
  return `💡 Ideas go in ${where}: one post per idea, with its template. Others vote 👍 there, and the maintainers read every one; the ones they pick become roadmap items (<${hubUrl}>).`;
}

// The open idea issues, for the one-off move to the roadmap (scripts/idea-issues.mjs): pull requests left out,
// the Discord votes read from the line Kira keeps in the body, oldest first.
export function ideaRows(issues, now = Date.now()) {
  return issues.filter((i) => !i.pull_request).map((i) => ({
    number: i.number,
    title: i.title,
    url: i.html_url,
    votes: Number(String(i.body ?? '').match(/👍 \*\*(\d+)\*\* on Discord/)?.[1] ?? NaN) || null,
    fromDiscord: (i.labels ?? []).some((l) => (l.name ?? l) === 'from-discord'),
    days: Math.floor((now - Date.parse(i.created_at)) / 86_400_000),
  })).sort((a, b) => a.number - b.number);
}
