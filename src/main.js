// The entry point on a host with sealed secrets (Railway): opens them (src/secrets.js) before anything reads
// the environment, then starts Kira. On the ThinkPad, src/bot.js is started directly.
import { dirname } from 'node:path';
import { unseal } from './secrets.js';

unseal(process.env.KIRA_SEAL_DIR || dirname(process.env.KIRA_STATE || 'data/state.json'));
await import('./bot.js');
