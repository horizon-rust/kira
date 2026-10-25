// #updates: Horizon's one feed, generated from the hub's journal (journal.json; src/journal.js). Merged work grouped
// by roadmap item, releases (their notes stay in #releases), shipped items and the weekly summary, each once
// (state.updates.seen). The kanban summary at the top of the channel is the work board's (src/features/workboard.js).
// The first look only records what is already in the journal; until setup has made #updates nothing is fetched.
import { createHash } from 'node:crypto';
import { MessageType } from 'discord.js';
import { HUB } from '../config.js';
import { client, state, save, channel } from '../core.js';
import * as journal from '../journal.js';
import * as hub from '../hub.js';
import { roadmap } from './hub.js';

const U = (state.updates ??= {});
const hooks = []; // other readers of the journal (the X poster): called with each good journal fetched
export const onJournal = (fn) => hooks.push(fn);

let fetchJson = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Kira (Horizon Discord bot)' }, signal: AbortSignal.timeout(15_000) });
  return res.ok ? res.json() : null;
};

export async function poll() {
  const ch = channel('updates');
  const data = await fetchJson(HUB.journalJson).catch((e) => { console.error('journal', e.message); return null; });
  if (!journal.isJournal(data)) return;
  for (const fn of hooks) await Promise.resolve(fn(data)).catch((e) => console.error('journal reader', e.message));
  if (!ch) return; // no #updates yet (run setup): nothing recorded, so the first look after setup seeds
  const { entries, seen } = journal.newEntries(data, U.seen ?? []);
  U.seen = seen; // marked before posting: a crash never posts an entry twice
  const first = !U.seeded;
  U.seeded = true;
  save();
  if (first || !entries.length) return;
  const r = await roadmap();
  const titleOf = (id) => r?.items.find((i) => i.id === id)?.title ?? null;
  for (const post of journal.feedPosts(entries, { hubUrl: HUB.url, releases: state.channels.releases, titleOf })) {
    await ch.send(post).catch((e) => console.error('#updates', e.message));
  }
  console.log(`#updates: ${entries.length} journal entries posted`);
}

// ── The roadmap, pinned ──────────────────────────────────────────────────────
// Kira's own copy of the whole roadmap (what `/roadmap` shows): one or more messages pinned in #updates, edited in
// place whenever the roadmap changes (and checked at every start), never posted twice. Their ids are
// state.roadmapPin.ids, in order, with a hash of what they show; nothing else of the state is touched.
const P = (state.roadmapPin ??= { ids: [], hash: '' });
let verified = false; // the pinned messages are checked once after each start, even when the roadmap is unchanged
let syncing = false;
const gone = (e) => e?.code === 10008; // Discord's "Unknown Message"
const body = (p) => ({ content: p.content ?? '', embeds: p.embeds ?? [], allowedMentions: { parse: [] } });

export async function syncRoadmap() {
  const ch = channel('updates');
  const r = await roadmap();
  if (!ch || !hub.isRoadmap(r) || syncing) return;
  const messages = hub.roadmapMessages(r, HUB.url);
  const hash = createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  if (hash === P.hash && verified && P.ids.length === messages.length) return;
  syncing = true;
  try {
    const shown = [];
    let posted = 0;
    for (const [k, m] of messages.entries()) {
      const old = P.ids[k] ? await ch.messages.fetch(P.ids[k]).catch((e) => { if (!gone(e)) throw e; return null; }) : null;
      if (old) {
        shown.push(await old.edit(body(m)));
      } else {
        const sent = await ch.send({ ...body(m), flags: 4096 });
        P.ids[k] = sent.id; // kept at once: a failure further on never posts this one again
        save();
        shown.push(sent);
        posted++;
      }
    }
    for (const id of P.ids.splice(messages.length)) await ch.messages.fetch(id).then((x) => x.delete()).catch(() => {});
    P.hash = hash;
    verified = true;
    save();
    // Pinned last to first, so the pin list reads in the roadmap's order (the newest pin is on top).
    const unpinned = shown.filter((x) => !x.pinned).reverse();
    for (const x of unpinned) await x.pin().catch((e) => console.error('pin roadmap', e.message));
    if (unpinned.length) {
      const notices = (await ch.messages.fetch({ limit: 10 })).filter((x) => x.type === MessageType.ChannelPinnedMessage && x.author.id === client.user.id);
      for (const x of notices.values()) await x.delete().catch(() => {});
    }
    console.log(`#updates: pinned roadmap in ${messages.length} message(s): ${posted} posted, ${unpinned.length} pinned`);
  } finally {
    syncing = false;
  }
}

export const commands = []; // bot.js gathers every feature's commands and handlers
export const handlers = {};

export const _test = { setFetch: (fn) => { fetchJson = fn; }, state: U, pin: P, forgetVerified: () => { verified = false; } };

export function setup() {
  client.once('clientReady', () => {
    const run = () => poll().catch((e) => console.error('#updates', e.message));
    setTimeout(run, 20_000).unref?.();
    setInterval(run, HUB.journalEveryMs).unref?.();
    const pin = () => syncRoadmap().catch((e) => console.error('pinned roadmap', e.message));
    setTimeout(pin, 40_000).unref?.();
    setInterval(pin, HUB.journalEveryMs).unref?.();
  });
}
