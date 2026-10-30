// The GitHub issues feature's logic, with no Discord and no network: what goes in an issue, what is
// noise, rate limits, batching, close reasons, release lookup. The Discord side is features/github.js.

export const MINUTE = 60_000;
export const MARK = '<!-- kira -->'; // on every comment Kira writes, so they're never relayed back to Discord
const VOTES = '<!-- kira:votes -->';

// Discord text made safe to put in an issue: no HTML, no @mentions, no #refs or issue links (no
// pings, no closing keywords, no cross-references), no Discord IDs, and a length cap.
export function neutralise(text, max = 4000) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/<a?:(\w+):\d+>/g, ':$1:') // custom emoji
    .replace(/<@!?\d+>/g, '(a member)').replace(/<@&\d+>/g, '(a role)').replace(/<#\d+>/g, '(a channel)')
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`/g, "'")
    // github.com/owner/repo/issues/12 and pull/12: shown, but not linked (a link cross-references the issue)
    .replace(/https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull|discussions)\/\d+\S*/gi, (m) => `\`${m}\``)
    .replace(/(^|[^\w`/])((?:[\w.-]+\/[\w.-]+)?#\d+|GH-\d+)\b/gi, '$1`$2`') // #12, owner/repo#12
    .replace(/(^|[^\w`])@([a-z\d](?:[a-z\d-]{0,38}))/gi, '$1`@$2`') // @user, @org/team
    .replace(/\b(clos|fix|resolv)(e[sd]?|es)?\b/gi, (m) => `${m[0]}​${m.slice(1)}`); // closing keywords
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s.trim();
}

// A title: one line, no markup that GitHub or Discord would act on.
export const safeTitle = (text) => neutralise(String(text ?? '').replace(/\s+/g, ' '), 200)
  .replace(/`/g, '').replace(/@(?=\w)/g, '@\u200b').replace(/#(?=\d)/g, '#\u200b') || 'Report from Discord';

// Text as a markdown quote, every line prefixed.
export const quote = (text) => text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n');

export const votesLine = (n) => `${VOTES}👍 **${n}** on Discord`;

// Replaces (or adds) the votes line in an issue body, keeping everything else as it is.
export function withVotes(body, n) {
  const line = votesLine(n);
  const re = new RegExp(`${VOTES}.*`);
  return re.test(body ?? '') ? body.replace(re, line) : `${body ?? ''}\n\n${line}`;
}

// The body of a new issue: the post quoted, who posted it (display name only), the thread, the
// attachments as links.
// `notes`: the version and OS Kira copied word for word from the report (src/ai-kit.js checkBugDraft), shown above
// it; `related`: an open issue that may be the same bug (the reporter didn't say).
export function issueBody({ text, author, forum, threadUrl, tags = [], attachments = [], votes = null, notes = null, related = null }) {
  const lines = [
    ...(notes?.version || notes?.os ? [`**Version:** ${neutralise(notes.version, 120) || 'not given'} · **OS:** ${neutralise(notes.os, 120) || 'not given'} <sub>(copied from the report)</sub>`, ''] : []),
    quote(neutralise(text, 6000) || '(no text)'),
    '',
    `Reported on Discord by **${neutralise(author, 64).replace(/[*_~|]/g, '') || 'a member'}** in #${forum} · [Discord thread](${threadUrl})`,
  ];
  if (tags.length) lines.push(`Tags: ${tags.map((t) => neutralise(t, 40)).join(', ')}`);
  if (related) lines.push(`Kira's search found an open issue that might be related: #${Number(related)} (the reporter didn't say).`);
  if (attachments.length) {
    lines.push('', '**Attachments** (Discord links expire after a while; the thread keeps them)');
    for (const a of attachments.slice(0, 10)) lines.push(`- [${neutralise(a.name, 100).replace(/[[\]]/g, '')}](${a.url})`);
  }
  if (votes !== null) lines.push('', votesLine(votes));
  lines.push('', `<sub>Opened by Kira from Discord. Replies from the reporter in the thread are added here as comments.</sub>${MARK}`);
  return lines.join('\n');
}

// A batch of follow-ups from the reporter, as one comment.
export function followupComment(author, items) {
  const parts = items.map((i) => {
    const files = (i.files ?? []).map((f) => `- [${neutralise(f.name, 100).replace(/[[\]]/g, '')}](${f.url})`);
    return [quote(neutralise(i.text, 3000) || '(no text)'), ...(files.length ? ['', ...files] : [])].join('\n');
  });
  return [`**${neutralise(author, 64).replace(/[*_~|]/g, '')}** added on Discord:`, '', parts.join('\n\n'), '', MARK].join('\n');
}

