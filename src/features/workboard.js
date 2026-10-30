// The work board: Horizon's kanban, built from GitHub (every 10 minutes, after each command, and when a GitHub
// link is posted). The board itself is data, in src/board.js, written to data/board.json; the kanban people see is
// on the hub (playhorizon.dev/hub), and Discord gets its summary, one message at the top of #updates edited after
// each refresh. /claim marks an issue as taken (the "in progress" label and a comment on GitHub); a claim lapses
// after 14 days without activity, with a DM a few days before. /move: maintainers place a card.
import { SlashCommandBuilder, MessageFlags, MessageType } from 'discord.js';
import { rateLimiter } from '../agents.js';
import { WORK, GITHUB, HUB } from '../config.js';
import { client, state, save, channel, isStaff } from '../core.js';
import { dataFile } from '../store.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import * as board from '../board.js';
import * as wk from '../workkit.js';
import { summaryText } from '../journal.js';
import * as contributors from './contributors.js';
import { writeFileSync, renameSync, readFileSync } from 'node:fs';

const TOKEN = githubToken();
export const enabled = !!TOKEN; // claims write labels and comments: no token, no board
// KIRA_GITHUB_DRY_RUN=1: GitHub writes (labels, comments) are only logged, for a test deployment.
let gh = makeGitHub({ token: TOKEN, dryRun: process.env.KIRA_GITHUB_DRY_RUN === '1' });
const REPO = `/repos/${GITHUB.owner}/${WORK.repo}`;
const LABEL = encodeURIComponent(WORK.label);
export const BOARD_FILE = dataFile('board.json');

// claims: issue number → { user, who, title, url, since, activity, reminded }; links: Discord id → GitHub login;
// moves: card id → { column, by, at, auto } (src/board.js); summary: the board's message in #updates.
const work = (state.work ??= {});
work.claims ??= {};
work.links ??= {};
work.moves ??= {};
// Gone with #work-board and #dev-log (2026-10-25): the column messages, the logged pull requests, the digest.
for (const key of ['columns', 'board', 'logged', 'seeded', 'digestAt', 'reviewPinged']) delete work[key];
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// Discord ↔ GitHub: links set with /link-github, then the known ones from config.js.
const links = () => ({ ...WORK.github, ...work.links });
const loginOf = (userId) => links()[userId] ?? null;
const userOf = (login) => Object.entries(links()).find(([, l]) => l.toLowerCase() === String(login).toLowerCase())?.[0] ?? null;
function displayName(userId) {
  const m = client.guilds.cache.first()?.members.cache.get(userId);
  return m?.displayName ?? client.users.cache.get(userId)?.globalName ?? null;
}
// A GitHub login as the board shows it: the Discord name when it is linked.
const person = (login) => {
  const id = userOf(login);
  return { login, discordId: id, name: (id && displayName(id)) || login };
};
const whoIs = (login) => person(login).name;
const nameOf = (member, user) => member?.displayName ?? user.globalName ?? user.username;

let labelReady = false;
async function ensureLabel() {
  if (labelReady) return;
  if (!(await gh.get(`${REPO}/labels/${LABEL}`))) {
    await gh.write('POST', `${REPO}/labels`, { name: WORK.label, color: WORK.labelColor, description: 'Someone is working on it: claimed on Discord with /claim' });
  }
  labelReady = true;
}

// ── Claims ───────────────────────────────────────────────────────────────────

