// Kira's state, in data/state.json: the IDs setup created, the feed items already posted, warnings.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.KIRA_STATE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'state.json');
// Other files Kira writes, next to the state (data/board.json…).
export const dataFile = (name) => join(dirname(FILE), name);

// `npm run setup` owns the IDs of what it made; the bot owns everything else (XP, warnings, feeds…).
// Both write the same file, so each save first takes the other side's keys from disk: a bot that was
// running during a setup must not put its old copy of the IDs back (that is how copies got made twice).
const SETUP_KEYS = ['channels', 'roles', 'messages', 'invite', 'serverGuide', 'icon'];
let owner = 'bot';
export const claim = (who) => { owner = who; };

let state;
export function load() {
  if (state) return state;
  try {
    state = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    state = {};
  }
  state.roles ??= {};
  state.channels ??= {};
  state.messages ??= {};
  state.seen ??= {};
  state.warnings ??= {};
  return state;
}

// After a restore (src/admin.js) the process exits without writing its old state over the new files.
let frozen = false;
export const freeze = () => { frozen = true; };

export function save() {
  if (frozen) return;
  mkdirSync(dirname(FILE), { recursive: true });
  try {
    const disk = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const key of Object.keys(disk)) {
      if (SETUP_KEYS.includes(key) === (owner === 'bot')) state[key] = disk[key];
    }
  } catch { /* no file yet */ }
  writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 2));
  renameSync(FILE + '.tmp', FILE);
}
