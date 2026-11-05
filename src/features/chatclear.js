// Regular chat clears (CLEAR in config.js): every 6 hours, the messages older than a day in #horizon-chat and #general
// are deleted. Pinned messages and messages that started a thread stay; no other channel, forum or thread is touched.
// /clear-chat (mods) does the same now in the current channel. Each run is one line in #mod-log.
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, ChannelType } from 'discord.js';
import { CLEAR, LAYOUT } from '../config.js';
import { client, state, save, channel, modlog, quietDeletes } from '../core.js';
import { sortForClear, oldestId, batches, clearAllowed, clearLine } from '../clear-kit.js';

const running = new Set(); // channel ids being cleared: one clear at a time per channel
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3_600_000;

// Deletes the messages of `ch` older than `olderThanMs`, newest page first. Messages under 14 days old go in bulk
// deletes; older ones one by one, paced (discord.js waits out the rate limits it is told about). Null if already running.
export async function clearChannel(ch, olderThanMs) {
  if (running.has(ch.id)) return null;
  running.add(ch.id);
  const counts = { deleted: 0, pinned: 0, threads: 0, failed: 0 };
  try {
    let before;
    for (;;) {
      const page = await ch.messages.fetch({ limit: 100, before, cache: false });
      if (!page.size) break;
      before = oldestId([...page.keys()]);
      // A thread's starter: the cached thread, or the flag Discord sets on it (archived threads aren't cached).
      const msgs = [...page.values()].map((m) => ({ id: m.id, createdTimestamp: m.createdTimestamp, pinned: m.pinned, hasThread: m.hasThread || !!m.flags?.has(MessageFlags.HasThread), deletable: m.deletable }));
      const pick = sortForClear(msgs, { now: Date.now(), olderThanMs });
      counts.pinned += pick.pinned; counts.threads += pick.threads; counts.failed += pick.undeletable;
      for (const ids of batches(pick.bulk)) {
        if (ids.length === 1) { pick.single.unshift(ids[0]); continue; }
        try { counts.deleted += (await ch.bulkDelete(ids, true)).size; } catch (e) { counts.failed += ids.length; console.error('chat clear: bulk', e.message); }
      }
      for (const id of pick.single) {
        quietDeletes.add(id); // not one "Message deleted" line per message in #mod-log
        try { await ch.messages.delete(id); counts.deleted++; } catch (e) { quietDeletes.delete(id); if (e.code !== 10008) { counts.failed++; console.error('chat clear: delete', e.message); } }
        await sleep(CLEAR.singlePaceMs);
      }
      if (page.size < 100) break;
    }
  } finally {
    running.delete(ch.id);
  }
  return counts;
}

// The scheduled clear: due when the last one is CLEAR.everyMs old (state.chatClear.lastRun, so a restart doesn't reset it).
async function scheduled() {
  state.chatClear ??= {};
  if (Date.now() - (state.chatClear.lastRun ?? 0) < CLEAR.everyMs) return;
  state.chatClear.lastRun = Date.now();
  save();
  const results = [];
  for (const key of CLEAR.channels) {
    const ch = channel(key);
    if (!ch) { console.log(`chat clear: no #${key} yet`); continue; }
    const c = await clearChannel(ch, CLEAR.olderThanHours * HOUR);
    if (c) results.push([ch.id, c]);
  }
  const line = clearLine(results, CLEAR.olderThanHours);
  console.log('chat clear:', line);
  await modlog('🧹 Chat clear', line, 0x5aa9ff);
}

const specs = new Map(LAYOUT.flatMap((g) => g.channels.map((c) => [c.key, { ...c, staff: c.staff || g.staff }])));
const specOf = (id) => specs.get(Object.keys(state.channels).find((k) => state.channels[k] === id));

export const commands = [
  new SlashCommandBuilder().setName('clear-chat').setDescription(`Delete this channel's messages older than ${CLEAR.olderThanHours} h (pins stay)`)
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('older_than').setDescription(`Hours (default ${CLEAR.olderThanHours})`).setMinValue(1).setMaxValue(24 * 90)),
];

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

export const handlers = {
  async 'clear-chat'(i) {
    const ch = i.channel;
    const ok = clearAllowed({ isText: ch?.type === ChannelType.GuildText, spec: specOf(ch?.id), staffParent: ch?.parentId === state.channels['cat:staff'] });
    if (!ok) return i.reply(ephemeral('Only in a chat channel: not in threads, forums, read-only or staff channels.'));
    const hours = i.options.getInteger('older_than') ?? CLEAR.olderThanHours;
    await i.reply(ephemeral(`Clearing the messages older than ${hours} h in <#${ch.id}>…`));
    const c = await clearChannel(ch, hours * HOUR);
    if (!c) return i.editReply('A clear is already running in this channel.').catch(() => {});
    const line = clearLine([[ch.id, c]], hours);
    await modlog('🧹 Chat clear', `${line} · by <@${i.user.id}>`, 0x5aa9ff);
    return i.editReply(`Done. ${line}`).catch(() => {}); // the reply can expire (15 minutes) on a long clear
  },
};

export function setup() {
  client.once('clientReady', () => {
    const tick = () => scheduled().catch((e) => console.error('chat clear', e));
    setTimeout(tick, 60_000);
    setInterval(tick, CLEAR.checkEveryMs);
  });
}