// A report added to an existing issue (the same bug): the post quoted, with its attachments.
export function reportComment({ author, threadUrl, text, attachments = [] }) {
  const files = attachments.slice(0, 10).map((a) => `- [${neutralise(a.name, 100).replace(/[[\]]/g, '')}](${a.url})`);
  return [`Also reported on Discord by **${neutralise(author, 64).replace(/[*_~|]/g, '')}**: [Discord thread](${threadUrl})`, '', quote(neutralise(text, 4000) || '(no text)'), ...(files.length ? ['', ...files] : []), '', MARK].join('\n');
}

export const linkComment = (author, threadUrl) =>
  `Also reported on Discord by **${neutralise(author, 64).replace(/[*_~|]/g, '')}**: [Discord thread](${threadUrl})\n${MARK}`;

export const isOwnComment = (c) => (c.body ?? '').includes(MARK);

// Replies that add nothing: "+1", "same", "bump", thanks, emoji only. Files always add something.
const ME_TOO = /^(\+\s*1|same( here| issue| problem| for me| bug)?|me too|bump|up+|any (news|updates?)|thanks?( you)?|thx|ty|ok(ay)?|lol|yes|yep|yeah|nice|cool|this|agreed?|great idea|good idea)[\s!.?]*$/i;
export function isNoise(text, files = 0) {
  if (files) return false;
  const t = String(text ?? '').replace(/<a?:\w+:\d+>/g, '').replace(/<@!?\d+>/g, '').trim();
  const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
  return letters.length < 8 || ME_TOO.test(t);
}

// Issue creation rate limit. `log` is [{ user, at }] (kept in the state); records the creation if allowed.
export function allow(log, user, now, { perUser = 3, global = 20, windowMs = 60 * MINUTE } = {}) {
  const recent = log.filter((e) => now - e.at < windowMs);
  log.splice(0, log.length, ...recent);
  if (recent.length >= global || recent.filter((e) => e.user === user).length >= perUser) return false;
  log.push({ user, at: now });
  return true;
}

// Follow-ups from the reporter: queued, then sent as one comment at most every 10 minutes, once the
// reporter has stopped typing for a minute.
export function queueFollowup(entry, item, now) {
  (entry.followups ??= []).push({ ...item, at: now });
}
export function takeFollowups(entry, now, { every = 10 * MINUTE, quiet = MINUTE } = {}) {
  const q = entry.followups ?? [];
  if (!q.length || now - (entry.lastFollowupAt ?? 0) < every || now - q[q.length - 1].at < quiet) return null;
  entry.followups = [];
  entry.lastFollowupAt = now;
  return q;
}

// Answers for the reporter (maintainer comments, closes): one message with one ping per answer. Comments
// are held for 10 minutes from the first, so a burst becomes one message; a close sends everything now.
export function queueAnswer(entry, item, now) {
  const a = (entry.answers ??= { items: [], firstAt: null });
  if (!a.items.length) a.firstAt = now;
  a.items.push(item);
}
export function takeAnswers(entry, now, { window = 10 * MINUTE, force = false } = {}) {
  const a = entry.answers;
  if (!a?.items.length || (!force && now - a.firstAt < window)) return null;
  const items = a.items;
  entry.answers = { items: [], firstAt: null };
  return items;
}

// A message that pings exactly one user (or nobody, if they left the server).
export function mentionPayload(userId, text) {
  return userId
    ? { content: `<@${userId}> ${text}`.slice(0, 2000), allowedMentions: { parse: [], users: [userId], repliedUser: false } }
    : { content: text.slice(0, 2000), allowedMentions: { parse: [], users: [], repliedUser: false } };
}

// Who may answer on Discord's behalf: Ludovic and the repo's collaborators.
export const isMaintainer = (c, owner = 'ludovic111') =>
  c.user?.login === owner || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.author_association);

