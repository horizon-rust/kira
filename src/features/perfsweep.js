// The perf viewer's clean-up (horizon-site /api/perf/sweep): every 5 minutes Kira asks the site to delete expired
// and abandoned capture uploads from its bucket. Only when PERF_SWEEP_TOKEN is set, the same value as the site's;
// without it Kira never calls.
import { LINKS } from '../config.js';

export const EVERY_MS = 5 * 60_000;
// No slash command: bot.js maps every feature's `commands`, so a missing list crashed Kira at start.
export const commands = [];

// Returns how many captures the site deleted, or null when no token is set.
export async function sweep({ token = process.env.PERF_SWEEP_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) return null;
  const response = await fetchImpl(`${LINKS.horizonSite}/api/perf/sweep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()).deleted;
}

export function setup() {
  if (!process.env.PERF_SWEEP_TOKEN) return;
  setInterval(() => sweep().catch((e) => console.error('perf sweep', e.message)), EVERY_MS).unref?.();
}
