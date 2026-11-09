// The decisions log (GOVERNANCE.md section 13): an append-only record of every council poll, every role change Kira
// applied from one, and every council registry change. Entries are only ever added: none is edited or removed. Kept
// in data/decisions.json (KIRA_DECISIONS), served public and read-only as GET /decisions.json. Agents act on a
// decision only when they find it here (GOVERNANCE.md section 10).
//
// Entry types:
// - poll: { id, type, at, kind, where, key, question, threshold, openedBy, startedAt, closedAt, outcome, result, ballots }
// - applied: { id, type, at, of (the poll id), member, role, action, ok, error }
// - council: { id, type, at, of, member, login, action } (the registry changed)
// - reopen: { id, type, at, of (a failed poll id), by } (a signature that lifts the 7-day rule)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TYPES = new Set(['poll', 'applied', 'council', 'reopen']);

export function openLog(file) {
  let entries;
  try { entries = JSON.parse(readFileSync(file, 'utf8')).decisions ?? []; } catch { entries = []; }
  return {
    all: () => entries.map((e) => ({ ...e })),
    // Adds one entry, with the next id (D1, D2…) and the time; writes the whole file atomically. → the entry.
    append(entry, now = Date.now()) {
      if (!TYPES.has(entry?.type)) throw new Error(`unknown decision type ${entry?.type}`);
      const e = { ...entry, id: `D${entries.length + 1}`, at: now };
      const next = [...entries, e];
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify({ decisions: next }, null, 1));
      renameSync(file + '.tmp', file);
      entries = next;
      return { ...e };
    },
  };
}

// What the public sees. Polls about a person (where: 'council') show their result and role change only: never the
// question, the ballots or the kind, since a kind like 'age' or 'appeal' would tell the reason (GOVERNANCE.md 4.7, 9).
// Other polls show each ballot.
export function publicView(entries) {
  return entries.map((e) => {
    if (e.type !== 'poll') return e;
    const { key, ...rest } = e;
    if (e.where !== 'council') return rest;
    const { question, ballots, ref, ...open } = rest; // a person poll: nothing about who or why
    return { ...open, kind: 'person', question: null, ballots: null };
  });
}

// GET /decisions.json: { updated, decisions } (public, read-only, cached 60 seconds).
export function route({ log, now = () => Date.now() }) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ updated: new Date(now()).toISOString(), decisions: publicView(log.all()) }));
  };
}
