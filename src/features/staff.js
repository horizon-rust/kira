// The staff dashboards' Discord side: who may open which dashboard (🌌 Horizon Team → /hub/team, 🛡️ Mod →
// /hub/mod, Ludovic both), /staff password (a one-time link to set one's password, DMed), taking access back
// when the role goes, and the counters behind the stats. The HTTP API is src/staff-http.js; applications are
// src/applications.js (contract: docs/staff-api.md).
import { SlashCommandBuilder, MessageFlags, Routes, AuditLogEvent, PermissionFlagsBits as P } from 'discord.js';
import { GUILD_ID, OWNER_ID, LINKS } from '../config.js';
import { client, state, modlog, channel } from '../core.js';
import { dataFile } from '../store.js';
import { openStaffStore } from '../staff-store.js';
import * as auth from '../staff-auth.js';
import { staffRoutes } from '../staff-http.js';
import { counters as makeCounters } from '../staff-counters.js';
import { applicationRoutes } from './staff-apply.js';
import { teamRoutes } from './staff-team.js';
import { statsRoutes } from './staff-stats.js';

// The roles' ids by key; setup's ids win, these are the server's as of 2026-10-30.
const ROLE_IDS = { team: '1564768999655481485', mod: '1559242168864997537' };
const roleId = (key) => state.roles[key] || ROLE_IDS[key];
export const SITE = (process.env.STAFF_SITE_URL || LINKS.horizonSite).replace(/\/+$/, '');

let store = null;
try {
  store = openStaffStore(process.env.KIRA_STAFF || dataFile('staff.json'));
} catch (e) {
  console.error('staff: off:', e.message);
}
export const staffStore = () => store;
const count = store ? makeCounters(store) : null;

// The dashboards a set of role ids opens.
export const dashboardsFor = (userId, roles) => {
  if (userId === OWNER_ID) return ['team', 'mod'];
  return ['team', 'mod'].filter((k) => roles.includes(roleId(k)));
};

// Asked from Discord, remembered 5 seconds: { name, dashboards } or null (not on the server).
const cache = new Map();
export async function access(userId, now = Date.now()) {
  const hit = cache.get(userId);
  if (hit && now - hit.at < 5_000) return hit.value;
  let value = null;
  try {
    const m = await client.rest.get(Routes.guildMember(GUILD_ID, userId));
    value = { name: m.user.username, dashboards: dashboardsFor(userId, m.roles ?? []) };
  } catch {
    value = null;
  }
  cache.set(userId, { at: now, value });
  if (cache.size > 500) for (const [k, v] of cache) if (now - v.at > 5_000) cache.delete(k);
  return value;
}

const log = (text) => { console.log(text); modlog('Staff dashboards', text, 0x9b59b6); };

// Password, sessions and links go when nothing opens a dashboard any more.
function revoke(userId, why) {
  cache.delete(userId);
  if (store && auth.forget(store, userId)) log(`🔒 <@${userId}>: dashboard access removed (${why}).`);
}

