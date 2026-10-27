// Forum posts → GitHub issues, and answers back. A post in #horizon-bugs that passes its template, or a bug
// reported with /report, becomes an issue; the reporter's later replies become comments; Kira polls the issues and tells the reporter, in their
// post, when the issue is closed or a maintainer comments. Off unless GITHUB_TOKEN is set.
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, ChannelType } from 'discord.js';
import { GITHUB, GUILD_ID, AI } from '../config.js';
import { client, state, save, isStaff, modlog } from '../core.js';
import { makeGitHub } from '../github.js';
import { onTemplateOk, followsTemplate } from './forums.js';
import * as kit from '../issuekit.js';
import { isOwnPost } from '../adopt.js';
import { reviewBug, onBugPostMention } from './ai.js';
import { searchTerms, yesNo, missingAsk } from '../ai-kit.js';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
const DRY = process.env.KIRA_GITHUB_DRY_RUN === '1';
export const enabled = !!TOKEN || DRY; // a dry run works without a token (public repos, read only)
let gh = makeGitHub({ token: TOKEN, dryRun: DRY });
const OWNER = GITHUB.owner;
const full = (repo) => `${OWNER}/${repo}`;

// threadId → { repo, number, url, kind, owner, author, state, lastCommentId, votes, followups, answers }.
// In a dry run it lives in memory only, so nothing reaches data/state.json.
const blank = () => ({ issues: {}, created: [], polled: {}, labels: {}, pending: {} });
const store = !enabled ? blank() : DRY ? blank() : (state.github ??= blank());
store.pending ??= {}; // threadId → a report that may be the same bug as an open issue, waiting for the reporter's answer
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

// Opens the issue for a post (once: the mapping is checked first and kept in the state). Ideas no longer
// become issues (they go to the suggestion queue, src/features/hub.js): a forum with `queue` opens none unless
// a mod sends it with /issue.
async function openIssue(thread, starter, { manual = false, target = null } = {}) {
  if (isOwnPost(thread, client.user?.id)) return null; // the forum guides are not reports
  if (!manual && GITHUB.forums[forumKey(thread)]?.queue) return null;
  target ??= kit.targetFor(GITHUB.forums[forumKey(thread)], tagNames(thread));
  if (!target) return null;
  return fileIssue(thread, {
    authorId: starter.author.id,
    author: starter.member?.displayName ?? starter.author.globalName ?? starter.author.username,
    text: starter.content,
    attachments: [...starter.attachments.values()].map((a) => ({ name: a.name, url: a.url })),
    votes: target.kind === 'idea' ? upvotes(starter) : null,
  }, { manual, target });
}

// The issue for a bug reported with /report: Kira made the post, the member who reported it owns it (their
// replies become comments, the answers ping them).
export function reportIssue(thread, { authorId, author, text }) {
  return fileIssue(thread, { authorId, author, text, attachments: [], votes: null }, { target: { repo: GITHUB.forums.horizonbugs.repo, kind: 'bug' } });
}

async function fileIssue(thread, src, { manual = false, target }) {
  if (store.issues[thread.id] || busy.has(thread.id)) return store.issues[thread.id] ?? null;
  if (store.pending[thread.id]) return null; // waiting for the reporter: same bug as an open issue or not
  if (!manual && !kit.allow(store.created, src.authorId, Date.now(), GITHUB.rate)) {
    await modlog('🐙 Not sent to GitHub (rate limit)', `<#${thread.id}> by <@${src.authorId}>. A mod can send it with \`/issue\`.`);
    return null;
  }
  busy.add(thread.id);
  try {
    // A bug, with KIRA_AI_BUGS on: the model reads it next to the open issues GitHub finds for its title.
    const draft = !manual && target.kind === 'bug' ? await review(thread, src, target) : null;
    if (draft?.match?.same) return await addToIssue(thread, src, target, draft);
    if (draft?.match) {
      store.pending[thread.id] = { src, target, draft, at: Date.now() };
      save();
      await say(thread, `🔁 This looks like ${ref({ repo: target.repo, number: draft.match.number, url: draft.match.url })} (**${kit.safeTitle(draft.match.title)}**). <@${src.authorId}>, is it the same bug? Reply **yes** and I'll add your report there, or **no** and I'll file it as a new issue. With no answer, it's filed as new in ${Math.round(AI.pendingMs / 60_000)} minutes.`).catch(console.error);
      return null;
    }
    return await createIssue(thread, src, target, draft);
  } finally {
    busy.delete(thread.id);
  }
}

