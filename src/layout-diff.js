// What `npm run setup` may do to a server that already exists. Pure functions on plain data (the REST shape of
// Discord's channels and roles), so it is all testable without Discord.
//
// Setup is ADDITIVE by default: it makes what is missing and never touches what exists. Changing existing channels
// (names, types, topics, bitrates, permissions, order), roles, Onboarding, AutoMod or screening takes
// `--apply-layout`, which first prints this diff and only acts with `--yes` too. Why: on 2026-11-01 a plain
// `npm run setup` applied a stale LAYOUT to the live server (renamed ~13 channels and categories, retyped two
// announcement channels, changed bitrates, replaced the Onboarding prompts, added an overwrite and made a second
// #server-chat). The live server is the truth; LAYOUT follows it.
import { PermissionsBitField } from 'discord.js';
import { handles, channelTopic } from './texts.js';

// REST channel types.
export const TYPE_OF = { text: 0, voice: 2, category: 4, announcement: 5, forum: 15 };
const TEXTISH = new Set([TYPE_OF.text, TYPE_OF.announcement]);
const sameKind = (a, b) => a === b || (TEXTISH.has(a) && TEXTISH.has(b));

export const FLAGS = ['--apply-layout', '--yes'];

// The command line: nothing → additive; --apply-layout → print the diff; --apply-layout --yes → apply it.
// --yes alone is refused (it would silently do nothing).
export function parseArgs(argv) {
  const unknown = argv.filter((a) => !FLAGS.includes(a));
  if (unknown.length) throw new Error(`unknown option ${unknown.join(' ')} (options: ${FLAGS.join(', ')})`);
  const applyLayout = argv.includes('--apply-layout');
  const yes = argv.includes('--yes');
  if (yes && !applyLayout) throw new Error('--yes only goes with --apply-layout');
  return { applyLayout, yes, mode: !applyLayout ? 'additive' : yes ? 'apply' : 'diff' };
}

// The channel a LAYOUT entry stands for: the ID in state (setup's own record), else the ID pinned in LAYOUT
// (`id`), else the only channel of the same kind with one of its names (`handles`: name, name without its
// decoration, `aka`). More than one → throws: somebody cleans up first. None → null (setup would create it).
export function findChannel(spec, channels, state, { type = TYPE_OF[spec.type], skip = () => false } = {}) {
  const all = [...channels];
  const byId = (id) => id && all.find((c) => c.id === id);
  const hit = byId(state.channels?.[spec.key]) ?? byId(spec.id);
  if (hit) return hit;
  const names = handles(spec);
  const found = all.filter((c) => names.includes(c.name) && sameKind(c.type, type) && !skip(c));
  if (found.length > 1) throw new Error(`${found.length} copies of channel #${spec.name} (${found.map((c) => c.id).join(', ')}): delete the extra ones, then run setup again`);
  return found[0] ?? null;
}

// The category of a group: state, else a category with its name (or old name).
export function findCategory(group, channels, state) {
  const all = [...channels].filter((c) => c.type === TYPE_OF.category);
  const hit = all.find((c) => c.id === (state.channels?.['cat:' + group.key] ?? state.channels?.['cat:' + group.was]));
  if (hit) return hit;
  const names = [group.category, ...(group.aka ?? [])];
  const found = all.filter((c) => names.includes(c.name));
  if (found.length > 1) throw new Error(`${found.length} copies of category ${group.category} (${found.map((c) => c.id).join(', ')}): delete the extra ones, then run setup again`);
  return found[0] ?? null;
}

// Permission overwrites as comparable strings: "<type>:<id> allow deny" (flags as numbers), sorted, empties dropped.
const bits = (flags) => (Array.isArray(flags) ? flags.reduce((a, f) => a | BigInt(f), 0n) : BigInt(flags ?? 0));
export function overwriteLines(list) {
  return (list ?? [])
    .map((o) => ({ id: o.id, type: Number(o.type), allow: bits(o.allow), deny: bits(o.deny) }))
    .filter((o) => o.allow || o.deny)
    .map((o) => `${o.type === 0 ? 'role' : 'member'}:${o.id} +${o.allow} -${o.deny}`)
    .sort();
}
const names = (bitfield) => new PermissionsBitField(bitfield).toArray().join(', ') || 'nothing';

