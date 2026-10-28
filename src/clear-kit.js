// What a chat clear deletes (src/features/chatclear.js), with no Discord connection so it can be tested.

// Discord bulk-deletes only messages under 14 days old; an hour of margin so a message doesn't age past it meanwhile.
export const BULK_MAX_AGE_MS = 14 * 86_400_000 - 60 * 60_000;

// One page of messages ({ id, createdTimestamp, pinned, hasThread, deletable }) → what to do with each: `bulk` and
// `single` are the ids to delete; pinned messages, messages that started a thread and the ones Kira can't delete stay.
export function sortForClear(messages, { now, olderThanMs }) {
  const out = { bulk: [], single: [], pinned: 0, threads: 0, undeletable: 0 };
  for (const m of messages) {
    const age = now - m.createdTimestamp;
    if (age < olderThanMs) continue;
    if (m.pinned) out.pinned++;
    else if (m.hasThread) out.threads++;
    else if (m.deletable === false) out.undeletable++;
    else (age < BULK_MAX_AGE_MS ? out.bulk : out.single).push(m.id);
  }
  return out;
}

// The oldest of some message ids (snowflakes grow with time): where the next page starts.
export const oldestId = (ids) => ids.reduce((a, b) => (BigInt(b) < BigInt(a) ? b : a));

// Discord's bulk delete takes 2 to 100 ids at a time.
export function batches(ids, size = 100) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// Which channels /clear-chat works in: text channels of the server, never threads, forums, read-only or staff channels.
// spec: the channel's LAYOUT entry (undefined for a channel setup didn't make); staffParent: in the staff category.
export function clearAllowed({ isText, spec, staffParent }) {
  return !!isText && !staffParent && !spec?.staff && !spec?.readonly && !spec?.members;
}

const n = (x) => x.toLocaleString('en-US');

// One line for #mod-log: [[channelId, counts]…] with counts { deleted, pinned, failed }.
export function clearLine(results, olderThanHours) {
  const parts = results.map(([id, c]) => `<#${id}> ${n(c.deleted)} deleted${c.failed ? ` (${n(c.failed)} failed)` : ''}`);
  const pinned = results.reduce((t, [, c]) => t + c.pinned, 0);
  return `Older than ${olderThanHours} h: ${parts.join(' · ') || 'no channel'}${pinned ? ` · ${n(pinned)} pinned kept` : ''}`;
}