// Claims issue `n` for a Discord user. Returns the text of the answer.
export async function claim(user, member, n) {
  const issue = await gh.get(`${REPO}/issues/${n}`, { person: true });
  if (!issue) return `There's no issue #${n} in ${WORK.repo}.`;
  if (issue.pull_request) return `#${n} is a pull request. Claim the issue it fixes instead.`;
  if (issue.state !== 'open') return `#${n} is closed: nothing to claim.`;
  const mine = work.claims[n];
  if (mine && mine.user !== user.id) return `#${n} is already claimed by **${mine.who}** since <t:${Math.floor(mine.since / 1000)}:R>. Ask them in #horizon-chat before working on it.`;
  if (mine) {
    board.assign(work, n, { user: user.id, who: mine.who });
    save();
    refreshSoon();
    return `#${n} is still yours: the ${WORK.expireDays} days start again.`;
  }
  const holders = wk.heldOnGitHub(issue, loginOf(user.id));
  if (holders.length && !isStaff(member)) return `#${n} is assigned to **${holders.join(', ')}** on GitHub: someone is on it. Pick another, or ask in the issue.`;
  if (issue.labels.some((l) => l.name === WORK.label) && !isStaff(member)) return `#${n} already has the **${WORK.label}** label on GitHub: someone is on it. Ask in #horizon-chat.`;
  const wait = wk.cooldownLeft(work.githubAt?.[n], Date.now(), WORK.claimCooldownMs);
  if (wait) return `#${n} was claimed or unclaimed a moment ago: try again in ${Math.ceil(wait / 60_000)} min.`;
  // Per member, across issues (N1): a few claims at once, and a pause between two claims or unclaims.
  if (!isStaff(member)) {
    // An issue an open pull request already fixes doesn't count: a review can take days (rdbtCVS, 2026-10-30).
    const fixed = new Set((raw?.pulls ?? []).filter((p) => p.state === 'open').flatMap((p) => board.fixesIn(`${p.title}\n${p.body ?? ''}`)));
    const held = Object.entries(work.claims).filter(([k, c]) => c.user === user.id && !fixed.has(Number(k))).length;
    if (held >= WORK.maxClaims) return `You already have ${held} claimed issues: finish or \`/unclaim\` one before claiming another.`;
    const pause = wk.cooldownLeft(work.memberGithubAt?.[user.id], Date.now(), WORK.memberCooldownMs);
    if (pause) return `You claimed or unclaimed an issue a moment ago: try again in ${Math.ceil(pause / 1000)} s.`;
  }
  // Reserved now, before the first await: claims running in parallel see this one and its cooldowns, so
  // they can't pass the cap or write a second comment (F2). Rolled back if GitHub refuses.
  const who = nameOf(member, user);
  const now = Date.now();
  const before = { issue: work.githubAt?.[n], member: work.memberGithubAt?.[user.id] };
  Object.assign(board.assign(work, n, { user: user.id, who }, now), { title: issue.title, url: issue.html_url });
  (work.githubAt ??= {})[n] = now;
  (work.memberGithubAt ??= {})[user.id] = now;
  try {
    await ensureLabel();
    await gh.write('POST', `${REPO}/issues/${n}/labels`, { labels: [WORK.label] });
    await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: wk.claimComment(who, loginOf(user.id), n, WORK.expireDays) });
  } catch (e) {
    board.unassign(work, n);
    if (before.issue === undefined) delete work.githubAt[n]; else work.githubAt[n] = before.issue;
    if (before.member === undefined) delete work.memberGithubAt[user.id]; else work.memberGithubAt[user.id] = before.member;
    throw e;
  }
  save();
  refreshSoon();
  return `🔨 #${n} **${issue.title}** is yours: it's in **In progress** on the board (\`/board\`, and the kanban on <${HUB.url}>), with the **${WORK.label}** label and a comment on GitHub. Open your pull request with "Fixes #${n}" in its description so it shows on your card. \`/unclaim ${n}\` if you stop; it lapses after ${WORK.expireDays} days without activity.`;
}

// Releases a claim (`why`: 'unclaimed', 'expired' or 'closed'). Removes the label; comments unless the issue closed.
async function release(n, why) {
  const entry = work.claims[n];
  if (!entry) return;
  await gh.write('DELETE', `${REPO}/issues/${n}/labels/${LABEL}`).catch((e) => console.error('unlabel', n, e.message));
  if (why !== 'closed') await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: wk.unclaimComment(entry.who, why) }).catch((e) => console.error('unclaim comment', n, e.message));
  board.unassign(work, n);
  save();
}

