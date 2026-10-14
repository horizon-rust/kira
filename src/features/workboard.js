// The work board: Horizon's kanban in #work-board. One pinned message per column (Backlog, To do, In
// progress, Review, Done), each card an issue or pull request with who, labels and status; Kira edits
// them after each refresh from GitHub (every 10 minutes, after each command, and when a GitHub link is
// posted). The board itself is data, in src/board.js; its JSON snapshot is also written to data/board.json
// for whatever reads it next. #dev-log gets one line per pull request opened or merged, per claim and per
// move, with no pings. /claim marks an issue as taken (the "in progress" label and a comment on GitHub); a
// claim lapses after 14 days without activity, with a DM a few days before. /move: maintainers place a card.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, MessageType } from 'discord.js';
import { WORK, GITHUB } from '../config.js';
import { client, state, save, channel, isStaff } from '../core.js';
import { dataFile } from '../store.js';
import { makeGitHub } from '../github.js';
import * as board from '../board.js';
import * as wk from '../workkit.js';
import { writeFileSync, renameSync, readFileSync } from 'node:fs';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
export const enabled = !!TOKEN; // claims write labels and comments: no token, no board
// KIRA_GITHUB_DRY_RUN=1: GitHub writes (labels, comments) are only logged, for a test deployment.
let gh = makeGitHub({ token: TOKEN, dryRun: process.env.KIRA_GITHUB_DRY_RUN === '1' });
const REPO = `/repos/${GITHUB.owner}/${WORK.repo}`;
const LABEL = encodeURIComponent(WORK.label);
export const BOARD_FILE = dataFile('board.json');

// claims: issue number → { user, who, title, url, since, activity, reminded }; links: Discord id → GitHub login;
// moves: card id → { column, by, at, auto } (src/board.js); columns: column key → its message in #work-board;
// logged: PR numbers already in #dev-log; seeded: false until the first look.
const work = (state.work ??= {});
work.claims ??= {};
work.links ??= {};
work.moves ??= {};
work.columns ??= {};
work.logged ??= { opened: [], merged: [] };
work.seeded ??= false;
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

export async function log(line) {
  const ch = channel('devlog');
  if (!ch) return null;
  return ch.send({ content: line, allowedMentions: { parse: [] } }).catch((e) => { console.error('dev-log', e.message); return null; });
}

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
  const issue = await gh.get(`${REPO}/issues/${n}`);
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
  if (issue.labels.some((l) => l.name === WORK.label) && !isStaff(member)) return `#${n} already has the **${WORK.label}** label on GitHub: someone is on it. Ask in #horizon-chat.`;
  const wait = wk.cooldownLeft(work.githubAt?.[n], Date.now(), WORK.claimCooldownMs);
  if (wait) return `#${n} was claimed or unclaimed a moment ago: try again in ${Math.ceil(wait / 60_000)} min.`;
  // Per member, across issues (N1): a few claims at once, and a pause between two claims or unclaims.
  if (!isStaff(member)) {
    const held = Object.values(work.claims).filter((c) => c.user === user.id).length;
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
  await log(wk.logLine.claimed({ ...work.claims[n], number: n }));
  refreshSoon();
  return `🔨 #${n} **${issue.title}** is yours: it's in **In progress** on <#${state.channels.workboard}>, with the **${WORK.label}** label and a comment on GitHub. Open your pull request with "Fixes #${n}" in its description so it shows on your card. \`/unclaim ${n}\` if you stop; it lapses after ${WORK.expireDays} days without activity.`;
}

// Releases a claim (`why`: 'unclaimed', 'expired' or 'closed'). Removes the label; comments unless the issue closed.
async function release(n, why) {
  const entry = work.claims[n];
  if (!entry) return;
  await gh.write('DELETE', `${REPO}/issues/${n}/labels/${LABEL}`).catch((e) => console.error('unlabel', n, e.message));
  if (why !== 'closed') await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: wk.unclaimComment(entry.who, why) }).catch((e) => console.error('unclaim comment', n, e.message));
  board.unassign(work, n);
  save();
  if (why === 'unclaimed') await log(wk.logLine.unclaimed({ ...entry, number: n }));
  if (why === 'expired') await log(wk.logLine.expired({ ...entry, number: n }, WORK.expireDays));
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
async function openPulls() {
  const pulls = await pages(`${REPO}/pulls?state=open`);
  return Promise.all(pulls.map(async (p) => {
    const [runs, status, reviews] = await Promise.all([
      gh.get(`${REPO}/commits/${p.head.sha}/check-runs?per_page=100`).catch(() => null),
      gh.get(`${REPO}/commits/${p.head.sha}/status`).catch(() => null),
      p.draft ? [] : gh.get(`${REPO}/pulls/${p.number}/reviews?per_page=100`).catch(() => []),
    ]);
    return { ...p, status: wk.prStatus({ draft: p.draft, ci: wk.ciState(runs?.check_runs, status?.statuses), review: wk.reviewState(reviews ?? []) }) };
  }));
}

