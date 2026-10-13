// Forum posts → GitHub issues, and answers back. A post in #horizon-bugs, #horizon-ideas or
// #project-feedback (project + bug / idea tags) that passes its template becomes an issue; the
// reporter's later replies become comments; Kira polls the issues and tells the reporter, in their
// post, when the issue is closed or a maintainer comments. Off unless GITHUB_TOKEN is set.
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, ChannelType } from 'discord.js';
import { GITHUB, GUILD_ID } from '../config.js';
import { client, state, save, isStaff, modlog } from '../core.js';
import { makeGitHub } from '../github.js';
import { onTemplateOk, followsTemplate } from './forums.js';
import * as kit from '../issuekit.js';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
const DRY = process.env.KIRA_GITHUB_DRY_RUN === '1';
export const enabled = !!TOKEN || DRY; // a dry run works without a token (public repos, read only)
let gh = makeGitHub({ token: TOKEN, dryRun: DRY });
const OWNER = GITHUB.owner;
const full = (repo) => `${OWNER}/${repo}`;

// threadId → { repo, number, url, kind, owner, author, state, lastCommentId, votes, followups, answers }.
// In a dry run it lives in memory only, so nothing reaches data/state.json.
const blank = () => ({ issues: {}, created: [], polled: {}, labels: {} });
const store = !enabled ? blank() : DRY ? blank() : (state.github ??= blank());
const busy = new Set(); // threads being opened right now: one issue per post, even with two events at once

const forumKey = (thread) => Object.keys(GITHUB.forums).find((k) => state.channels[k] === thread.parentId);
const tagNames = (thread) => thread.appliedTags.map((id) => thread.parent?.availableTags.find((t) => t.id === id)?.name).filter(Boolean);
const threadUrl = (thread) => `https://discord.com/channels/${GUILD_ID}/${thread.id}`;
const ref = (e) => (GITHUB.private.includes(e.repo) ? `${e.repo}#${e.number}` : `${e.repo}#${e.number} · <${e.url}>`);
const upvotes = (msg) => {
  const r = msg.reactions.cache.get('👍');
  return r ? Math.max(0, r.count - (r.me ? 1 : 0)) : 0;
};
const say = async (thread, content) => (DRY ? console.log(`github dry-run: in #${thread.name}: ${content}`) : thread.send({ content, allowedMentions: { parse: [] } }));

async function ensureLabels(repo) {
  if (store.labels[repo]) return;
  const colors = { bug: 'd73a4a', enhancement: 'a2eeef', [GITHUB.labels.from]: '5865f2' };
  for (const name of [GITHUB.labels.bug, GITHUB.labels.idea, GITHUB.labels.from]) {
    if (!(await gh.get(`/repos/${full(repo)}/labels/${encodeURIComponent(name)}`))) {
      await gh.write('POST', `/repos/${full(repo)}/labels`, { name, color: colors[name] ?? 'ededed', description: name === GITHUB.labels.from ? 'Reported on the Discord server' : undefined });
    }
  }
  if (!DRY) store.labels[repo] = true;
}

// Opens the issue for a post (once: the mapping is checked first and kept in the state).
async function openIssue(thread, starter, { manual = false, target = null } = {}) {
  if (store.issues[thread.id] || busy.has(thread.id)) return store.issues[thread.id] ?? null;
  target ??= kit.targetFor(GITHUB.forums[forumKey(thread)], tagNames(thread));
  if (!target) return null;
  if (!manual && !kit.allow(store.created, starter.author.id, Date.now(), GITHUB.rate)) {
    await modlog('🐙 Not sent to GitHub (rate limit)', `<#${thread.id}> by <@${starter.author.id}>. A mod can send it with \`/issue\`.`);
    return null;
  }
  busy.add(thread.id);
  try {
    await ensureLabels(target.repo);
    const author = starter.member?.displayName ?? starter.author.globalName ?? starter.author.username;
    const votes = target.kind === 'idea' ? upvotes(starter) : null;
    const body = kit.issueBody({
      text: starter.content, author, forum: thread.parent?.name ?? 'forum', threadUrl: threadUrl(thread), tags: tagNames(thread),
      attachments: [...starter.attachments.values()].map((a) => ({ name: a.name, url: a.url })), votes,
    });
    const issue = await gh.write('POST', `/repos/${full(target.repo)}/issues`, { title: kit.safeTitle(thread.name), body, labels: [GITHUB.labels[target.kind], GITHUB.labels.from] });
    if (!issue) return null; // dry run: logged
    const entry = store.issues[thread.id] = {
      repo: target.repo, number: issue.number, url: issue.html_url, kind: target.kind, owner: starter.author.id, author,
      state: 'open', lastCommentId: 0, votes, createdAt: Date.now(),
    };
    save();
    await say(thread, `📌 Sent to GitHub as ${ref(entry)}. You'll be pinged here when there's an answer.`).catch(console.error);
    return entry;
  } finally {
    busy.delete(thread.id);
  }
}