export async function unclaim(user, member, n) {
  const entry = work.claims[n];
  if (!entry || entry.releasing) return `#${n} isn't claimed on Discord.`;
  if (entry.user !== user.id && !isStaff(member)) return `#${n} is claimed by **${entry.who}**: only they (or a mod) can unclaim it.`;
  const wait = wk.cooldownLeft(work.githubAt?.[n], Date.now(), WORK.claimCooldownMs);
  if (wait) return `#${n} was claimed a moment ago: you can unclaim it in ${Math.ceil(wait / 60_000)} min.`;
  const pause = isStaff(member) ? 0 : wk.cooldownLeft(work.memberGithubAt?.[user.id], Date.now(), WORK.memberCooldownMs);
  if (pause) return `You claimed or unclaimed an issue a moment ago: try again in ${Math.ceil(pause / 1000)} s.`;
  // Marked before the first await, like claims (F2): a second unclaim in parallel finds nothing to release.
  entry.releasing = true;
  (work.githubAt ??= {})[n] = Date.now();
  (work.memberGithubAt ??= {})[user.id] = Date.now();
  await release(n, 'unclaimed');
  refreshSoon();
  return `↩️ #${n} is free again: the label is off, with a comment on GitHub.`;
}

// ── What GitHub says ─────────────────────────────────────────────────────────

async function pages(path, max = 3) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const list = (await gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)) ?? [];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

// Open pull requests, each with a short status (draft, CI, review).
// With ~270 open pull requests, three reads each every refresh spent the GitHub App's whole hour (2026-10-30): a
// head whose CI has finished is read again only after CI_RECHECK_MS (a rerun is rare), and the reviews only when
// the pull request changed (a review bumps its updated_at).
const CI_RECHECK_MS = 60 * 60 * 1000;
const ciOf = new Map(); // head sha → { ci, at }
const reviewsOf = new Map(); // pull number → { updated, reviews }
async function openPulls() {
  const pulls = await pages(`${REPO}/pulls?state=open`);
  const now = Date.now();
  const out = await Promise.all(pulls.map(async (p) => {
    const known = ciOf.get(p.head.sha);
    const fresh = known && (known.ci === 'passing' || known.ci === 'failing') && now - known.at < CI_RECHECK_MS;
    const seen = reviewsOf.get(p.number);
    const [runs, status, reviews] = await Promise.all([
      fresh ? null : gh.get(`${REPO}/commits/${p.head.sha}/check-runs?per_page=100`).catch(() => null),
      fresh ? null : gh.get(`${REPO}/commits/${p.head.sha}/status`).catch(() => null),
      p.draft ? [] : seen?.updated === p.updated_at ? seen.reviews
        : gh.get(`${REPO}/pulls/${p.number}/reviews?per_page=100`).catch(() => null),
    ]);
    const ci = fresh ? known.ci : wk.ciState(runs?.check_runs, status?.statuses);
    if (!fresh) ciOf.set(p.head.sha, { ci, at: now });
    if (!p.draft && reviews) reviewsOf.set(p.number, { updated: p.updated_at, reviews });
    return { ...p, ci, reviews: (reviews ?? []).length, status: wk.prStatus({ draft: p.draft, ci, review: wk.reviewState(reviews ?? []) }) };
  }));
  // Closed pull requests and old heads drop out of the memos.
  const open = new Set(pulls.map((p) => p.head.sha));
  for (const sha of ciOf.keys()) if (!open.has(sha)) ciOf.delete(sha);
  const numbers = new Set(pulls.map((p) => p.number));
  for (const n of reviewsOf.keys()) if (!numbers.has(n)) reviewsOf.delete(n);
  return out;
}

// Everything the board needs, in one go.
async function fetchAll() {
  // Rounded to the day: a since that changes on every refresh would never get a free 304.
  const since = new Date(Math.floor((Date.now() - WORK.mergedDays * wk.DAY) / wk.DAY) * wk.DAY).toISOString();
  const [open, closed, pulls, closedPulls, branches] = await Promise.all([
    pages(`${REPO}/issues?state=open`),
    pages(`${REPO}/issues?state=closed&since=${since}`),
    openPulls(),
    gh.get(`${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`).then((x) => x ?? []),
    pages(`${REPO}/branches`).then((bs) => bs.map((b) => b.name)),
  ]);
  const merged = closedPulls.filter((p) => p.merged_at && Date.parse(p.merged_at) >= Date.parse(since));
  return {
    repo: `${GITHUB.owner}/${WORK.repo}`,
    issues: [...open, ...closed].filter((i) => !i.pull_request),
    pulls: [...pulls, ...merged],
    branches,
  };
}

// The pull requests as the claims see them.
const brief = (p) => ({ number: p.number, title: p.title, url: p.html_url, login: p.user?.login, fixes: board.fixesIn(`${p.title}\n${p.body ?? ''}`), updated: Date.parse(p.updated_at) });

