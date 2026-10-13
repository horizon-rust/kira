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

// A post Kira made itself (the "How to post here" guides, the project catalogue): never a member post, so it is
// not checked against a template, gets no reactions, and never becomes a GitHub issue.
export const isOwnPost = (thread, meId) => !!meId && thread?.ownerId === meId;

// The one post of a kind (a forum guide): the one the state remembers, else the one already there that
// `match` accepts (found by name), else a new one. `list` returns the forum's posts, `create` makes it.
// Two matches stop everything: somebody must delete the extra one.
export async function ensureThread({ id, fetchById, list, match, create, label }) {
  let thread = id ? await fetchById(id).catch(() => null) : null;
  let created = false;
  if (!thread) thread = unique((await list()).filter(match), label);
  if (!thread) { thread = await create(); created = true; }
  return { thread, created };
}
