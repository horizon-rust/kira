// Dry run of the image lane (src/features/batchmod.js, src/image-kit.js) on real traffic: reads the last N hours of
// every channel the batch lane reads (read-only, Discord REST), takes the images members (not staff, not bots) posted
// there, downscales each through Discord's media proxy as the bot does, runs the real vision call, and prints what it
// costs and what it would flag. Nothing is posted, deleted or saved on Discord, and no image is written anywhere.
// The verdicts (jump links, the model's reason; a CSAM suspicion keeps its ids only) go to the file given, for a
// person to read; keep it out of the repo.
//
//   DISCORD_TOKEN=… ANTHROPIC_API_KEY=… node scripts/measure-image-mod.mjs [hours, default 24] [out.json] [max images]
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { BATCH, GUILD_ID, LAYOUT, OWNER_ID } from '../src/config.js';
import { makeImageClassifier } from '../src/ai.js';
import * as imageKit from '../src/image-kit.js';

const hours = Number(process.argv[2]) || 24;
const outFile = process.argv[3] || null;
const maxImages = Number(process.argv[4]) || Infinity;
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

// Which channels: as eligible() in batchmod.js, from the raw overwrites (the same as measure-batch-mod.mjs).
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
  ...(active.threads ?? []).filter((t) => t.type === 11 && byId.get(t.parent_id) && eligible(byId.get(t.parent_id))),
];

const items = []; // { channel, message, file }
for (const c of read) {
  let before = null;
  for (;;) {
    const page = await discord(`/channels/${c.id}/messages?limit=100${before ? `&before=${before}` : ''}`).catch(() => []);
    if (!page.length) break;
    for (const m of page) {
      if (m.author.bot || snowAt(m.id) < since) continue;
      const files = (m.attachments ?? []).map((a) => ({ name: a.filename, url: a.url, proxyUrl: a.proxy_url, size: a.size, type: a.content_type ?? null, width: a.width ?? null, height: a.height ?? null }));
      for (const f of imageKit.images(files, BATCH.imagesPerMessage)) items.push({ channel: c, message: m, file: f });
    }
    before = page.at(-1).id;
    if (snowAt(before) < since) break;
  }
}
console.error(`${items.length} images in ${read.length} channels over ${hours} h; listing members…`);
const members = new Map();
for (let after = '0'; ;) {
  const page = await discord(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
  for (const m of page) members.set(m.user.id, m);
  if (page.length < 1000) break;
  after = page.at(-1).user.id;
}
const exempt = (id) => id === OWNER_ID || (members.get(id)?.roles ?? []).some((r) => staffRoles.has(r) || r === teamRole);
const members_images = items.filter((x) => !exempt(x.message.author.id)).length;
const judged = items.filter((x) => !exempt(x.message.author.id)).slice(0, maxImages);
console.error(`${judged.length} images to read (staff and the Team skipped)`);

const classify = makeImageClassifier({ client: new Anthropic({ maxRetries: 3, timeout: 120_000 }) });
const total = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, failed: 0, fetchFailed: 0, bytes: 0 };
const found = [];
const routes = {};
const categories = {};
let next = 0;
async function worker() {
  while (next < judged.length) {
    const { channel: c, message: m, file: f } = judged[next++];
    let img;
    try {
      const res = await fetch(imageKit.downscaledUrl(f, BATCH.imageMaxSide), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > BATCH.imageMaxBytes) throw new Error(`${buf.length} bytes`);
      total.bytes += buf.length;
      img = { data: buf.toString('base64'), mediaType: res.headers.get('content-type').split(';')[0].trim() };
    } catch (e) {
      total.fetchFailed++;
      console.log(`fetch failed #${c.name} ${m.id}: ${e.message}`);
      continue;
    }
    const r = await classify({ ...img, name: f.name, text: m.content, channel: c.name }).catch((e) => ({ verdict: null, reason: `${e.status ?? ''} ${e.message}`, cost: 0 }));
    img = null;
    for (const k of ['cost', 'input', 'output', 'cacheRead', 'cacheWrite']) total[k] += r[k] ?? 0;
    if (!r.verdict) { total.failed++; console.log(`#${c.name} ${m.id}: not used (${r.reason})`); continue; }
    const v = r.verdict;
    categories[v.category] = (categories[v.category] ?? 0) + 1;
    const kind = imageKit.route(v, BATCH);
    if (!kind) continue;
    routes[kind] = (routes[kind] ?? 0) + 1;
    const url = `https://discord.com/channels/${GUILD_ID}/${c.id}/${m.id}`;
    if (v.category === 'csam') {
      found.push({ kind, category: v.category, confidence: v.confidence, channel: c.id, message: m.id, url });
      console.log(`${kind} csam ${v.confidence} ${url}`);
    } else {
      found.push({ kind, category: v.category, confidence: v.confidence, channel: c.name, url, file: f.name, user: m.author.id, text: String(m.content ?? '').slice(0, 300), reason: v.reason });
      console.log(`${kind.padEnd(4)} ${v.category.padEnd(11)} ${v.confidence.toFixed(2)} #${c.name} ${f.name}: ${v.reason.slice(0, 140)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);

const perDay = (x) => (x * 24) / hours;
const read_ = judged.length - total.fetchFailed - total.failed;
const summary = {
  hours, channels_read: read.length, images_posted: items.length, images_judged: judged.length, read: read_, fetch_failed: total.fetchFailed, failed: total.failed,
  avg_downscaled_kb: read_ ? Math.round(total.bytes / read_ / 1024) : 0,
  tokens: { input: total.input, cache_read: total.cacheRead, cache_write: total.cacheWrite, output: total.output, prompt_per_image: read_ ? Math.round((total.input + total.cacheRead + total.cacheWrite) / read_) : 0 },
  cost_usd: Math.round(total.cost * 1e5) / 1e5, cost_per_image_usd: read_ ? Math.round((total.cost / read_) * 1e7) / 1e7 : 0,
  // Per day: every image members posted in the period (a capped sample is scaled up by its cost per image).
  images_per_day: Math.round(perDay(members_images)), cost_per_day_usd: read_ ? Math.round(perDay((total.cost / read_) * members_images) * 1e4) / 1e4 : 0,
  categories, routes,
};
console.log(JSON.stringify(summary, null, 2));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, found }, null, 2), { mode: 0o600 });