// Each claim: closed issues release it; activity (comments, commits, linked PRs) pushes the deadline;
// a reminder DM a few days before it lapses, then it lapses.
async function checkClaims(prs) {
  const now = Date.now();
  for (const [key, entry] of Object.entries(work.claims)) {
    const n = Number(key);
    try {
      const issue = await gh.get(`${REPO}/issues/${n}`);
      if (!issue || issue.state !== 'open') { await release(n, 'closed'); continue; }
      entry.title = issue.title;
      entry.url = issue.html_url;
      const timeline = await pages(`${REPO}/issues/${n}/timeline`);
      const linked = prs.filter((p) => p.fixes.includes(n)).map((p) => p.updated);
      entry.activity = Math.max(entry.activity ?? 0, wk.lastActivity(timeline), ...linked.filter((t) => t > entry.since));
      const due = wk.claimDue(entry, now, WORK);
      if (due === 'expire') {
        await release(n, 'expired');
        const u = await client.users.fetch(entry.user).catch(() => null);
        await u?.send(`⌛ Your claim on Horizon #${n} (**${entry.title}**) lapsed after ${WORK.expireDays} days without activity, so others can take it. Still on it? \`/claim ${n}\` again in the server.`).catch(() => {});
      } else if (due === 'remind') {
        const u = await client.users.fetch(entry.user).catch(() => null);
        const at = Math.floor(wk.lapsesAt(entry, WORK.expireDays) / 1000);
        await u?.send(`⏰ Your claim on Horizon #${n} (**${entry.title}**, ${entry.url}) lapses <t:${at}:R>: nothing has happened on it (comment, pull request or commit mentioning #${n}) for a while. Still on it? Run \`/claim ${n}\` again in the server, or open a draft pull request with "Fixes #${n}". Done with it? \`/unclaim ${n}\`.`).catch(() => {});
        entry.reminded = now;
      }
    } catch (e) {
      console.error('claim', n, e.message);
    }
  }
  save();
}

// ── The board ────────────────────────────────────────────────────────────────

let raw = null; // the last fetch, so commands can rebuild without asking GitHub again
// Until the first refresh: the last board written (data/board.json), so a GitHub hiccup at start doesn't
// leave the board empty for 10 minutes.
let snapshot = (() => {
  try {
    const s = JSON.parse(readFileSync(BOARD_FILE, 'utf8'));
    return s.version === board.SNAPSHOT_VERSION ? s : null;
  } catch {
    return null;
  }
})();

// The current board (null before the first refresh). For other features and the later agent API.
export const current = () => snapshot;
// The last fetch's open pull requests and branches (public GitHub data), for "what is Ludovic working on".
export const openPullsNow = () => (raw?.pulls ?? []).filter((p) => p.state === 'open')
  .map((p) => ({ number: p.number, title: p.title, url: p.html_url, author: p.user?.login, draft: !!p.draft, status: p.status ?? null, updatedAt: p.updated_at }));
export const branchesNow = () => raw?.branches ?? [];
// A read of Horizon's repo on GitHub (issues, pulls, comments of horizon-rust/horizon only).
// An agent waits on it: it goes even inside the board's reserve.
export const repoGet = (path) => gh.get(`${REPO}${path}`, { person: true });
export const workState = () => work;
// After a change made outside the commands (agents): save, rebuild the board, repaint it.
export async function changed() {
  save();
  rebuild();
  await render().catch((e) => console.error('work board', e.message));
}

function rebuild() {
  if (!raw) return null;
  const { snapshot: s, stale } = board.build(raw, work, { doneDays: WORK.mergedDays, expireDays: WORK.expireDays, person });
  for (const id of stale) delete work.moves[id];
  if (stale.length) save();
  snapshot = s;
  writeFileSync(BOARD_FILE + '.tmp', JSON.stringify(s, null, 2));
  renameSync(BOARD_FILE + '.tmp', BOARD_FILE);
  return s;
}