// GitHub markdown made readable in Discord (comments relayed to the thread).
export function forDiscord(md, max = 1500) {
  let s = String(md ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\r/g, '').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

// How an issue was closed: fixed, not planned, or duplicate (of which issue, if a comment says so).
export function closeOutcome(issue, comments = []) {
  const said = comments.map((c) => c.body ?? '').join('\n');
  const dup = said.match(/duplicate (?:of|in)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/i) ?? (issue.state_reason === 'duplicate' ? said.match(/#(\d+)/) : null);
  if (issue.state_reason === 'duplicate' || (issue.state_reason === 'not_planned' && /duplicate (of|in)/i.test(said))) {
    return { kind: 'duplicate', of: dup ? Number(dup[1]) : null };
  }
  if (issue.state_reason === 'not_planned') return { kind: 'not_planned' };
  return { kind: 'fixed' };
}

// The commit that fixed an issue, from its timeline: a closing commit, else the last merged PR of the
// same repo that referenced it (the PR's merge commit is looked up by the caller).
export function fixSource(timeline, repoFullName) {
  const closed = timeline.filter((e) => e.event === 'closed').pop();
  if (closed?.commit_id) return { commit: closed.commit_id };
  const prs = timeline.filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request?.merged_at
    && e.source.issue.repository?.full_name?.toLowerCase() === repoFullName.toLowerCase());
  const pr = prs.pop();
  return pr ? { pr: pr.source.issue.number } : null;
}

// The first published release containing a commit. `contains(tag)` answers with the compare API.
export async function firstRelease(releases, contains) {
  const published = releases.filter((r) => !r.draft).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
  for (const r of published) if (await contains(r.tag_name)) return r;
  return null;
}

// Where a forum post goes: { repo, kind } or null. `spec` is the forum's entry in GITHUB.forums.
export function targetFor(spec, tagNames) {
  if (!spec) return null;
  if (spec.repo) return { repo: spec.repo, kind: spec.kind };
  const project = Object.keys(spec.projects ?? {}).find((t) => tagNames.includes(t));
  const kind = Object.entries(spec.kinds ?? {}).find(([t]) => tagNames.includes(t))?.[1];
  return project && kind ? { repo: spec.projects[project], kind } : null;
}

// The Discord message for a batch of answers. `items`: { type: 'comment', author, body, url } or
// { type: 'closed', outcome, release, commitKnown, issueUrl, dupUrl }.
export function answerText(items, issueRef) {
  const out = [];
  const closed = items.find((i) => i.type === 'closed');
  if (closed) {
    const o = closed.outcome;
    if (o.kind === 'fixed') {
      out.push(closed.release ? `✅ **Fixed in ${closed.release.tag_name}**: ${closed.release.html_url}`
        : closed.commitKnown ? '✅ **Fixed.** It will be in the next release.' : '✅ **Fixed.**');
    } else if (o.kind === 'duplicate') {
      out.push(`🔁 **Closed as a duplicate**${o.of ? ` of ${closed.dupUrl ?? `#${o.of}`}` : ''}.`);
    } else {
      out.push('❌ **Closed as not planned.**');
    }
  }
  const comments = items.filter((i) => i.type === 'comment');
  for (const c of comments) out.push(`💬 **${c.author}** on GitHub:\n${quote(forDiscord(c.body, Math.floor(1500 / comments.length)))}`);
  if (closed && closed.outcome.kind !== 'fixed' && !comments.length) out.push('(No reason given on GitHub.)');
  out.push(`-# ${issueRef}`);
  return out.join('\n');
}

// ── Help requests posted as bugs (Ludovic, 2026-10-30: #horizon-bugs is for reproducible bugs only) ─────────────────

// "Can't launch", "won't start", "how do I…", sign-in trouble, low FPS: a request for help, which belongs in
// #horizon-support. A post with a tag about the game itself (crash, rendering, gameplay…), or that names a crash, a
// panic or a wrong result in the game, is a bug. Kira only points the post to #horizon-support; the poster can still
// say it's a bug.
const HELP = [
  /\b(horizon|the game|game|launcher|it|minecraft)\s+(can'?t|cannot|won'?t|doesn'?t|does not|isn'?t|is not)\s+(even\s+)?(launch|start|open|run|install|update)/i,
  /\bi\s+(can'?t|cannot|can not|am unable to|am not able to)\s+(even\s+)?(launch|start|run|play|install|download|update|log ?in|sign ?in|login|join|connect)\b/i,
  /\b(horizon|the game|game|launcher|it)\s+(is\s+)?not (launching|starting|opening|working)\b/i,
  /^\s*(how|why|where|what|can|is|does|do)\b[^\n]*\?\s*$/im,
  /\b(how do i|how can i|how to|need help|please help|help me)\b/i,
  /\b(low|bad|poor|terrible)\s+(fps|frame ?rate|performance)\b/i,
  /\b(sign[- ]?in|log[- ]?in|login|microsoft account|account)\b[^\n]{0,40}\b(error|fail\w*|problem|issue|not work\w*|broken)\b/i,
];
const GAME_BUG = /\b(crash\w*|panic\w*|stack ?trace|exception|segfault|glitch\w*|desync\w*|duplicat\w*|renders?|rendering|flicker\w*|instead of)\b/i;
const HELP_TAGS = new Set(['install / launch', 'performance']); // a game tag (crash, rendering…) means a bug

export function looksLikeHelp(title, text, tags = []) {
  if (tags.some((t) => !HELP_TAGS.has(t) && t !== 'via /report')) return false;
  const all = `${title ?? ''}\n${text ?? ''}`;
  if (GAME_BUG.test(all)) return false;
  return HELP.some((re) => re.test(all));
}

export const helpPointer = (supportId, userId) =>
  `🤝 This looks like a request for help rather than a bug in the game, so I haven't sent it to GitHub. Ask in ${supportId ? `<#${supportId}>` : '#horizon-support'}: Kira gives a first answer there and 🤝 Support helps. <@${userId}>, if it is a bug you can make happen again (with the steps), reply **bug** here and I'll send it to GitHub.`;
