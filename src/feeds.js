// The GitHub releases Kira announces (REST API). The YouTube feed that lived here went with the
// server's old scope (2026-10-14).
import { GITHUB } from './config.js';
import { fresh } from './releases.js';

// The releases of one repo to announce now, oldest first (published, not prereleases, not posted yet).
// `gh` is a client from github.js; `announced` the ids already posted for this repo.
export async function newReleases(gh, repo, announced) {
  return fresh(await gh.get(`/repos/${GITHUB.owner}/${repo}/releases?per_page=20`), announced);
}
