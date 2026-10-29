// POST /game/ask: Kira answers in a Minecraft server's chat. The server's plugin (github.com/horizon-rust/kira-pumpkin)
// sends { player, question } with the server's own token (data/game-servers.json, issued on Kira's host with
// scripts/game-token.mjs; the token names the server, so a body can't claim another) and prints { answer } in chat.
// Limits: per player, per server per hour and per day; failed logins per address, like the other routes.
import { openStore, verify, touch, clientIp, rateLimiter } from '../agents.js';
import { dataFile } from '../store.js';
import { GAME, parseAsk, validPlayer, BUSY_REPLY } from '../game-kit.js';

export const openServers = () => openStore(process.env.KIRA_GAME_SERVERS || dataFile('game-servers.json'));

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('end', () => (size > max ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

// `ask`: ({ server, player, question }) → { status, reply } (features/ai.js askInGame). `limiter`: the shared one, for
// failed logins.
export function gameRoutes({ store, ask, limiter, now = Date.now }) {
  const limits = rateLimiter(GAME.limits);
  return {
    'POST /game/ask': async (req, res) => {
      const auth = String(req.headers.authorization ?? '');
      const who = verify(store, auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', now());
      if (!who.ok) {
        const ip = clientIp(req);
        if (!limiter.take(ip, 'auth')) return send(res, 429, { error: 'too many failed attempts' }, { 'Retry-After': String(limiter.retryAfter(ip, 'auth')) });
        return send(res, 401, { error: `token ${who.why}` }, { 'WWW-Authenticate': 'Bearer realm="kira-game"' });
      }
      if (Number(req.headers['content-length'] ?? 0) > GAME.maxBody) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
      let body;
      try { body = JSON.parse(await readBody(req, GAME.maxBody)); } catch (e) { return send(res, e.status ?? 400, { error: e.status ? 'too large' : 'not JSON' }); }
      const { player } = body ?? {};
      if (!validPlayer(player)) return send(res, 400, { error: 'player: a Minecraft name' });
      if (typeof body.question !== 'string' || body.question.length > GAME.maxQuestion) return send(res, 400, { error: `question: text, at most ${GAME.maxQuestion} characters` });
      const question = parseAsk(body.question) ?? body.question.trim();
      if (!question) return send(res, 400, { error: 'question: empty' });
      const t = now();
      if (!limits.take(`${who.id}:${player.toLowerCase()}`, 'player', t)) return send(res, 429, { answer: BUSY_REPLY });
      if (!limits.take(who.id, 'server', t) || !limits.take(who.id, 'serverDay', t)) return send(res, 429, { answer: '' });
      touch(store, who.id, t);
      try {
        const r = await ask({ server: who.name, player, question });
        return send(res, 200, { answer: r.reply ?? '' });
      } catch (e) {
        console.error('kira game ask', e.message);
        return send(res, 500, { answer: '' });
      }
    },
  };
}
