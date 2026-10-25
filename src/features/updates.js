// #updates: Horizon's one feed, generated from the hub's journal (journal.json; src/journal.js). Merged work grouped
// by roadmap item, releases (their notes stay in #releases), shipped items and the weekly summary, each once
// (state.updates.seen). The kanban summary at the top of the channel is the work board's (src/features/workboard.js).
// The first look only records what is already in the journal; until setup has made #updates nothing is fetched.
import { HUB } from '../config.js';
import { client, state, save, channel } from '../core.js';
import * as journal from '../journal.js';
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

export const commands = []; // bot.js gathers every feature's commands and handlers
export const handlers = {};

export const _test = { setFetch: (fn) => { fetchJson = fn; }, state: U };

export function setup() {
  client.once('clientReady', () => {
    const run = () => poll().catch((e) => console.error('#updates', e.message));
    setTimeout(run, 20_000).unref?.();
    setInterval(run, HUB.journalEveryMs).unref?.();
  });
}
