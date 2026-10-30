// Counts per day for the dashboards' stats: Discord activity and moderation. Counts only: no message text, no
// names, no row per member. `authors` (distinct people who wrote that day) is counted from a set kept in memory for
// the current day only, so a restart in the day can count someone twice.
export const KEYS = ['messages', 'authors', 'joins', 'leaves', 'reports', 'modmail', 'warns', 'timeouts', 'kicks', 'bans', 'automod'];
export const DAYS_KEPT = 120;

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function counters(store, { now = () => Date.now() } = {}) {
  let pending = {}; // day → key → n, not written yet
  let authorsDay = null;
  let authors = new Set();

  const bump = (key, n = 1) => {
    const day = dayOf(now());
    const d = (pending[day] ??= {});
    d[key] = (d[key] ?? 0) + n;
  };

  return {
    bump,
    message(authorId) {
      bump('messages');
      const day = dayOf(now());
      if (authorsDay !== day) { authorsDay = day; authors = new Set(); }
      if (!authors.has(authorId)) { authors.add(authorId); bump('authors'); }
    },
    // Writes what was counted since the last flush; drops days older than DAYS_KEPT.
    flush() {
      const days = Object.keys(pending);
      if (!days.length) return false;
      const add = pending;
      pending = {};
      const oldest = dayOf(now() - DAYS_KEPT * 86_400_000);
      store.update((d) => {
        for (const [day, keys] of Object.entries(add)) {
          const row = (d.counters[day] ??= {});
          for (const [k, n] of Object.entries(keys)) row[k] = (row[k] ?? 0) + n;
        }
        for (const day of Object.keys(d.counters)) if (day < oldest) delete d.counters[day];
      });
      return true;
    },
  };
}

// The last `days` days, oldest first, every key present (0 when nothing was counted).
export function series(data, days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * 86_400_000);
    const row = data.counters[day] ?? {};
    out.push({ day, ...Object.fromEntries(KEYS.map((k) => [k, row[k] ?? 0])) });
  }
  return out;
}
