// 💚 Sponsor for GitHub sponsors (SPONSORS in config.js; the rules in src/sponsor-kit.js). /sponsor github:<login>:
// GitHub must report the sponsorship, then the member proves the account (a code in its bio or a gist, the Verify
// button) and gets the role. A daily recheck takes back only the roles Kira gave. /sponsor-grant: the mods, by hand
// (private sponsorships, which GitHub doesn't show to Kira). Each grant and removal is logged in #mod-log.
import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { rateLimiter } from '../agents.js';
import { GITHUB, GUILD_ID, ROLES, SPONSORS } from '../config.js';
import { client, state, save, modlog } from '../core.js';
import { makeGitHub } from '../github.js';
import { codeIsPublished } from '../contributor-kit.js';
import * as kit from '../sponsor-kit.js';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
export const enabled = !!TOKEN;
let gh = makeGitHub({ token: TOKEN });
const limiter = rateLimiter({ sponsor: [SPONSORS.perHour, 3_600_000] });
const sp = (state.sponsors ??= {});
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERIFY = 'sponsor:verify';

const guild = () => client.guilds.cache.get(GUILD_ID);
const roleName = ROLES.find((r) => r.key === SPONSORS.role).name;
const roleId = () => state.roles[SPONSORS.role] ?? guild()?.roles.cache.find((r) => r.name === roleName)?.id;
const sponsor = (login) => kit.isSponsor(gh, GITHUB.maintainer, login);
const PRIVATE = 'Sponsored privately? DM Kira: the mods check it and give you the role.';

// Takes the role back if Kira gave it; a link made by hand or a role held before only loses the link.
async function unlink(id, why) {
  const l = sp.links?.[id];
  if (!l) return;
  delete sp.links[id];
  save();
  const member = await guild()?.members.fetch(id).catch(() => null);
  if (l.by === 'kira' && member && roleId()) await member.roles.remove(roleId(), `Kira: ${why}`).catch((e) => console.error('sponsor role', e.message));
  await modlog('💚 Sponsor removed', `<@${id}> (GitHub **${l.login ?? '?'}**): ${why}${l.by === 'kira' ? ', role taken back' : ', link only (role not given by Kira)'}`, 0xffb020);
}

export const commands = [
  ...(enabled ? [
    new SlashCommandBuilder().setName('sponsor').setDescription('Sponsor Horizon on GitHub? Get the 💚 Sponsor role')
      .addStringOption((o) => o.setName('github').setDescription('Your GitHub username').setRequired(true).setMaxLength(39)),
  ] : []),
  new SlashCommandBuilder().setName('sponsor-grant').setDescription('Give (or take back) 💚 Sponsor by hand: private sponsorships')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('github').setDescription('Their GitHub username, if known').setMaxLength(39))
    .addBooleanOption((o) => o.setName('remove').setDescription('Take the role back instead')),
];

export const handlers = {
  async sponsor(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const login = i.options.getString('github').trim().replace(/^@/, '');
    if (!kit.LOGIN.test(login)) return i.editReply(ephemeral('That is not a GitHub username.'));
    const mine = sp.links?.[i.user.id];
    if (mine && mine.login?.toLowerCase() === login.toLowerCase() && i.member.roles.cache.has(roleId())) return i.editReply(ephemeral('💚 You already have the Sponsor role for this account. Thank you!'));
    if (!limiter.take(i.user.id, 'sponsor')) return i.editReply(ephemeral('That is a lot of tries: wait a little, then run it again.'));
    try {
      if (!(await sponsor(login))) return i.editReply(ephemeral(`GitHub doesn't show **${login}** as a sponsor of Horizon (github.com/sponsors/${GITHUB.maintainer}). ${PRIVATE}`));
    } catch (e) {
      console.error('sponsor', e.message);
      return i.editReply(ephemeral('GitHub is not answering right now: try again in a few minutes.'));
    }
    const challenge = kit.startChallenge(sp, i.user.id, login, Date.now(), SPONSORS.codeTtlMs);
    save();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(VERIFY).setStyle(ButtonStyle.Success).setLabel('Verify'));
    return i.editReply(ephemeral(kit.codeText(login, challenge), { components: [row] }));
  },

  async 'sponsor-grant'(i) {
    const user = i.options.getUser('user');
    const login = i.options.getString('github')?.trim().replace(/^@/, '') || null;
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member) return i.reply(ephemeral("They're not in the server."));
    if (!roleId()) return i.reply(ephemeral(`No ${roleName} role yet (run setup).`));
    if (i.options.getBoolean('remove')) {
      if (member.roles.cache.has(roleId())) await member.roles.remove(roleId(), `by ${i.user.tag}`);
      delete sp.links?.[user.id];
      save();
      await modlog('💚 Sponsor removed', `<@${user.id}> by <@${i.user.id}>`, 0xffb020);
      return i.reply(ephemeral(`Took ${roleName} from <@${user.id}>.`));
    }
    if (login && !kit.LOGIN.test(login)) return i.reply(ephemeral('That is not a GitHub username.'));
    if (!member.roles.cache.has(roleId())) await member.roles.add(roleId(), `by ${i.user.tag}`);
    kit.link(sp, user.id, login, 'hand', Date.now());
    save();
    await modlog('💚 Sponsor given by hand', `<@${user.id}>${login ? ` (GitHub **${login}**)` : ''} by <@${i.user.id}>. Kira never takes it back by itself.`, 0x2ecc40);
    return i.reply(ephemeral(`Gave ${roleName} to <@${user.id}>.`));
  },
};