// The board's summary: one message at the top of #updates, pinned, edited in place after each refresh (posted
// again if it was deleted).
async function render() {
  const ch = channel('updates');
  if (!ch || !snapshot) return;
  const payload = summaryText(snapshot, board.goodFirst(snapshot, 3), HUB.url);
  const old = work.summary && await ch.messages.fetch(work.summary).catch(() => null);
  if (old) return void await old.edit(payload);
  const msg = await ch.send(payload);
  work.summary = msg.id;
  save();
  await msg.pin().catch((e) => console.error('pin summary', e.message));
  // Discord's "Kira pinned a message" line: not needed in a read-only channel.
  const notices = (await ch.messages.fetch({ limit: 5 })).filter((m) => m.type === MessageType.ChannelPinnedMessage && m.author.id === client.user.id);
  for (const m of notices.values()) await m.delete().catch(() => {});
}

// ── CI failures ──────────────────────────────────────────────────────────────
// A pull request's author gets a DM when CI starts failing on its commit, if their GitHub login is linked and they
// turned it on with /notify (at most 5 DMs an hour each). Nothing for what was already failing at the first look.
const dms = rateLimiter({ dm: [5, 3_600_000] });
async function dmAuthor(login, text) {
  const id = userOf(login);
  if (!id || !work.notify?.[id] || !dms.take(id, 'dm')) return;
  const u = await client.users.fetch(id).catch(() => null);
  await u?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

async function notices() {
  const open = raw.pulls.filter((p) => p.state === 'open').map((p) => ({ number: p.number, title: p.title, url: p.html_url, login: p.user?.login, sha: p.head?.sha, ci: p.ci }));
  const ci = wk.ciChanges(open, work.ciSeen);
  work.ciSeen = ci.seen;
  save();
  for (const p of ci.report) {
    await dmAuthor(p.login, `❌ CI is failing on your Horizon pull request #${p.number} (${p.title}): ${p.url}
-# You get these because you turned them on with /notify. /notify off stops them.`);
  }
}

let running = null;
export function refresh() {
  running ??= (async () => {
    try {
      raw = await fetchAll();
      const open = raw.pulls.filter((p) => p.state === 'open').map(brief);
      const merged = raw.pulls.filter((p) => p.merged_at).map(brief);
      await checkClaims([...open, ...merged]);
      rebuild();
      await render();
      await notices().catch((e) => console.error('notices', e.message));
      await contributors.afterRefresh(raw).catch((e) => console.error('contributors', e.message));
    } catch (e) {
      console.error('work board', e.message);
      refreshSoon(60_000); // GitHub failed (a 5xx, a timeout): try again in a minute, not in 10
    } finally {
      running = null;
    }
  })();
  return running;
}
let soon = null;
export function refreshSoon(ms = 3000) {
  clearTimeout(soon);
  soon = setTimeout(() => refresh(), ms);
  soon.unref?.(); // never what keeps the process alive (the Discord client does)
}

// A GitHub link to Horizon's pull requests or issues posted in the server: something probably changed.
export function onMessage(msg) {
  if (enabled && new RegExp(`github\\.com/${GITHUB.owner}/${WORK.repo}/(pull|issues)/\\d+`, 'i').test(msg.content)) refreshSoon(30_000);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function workingText() {
  if (!snapshot) return 'The board is loading: try again in a minute.';
  const people = new Map(); // name → lines
  for (const c of board.cards(snapshot).filter((c) => ['progress', 'review'].includes(c.column))) {
    for (const p of c.people) people.set(p.name, [...(people.get(p.name) ?? []), `${c.kind === 'pr' ? '🔀 PR' : '🔨'} #${c.number} ${c.title} · ${board.COLUMNS.find((x) => x.key === c.column).name}`]);
  }
  if (!people.size) return 'Nobody is working on an issue or has a pull request open right now. Pick one on GitHub and `/claim` it.';
  const lines = [...people].map(([who, items]) => `**${who}**\n${items.map((l) => `• ${l}`).join('\n')}`);
  return `${lines.join('\n\n')}\n\nThe kanban: <${HUB.url}>`.slice(0, 1990);
}

function boardText(column, member) {
  if (!snapshot) return 'The board is loading: try again in a minute.';
  const who = member && (loginOf(member.id) ?? member.id);
  const cols = snapshot.columns.filter((c) => !column || c.key === column).map((c) => ({ ...c, cards: c.cards.filter((card) => !member || card.people.some((p) => p.discordId === member.id || (who && p.login === who))) }));
  const text = cols.map((c) => wk.columnText(c, Date.now(), 1800)).map((t) => `**${t.title}**\n${t.description}`).join('\n\n');
  return text.slice(0, 1990);
}

const COLUMN_CHOICES = board.COLUMNS.map((c) => ({ name: `${c.emoji} ${c.name}`, value: c.key }));

export const commands = enabled ? [
  new SlashCommandBuilder().setName('claim').setDescription('Tell everyone you are working on a Horizon issue (GitHub label + comment)')
    .addIntegerOption((o) => o.setName('issue').setDescription('The issue number on GitHub (horizon-rust/horizon)').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('unclaim').setDescription('Stop working on an issue you claimed: it becomes free again')
    .addIntegerOption((o) => o.setName('issue').setDescription('The issue number').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('working').setDescription("Who's working on what: claimed issues and open pull requests"),
  new SlashCommandBuilder().setName('board').setDescription('The work board, or one column of it, or one person\'s cards (only you see it)')
    .addStringOption((o) => o.setName('column').setDescription('One column').addChoices(...COLUMN_CHOICES))
    .addUserOption((o) => o.setName('member').setDescription('Only their cards')),
  new SlashCommandBuilder().setName('move').setDescription('Maintainers: move a card of the work board to another column')
    .addIntegerOption((o) => o.setName('number').setDescription('The issue or pull request number').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('column').setDescription('Where to').setRequired(true).addChoices(...COLUMN_CHOICES))
    .addStringOption((o) => o.setName('kind').setDescription('If an issue and a pull request share the number').addChoices({ name: 'issue', value: 'issue' }, { name: 'pull request', value: 'pr' })),
  new SlashCommandBuilder().setName('goodfirst').setDescription('Good first tasks for newcomers: open issues nobody claimed yet'),
  new SlashCommandBuilder().setName('notify').setDescription('DMs from Kira when CI fails on your pull requests (needs /link-github)')
    .addStringOption((o) => o.setName('dm').setDescription('On or off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
  new SlashCommandBuilder().setName('link-github').setDescription('Link your GitHub account, so your pull requests show your Discord name')
    .addStringOption((o) => o.setName('username').setDescription('Your GitHub username').setRequired(true).setMaxLength(39))
    .addBooleanOption((o) => o.setName('credit').setDescription("Show your Discord name and GitHub together on the hub's contributors page (default: no)"))
    .addUserOption((o) => o.setName('member').setDescription('Mods: link someone else')),
] : [];

export const handlers = {
  goodfirst(i) {
    const picks = snapshot ? board.goodFirst(snapshot, 10) : [];
    if (!picks.length) return i.reply(ephemeral(`No good first tasks labelled right now. See what is being built with \`/roadmap\`, or the kanban on <${HUB.url}>, or ask in #horizon-chat.`));
    return i.reply(ephemeral(`🌱 **Good first tasks** (open, nobody on them):\n${picks.map((c) => `• [#${c.number} ${c.title.replace(/[[\]]/g, '')}](<${c.url}>)`).join('\n')}\n\n\`/claim <number>\` before you start.`));
  },
  notify(i) {
    const on = i.options.getString('dm') === 'on';
    work.notify ??= {};
    if (on) work.notify[i.user.id] = true; else delete work.notify[i.user.id];
    save();
    const linked = loginOf(i.user.id);
    return i.reply(ephemeral(on ? `🔔 You'll get a DM when CI fails on your pull requests${linked ? ` (GitHub **${linked}**)` : '. Link your GitHub account first: `/link-github <username>`'}. \`/notify dm:off\` stops it.` : '🔕 No more CI DMs.'));
  },
  async claim(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    return i.editReply(ephemeral(await claim(i.user, i.member, i.options.getInteger('issue'))));
  },
  async unclaim(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    return i.editReply(ephemeral(await unclaim(i.user, i.member, i.options.getInteger('issue'))));
  },
  working: (i) => i.reply(ephemeral(workingText())),
  board: (i) => i.reply(ephemeral(boardText(i.options.getString('column'), i.options.getUser('member')))),
  async move(i) {
    if (!snapshot) return i.reply(ephemeral('The board is loading: try again in a minute.'));
    const n = i.options.getInteger('number');
    const ref = { kind: i.options.getString('kind'), number: n };
    const card = board.find(snapshot, ref);
    if (!card) return i.reply(ephemeral(`#${n} isn't on the board (open issues and pull requests, and what closed in the last ${WORK.mergedDays} days).`));
    const mine = card.claim?.discordId === i.user.id;
    if (!isStaff(i.member) && !mine) return i.reply(ephemeral('Only maintainers move cards (and you, on a card you claimed).'));
    let result;
    try {
      result = board.move(work, snapshot, ref, i.options.getString('column'), nameOf(i.member, i.user));
    } catch (e) {
      return i.reply(ephemeral(e.message));
    }
    save();
    rebuild();
    await render().catch((e) => console.error('work board', e.message));
    const name = (key) => board.COLUMNS.find((c) => c.key === key).name;
    const back = result.to === card.auto ? ' (where GitHub puts it, so no manual move is kept)' : `. It stays there until its state on GitHub changes (GitHub would put it in ${name(card.auto)}).`;
    return i.reply(ephemeral(`📌 #${card.number} → **${name(result.to)}**${back}`));
  },
  async 'link-github'(i) {
    const target = i.options.getUser('member') ?? i.user;
    if (target.id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only mods can link someone else.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const wanted = i.options.getString('username').trim().replace(/^@/, '');
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(wanted)) return i.editReply(ephemeral(`\`${wanted}\` isn't a GitHub username.`));
    const ghUser = await gh.get(`/users/${encodeURIComponent(wanted)}`, { person: true });
    if (!ghUser) return i.editReply(ephemeral(`There's no GitHub user \`${wanted}\`.`));
    const taken = userOf(ghUser.login);
    if (taken && taken !== target.id && !isStaff(i.member)) return i.editReply(ephemeral(`\`${ghUser.login}\` is already linked to someone else. Ask a mod if that's wrong.`));
    // A changed login (or one taken from someone else, by a mod) loses its verification, and the role with it.
    const dropped = Object.entries(work.links).filter(([id, login]) => id !== target.id && login.toLowerCase() === ghUser.login.toLowerCase()).map(([id]) => id);
    for (const id of dropped) delete work.links[id];
    const changed = work.links[target.id]?.toLowerCase() !== ghUser.login.toLowerCase();
    work.links[target.id] = ghUser.login;
    // Only the member decides whether the pair is public (a mod linking someone else never turns it on).
    const credit = target.id === i.user.id ? i.options.getBoolean('credit') : null;
    work.credit ??= {};
    if (credit === true) work.credit[target.id] = true;
    else if (credit === false || target.id !== i.user.id) delete work.credit[target.id];
    save();
    for (const id of changed ? [target.id, ...dropped] : dropped) await contributors.relinked(id);
    refreshSoon();
    const shown = work.credit[target.id] ? ` It shows on the hub's contributors page (\`/link-github ${ghUser.login} credit:False\` hides it).` : target.id === i.user.id ? ` To be credited on the hub's contributors page with both names: \`/link-github ${ghUser.login} credit:True\`.` : '';
    const more = target.id === i.user.id ? await contributors.linkNote(target.id).catch(() => '') : '';
    return i.editReply(ephemeral(`🔗 <@${target.id}> is GitHub **${ghUser.login}**: their pull requests show their Discord name on the board.${shown}${more}`));
  },
};

// The Discord ↔ GitHub pairs members agreed to show (/link-github credit:True), for the hub's contributors page:
// the GitHub login and the Discord name only, members still on the server only, sorted by login.
export function creditedPairs() {
  return Object.keys(work.credit ?? {}).filter((id) => work.links[id]).map((id) => ({ github: work.links[id], discord: displayName(id) }))
    .filter((p) => p.discord).sort((a, b) => a.github.localeCompare(b.github));
}

// For end-to-end checks (scratch scripts): the GitHub client can be swapped.
export const _test = { work, setGitHub: (g) => { gh = g; }, release, rebuild, render, notices, setRaw: (r) => { raw = r; }, openPulls };

export function setup() {
  if (!enabled) return console.log('work board: off (GITHUB_TOKEN is not set)');
  console.log(`work board: on, ${Object.keys(work.claims).length} claims`);
  client.once('clientReady', async () => {
    await client.guilds.cache.first()?.members.fetch().catch(() => {}); // Discord names on the board from the first refresh
    refreshSoon(10_000);
    setInterval(() => refresh(), WORK.refreshMs);
  });
}