// The open issues GitHub's search finds for the post's title (the search API's own limit, not the hourly budget),
// then the model's draft; null without KIRA_AI_BUGS or when anything fails (the report is filed as it is).
async function review(thread, src, target) {
  try {
    const terms = searchTerms(thread.name);
    const q = `repo:${full(target.repo)} is:issue is:open ${terms.join(' OR ')}`;
    const found = terms.length ? (await gh.get(`/search/issues?q=${encodeURIComponent(q)}&per_page=8`, { cache: false }))?.items ?? [] : [];
    const candidates = found.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: String(i.body ?? '').slice(0, 600), url: i.html_url }));
    return await reviewBug({ title: thread.name, text: src.text, files: src.attachments.length, candidates, url: threadUrl(thread) });
  } catch (e) {
    console.error('github bug review', e.message);
    return null;
  }
}

async function createIssue(thread, src, target, draft = null, { related = null } = {}) {
  await ensureLabels(target.repo);
  const body = kit.issueBody({
    text: src.text, author: src.author, forum: thread.parent?.name ?? 'forum', threadUrl: threadUrl(thread), tags: tagNames(thread),
    attachments: src.attachments, votes: src.votes, notes: draft?.notes, related,
  });
  const issue = await gh.write('POST', `/repos/${full(target.repo)}/issues`, { title: kit.safeTitle(draft?.title || thread.name), body, labels: [GITHUB.labels[target.kind], GITHUB.labels.from] });
  if (!issue) return null; // dry run: logged
  const entry = store.issues[thread.id] = {
    repo: target.repo, number: issue.number, url: issue.html_url, kind: target.kind, owner: src.authorId, author: src.author,
    state: 'open', lastCommentId: 0, votes: src.votes, createdAt: Date.now(),
  };
  save();
  await say(thread, `📌 Sent to GitHub as ${ref(entry)}. You'll be pinged here when there's an answer.${draft?.missing.length ? `\n${missingAsk(draft.missing)}` : ''}`).catch(console.error);
  return entry;
}

// The same bug as an open issue: the report goes on it as a comment, and the post follows that issue.
async function addToIssue(thread, src, target, draft) {
  const { number } = draft.match;
  const issue = await gh.get(`/repos/${full(target.repo)}/issues/${number}`);
  if (!issue || issue.pull_request || issue.state !== 'open') return createIssue(thread, src, target, draft);
  const c = await gh.write('POST', `/repos/${full(target.repo)}/issues/${number}/comments`, { body: kit.reportComment({ author: src.author, threadUrl: threadUrl(thread), text: src.text, attachments: src.attachments }) });
  if (!c) return null; // dry run: logged
  await gh.write('POST', `/repos/${full(target.repo)}/issues/${number}/labels`, { labels: [GITHUB.labels.from] }).catch((e) => console.error('github label', e.message));
  const entry = store.issues[thread.id] = {
    repo: target.repo, number, url: issue.html_url, kind: target.kind, owner: src.authorId, author: src.author,
    state: 'open', lastCommentId: c.id ?? 0, votes: null, createdAt: Date.now(),
  };
  delete store.polled[target.repo]; // look at it from now on
  save();
  await say(thread, `📌 This is the same bug as ${ref(entry)}: I added your report there. You'll be pinged here when there's an answer.${draft.missing.length ? `\n${missingAsk(draft.missing)}` : ''}`).catch(console.error);
  return entry;
}

// The reporter's answer to "is it the same bug?", or the time running out (same = null: filed as new, the
// possible duplicate named in the issue).
async function settle(threadId, same, thread = null) {
  const p = store.pending[threadId];
  if (!p || busy.has(threadId)) return null;
  delete store.pending[threadId];
  save();
  thread ??= await client.channels.fetch(threadId).catch(() => null);
  if (!thread) return null;
  busy.add(threadId);
  try {
    return same ? await addToIssue(thread, p.src, p.target, p.draft) : await createIssue(thread, p.src, p.target, p.draft, { related: same === null ? p.draft.match.number : null });
  } finally {
    busy.delete(threadId);
  }
}

