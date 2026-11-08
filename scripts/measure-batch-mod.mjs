// Dry run of the batch moderation lane (src/features/batchmod.js) on real traffic: reads the last N hours of every
// channel the lane would read (read-only, Discord REST), cuts them into windows as the bot would (a random 10 to 30
// minutes or 200 new messages, ~50 earlier ones as context, the per-user summary of the other channels), runs each
// window through the real model call, and prints what it would cost and what it would flag. Nothing is posted,
// deleted or saved on Discord. The incidents (with the members' text) go to the file given, for a person to read;
// keep it out of the repo.
//
//   DISCORD_TOKEN=… ANTHROPIC_API_KEY=… node scripts/measure-batch-mod.mjs [hours, default 24] [out.json]
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { BATCH, GUILD_ID, LAYOUT, OWNER_ID } from '../src/config.js';
import { makeBatchModerator } from '../src/ai.js';
import { route } from '../src/batch-kit.js';

const hours = Number(process.argv[2]) || 24;
const outFile = process.argv[3] || null;
const now = Date.now();
const since = now - hours * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function discord(path) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) { const wait = (Number((await res.json()).retry_after) || 1) * 1000 + 100; console.error(`429 on ${path.split('?')[0]}: waiting ${Math.round(wait / 1000)} s`); await sleep(wait); continue; }
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
  throw new Error(`${path}: rate limited`);
}
const snowAt = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const VIEW = 1n << 10n, MANAGE_MESSAGES = 1n << 13n, ADMIN = 1n << 3n;

// Which channels: as eligible() in batchmod.js, from the raw overwrites.
const [channels, roles, active] = await Promise.all([discord(`/guilds/${GUILD_ID}/channels`), discord(`/guilds/${GUILD_ID}/roles`), discord(`/guilds/${GUILD_ID}/threads/active`)]);
const everyone = roles.find((r) => r.id === GUILD_ID);
const staffRoles = new Set(roles.filter((r) => (BigInt(r.permissions) & (MANAGE_MESSAGES | ADMIN)) !== 0n).map((r) => r.id));
const teamRole = roles.find((r) => r.name === '🌌 Horizon Team')?.id;
const byId = new Map(channels.map((c) => [c.id, c]));
const excludedNames = new Set(LAYOUT.flatMap((g) => [...(g.staff ? [g.category, ...g.channels.map((c) => c.name)] : []), ...g.channels.filter((c) => c.staff || c.members || BATCH.excluded.includes(c.key)).map((c) => c.name)]).filter(Boolean));
function seen(c) {
  let p = BigInt(everyone.permissions);
  for (const x of [c.parent_id && byId.get(c.parent_id), c].filter(Boolean)) {
    const o = (x.permission_overwrites ?? []).find((w) => w.id === GUILD_ID);
    if (o) p = (p & ~BigInt(o.deny)) | BigInt(o.allow);
  }
  return (p & VIEW) !== 0n;
}
const eligible = (c) => !excludedNames.has(c.name) && !(c.parent_id && excludedNames.has(byId.get(c.parent_id)?.name)) && seen(c);
const read = [
  ...channels.filter((c) => [0, 5].includes(c.type) && eligible(c)),
  ...(active.threads ?? []).filter((t) => t.type === 11 && byId.get(t.parent_id) && eligible(byId.get(t.parent_id))).map((t) => ({ ...t, topic: byId.get(t.parent_id).topic })),
];
const skipped = channels.filter((c) => [0, 5, 15].includes(c.type) && !eligible(c)).map((c) => c.name);

