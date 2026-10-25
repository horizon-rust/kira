#!/usr/bin/env node
// What Kira would post on X for a journal, without posting: every release, weekly summary and announced shipped item,
// with its length (240 at most).
//
//   node scripts/x-preview.mjs                    the live journal (HUB_JOURNAL_URL, default playhorizon.dev)
//   node scripts/x-preview.mjs path/to/journal.json
import { readFileSync } from 'node:fs';
import { HUB } from '../src/config.js';
import { isJournal } from '../src/journal.js';
import { forX, xText } from '../src/xposter.js';

const src = process.argv[2] ?? HUB.journalJson;
const journal = /^https?:/.test(src) ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, 'utf8'));
if (!isJournal(journal)) throw new Error(`${src} is not a journal ({ "entries": [...] })`);
for (const e of journal.entries.filter(forX)) {
  const text = xText(e, HUB.url);
  console.log(`── ${e.id} (${text.length} characters)\n${text}\n`);
}
