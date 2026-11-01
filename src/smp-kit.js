// The official server's market and economy pages (no Discord here; src/features/smp.js wires it). The SMP mod writes
// world/horizon-smp/web/market.json and economy.json once a minute (horizon-mods native/smp README, "Data") and POSTs
// each one that changed to Kira (`POST /smp/ingest/<name>`, a bearer token only the server and Kira hold). Kira keeps
// the last copy of each, in memory and on disk, and serves it. Kira holds no key to the server.
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const FILES = new Set(['market.json', 'economy.json']);
export const MAX_BYTES = 8 * 1024 * 1024;

// A document the mod wrote: schema 1 and a time; anything else is refused.
export function valid(doc) {
  return !!doc && typeof doc === 'object' && !Array.isArray(doc) && doc.schema === 1 && Number.isFinite(doc.generated);
}

// The server's token, compared in constant time; no token configured accepts nothing.
export function tokenOk(want, header) {
  if (!want) return false;
  const got = Buffer.from(String(header ?? '').startsWith('Bearer ') ? String(header).slice(7).trim() : '');
  const w = Buffer.from(want);
  return got.length === w.length && timingSafeEqual(got, w);
}

// The last copy of each page: `put` checks and keeps it (and writes it to `path(name)` when given), `get` returns it
// with the time it came. An older page than the one kept (by `generated`) is ignored.
export function makeStore({ path = null, now = () => Date.now() } = {}) {
  const pages = new Map(); // name → { doc, text, at }
  if (path) {
    for (const name of FILES) {
      try {
        const text = readFileSync(path(name), 'utf8');
        const doc = JSON.parse(text);
        if (valid(doc)) pages.set(name, { doc, text, at: doc.generated });
      } catch { /* none yet */ }
    }
  }
  return {
    put(name, text) {
      if (!FILES.has(name)) return { status: 404, error: 'unknown page' };
      if (text.length > MAX_BYTES) return { status: 413, error: 'too large' };
      let doc;
      try { doc = JSON.parse(text); } catch { return { status: 400, error: 'not JSON' }; }
      if (!valid(doc)) return { status: 400, error: 'not the SMP\'s page' };
      const kept = pages.get(name);
      if (kept && kept.doc.generated > doc.generated) return { status: 200, ignored: true };
      pages.set(name, { doc, text, at: now() });
      if (path) {
        try {
          writeFileSync(`${path(name)}.tmp`, text);
          renameSync(`${path(name)}.tmp`, path(name));
        } catch (e) { console.error(`smp: keeping ${name}:`, e.message); }
      }
      return { status: 200 };
    },
    get: (name) => pages.get(name) ?? null,
  };
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
