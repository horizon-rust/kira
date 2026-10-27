// Contributors' AI agents, the Discord side: /agent connect (a token, shown once), /agent tokens, /agent revoke,
// /mytasks (/status is one of the hub's verbs: src/features/hub.js); the MCP server's actions (src/mcp.js) done in the
// token owner's name; and #agent-log, where every agent call is written (staff only).
import { SlashCommandBuilder, MessageFlags, Routes } from 'discord.js';
import { AGENTS, GUILD_ID, OWNER_ID, agentSnippets } from '../config.js';
import { client, state, save, channel, isStaff } from '../core.js';
import { dataFile } from '../store.js';
import { openStore, issue, listFor, revoke, revokeAll, untrusted, oneLine, rateLimiter } from '../agents.js';
import * as board from '../board.js';
import * as wb from './workboard.js';
import * as kiraAi from './ai.js';
import { columnText } from '../workkit.js';

export const store = openStore(process.env.KIRA_AGENTS || dataFile('agents.json'));
{
  const fixed = board.sanitizeCards(wb.workState());
  if (fixed) { save(); console.log(`kira cards: ${fixed} fixed (link or labels against the rules)`); }
}
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const guild = () => client.guilds.cache.get(GUILD_ID);
const memberOf = (id) => guild()?.members.cache.get(id) ?? null;
const colName = (key) => board.COLUMNS.find((c) => c.key === key)?.name ?? key;
// Text from agents or people, made harmless in Discord: one line, no @everyone/@here, no mentions, no masked links
// ([text](url) and its escapes: brackets are escaped, so a link shows as the plain URL it is) (M3).
export const clean = (s, n) => oneLine(s).slice(0, n)
  .replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<[@#][!&]?\d+>/g, '')
  .replace(/\\/g, '\\\\').replace(/[[\]]/g, (c) => `\\${c}`);
const link = (c) => (c.url ? `[#${c.number}](<${c.url}>)` : `#${c.number}`);

// Whether a token's owner is still an active member: on the server and not timed out. Asked from Discord's
// API (works with or without the gateway), remembered 5 seconds at most (H2).
const memberCache = new Map(); // user → { ok, at }
export async function isActiveMember(userId, now = Date.now()) {
  const hit = memberCache.get(userId);
  if (hit && now - hit.at < 5_000) return hit.ok;
  let ok = false;
  try {
    const m = await client.rest.get(Routes.guildMember(GUILD_ID, userId));
    ok = !m.pending && !(m.communication_disabled_until && Date.parse(m.communication_disabled_until) > now);
  } catch {
    ok = false; // not a member (404), or Discord can't tell: refuse
  }
  memberCache.set(userId, { ok, at: now });
  if (memberCache.size > 1000) for (const [k, v] of memberCache) if (now - v.at > 5_000) memberCache.delete(k);
  return ok;
}

// Maintainers: Ludovic, and members with the Mod role (or any staff permission).
async function isMaintainer(userId) {
  if (userId === OWNER_ID) return true;
  const m = memberOf(userId) ?? await guild()?.members.fetch(userId).catch(() => null);
  return !!m && (isStaff(m) || m.roles.cache.has(state.roles.mod));
}

// ── #agent-log: every call, grouped every 30 seconds ────────────────────────
let pending = [];
let timer = null;
async function flushAudit() {
  timer = null;
  const lines = pending.splice(0);
  const ch = channel('agentlog');
  if (!ch || !lines.length) return;
  for (let i = 0; i < lines.length; i += 15) {
    await ch.send({ content: lines.slice(i, i + 15).join('\n').slice(0, 1990), allowedMentions: { parse: [] } }).catch((e) => console.error('agent-log', e.message));
  }
}
async function audit(p, tool, args, outcome) {
  const a = JSON.stringify(args ?? {}).replace(/`/g, "'");
  const line = `🤖 <t:${Math.floor(Date.now() / 1000)}:T> **${clean(p.name, 40)}** (<@${p.user}>, token \`${p.id}\`, ${p.scope}) · \`${tool}\` ${a.length > 2 ? `\`${a.slice(0, 160)}\`` : ''} → ${clean(outcome, 160)}`;
  console.log(`agent ${p.id} ${p.user} ${tool} ${a.slice(0, 200)} → ${outcome}`);
  pending.push(line);
  timer ??= setTimeout(flushAudit, 30_000);
  timer.unref?.();
}

// ── What the MCP tools do (src/mcp.js decides who may) ───────────────────────
const asUser = (p) => ({ id: p.user, globalName: p.name, username: p.name });
const agentName = (p) => `${p.name}'s agent`;

export const api = {
  snapshot: () => wb.current(),
  isMaintainer,
  isActiveMember,
  audit,
  async taskDetails(card) {
    if (card.kind === 'card') return { kind: 'card', notes: card.notes.map((n) => ({ by: untrusted(n.by, 'discord'), at: n.at, text: untrusted(n.text, 'discord') })) };
    const [item, comments] = await Promise.all([
      wb.repoGet(`/issues/${card.number}`),
      wb.repoGet(`/issues/${card.number}/comments?per_page=100`),
    ]);
    const pr = card.kind === 'pr' ? await wb.repoGet(`/pulls/${card.number}`) : null;
    return {
      kind: card.kind, author: item?.user?.login ?? null, createdAt: item?.created_at, state: item?.state,
      body: untrusted((item?.body ?? '').slice(0, 6000), 'github'),
      comments: (comments ?? []).slice(-8).map((c) => ({ author: c.user?.login, at: c.created_at, body: untrusted(c.body.slice(0, 2000), 'github') })),
      pullRequest: pr ? { draft: pr.draft, mergeable: pr.mergeable_state, head: pr.head?.ref == null ? null : untrusted(pr.head.ref, 'github'), base: pr.base?.ref == null ? null : untrusted(pr.base.ref, 'github'), additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files } : null,
    };
  },
  // The questions Kira passed to the team (src/features/ai.js); `close`: the message ids now answered.
  aiHandoffs(close = []) {
    const closed = close.length ? kiraAi.closeHandoffs(close) : 0;
    return { closed, open: kiraAi.handoffsOut() };
  },
  async ludovic() {
    const s = wb.current();
    const st = wb.workState().statuses?.[OWNER_ID];
    const mine = s ? board.cards(s).filter((c) => ['progress', 'review'].includes(c.column) && c.people.some((p) => p.login === AGENTS.ludovicLogin || p.discordId === OWNER_ID)) : [];
    return {
      about: 'Only public information: his /status in Discord, his open pull requests and the branches of horizon-rust/horizon, and his cards on the board.',
      status: st ? { text: untrusted(st.text, 'discord'), setAt: new Date(st.at).toISOString() } : null,
      openPullRequests: wb.openPullsNow().filter((p) => p.author === AGENTS.ludovicLogin).map((p) => ({ ...p, title: untrusted(p.title, 'github') })),
      branches: wb.branchesNow(),
      cards: mine.map((c) => ({ id: c.id, title: untrusted(c.title, c.kind === 'card' ? 'discord' : 'github'), column: c.column, url: c.kind === 'card' && c.url ? untrusted(c.url, 'discord') : c.url })),
    };
  },
  // Without maintain scope + role, an agent is a plain member: no staff exemptions, own claims only (N1, N6).
  claim: (p, n, { asMaintainer = false } = {}) => wb.claim(asUser(p), asMaintainer ? memberOf(p.user) : null, n),
  unclaim: (p, n, { asMaintainer = false } = {}) => wb.unclaim(asUser(p), asMaintainer ? memberOf(p.user) : null, n),
  async assign(p, n, memberId) {
    const m = memberOf(memberId) ?? await guild()?.members.fetch(memberId).catch(() => null);
    if (!m) return `No member ${memberId} on the server.`;
    return `${await wb.claim(m.user, m, n)} (claimed for ${m.displayName} by ${p.name})`;
  },
  async move(p, card, column) {
    const r = board.move(wb.workState(), wb.current(), card.id, column, agentName(p));
    await wb.changed();
    return `${card.id} → ${colName(r.to)}`;
  },
  async note(p, card, text) {
    const line = oneLine(text);
    board.addNote(wb.workState(), wb.current(), card.id, { by: agentName(p), text: line });
    await wb.changed();
    return `Note added to ${card.id}; it shows on the card.`;
  },
  async addCard(p, { title, column, url, labels }) {
    const id = board.addCard(wb.workState(), { title, column, url, labels, owner: { discordId: p.user, name: p.name } }, Date.now(), { maxOpen: AGENTS.maxOpenCards });
    await wb.changed();
    return `${id} added in ${colName(column)}.`;
  },
  async ask(p, question, card) {
    const ch = channel('horizonchat');
    if (!ch) return 'Discord is not reachable right now.';
    const msg = await ch.send({ content: `🤖 **${clean(agentName(p), 60)}** asks${card ? ` about ${link(card)}` : ''}: ${clean(oneLine(question), 800)}\n-# Sent by an AI agent through Kira for <@${p.user}>. Answer here.`, allowedMentions: { parse: [] } });
    return `Posted in #horizon-chat: ${msg.url}. Answers come in Discord.`;
  },
};

// ── Commands ─────────────────────────────────────────────────────────────────

const snippets = (token) => agentSnippets(AGENTS.url, token);

export const commands = [
  new SlashCommandBuilder().setName('agent').setDescription("Connect your AI coding agent to Horizon's work board")
    .addSubcommand((s) => s.setName('connect').setDescription('Get a personal token for your agent (shown once, only to you)')
      .addStringOption((o) => o.setName('scope').setDescription('What your agent may do').addChoices(
        { name: 'read: the board, tasks, what Ludovic works on', value: 'read' },
        { name: 'write: + claim, move and note your own cards, ask', value: 'write' },
        { name: 'maintain: + any card (maintainers only)', value: 'maintain' }))
      .addIntegerOption((o) => o.setName('days').setDescription(`How long it lasts (default ${AGENTS.defaultDays})`).setMinValue(1).setMaxValue(AGENTS.maxDays))
      .addStringOption((o) => o.setName('label').setDescription('A name for it, like "laptop claude"').setMaxLength(40)))
    .addSubcommand((s) => s.setName('tokens').setDescription('Your agent tokens (mods: someone else\'s)')
      .addUserOption((o) => o.setName('member').setDescription('Mods: whose')))
    .addSubcommand((s) => s.setName('revoke').setDescription('Revoke a token now')
      .addStringOption((o) => o.setName('id').setDescription('Its id, from /agent tokens (8 characters)').setRequired(true).setMinLength(8).setMaxLength(8))),
  new SlashCommandBuilder().setName('mytasks').setDescription('Your cards on the work board (only you see it)'),
];

const date = (ms) => `<t:${Math.floor(ms / 1000)}:d>`;

export const handlers = {
  async agent(i) {
    const sub = i.options.getSubcommand();
    if (sub === 'connect') {
      if (!AGENTS.issuance) return i.reply(ephemeral('Agent tokens are not open yet: the MCP server is being reviewed. It will be announced in #announcements.'));
      const scope = i.options.getString('scope') ?? 'read';
      if (scope === 'maintain' && !(await isMaintainer(i.user.id))) return i.reply(ephemeral('Only maintainers can make a "maintain" token.'));
      const days = i.options.getInteger('days') ?? AGENTS.defaultDays;
      let t;
      try {
        t = issue(store, { user: i.user.id, name: i.member?.displayName ?? i.user.username, scope, days, label: i.options.getString('label'), maxPerUser: AGENTS.maxPerUser, maxPerDay: AGENTS.maxPerDay });
      } catch (e) {
        return i.reply(ephemeral(e.message));
      }
      audit({ id: t.id, user: i.user.id, name: i.member?.displayName ?? i.user.username, scope }, 'agent connect', { days }, 'token issued');
      return i.reply(ephemeral([
        `🔑 Your **${scope}** token \`${t.id}\` (expires ${date(t.record.expiresAt)}). **Shown once**: copy it now. It's personal: everything your agent does is in your name and logged.`,
        `\`\`\`\n${t.token}\n\`\`\``,
        snippets(t.token),
        'For Codex and Cursor: `export KIRA_TOKEN=` followed by the token, in the shell that starts them.',
        'Lost it or leaked it? `/agent revoke id:' + t.id + '`, then connect again.',
      ].join('\n').slice(0, 2000)));
    }
    if (sub === 'tokens') {
      const target = i.options.getUser('member') ?? i.user;
      if (target.id !== i.user.id && !isStaff(i.member)) return i.reply(ephemeral('Only mods can see someone else\'s tokens.'));
      const list = listFor(store, target.id);
      if (!list.length) return i.reply(ephemeral(`No agent tokens${target.id === i.user.id ? '' : ` for ${target.username}`}. ${AGENTS.issuance ? '`/agent connect` makes one.' : ''}`));
      return i.reply(ephemeral(list.map((t) => `\`${t.id}\` · ${t.scope}${t.label ? ` · ${clean(t.label, 40)}` : ''} · **${t.status}** · made ${date(t.createdAt)} · expires ${date(t.expiresAt)} · last used ${t.lastUsedAt ? `<t:${Math.floor(t.lastUsedAt / 1000)}:R>` : 'never'}`).join('\n').slice(0, 1990)));
    }
    if (sub === 'revoke') {
      const id = i.options.getString('id').toLowerCase();
      try {
        const t = revoke(store, id, { user: i.user.id, any: isStaff(i.member) });
        audit({ id, user: t.user, name: t.name, scope: t.scope }, 'agent revoke', {}, `revoked by ${i.user.username}`);
        return i.reply(ephemeral(`🔒 Token \`${id}\` is revoked: it stops working now.`));
      } catch (e) {
        return i.reply(ephemeral(e.message));
      }
    }
  },
  mytasks(i) {
    const s = wb.current();
    if (!s) return i.reply(ephemeral('The board is loading: try again in a minute.'));
    const mine = board.cards(s).filter((c) => board.isMine(c, i.user.id) && c.column !== 'done');
    if (!mine.length) return i.reply(ephemeral('No cards of yours on the board. Pick one in **To do** on #work-board and `/claim` it.'));
    const cols = board.COLUMNS.map((c) => ({ key: c.key, cards: mine.filter((x) => x.column === c.key) })).filter((c) => c.cards.length);
    return i.reply(ephemeral(cols.map((c) => { const t = columnText(c, Date.now(), 900); return `**${t.title}**\n${t.description}`; }).join('\n\n').slice(0, 1990)));
  },
};

// Members who leave or are banned lose their tokens at once (and the 5-second check covers the gap) (H2).
async function dropTokens(user, why) {
  memberCache.delete(user.id);
  const ids = revokeAll(store, user.id);
  if (ids.length) audit({ id: ids.join(','), user: user.id, name: user.username ?? user.id, scope: '-' }, 'tokens revoked', {}, `${ids.length} token(s): ${why}`);
}

export function setup() {
  client.on('guildMemberRemove', (m) => { if (m.guild.id === GUILD_ID) dropTokens(m.user, 'left the server').catch((e) => console.error('agent tokens', e.message)); });
  client.on('guildBanAdd', (ban) => { if (ban.guild.id === GUILD_ID) dropTokens(ban.user, 'banned').catch((e) => console.error('agent tokens', e.message)); });
}
export const _test = { dropTokens, memberCache };