// The messages of the last `hours`, plus the 50 before them for the first window's context.
const all = new Map(); // channelId → [message] oldest first
let images = 0, attachments = 0;
for (const c of read) {
  console.error(`reading #${c.name}`);
  const list = [];
  let before = null;
  for (;;) {
    const page = await discord(`/channels/${c.id}/messages?limit=100${before ? `&before=${before}` : ''}`).catch(() => []);
    if (!page.length) break;
    list.push(...page);
    before = page.at(-1).id;
    if (snowAt(before) < since) break;
  }
  const recent = list.filter((m) => !m.author.bot).reverse();
  const first = recent.findIndex((m) => snowAt(m.id) >= since);
  if (first < 0) continue;
  all.set(c.id, recent.slice(Math.max(0, first - BATCH.contextMessages)));
  for (const m of recent.slice(first)) for (const a of m.attachments ?? []) { attachments++; if (/^image\//.test(a.content_type ?? '')) images++; }
}

// Who is staff: their roles.
console.error(`read ${read.length} channels (${[...all.values()].reduce((k, l) => k + l.length, 0)} messages with context); listing members…`);
const members = new Map();
for (let after = '0'; ;) {
  const page = await discord(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
  for (const m of page) members.set(m.user.id, m);
  if (page.length < 1000) break;
  after = page.at(-1).user.id;
}
console.error(`${members.size} members`);
const exempt = (id) => id === OWNER_ID || (members.get(id)?.roles ?? []).some((r) => staffRoles.has(r) || r === teamRole);
const snap = (m, c) => ({
  id: m.id, channelId: c.id, userId: m.author.id, name: members.get(m.author.id)?.nick ?? m.author.global_name ?? m.author.username, at: snowAt(m.id),
  text: String(m.content ?? '').replace(/<@!?(\d+)>/g, (_, id) => `@${(m.mentions ?? []).find((u) => u.id === id)?.username ?? 'someone'}`),
  files: (m.attachments ?? []).map((a) => ({ name: a.filename })), reply: m.message_reference?.message_id ?? null,
  accountAt: snowAt(m.author.id), joinedAt: members.get(m.author.id)?.joined_at ? Date.parse(members.get(m.author.id).joined_at) : null, exempt: exempt(m.author.id),
});

// Windows as the bot cuts them.
const windows = [];
for (const c of read) {
  const list = (all.get(c.id) ?? []).map((m) => snap(m, c));
  const first = list.findIndex((s) => s.at >= since);
  if (first < 0) continue;
  let start = first;
  while (start < list.length) {
    const deadline = list[start].at + BATCH.windowMinMs + Math.floor(Math.random() * (BATCH.windowMaxMs - BATCH.windowMinMs));
    let end = start;
    while (end < list.length && end - start < BATCH.windowMaxMessages && list[end].at <= deadline) end++;
    const fresh = list.slice(start, end);
    windows.push({ channel: c, closesAt: Math.min(deadline, fresh.at(-1).at), fresh, context: list.slice(Math.max(0, start - BATCH.contextMessages), start) });
    start = end;
  }
}
const everything = [...read].flatMap((c) => (all.get(c.id) ?? []).map((m) => ({ ...snap(m, c), channelName: c.name })));
function users(w) {
  const out = new Map();
  for (const s of [...w.context, ...w.fresh]) {
    if (out.has(s.userId)) continue;
    const elsewhere = {};
    for (const x of everything) {
      if (x.userId !== s.userId || x.channelId === w.channel.id || x.at > w.closesAt || w.closesAt - x.at >= BATCH.userLookbackMs) continue;
      const o = (elsewhere[x.channelName] ??= { count: 0, last: [] });
      o.count++; o.last.push(x.text.slice(0, 80)); if (o.last.length > 2) o.last.shift();
    }
    out.set(s.userId, { name: s.name, exempt: s.exempt, accountMs: w.closesAt - s.accountAt, memberMs: s.joinedAt ? w.closesAt - s.joinedAt : null, cases: 0, notes: 0, elsewhere: s.exempt ? {} : elsewhere });
  }
  return out;
}

console.error(`${windows.length} windows`);
const moderate = makeBatchModerator({ client: new Anthropic({ maxRetries: 3, timeout: 120_000 }), cfg: BATCH });
const judged = windows.filter((w) => w.fresh.some((s) => !s.exempt));
const total = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, failed: 0, messages: 0 };
const found = [];
const routes = {};
let next = 0;
async function worker() {
  while (next < judged.length) {
    const w = judged[next++];
    const u = users(w);
    const r = await moderate({ channel: w.channel.name, topic: w.channel.topic ?? '', context: w.context, fresh: w.fresh, users: u }, { exempt: (id) => !!u.get(id)?.exempt }).catch((e) => ({ incidents: null, reason: e.message, cost: 0 }));
    for (const k of ['cost', 'input', 'output', 'cacheRead', 'cacheWrite']) total[k] += r[k] ?? 0;
    total.messages += w.fresh.length;
    if (!r.incidents) { total.failed++; console.log(`#${w.channel.name}: not used (${r.reason})`); continue; }
    for (const inc of r.incidents) {
      const kind = route(inc, BATCH, { now: w.closesAt });
      routes[kind] = (routes[kind] ?? 0) + 1;
      found.push({ channel: w.channel.name, kind, category: inc.category, confidence: inc.confidence, rule: inc.rule, proposed: inc.proposed, reason: inc.reason, user: inc.userId, quotes: inc.quotes, messages: inc.messages.map((s) => ({ id: s.id, text: s.text.slice(0, 300) })) });
      console.log(`${kind.padEnd(4)} ${inc.category.padEnd(10)} ${inc.confidence.toFixed(2)} #${w.channel.name}: ${inc.reason.slice(0, 140)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

const msgs = [...all.values()].reduce((n, l) => n + l.filter((m) => snowAt(m.id) >= since).length, 0);
const perDay = (x) => (x * 24) / hours;
const summary = {
  hours, channels_read: read.length, channels_skipped: skipped, messages: msgs, windows: windows.length, windows_judged: judged.length, failed: total.failed,
  tokens: { input: total.input, output: total.output, cache_read: total.cacheRead, cache_write: total.cacheWrite },
  cost_usd: Math.round(total.cost * 1e5) / 1e5, cost_per_day_usd: Math.round(perDay(total.cost) * 1e4) / 1e4, cost_per_message_usd: msgs ? Math.round((total.cost / msgs) * 1e7) / 1e7 : 0,
  incidents: found.length, routes, by_category: found.reduce((o, f) => ({ ...o, [f.category]: (o[f.category] ?? 0) + 1 }), {}),
  attachments, images, image_check_per_day_usd: Math.round(perDay(images * 0.0002) * 1e4) / 1e4,
};
console.log(JSON.stringify(summary, null, 2));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, incidents: found }, null, 2), { mode: 0o600 });
