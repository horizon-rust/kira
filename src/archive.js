// A channel's messages, saved before setup deletes the channel (REPLACED in config.js): every message, oldest
// first, as JSON (everything Discord gives) and as Markdown (to read). Written to scratch/, which is not committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Every message of a text channel, oldest first (100 per request, the most Discord gives).
export async function allMessages(channel) {
  const out = [];
  let before;
  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const list = [...page.values()];
    out.push(...list);
    if (list.length < 100) break;
    before = list.reduce((a, m) => (BigInt(m.id) < BigInt(a.id) ? m : a)).id;
  }
  return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

export const record = (m) => ({
  id: m.id,
  at: new Date(m.createdTimestamp).toISOString(),
  author: { id: m.author?.id, name: m.author?.username, bot: !!m.author?.bot },
  pinned: !!m.pinned,
  content: m.content ?? '',
  embeds: (m.embeds ?? []).map((e) => (e.toJSON ? e.toJSON() : e)),
  attachments: [...(m.attachments?.values?.() ?? [])].map((a) => ({ name: a.name, url: a.url })),
});

export function markdown(name, records) {
  const lines = [`# #${name}`, '', `${records.length} messages, exported before the channel was deleted.`, ''];
  for (const r of records) {
    lines.push(`## ${r.at} · ${r.author.name ?? r.author.id}${r.pinned ? ' · pinned' : ''}`, '');
    if (r.content) lines.push(r.content, '');
    for (const e of r.embeds) lines.push(...[e.title && `**${e.title}**`, e.description, ...(e.fields ?? []).map((f) => `**${f.name}**: ${f.value}`)].filter(Boolean), '');
    for (const a of r.attachments) lines.push(`[${a.name}](${a.url})`, '');
  }
  return lines.join('\n');
}

// Saves `channel` under `dir` as <name>.json and <name>.md. Returns how many messages were written.
export async function exportChannel(channel, name, dir) {
  const records = (await allMessages(channel)).map(record);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ channel: { id: channel.id, name }, exportedAt: new Date().toISOString(), messages: records }, null, 2));
  writeFileSync(join(dir, `${name}.md`), markdown(name, records));
  return records.length;
}
