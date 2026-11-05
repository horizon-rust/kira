// POST /game/ask: Kira answers in a Minecraft server's chat. The server's plugin (github.com/horizon-rust/kira-pumpkin)
// sends { player, question } with the server's own token (data/game-servers.json, issued on Kira's host with
// scripts/game-token.mjs; the token names the server, so a body can't claim another) and prints { answer } in chat.
// Limits: per player, per server per hour and per day; failed logins per address, like the other routes.
import { openStore, verify, touch, clientIp, rateLimiter, issue, revoke, refusal } from '../agents.js';
import { dataFile } from '../store.js';
import { GAME, parseAsk, validPlayer, BUSY_REPLY, tokenDm } from '../game-kit.js';

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

// POST /admin/game-token (src/admin.js), behind the admin token. `dm(owner, text)` sends a Discord DM. A token is sent
// only by DM to the server's owner: if the DM fails, it is revoked at once. `deliver: 'response'` is for tests: a day
// at most, and the caller pipes it straight where it goes.
export function gameTokens({ store, dm, endpoint, now = Date.now }) {
  return async (body) => {
    if (body.action === 'list') {
      return { servers: Object.entries(store.tokens).map(([id, t]) => ({ id, server: t.name, owner: t.user, label: t.label, expiresAt: t.expiresAt, revokedAt: t.revokedAt, lastUsedAt: t.lastUsedAt })) };
    }
    if (body.action === 'revoke') {
      if (!store.tokens[body.id]) throw refusal(`no token ${body.id}`);
      revoke(store, body.id, { any: true }, now());
      return { revoked: body.id };
    }
    if (body.action !== 'issue') throw refusal('action: issue, list or revoke');
    const { server, owner } = body;
    if (typeof server !== 'string' || !/^[a-z0-9.-]{3,80}$/i.test(server)) throw refusal('server: its address, like horizon.example.net');
    if (typeof owner !== 'string' || !/^\d{17,20}$/.test(owner)) throw refusal("owner: the owner's Discord id");
    const test = body.deliver === 'response';
    if (!test && body.deliver !== 'dm') throw refusal('deliver: dm (or response, for a test token)');
    const days = test ? 1 : Number(body.days ?? GAME.tokenDays);
    const t = issue(store, { user: owner, name: server, days, label: test ? 'test' : 'game', maxPerUser: 3, maxPerDay: 3 }, now());
    if (test) return { id: t.id, server, expiresAt: t.record.expiresAt, token: t.token };
    try {
      await dm(owner, tokenDm({ server, endpoint, token: t.token, id: t.id }));
    } catch (e) {
      revoke(store, t.id, { any: true }, now());
      throw refusal(`the DM to ${owner} failed (${String(e.message).slice(0, 100)}): token ${t.id} revoked`);
    }
    return { id: t.id, server, expiresAt: t.record.expiresAt, dm: 'sent' };
  };
}
