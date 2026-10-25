// The X poster wired to the journal (src/xposter.js does the work): each journal fetch of #updates hands it the
// journal; new releases, weekly summaries and announced shipped items are posted once (state.x.seen), 3 at most
// per round and 10 a day. The first look only records. Off without X credentials, unless X_DRY_RUN=1 (prints).
import { HUB } from '../config.js';
import { state, save } from '../core.js';
import { dataFile } from '../store.js';
import { loadTokens, makePoster, toPost, xText } from '../xposter.js';
import { onJournal } from './updates.js';

const FILE = dataFile('x-tokens.json');
const DRY = process.env.X_DRY_RUN === '1';
const tokens = loadTokens(FILE);
export const enabled = DRY || !!tokens;
const PER_DAY = 10;
let poster = enabled ? makePoster({ tokens: tokens ?? {}, file: FILE, dryRun: DRY }) : null;

export async function onNewJournal(journal, now = Date.now()) {
  const X = (state.x ??= {});
  if (!X.seeded) {
    X.seen = toPost(journal, [], { max: Infinity }).done;
    X.seeded = true;
    return save();
  }
  const day = new Date(now).toISOString().slice(0, 10);
  if (X.day?.date !== day) X.day = { date: day, count: 0 };
  const { posts, done } = toPost(journal, X.seen ?? [], { max: Math.max(0, Math.min(3, PER_DAY - X.day.count)) });
  const skipped = done.filter((id) => !posts.some((e) => e.id === id));
  X.seen = [...skipped, ...(X.seen ?? [])].slice(0, 2000);
  for (const e of posts) {
    X.seen = [e.id, ...X.seen].slice(0, 2000); // marked before posting: never twice, even after a crash
    X.day.count++;
    save();
    try {
      const r = await poster.post(xText(e, HUB.url));
      console.log(`x: ${e.id} ${r.dryRun ? 'printed (dry run)' : `posted ${r.id ?? ''}`}`);
    } catch (err) {
      console.error('x', e.id, err.message);
    }
  }
  save();
}

export const commands = []; // bot.js gathers every feature's commands and handlers
export const handlers = {};

export const _test = { setPoster: (p) => { poster = p; } };

export function setup() {
  if (!enabled) return console.log('x: off (no X credentials)');
  console.log(`x: on${DRY ? ' (dry run: posts are printed)' : ''}`);
  onJournal((j) => onNewJournal(j));
}
