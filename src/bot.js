// Kira at runtime: wires the feature modules, the commands, the releases, the one-off posts and the MCP server.
// KIRA_DISCORD=off: no Discord connection at all, only the board (from GitHub) and the MCP server, to test a
// new host. PORT (Railway) or KIRA_HTTP_PORT: where the MCP server listens; none, no server.
import { MessageFlags, MessageType } from 'discord.js';
import { GUILD_ID, RELEASE_EVERY_MS, RELEASE_SLOW_MS, VIDEOS, RELEASE_REPOS, ONE_OFFS, COLOR, WORK, AGENTS, GITHUB, ORG, OWNER_ID } from './config.js';
import { client, state, save, channel } from './core.js';
import { newReleases } from './feeds.js';
import { releaseMessage, remember, announced, pingDecision } from './releases.js';
import { makeGitHub, persistEtags } from './github.js';
import { githubToken } from './github-app.js';
import * as videos from './videos.js';
import { linkify } from './texts.js';
import * as moderation from './features/moderation.js';
import * as levels from './features/levels.js';
import * as rooms from './features/rooms.js';
import * as community from './features/community.js';
import * as forums from './features/forums.js';
import * as github from './features/github.js';
import * as workboard from './features/workboard.js';
import * as contributors from './features/contributors.js';
import * as teamvote from './features/teamvote.js';
import * as notify from './features/notify.js';
import * as site from './features/site.js';
import * as smp from './features/smp.js';
import * as webhook from './webhook.js';
import * as triage from './features/triage.js';
import * as agents from './features/agents.js';
import * as hub from './features/hub.js';
import * as updates from './features/updates.js';
import * as x from './features/x.js';
import * as kiraAi from './features/ai.js';
import { gameRoutes, gameTokens, openServers } from './features/game.js';
import * as chatclear from './features/chatclear.js';
import * as sponsors from './features/sponsors.js';
import * as staff from './features/staff.js';
import * as support from './features/support.js';
import * as apply from './features/apply.js';
import * as modcases from './features/modcases.js';
import * as batchmod from './features/batchmod.js';
import * as teamroles from './features/teamroles.js';
import { startServer } from './mcp.js';
import { adminRoutes } from './admin.js';
import * as launcherGithub from './launcher-github.js';
import * as orgChart from './org-chart.js';
import { rateLimiter } from './agents.js';
import { dataFile, freeze } from './store.js';
import { publicKey } from './secrets.js';
import { applyBrand } from './brand.js';

const FEATURES = [modcases, moderation, batchmod, levels, rooms, community, forums, github, workboard, contributors, notify, site, smp, triage, agents, hub, updates, x, kiraAi, chatclear, sponsors, staff, support, apply, teamroles, teamvote];
const DISCORD = process.env.KIRA_DISCORD !== 'off';
const handlers = Object.assign({}, ...FEATURES.map((f) => f.handlers));
const commands = FEATURES.flatMap((f) => f.commands);

// New Horizon releases → #releases, each once by release id (state.releases). One channel since 2026-10-23: every
// release gets one post, mentioning nobody except the day's ping (pingDecision, state.releasePings). state.nightlies holds the
// ids posted as Alpha before that; it no longer grows, and those ids are never posted again.
const releasesGh = makeGitHub({ token: githubToken() });
async function checkReleases() {
  state.releases ??= {};
  state.nightlies ??= {};
  for (const key of Object.keys(state.seen)) if (key.startsWith('gh:') || key === 'youtube') delete state.seen[key]; // the old feeds
  for (const repo of RELEASE_REPOS) {
    try {
      const list = await newReleases(releasesGh, repo, state.releases[repo], state.nightlies[repo] ?? []);
      for (const release of list) {
        if (!announced(repo, release)) { // another kind of tag (a test, a tool): remembered, never posted
          state.releases[repo] = remember(state.releases[repo], release.id);
          save();
          continue;
        }
        const plan = pingDecision(repo, release, state.releasePings);
        const msg = await channel('releases').send(releaseMessage(repo, release, plan.ping ? state.roles.releases : null, plan.since));
        state.releasePings = plan.pings;
        state.releases[repo] = remember(state.releases[repo], release.id);
        save();
        console.log(`release posted: ${repo} ${release.tag_name} (${release.id})${plan.ping ? ' with the ping' : ''} → message ${msg.id}`);
      }
    } catch (e) {
      console.error('releases', repo, e.message);
    }
  }
}

