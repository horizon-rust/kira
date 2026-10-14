// The work board's texts and claim rules, with no Discord and no network, so they can be tested: a pull
// request's status (draft, CI, review), when a claim is due for a reminder or lapses, the text of each
// column of the board and of the #dev-log lines. The board itself (cards, columns, moves) is src/board.js;
// src/features/workboard.js does the talking.
import { COLUMNS } from './board.js';
export { fixesIn } from './board.js';

export const DAY = 86_400_000;
export const MARK = '<!-- kira:work -->'; // in Kira's own issue comments, so they never count as activity

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
// One line, then cut (titles come from GitHub and from Kira's cards).
const short = (s, n = 70) => {
  const t = String(s ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const esc = (s) => String(s).replace(/([\\*_~`|[\]])/g, '\\$1');
// A link that doesn't unfurl into an embed.
const link = (text, url) => `[${text}](<${url}>)`;

// One card, one line: the link, who, labels, its pull requests and their status, and when.
export function cardLine(card, now = Date.now()) {
  const who = card.people?.length ? card.people.map((p) => `${p.claimed ? '🔨 ' : ''}**${esc(p.name)}**`).join(', ') : null;
  const prs = (card.prs ?? []).map((p) => `🔀 ${link(`#${p.number}`, p.url)}${p.status && p.state === 'open' ? ` ${p.status}` : ''}`);
  const when = card.column === 'done' ? (card.kind === 'pr' || card.closedAs === 'completed' ? (card.kind === 'pr' ? 'merged ' : 'closed ') + ts(Date.parse(card.updatedAt)) : `closed as ${card.closedAs?.replace('_', ' ')}`)
    : card.claim ? `since ${ts(Date.parse(card.claim.since))}` : null;
  const lapses = card.claim?.lapses && Date.parse(card.claim.lapses) - now < 4 * DAY ? `lapses ${ts(Date.parse(card.claim.lapses))}` : null;
  return [
    card.kind === 'card'
      ? `• 🗂️ ${card.url ? link(`${esc(short(card.title, 60))}`, card.url) : esc(short(card.title, 60))} \`card#${card.number}\``
      : `• ${card.kind === 'pr' ? '🔀 ' : ''}${link(`#${card.number} ${esc(short(card.title, 60))}`, card.url)}`,
    who,
    card.labels?.length ? card.labels.slice(0, 4).map((l) => `\`${l.replace(/`/g, "'")}\``).join(' ') : null,
    card.kind === 'pr' && card.status && card.state === 'open' ? card.status : null,
    ...prs, when, lapses,
    card.moved ? `📌 moved by ${esc(card.moved.by)}` : null,
    card.notes?.length && card.column !== 'done' ? `📝 ${esc(short(card.notes.at(-1).text.replace(/\s+/g, ' '), 80))}` : null,
  ].filter(Boolean).join(' · ');
}

// One column of the board, as an embed: { title, description, color, footer }. Cut to fit ("…and N more").
export function columnText(column, now = Date.now(), max = 3900) {
  const spec = COLUMNS.find((c) => c.key === column.key);
  const lines = column.cards.map((c) => cardLine(c, now));
  let description = lines.length ? '' : `*${spec.about}*
Nothing here right now.`;
  for (let n = lines.length; n > 0; n--) {
    const text = [...lines.slice(0, n), ...(n < lines.length ? [`…and ${lines.length - n} more on GitHub`] : [])].join('\n');
    if (text.length <= max) { description = text; break; }
  }
  return {
    title: `${spec.emoji} ${spec.name} (${column.cards.length})`,
    description,
    color: spec.color,
    footer: lines.length ? spec.about : null,
  };
}

// The #dev-log lines (plain names: nobody is pinged).
export const logLine = {
  opened: (p) => `🟢 **${esc(p.who)}** opened ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)}${p.fixes?.length ? ` (fixes ${p.fixes.map((n) => `#${n}`).join(', ')})` : ''}`,
  merged: (p) => `🟣 ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)} by **${esc(p.who)}** was merged`,
  claimed: (c) => `🔨 **${esc(c.who)}** claimed ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)}`,
  moved: (c) => `📌 **${esc(c.who)}** moved ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)} to ${c.to}`,
  unclaimed: (c) => `↩️ **${esc(c.who)}** unclaimed ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)}: it's free again`,
  expired: (c, days) => `⌛ **${esc(c.who)}**'s claim on ${link(`#${c.number} ${esc(short(c.title, 90))}`, c.url)} lapsed after ${days} days without activity: it's free again`,
};

// A Discord name in a GitHub comment: in a code span, so no @mention, link or Markdown in it works (L5).
export const githubName = (who) => `\`${String(who).replace(/[`\r\n]/g, "'").slice(0, 40).trim() || 'someone'}\``;

