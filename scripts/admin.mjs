// Kira's files between hosts, through the admin routes (src/admin.js). The token comes from the environment:
//   ~/fleet/op run --env-file <(echo 'KIRA_ADMIN_TOKEN="op://Agents/Kira admin token/credential"') -- \
//     node scripts/admin.mjs backup https://mcp.playhorizon.dev > backup.json
//   … node scripts/admin.mjs restore https://mcp.playhorizon.dev < backup.json   (the host restarts on it)
// A backup file is { state, agents }: state.json and agents.json (token hashes only).
// Game servers' tokens (Kira in a Minecraft server's chat), the token DMed to the owner by Kira, never printed:
//   … node scripts/admin.mjs game-token https://mcp.playhorizon.dev '{"action":"issue","server":"<address>","owner":"<discord id>","deliver":"dm"}'
//   … '{"action":"list"}' · '{"action":"revoke","id":"<id>"}'
import { readFileSync } from 'node:fs';

const [cmd, base, json] = process.argv.slice(2);
const token = process.env.KIRA_ADMIN_TOKEN;
if (!token || !base || !['backup', 'restore', 'game-token'].includes(cmd)) { console.error("usage: KIRA_ADMIN_TOKEN=… node scripts/admin.mjs backup|restore <https://host> | game-token <https://host> '<json>'"); process.exit(2); }
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const res = cmd === 'backup'
  ? await fetch(`${base}/admin/backup`, { headers })
  : cmd === 'restore'
    ? await fetch(`${base}/admin/restore`, { method: 'POST', headers, body: readFileSync(0, 'utf8') })
    : await fetch(`${base}/admin/game-token`, { method: 'POST', headers, body: json ?? '{}' });
const text = await res.text();
if (!res.ok) { console.error(`${cmd}: HTTP ${res.status} ${text.slice(0, 200)}`); process.exit(1); }
console.log(text);
