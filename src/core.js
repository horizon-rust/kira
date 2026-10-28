// What every feature module shares: the client, the state, channel lookup, the mod log.
import { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits as P } from 'discord.js';
import { load, save } from './store.js';

export const state = load();
state.levels ??= {};
state.rooms ??= {};
state.modmail ??= {};
state.starboard ??= {};
state.reminders ??= [];
export { save };

let timer = null;
// For state that changes on every message (XP): written at most every 15 s.
export function saveSoon() {
  timer ??= setTimeout(() => { timer = null; save(); }, 15_000);
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildInvites, GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

// Message ids Kira deletes on purpose in bulk (src/features/chatclear.js): no "Message deleted" line each in #mod-log.
export const quietDeletes = new Set();

export const channel = (key) => client.channels.cache.get(state.channels[key]);
export const isStaff = (member) => !!member?.permissions?.has(P.ManageMessages);
export const clip = (s, n = 1000) => ((s ?? '').length > n ? s.slice(0, n - 1) + '…' : s) || '*(no text)*';
export const ago = (date) => {
  const d = Math.floor((Date.now() - date) / 86_400_000);
  return d < 1 ? 'less than a day' : d === 1 ? '1 day' : `${d} days`;
};

export async function modlog(title, description, color = 0x888888, fields = [], key = 'modlog') {
  const ch = channel(key);
  if (!ch) return null;
  return ch.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).addFields(fields).setTimestamp()], allowedMentions: { parse: [] } }).catch((e) => { console.error(e); return null; });
}

// "10m", "2h", "3d", "1h30m" → milliseconds (null if it can't be read).
export function parseDuration(text) {
  const parts = [...String(text).toLowerCase().matchAll(/(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)s?/g)];
  if (!parts.length) return null;
  const unit = { s: 1e3, sec: 1e3, m: 6e4, min: 6e4, h: 36e5, hr: 36e5, d: 864e5, day: 864e5, w: 6048e5, week: 6048e5 };
  return parts.reduce((t, [, n, u]) => t + Number(n) * unit[u], 0);
}
export const human = (ms) => {
  const units = [['w', 6048e5], ['d', 864e5], ['h', 36e5], ['min', 6e4], ['s', 1e3]];
  const out = [];
  for (const [u, v] of units) if (ms >= v) { out.push(`${Math.floor(ms / v)} ${u}`); ms %= v; }
  return out.slice(0, 2).join(' ') || '0 s';
};