// The GitHub comments Kira leaves on a claimed issue.
export const claimComment = (who, login, n, days) =>
  `Claimed by ${githubName(who)} on Discord${login ? ` (GitHub: \`${login}\`)` : ''}, to avoid duplicate work. The claim lapses after ${days} days without activity (a comment, a pull request or a commit mentioning #${n}).\n${MARK}`;
export const unclaimComment = (who, why) => `${why === 'expired' ? `The claim by ${githubName(who)} lapsed` : `Unclaimed by ${githubName(who)} on Discord`}: this issue is free to take.\n${MARK}`;

// How long until an issue may be claimed or unclaimed again (ms, 0 = now): each one writes a label and a
// comment on GitHub in Kira's name, so they can't be toggled in a loop (H1).
export const cooldownLeft = (lastAt, now, ms) => (lastAt ? Math.max(0, lastAt + ms - now) : 0);

// Remembers numbers already announced, newest first, at most `keep`.
export const remember = (list = [], n, keep = 300) => [n, ...list.filter((x) => x !== n)].slice(0, keep);

// ── Notices: CI failures, reviews waiting, the weekly digest ────────────────────

// Open pull requests whose CI now fails on a head commit not reported yet. `seen`: number → the failing
// sha last reported. Returns { report, seen } (a new `seen`: passing or closed pull requests are forgotten,
// so a later failure is reported again). The first time (`seen` undefined) nothing is reported.
export function ciChanges(open, seen) {
  const next = {};
  const report = [];
  for (const p of open) {
    if (p.ci !== 'failing') continue;
    next[p.number] = p.sha;
    if (seen && seen[p.number] !== p.sha) report.push(p);
  }
  return { report, seen: next };
}

// Ready (not draft) pull requests with no review at all, open for `waitMs`, not reminded in `waitMs`.
// `pinged`: number → last reminder (ms). The first time, every open one counts as just reminded.
export function reviewsDue(open, pinged, now, waitMs) {
  const next = {};
  const due = [];
  for (const p of open) {
    if (p.draft || p.reviews > 0) continue;
    const last = pinged ? pinged[p.number] ?? 0 : now;
    next[p.number] = last;
    if (now - p.createdAt >= waitMs && now - last >= waitMs) { due.push(p); next[p.number] = now; }
  }
  return { due, pinged: next };
}

// The start of the week's digest slot at or before `now` (UTC): `weekday` 0 = Sunday, at `hour`.
export function digestSlot(now, { weekday, hour }) {
  const d = new Date(now);
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() - weekday + 7) % 7), hour);
  return slot > now ? slot - 7 * DAY : slot;
}

// Parity from Horizon's README: the "vanilla parity" badge and the number of harnesses.
export function parityFrom(readme) {
  const pct = String(readme ?? '').match(/vanilla(?:%20|\s|-|_)parity-(\d+(?:\.\d+)?)%25/i);
  const harnesses = String(readme ?? '').match(/(\d+)\s+(?:differential\s+)?parity harnesses/i);
  return { percent: pct ? Number(pct[1]) : null, harnesses: harnesses ? Number(harnesses[1]) : null };
}

// The weekly digest: { title, description } for an embed. Lists cut to fit.
export function digestText({ merged, opened, releases, parity, goodFirst, days = 7 }) {
  const list = (items, line, empty, max = 8) => (items.length
    ? [...items.slice(0, max).map(line), ...(items.length > max ? [`…and ${items.length - max} more`] : [])].join('\n')
    : empty);
  const parityLine = parity?.percent != null ? `**Vanilla parity: ${parity.percent}%**${parity.harnesses ? ` of ${parity.harnesses} harnesses` : ''}` : null;
  const description = [
    parityLine,
    `**✅ Merged (${merged.length})**\n${list(merged, (p) => `• ${link(`#${p.number} ${esc(short(p.title))}`, p.url)} by **${esc(p.who)}**`, 'Nothing merged this week.')}`,
    `**🆕 New issues (${opened.length})**\n${list(opened, (i) => `• ${link(`#${i.number} ${esc(short(i.title))}`, i.url)}`, 'None.')}`,
    `**📦 Releases (${releases.length})**\n${list(releases, (r) => `• ${link(esc(r.name || r.tag), r.url)}`, 'None this week.', 5)}`,
    `**🌱 Good first tasks**\n${list(goodFirst, (c) => `• ${link(`#${c.number} ${esc(short(c.title))}`, c.url)}`, 'None labelled right now.', 5)}${goodFirst.length ? '\nNew here? `/claim` one, or `/goodfirst` any time.' : ''}`,
  ].filter(Boolean).join('\n\n');
  return { title: `🗓️ Horizon this week (last ${days} days)`, description: description.slice(0, 4000) };
}

// The #dev-log lines for those notices (no pings).
export const noticeLine = {
  ciFailing: (p) => `❌ CI is failing on ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)} by **${esc(p.who)}**`,
  reviewWaiting: (p, days) => `👀 ${link(`#${p.number} ${esc(short(p.title, 90))}`, p.url)} by **${esc(p.who)}** has waited ${days} days for a review`,
};
