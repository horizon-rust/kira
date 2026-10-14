// The work board's logic, with no Discord and no network, so it can be tested: what a pull request
// says it fixes, its status (draft, CI, review), when a claim is due for a reminder or lapses, and the
// text of the board and of the #dev-log lines. src/features/workboard.js does the talking.

export const DAY = 86_400_000;
export const MARK = '<!-- kira:work -->'; // in Kira's own issue comments, so they never count as activity

// "Fixes #12", "closes #3, resolves #4": the issues a pull request closes when it is merged.
export function fixesIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+((?:#\d+(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out].sort((a, b) => a - b);
}

// One word for a commit's checks: check runs (GitHub Actions) and the older commit statuses together.
export function ciState(checkRuns = [], statuses = []) {
  const results = [
    ...checkRuns.map((r) => (r.status !== 'completed' ? 'running' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'passing' : 'failing')),
    ...statuses.map((s) => (s.state === 'pending' ? 'running' : s.state === 'success' ? 'passing' : 'failing')),
  ];
  if (!results.length) return 'none';
  if (results.includes('failing')) return 'failing';
  if (results.includes('running')) return 'running';
  return 'passing';
}

// The latest review of each reviewer decides: changes requested beats approved.
export function reviewState(reviews = []) {
  const last = new Map();
  for (const r of reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) last.set(r.user?.login, r.state);
  const states = [...last.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes';
  if (states.includes('APPROVED')) return 'approved';
  return 'none';
}

// What the board says about an open pull request.
export function prStatus({ draft, ci, review }) {
  if (draft) return '📝 draft';
  if (ci === 'failing') return '❌ CI failing';
  if (ci === 'running') return '⏳ CI running';
  if (review === 'changes') return '✏️ changes requested';
  if (review === 'approved') return '👍 approved';
  return ci === 'passing' ? '✅ CI passed · in review' : '👀 in review';
}

// A claim lapses `expireDays` after its last activity; the reminder comes `remindDays` before that, once.
export function claimDue(claim, now, { expireDays, remindDays }) {
  const idle = now - Math.max(claim.since, claim.activity ?? 0);
  if (idle >= expireDays * DAY) return 'expire';
  if (idle >= (expireDays - remindDays) * DAY && !(claim.reminded >= Math.max(claim.since, claim.activity ?? 0))) return 'remind';
  return null;
}

// When a claim lapses (ms), from its last activity.
export const lapsesAt = (claim, expireDays) => Math.max(claim.since, claim.activity ?? 0) + expireDays * DAY;

// The latest activity on an issue from its timeline: comments (not Kira's own), commits and pull
// requests that mention it. Labels and assignments don't count: Kira makes those itself.
export function lastActivity(timeline = []) {
  let at = 0;
  for (const e of timeline) {
    const kind = e.event;
    if (kind === 'commented' && (e.body ?? '').includes(MARK)) continue;
    if (!['commented', 'cross-referenced', 'referenced', 'committed'].includes(kind)) continue;
    const t = Date.parse(e.created_at ?? e.committer?.date ?? '');
    if (t > at) at = t;
  }
  return at;
}

const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const esc = (s) => String(s).replace(/([\\*_~`|[\]])/g, '\\$1');
// A link that doesn't unfurl into an embed.
const link = (text, url) => `[${text}](<${url}>)`;

// Lines under a heading, cut so the section fits in `max` characters ("…and N more").
function section(title, lines, empty, max) {
  const head = `**${title}**`;
  if (!lines.length) return `${head}\n${empty}`;
  for (let n = lines.length; n > 0; n--) {
    const text = [head, ...lines.slice(0, n), ...(n < lines.length ? [`…and ${lines.length - n} more`] : [])].join('\n');
    if (text.length <= max) return text;
  }
  return head;
}

// The board: { title, description, footer } for an embed.
// claims: [{ number, title, url, who, since, prs: [numbers], lapses, githubOnly }]
// prs: [{ number, title, url, who, status, fixes: [numbers] }] · merged: [{ number, title, url, who, at }]
export function boardText({ claims, prs, merged, mergedDays, now }) {
  const claimLines = claims.map((c) => [
    `• ${link(`#${c.number} ${esc(short(c.title))}`, c.url)}: **${esc(c.who)}**`,
    c.githubOnly ? 'labelled on GitHub' : `since ${ts(c.since)}`,
    c.prs?.length ? `PR ${c.prs.map((n) => `#${n}`).join(', ')}` : null,
    c.lapses && c.lapses - now < 4 * DAY ? `lapses ${ts(c.lapses)}` : null,
  ].filter(Boolean).join(' · '));
  const prLines = prs.map((p) => [
    `• ${link(`#${p.number} ${esc(short(p.title))}`, p.url)}: **${esc(p.who)}**`,
    p.status,
    p.fixes?.length ? `fixes ${p.fixes.map((n) => `#${n}`).join(', ')}` : null,
  ].filter(Boolean).join(' · '));
  const mergedLines = merged.map((m) => `• ${link(`#${m.number} ${esc(short(m.title))}`, m.url)}: **${esc(m.who)}** · ${ts(m.at)}`);
  const description = [
    section('🔨 Claimed issues', claimLines, 'Nobody yet. Run `/claim <issue number>` before you start on one.', 1400),
    section('🔀 Open pull requests', prLines, 'None right now.', 1400),
    section(`✅ Merged in the last ${mergedDays} days`, mergedLines, 'Nothing yet.', 1200),
  ].join('\n\n');
  return {
    title: "🛠️ Who's working on what",
    description,
    footer: 'Refreshed from GitHub every 10 minutes · /claim before you start an issue · /working · /link-github',
  };
}

// The #dev-log lines (plain names: nobody is pinged).
export const logLine = {
  opened: (p) => `🟢 **${esc(p.who)}** opened ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)}${p.fixes?.length ? ` (fixes ${p.fixes.map((n) => `#${n}`).join(', ')})` : ''}`,
  merged: (p) => `🟣 ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)} by **${esc(p.who)}** was merged`,
  claimed: (c) => `🔨 **${esc(c.who)}** claimed ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)}`,
  unclaimed: (c) => `↩️ **${esc(c.who)}** unclaimed ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)}: it's free again`,
  expired: (c, days) => `⌛ **${esc(c.who)}**'s claim on ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)} lapsed after ${days} days without activity: it's free again`,
};

// The GitHub comments Kira leaves on a claimed issue.
export const claimComment = (who, login, n, days) =>
  `Claimed by **${who}** on Discord${login ? ` (GitHub: \`${login}\`)` : ''}, to avoid duplicate work. The claim lapses after ${days} days without activity (a comment, a pull request or a commit mentioning #${n}).\n${MARK}`;
export const unclaimComment = (who, why) => `${why === 'expired' ? `The claim by **${who}** lapsed` : `Unclaimed by **${who}** on Discord`}: this issue is free to take.\n${MARK}`;

// Remembers numbers already announced, newest first, at most `keep`.
export const remember = (list = [], n, keep = 300) => [n, ...list.filter((x) => x !== n)].slice(0, keep);
