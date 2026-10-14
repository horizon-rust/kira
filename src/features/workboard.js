// The work board: who's working on what in Horizon. #work-board has ONE pinned message Kira keeps
// editing (claimed issues, open pull requests with their status, merged in the last days), refreshed
// from GitHub every 10 minutes and after each command. #dev-log gets one line per pull request opened
// or merged and per claim, with no pings. /claim marks an issue as taken (the "in progress" label and a
// comment on GitHub); a claim lapses after 14 days without activity, with a DM a few days before.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, MessageType } from 'discord.js';
import { WORK, GITHUB, COLOR } from '../config.js';
import { client, state, save, channel, isStaff } from '../core.js';
import { makeGitHub } from '../github.js';
import * as wk from '../workkit.js';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
export const enabled = !!TOKEN; // claims write labels and comments: no token, no board
let gh = makeGitHub({ token: TOKEN });
const REPO = `/repos/${GITHUB.owner}/${WORK.repo}`;
const LABEL = encodeURIComponent(WORK.label);

// claims: number → { user, who, title, url, since, activity, reminded }; links: Discord id → GitHub login;
// board: the pinned message; logged: PR numbers already in #dev-log; seeded: false until the first look.
const work = (state.work ??= { claims: {}, links: {}, board: null, logged: { opened: [], merged: [] }, seeded: false });
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// Discord ↔ GitHub: links set with /link-github, then the known ones from config.js.
const links = () => ({ ...WORK.github, ...work.links });
const loginOf = (userId) => links()[userId] ?? null;
const userOf = (login) => Object.entries(links()).find(([, l]) => l.toLowerCase() === String(login).toLowerCase())?.[0] ?? null;
function displayName(userId) {
  const m = client.guilds.cache.first()?.members.cache.get(userId);
  return m?.displayName ?? client.users.cache.get(userId)?.globalName ?? null;
}
// The name the board shows for a GitHub login: the Discord name when it is linked.
const whoIs = (login) => (userOf(login) && displayName(userOf(login))) || login;
const nameOf = (member, user) => member?.displayName ?? user.globalName ?? user.username;

async function log(line) {
  const ch = channel('devlog');
  if (ch) await ch.send({ content: line, allowedMentions: { parse: [] } }).catch((e) => console.error('dev-log', e.message));
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
    mine.activity = Date.now();
    save();
    refreshSoon();
    return `#${n} is still yours: the ${WORK.expireDays} days start again.`;
  }
  if (issue.labels.some((l) => l.name === WORK.label) && !isStaff(member)) return `#${n} already has the **${WORK.label}** label on GitHub: someone is on it. Ask in #horizon-chat.`;
  const who = nameOf(member, user);
  await ensureLabel();
  await gh.write('POST', `${REPO}/issues/${n}/labels`, { labels: [WORK.label] });
  await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: wk.claimComment(who, loginOf(user.id), n, WORK.expireDays) });
  const entry = work.claims[n] = { user: user.id, who, title: issue.title, url: issue.html_url, since: Date.now(), activity: 0, reminded: 0 };
  save();
  await log(wk.logLine.claimed({ ...entry, number: n }));
  refreshSoon();
  return `🔨 #${n} **${issue.title}** is yours. The **${WORK.label}** label is on it, with a comment on GitHub. Open your pull request with "Fixes #${n}" in its description so it shows next to your claim. \`/unclaim ${n}\` if you stop; it lapses after ${WORK.expireDays} days without activity.`;
}

// Releases a claim (`why`: 'unclaimed', 'expired' or 'closed'). Removes the label; comments unless the issue closed.
async function release(n, why) {
  const entry = work.claims[n];
  if (!entry) return;
  await gh.write('DELETE', `${REPO}/issues/${n}/labels/${LABEL}`).catch((e) => console.error('unlabel', n, e.message));
  if (why !== 'closed') await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: wk.unclaimComment(entry.who, why) }).catch((e) => console.error('unclaim comment', n, e.message));
  delete work.claims[n];
  save();
  if (why === 'unclaimed') await log(wk.logLine.unclaimed({ ...entry, number: n }));
  if (why === 'expired') await log(wk.logLine.expired({ ...entry, number: n }, WORK.expireDays));
}

