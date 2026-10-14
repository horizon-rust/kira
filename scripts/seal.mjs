// Seals a secret read on stdin for one Kira host: prints a base64 blob for a FOO_SEALED variable.
//   ~/fleet/op read "op://Agents/<item>/credential" | node scripts/seal.mjs https://mcp.playhorizon.dev/seal-key
// The argument is the host's /seal-key URL or a PEM file. The secret is never printed.
import { readFileSync } from 'node:fs';
import { seal } from '../src/secrets.js';

const where = process.argv[2];
if (!where) { console.error('usage: … | node scripts/seal.mjs <seal-key URL or PEM file>'); process.exit(2); }
const pem = /^https?:/.test(where) ? await (await fetch(where)).text() : readFileSync(where, 'utf8');
if (!pem.includes('BEGIN PUBLIC KEY')) { console.error('not a public key:', where); process.exit(1); }
const secret = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (!secret) { console.error('nothing on stdin'); process.exit(1); }
console.log(seal(pem, secret));
