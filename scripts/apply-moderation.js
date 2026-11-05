// Applies the moderation part of `npm run setup` alone: the AutoMod rules (src/automod.js, found again by name) and,
// on LAYOUT's channels that have a `slowmode`, that slowmode and their topic. Nothing else: for when only those changed
// in config.js and a full setup isn't wanted. Channels and roles are found by name, so it needs no state.json.
//   DISCORD_TOKEN=… node scripts/apply-moderation.js --dry-run     (what would change)
//   DISCORD_TOKEN=… node scripts/apply-moderation.js               (does it)
// Safe to run again. Prints names and counts, never the token.
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { GUILD_ID, LAYOUT, ROLES } from '../src/config.js';
import { applyAutomod, automodRules } from '../src/automod.js';
import { linkify } from '../src/texts.js';

const dryRun = process.argv.includes('--dry-run');
if (!process.env.DISCORD_TOKEN || process.argv.slice(2).some((a) => a !== '--dry-run')) {
  console.error('usage: DISCORD_TOKEN=… node scripts/apply-moderation.js [--dry-run]');
  process.exit(2);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channels = await guild.channels.fetch();
    const roles = await guild.roles.fetch();
    const specs = LAYOUT.flatMap((g) => g.channels).filter((c) => c.type !== 'voice');
    const byName = (spec) => {
      const found = channels.filter((c) => c?.name === spec.name && c.type !== ChannelType.GuildCategory);
      if (found.size > 1) throw new Error(`two channels named #${spec.name}`);
      return found.first();
    };
    const state = { channels: {} };
    for (const spec of specs) { const ch = byName(spec); if (ch) state.channels[spec.key] = ch.id; }
    const role = (key) => roles.find((r) => r.name === ROLES.find((x) => x.key === key).name)?.id;
    const ids = { modlog: state.channels.modlog, mod: role('mod'), team: role('team') };
    if (Object.values(ids).some((v) => !v)) throw new Error(`missing: ${Object.keys(ids).filter((k) => !ids[k]).join(', ')}`);

    for (const spec of specs.filter((c) => c.slowmode !== undefined)) {
      const ch = channels.get(state.channels[spec.key]);
      if (!ch) { console.log(`no #${spec.name}`); continue; }
      const topic = linkify(spec.topic, state);
      const change = { ...(ch.rateLimitPerUser !== spec.slowmode ? { rateLimitPerUser: spec.slowmode } : {}), ...(ch.topic !== topic ? { topic } : {}) };
      console.log(`#${spec.name}: slowmode ${ch.rateLimitPerUser} → ${spec.slowmode} s${change.topic ? ', topic updated' : ''}${Object.keys(change).length ? '' : ' (nothing to change)'}`);
      if (!dryRun && Object.keys(change).length) await ch.edit({ ...change, reason: 'Kira: moderation (config.js)' });
    }
    const existing = await guild.autoModerationRules.fetch();
    for (const r of automodRules(ids)) console.log(`automod: ${r.name} ${existing.some((e) => e.name === r.name) ? '(update)' : '(new)'}`);
    if (!dryRun) await applyAutomod(guild, ids);
    console.log(dryRun ? 'dry run: nothing changed' : 'done');
  } catch (e) {
    console.error(e.rawError ? JSON.stringify(e.rawError.errors ?? e.rawError) : e.message);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});
client.login(process.env.DISCORD_TOKEN);