// Ludovic's new YouTube videos → #ludovic-videos, each once (state.videos; src/videos.js), pinging the 🎬 Videos role. Until setup has made
// the channel nothing is fetched or recorded, so the first poll after setup is the one that records what is out.
async function checkVideos() {
  const target = channel('ludovicvideos');
  if (!target) return console.log('videos: no #ludovic-videos yet (run setup, then restart)');
  await videos.poll({ state, save, role: state.roles.newvideos, send: (msg) => target.send(msg) });
}

// Hand-written announcements (ONE_OFFS in config.js), each posted once (its id in state.oneOffs). `when`:
// posted only once that is on ('agents': /agent connect open; 'notify': /notify's webhook is set up). `editable`: edited in place at every start.
const ON = { agents: () => AGENTS.issuance, notify: () => notify.webhookOn() };
async function postOneOffs() {
  state.oneOffs ??= {};
  for (const post of ONE_OFFS) {
    if (post.when && !ON[post.when]?.()) continue;
    const role = post.role && state.roles[post.role];
    const payload = { content: (role ? `<@&${role}> ${post.content}` : post.content) || undefined, embeds: [{ color: COLOR, ...post.embed, description: post.embed.description && linkify(post.embed.description, state) }], allowedMentions: { parse: [], roles: role ? [role] : [] } };
    try {
      if (state.oneOffs[post.key]) {
        if (!post.editable) continue;
        const old = await channel(post.channel)?.messages.fetch(state.oneOffs[post.key]).catch(() => null);
        if (old) { await old.edit({ ...payload, content: payload.content ?? '' }); continue; }
        if (old === null && !post.pin) continue; // deleted by hand: not posted again (pinned guides are)
      }
      const msg = await channel(post.channel).send(payload);
      state.oneOffs[post.key] = msg.id;
      save();
      console.log(`one-off posted: ${post.key} → message ${msg.id}`);
      if (post.pin) {
        await msg.pin().catch((e) => console.error('pin', post.key, e.message));
        // Discord's "Kira pinned a message" line: not wanted in a read-only channel.
        const notices = await msg.channel.messages.fetch({ limit: 5 }).catch(() => null);
        for (const m of notices?.values() ?? []) if (m.type === MessageType.ChannelPinnedMessage && m.author.id === client.user.id) await m.delete().catch(() => {});
      }
      await msg.crosspost().catch(() => {});
    } catch (e) {
      console.error('one-off', post.key, e.message);
    }
  }
}

site.afterRevalidate(() => updates.pollSoon());
if (DISCORD) for (const f of FEATURES) f.setup?.();
else { // the board alone, from GitHub
  console.log('discord: off (KIRA_DISCORD=off): board and MCP server only');
  workboard.refresh();
  setInterval(() => workboard.refresh(), WORK.refreshMs);
}

// The holders of the org chart's roles, from the member cache (filled at start by the work board), or null before it.
function staffMembers() {
  const guild = DISCORD ? client.guilds.cache.get(GUILD_ID) : null;
  if (!guild?.members.cache.size) return null;
  const ids = Object.fromEntries(Object.entries(ORG.roles).map(([key, id]) => [key, state.roles?.[key] || id]));
  const out = [];
  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;
    const roles = Object.keys(ids).filter((key) => m.roles.cache.has(ids[key]) || (key === 'owner' && m.id === OWNER_ID));
    if (roles.length) out.push({ id: m.id, username: m.user.username, name: m.user.globalName || m.user.username, avatar: m.user.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }), roles });
  }
  return out;
}

