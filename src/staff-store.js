// The staff dashboards' file, /data/staff.json (KIRA_STAFF, else data/staff.json next to the state): passwords'
// and sessions' hashes, one-time links, applications, the Team's decisions, cards and roadmap layer, counters.
// Only the bot writes it. Written atomically with mode 600; a copy a day is kept in staff-backups/ (the last 7),
// same mode. Restore: README, "Staff dashboards".
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, copyFileSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const BACKUPS_KEPT = 7;
const EMPTY = () => ({ version: 1, accounts: {}, links: {}, sessions: {}, applications: {}, decisions: [], cards: {}, roadmap: { items: {}, notes: {} }, counters: {} });

export function openStaffStore(file, { now = () => Date.now() } = {}) {
  let data;
  try {
    data = { ...EMPTY(), ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    if (existsSync(file)) throw new Error(`staff store unreadable (${e.message}): restore a backup, see the README`);
    data = EMPTY();
  }
  const backups = join(dirname(file), 'staff-backups');

  // One copy a day, made before the first write of the day: the file as it was at the end of the day before.
  function backup() {
    if (!existsSync(file)) return;
    const name = `staff-${new Date(now()).toISOString().slice(0, 10)}.json`;
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const target = join(backups, name);
    if (existsSync(target)) return;
    copyFileSync(file, target);
    chmodSync(target, 0o600);
    const all = readdirSync(backups).filter((f) => /^staff-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) unlinkSync(join(backups, old));
  }

  function write() {
    mkdirSync(dirname(file), { recursive: true });
    try { backup(); } catch (e) { console.error('staff backup', e.message); }
    writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }

  return {
    get data() { return data; },
    // Changes the data and writes it; `fn`'s result is returned.
    update(fn) { const r = fn(data); write(); return r; },
    backupsDir: backups,
  };
}
