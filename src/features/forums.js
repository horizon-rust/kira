// Forum posts: Kira checks each new post against its forum's template, asks for what's missing,
// and closes the post if it's still missing after the grace period. /done closes your own post with
// the forum's "done" tag (solved, taken, found, filled…).
import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { GUILD_ID, LAYOUT, MOD } from '../config.js';
import { client, state, save, isStaff, modlog } from '../core.js';
import { missingMessage } from '../texts.js';

state.formatChecks ??= {}; // threadId → { forum, owner, at, notice }
const forums = LAYOUT.flatMap((g) => g.channels).filter((c) => c.type === 'forum');
const forumOf = (parentId) => forums.find((f) => state.channels[f.key] === parentId);
const LINK = /https?:\/\/\S+/i;

// What a post is missing, as the template's labels.
function missing(spec, msg) {
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

async function inspect(thread) {
  const spec = forumOf(thread.parentId);
  if (!spec?.check) return;
  let starter = null;
  for (let tries = 0; tries < 5 && !starter; tries++) {
    starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!starter || starter.author.bot) return;
  const member = await thread.guild.members.fetch(starter.author.id).catch(() => null);
  if (isStaff(member)) return;
  const gaps = missing(spec, starter);
  if (!gaps.length) return;
  const notice = await thread.send(missingMessage(spec, gaps, starter.author.id));
  state.formatChecks[thread.id] = { forum: spec.key, owner: starter.author.id, at: Date.now(), notice: notice.id };
  save();
}

// Re-checks the posts that were missing something: fixed → the notice goes; too late → closed.
async function sweep() {
  for (const [threadId, c] of Object.entries(state.formatChecks)) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    const spec = forums.find((f) => f.key === c.forum);
    if (!thread || !spec) { delete state.formatChecks[threadId]; continue; }
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) { delete state.formatChecks[threadId]; continue; }
    if (!missing(spec, starter).length) {
      await thread.messages.delete(c.notice).catch(() => {});
      await thread.send('✅ Thanks, your post follows the template now.').then((m) => setTimeout(() => m.delete().catch(() => {}), 30_000)).catch(() => {});
      delete state.formatChecks[threadId];
    } else if (Date.now() - c.at > MOD.formatGraceMs) {
      await thread.send(`🔒 Closed: the template wasn't filled in. <@${c.owner}>, you can post again following the pinned post.`).catch(() => {});
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
    if (!spec.done) return i.reply({ content: `Posts in #${spec.name} don't get closed: they stay for everyone.`, flags: MessageFlags.Ephemeral });
    if (thread.ownerId !== i.user.id && !isStaff(i.member)) return i.reply({ content: 'Only the person who posted it (or a mod) can close it.', flags: MessageFlags.Ephemeral });
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
