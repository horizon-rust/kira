// Kira at runtime: wires the feature modules, the commands and the feeds.
import { MessageFlags } from 'discord.js';
import { GUILD_ID, FEED_EVERY_MS } from './config.js';
import { client, state, save, channel } from './core.js';
import { FEEDS, poll } from './feeds.js';
import * as moderation from './features/moderation.js';
import * as levels from './features/levels.js';
import * as rooms from './features/rooms.js';
import * as community from './features/community.js';
import * as forums from './features/forums.js';

const FEATURES = [moderation, levels, rooms, community, forums];
const handlers = Object.assign({}, ...FEATURES.map((f) => f.handlers));
const commands = FEATURES.flatMap((f) => f.commands);

// New YouTube videos → #announcements, new GitHub releases → #releases.
async function checkFeeds() {
  for (const feed of FEEDS) {
    try {
      const fresh = await poll(feed, state.seen);
      save();
      for (const item of fresh) {
        if (feed.kind === 'video') {
          const msg = await channel('announcements').send({ content: `<@&${state.roles.videos}> **New video: ${item.title}**\n${item.url}`, allowedMentions: { roles: [state.roles.videos] } });
          await msg.crosspost().catch(() => {});
        } else {
          await channel('releases').send({ content: `<@&${state.roles.releases}> **${feed.repo}** · ${item.title}\n${item.url}`, allowedMentions: { roles: [state.roles.releases] } });
        }
      }
    } catch (e) {
      console.error('feed', feed.key, e.message);
    }
  }
}

for (const f of FEATURES) f.setup?.();

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  await guild.commands.set(commands.map((c) => c.toJSON()));
  await client.application.commands.set([]); // no global commands: everything is per server
  client.user.setActivity("ludovic's server · /links");
  console.log(`Kira ready as ${client.user.tag}, ${commands.length} commands`);
  await checkFeeds();
  setInterval(checkFeeds, FEED_EVERY_MS);
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
  } catch (e) {
    console.error('message', e);
  }
});

process.on('unhandledRejection', (e) => console.error('unhandled', e));
process.on('SIGTERM', () => { save(); process.exit(0); });
client.login(process.env.DISCORD_TOKEN);
