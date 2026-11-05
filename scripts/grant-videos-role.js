// One-off: gives the 🎬 Videos role to everyone already on the server (bots skipped), so the video posts reach
// them; from now on the role is opt-in (Onboarding, the buttons in #welcome). Run it by hand, after setup made
// the role and Kira is deployed:
//   ~/fleet/op run --env-file .env.op -- node scripts/grant-videos-role.js --dry-run     (counts only)
//   ~/fleet/op run --env-file .env.op -- node scripts/grant-videos-role.js               (does it)
// Options: --role <id> (otherwise the role named like ROLES' `newvideos` is looked up). Safe to run again:
// members who have the role are skipped. Needs DISCORD_TOKEN; prints counts, never names, ids or the token.
import { GUILD_ID, ROLES } from '../src/config.js';
import { discordApi, findRole, grantRole } from '../src/grant.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const roleArg = args.includes('--role') ? args[args.indexOf('--role') + 1] : null;
const unknown = args.filter((a, i) => !['--dry-run', '--role'].includes(a) && args[i - 1] !== '--role');
const token = process.env.DISCORD_TOKEN;
if (!token || unknown.length || (args.includes('--role') && !/^\d{17,20}$/.test(roleArg ?? ''))) {
  console.error('usage: DISCORD_TOKEN=… node scripts/grant-videos-role.js [--dry-run] [--role <id>]');
  process.exit(2);
}

const api = discordApi(token);
try {
  const roleId = roleArg ?? await findRole(api, GUILD_ID, ROLES.find((r) => r.key === 'newvideos').name);
  const c = await grantRole({ api, guildId: GUILD_ID, roleId, dryRun });
  console.log(dryRun
    ? `dry run: ${c.members} members, ${c.bots} bots skipped, ${c.had} already have the role, ${c.wouldGrant} would get it`
    : `done: ${c.members} members, ${c.bots} bots skipped, ${c.had} already had the role, ${c.granted} granted, ${c.gone} left meanwhile, ${c.failed} failed`);
  if (c.failed) process.exit(1);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
