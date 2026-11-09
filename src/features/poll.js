// Council polls on Discord (GOVERNANCE.md section 4; rules in src/poll-kit.js), only when KIRA_GOVERNANCE is on: off,
// no command is registered, no listener or timer runs and /decisions.json is not served. `/poll start` (council
// members): a 24-hour poll with Yes / No / Abstain buttons, plus "Needs 2/3" and "Recuse", in #polls-and-decisions or,
// for polls about a person, in #council. A ballot can change until the close. Kira DMs those who haven't voted 12 h
// and 2 h before the end, closes the poll (early once everyone eligible voted), posts the result, appends it to the
// decisions log and, when it passed with a role change, applies it herself, citing the decision id. `/poll reopen`
// signs a failed poll's reopening (two members lift the 7-day rule).
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { GUILD_ID, GOVERNANCE } from '../config.js';
import { client, state, save } from '../core.js';
import { dataFile } from '../store.js';
import * as kit from '../poll-kit.js';
import * as gk from '../governance-kit.js';
import { openLog, route } from '../decisions-kit.js';
import * as age from './age.js';

export const log = openLog(process.env.KIRA_DECISIONS || dataFile('decisions.json'));
const polls = () => (state.polls ??= {});
const council = () => gk.registry(state, GOVERNANCE);
const isCouncil = (id) => gk.isCouncil(id, { state, gov: GOVERNANCE });
const roleId = (key) => state.roles?.[key] || GOVERNANCE.roles[key];
const channelOf = (where) => {
  const key = where === 'council' ? 'council' : 'polls';
  return state.channels?.[key] || GOVERNANCE.channels[key];
};
const getChannel = async (id) => client.channels.cache.get(id) ?? await client.channels.fetch(id).catch(() => null);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const VERBS = { yes: 'Yes', no: 'No', abstain: 'Abstain' };

export const commands = GOVERNANCE.on ? [
  new SlashCommandBuilder().setName('poll').setDescription('Council polls (GOVERNANCE.md)')
    .addSubcommand((s) => s.setName('start').setDescription('Council: start a 24-hour poll')
      .addStringOption((o) => o.setName('kind').setDescription('What the poll decides (sets the threshold)').setRequired(true)
        .addChoices(...Object.entries(kit.KINDS).map(([k, v]) => ({ name: `${k}: ${v.label}`.slice(0, 100), value: k }))))
      .addStringOption((o) => o.setName('question').setDescription('The question, in a full sentence').setRequired(true).setMaxLength(1000))
      .addUserOption((o) => o.setName('member').setDescription('The member the poll is about (they do not vote)'))
      .addStringOption((o) => o.setName('role').setDescription('The role a passed poll gives or takes')
        .addChoices(...kit.ROLE_KEYS.map((k) => ({ name: kit.roleName(k), value: k }))))
      .addStringOption((o) => o.setName('action').setDescription('Give or take the role')
        .addChoices({ name: 'give', value: 'add' }, { name: 'take', value: 'remove' })))
    .addSubcommand((s) => s.setName('reopen').setDescription('Council: sign to ask a failed poll again within 7 days (two members)')
      .addStringOption((o) => o.setName('decision').setDescription("The failed poll's decision id, like D12").setRequired(true))),
] : [];

// The poll message: the question, what passing does, the threshold, the end, and how many voted (not who).
export function render(p) {
  const ids = kit.eligible(council(), p);
  const what = kit.outcomeText(p.outcome);
  const voted = Object.keys(p.ballots).filter((id) => ids.includes(id)).length;
  const lines = [
    `🗳️ **Council poll ${p.id}** · ${kit.KINDS[p.kind].label}`,
    `> ${p.question}`,
    ...(what ? [`If it passes, Kira will ${what}.`] : []),
    `Passes with ${kit.thresholdText(p.threshold)}, if at least ${Math.ceil(ids.length / 2)} of ${ids.length} vote. ${p.closedAt ? 'Closed.' : `Ends ${ts(p.endsAt)}.`}`,
    `Voted: ${voted} of ${ids.length}. Started by <@${p.openedBy}>.`,
  ];
  const button = (verb, label, style) => ({ type: 2, style, label, custom_id: `poll:${p.id}:${verb}`, disabled: !!p.closedAt });
  return {
    content: lines.join('\n').slice(0, 2000),
    allowedMentions: { parse: [] },
    components: [{ type: 1, components: [button('yes', 'Yes', 3), button('no', 'No', 4), button('abstain', 'Abstain', 2), button('two-thirds', 'Needs 2/3', 2), button('recuse', 'Recuse', 2)] }],
  };
}

