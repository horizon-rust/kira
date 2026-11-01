// The website follows GitHub within a minute (Xmilon, 2026-11-01: "commits on the site don't update"). playhorizon.dev
// caches what it reads from GitHub for 15 minutes or more; when GitHub's webhook (src/webhook.js) says something it
// shows changed, Kira calls the site's POST /api/revalidate with the cache tags of that data (horizon-site's
// components/github-fresh.ts), then loads the pages that show it once so the next visitor gets them fresh, and has
// #updates read the journal again. Off without KIRA_SITE_REVALIDATE_SECRET.
import { GITHUB, SITE } from '../config.js';
import * as webhook from '../webhook.js';

const SECRET = process.env.KIRA_SITE_REVALIDATE_SECRET?.trim() || null;
export const enabled = !!SECRET;
const DRY = process.env.KIRA_SITE_DRY_RUN === '1';
const ACTIONS_THAT_SHOW = new Set(['opened', 'closed', 'reopened', 'edited', 'labeled', 'unlabeled', 'ready_for_review', 'converted_to_draft', 'deleted', 'transferred']);

// A delivery → the site's tags it changes.
export function tagsFor(name, p) {
  const repo = webhook.repoOf(p);
  if (String(p?.repository?.owner?.login ?? GITHUB.owner).toLowerCase() !== GITHUB.owner.toLowerCase()) return [];
  if (repo === 'horizon') {
    if (webhook.pushToMain(name, p)) return ['github:horizon:main'];
    if ((name === 'issues' || name === 'pull_request') && ACTIONS_THAT_SHOW.has(p.action)) return ['github:horizon:issues'];
    if (name === 'release') return ['github:horizon:releases'];
  }
  if (repo === 'horizon-mods' && webhook.pushToMain(name, p)) return ['github:horizon-mods:main'];
  return [];
}

let fetchImpl = (...a) => fetch(...a);
let afterWarm = () => {};
async function revalidate(tags) {
  if (DRY) return void console.log(`site dry-run: revalidate ${tags.join(', ')}`);
  const res = await fetchImpl(`${SITE.url}/api/revalidate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', 'User-Agent': 'Kira' },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`site revalidate: HTTP ${res.status}`);
  const paths = [...new Set(tags.flatMap((t) => SITE.warm[t] ?? []))];
  for (const path of paths) await fetchImpl(`${SITE.url}${path}`, { headers: { 'User-Agent': 'Kira (warming the cache)' }, signal: AbortSignal.timeout(30_000) }).then((r) => r.arrayBuffer?.()).catch(() => {});
  console.log(`site: revalidated ${tags.join(', ')}; ${paths.length} pages loaded`);
  afterWarm(tags);
}

// One throttle per tag: a busy hour of pushes and issues makes at most one call every SITE.gapMs for each.
const pending = new Map(); // tag → throttled call
function poke(tag, delayMs = 0) {
  const key = `${tag}:${delayMs}`;
  if (!pending.has(key)) pending.set(key, webhook.throttle(() => revalidate([tag]).catch((e) => console.error(e.message)), SITE.gapMs, { delayMs }));
  pending.get(key)();
}

export function onDelivery(name, p) {
  for (const tag of tagsFor(name, p)) {
    poke(tag);
    // The mod registry's index is rebuilt by GitHub Pages after the push: once more when it's out.
    if (tag === 'github:horizon-mods:main') poke(tag, SITE.modsDelayMs);
  }
}

if (enabled) webhook.on(onDelivery);

// After a revalidation: what else follows the fresh data (#updates reads the journal).
export const afterRevalidate = (fn) => { afterWarm = fn; };

export function setup() {
  console.log(`site: ${enabled ? `revalidates ${SITE.url} on GitHub's webhook${DRY ? ' (dry run)' : ''}` : 'off (KIRA_SITE_REVALIDATE_SECRET is not set)'}`);
}

export const commands = [];
export const handlers = {};
export const _test = { setFetch: (f) => { fetchImpl = f; }, revalidate };
