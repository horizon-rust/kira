// Kira's state, in data/state.json: the IDs setup created, the feed items already posted, warnings.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.KIRA_STATE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'state.json');

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

export function save() {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 2));
  renameSync(FILE + '.tmp', FILE);
}
