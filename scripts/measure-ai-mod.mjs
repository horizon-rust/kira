// Measures what the AI moderation check costs (src/features/moderation.js) on real messages: reads the latest messages
// of the 🌍 languages channels and #general (read-only, Discord REST), groups them as the bot would (per channel,
// AI.modBatchMs apart, AI.modBatchMax at most), runs each batch through the real model call, and prints the cost per
// message and the verdicts. Nothing is posted, deleted or saved.
//
//   DISCORD_TOKEN=… ANTHROPIC_API_KEY=… node scripts/measure-ai-mod.mjs [messages, default 50]
import Anthropic from '@anthropic-ai/sdk';
import { AI, GUILD_ID, LAYOUT } from '../src/config.js';
import { makeModerator } from '../src/ai.js';

const want = Number(process.argv[2]) || 50;
const discord = async (path) => {
  const res = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

const names = new Set([...LAYOUT.find((g) => g.key === 'languages').channels.map((c) => c.name), 'general']);
const channels = (await discord(`/guilds/${GUILD_ID}/channels`)).filter((c) => c.type === 0 && names.has(c.name));
let messages = [];
for (const c of channels) {
  const list = await discord(`/channels/${c.id}/messages?limit=100`);
  messages.push(...list.filter((m) => !m.author.bot && /\p{L}/u.test(m.content ?? '')).map((m) => ({ ...m, channelName: c.name })));
}
messages = messages.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, want).reverse();

// Batches as the bot forms them.
const batches = [];
const open = new Map();
for (const m of messages) {
  const at = Date.parse(m.timestamp);
  let b = open.get(m.channel_id);
  if (!b || at - b.start > AI.modBatchMs || b.items.length >= AI.modBatchMax) {
    b = { start: at, items: [] };
    open.set(m.channel_id, b);
    batches.push(b);
  }
  b.items.push(m);
}

const moderate = makeModerator({ client: new Anthropic({ maxRetries: 2, timeout: 60_000 }) });
const total = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, failed: 0 };
const verdicts = { ok: 0, flag: 0, remove: 0 };
for (const b of batches) {
  const r = await moderate(b.items.map((m) => ({ author: m.member?.nick ?? m.author.global_name ?? m.author.username, channel: m.channelName, text: m.content })));
  for (const k of ['cost', 'input', 'output', 'cacheRead', 'cacheWrite']) total[k] += r[k];
  if (!r.results) { total.failed += b.items.length; console.log(`batch of ${b.items.length}: not used (${r.reason})`); continue; }
  r.results.forEach((v, i) => {
    verdicts[v.verdict]++;
    if (v.verdict !== 'ok') console.log(`${v.verdict} #${b.items[i].channelName} rule ${v.rule} ${v.category}: ${v.reason} | ${v.english.slice(0, 120)}`);
  });
}
console.log(`${messages.length} messages from ${channels.length} channels, ${batches.length} calls`);
console.log(`tokens: in ${total.input}, out ${total.output}, cache read ${total.cacheRead}, cache write ${total.cacheWrite}`);
console.log(`cost: $${total.cost.toFixed(5)} total, $${(total.cost / messages.length).toFixed(6)} per message; verdicts ${JSON.stringify(verdicts)}, unusable ${total.failed}`);
