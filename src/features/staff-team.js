// The Team dashboard's routes (/staff/team): the work board (read-only here: moves stay /move and the MCP tools), the
// Team kanban, the decisions log and the roadmap with its Team layer. Loaded by src/features/staff.js. What it reads:
// staff.json, Kira's board snapshot (public GitHub data), the website's roadmap.json, and the Team role's members.
import { GUILD_ID, OWNER_ID } from '../config.js';
import { client, state } from '../core.js';
import * as team from '../team-data.js';
import * as workboard from './workboard.js';
import { roadmap } from './hub.js';

const TEAM_ROLE = '1564768999655481485';

// The Team's members, for owners and names: { id: username }. Ludovic is always there.
function people() {
  const guild = client.guilds.cache.get(GUILD_ID);
  const role = guild?.roles.cache.get(state.roles.team || TEAM_ROLE);
  const out = {};
  for (const m of role?.members.values() ?? []) out[m.id] = m.user.username;
  out[OWNER_ID] ??= client.users.cache.get(OWNER_ID)?.username ?? 'ludovic';
  return out;
}

const boardView = () => {
  const s = workboard.current();
  if (!s) return null;
  return { generatedAt: s.generatedAt, columns: s.columns.map((c) => ({ key: c.key, name: c.name, cards: c.cards.map((k) => ({ id: k.id, kind: k.kind, number: k.number, title: k.title, url: k.url, labels: k.labels, people: k.people, claim: k.claim ? { name: k.claim.name } : null, prs: k.prs, moved: !!k.moved })) })) };
};

// deps (the dev server's fakes): people() → { id: name }, board() → the board view, roadmap() → the public roadmap.
export function teamRoutes({ store, log, deps = {} }) {
  const peopleOf = deps.people ?? people;
  const boardOf = deps.board ?? boardView;
  const roadmapOf = deps.roadmap ?? roadmap;
  const publicIds = async () => new Set(((await roadmapOf())?.items ?? []).map((i) => i.id));
  return [
    { method: 'GET', path: 'team/overview', role: 'team', handler: async (ctx) => ({
      body: { people: peopleOf(), board: boardOf(), cards: team.cards(store, ctx.now), decisions: team.decisions(store), roadmap: team.roadmapView(store, await roadmapOf(), ctx.now) },
    }) },
    { method: 'POST', path: 'team/decisions', role: 'team', handler: (ctx) => {
      const b = ctx.body;
      const d = b.id ? team.editDecision(store, { ...b, by: ctx.user, withdraw: !!b.withdraw }, ctx.now) : team.addDecision(store, { ...b, by: ctx.user }, ctx.now);
      if (!b.id) log(`📌 Team decision recorded by <@${ctx.user}>: ${d.title.slice(0, 120)}`);
      return { body: { decision: d } };
    } },
    { method: 'POST', path: 'team/cards', role: 'team', handler: (ctx) => {
      const b = ctx.body;
      if (b.action === 'delete') { team.deleteCard(store, b); return { body: { ok: true } }; }
      const card = b.action === 'move' ? team.moveCard(store, { ...b, by: ctx.user }, ctx.now) : team.saveCard(store, { ...b, by: ctx.user }, ctx.now);
      return { body: { card } };
    } },
    { method: 'POST', path: 'team/roadmap', role: 'team', handler: async (ctx) => {
      const b = ctx.body;
      const ids = await publicIds();
      if (b.action === 'delete') { team.deleteItem(store, b); return { body: { ok: true } }; }
      if (b.action === 'note') return { body: { note: team.saveNote(store, { ...b, by: ctx.user }, { publicIds: ids }, ctx.now) } };
      if (b.action === 'publish') {
        const out = team.publishSnippet(store, { id: b.id, by: ctx.user }, ctx.now);
        log(`📤 <@${ctx.user}> asked to publish the Team roadmap item "${b.id}" (a pull request to roadmap.toml).`);
        return { body: out };
      }
      return { body: { item: team.saveItem(store, { ...b, by: ctx.user }, { publicIds: ids }, ctx.now) } };
    } },
  ];
}
