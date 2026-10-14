// Horizon's mark on Discord: the server icon and Kira's avatar follow the PNGs in assets/.
// Kira applies them when it starts and a file changed (state.brand keeps their hashes), so a
// new mark ships by replacing the files. They are renders from the horizon repo,
// docs/media/brand/social (discord-icon-512.png and kira-avatar-512.png).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SERVER } from './config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function applyBrand(client, guild, state, save) {
  state.brand ??= {};
  const icon = read(SERVER.icon);
  if (state.brand.icon !== digest(icon)) {
    await guild.setIcon(icon);
    state.brand.icon = digest(icon);
    save();
    console.log('brand: server icon set');
  }
  // Discord allows a couple of avatar changes an hour: only when the file changed.
  const avatar = read(SERVER.avatar);
  if (state.brand.avatar !== digest(avatar)) {
    await client.user.setAvatar(avatar);
    state.brand.avatar = digest(avatar);
    save();
    console.log('brand: avatar set');
  }
}
