// Kira's MCP server: contributors' AI agents read Horizon's work board and work on their own cards.
// Streamable HTTP, stateless (one MCP server per request), behind per-user bearer tokens (src/agents.js).
//
// What decides here: who the token belongs to, its scope, whether the card is theirs, and the rate limits.
// What happens is injected (`api`, see makeHandler), so this file has no Discord and no GitHub of its own and
// is tested end to end with the SDK's client (test/mcp.test.js). Routes: POST /mcp (or /) for MCP,
// GET /health, and whatever `routes` adds (the sealed-secrets public key).
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as board from './board.js';
import { verify, touch, allows, rateLimiter, untrusted, UNTRUSTED_NOTE } from './agents.js';

const MAX_BODY = 64 * 1024;
const COLUMN = z.enum(board.COLUMNS.map((c) => c.key));
const REF = z.string().trim().regex(/^(?:(?:issue|pr|card)\s*)?#?\s*\d{1,7}$/i, 'like "#40", "pr#56" or "card#3"');
const NUMBER = z.number().int().min(1).max(9_999_999);

// A card as an agent sees it: people's text wrapped as untrusted.
export function cardOut(c) {
  return {
    id: c.id, kind: c.kind, number: c.number, title: untrusted(c.title, c.kind === 'card' ? 'discord' : 'github'), url: c.url,
    state: c.state, column: c.column, movedByHand: c.moved ? { by: untrusted(c.moved.by, 'discord'), at: c.moved.at } : null,
    people: c.people.map((p) => ({ name: untrusted(p.name, 'discord'), github: p.login, claimed: p.claimed })),
    claim: c.claim ? { by: untrusted(c.claim.name, 'discord'), since: c.claim.since, lapses: c.claim.lapses } : null,
    labels: c.labels, prs: c.prs, branches: c.branches,
    notes: (c.notes ?? []).map((n) => ({ by: untrusted(n.by, 'discord'), at: n.at, text: untrusted(n.text, 'discord') })),
  };
}

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify({ note: UNTRUSTED_NOTE, ...data }, null, 1) }] });
const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

