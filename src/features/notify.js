// /notify: Kira DMs a contributor when their own pull requests or issues in Horizon's repos change (a review, a
// comment by someone else, merged, closed, reopened, a watched label, a required check failing on their head,
// merge conflicts appearing), so they can react fast. Asked by Isloka, 2026-11-01.
//
// - Who: members whose GitHub login is verified (/verify-github), after they opt in with `/notify dm:on`.
// - Source: GitHub's webhook (src/webhook.js: POST /github/webhook, signed with KIRA_GITHUB_WEBHOOK_SECRET), for
//   every public repository of GITHUB.owner (NOTIFY.repos: 'public', or a list): free and at once. Merge conflicts aren't a webhook event: one GraphQL search of the
//   subscribers' open pull requests after each board refresh and a few minutes after main moves. Without the
//   webhook, only the board's CI look (horizon) and the conflicts search run.
// - Batching (src/notify-kit.js): a member's events wait NOTIFY.windowMs, then go as one DM; never two DMs within
//   NOTIFY.gapMs. Nothing for their own actions. Pending batches are in memory: a restart drops them.
// - Closed DMs: noted (state.notify.users[id].closedAt), nothing more is tried until they run /notify dm:on again.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GITHUB, NOTIFY, WORK } from '../config.js';
import { client, state, save } from '../core.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import * as webhook from '../webhook.js';
import * as ckit from '../contributor-kit.js';
import * as kit from '../notify-kit.js';

const TOKEN = githubToken();
export const enabled = !!TOKEN;
let gh = makeGitHub({ token: TOKEN });
export const webhookOn = () => webhook.configured();
const DRY = process.env.KIRA_NOTIFY_DRY_RUN === '1';
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// users: Discord id → { since, closedAt? }; conflicts: "repo#n" → the last mergeable state seen.
const work = (state.work ??= {});
const box = (state.notify ??= {});
box.users ??= {};
box.conflicts ??= {};
// Before 2026-11-01 /notify was only CI failures, in state.work.notify (id → true): those members stay opted in.
for (const id of Object.keys(work.notify ?? {})) box.users[id] ??= { since: Date.now() };
delete work.notify;

const verified = (id) => ckit.isVerified(work, id, WORK.github);
const loginOf = (id) => ckit.loginOf(work, id, WORK.github);
// The member a GitHub login's DMs go to: verified, opted in, DMs not closed.
function subscriberOf(login) {
  const id = ckit.holderOf(work, login, WORK.github);
  const u = id && box.users[id];
  return u && !u.closedAt ? id : null;
}
const subscribers = () => Object.entries(box.users).filter(([id, u]) => !u.closedAt && verified(id)).map(([id]) => [id, loginOf(id)]);

// ── Sending ──────────────────────────────────────────────────────────────────

const closedDms = (e) => e?.code === 50007 || /Cannot send messages to this user/i.test(e?.message ?? '');
let dm = async (id, content) => {
  if (DRY) return void console.log(`notify dry-run → ${id}:\n${content}`);
  const u = await client.users.fetch(id);
  await u.send({ content, allowedMentions: { parse: [] } });
};
async function deliver(id, events) {
  const u = box.users[id];
  if (!u || u.closedAt || !verified(id)) return;
  try {
    await dm(id, kit.dmText(events));
  } catch (e) {
    if (!closedDms(e)) return void console.error('notify dm', e.message);
    u.closedAt = Date.now();
    save();
    console.log('notify: DMs closed, stopped for one member');
  }
}
const batch = kit.makeBatcher({ windowMs: NOTIFY.windowMs, gapMs: NOTIFY.gapMs, send: deliver });

// An event for a pull request's or issue's author: queued when they are a subscriber.
export function push(event) {
  const id = event.author && subscriberOf(event.author);
  if (!id) return false;
  batch.add(id, event);
  return true;
}

// The board's own CI look (src/features/workboard.js): when the webhook is on, its check runs say it better.
export function fromBoardCi(pr) {
  if (webhookOn()) return false;
  return push(kit.boardCiEvent({ ...pr, repo: WORK.repo }));
}

// ── Heads → pull requests (for failed checks) ─────────────────────────────────

