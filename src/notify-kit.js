// /notify, with no Discord: what a GitHub webhook delivery means for the author of a pull request or issue, the
// one-line texts, the batching of a member's DMs, and the merge-conflict transitions. src/features/notify.js does the
// talking (Discord, the webhook route, the state).
//
// Every text people wrote on GitHub (titles, comments, logins, labels) is data: plain() strips what Discord would
// read as Markdown, a mention or a masked link before it goes in a DM.
import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// One line of plain text: no Markdown, no mentions, no masked links, no line breaks, at most `max` characters.
export function plain(text, max = 80) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\\*_~|`[\]()<>]/g, '')
    .replace(/@/g, '@​')
    .replace(/https?:\/\/\S+/g, '(link)')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
// A link Discord shows without an embed; only https GitHub links of the watched repos get through.
export const link = (url) => (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/\d+(#[\w-]+)?$/.test(String(url ?? '')) ? `<${url}>` : '');

// ── The webhook's signature ──────────────────────────────────────────────────

// GitHub signs each delivery with the hook's secret: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(body).
export function signatureOk(secret, body, header) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── What a delivery means ────────────────────────────────────────────────────

// The pull request or issue a delivery is about: { repo, number, kind, title, url, author }.
function itemOf(p) {
  const pr = p.pull_request;
  const issue = p.issue;
  const it = pr ?? issue;
  if (!it || !p.repository?.name) return null;
  return {
    repo: p.repository.name,
    number: it.number,
    kind: pr || issue?.pull_request ? 'PR' : 'issue',
    title: it.title,
    url: it.html_url,
    author: it.user?.login,
  };
}
const ref = (it) => `${it.kind} #${it.number} ${plain(it.title, 60)}`;
const where = (it) => (it.repo === 'horizon' ? '' : ` (${it.repo})`);

// A delivery → the events it holds for the item's author: [{ author, key, line }]. `key` names the event: two with
// the same key in one batch are one line. Nothing for what the author did themselves, nor for bots' comments.
// `opts.labels`: the labels worth a DM; `opts.checks`: repo → the check names worth a DM when they fail.
export function eventsOf(name, p, opts = {}) {
  const sender = p.sender?.login;
  const bot = p.sender?.type === 'Bot' || /\[bot\]$/i.test(sender ?? '');
  if (name === 'check_run') return []; // needs the pull request behind the head: checkFailure()
  const it = itemOf(p);
  if (!it || !it.author) return [];
  if (same(sender, it.author)) return [];
  const who = `**${plain(sender, 39) || 'someone'}**`;
  const at = `${ref(it)}${where(it)}`;
  const one = (key, line, url = it.url) => [{ author: it.author, key: `${it.repo}#${it.number}:${key}`, line: `${line} ${link(url) || link(it.url)}`.trim(), repo: it.repo, number: it.number }];

  if (name === 'issue_comment' && p.action === 'created') {
    if (bot) return [];
    const said = plain(p.comment?.body, 90);
    return one(`comment:${p.comment?.id}`, `💬 ${who} commented on ${at}${said ? `: “${said}”` : ''}`, p.comment?.html_url);
  }
  if (name === 'pull_request_review' && p.action === 'submitted') {
    if (bot && !p.review?.body) return [];
    const state = String(p.review?.state ?? '').toLowerCase();
    const said = plain(p.review?.body, 90);
    if (state === 'approved') return one(`approved:${sender}`, `✅ ${who} approved ${at}${said ? `: “${said}”` : ''}`, p.review?.html_url);
    if (state === 'changes_requested') return one(`changes:${sender}`, `🔁 ${who} requested changes on ${at}${said ? `: “${said}”` : ''}`, p.review?.html_url);
    // A reply in a review thread is a review of its own: one line per reviewer per batch.
    return one(`review:${sender}`, `💬 ${who} reviewed ${at}${said ? `: “${said}”` : ''}`, p.review?.html_url);
  }
  if (name === 'pull_request' || name === 'issues') {
    if (p.action === 'closed') {
      if (p.pull_request?.merged) return one('merged', `🟣 ${who} merged ${at}`);
      const reason = p.issue?.state_reason === 'not_planned' ? ' as not planned' : p.issue?.state_reason === 'duplicate' ? ' as a duplicate' : '';
      return one('closed', `⛔ ${who} closed ${at}${reason}`);
    }
    if (p.action === 'reopened') return one('reopened', `🔄 ${who} reopened ${at}`);
    if (p.action === 'labeled') {
      const label = p.label?.name;
      if (!(opts.labels ?? []).some((l) => same(l, label))) return [];
      return one(`label:${label}`, `🏷️ ${who} added **${plain(label, 40)}** to ${at}`);
    }
  }
  return [];
}

