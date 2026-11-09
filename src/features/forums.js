// Forum posts: Kira checks each new post against its forum's template, asks for what's missing,
// and closes the post if it's still missing after the grace period. /done closes your own post with
// the forum's "done" tag (solved, taken, found, filled…).
import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { GUILD_ID, LAYOUT, MOD } from '../config.js';
import { client, state, save, isStaff, modlog } from '../core.js';
import { missingMessage, howToLink } from '../texts.js';
import { isOwnPost } from '../adopt.js';

state.formatChecks ??= {}; // threadId → { forum, owner, at, notice }
const forums = LAYOUT.flatMap((g) => g.channels).filter((c) => c.type === 'forum');
const forumOf = (parentId) => forums.find((f) => state.channels[f.key] === parentId);
const LINK = /https?:\/\/\S+/i;
// A member of one of the forum's `helpers` roles (🤝 Support in #horizon-support): closes posts there like a mod.
export const isHelper = (spec, member) => !!spec?.helpers?.some((k) => state.roles[k] && member?.roles?.cache?.has(state.roles[k]));

// Called with (thread, starter) when a post passes its template: right away, or once edited to pass.
const okHooks = [];
export const onTemplateOk = (fn) => okHooks.push(fn);
const passed = (thread, starter) => { for (const fn of okHooks) Promise.resolve().then(() => fn(thread, starter)).catch(console.error); };

// What a post is missing, as the template's labels.
export function missing(spec, msg) {
  const check = spec.check;
  if (!check) return [];
  const text = `${msg.channel.name ?? ''}\n${msg.content ?? ''}`;
  const out = [];
  for (const [label, re] of check.needs ?? []) if (!re.test(text)) out.push(label);
  if (check.media && !msg.attachments.size && !LINK.test(msg.content)) out.push('a file or a link');
  if (check.files && !msg.attachments.size && !msg.embeds.some((e) => e.image || e.video || e.thumbnail)) out.push('a screenshot or a video');
  if (check.min && (msg.content ?? '').length < check.min && !out.length) out.push(`more details (at least ${check.min} characters)`);
  return out;
}

// The post as one message: its first message plus what the poster added in replies, since people
// often fill in the template in a second message after Kira's notice (#120).
export function withReplies(starter, replies) {
  const own = replies.filter((m) => m.id !== starter.id && m.author?.id === starter.author.id);
  if (!own.length) return starter;
  return Object.assign(Object.create(starter), {
    content: [starter, ...own].map((m) => m.content ?? '').filter(Boolean).join('\n'),
    attachments: new Map([starter, ...own].flatMap((m) => [...m.attachments])),
    embeds: [starter, ...own].flatMap((m) => m.embeds ?? []),
  });
}

// Someone from the team (a mod, or the forum's helpers) answered in the post: a person took it, so
// Kira no longer closes it for the template.
export const answeredByTeam = (spec, starter, replies) =>
  replies.some((m) => !m.author?.bot && m.author?.id !== starter.author.id && (isStaff(m.member) || isHelper(spec, m.member)));

async function inspect(thread) {
  const spec = forumOf(thread.parentId);
  if (!spec?.check || isOwnPost(thread, client.user?.id)) return; // Kira's own "How to post here" posts are not member posts
  let starter = null;
  for (let tries = 0; tries < 5 && !starter; tries++) {
    starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!starter || starter.author.bot) return;
  const member = await thread.guild.members.fetch(starter.author.id).catch(() => null);
  if (isStaff(member)) return passed(thread, starter);
  const gaps = missing(spec, starter);
  if (!gaps.length) return passed(thread, starter);
  const notice = await thread.send(missingMessage(spec, gaps, starter.author.id, state));
  state.formatChecks[thread.id] = { forum: spec.key, owner: starter.author.id, at: Date.now(), notice: notice.id };
  save();
}