const heads = new Map(); // "repo:sha" → { repo, number, title, url, author }
const missed = new Map(); // "repo:sha" → when a search found nothing (once per head)
function rememberHead(repo, sha, pr) {
  if (!sha) return;
  heads.delete(`${repo}:${sha}`);
  heads.set(`${repo}:${sha}`, pr);
  if (heads.size > 3000) heads.delete(heads.keys().next().value);
}
async function pullOfHead(repo, sha) {
  const k = `${repo}:${sha}`;
  if (heads.has(k)) return heads.get(k);
  if (missed.has(k)) return null;
  const res = await gh.graphql(`query($q: String!) { search(query: $q, type: ISSUE, first: 5) { nodes { ... on PullRequest { number title url headRefOid author { login } } } } }`, { q: `repo:${GITHUB.owner}/${repo} is:pr is:open ${sha}` });
  const node = (res?.data?.search?.nodes ?? []).find((n) => n?.headRefOid === sha);
  if (!node) {
    missed.set(k, Date.now());
    if (missed.size > 1000) missed.delete(missed.keys().next().value);
    return null;
  }
  const pr = { repo, number: node.number, title: node.title, url: node.url, author: node.author?.login };
  rememberHead(repo, sha, pr);
  return pr;
}

// ── The webhook ──────────────────────────────────────────────────────────────

// A repository whose authors get DMs: GITHUB.owner's public ones ('public'), or the ones listed.
export function watched(repository) {
  const [owner, name] = String(repository?.full_name ?? '').toLowerCase().split('/');
  if (!name || owner !== GITHUB.owner.toLowerCase()) return false;
  if (NOTIFY.repos === 'public') return repository.private === false;
  return NOTIFY.repos.some((r) => r.toLowerCase() === name);
}

// One delivery, already checked. Returns how many events were queued.
export async function handle(name, p) {
  if (!watched(p?.repository)) return 0;
  const repo = p.repository.name;
  const pr = p.pull_request;
  if (pr?.head?.sha && pr.state === 'open') rememberHead(repo, pr.head.sha, { repo, number: pr.number, title: pr.title, url: pr.html_url, author: pr.user?.login });
  if (webhook.pushToMain(name, p)) {
    conflictsSoon(NOTIFY.conflictDelayMs);
    return 0;
  }
  if (!subscribers().length) return 0;
  const fail = kit.checkFailure(name, p, NOTIFY.checks);
  if (fail) {
    const byNumber = [...heads.values()].find((h) => h.repo === repo && fail.numbers.includes(h.number));
    const owner = byNumber ?? await pullOfHead(repo, fail.sha);
    return owner && push(kit.checkEvent(owner, fail)) ? 1 : 0;
  }
  let n = 0;
  for (const e of kit.eventsOf(name, p, { labels: NOTIFY.labels })) if (push(e)) n++;
  return n;
}

// ── Merge conflicts ──────────────────────────────────────────────────────────

let checking = null;
export function checkConflicts() {
  checking ??= (async () => {
    try {
      const logins = [...new Set(subscribers().map(([, l]) => l))];
      if (!logins.length) { box.conflicts = {}; return; }
      const pulls = [];
      for (let i = 0; i < logins.length; i += 10) {
        const res = await gh.graphql(kit.CONFLICT_GRAPHQL, { q: kit.conflictQuery(GITHUB.owner, NOTIFY.repos, logins.slice(i, i + 10)) });
        if (!res?.data?.search) throw new Error(`search: ${res?.errors?.[0]?.message ?? 'no answer'}`);
        for (const n of res.data.search.nodes ?? []) {
          if (n?.number && watched({ full_name: `${GITHUB.owner}/${n.repository?.name}`, private: n.repository?.isPrivate })) pulls.push({ repo: n.repository?.name, number: n.number, title: n.title, url: n.url, author: n.author?.login, mergeable: n.mergeable });
        }
      }
      const { known, events } = kit.conflictChanges(box.conflicts, pulls);
      box.conflicts = known;
      save();
      for (const e of events) push(e);
      // GitHub works mergeability out when asked: what it didn't know yet is read again soon.
      if (pulls.some((p) => p.mergeable === 'UNKNOWN')) conflictsSoon(NOTIFY.conflictDelayMs);
    } catch (e) {
      console.error('notify conflicts', e.message);
    } finally {
      checking = null;
    }
  })();
  return checking;
}
let soon = null;
function conflictsSoon(ms) {
  if (soon) return;
  soon = setTimeout(() => { soon = null; checkConflicts(); }, ms);
  soon.unref?.();
}

