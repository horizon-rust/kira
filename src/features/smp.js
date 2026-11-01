// The official server's market and economy for the hub (playhorizon.dev/hub/market): GET /smp/market.json and
// GET /smp/economy.json, public and read-only, cached a minute (src/smp-kit.js reads them from the server through
// Sculk's panel). Once a day, the market's summary (its biggest movers and news) goes to #server-chat. Off without
// KIRA_SCULK_FILES_KEY: a key of a panel subuser who may only read files (never the owner's key, which controls the
// server).
import { SMP } from '../config.js';
import { channel, state, save } from '../core.js';
import * as kit from '../smp-kit.js';
import { clientIp } from '../agents.js';

const KEY = process.env.KIRA_SCULK_FILES_KEY?.trim() || null;
export const enabled = !!KEY;
let read = enabled ? kit.makeReader({ panel: SMP.panel, server: SMP.server, key: KEY, dir: SMP.webDir }) : null;

export function routes({ limiter } = {}) {
  if (!read) return {};
  const route = (name) => async (req, res) => {
    if (limiter && !limiter.take(clientIp(req), 'read')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'too many requests' }));
    }
    try {
      const { doc, stale } = await read(name);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
        ...(stale ? { 'X-Kira-Stale': '1' } : {}),
      });
      res.end(JSON.stringify(doc));
    } catch (e) {
      console.error(`smp ${name}:`, e.message);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'the server did not answer' }));
    }
  };
  return { 'GET /smp/market.json': route('market.json'), 'GET /smp/economy.json': route('economy.json') };
}

// The market's daily summary, checked every few minutes, posted once.
async function postSummary() {
  try {
    const { doc } = await read('market.json');
    const smp = (state.smp ??= {});
    const { day, lines } = kit.summaryToPost(doc, smp.summaryDay, Date.now());
    if (day === smp.summaryDay) return;
    smp.summaryDay = day;
    save();
    if (!lines.length) return;
    await channel(SMP.summaryChannel)?.send({ content: kit.summaryText(lines), allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('smp summary:', e.message);
  }
}

export function setup() {
  console.log(`smp: ${enabled ? `serves /smp/market.json and /smp/economy.json, posts the market's day in #${SMP.summaryChannel}` : 'off (KIRA_SCULK_FILES_KEY is not set)'}`);
  if (!enabled) return;
  setInterval(postSummary, SMP.summaryEveryMs).unref?.();
}

export const commands = [];
export const handlers = {};
export const _test = { setReader: (r) => { read = r; }, postSummary };