export const handlers = {
  async poll(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!GOVERNANCE.on) return i.editReply(ephemeral('Council polls are not on yet.'));
    if (!isCouncil(i.user.id)) return i.editReply(ephemeral('Only council members start or reopen a poll. Ask one of them.'));
    if (i.options.getSubcommand() === 'reopen') return i.editReply(ephemeral(reopen(i.user.id, i.options.getString('decision'))));
    const now = Date.now();
    const verdict = kit.check({
      kind: i.options.getString('kind'), question: i.options.getString('question'), member: i.options.getUser('member')?.id,
      role: i.options.getString('role'), action: i.options.getString('action'), opener: i.user.id,
    }, { council: council(), log: log.all(), now });
    if (!verdict.ok) return i.editReply(ephemeral(verdict.why));
    const ch = await getChannel(channelOf(verdict.poll.where));
    if (!ch) return i.editReply(ephemeral('The poll channel is missing: tell a maintainer.'));
    state.pollSeq = (state.pollSeq ?? 0) + 1;
    const p = { ...verdict.poll, id: `P${state.pollSeq}`, openedBy: i.user.id, startedAt: now, endsAt: now + kit.POLL.hours * kit.HOUR, ballots: {}, recused: [], reminded: [] };
    polls()[p.id] = p; // taken before the first await, so the id can't be used twice
    save();
    const ping = roleId('council');
    const body = render(p);
    let msg;
    try {
      msg = await ch.send({ ...body, content: `<@&${ping}> ${body.content}`.slice(0, 2000), allowedMentions: { parse: [], roles: [ping] } });
    } catch (e) {
      delete polls()[p.id];
      save();
      console.error('poll', e.message);
      return i.editReply(ephemeral('The poll could not be posted: try again in a minute.'));
    }
    Object.assign(p, { channelId: msg.channelId ?? ch.id, messageId: msg.id });
    save();
    await msg.startThread?.({ name: `${p.id}: discussion` }).catch(() => {});
    return i.editReply(ephemeral(`Poll ${p.id} started in <#${p.channelId}>: it ends ${ts(p.endsAt)}.`));
  },
};

// A council member's signature on reopening a failed poll within its 7 days. → the reply.
export function reopen(by, id, now = Date.now()) {
  const want = String(id ?? '').trim().toUpperCase();
  const d = log.all().find((e) => e.id === want && e.type === 'poll');
  if (!d) return 'No poll with that decision id.';
  if (d.result?.passed) return `${d.id} passed: nothing to reopen.`;
  if (now - d.closedAt >= kit.POLL.repeatDays * 24 * kit.HOUR) return `${d.id} closed more than ${kit.POLL.repeatDays} days ago: it can simply be asked again.`;
  const signed = new Set(log.all().filter((e) => e.type === 'reopen' && e.of === d.id).map((e) => e.by));
  if (signed.has(by)) return `You already signed (${signed.size} of ${kit.POLL.reopenSigners}).`;
  log.append({ type: 'reopen', of: d.id, by }, now);
  const n = signed.size + 1;
  return n >= kit.POLL.reopenSigners ? `Signed: ${d.id} can be asked again now with \`/poll start\`.` : `Signed (${n} of ${kit.POLL.reopenSigners}): one more council member is needed.`;
}

// A button on a poll message.
export async function onButton(i, now = Date.now()) {
  const [, id, verb] = i.customId.split(':');
  const p = polls()[id];
  if (!p) return i.reply(ephemeral('This poll is closed.'));
  if (!isCouncil(i.user.id)) return i.reply(ephemeral('Only council members vote. Anyone may comment in the thread.'));
  let text;
  if (verb === 'two-thirds') {
    p.threshold = 'two-thirds';
    text = 'This poll now needs two thirds (GOVERNANCE.md 4.3: when in doubt, two thirds).';
  } else if (verb === 'recuse') {
    if (i.user.id === p.subject) return i.reply(ephemeral("This poll is about you: you don't vote on it."));
    if (!p.recused.includes(i.user.id)) p.recused.push(i.user.id);
    delete p.ballots[i.user.id];
    text = 'You recused yourself: you are left out of the count. Say why in the thread.';
  } else if (VERBS[verb]) {
    const why = kit.mayVote(i.user.id, council(), p);
    if (why) return i.reply(ephemeral(why));
    p.ballots[i.user.id] = verb;
    text = `Your vote: **${VERBS[verb]}**. You can change it until the poll closes.`;
  } else return i.reply(ephemeral('Unknown button.'));
  save();
  await i.reply(ephemeral(text));
  if (kit.allVoted(p.ballots, kit.eligible(council(), p))) return close(p, now);
  await i.message?.edit?.(render(p)).catch(() => {});
}

