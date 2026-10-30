// #horizon-support (Ludovic, 2026-10-30): where players ask for help, apart from the bugs. A new post that follows its
// template gets Kira's first answer (when her AI is on, from her sources only) and a note for 🤝 Support, pinging the
// role at most once every SUPPORT.pingEveryMs. Only the poster, 🤝 Support and the staff write in a post: Kira removes
// other members' replies with a short note. Posts here are never GitHub issues (GITHUB.forums doesn't list the forum).
import { GUILD_ID, LAYOUT, SUPPORT } from '../config.js';
import { client, state, save, isStaff, modlog, clip, quietDeletes } from '../core.js';
import { onTemplateOk, isHelper } from './forums.js';
import { isOwnPost } from '../adopt.js';
import { linkify } from '../texts.js';
import { rateLimiter } from '../agents.js';
import { supportAnswer } from './ai.js';
import * as kit from '../support-kit.js';

const spec = LAYOUT.flatMap((g) => g.channels).find((c) => c.key === SUPPORT.forum);
const store = (state.support ??= { lastPing: 0, waiting: [] });
const notes = rateLimiter({ note: [1, SUPPORT.noteEveryMs] });
const inForum = (thread) => !!thread && thread.guildId === GUILD_ID && !!state.channels[SUPPORT.forum] && thread.parentId === state.channels[SUPPORT.forum];

// A post that follows the template: Kira's first answer, then the note for 🤝 Support.
export async function newPost(thread, starter, now = Date.now()) {
  if (!inForum(thread) || isOwnPost(thread, client.user?.id) || store.seen?.[thread.id]) return;
  (store.seen ??= {})[thread.id] = now;
  for (const [id, at] of Object.entries(store.seen)) if (now - at > 30 * 86_400_000) delete store.seen[id];
  save();
  await supportAnswer(thread, starter).catch((e) => console.error('support first answer', e.message));
  const note = kit.supportNote({ roleId: state.roles[SUPPORT.role], threadId: thread.id, lastPing: store.lastPing, waiting: store.waiting, now, everyMs: SUPPORT.pingEveryMs });
  store.waiting = note.waiting;
  if (note.ping) store.lastPing = now;
  save();
  await thread.send({ content: note.content, allowedMentions: { parse: [], roles: note.ping ? [state.roles[SUPPORT.role]] : [] } }).catch((e) => console.error('support note', e.message));
}

// A reply in someone else's post by a member who isn't 🤝 Support or staff: removed, with a note (once in a while).
export async function onMessage(msg) {
  const thread = msg.channel;
  if (spec?.replies !== 'helpers' || msg.author?.bot || !thread?.isThread?.() || !inForum(thread) || msg.id === thread.id) return false;
  if (kit.mayReply({ isOwner: thread.ownerId === msg.author.id, isHelper: isHelper(spec, msg.member), isStaff: isStaff(msg.member), isBot: msg.author.bot })) return false;
  quietDeletes.add(msg.id); // the line below logs it, with its text: no second "Message deleted" line
  await msg.delete().catch((e) => { quietDeletes.delete(msg.id); console.error('support reply', e.message); });
  await modlog('🤝 Reply removed in #horizon-support', `<@${msg.author.id}> in <#${thread.id}> (not the poster, not 🤝 Support)\n> ${clip(msg.content, 300)}`);
  if (notes.take(msg.author.id, 'note')) {
    const note = await thread.send({ content: linkify(kit.replyNote(msg.author.id, state.roles[SUPPORT.role] ? `<@&${state.roles[SUPPORT.role]}>` : undefined), state), allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), SUPPORT.noteMs).unref?.();
  }
  return true;
}

export const commands = [];
export const handlers = {};
export const _test = { store, newPost, onMessage };

export function setup() {
  onTemplateOk((thread, starter) => newPost(thread, starter));
  client.on('messageCreate', (msg) => { onMessage(msg).catch((e) => console.error('support', e)); });
}
