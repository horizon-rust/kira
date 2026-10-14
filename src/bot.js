// Kira at runtime: wires the feature modules, the commands, the releases, the one-off posts and the MCP server.
// KIRA_DISCORD=off: no Discord connection at all, only the board (from GitHub) and the MCP server, to test a
// new host. PORT (Railway) or KIRA_HTTP_PORT: where the MCP server listens; none, no server.
import { MessageFlags, MessageType } from 'discord.js';
import { GUILD_ID, RELEASE_EVERY_MS, RELEASE_REPOS, ONE_OFFS, COLOR, WORK, AGENTS } from './config.js';
import { client, state, save, channel } from './core.js';
import { newReleases } from './feeds.js';
import { releaseMessage, remember, announced } from './releases.js';
import { makeGitHub } from './github.js';
import { linkify } from './texts.js';
import * as moderation from './features/moderation.js';
import * as levels from './features/levels.js';
import * as rooms from './features/rooms.js';
import * as community from './features/community.js';
import * as forums from './features/forums.js';
import * as github from './features/github.js';
import * as workboard from './features/workboard.js';
import * as agents from './features/agents.js';
import { startServer } from './mcp.js';
import { adminRoutes } from './admin.js';
import { rateLimiter } from './agents.js';
import { dataFile, freeze } from './store.js';
import { publicKey } from './secrets.js';

const FEATURES = [moderation, levels, rooms, community, forums, github, workboard, agents];
const DISCORD = process.env.KIRA_DISCORD !== 'off';
const handlers = Object.assign({}, ...FEATURES.map((f) => f.handlers));
const commands = FEATURES.flatMap((f) => f.commands);

// New Horizon releases → #releases: published game and launcher releases only, each once (by release id).
const releasesGh = makeGitHub({ token: process.env.GITHUB_TOKEN });
async function checkReleases() {
  state.releases ??= {};
  for (const key of Object.keys(state.seen)) if (key.startsWith('gh:') || key === 'youtube') delete state.seen[key]; // the old feeds
  for (const repo of RELEASE_REPOS) {
    try {
      for (const release of await newReleases(releasesGh, repo, state.releases[repo])) {
        if (!announced(repo, release)) { // another kind of tag (a test, a tool): remembered, never posted
          state.releases[repo] = remember(state.releases[repo], release.id);
          save();
          continue;
        }
        const msg = await channel('releases').send(releaseMessage(repo, release, state.roles.releases));
        state.releases[repo] = remember(state.releases[repo], release.id);
        save();
        console.log(`release posted: ${repo} ${release.tag_name} (${release.id}) → message ${msg.id}`);
      }
    } catch (e) {
      console.error('releases', repo, e.message);
    }
  }
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
  const routes = {
    ...(publicKey ? { '/seal-key': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(publicKey); } } : {}),
    ...adminRoutes({ hash: process.env.KIRA_ADMIN_TOKEN_SHA256, limiter, save, freeze, files: { state: dataFile('state.json'), agents: process.env.KIRA_AGENTS || dataFile('agents.json') } }),
  };
  startServer(Number(port), { store: agents.store, api: agents.api, routes, limiter }).then(() => console.log(`mcp server on :${port}${routes['GET /admin/backup'] ? ', admin routes on' : ''}`));
}

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  await guild.commands.set(commands.map((c) => c.toJSON()));
  await client.application.commands.set([]); // no global commands: everything is per server
  client.user.setActivity('Horizon · playhorizon.dev');
  console.log(`Kira ready as ${client.user.tag}, ${commands.length} commands`);
  await checkReleases();
  setInterval(checkReleases, RELEASE_EVERY_MS);
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