// Whether a post follows its template now (false while Kira is waiting for it to be fixed).
export async function followsTemplate(thread) {
  const spec = forumOf(thread.parentId);
  if (!spec || state.formatChecks[thread.id] || thread.locked || isOwnPost(thread, client.user?.id)) return false;
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter || starter.author.bot) return false;
  const member = await thread.guild.members.fetch(starter.author.id).catch(() => null);
  return isStaff(member) || !missing(spec, starter).length ? starter : false;
}

// Re-checks the posts that were missing something: fixed → the notice goes; too late → closed.
async function sweep() {
  for (const [threadId, c] of Object.entries(state.formatChecks)) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    const spec = forums.find((f) => f.key === c.forum);
    if (!thread || !spec) { delete state.formatChecks[threadId]; continue; }
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) { delete state.formatChecks[threadId]; continue; }
    const fetched = await thread.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) continue; // check again next minute rather than close on what Kira couldn't read
    const replies = [...fetched.values()];
    if (answeredByTeam(spec, starter, replies)) { delete state.formatChecks[threadId]; continue; }
    const post = withReplies(starter, replies);
    if (!missing(spec, post).length) {
      await thread.messages.delete(c.notice).catch(() => {});
      await thread.send('✅ Thanks, your post follows the template now.').then((m) => setTimeout(() => m.delete().catch(() => {}), 30_000)).catch(() => {});
      delete state.formatChecks[threadId];
      passed(thread, post);
    } else if (Date.now() - c.at > MOD.formatGraceMs) {
      await thread.send(`🔒 Closed: the template wasn't filled in. <@${c.owner}>, you can post again following ${howToLink(spec, state)} at the top of the forum.`).catch(() => {});
      await thread.setLocked(true).catch(() => {});
      await thread.setArchived(true).catch(() => {});
      await modlog('📝 Post closed (no template)', `<#${threadId}> by <@${c.owner}> in <#${thread.parentId}>`);
      delete state.formatChecks[threadId];
    }
  }
  save();
}

export const commands = [
  new SlashCommandBuilder().setName('done').setDescription('Mark your forum post as solved / taken / found / filled, and close it'),
];

export const handlers = {
  async done(i) {
    const thread = i.channel;
    const spec = thread?.isThread() && thread.parent?.type === ChannelType.GuildForum ? forumOf(thread.parentId) : null;
    if (!spec) return i.reply({ content: 'Use `/done` inside your own forum post.', flags: MessageFlags.Ephemeral });
    if (isOwnPost(thread, client.user.id)) return i.reply({ content: 'That is the guide of this forum, not a post to close.', flags: MessageFlags.Ephemeral });
    if (!spec.done) return i.reply({ content: `Posts in #${spec.name} don't get closed: they stay for everyone.`, flags: MessageFlags.Ephemeral });
    if (thread.ownerId !== i.user.id && !isStaff(i.member) && !isHelper(spec, i.member)) return i.reply({ content: `Only the person who posted it (or ${spec.helpers ? '🤝 Support or ' : ''}a mod) can close it.`, flags: MessageFlags.Ephemeral });
    const tagName = spec.done.split(' ').slice(1).join(' ');
    const tag = thread.parent.availableTags.find((t) => t.name === tagName);
    const tags = [...new Set([...(tag ? [tag.id] : []), ...thread.appliedTags])].slice(0, 5);
    await i.reply(`${spec.done.split(' ')[0]} Marked **${tagName}** by <@${i.user.id}>. Closing the post.`);
    await thread.setAppliedTags(tags).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  },
};

export function setup() {
  client.on('threadCreate', async (thread, newlyCreated) => {
    if (!newlyCreated || thread.guildId !== GUILD_ID || thread.parent?.type !== ChannelType.GuildForum) return;
    await inspect(thread).catch(console.error);
  });
  // An edit to the first message of a post: check it again right away.
  client.on('messageUpdate', async (before, after) => {
    if (after.guildId !== GUILD_ID || !state.formatChecks[after.channelId] || after.id !== after.channelId) return;
    await sweep().catch(console.error);
  });
  setInterval(() => sweep().catch(console.error), 60_000);
}