// ── /notify ──────────────────────────────────────────────────────────────────

const WHAT = 'reviews, comments by others, merged / closed / reopened, a failing required check, merge conflicts and labels like needs-proof';
export const commands = enabled ? [
  new SlashCommandBuilder().setName('notify').setDescription('DMs from Kira when your Horizon pull requests or issues change (needs /verify-github)')
    .addStringOption((o) => o.setName('dm').setDescription('on, off, or status (default)').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }, { name: 'status', value: 'status' })),
] : [];

function status(id) {
  const u = box.users[id];
  const login = loginOf(id);
  if (!u) return `🔕 Notifications are off. \`/notify dm:on\` DMs you about your pull requests and issues in Horizon (${WHAT}).`;
  if (u.closedAt) return `⚠️ Notifications are on, but your DMs were closed when I tried <t:${Math.floor(u.closedAt / 1000)}:R>, so I stopped. Allow DMs from this server's members (Privacy settings), then run \`/notify dm:on\` again.`;
  if (!verified(id)) return `⚠️ Notifications are on, but your GitHub account isn't verified any more: run ${login ? '`/verify-github`' : '`/link-github <username>`, then `/verify-github`'}. Nothing is sent until then.`;
  return `🔔 Notifications are on for GitHub **${login}**: ${WHAT}. At most one DM every ${Math.round(NOTIFY.gapMs / 60_000)} minutes. \`/notify dm:off\` stops them.`;
}

export const handlers = {
  async notify(i) {
    const id = i.user.id;
    const want = i.options.getString('dm') ?? 'status';
    if (want === 'status') return i.reply(ephemeral(status(id)));
    if (want === 'off') {
      delete box.users[id];
      batch.drop(id);
      save();
      return i.reply(ephemeral('🔕 No more notification DMs. `/notify dm:on` turns them back on.'));
    }
    const login = loginOf(id);
    if (!login) return i.reply(ephemeral('Link your GitHub account first: `/link-github <username>`, then `/verify-github`. Notifications are only for a verified account.'));
    if (!verified(id)) return i.reply(ephemeral(`Verify that **${login}** is yours first: \`/verify-github\` (a code in your GitHub bio, takes a minute). Notifications are only for a verified account.`));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const was = box.users[id];
    box.users[id] = { since: was?.since ?? Date.now() };
    save();
    // A first DM now: it proves DMs are open, and says what comes.
    try {
      await dm(id, `🔔 Notifications are on for your Horizon pull requests and issues (GitHub **${login}**): ${WHAT}. Several things at once come as one DM.\n-# \`/notify dm:off\` in the server stops them.`);
    } catch (e) {
      if (!closedDms(e)) throw e;
      box.users[id].closedAt = Date.now();
      save();
      return i.editReply(ephemeral('⚠️ I can\'t DM you: your DMs are closed for this server. Allow DMs from server members (right-click the server → Privacy settings), then run `/notify dm:on` again.'));
    }
    return i.editReply(ephemeral(`🔔 On for GitHub **${login}**: I just sent you a first DM. ${WHAT[0].toUpperCase()}${WHAT.slice(1)}; at most one DM every ${Math.round(NOTIFY.gapMs / 60_000)} minutes. \`/notify dm:off\` stops them.`));
  },
};

if (enabled) webhook.on((name, p) => handle(name, p));

export function setup() {
  if (!enabled) return;
  console.log(`notify: ${Object.keys(box.users).length} members opted in, webhook ${webhookOn() ? 'on' : 'off (KIRA_GITHUB_WEBHOOK_SECRET is not set)'}${DRY ? ', dry run' : ''}`);
}

export const _test = { box, work, batch, heads, setGitHub: (g) => { gh = g; }, setDm: (f) => { dm = f; }, deliver };