// Everything the board needs, in one go.
async function fetchAll() {
  const since = new Date(Date.now() - WORK.mergedDays * wk.DAY).toISOString();
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

// The pull requests as #dev-log and the claims see them.
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

// Opened and merged pull requests → #dev-log, each once. The first look only records what's there.
async function logPulls(open, merged) {
  const L = work.logged;
  if (!work.seeded) {
    for (const p of [...open, ...merged]) L.opened = wk.remember(L.opened, p.number);
    for (const p of merged) L.merged = wk.remember(L.merged, p.number);
    work.seeded = true;
    return save();
  }
  for (const p of [...open].sort((a, b) => a.number - b.number)) {
    if (L.opened.includes(p.number)) continue;
    L.opened = wk.remember(L.opened, p.number);
    save();
    await log(wk.logLine.opened({ ...p, who: whoIs(p.login) }));
  }
  for (const p of [...merged].sort((a, b) => a.number - b.number)) {
    if (L.merged.includes(p.number)) continue;
    L.merged = wk.remember(L.merged, p.number);
    L.opened = wk.remember(L.opened, p.number);
    save();
    await log(wk.logLine.merged({ ...p, who: whoIs(p.login) }));
  }
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
// A read of Horizon's repo on GitHub (issues, pulls, comments of ludovic111/horizon only).
export const repoGet = (path) => gh.get(`${REPO}${path}`);
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

function columnPayload(column) {
  const t = wk.columnText(column);
  const embed = new EmbedBuilder().setColor(t.color).setTitle(t.title).setDescription(t.description).setTimestamp(Date.parse(snapshot.generatedAt));
  if (t.footer) embed.setFooter({ text: t.footer });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// One pinned message per column, in order. Edited in place; if one is gone, all five are posted again
// (so the order stays right) and the old ones are deleted.
async function render() {
  const ch = channel('workboard');
  if (!ch || !snapshot) return;
  if (work.board) { // the single message of the first version of the board
    await ch.messages.fetch(work.board).then((m) => m.delete()).catch(() => {});
    delete work.board;
    save();
  }
  const found = {};
  for (const col of board.COLUMNS) found[col.key] = work.columns[col.key] && await ch.messages.fetch(work.columns[col.key]).catch(() => null);
  if (board.COLUMNS.every((c) => found[c.key])) {
    for (const column of snapshot.columns) await found[column.key].edit(columnPayload(column));
    return;
  }
  for (const msg of Object.values(found)) await msg?.delete().catch(() => {});
  for (const column of snapshot.columns) {
    const msg = await ch.send(columnPayload(column));
    work.columns[column.key] = msg.id;
    save();
    await msg.pin().catch((e) => console.error('pin column', e.message));
  }
  // Discord's "Kira pinned a message" lines: not needed in a read-only channel.
  const notices = (await ch.messages.fetch({ limit: 20 })).filter((m) => m.type === MessageType.ChannelPinnedMessage && m.author.id === client.user.id);
  for (const m of notices.values()) await m.delete().catch(() => {});
  console.log('work board columns posted');
}

let running = null;
export function refresh() {
  running ??= (async () => {
    try {
      raw = await fetchAll();
      const open = raw.pulls.filter((p) => p.state === 'open').map(brief);
      const merged = raw.pulls.filter((p) => p.merged_at).map(brief);
      await checkClaims([...open, ...merged]);
      await logPulls(open, merged);
      rebuild();
      await render();
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
  return `${lines.join('\n\n')}\n\nThe live board is in <#${state.channels.workboard}>.`.slice(0, 1990);
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
    .addIntegerOption((o) => o.setName('issue').setDescription('The issue number on GitHub (ludovic111/horizon)').setRequired(true).setMinValue(1)),
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
  new SlashCommandBuilder().setName('link-github').setDescription('Link your GitHub account, so your pull requests show your Discord name')
    .addStringOption((o) => o.setName('username').setDescription('Your GitHub username').setRequired(true).setMaxLength(39))
    .addUserOption((o) => o.setName('member').setDescription('Mods: link someone else')),
] : [];

export const handlers = {
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
    if (result.from !== result.to) await log(wk.logLine.moved({ who: nameOf(i.member, i.user), number: card.number, title: card.title, url: card.url, to: name(result.to) }));
    const back = result.to === card.auto ? ' (where GitHub puts it, so no manual move is kept)' : `. It stays there until its state on GitHub changes (GitHub would put it in ${name(card.auto)}).`;
    return i.reply(ephemeral(`📌 #${card.number} → **${name(result.to)}**${back}`));
  },
  async 'link-github'(i) {
    const target = i.options.getUser('member') ?? i.user;
    if (target.id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only mods can link someone else.'));
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const wanted = i.options.getString('username').trim().replace(/^@/, '');
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(wanted)) return i.editReply(ephemeral(`\`${wanted}\` isn't a GitHub username.`));
    const ghUser = await gh.get(`/users/${encodeURIComponent(wanted)}`);
    if (!ghUser) return i.editReply(ephemeral(`There's no GitHub user \`${wanted}\`.`));
    const taken = userOf(ghUser.login);
    if (taken && taken !== target.id && !isStaff(i.member)) return i.editReply(ephemeral(`\`${ghUser.login}\` is already linked to someone else. Ask a mod if that's wrong.`));
    for (const [id, login] of Object.entries(work.links)) if (id !== target.id && login.toLowerCase() === ghUser.login.toLowerCase()) delete work.links[id];
    work.links[target.id] = ghUser.login;
    save();
    refreshSoon();
    return i.editReply(ephemeral(`🔗 <@${target.id}> is GitHub **${ghUser.login}**: their pull requests show their Discord name on the board.`));
  },
};

// For end-to-end checks (scratch scripts): the GitHub client can be swapped.
export const _test = { work, setGitHub: (g) => { gh = g; }, release, rebuild, render, setRaw: (r) => { raw = r; } };

export function setup() {
  if (!enabled) return console.log('work board: off (GITHUB_TOKEN is not set)');
  console.log(`work board: on, ${Object.keys(work.claims).length} claims`);
  client.once('clientReady', async () => {
    await client.guilds.cache.first()?.members.fetch().catch(() => {}); // Discord names on the board from the first refresh
    refreshSoon(10_000);
    setInterval(() => refresh(), WORK.refreshMs);
  });
}