// Ends a poll: the decisions log, the role change if it passed, the result under the poll, the buttons locked.
export async function close(p, now = Date.now()) {
  if (!polls()[p.id]) return null; // closed already (a button and the timer at once)
  delete polls()[p.id];
  p.closedAt = now;
  const ids = kit.eligible(council(), p);
  const result = kit.outcome({ ballots: p.ballots, eligible: ids, threshold: p.threshold });
  const ballots = Object.fromEntries(Object.entries(p.ballots).filter(([id]) => ids.includes(id)));
  const d = log.append({ type: 'poll', poll: p.id, kind: p.kind, where: p.where, key: p.key, question: p.question, threshold: p.threshold, openedBy: p.openedBy, startedAt: p.startedAt, closedAt: now, outcome: p.outcome, result, ballots }, now);
  save();
  const applied = result.passed && p.outcome ? await apply(d, p.outcome, now) : '';
  const ch = await getChannel(p.channelId);
  const msg = await ch?.messages.fetch(p.messageId).catch(() => null);
  await msg?.edit(render(p)).catch(() => {});
  const votes = Object.entries(ballots).map(([id, b]) => `<@${id}> ${VERBS[b]}`).join(', ') || 'none';
  const line = `${kit.resultLine(p, result)} Decision **${d.id}**.\nVotes: ${votes}.${applied ? `\n${applied}` : ''}`;
  await ch?.send({ content: line.slice(0, 2000), allowedMentions: { parse: [] }, reply: { messageReference: p.messageId, failIfNotExists: false } }).catch((e) => console.error('poll result', e.message));
  if (p.where === 'council' && applied) { // a person poll: only the role change goes public, never the reasons
    await (await getChannel(channelOf('public')))?.send({ content: `Council decision **${d.id}**: ${applied}`, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return d;
}

// Applies a passed poll's role change on Discord, and on the council registry for 🏛️ Council. → a line for the result.
async function apply(d, o, now) {
  const member = await client.guilds.cache.get(GUILD_ID)?.members.fetch(o.member).catch(() => null);
  let error = member ? null : 'not in the server';
  // No declaration, no role of trust (GOVERNANCE.md 9): the member confirms with /age-declaration, then it is applied.
  if (!error && o.action === 'add' && age.required(o.role) && !age.isDeclared(o.member)) error = 'no 18+ declaration yet: they confirm with `/age-declaration`';
  if (member && !error) {
    try {
      if (o.action === 'add') await member.roles.add(roleId(o.role), `Council decision ${d.id}`);
      else await member.roles.remove(roleId(o.role), `Council decision ${d.id}`);
    } catch (e) { error = String(e.message).slice(0, 200); }
  }
  if (!error && o.role === 'council') {
    const next = gk.change(state, GOVERNANCE, { id: o.member, add: o.action === 'add' });
    if (next.council) {
      state.council = next.council;
      save();
      log.append({ type: 'council', of: d.id, member: o.member, action: o.action }, now);
    } else error = next.why;
  }
  log.append({ type: 'applied', of: d.id, member: o.member, role: o.role, action: o.action, ok: !error, error }, now);
  if (error) return `⚠️ Kira could not ${kit.outcomeText(o)} (${error}): a council member applies it by hand, citing ${d.id}.`;
  const github = o.role === 'team' ? ` On GitHub, an organisation owner ${o.action === 'add' ? 'adds them to' : 'removes them from'} \`horizon-team\`.` : '';
  return `Kira ${o.action === 'add' ? 'gave' : 'took'} ${kit.roleName(o.role)} ${o.action === 'add' ? 'to' : 'from'} <@${o.member}> (${d.id}).${github}`;
}

// Every minute: the polls whose time is up, then the reminders by DM.
export async function tick(now = Date.now()) {
  for (const p of Object.values(polls())) {
    try {
      if (now >= p.endsAt) { await close(p, now); continue; }
      for (const r of kit.remindersDue(p, kit.eligible(council(), p), now)) {
        p.reminded.push(r.mark);
        save();
        const link = `https://discord.com/channels/${GUILD_ID}/${p.channelId}/${p.messageId}`;
        for (const id of r.ids) {
          await client.users.fetch(id).then((u) => u.send({ content: `🗳️ Council poll ${p.id} ends ${ts(p.endsAt)} and you haven't voted yet: ${link}`, allowedMentions: { parse: [] } })).catch(() => {});
        }
      }
    } catch (e) { console.error('poll', p.id, e.message); }
  }
}

// GET /decisions.json, only once governance is on.
export const routes = () => (GOVERNANCE.on ? { '/decisions.json': route({ log }) } : {});

export function setup() {
  if (!GOVERNANCE.on) return;
  client.on('interactionCreate', (i) => {
    if (i.isButton?.() && i.guildId === GUILD_ID && i.customId.startsWith('poll:')) onButton(i).catch((e) => console.error('poll button', e));
  });
  client.once('clientReady', () => { setInterval(() => tick().catch((e) => console.error('poll', e.message)), 60_000).unref?.(); });
}
