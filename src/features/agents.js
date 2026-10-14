// Contributors' AI agents, the Discord side: /agent connect (a token, shown once), /agent tokens, /agent revoke,
// /status (what you're working on, in your words), /mytasks; the MCP server's actions (src/mcp.js) done in the
// token owner's name; and #agent-log, where every agent call is written (staff only).
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { AGENTS, GUILD_ID, OWNER_ID } from '../config.js';
import { client, state, save, channel, isStaff } from '../core.js';
import { dataFile } from '../store.js';
import { openStore, issue, listFor, revoke, untrusted } from '../agents.js';
import * as board from '../board.js';
import * as wb from './workboard.js';
import { columnText } from '../workkit.js';

export const store = openStore(process.env.KIRA_AGENTS || dataFile('agents.json'));
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const guild = () => client.guilds.cache.get(GUILD_ID);
const memberOf = (id) => guild()?.members.cache.get(id) ?? null;
const colName = (key) => board.COLUMNS.find((c) => c.key === key)?.name ?? key;
const clean = (s, n) => String(s).replace(/@(everyone|here)/gi, '@​$1').replace(/<[@#][!&]?\d+>/g, '').slice(0, n);
const link = (c) => `[#${c.number}](<${c.url ?? `https://discord.com/channels/${GUILD_ID}/${state.channels.workboard}`}>)`;

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
}

// ── What the MCP tools do (src/mcp.js decides who may) ───────────────────────
const asUser = (p) => ({ id: p.user, globalName: p.name, username: p.name });
const agentName = (p) => `${p.name}'s agent`;

export const api = {
  snapshot: () => wb.current(),
  isMaintainer,
  audit,
  async taskDetails(card) {
    if (card.kind === 'card') return { kind: 'card', notes: card.notes.map((n) => ({ ...n, text: untrusted(n.text, 'discord') })) };
    const [item, comments] = await Promise.all([
      wb.repoGet(`/issues/${card.number}`),
      wb.repoGet(`/issues/${card.number}/comments?per_page=100`),
    ]);
    const pr = card.kind === 'pr' ? await wb.repoGet(`/pulls/${card.number}`) : null;
    return {
      kind: card.kind, author: item?.user?.login ?? null, createdAt: item?.created_at, state: item?.state,
      body: untrusted((item?.body ?? '').slice(0, 6000), 'github'),
      comments: (comments ?? []).slice(-8).map((c) => ({ author: c.user?.login, at: c.created_at, body: untrusted(c.body.slice(0, 2000), 'github') })),
      pullRequest: pr ? { draft: pr.draft, mergeable: pr.mergeable_state, head: pr.head?.ref, base: pr.base?.ref, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files } : null,
    };
  },
  async ludovic() {
    const s = wb.current();
    const st = wb.workState().statuses?.[OWNER_ID];
    const mine = s ? board.cards(s).filter((c) => ['progress', 'review'].includes(c.column) && c.people.some((p) => p.login === AGENTS.ludovicLogin || p.discordId === OWNER_ID)) : [];
    return {
      about: 'Only public information: his /status in Discord, his open pull requests and the branches of ludovic111/horizon, and his cards on the board.',
      status: st ? { text: untrusted(st.text, 'discord'), setAt: new Date(st.at).toISOString() } : null,
      openPullRequests: wb.openPullsNow().filter((p) => p.author === AGENTS.ludovicLogin).map((p) => ({ ...p, title: untrusted(p.title, 'github') })),
      branches: wb.branchesNow(),
      cards: mine.map((c) => ({ id: c.id, title: untrusted(c.title, c.kind === 'card' ? 'discord' : 'github'), column: c.column, url: c.url })),
    };
  },
  claim: (p, n) => wb.claim(asUser(p), memberOf(p.user), n),
  unclaim: (p, n) => wb.unclaim(asUser(p), memberOf(p.user), n),
  async assign(p, n, memberId) {
    const m = memberOf(memberId) ?? await guild()?.members.fetch(memberId).catch(() => null);
    if (!m) return `No member ${memberId} on the server.`;
    return `${await wb.claim(m.user, m, n)} (claimed for ${m.displayName} by ${p.name})`;
  },
  async move(p, card, column) {
    const r = board.move(wb.workState(), wb.current(), card.id, column, agentName(p));
    await wb.changed();
    if (r.from !== r.to) await wb.log(`📌 **${clean(agentName(p), 60)}** moved ${link(card)} ${clean(card.title, 80)} to ${colName(r.to)}`);
    return `${card.id} → ${colName(r.to)}`;
  },
  async note(p, card, text) {
    board.addNote(wb.workState(), wb.current(), card.id, { by: agentName(p), text });
    await wb.changed();
    await wb.log(`📝 **${clean(agentName(p), 60)}** on ${link(card)}: ${clean(text, 400)}`);
    return `Note added to ${card.id}; it shows on the card and in #dev-log.`;
  },
  async addCard(p, { title, column, url, labels }) {
    const id = board.addCard(wb.workState(), { title, column, url, labels, owner: { discordId: p.user, name: p.name } });
    await wb.changed();
    const c = board.find(wb.current(), id);
    await wb.log(`🆕 **${clean(agentName(p), 60)}** added ${link(c)} ${clean(title, 120)} (${colName(column)})`);
    return `${id} added in ${colName(column)}.`;
  },
  async ask(p, question, card) {
    const ch = channel('horizonchat');
    if (!ch) return 'Discord is not reachable right now.';
    const msg = await ch.send({ content: `🤖 **${clean(agentName(p), 60)}** asks${card ? ` about ${link(card)}` : ''}: ${clean(question, 800)}\n-# Sent by an AI agent through Kira for <@${p.user}>. Answer here.`, allowedMentions: { parse: [] } });
    return `Posted in #horizon-chat: ${msg.url}. Answers come in Discord.`;
  },
};

// ── Commands ─────────────────────────────────────────────────────────────────

const snippets = (token) => [
  '**Claude Code**',
  '```',
  `claude mcp add --transport http horizon ${AGENTS.url} --header "Authorization: Bearer ${token}"`,
  '```',
  '**Codex** (`~/.codex/config.toml`; put the token in the `HORIZON_KIRA_TOKEN` environment variable)',
  '```toml',
  '[mcp_servers.horizon]',
  `url = "${AGENTS.url}"`,
  'bearer_token_env_var = "HORIZON_KIRA_TOKEN"',
  '```',
  '**Cursor** (`.cursor/mcp.json`)',
  '```json',
  `{ "mcpServers": { "horizon": { "url": "${AGENTS.url}", "headers": { "Authorization": "Bearer ${token}" } } } }`,
  '```',
].join('\n');

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
  new SlashCommandBuilder().setName('status').setDescription('Say what you are working on (agents and /working show it); empty clears it')
    .addStringOption((o) => o.setName('text').setDescription('What you are on right now').setMaxLength(200)),
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
        t = issue(store, { user: i.user.id, name: i.member?.displayName ?? i.user.username, scope, days, label: i.options.getString('label'), maxPerUser: AGENTS.maxPerUser });
      } catch (e) {
        return i.reply(ephemeral(e.message));
      }
      audit({ id: t.id, user: i.user.id, name: i.member?.displayName ?? i.user.username, scope }, 'agent connect', { days }, 'token issued');
      return i.reply(ephemeral([
        `🔑 Your **${scope}** token \`${t.id}\` (expires ${date(t.record.expiresAt)}). **Shown once**: copy it now. It's personal: everything your agent does is in your name and logged.`,
        `\`\`\`\n${t.token}\n\`\`\``,
        snippets(t.token),
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
  async status(i) {
    const text = i.options.getString('text')?.trim();
    const w = wb.workState();
    w.statuses ??= {};
    if (text) w.statuses[i.user.id] = { text, at: Date.now() };
    else delete w.statuses[i.user.id];
    save();
    return i.reply(ephemeral(text ? `📍 Status set: ${clean(text, 200)}` : 'Status cleared.'));
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