async function onVerify(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (!limiter.take(i.user.id, 'sponsor')) return i.editReply(ephemeral('That is a lot of tries: wait a little, then press Verify again.'));
  let out;
  try {
    out = await kit.verify({ sp, id: i.user.id, now: Date.now(), published: (login, code) => codeIsPublished(gh, login, code), sponsor });
  } catch (e) {
    console.error('sponsor verify', e.message);
    return i.editReply(ephemeral('GitHub is not answering right now: press Verify again in a few minutes.'));
  }
  save();
  if (out.result === 'nocode') return i.editReply(ephemeral('You have no code yet: run `/sponsor github:<your username>` first.'));
  if (out.result === 'expired') return i.editReply(ephemeral('That code expired: run `/sponsor` again for a new one.'));
  if (out.result === 'unpublished') return i.editReply(ephemeral(`I don't see \`${out.code}\` in the bio of **${out.login}** or in a public gist with a file named \`${kit.GIST_FILE}\`. Save it on GitHub, wait a few seconds, and press Verify again.`));
  if (out.result === 'notsponsor') return i.editReply(ephemeral(`GitHub no longer shows **${out.login}** as a sponsor. ${PRIVATE}`));
  for (const other of out.takenFrom) await unlink(other, `GitHub **${out.login}** was proved by <@${i.user.id}>`);
  const role = roleId();
  const member = await i.guild.members.fetch(i.user.id);
  const had = member.roles.cache.has(role);
  if (!had) await member.roles.add(role, `Kira: GitHub sponsor ${out.login}, verified`);
  kit.link(sp, i.user.id, out.login, had ? 'had' : 'kira', Date.now());
  save();
  await modlog('💚 Sponsor verified', `<@${i.user.id}> is GitHub **${out.login}**, a sponsor: ${had ? 'already had the role' : 'role given'}.`, 0x2ecc40);
  return i.editReply(ephemeral(`💚 Thank you! You have the **${roleName}** role${had ? ' (you already had it)' : ''}. You can remove the code from GitHub.`));
}

// Once a day: the roles Kira gave go when GitHub stops reporting the sponsorship; members who left lose their link.
export async function dailyRecheck() {
  sp.checkedAt = Date.now();
  save();
  for (const id of Object.keys(sp.links ?? {})) {
    if (!(await guild()?.members.fetch(id).catch(() => null))) { delete sp.links[id]; save(); }
  }
  const out = await kit.recheck({ sp, sponsor, sleep: () => sleep(SPONSORS.paceMs) });
  for (const id of out.lapsed) {
    await unlink(id, 'GitHub no longer reports the sponsorship');
    const user = await client.users.fetch(id).catch(() => null);
    await user?.send(`💚 GitHub no longer shows your sponsorship of Horizon, so the ${roleName} role was removed. Thank you for your support! Sponsor again any time and run \`/sponsor\`.`).catch(() => {});
  }
  console.log(`sponsors: ${out.checked} checked, ${out.lapsed.length} lapsed, ${out.errors} GitHub errors`);
  return out;
}

export function setup() {
  if (!enabled) console.log('sponsors: /sponsor off (GITHUB_TOKEN is not set); /sponsor-grant on');
  client.on('interactionCreate', (i) => {
    if (i.isButton() && i.guildId === GUILD_ID && i.customId === VERIFY) onVerify(i).catch((e) => console.error('sponsor verify', e));
  });
  if (!enabled) return;
  client.once('clientReady', () => {
    const check = () => { if (Date.now() - (sp.checkedAt ?? 0) >= SPONSORS.recheckEveryMs) dailyRecheck().catch((e) => console.error('sponsors recheck', e.message)); };
    setTimeout(check, 10 * 60_000).unref?.();
    setInterval(check, 60 * 60_000).unref?.();
  });
}

export const _test = { sp, setGitHub: (g) => { gh = g; } };
