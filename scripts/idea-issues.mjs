#!/usr/bin/env node
// The open idea issues of horizon-rust/horizon (label `enhancement`), for the move to the roadmap: since ideas go to
// the suggestion queue instead of GitHub, each one is either moved to the roadmap (an item in roadmap.toml, with
// the issue in its links) or closed with a link to the roadmap. This script only reads: it closes nothing.
//
//   node scripts/idea-issues.mjs            a table: number, 👍 on Discord, age, title, link
//   node scripts/idea-issues.mjs --json     the same as JSON
//
// GITHUB_TOKEN is used when set (more requests an hour); the repo is public, so it works without one.
import { makeGitHub } from '../src/github.js';
import { GITHUB, WORK } from '../src/config.js';
import { ideaRows } from '../src/hub.js';

const gh = makeGitHub({ token: process.env.GITHUB_TOKEN?.trim() });
const issues = [];
for (let page = 1; page <= 10; page++) {
  const list = (await gh.get(`/repos/${GITHUB.owner}/${WORK.repo}/issues?state=open&labels=${encodeURIComponent(GITHUB.labels.idea)}&per_page=100&page=${page}`)) ?? [];
  issues.push(...list);
  if (list.length < 100) break;
}
const rows = ideaRows(issues);
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(`${rows.length} open idea issues in ${GITHUB.owner}/${WORK.repo}`);
  for (const r of rows) console.log(`#${r.number}\t👍 ${r.votes ?? '-'}\t${r.days} d\t${r.fromDiscord ? 'discord' : 'github'}\t${r.title}\t${r.url}`);
}