const port = process.env.PORT || process.env.KIRA_HTTP_PORT;
if (port) {
  const limiter = rateLimiter();
  const gameServers = openServers();
  const routes = {
    ...(publicKey ? { '/seal-key': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(publicKey); } } : {}),
    // The pairs members agreed to show, for the hub's contributors page (public, read-only, cached 5 minutes).
    '/contributors.json': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ contributors: workboard.creditedPairs() }));
    },
    // The hub's org chart: the staff roles' holders, names and confirmed GitHub logins only (public, read-only, 5 minutes).
    '/staff.json': orgChart.route({ read: staffMembers, github: () => ({ ...WORK.github, ...ORG.github, ...workboard.creditedLogins() }), jobs: ORG.jobs }),
    ...kiraAi.usageRoutes({ limiter }),
    ...smp.routes({ limiter }), // POST /smp/ingest/*, GET /smp/*.json: the official server's market for the hub, with KIRA_SMP_INGEST_TOKEN
    ...launcherGithub.routes({ limiter }), // GET /github/public/…: the launcher's release reads when GitHub rate-limits it (public, read-only)
    ...site.routes({ limiter }), // GET /github/proxy/…: the website's GitHub reads, with KIRA_SITE_REVALIDATE_SECRET
    ...webhook.routes({ limiter, owner: GITHUB.owner }), // POST /github/webhook, when KIRA_GITHUB_WEBHOOK_SECRET is set (src/webhook.js)
    ...(DISCORD ? staff.routes(modcases.routes()) : {}), // the staff dashboards' API, only through the website's proxy (STAFF_PROXY_KEY)
    ...gameRoutes({ store: gameServers, ask: kiraAi.askInGame, limiter }),
    ...adminRoutes({ hash: process.env.KIRA_ADMIN_TOKEN_SHA256, limiter, save, freeze, gameTokens: gameTokens({ store: gameServers, dm: async (id, text) => (await client.users.fetch(id)).send({ content: text, allowedMentions: { parse: [] } }), endpoint: `${AGENTS.url.replace(/\/mcp$/, '')}/game/ask` }), cleanup: DISCORD && contributors.enabled ? contributors.cleanup : null, ranks: DISCORD && contributors.enabled ? contributors.ensureRankRoles : null, files: { state: dataFile('state.json'), agents: process.env.KIRA_AGENTS || dataFile('agents.json') } }),
  };
  startServer(Number(port), { store: agents.store, api: agents.api, routes, limiter }).then(() => console.log(`mcp server on :${port}${routes['GET /admin/backup'] ? ', admin routes on' : ''}`));
}

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  await guild.commands.set(commands.map((c) => c.toJSON()));
  await client.application.commands.set([]); // no global commands: everything is per server
  client.user.setActivity('Horizon · playhorizon.dev');
  await applyBrand(client, guild, state, save).catch((e) => console.error('brand', e.message));
  console.log(`Kira ready as ${client.user.tag}, ${commands.length} commands`);
  await checkReleases();
  // GitHub's webhook: a release event checks at once; the 3-minute poll then runs every 30 minutes as a fallback.
  let lastReleases = Date.now();
  const releasesNow = webhook.throttle(() => { lastReleases = Date.now(); return checkReleases(); }, 30_000, { delayMs: 3_000 });
  webhook.on((name, p) => { if (name === 'release' && RELEASE_REPOS.includes(webhook.repoOf(p))) releasesNow(); });
  setInterval(() => { if (Date.now() - lastReleases >= webhook.every(RELEASE_EVERY_MS, RELEASE_SLOW_MS) - 5_000) { lastReleases = Date.now(); checkReleases(); } }, RELEASE_EVERY_MS);
  checkVideos().catch((e) => console.error('videos', e.message));
  setInterval(() => checkVideos().catch((e) => console.error('videos', e.message)), VIDEOS.everyMs);
  await postOneOffs();
});

client.on('interactionCreate', async (i) => {
  if (!(i.isChatInputCommand() || i.isMessageContextMenuCommand()) || i.guildId !== GUILD_ID) return;
  const run = handlers[i.commandName];
  if (!run) return;
  try {
    await run(i);
  } catch (e) {
    console.error('command', i.commandName, e);
    const reply = { content: `Something went wrong: ${e.message}`.slice(0, 300), flags: MessageFlags.Ephemeral };
    await (i.deferred || i.replied ? i.followUp(reply) : i.reply(reply)).catch(() => {});
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || msg.guildId !== GUILD_ID) return;
  try {
    if (await moderation.moderate(msg)) return; // removed: no XP, no thread
    if (await batchmod.onMessage(msg)) return; // read in its channel's next window; `undo case #N` from a mod
    await levels.onMessage(msg);
    if (await kiraAi.onMessage(msg)) return; // a question to Kira (when KIRA_AI is on)
    if (await hub.onMessage(msg)) return; // "@Kira <verb>"
    await community.onMessage(msg);
    await github.onMessage(msg);
    workboard.onMessage(msg);
  } catch (e) {
    console.error('message', e);
  }
});

process.on('unhandledRejection', (e) => console.error('unhandled', e));
// The ETag caches of the GitHub clients, kept on the volume (data/github-etags.json, KIRA_GITHUB_ETAGS): after a
// deploy the first reads are conditional, and a 304 costs nothing.
const etags = persistEtags(process.env.KIRA_GITHUB_ETAGS || dataFile('github-etags.json'));
process.on('SIGTERM', () => { save(); etags.save(); process.exit(0); });
if (DISCORD) client.login(process.env.DISCORD_TOKEN);