// A member's reports (for `/status`): their posts that became issues, newest first.
export const reportsOf = (userId) => Object.entries(store.issues).filter(([, e]) => e.owner === userId)
  .map(([thread, e]) => ({ thread, ...e })).sort((a, b) => b.createdAt - a.createdAt);

// A reply from the reporter in their post: queued, and sent as a comment if it adds something.
export async function onMessage(msg) {
  const p = enabled && store.pending[msg.channelId];
  if (p && msg.author.id === p.src.authorId) {
    const answer = yesNo(msg.content);
    if (!answer) return;
    await settle(msg.channelId, answer === 'yes', msg.channel).catch((e) => console.error('github settle', e.message));
    if (String(msg.content ?? '').trim().split(/\s+/).length <= 3) return; // a bare yes or no adds nothing to the issue
  }
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
      if (!kit.isOwnComment(c) && kit.isMaintainer(c, GITHUB.maintainer)) kit.queueAnswer(entry, { type: 'comment', author: c.user.login, body: c.body, url: c.html_url }, Date.now());
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
  for (const [threadId, p] of Object.entries(store.pending)) if (now - p.at >= AI.pendingMs) await settle(threadId, null).catch((e) => console.error('github settle', e.message));
  await sendFollowups(now);
  for (const [threadId, entry] of Object.entries(store.issues)) {
    const items = kit.takeAnswers(entry, now);
    if (items) await deliver(threadId, entry, items);
  }
  if (now - lastPoll >= GITHUB.pollEveryMs) { lastPoll = now; await poll(); }
  if (now - lastVotes >= 30 * kit.MINUTE) { lastVotes = now; await refreshVotes(); }
  if (!DRY) save();
}

// "@Kira …" inside a #horizon-bugs post is about that post. Not filed yet: the same path as a new post (template check,
// duplicate search, filing). Filed: the issue link. Returns true when it replied, false to leave the message to the
// general answers (GitHub off, Kira's own guide posts).
async function mentionInBugPost(msg) {
  const thread = msg.channel;
  const reply = (content) => msg.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch((e) => console.error('github mention reply', e.message));
  if (!enabled || !thread?.isThread?.() || isOwnPost(thread, client.user?.id)) return false;
  const entry = store.issues[thread.id];
  if (entry) { await reply(`This post is on GitHub as ${ref(entry)}${entry.state === 'closed' ? ' (closed)' : ''}.`); return true; }
  if (store.pending[thread.id]) { await reply(`I'm waiting for the reporter's yes or no above: is it the same bug as the issue I found? Then it's filed.`); return true; }
  if (busy.has(thread.id)) { await reply("I'm sending this post to GitHub right now."); return true; }
  const starter = await followsTemplate(thread).catch(() => false);
  if (!starter) {
    const waiting = state.formatChecks[thread.id];
    await reply(waiting ? "This post doesn't follow the template yet, so I haven't sent it to GitHub. Edit the first message with what my notice above asks for, and I'll file it." : "I can't send this post to GitHub (it's locked or I can't read its first message).");
    return true;
  }
  const filed = await openIssue(thread, starter);
  if (filed) await reply(`Sent to GitHub: ${ref(filed)}.`);
  else if (store.pending[thread.id]) await reply('I found a possible duplicate: see my question above.');
  else if (!DRY) await reply("I couldn't send it to GitHub just now; I've told the mods.");
  return true;
}
onBugPostMention((msg) => mentionInBugPost(msg));

// For the tests and the end-to-end check: the opening logic, the tick (with a given time), a fake GitHub.
export const _test = { openIssue, mentionInBugPost, onMessage, tick, store, setGitHub: (g) => { gh = g; } };

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
    if (isOwnPost(thread, client.user.id)) return i.reply({ content: 'That is one of my own posts, not a report.', flags: MessageFlags.Ephemeral });
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
