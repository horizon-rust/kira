// Tokens for Minecraft servers that let Kira answer in their chat (POST /game/ask), from a shell on Kira's host (where
// data/game-servers.json lives). One per server; the name is what #mod-log shows.
//   node scripts/game-token.mjs issue <server name> <owner's discord id> [days]
//   node scripts/game-token.mjs list
//   node scripts/game-token.mjs revoke <token id>
// `issue` prints the token once, on stdout only: pipe it straight where it goes (Kira's DM to the owner).
import { issue, revoke } from '../src/agents.js';
import { openServers } from '../src/features/game.js';
import { GAME } from '../src/game-kit.js';

const store = openServers();
const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'issue' && a.length >= 2) {
  const t = issue(store, { user: a[1], name: a[0], days: Number(a[2] ?? GAME.tokenDays), label: 'game', maxPerUser: 3, maxPerDay: 3 });
  console.error(`token ${t.id} for ${a[0]}, expires ${new Date(t.record.expiresAt).toISOString()}`);
  console.log(t.token);
} else if (cmd === 'list') {
  for (const [id, t] of Object.entries(store.tokens)) console.log(id, t.name, t.user, t.revokedAt ? 'revoked' : 'active', 'expires', new Date(t.expiresAt).toISOString(), 'last used', t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : 'never');
} else if (cmd === 'revoke' && a[0]) {
  revoke(store, a[0], { any: true });
  console.log('revoked', a[0]);
} else {
  console.error('usage: issue <server name> <owner discord id> [days] | list | revoke <token id>');
  process.exit(2);
}