// A failed check run worth a DM: { repo, sha, name, url } (null for any other delivery). The pull request behind
// the head is found by the caller (forks' check runs carry no pull request).
export function checkFailure(name, p, checks = {}) {
  if (name !== 'check_run' || p.action !== 'completed') return null;
  const run = p.check_run;
  if (!run || !['failure', 'timed_out'].includes(run.conclusion)) return null;
  const repo = p.repository?.name;
  if (!(checks[repo] ?? []).some((c) => same(c, run.name))) return null;
  return { repo, sha: run.head_sha, name: run.name, url: run.html_url, numbers: (run.pull_requests ?? []).map((x) => x.number) };
}
export const checkEvent = (pr, fail) => ({
  author: pr.author, repo: pr.repo, number: pr.number,
  key: `${pr.repo}#${pr.number}:ci:${fail.sha}:${fail.name}`,
  line: `❌ **${plain(fail.name, 30)}** failed on PR #${pr.number} ${plain(pr.title, 60)}${pr.repo === 'horizon' ? '' : ` (${pr.repo})`} ${link(pr.url)}`.trim(),
});
// What the board's own CI look finds failing (no webhook): one line per head.
export const boardCiEvent = (pr) => ({
  author: pr.login, repo: pr.repo, number: pr.number,
  key: `${pr.repo}#${pr.number}:ci:${pr.sha}:*`,
  line: `❌ CI is failing on PR #${pr.number} ${plain(pr.title, 60)} ${link(pr.url)}`.trim(),
});

// ── Merge conflicts ──────────────────────────────────────────────────────────

// `known`: "repo#number" → the last mergeable state seen (MERGEABLE or CONFLICTING). `pulls`: [{ repo, number,
// title, url, author, mergeable }] as GitHub says now. A pull request that goes from MERGEABLE to CONFLICTING is an
// event; the first look at one only records it (nothing for what was already in conflict); UNKNOWN (GitHub is still
// working it out) changes nothing. Pull requests no longer listed are forgotten.
export function conflictChanges(known = {}, pulls = []) {
  const next = {};
  const events = [];
  for (const p of pulls) {
    const k = `${p.repo}#${p.number}`;
    const before = known[k];
    if (p.mergeable === 'UNKNOWN' || !p.mergeable) { if (before) next[k] = before; continue; }
    next[k] = p.mergeable;
    if (p.mergeable === 'CONFLICTING' && before === 'MERGEABLE') {
      events.push({ author: p.author, repo: p.repo, number: p.number, key: `${k}:conflict`, line: `⚠️ PR #${p.number} ${plain(p.title, 60)}${p.repo === 'horizon' ? '' : ` (${p.repo})`} has merge conflicts with its base: rebase or merge main ${link(p.url)}`.trim() });
    }
  }
  return { known: next, events };
}

// GitHub's search, for the open pull requests of these logins in these repos (OR within each qualifier).
export const conflictQuery = (owner, repos, logins) => `is:pr is:open archived:false ${repos.map((r) => `repo:${owner}/${r}`).join(' ')} ${logins.map((l) => `author:${l}`).join(' ')}`;
export const CONFLICT_GRAPHQL = `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest { number title url mergeable author { login } repository { name } } } } }`;

// ── The DM ───────────────────────────────────────────────────────────────────

// One DM for a batch: one line per event (the same key once), at most what fits in a Discord message.
export function dmText(events, max = 1900) {
  const lines = [];
  const seen = new Set();
  for (const e of events) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    lines.push(`• ${e.line}`);
  }
  const head = `🔔 **Horizon**: ${lines.length === 1 ? 'news' : `${lines.length} updates`} on your pull requests and issues`;
  const foot = '-# You get these because you turned them on with `/notify`. `/notify dm:off` stops them.';
  const body = [];
  let room = max - head.length - foot.length - 40;
  for (const [n, l] of lines.entries()) {
    if (l.length + 1 > room) { body.push(`• …and ${lines.length - n} more`); break; }
    body.push(l);
    room -= l.length + 1;
  }
  return [head, ...body, foot].join('\n');
}

// ── Batching ─────────────────────────────────────────────────────────────────

// A member's events wait `windowMs` after the first one, then go as one DM; never two DMs less than `gapMs`
// apart (what comes in meanwhile waits for the next). `send(id, events)` is called with the batch; `timers` is
// injectable for tests ({ set(fn, ms) → handle, clear(handle) }).
export function makeBatcher({ windowMs, gapMs, send, now = () => Date.now(), timers = { set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clear: clearTimeout } }) {
  const pending = new Map(); // id → { events, timer }
  const last = new Map(); // id → when the last DM went
  async function flush(id) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    last.set(id, now());
    await send(id, p.events);
  }
  return {
    add(id, event) {
      let p = pending.get(id);
      if (!p) {
        const wait = Math.max(windowMs, (last.get(id) ?? -Infinity) + gapMs - now());
        p = { events: [], timer: timers.set(() => flush(id).catch((e) => console.error('notify flush', e.message)), wait) };
        pending.set(id, p);
      }
      p.events.push(event);
    },
    drop(id) {
      const p = pending.get(id);
      if (p) timers.clear(p.timer);
      pending.delete(id);
    },
    pending: (id) => pending.get(id)?.events ?? [],
    flush,
  };
}
