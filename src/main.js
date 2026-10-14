// The entry point on a host with sealed secrets (Railway): opens them (src/secrets.js) before anything reads
// the environment, then starts Kira. On the ThinkPad, src/bot.js is started directly.
import { dirname } from 'node:path';
import { unseal } from './secrets.js';

if (process.getuid?.() === 0) console.warn('running as root: use docker-entrypoint.sh');
else console.log(`running as uid ${process.getuid?.()}`);
unseal(process.env.KIRA_SEAL_DIR || dirname(process.env.KIRA_STATE || 'data/state.json'));
await import('./bot.js');