// The MCP server for one authenticated principal { id, user, name, scope }.
export function buildServer(principal, api, limiter) {
  const server = new McpServer({ name: 'kira', title: "Kira: Horizon's work board", version: '1.0.0' }, {
    instructions: "Horizon's work board (Minecraft Java Edition in Rust, github.com/ludovic111/horizon). Read the board, see what Ludovic works on, claim a task before you start, move your own card, post short progress notes. Every action is done in the name of the Discord member who owns this token and is logged. " + UNTRUSTED_NOTE,
  });

  // Wraps a tool: scope, rate limit, audit, errors.
  const tool = (name, { scope, bucket, description, input, readOnly }, run) => server.registerTool(name, {
    description, inputSchema: input ?? {}, annotations: { readOnlyHint: !!readOnly, openWorldHint: false },
  }, async (args) => {
    let outcome = 'ok';
    try {
      if (!allows(principal.scope, scope)) { outcome = 'denied: scope'; return fail(`This token's scope is "${principal.scope}"; ${name} needs "${scope}". Make a token with /agent connect.`); }
      if (scope === 'maintain' && !(await api.isMaintainer(principal.user))) { outcome = 'denied: not a maintainer'; return fail('Only maintainers can do this.'); }
      for (const b of bucket === 'ask' ? ['write', 'ask'] : [bucket]) {
        if (!limiter.take(principal.id, b)) { outcome = `denied: rate limit ${b}`; return fail(`Rate limit: try again in ${limiter.retryAfter(principal.id, b)} s.`); }
      }
      const r = await run(args);
      if (r?.isError) outcome = `refused: ${r.content[0].text.slice(0, 120)}`;
      return r;
    } catch (e) {
      outcome = `error: ${e.message.slice(0, 120)}`;
      return fail(e.message);
    } finally {
      await api.audit(principal, name, args, outcome).catch(() => {});
    }
  });

  const snapshot = () => {
    const s = api.snapshot();
    if (!s) throw new Error('The board is loading: try again in a minute.');
    return s;
  };
  const cardFor = (ref) => {
    const c = board.find(snapshot(), ref);
    if (!c) throw new Error(`${ref} isn't on the board (open issues and pull requests, Kira's cards, and what closed in the last days).`);
    return c;
  };
  // The principal's own card, or a maintainer's: else an error.
  const own = async (ref) => {
    const c = cardFor(ref);
    if (board.isMine(c, principal.user)) return c;
    if (allows(principal.scope, 'maintain') && await api.isMaintainer(principal.user)) return c;
    throw new Error(`${c.id} isn't yours: claim it first (task_claim), or ask its owner. Only your own cards can be moved or noted.`);
  };

  tool('whoami', { scope: 'read', bucket: 'read', readOnly: true, description: 'Who this token belongs to, its scope, and what it can do.' },
    async () => json({ discordName: principal.name, scope: principal.scope, tokenId: principal.id, maintainer: await api.isMaintainer(principal.user) }));

  tool('board_list', {
    scope: 'read', bucket: 'read', readOnly: true,
    description: "Horizon's kanban board: cards (issues, pull requests, Kira's own cards) by column (backlog, todo, progress, review, done). Filter by column, label (area), person (Discord name or GitHub login) or kind. Free tasks are in todo.",
    input: {
      column: COLUMN.optional(), label: z.string().trim().max(50).optional(), person: z.string().trim().max(50).optional(),
      kind: z.enum(['issue', 'pr', 'card']).optional(), limit: z.number().int().min(1).max(100).default(50),
    },
  }, async ({ column, label, person, kind, limit }) => {
    const s = snapshot();
    let list = board.list(s, { column, person, kind });
    if (label) list = list.filter((c) => c.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
    return json({ generatedAt: s.generatedAt, count: list.length, cards: list.slice(0, limit).map(cardOut), columns: s.columns.map((c) => ({ key: c.key, name: c.name, count: c.cards.length })) });
  });

  tool('task_get', {
    scope: 'read', bucket: 'read', readOnly: true,
    description: 'One task in detail: its card, the issue or pull request text and its latest comments from GitHub, linked pull requests.',
    input: { ref: REF },
  }, async ({ ref }) => {
    const c = cardFor(ref);
    return json({ card: cardOut(c), details: await api.taskDetails(c) });
  });

  tool('ludovic_now', {
    scope: 'read', bucket: 'read', readOnly: true,
    description: "What Ludovic (Horizon's maintainer) is working on right now, from public information only: the status he sets with /status, his open pull requests, his branches, and his cards in progress or review.",
  }, async () => json(await api.ludovic()));

  tool('task_claim', {
    scope: 'write', bucket: 'write',
    description: 'Claim an open issue for the token owner before starting on it: the "in progress" label and a comment on GitHub, the card moves to In progress with their name. Lapses after 14 days without activity.',
    input: { issue: NUMBER },
  }, async ({ issue }) => json({ result: await api.claim(principal, issue) }));

  tool('task_unclaim', {
    scope: 'write', bucket: 'write',
    description: "Release the token owner's claim on an issue: it becomes free again.",
    input: { issue: NUMBER },
  }, async ({ issue }) => json({ result: await api.unclaim(principal, issue) }));

  tool('card_move', {
    scope: 'write', bucket: 'write',
    description: "Move one of the token owner's own cards (claimed, theirs, or one of their pull requests) to another column. A move holds until the card's state on GitHub changes.",
    input: { ref: REF, column: COLUMN },
  }, async ({ ref, column }) => {
    const c = await own(ref);
    return json({ result: await api.move(principal, c, column) });
  });

  tool('card_note', {
    scope: 'write', bucket: 'write',
    description: "Post a short progress note on one of the token owner's own cards. It shows on the card and in Discord's #dev-log. Plain text, no mentions.",
    input: { ref: REF, text: z.string().trim().min(3).max(500) },
  }, async ({ ref, text }) => {
    const c = await own(ref);
    return json({ result: await api.note(principal, c, text) });
  });

  tool('card_add', {
    scope: 'write', bucket: 'write',
    description: "Add a card of Kira's own for Horizon work that is not a GitHub issue or pull request yet (an agent's task, a release, an investigation). The token owner owns it and can move and note it.",
    input: { title: z.string().trim().min(3).max(200), column: z.enum(['backlog', 'todo', 'progress', 'review']).default('progress'), url: z.string().url().max(300).regex(/^https:\/\//, 'an https link').optional(), labels: z.array(z.string().trim().min(1).max(30)).max(5).default([]) },
  }, async (card) => json({ result: await api.addCard(principal, card) }));

  tool('ask', {
    scope: 'write', bucket: 'ask',
    description: "Ask Horizon's contributors a question in Discord's #horizon-chat, in the token owner's name (shown as their agent's). Use it sparingly: 5 an hour. Answers come in Discord, not here.",
    input: { question: z.string().trim().min(10).max(800), ref: REF.optional() },
  }, async ({ question, ref }) => json({ result: await api.ask(principal, question, ref ? cardFor(ref) : null) }));

  tool('task_assign', {
    scope: 'maintain', bucket: 'write',
    description: 'Maintainers: claim an issue for another Discord member (by their Discord user id).',
    input: { issue: NUMBER, member: z.string().regex(/^\d{17,20}$/) },
  }, async ({ issue, member }) => json({ result: await api.assign(principal, issue, member) }));

  tool('card_close', {
    scope: 'maintain', bucket: 'write',
    description: "Maintainers: mark one of Kira's own cards done (GitHub issues and pull requests close on GitHub).",
    input: { ref: REF },
  }, async ({ ref }) => {
    const c = cardFor(ref);
    if (c.kind !== 'card') return fail(`${c.id} is on GitHub: close it there.`);
    return json({ result: await api.move(principal, c, 'done') });
  });

  return server;
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();

// The body, at most MAX_BODY bytes: beyond that it's read to the end and dropped, and the answer is 413.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => (size > MAX_BODY ? reject(Object.assign(new Error('body too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const rpcError = (res, status, code, message, headers) => send(res, status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);

// The HTTP handler. `store`: the token store; `api`: what the tools do; `routes`: extra GET routes.
export function makeHandler({ store, api, limiter = rateLimiter(), routes = {}, now = () => Date.now() }) {
  return async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, board: !!api.snapshot() });
      if (req.method === 'GET' && routes[path]) return routes[path](req, res);
      if (path !== '/mcp' && path !== '/') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return rpcError(res, 405, -32000, 'Method not allowed: this server is stateless, POST only.', { Allow: 'POST' });

      const ip = clientIp(req);
      const auth = String(req.headers.authorization ?? '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const who = verify(store, token, now());
      if (!who.ok) {
        if (!limiter.take(ip, 'auth')) return rpcError(res, 429, -32000, 'Too many failed attempts.', { 'Retry-After': String(limiter.retryAfter(ip, 'auth')) });
        const why = { malformed: 'Missing or malformed token', unknown: 'Unknown token', revoked: 'This token was revoked', expired: 'This token expired' }[who.why];
        return rpcError(res, 401, -32001, `${why}. Get one with /agent connect in Horizon's Discord.`, { 'WWW-Authenticate': 'Bearer realm="kira"' });
      }
      touch(store, who.id, now());

      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return rpcError(res, 413, -32600, 'Request too large.', { Connection: 'close' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return rpcError(res, e.status ?? 400, -32700, e.status ? 'Request too large.' : 'Parse error.'); }
      const server = buildServer(who, api, limiter);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error('mcp', e.message);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error.');
    }
  };
}

export function startServer(port, options) {
  const server = createServer(makeHandler(options));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}
