// Horizon's work board from a shell, for agents without MCP support (or scripts). Talks to Kira's MCP server
// with a personal token (KIRA_TOKEN; KIRA_MCP_URL defaults to https://mcp.playhorizon.dev/mcp).
//   node scripts/board.mjs list [column]            node scripts/board.mjs get <ref>
//   node scripts/board.mjs add "<title>" [column]   node scripts/board.mjs move <ref> <column>
//   node scripts/board.mjs note <ref> "<text>"      node scripts/board.mjs claim <issue> | unclaim <issue>
//   node scripts/board.mjs ludovic                  node scripts/board.mjs whoami
// Refs: "#40" (issue, else pull request), "pr#56", "card#3". Columns: backlog, todo, progress, review, done.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.KIRA_MCP_URL || 'https://mcp.playhorizon.dev/mcp';
const token = process.env.KIRA_TOKEN;
if (!token) { console.error('KIRA_TOKEN is not set (a token from /agent connect)'); process.exit(2); }
const [cmd, x, y] = process.argv.slice(2);
const calls = {
  list: () => ['board_list', x ? { column: x } : {}],
  get: () => ['task_get', { ref: x }],
  add: () => ['card_add', { title: x, ...(y ? { column: y } : {}) }],
  move: () => ['card_move', { ref: x, column: y }],
  note: () => ['card_note', { ref: x, text: y }],
  claim: () => ['task_claim', { issue: Number(x) }],
  unclaim: () => ['task_unclaim', { issue: Number(x) }],
  ludovic: () => ['ludovic_now', {}],
  whoami: () => ['whoami', {}],
};
if (!calls[cmd]) { console.error(`usage: ${Object.keys(calls).join(' | ')} (see the top of this file)`); process.exit(2); }
const [name, args] = calls[cmd]();
const client = new Client({ name: 'kira-board-cli', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const r = await client.callTool({ name, arguments: args });
console.log(r.content.map((c) => c.text).join('\n'));
await client.close();
process.exit(r.isError ? 1 : 0);
