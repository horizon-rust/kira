// The official server's market and economy pages, read from the server (no Discord here; src/features/smp.js wires
// it). The SMP mod writes world/horizon-smp/web/market.json and economy.json once a minute (horizon-mods native/smp
// README, "Data"); Kira reads them through Sculk's panel API with a read-only key, at most once a minute each, and
// serves them as they are. Nothing else on the server can be asked for: only these two names.

export const FILES = new Set(['market.json', 'economy.json']);
export const MAX_BYTES = 8 * 1024 * 1024;
export const TTL_MS = 60_000;

// A document the mod wrote: schema 1 and a time; anything else is refused.
export function valid(doc) {
  return !!doc && typeof doc === 'object' && !Array.isArray(doc) && doc.schema === 1 && Number.isFinite(doc.generated);
}

// One reader per file: a fresh copy is kept for TTL_MS, concurrent readers share one request, and a failed read
// serves the last good copy (marked `stale`) rather than nothing.
export function makeReader({ panel, server, key, dir = '/world/horizon-smp/web', fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const cache = new Map(); // name → { at, doc }
  const flying = new Map(); // name → Promise
  async function load(name) {
    const file = encodeURIComponent(`${dir}/${name}`);
    const res = await fetchImpl(`${panel}/api/client/servers/${server}/files/contents?file=${file}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'Kira (playhorizon.dev hub)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`panel: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`panel: ${name} is too big (${text.length} bytes)`);
    const doc = JSON.parse(text);
    if (!valid(doc)) throw new Error(`panel: ${name} isn't the SMP's page`);
    return doc;
  }
  return async function read(name) {
    if (!FILES.has(name)) return null;
    const hit = cache.get(name);
    if (hit && now() - hit.at < TTL_MS) return { doc: hit.doc, stale: false };
    if (!flying.has(name)) {
      flying.set(name, load(name).then((doc) => { cache.set(name, { at: now(), doc }); return doc; }).finally(() => flying.delete(name)));
    }
    try {
      return { doc: await flying.get(name), stale: false };
    } catch (e) {
      if (hit) return { doc: hit.doc, stale: true, error: e.message };
      throw e;
    }
  }
}

// The market's daily summary to post, once: its lines when its day is newer than the last one posted and recent
// (a summary older than `maxAgeMs`, after a restart of Kira, is only marked as seen).
export function summaryToPost(doc, lastDay, nowMs, maxAgeMs = 6 * 3_600_000) {
  const s = doc?.daily_summary;
  const day = Number(s?.day);
  if (!Number.isFinite(day) || day <= 0 || day <= (lastDay ?? 0)) return { day: lastDay ?? 0, lines: [] };
  const lines = Array.isArray(s.lines) ? s.lines.filter((l) => typeof l === 'string' && l.trim()).slice(0, 20) : [];
  if (nowMs - day > maxAgeMs) return { day, lines: [] };
  return { day, lines };
}

// The summary as one Discord message: no mention can ping (every `@` defused), at most 1,900 characters.
export function summaryText(lines) {
  const body = lines.map((l) => `• ${l.replaceAll('@', '@‍')}`).join('\n');
  const text = `📈 **Market today** on the official server\n${body}\nPrices and charts: /market in game, playhorizon.dev/hub/market`;
  return text.length > 1900 ? `${text.slice(0, 1897)}…` : text;
}
