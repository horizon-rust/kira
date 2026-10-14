// Kira's files between hosts, through the admin routes (src/admin.js). The token comes from the environment:
//   ~/fleet/op run --env-file <(echo 'KIRA_ADMIN_TOKEN="op://Agents/Kira admin token/credential"') -- \
//     node scripts/admin.mjs backup https://mcp.playhorizon.dev > backup.json
//   … node scripts/admin.mjs restore https://mcp.playhorizon.dev < backup.json   (the host restarts on it)
// A backup file is { state, agents }: state.json and agents.json (token hashes only).
import { readFileSync } from 'node:fs';

const [cmd, base] = process.argv.slice(2);
const token = process.env.KIRA_ADMIN_TOKEN;
if (!token || !base || !['backup', 'restore'].includes(cmd)) { console.error('usage: KIRA_ADMIN_TOKEN=… node scripts/admin.mjs backup|restore <https://host>'); process.exit(2); }
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const res = cmd === 'backup'
  ? await fetch(`${base}/admin/backup`, { headers })
  : await fetch(`${base}/admin/restore`, { method: 'POST', headers, body: readFileSync(0, 'utf8') });
const text = await res.text();
if (!res.ok) { console.error(`${cmd}: HTTP ${res.status} ${text.slice(0, 200)}`); process.exit(1); }
console.log(text);
