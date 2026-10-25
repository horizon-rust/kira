// The hub (playhorizon.dev/hub) as Kira reads it: the roadmap and the journal the website publishes as JSON
// (the horizon repo's roadmap/README.md documents both), and the texts of the verbs Kira shares with the site
// (report, suggest, roadmap, claim, status). No Discord here: src/features/hub.js does the talking.

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

const line = (item, hubUrl) => `• **[${plainText(item.title, 100)}](<${itemUrl(hubUrl, item.id)}>)**: ${plainText(item.plain, 240)}`;

// `@Kira roadmap` and `/roadmap`: Now and Next in players' words, with the link. With an area: that area's
// Now, Next and Help wanted. No dates, ever: the roadmap has none.
export function roadmapText(roadmap, hubUrl, areaText = '') {
  if (!isRoadmap(roadmap)) return `The roadmap is at ${hubUrl}: what's being done now, what's next, and how to help.`;
  const items = roadmap.items;
  const area = areaText ? findArea(roadmap, areaText) : null;
  if (areaText && !area) {
    const names = (roadmap.areas ?? []).map((a) => `\`${a.id}\``).join(', ');
    return `No area called "${plainText(areaText, 40)}". Areas: ${names || 'none yet'}. The whole roadmap: ${hubUrl}`;
  }
  const pick = (status, max) => items.filter((i) => i.status === status && (!area || i.area === area.id)).slice(0, max);
  const now = area ? pick('now', 6) : (() => {
    const focus = items.filter((i) => i.status === 'now' && i.focus);
    return (focus.length ? focus : pick('now', 5)).slice(0, 5);
  })();
  const sections = [
    [area ? `🔨 Now in ${area.name ?? area.id}` : '🔨 Now', now],
    ['⏭️ Next', pick('next', area ? 5 : 4)],
    ...(area ? [['🙋 Help wanted', pick('help-wanted', 4)]] : []),
  ].filter(([, list]) => list.length);
  const body = sections.map(([title, list]) => `**${title}**\n${list.map((i) => line(i, hubUrl)).join('\n')}`).join('\n\n');
  const tail = `Everything, in simple or technical words, and how to help: <${hubUrl}>${area ? '' : '\nOne area: `/roadmap area:<name>`.'}`;
  const text = `${body || 'Nothing planned in this area yet.'}\n\n${tail}`;
  return text.length <= 1990 ? text : `${body.slice(0, 1990 - tail.length - 4)}…\n\n${tail}`;
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

export function helpText(hubUrl) {
  return [
    "I'm Kira, Horizon's front desk. The same things you can do on the hub:",
    '• `@Kira report` (or `/report`): a bug, which becomes a GitHub issue; you hear back in its post',
    '• `@Kira suggest <your idea>` (or `/suggest`): an idea, which goes to the suggestion queue',
    '• `@Kira roadmap` (or `/roadmap`), `@Kira roadmap <area>`: what is being done now and next',
    '• `@Kira claim <issue>` (or `/claim`): tell everyone you are working on an issue',
    '• `@Kira status` (or `/status`): your claims and reports; `@Kira status #123` or `@Kira status <roadmap item>`',
    `The hub: <${hubUrl}> · everything else: \`/help\``,
  ].join('\n');
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