// deps: the dev server's fakes for Discord and GitHub (scripts/staff-dev.mjs); none in production.
export function routes(extra = [], deps = {}) {
  if (!store) return {};
  // Last login or write per member (at most one write an hour each): who counts as an active voter.
  const onActive = (user, now) => { if ((store.data.activity?.[user] ?? 0) < now - auth.HOUR) store.update((d) => { (d.activity ??= {})[user] = now; }); };
  return staffRoutes({ store, key: process.env.STAFF_PROXY_KEY, origin: SITE, access: deps.access ?? access, log, onActive, extra: [...applicationRoutes({ store, site: SITE, log, deps }), ...teamRoutes({ store, log, deps }), ...statsRoutes({ store, deps }), ...extra] });
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const sent = new Map(); // target → times a link was sent, the last hour

export const commands = [
  new SlashCommandBuilder().setName('staff').setDescription('The staff dashboards on playhorizon.dev (Horizon Team and Mods)')
    .addSubcommand((s) => s.setName('password').setDescription('Get a one-time link (in DMs) to set your dashboard password')
      .addUserOption((o) => o.setName('member').setDescription('Send it to another Team member or Mod instead'))),
];

export const handlers = {
  async staff(i) {
    if (!store) return i.reply(ephemeral('The dashboards are off right now.'));
    const mine = await access(i.user.id);
    if (!mine?.dashboards.length) return i.reply(ephemeral('Only the Horizon Team and the Mods have a dashboard.'));
    const target = i.options.getUser('member') ?? i.user;
    const theirs = target.id === i.user.id ? mine : await access(target.id);
    if (!theirs?.dashboards.length) return i.reply(ephemeral(`<@${target.id}> has neither the Horizon Team role nor the Mod role.`));
    const now = Date.now();
    const recent = (sent.get(target.id) ?? []).filter((t) => t > now - auth.HOUR);
    if (recent.length >= 3) return i.reply(ephemeral('Three links were sent to them in the last hour: wait a little.'));
    const { token } = auth.issueLink(store, { user: target.id, purpose: 'password', by: i.user.id }, now);
    const by = target.id === i.user.id ? '' : `\n<@${i.user.id}> asked for this link for you.`;
    try {
      await target.send({
        content: `Your link to set your password for Horizon's staff dashboards (${theirs.dashboards.map((d) => `${SITE}/hub/${d}`).join(', ')}). It works once, for 30 minutes; your username is **${theirs.name}**.${by}\n${SITE}/hub/setup#${token}\nDon't share it. Didn't ask for it? Ignore it, or tell a mod.`,
        allowedMentions: { parse: [] },
      });
    } catch {
      auth.useLink(store, token, 'password', now); // undelivered: void it at once
      return i.reply(ephemeral(`I couldn't DM <@${target.id}>: their DMs from server members are off.`));
    }
    sent.set(target.id, [...recent, now]);
    log(`🔑 Password link sent to <@${target.id}>${by ? ` (asked by <@${i.user.id}>)` : ''}.`);
    return i.reply(ephemeral(target.id === i.user.id ? 'Check your DMs: the link works once, for 30 minutes.' : `Sent to <@${target.id}> in DMs.`));
  },
};

// Warnings are Kira's own record (state.warnings): those newer than the last count are counted.
function countWarns() {
  const after = store.data.counters._warnsAfter ?? Date.now();
  let newest = after;
  let n = 0;
  for (const list of Object.values(state.warnings ?? {})) for (const w of list) if (w.at > after) { n++; newest = Math.max(newest, w.at); }
  if (n) count.bump('warns', n);
  if (newest !== store.data.counters._warnsAfter) store.update((d) => { d.counters._warnsAfter = newest; });
}

export function setup() {
  if (!store) return;
  client.on('guildMemberUpdate', (before, after) => {
    if (after.guild.id !== GUILD_ID) return;
    cache.delete(after.id);
    if (!dashboardsFor(after.id, [...after.roles.cache.keys()]).length) revoke(after.id, 'role removed');
  });
  client.on('guildMemberRemove', (m) => { if (m.guild.id === GUILD_ID) { count.bump('leaves'); revoke(m.id, 'left the server'); } });
  client.on('guildMemberAdd', (m) => { if (m.guild.id === GUILD_ID) count.bump('joins'); });
  client.on('messageCreate', (msg) => {
    if (msg.guildId !== GUILD_ID) return;
    if (!msg.author.bot) return count.message(msg.author.id);
    if (msg.author.id === client.user.id && msg.channelId === state.channels.reports && msg.embeds.length) count.bump('reports');
  });
  client.on('threadCreate', (thread, newly) => { if (newly && thread.parentId && thread.parentId === channel('modmail')?.id && !/^⚖️/u.test(thread.name)) count.bump('modmail'); });
  client.on('guildAuditLogEntryCreate', (entry, guild) => {
    if (guild.id !== GUILD_ID) return;
    if (entry.action === AuditLogEvent.MemberKick) count.bump('kicks');
    else if (entry.action === AuditLogEvent.MemberBanAdd) count.bump('bans');
    else if (entry.action === AuditLogEvent.AutoModerationBlockMessage) count.bump('automod');
    else if (entry.action === AuditLogEvent.MemberUpdate && entry.changes.some((c) => c.key === 'communication_disabled_until' && c.new)) count.bump('timeouts');
  });
  setInterval(() => { try { countWarns(); count.flush(); } catch (e) { console.error('staff counters', e.message); } }, 60_000);

  // At start: accounts whose owner lost every dashboard role while Kira was away.
  // (Polled rather than another clientReady listener: the client has ten already.)
  const whenReady = (fn) => (client.isReady() ? fn() : setTimeout(() => whenReady(fn), 5_000));
  whenReady(async () => {
    // Only on a sure answer: a member without the roles, or Discord's "Unknown Member". Any other error keeps them.
    for (const userId of Object.keys(store.data.accounts)) {
      try {
        const m = await client.rest.get(Routes.guildMember(GUILD_ID, userId));
        if (!dashboardsFor(userId, m.roles ?? []).length) revoke(userId, 'role removed');
      } catch (e) {
        if (e.code === 10007) revoke(userId, 'not on the server');
      }
    }
  });
}