// What differs between the server and LAYOUT. Every line is one change setup --apply-layout --yes would make.
//   layout: LAYOUT; live: the guild's channels (REST); state: setup's state; wantedOverwrites(spec, group, kind) →
//   the overwrites it would set (kind 'category' or 'channel'); bitrate: the bitrate it sets on voice channels.
export function layoutDiff({ layout, live, state, wantedOverwrites, bitrate }) {
  const out = [];
  const rooms = state.rooms ?? {};
  const pool = live.filter((c) => !rooms[c.id]);
  const topicState = { channels: { ...state.channels } }; // the IDs a topic's #mentions turn into
  const cats = [];
  for (const group of layout) {
    const cat = findCategory(group, pool, state);
    cats.push(cat);
    if (cat) topicState.channels['cat:' + group.key] = cat.id;
    for (const spec of group.channels) {
      const ch = findChannel(spec, pool, state);
      if (ch) topicState.channels[spec.key] = ch.id;
    }
  }
  layout.forEach((group, gi) => {
    const cat = cats[gi];
    if (!cat) { out.push(`create category ${group.category}`); }
    else {
      if (cat.name !== group.category) out.push(`rename category "${cat.name}" → "${group.category}"`);
      if (wantedOverwrites) {
        const have = overwriteLines(cat.permission_overwrites), want = overwriteLines(wantedOverwrites(null, group, 'category'));
        if (have.join('\n') !== want.join('\n')) out.push(`category ${group.category}: permission overwrites differ (now ${have.length}, wanted ${want.length})`);
      }
    }
    for (const spec of group.channels) {
      const wantedType = TYPE_OF[spec.type];
      const ch = findChannel(spec, pool, state);
      if (!ch) { out.push(`create #${spec.name} in ${group.category}`); continue; }
      const label = `#${ch.name}`;
      if (ch.name !== spec.name) out.push(`rename ${label} → "${spec.name}"`);
      if (ch.type !== wantedType) out.push(`retype ${label}: ${Object.keys(TYPE_OF).find((k) => TYPE_OF[k] === ch.type) ?? ch.type} → ${spec.type}`);
      if (cat && ch.parent_id !== cat.id) out.push(`move ${label} to ${group.category}`);
      if (spec.type === 'voice') {
        const want = spec.bitrate ?? bitrate;
        if (want && ch.bitrate !== want) out.push(`bitrate of ${label}: ${ch.bitrate} → ${want}`);
      } else {
        const want = channelTopic(spec, topicState) ?? '', have = ch.topic ?? '';
        if (have !== want) out.push(`topic of ${label} differs`);
        if ((ch.rate_limit_per_user ?? 0) !== (spec.slowmode ?? 0) && spec.type !== 'forum') out.push(`slowmode of ${label}: ${ch.rate_limit_per_user ?? 0} → ${spec.slowmode ?? 0}`);
      }
      if (wantedOverwrites) {
        const have = overwriteLines(ch.permission_overwrites), want = overwriteLines(wantedOverwrites(spec, group, 'channel'));
        if (have.join('\n') !== want.join('\n')) {
          const only = (a, b) => a.filter((l) => !b.includes(l));
          out.push(`permission overwrites of ${label} differ: +[${only(want, have).join('; ')}] -[${only(have, want).join('; ')}]`);
        }
      }
    }
  });
  // Order: categories, then the channels of each, as LAYOUT lists them (only those LAYOUT knows).
  const rank = (items) => items.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const known = cats.map((c) => c?.id);
  const catOrder = rank(live.filter((c) => known.includes(c.id))).map((c) => c.id);
  const wantCats = known.filter(Boolean);
  if (catOrder.join() !== wantCats.join()) out.push('category order differs');
  layout.forEach((group, gi) => {
    const cat = cats[gi];
    if (!cat) return;
    const ids = group.channels.map((spec) => findChannel(spec, pool, state)?.id).filter(Boolean);
    const here = rank(live.filter((c) => c.parent_id === cat.id && ids.includes(c.id))).map((c) => c.id);
    if (here.join() !== ids.filter((id) => live.find((c) => c.id === id)?.parent_id === cat.id).join()) out.push(`channel order in ${group.category} differs`);
  });
  return out;
}

// Roles: what editing them would change (name, colour, hoist, mentionable, permissions). `live`: the guild's roles (REST).
export function rolesDiff({ roles, live, state }) {
  const out = [];
  for (const spec of roles) {
    const role = live.find((r) => r.id === (state.roles?.[spec.key] ?? state.roles?.[spec.was])) ?? (spec.managed ? null : live.find((r) => r.name === spec.name));
    if (!role) { if (!spec.managed) out.push(`create role ${spec.name}`); continue; }
    if (role.name !== spec.name) out.push(`rename role "${role.name}" → "${spec.name}"`);
    if (role.color !== spec.color) out.push(`colour of role ${role.name}: ${role.color} → ${spec.color}`);
    if (!!role.hoist !== !!spec.hoist) out.push(`hoist of role ${role.name}: ${!!role.hoist} → ${!!spec.hoist}`);
    if (!!role.mentionable !== !!spec.mentionable) out.push(`mentionable of role ${role.name}: ${!!role.mentionable} → ${!!spec.mentionable}`);
    if (!spec.managed) {
      const want = new PermissionsBitField((spec.permissions ?? []).map((p) => PermissionsBitField.Flags[p])).bitfield;
      if (BigInt(role.permissions) !== want) out.push(`permissions of role ${role.name}: ${names(BigInt(role.permissions) & ~want)} removed, ${names(want & ~BigInt(role.permissions))} added`);
    }
  }
  return out;
}