// A reply from the reporter in their post: queued, and sent as a comment if it adds something.
export async function onMessage(msg) {
  const entry = enabled && store.issues[msg.channelId];
  if (!entry || msg.author.id !== entry.owner || msg.id === msg.channelId) return;
  if (kit.isNoise(msg.content, msg.attachments.size)) return;
  kit.queueFollowup(entry, { text: msg.content, files: [...msg.attachments.values()].map((a) => ({ name: a.name, url: a.url })) }, Date.now());
  if (!DRY) save();
}

async function sendFollowups(now) {
  for (const entry of Object.values(store.issues)) {
    const items = kit.takeFollowups(entry, now);
    if (!items) continue;
    const c = await gh.write('POST', `/repos/${full(entry.repo)}/issues/${entry.number}/comments`, { body: kit.followupComment(entry.author, items) }).catch((e) => { console.error('github followup', e.message); entry.followups = [...items, ...(entry.followups ?? [])]; });
    if (c?.id) entry.lastCommentId = Math.max(entry.lastCommentId, c.id);
  }
}

// Tells the reporter, in their post, with a ping for them alone (none if they left the server).
async function deliver(threadId, entry, items) {
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) return;
  const member = await thread.guild.members.fetch(entry.owner).catch(() => null);
  const closed = items.find((i) => i.type === 'closed');
  const payload = kit.mentionPayload(member ? entry.owner : null, kit.answerText(items, ref(entry)));
  if (DRY) return console.log(`github dry-run: in #${thread.name}: ${JSON.stringify(payload)}`);
  const wasArchived = thread.archived;
  if (wasArchived) await thread.setArchived(false).catch(() => {});
  await thread.send(payload).catch(console.error);
  if (closed) {
    const spec = GITHUB.forums[forumKey(thread)] ?? {};
    const tagName = { fixed: spec.fixed, not_planned: spec.notPlanned, duplicate: spec.duplicate ?? spec.notPlanned }[closed.outcome.kind];
    const tag = tagName && thread.parent?.availableTags.find((t) => t.name === tagName);
    if (tag) await thread.setAppliedTags([...new Set([tag.id, ...thread.appliedTags])].slice(0, 5)).catch(() => {});
  }
  if (wasArchived || closed?.outcome.kind === 'fixed') await thread.setArchived(true).catch(() => {});
  if (GITHUB.notifyByDm && member) await member.send(`Your post **${thread.name}** got an answer: ${thread.url}`).catch(() => {});
}

// The release a fixed issue shipped in, if Kira can tell.
async function fixRelease(entry) {
  const repo = full(entry.repo);
  const src = kit.fixSource((await gh.get(`/repos/${repo}/issues/${entry.number}/timeline?per_page=100`)) ?? [], repo);
  const sha = src?.commit ?? (src?.pr ? (await gh.get(`/repos/${repo}/pulls/${src.pr}`))?.merge_commit_sha : null);
  if (!sha) return { commitKnown: false, release: null };
  const releases = (await gh.get(`/repos/${repo}/releases?per_page=10`)) ?? [];
  const release = await kit.firstRelease(releases, async (tag) => ['ahead', 'identical'].includes((await gh.get(`/repos/${repo}/compare/${sha}...${encodeURIComponent(tag)}`))?.status));
  return { commitKnown: true, release };
}

