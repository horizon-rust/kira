// The official server's market and economy for the hub (playhorizon.dev/hub/market). The SMP mod POSTs its pages
// (`POST /smp/ingest/market.json`, `/smp/ingest/economy.json`, bearer KIRA_SMP_INGEST_TOKEN, only when they changed,
// at most once a minute); Kira keeps the last copy of each (src/smp-kit.js) and serves it at GET /smp/market.json and
// GET /smp/economy.json, public and read-only. When the market's day ends, its summary (biggest movers and news) goes
// to #server-chat once. Off without the token. Kira holds no key to the server: the server sends, Kira only listens.
import { gunzipSync } from 'node:zlib';
import { SMP } from '../config.js';
import { channel, state, save } from '../core.js';
import { dataFile } from '../store.js';
import * as kit from '../smp-kit.js';
import { clientIp } from '../agents.js';

const TOKEN = process.env.KIRA_SMP_INGEST_TOKEN?.trim() || null;
export const enabled = !!TOKEN;
let store = enabled ? kit.makeStore({ path: (name) => dataFile(`smp-${name}`) }) : null;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > kit.MAX_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      let buf = Buffer.concat(parts);
      // The server sends its pages gzipped (a month of prices compresses ~10x); never unpack past MAX_BYTES.
      if (/gzip/i.test(String(req.headers?.['content-encoding'] ?? ''))) {
        try { buf = gunzipSync(buf, { maxOutputLength: kit.MAX_BYTES }); } catch (e) {
          return reject(Object.assign(new Error('bad gzip'), { status: e.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400 }));
        }
      }
      resolve(buf.toString('utf8'));
    });
    req.on('error', reject);
  });
}

const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

export function routes({ limiter } = {}) {
  if (!store) return {};
  const ingest = (name) => async (req, res) => {
    if (!kit.tokenOk(TOKEN, req.headers.authorization)) {
      const limited = limiter && !limiter.take(clientIp(req), 'auth');
      return reply(res, limited ? 429 : 401, { error: limited ? 'too many attempts' : 'unauthorized' });
    }
    let text;
    try { text = await readBody(req); } catch (e) { return reply(res, e.status ?? 400, { error: 'bad body' }); }
    const r = store.put(name, text);
    reply(res, r.status, r.error ? { error: r.error } : { ok: true, ...(r.ignored ? { ignored: true } : {}) });
    if (name === 'market.json' && r.status === 200 && !r.ignored) postSummary();
  };
  const serve = (name) => (req, res) => {
    if (limiter && !limiter.take(clientIp(req), 'read')) return reply(res, 429, { error: 'too many requests' });
    const page = store.get(name);
    if (!page) return reply(res, 503, { error: 'the server has not sent this page yet' });
    reply(res, 200, page.text, {
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'X-Kira-Received': new Date(page.at).toISOString(),
    });
  };
  const out = {};
  for (const name of kit.FILES) {
    out[`POST /smp/ingest/${name}`] = ingest(name);
    out[`GET /smp/${name}`] = serve(name);
  }
  return out;
}

// The market's daily summary, posted once when a page brings a new one.
async function postSummary() {
  try {
    const page = store.get('market.json');
    const smp = (state.smp ??= {});
    const { day, lines } = kit.summaryToPost(page?.doc, smp.summaryDay, Date.now());
    if (day === (smp.summaryDay ?? 0)) return;
    smp.summaryDay = day;
    save();
    if (!lines.length) return;
    await channel(SMP.summaryChannel)?.send({ content: kit.summaryText(lines), allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('smp summary:', e.message);
  }
}

export function setup() {
  console.log(`smp: ${enabled ? `takes the server's pages at POST /smp/ingest/*, serves /smp/*.json, posts the market's day in #${SMP.summaryChannel}` : 'off (KIRA_SMP_INGEST_TOKEN is not set)'}`);
}

export const commands = [];
export const handlers = {};
export const _test = { setStore: (s) => { store = s; } };
