// The 18+ declaration on Discord (rules and texts in src/age-kit.js). Only with KIRA_GOVERNANCE and KIRA_AGE_DECLARATION
// both on: otherwise no command, no listener, no DM. Then:
// - `/age-declaration` shows anyone the button; the button (in a DM or on the server) records { yes, at } under the
//   member's id in state.age.declared, and nothing else.
// - Once Kira is ready, a sweep DMs every holder of a role of trust (AGE.roles) who hasn't declared, once each
//   (state.age.asked: id → when). Every hour after that: holders asked AGE.days ago and still not declared are listed
//   once in #council for the council to act on (GOVERNANCE.md 9). Kira pauses no role herself.
// - `required(role)` and `isDeclared(id)` let other features refuse a role of trust without a declaration.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GUILD_ID, GOVERNANCE, AGE } from '../config.js';
import { client, state, save } from '../core.js';
import * as kit from '../age-kit.js';

export const enabled = () => GOVERNANCE.on && AGE.on;
const age = () => (state.age ??= { declared: {}, asked: {}, reported: [] });
const roleIds = () => AGE.roles.map((k) => state.roles?.[k] || GOVERNANCE.roles[k] || AGE.extraRoles[k]);
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });

export const isDeclared = (id) => kit.isDeclared(age().declared, id);
// Whether giving `roleKey` needs a declaration first (always false while the switch is off).
export const required = (roleKey) => enabled() && AGE.roles.includes(roleKey);

export const commands = enabled() ? [
  new SlashCommandBuilder().setName('age-declaration').setDescription('The 18+ declaration that every important role needs'),
] : [];

export const handlers = {
  async 'age-declaration'(i) {
    if (!enabled()) return i.reply(ephemeral('The 18+ declaration is not on yet.'));
    if (isDeclared(i.user.id)) return i.reply(ephemeral(kit.already));
    return i.reply(ephemeral(kit.promptText, { components: [kit.button] }));
  },
};

// The button: from a DM or on the server.
export async function onButton(i, now = Date.now()) {
  if (isDeclared(i.user.id)) return i.reply({ content: kit.already, allowedMentions: { parse: [] }, ...(i.guildId ? { flags: MessageFlags.Ephemeral } : {}) });
  age().declared = kit.record(age().declared, i.user.id, now);
  save();
  return i.reply({ content: kit.thanks, allowedMentions: { parse: [] }, ...(i.guildId ? { flags: MessageFlags.Ephemeral } : {}) });
}

// The current holders of a role of trust (from the guild's member list).
async function currentHolders() {
  const g = client.guilds.cache.get(GUILD_ID);
  if (!g) return [];
  const all = await g.members.fetch();
  return kit.holders([...all.values()].map((m) => ({ id: m.id, bot: !!m.user?.bot, roles: [...m.roles.cache.keys()] })), roleIds());
}

// DMs every holder who hasn't declared and wasn't asked yet, one at a time. → the ids asked now.
export async function sweep(now = Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const ids = kit.toAsk(await currentHolders(), age().declared, age().asked);
  const asked = [];
  for (const id of ids) {
    try {
      const user = await client.users.fetch(id);
      await user.send({ content: kit.dmText(now + AGE.days * kit.DAY), components: [kit.button], allowedMentions: { parse: [] } });
      age().asked[id] = now;
      asked.push(id);
      save();
    } catch (e) {
      console.error('age dm', id, e.message); // closed DMs: asked again on the next start; /age-declaration works too
    }
    if (AGE.dmGapMs) await wait(AGE.dmGapMs);
  }
  return asked;
}

// Lists, once, the holders whose time is up and who haven't declared, in #council (private). → the ids listed.
export async function report(now = Date.now()) {
  const late = kit.overdue(await currentHolders(), age().declared, age().asked, now, AGE.days).filter((id) => !age().reported.includes(id));
  if (!late.length) return [];
  const ch = client.channels.cache.get(state.channels?.council || GOVERNANCE.channels.council);
  if (!ch) return [];
  await ch.send({ content: kit.overdueText(late, AGE.days), allowedMentions: { parse: [] } });
  age().reported.push(...late);
  save();
  return late;
}

export function setup() {
  if (!enabled()) return;
  client.on('interactionCreate', (i) => { if (i.isButton?.() && i.customId === 'age:yes' && (!i.guildId || i.guildId === GUILD_ID)) onButton(i).catch((e) => console.error('age button', e)); });
  client.once('clientReady', () => {
    setTimeout(() => sweep().catch((e) => console.error('age sweep', e.message)), 60_000).unref?.();
    setInterval(() => report().catch((e) => console.error('age report', e.message)), 3_600_000).unref?.();
  });
}