// One issue that changed on GitHub, for every post linked to it.
async function update(issue, threads, since) {
  const repo = threads[0][1].repo;
  const comments = issue.comments ? (await gh.get(`/repos/${full(repo)}/issues/${issue.number}/comments?since=${since}&per_page=100`)) ?? [] : [];
  let release = null;
  for (const [threadId, entry] of threads) {
    for (const c of comments) {
      if (c.id <= entry.lastCommentId) continue;
      if (!kit.isOwnComment(c) && kit.isMaintainer(c, OWNER)) kit.queueAnswer(entry, { type: 'comment', author: c.user.login, body: c.body, url: c.html_url }, Date.now());
    }
    entry.lastCommentId = Math.max(entry.lastCommentId, ...comments.map((c) => c.id));
    if (issue.state === 'closed' && entry.state !== 'closed') {
      entry.state = 'closed';
      const outcome = kit.closeOutcome(issue, comments);
      release ??= outcome.kind === 'fixed' ? await fixRelease(entry) : {};
      const dupThread = outcome.of && Object.entries(store.issues).find(([, e]) => e.repo === repo && e.number === outcome.of)?.[0];
      const dupUrl = dupThread ? `<#${dupThread}>` : outcome.of && !GITHUB.private.includes(repo) ? `<https://github.com/${full(repo)}/issues/${outcome.of}>` : null;
      kit.queueAnswer(entry, { type: 'closed', outcome, release: release.release, commitKnown: release.commitKnown, dupUrl }, Date.now());
      const items = kit.takeAnswers(entry, Date.now(), { force: true });
      await deliver(threadId, entry, items);
    } else if (issue.state === 'open' && entry.state === 'closed') {
      entry.state = 'open'; // reopened: answers flow again
    }
  }
}

// Every few minutes: the issues of each repo updated since the last look (one request per repo).
async function poll() {
  const byRepo = {};
  for (const [threadId, e] of Object.entries(store.issues)) (byRepo[e.repo] ??= []).push([threadId, e]);
  for (const [repo, threads] of Object.entries(byRepo)) {
    const startedAt = new Date().toISOString();
    const since = store.polled[repo] ?? new Date(Math.min(...threads.map(([, e]) => e.createdAt))).toISOString();
    try {
      for (let page = 1; page <= 5; page++) {
        const list = (await gh.get(`/repos/${full(repo)}/issues?labels=${encodeURIComponent(GITHUB.labels.from)}&state=all&since=${since}&per_page=100&page=${page}`)) ?? [];
        for (const issue of list) {
          const linked = threads.filter(([, e]) => e.number === issue.number);
          if (linked.length && !issue.pull_request) await update(issue, linked, since);
        }
        if (list.length < 100) break;
      }
      if (!DRY) store.polled[repo] = startedAt;
    } catch (e) {
      console.error('github poll', repo, e.message);
    }
  }
}

// 👍 on ideas: a line in the issue body, updated when the count changes.
async function refreshVotes() {
  for (const [threadId, entry] of Object.entries(store.issues)) {
    if (entry.kind !== 'idea' || entry.state !== 'open') continue;
    const thread = await client.channels.fetch(threadId).catch(() => null);
    const starter = await thread?.fetchStarterMessage().catch(() => null);
    if (!starter) continue;
    const n = upvotes(starter);
    if (n === entry.votes) continue;
    const issue = await gh.get(`/repos/${full(entry.repo)}/issues/${entry.number}`);
    if (!issue) continue;
    await gh.write('PATCH', `/repos/${full(entry.repo)}/issues/${entry.number}`, { body: kit.withVotes(issue.body, n) });
    if (!DRY) entry.votes = n;
  }
}

let lastPoll = 0;
let lastVotes = 0;
async function tick(now = Date.now()) {
  await sendFollowups(now);
  for (const [threadId, entry] of Object.entries(store.issues)) {
    const items = kit.takeAnswers(entry, now);
    if (items) await deliver(threadId, entry, items);
  }
  if (now - lastPoll >= GITHUB.pollEveryMs) { lastPoll = now; await poll(); }
  if (now - lastVotes >= 30 * kit.MINUTE) { lastVotes = now; await refreshVotes(); }
  if (!DRY) save();
}

// For the tests and the end-to-end check: the opening logic, the tick (with a given time), a fake GitHub.
export const _test = { openIssue, onMessage, tick, store, setGitHub: (g) => { gh = g; } };