export async function unclaim(user, member, n) {
  const entry = work.claims[n];
  if (!entry) return `#${n} isn't claimed on Discord.`;
  if (entry.user !== user.id && !isStaff(member)) return `#${n} is claimed by **${entry.who}**: only they (or a mod) can unclaim it.`;
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

async function openPulls() {
  const pulls = await pages(`${REPO}/pulls?state=open`);
  return Promise.all(pulls.map(async (p) => {
    const [runs, status, reviews] = await Promise.all([
      gh.get(`${REPO}/commits/${p.head.sha}/check-runs?per_page=100`).catch(() => null),
      gh.get(`${REPO}/commits/${p.head.sha}/status`).catch(() => null),
      p.draft ? [] : gh.get(`${REPO}/pulls/${p.number}/reviews?per_page=100`).catch(() => []),
    ]);
    const ci = wk.ciState(runs?.check_runs, status?.statuses);
    return {
      number: p.number, title: p.title, url: p.html_url, login: p.user.login, updated: Date.parse(p.updated_at),
      status: wk.prStatus({ draft: p.draft, ci, review: wk.reviewState(reviews ?? []) }), fixes: wk.fixesIn(`${p.title}\n${p.body ?? ''}`),
    };
  }));
}

async function mergedPulls() {
  const since = Date.now() - WORK.mergedDays * wk.DAY;
  const closed = (await gh.get(`${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`)) ?? [];
  return closed.filter((p) => p.merged_at && Date.parse(p.merged_at) >= since)
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
    .map((p) => ({ number: p.number, title: p.title, url: p.html_url, login: p.user.login, at: Date.parse(p.merged_at), updated: Date.parse(p.updated_at), fixes: wk.fixesIn(`${p.title}\n${p.body ?? ''}`) }));
}

// Each claim: closed issues release it; activity (comments, commits, linked PRs) pushes the deadline;
// a reminder DM a few days before it lapses, then it lapses.
async function checkClaims(prs, merged) {
  const now = Date.now();
  for (const [key, entry] of Object.entries(work.claims)) {
    const n = Number(key);
    try {
      const issue = await gh.get(`${REPO}/issues/${n}`);
      if (!issue || issue.state !== 'open') { await release(n, 'closed'); continue; }
      entry.title = issue.title;
      const timeline = await pages(`${REPO}/issues/${n}/timeline`);
      const linked = [...prs, ...merged].filter((p) => p.fixes.includes(n)).map((p) => p.updated);
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
async function logPulls(prs, merged) {
  const L = (work.logged ??= { opened: [], merged: [] });
  if (!work.seeded) {
    for (const p of [...prs, ...merged]) L.opened = wk.remember(L.opened, p.number);
    for (const p of merged) L.merged = wk.remember(L.merged, p.number);
    work.seeded = true;
    return save();
  }
  for (const p of [...prs].sort((a, b) => a.number - b.number)) {
    if (L.opened.includes(p.number)) continue;
    L.opened = wk.remember(L.opened, p.number);
    save();
    await log(wk.logLine.opened({ ...p, who: whoIs(p.login) }));
  }
  for (const p of [...merged].reverse()) {
    if (L.merged.includes(p.number)) continue;
    L.merged = wk.remember(L.merged, p.number);
    L.opened = wk.remember(L.opened, p.number);
    save();
    await log(wk.logLine.merged({ ...p, who: whoIs(p.login) }));
  }
}

// ── The board ────────────────────────────────────────────────────────────────

let snapshot = { prs: [], merged: [], labelled: [], at: 0 };

function boardPayload() {
  const { prs, merged, labelled } = snapshot;
  const claims = Object.entries(work.claims).map(([n, c]) => ({
    number: Number(n), title: c.title, url: c.url, who: displayName(c.user) ?? c.who, since: c.since,
    prs: prs.filter((p) => p.fixes.includes(Number(n))).map((p) => p.number), lapses: wk.lapsesAt(c, WORK.expireDays),
  }));
  // "in progress" on GitHub without a Discord claim: shown, so the board tells the whole story.
  for (const i of labelled) {
    if (work.claims[i.number]) continue;
    claims.push({ number: i.number, title: i.title, url: i.html_url, who: i.assignees?.map((a) => whoIs(a.login)).join(', ') || 'someone', githubOnly: true });
  }
  claims.sort((a, b) => a.number - b.number);
  const text = wk.boardText({
    claims,
    prs: prs.map((p) => ({ ...p, who: whoIs(p.login) })).sort((a, b) => b.number - a.number),
    merged: merged.map((p) => ({ ...p, who: whoIs(p.login) })),
    mergedDays: WORK.mergedDays, now: Date.now(),
  });
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(text.title).setURL(`https://github.com/${GITHUB.owner}/${WORK.repo}/pulls`)
      .setDescription(text.description).setFooter({ text: text.footer }).setTimestamp(snapshot.at || Date.now())],
    allowedMentions: { parse: [] },
  };
}

// The one board message: the one the state remembers, else Kira's message with the board's title, else a new one. Pinned.
async function board() {
  const ch = channel('workboard');
  if (!ch) return null;
  let msg = work.board && await ch.messages.fetch(work.board).catch(() => null);
  if (!msg) {
    const pinned = await ch.messages.fetchPins().then((p) => p.items.map((x) => x.message)).catch(() => []);
    const recent = [...(await ch.messages.fetch({ limit: 50 })).values()];
    msg = [...pinned, ...recent].find((m) => m.author.id === client.user.id && m.embeds[0]?.title === wk.boardText({ claims: [], prs: [], merged: [], mergedDays: 0, now: 0 }).title) ?? null;
  }
  const payload = boardPayload();
  if (msg) await msg.edit(payload);
  else {
    msg = await ch.send(payload);
    console.log('work board posted', msg.id);
  }
  work.board = msg.id;
  save();
  if (!msg.pinned) {
    await msg.pin().catch((e) => console.error('pin board', e.message));
    // Discord's "Kira pinned a message" line: not needed in a read-only channel.
    const notice = (await ch.messages.fetch({ limit: 5 })).find((m) => m.type === MessageType.ChannelPinnedMessage && m.author.id === client.user.id);
    await notice?.delete().catch(() => {});
  }
  return msg;
}

let running = null;
export function refresh() {
  running ??= (async () => {
    try {
      const [prs, merged, labelled] = await Promise.all([openPulls(), mergedPulls(), pages(`${REPO}/issues?state=open&labels=${LABEL}`)]);
      await checkClaims(prs, merged);
      await logPulls(prs, merged);
      snapshot = { prs, merged, labelled: labelled.filter((i) => !i.pull_request), at: Date.now() };
      await board();
    } catch (e) {
      console.error('work board', e.message);
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
}

// A GitHub link to Horizon's pull requests or issues posted in the server: something probably changed.
export function onMessage(msg) {
  if (enabled && new RegExp(`github\\.com/${GITHUB.owner}/${WORK.repo}/(pull|issues)/\\d+`, 'i').test(msg.content)) refreshSoon(30_000);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function workingText() {
  const people = new Map(); // name → lines
  const add = (who, line) => people.set(who, [...(people.get(who) ?? []), line]);
  for (const [n, c] of Object.entries(work.claims)) add(displayName(c.user) ?? c.who, `🔨 #${n} ${c.title} (since <t:${Math.floor(c.since / 1000)}:R>)`);
  for (const p of snapshot.prs) add(whoIs(p.login), `🔀 PR #${p.number} ${p.title} · ${p.status}`);
  if (!people.size) return 'Nobody has claimed an issue or has a pull request open right now. Pick one on GitHub and `/claim` it.';
  const lines = [...people].map(([who, items]) => `**${who}**\n${items.map((l) => `• ${l}`).join('\n')}`);
  return `${lines.join('\n\n')}\n\nThe live view is in <#${state.channels.workboard}>.`.slice(0, 1990);
}

export const commands = enabled ? [
  new SlashCommandBuilder().setName('claim').setDescription('Tell everyone you are working on a Horizon issue (GitHub label + comment)')
    .addIntegerOption((o) => o.setName('issue').setDescription('The issue number on GitHub (ludovic111/horizon)').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('unclaim').setDescription('Stop working on an issue you claimed: it becomes free again')
    .addIntegerOption((o) => o.setName('issue').setDescription('The issue number').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('working').setDescription("Who's working on what: claimed issues and open pull requests"),
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

// For the end-to-end check (scratch scripts): the GitHub client can be swapped.
export const _test = { work, setGitHub: (g) => { gh = g; }, boardPayload, release };

export function setup() {
  if (!enabled) return console.log('work board: off (GITHUB_TOKEN is not set)');
  console.log(`work board: on, ${Object.keys(work.claims).length} claims`);
  client.once('clientReady', () => { refreshSoon(10_000); setInterval(() => refresh(), WORK.refreshMs); });
}

