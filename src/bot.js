// Kira at runtime: wires the feature modules, the commands, the releases and the one-off posts.
import { MessageFlags } from 'discord.js';
import { GUILD_ID, RELEASE_EVERY_MS, RELEASE_REPOS, ONE_OFFS, COLOR } from './config.js';
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

const FEATURES = [moderation, levels, rooms, community, forums, github, workboard];
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

// Hand-written announcements (ONE_OFFS in config.js), each posted once.
async function postOneOffs() {
  state.oneOffs ??= {};
  for (const post of ONE_OFFS) {
    if (state.oneOffs[post.key]) continue;
    const role = post.role && state.roles[post.role];
    try {
      const msg = await channel(post.channel).send({ content: role ? `<@&${role}> ${post.content}` : post.content, embeds: [{ color: COLOR, ...post.embed, description: post.embed.description && linkify(post.embed.description, state) }], allowedMentions: { parse: [], roles: role ? [role] : [] } });
      state.oneOffs[post.key] = msg.id;
      save();
      console.log(`one-off posted: ${post.key} → message ${msg.id}`);
      await msg.crosspost().catch(() => {});
    } catch (e) {
      console.error('one-off', post.key, e.message);
    }
  }
}

for (const f of FEATURES) f.setup?.();

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
client.login(process.env.DISCORD_TOKEN);
