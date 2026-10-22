// The GitHub releases Kira announces (REST API). The YouTube feed that lived here went with the
// server's old scope (2026-10-14).
import { GITHUB } from './config.js';
import { fresh } from './releases.js';

// The releases of one repo to announce now, oldest first (published, not posted yet; Horizon's game pre-releases
// count as Nightly when `nightlies` is a list). `gh` is a client from github.js; `announced` the ids already posted
// as stable for this repo. Nightlies come every few minutes and the one promoted to stable is at least 6 hours
// old, so the list is the newest 100 releases plus a second page when the first is full.
export async function newReleases(gh, repo, announced, nightlies = null) {
  const path = `/repos/${GITHUB.owner}/${repo}/releases?per_page=100`;
  let list = (await gh.get(path)) ?? [];
  if (list.length >= 100) list = list.concat((await gh.get(`${path}&page=2`)) ?? []);
  return fresh(list, announced, undefined, nightlies, repo);
}
