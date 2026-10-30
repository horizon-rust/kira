// Kira at runtime: wires the feature modules, the commands, the releases, the one-off posts and the MCP server.
// KIRA_DISCORD=off: no Discord connection at all, only the board (from GitHub) and the MCP server, to test a
// new host. PORT (Railway) or KIRA_HTTP_PORT: where the MCP server listens; none, no server.
import { MessageFlags, MessageType } from 'discord.js';
import { GUILD_ID, RELEASE_EVERY_MS, VIDEOS, RELEASE_REPOS, ONE_OFFS, COLOR, WORK, AGENTS } from './config.js';
import { client, state, save, channel } from './core.js';
import { newReleases } from './feeds.js';
import { releaseMessage, remember, announced, pingDecision } from './releases.js';
import { makeGitHub } from './github.js';
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
import { startServer } from './mcp.js';
import { adminRoutes } from './admin.js';
import { rateLimiter } from './agents.js';
import { dataFile, freeze } from './store.js';
import { publicKey } from './secrets.js';
import { applyBrand } from './brand.js';

const FEATURES = [moderation, levels, rooms, community, forums, github, workboard, contributors, triage, agents, hub, updates, x, kiraAi, chatclear, sponsors, staff, support];
const DISCORD = process.env.KIRA_DISCORD !== 'off';
const handlers = Object.assign({}, ...FEATURES.map((f) => f.handlers));
const commands = FEATURES.flatMap((f) => f.commands);

// New Horizon releases → #releases, each once by release id (state.releases). One channel since 2026-10-23: every
// release gets one post, @silent except the day's ping (pingDecision, state.releasePings). state.nightlies holds the
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
// posted only once that is on ('agents': /agent connect open). `editable`: edited in place at every start.
const ON = { agents: () => AGENTS.issuance };
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

if (DISCORD) for (const f of FEATURES) f.setup?.();
else { // the board alone, from GitHub
  console.log('discord: off (KIRA_DISCORD=off): board and MCP server only');
  workboard.refresh();
  setInterval(() => workboard.refresh(), WORK.refreshMs);
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
    ...kiraAi.usageRoutes({ limiter }),
    ...(DISCORD ? staff.routes() : {}), // the staff dashboards' API, only through the website's proxy (STAFF_PROXY_KEY)
    ...gameRoutes({ store: gameServers, ask: kiraAi.askInGame, limiter }),
    ...adminRoutes({ hash: process.env.KIRA_ADMIN_TOKEN_SHA256, limiter, save, freeze, gameTokens: gameTokens({ store: gameServers, dm: async (id, text) => (await client.users.fetch(id)).send({ content: text, allowedMentions: { parse: [] } }), endpoint: `${AGENTS.url.replace(/\/mcp$/, '')}/game/ask` }), cleanup: DISCORD && contributors.enabled ? contributors.cleanup : null, files: { state: dataFile('state.json'), agents: process.env.KIRA_AGENTS || dataFile('agents.json') } }),
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
  setInterval(checkReleases, RELEASE_EVERY_MS);
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
process.on('SIGTERM', () => { save(); process.exit(0); });
if (DISCORD) client.login(process.env.DISCORD_TOKEN);