export const commands = enabled ? [
  new SlashCommandBuilder().setName('issue').setDescription('Staff: send this forum post to GitHub as an issue, or link it to an existing one')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('link').setDescription('Link to this existing issue number instead (duplicates)').setMinValue(1))
    .addStringOption((o) => o.setName('repo').setDescription('Repo (default: from the forum and tags)')
      .addChoices(...[...new Set(Object.values(GITHUB.forums).flatMap((f) => (f.repo ? [f.repo] : Object.values(f.projects))))].map((r) => ({ name: r, value: r }))))
    .addStringOption((o) => o.setName('kind').setDescription('Bug or idea (default: from the forum and tags)').addChoices({ name: 'bug', value: 'bug' }, { name: 'idea', value: 'idea' })),
] : [];

export const handlers = {
  async issue(i) {
    const thread = i.channel;
    if (!isStaff(i.member)) return i.reply({ content: 'Only mods can do that.', flags: MessageFlags.Ephemeral });
    if (!thread?.isThread() || thread.parent?.type !== ChannelType.GuildForum) return i.reply({ content: 'Use `/issue` inside a forum post.', flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const auto = kit.targetFor(GITHUB.forums[forumKey(thread)], tagNames(thread));
    const repo = i.options.getString('repo') ?? auto?.repo;
    const kind = i.options.getString('kind') ?? auto?.kind ?? 'bug';
    if (!repo) return i.editReply('Which repo? Pass `repo:` (this forum has no default).');
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) return i.editReply('I can\'t read the first message of this post.');
    const number = i.options.getInteger('link');
    if (!number) {
      const existing = store.issues[thread.id];
      if (existing) return i.editReply(`Already on GitHub: ${ref(existing)}`);
      const entry = await openIssue(thread, starter, { manual: true, target: { repo, kind } });
      return i.editReply(entry ? `Opened ${ref(entry)}` : DRY ? 'Dry run: logged what would be sent.' : 'Nothing was opened (see the logs).');
    }
    const issue = await gh.get(`/repos/${full(repo)}/issues/${number}`);
    if (!issue || issue.pull_request) return i.editReply(`There's no issue #${number} in ${repo}.`);
    const comments = issue.comments ? (await gh.get(`/repos/${full(repo)}/issues/${number}/comments?per_page=100`)) ?? [] : [];
    const author = starter.member?.displayName ?? starter.author.globalName ?? starter.author.username;
    const entry = {
      repo, number, url: issue.html_url, kind, owner: starter.author.id, author, state: issue.state,
      lastCommentId: Math.max(0, ...comments.map((c) => c.id)), votes: null, createdAt: Date.now(),
    };
    await gh.write('POST', `/repos/${full(repo)}/issues/${number}/labels`, { labels: [GITHUB.labels.from] });
    const c = await gh.write('POST', `/repos/${full(repo)}/issues/${number}/comments`, { body: kit.linkComment(author, threadUrl(thread)) });
    if (c?.id) entry.lastCommentId = Math.max(entry.lastCommentId, c.id);
    if (DRY) return i.editReply(`Dry run: would link this post to ${ref(entry)}.`);
    store.issues[thread.id] = entry;
    delete store.polled[repo]; // look at it from its link time on
    save();
    await say(thread, `📌 Linked to GitHub issue ${ref(entry)}. ${entry.state === 'closed' ? 'It\'s already closed.' : 'You\'ll be pinged here when there\'s an answer.'}`);
    return i.editReply(`Linked to ${ref(entry)}.`);
  },
};

export function setup() {
  if (!enabled) return console.log('github issues: off (GITHUB_TOKEN is not set)');
  console.log(`github issues: on${DRY ? ' (dry run: nothing is written)' : ''}, ${Object.keys(store.issues).length} posts linked`);
  onTemplateOk(async (thread, starter) => {
    if (thread.guildId === GUILD_ID && forumKey(thread)) await openIssue(thread, starter);
  });
  // #project-feedback: the bug / idea tag can come after the post (an edit of its tags).
  client.on('threadUpdate', async (before, after) => {
    if (after.guildId !== GUILD_ID || !forumKey(after) || store.issues[after.id]) return;
    if ((before.appliedTags ?? []).join() === (after.appliedTags ?? []).join()) return;
    const starter = await followsTemplate(after).catch(() => false);
    if (starter) await openIssue(after, starter).catch(console.error);
  });
  setInterval(() => tick().catch((e) => console.error('github', e)), kit.MINUTE);
}
