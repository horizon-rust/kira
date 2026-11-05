// The GitHub releases Kira announces (REST API). The YouTube feed that lived here went with the
// server's old scope (2026-10-14).
import { GITHUB } from './config.js';
import { fresh } from './releases.js';

// The releases of one repo to post now, oldest first (published, not posted yet). `gh` is a client from github.js;
// `announced` the ids already posted for this repo, `earlier` those posted as Alpha before the single channel.
// Releases come every few minutes, so the list is the newest 100 releases plus a second page when the first is full.
export async function newReleases(gh, repo, announced, earlier = []) {
  const path = `/repos/${GITHUB.owner}/${repo}/releases?per_page=100`;
  let list = (await gh.get(path)) ?? [];
  if (list.length >= 100) list = list.concat((await gh.get(`${path}&page=2`)) ?? []);
  return fresh(list, announced, undefined, earlier, repo);
}
