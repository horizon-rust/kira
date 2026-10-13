// Setup must never create what already exists, even when data/state.json lost the IDs.
// These two helpers decide what "already exists" means.

// One match is the thing; none means "create it"; more than one means somebody must clean up first.
export function unique(matches, label) {
  if (matches.length > 1) {
    throw new Error(`${matches.length} copies of ${label} (${matches.map((m) => m.id).join(', ')}): delete the extra ones, then run setup again`);
  }
  return matches[0] ?? null;
}

// Is `message` a copy of what Kira posts with `payload`? Same author, same embed title (or same first words).
export function isCopy(message, meId, payload) {
  if (message.author.id !== meId) return false;
  const title = payload.embeds?.[0]?.data?.title;
  if (title) return message.embeds[0]?.title === title;
  const head = payload.content?.slice(0, 40);
  return !!head && message.content.startsWith(head);
}
