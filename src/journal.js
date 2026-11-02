// The journal (journal.json, generated in the horizon repo from merged pull requests, releases, the roadmap and
// the weekly summaries) as #updates shows it, and the compact kanban summary at the top of #updates.
// No Discord, no network: src/features/updates.js fetches and posts.
//
// journal.json: { "entries": [ { "id", "kind", "date", "title", "plain"?, "dev"?, "url"?, "item"?, "item_title"?,
//   "number"?, "tag"?, "shipped_in"?, "post"?, "announce"? } ] }, newest first. Kinds: "merge" (a merged pull
// request, `item` = its roadmap:<id> label), "release" (a game or launcher release, `tag`), "weekly" (the week's
// summary), "shipped" (a roadmap item that went out, `shipped_in`; `announce` = also on X).
import { plainText } from './hub.js';

export const KINDS = ['merge', 'release', 'weekly', 'shipped'];
const KEEP = 2000; // ids remembered (the journal holds fewer than that)

export function isJournal(j) {
  return !!j && Array.isArray(j.entries) && j.entries.every((e) => e && typeof e.id === 'string' && typeof e.kind === 'string');
}

// The entries not seen yet, oldest first; unknown kinds are skipped (and remembered, so never shown later).
export function newEntries(journal, seen = []) {
  const known = new Set(seen);
  // An id twice in one journal (it once listed #7154 twice while being regenerated) is shown once.
  const fresh = journal.entries.filter((e) => !known.has(e.id) && (known.add(e.id), true));
  const ids = [...fresh.map((e) => e.id), ...seen].slice(0, KEEP);
  const entries = fresh.filter((e) => KINDS.includes(e.kind)).sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return { entries, seen: ids };
}

const safeUrl = (u) => (/^https:\/\/(github\.com|playhorizon\.dev)\/[^\s<>()]*$/.test(String(u ?? '')) ? u : null);
const linked = (text, url) => (safeUrl(url) ? `[${text}](<${url}>)` : text);

// The posts for new entries: merges grouped by roadmap item (one post per item), then releases, shipped items and
// the weekly summary, each its own post. `releases`: the #releases channel id (Kira posts the releases there).
export function feedPosts(entries, { hubUrl, releases = null, titleOf = () => null } = {}) {
  const posts = [];
  const groups = new Map(); // item id ('' when none) → merges
  for (const e of entries.filter((x) => x.kind === 'merge')) groups.set(e.item ?? '', [...(groups.get(e.item ?? '') ?? []), e]);
  for (const [item, merges] of groups) {
    const name = item ? plainText(merges[0].item_title ?? titleOf(item) ?? item, 100) : 'Other changes';
    const head = item ? `🔀 **${linked(name, `${hubUrl}#${encodeURIComponent(item)}`)}**` : `🔀 **${name}**`;
    const lines = merges.slice(0, 15).map((m) => `• ${linked(plainText(`${m.number ? `#${m.number} ` : ''}${m.plain || m.title}`, 160), m.url)}`);
    if (merges.length > 15) lines.push(`• and ${merges.length - 15} more on the hub's journal`);
    posts.push(`${head}\n${lines.join('\n')}`);
  }
  for (const e of entries) {
    if (e.kind === 'release') {
      const where = releases ? ` (notes in <#${releases}>)` : '';
      posts.push(`📦 **${linked(plainText(e.tag ?? e.title, 60), e.url)}** is out${where}${e.plain ? `: ${plainText(e.plain, 300)}` : ''}`);
    } else if (e.kind === 'shipped') {
      const inRelease = e.shipped_in ? ` in ${plainText(e.shipped_in, 40)}` : '';
      posts.push(`✅ **Shipped${inRelease}: ${linked(plainText(e.item_title ?? e.title, 100), e.url ?? (e.item && `${hubUrl}#${encodeURIComponent(e.item)}`))}**\n${plainText(e.post || e.plain, 400)}`);
    } else if (e.kind === 'weekly') {
      posts.push({ embeds: [{ color: 0xf2a33a, title: `🗓️ ${plainText(e.title, 200)}`, url: safeUrl(e.url) ?? hubUrl, description: plainText(e.plain, 3800) || 'The week on the hub.' }] });
    }
  }
  return posts.map((p) => ({ ...(typeof p === 'string' ? { content: p.slice(0, 2000) } : p), allowedMentions: { parse: [] }, flags: 4096 })); // 4096: silent
}

// The message at the top of #updates, edited after each board refresh: the columns' counts, a few good first
// tasks, the links. `snapshot`: src/board.js's board; `goodFirst`: its cards to show.
export function summaryText(snapshot, goodFirst, hubUrl) {
  const count = (key) => snapshot.columns.find((c) => c.key === key)?.cards.length ?? 0;
  const lines = [
    `🗂️ **The board right now**: 📥 To do **${count('todo')}** · 🔨 In progress **${count('progress')}** · 👀 Review **${count('review')}** · ✅ Done this week **${count('done')}**`,
    goodFirst.length ? `🌱 Good first tasks: ${goodFirst.map((c) => linked(plainText(`#${c.number} ${c.title}`, 70), c.url)).join(' · ')} (\`/claim <number>\`)` : '🌱 No good first tasks labelled right now: `/roadmap` shows what is being built.',
    `Below: merged work grouped by roadmap item, releases and the weekly summary. The full kanban, the roadmap and the journal: <${hubUrl}>`,
  ];
  return { content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] } };
}
