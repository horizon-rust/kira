// Agent tokens from a shell on the host that runs Kira (where data/agents.json lives): for test tokens and
// for the maintainers' own agents. Members use /agent connect in Discord instead.
//   node scripts/agent-token.mjs issue <discord user id> <name> [read|write|maintain] [days] [label]
//   node scripts/agent-token.mjs list <discord user id>
//   node scripts/agent-token.mjs revoke <token id>
// `issue` prints the token once, on stdout only: pipe it straight where it goes (a vault, an env file).
import { openStore, issue, listFor, revoke } from '../src/agents.js';
import { dataFile } from '../src/store.js';

const store = openStore(process.env.KIRA_AGENTS || dataFile('agents.json'));
const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'issue' && a.length >= 2) {
  const t = issue(store, { user: a[0], name: a[1], scope: a[2] ?? 'read', days: Number(a[3] ?? 90), label: a[4] ?? 'cli' });
  console.error(`token ${t.id} for ${a[1]} (${t.record.scope}), expires ${new Date(t.record.expiresAt).toISOString()}`);
  console.log(t.token);
} else if (cmd === 'list' && a[0]) {
  for (const t of listFor(store, a[0])) console.log(t.id, t.scope, t.status, t.label ?? '', 'expires', new Date(t.expiresAt).toISOString());
} else if (cmd === 'revoke' && a[0]) {
  revoke(store, a[0], { any: true });
  console.log('revoked', a[0]);
} else {
  console.error('usage: issue <user id> <name> [scope] [days] [label] | list <user id> | revoke <token id>');
  process.exit(2);
}
