// /gh: triage of Horizon's issues and pull requests by Ludovic's trusted reviewers, through Kira's GitHub token
// (GitHub has no Triage role on a personal account, and write access would run branch workflows with the repo's
// secrets). Label, close, reopen, mark a duplicate; never merge, never a release label, never Ludovic's own pull
// requests. Every action is a comment "🤖 Kira, on behalf of @login: …" on GitHub and a line in #mod-log; 60 a day
// per reviewer. A reviewer is on TRIAGE.reviewers (config.js) and has a verified link to that login.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { TRIAGE, GITHUB, WORK, OWNER_ID } from '../config.js';
import { state, save, isStaff, modlog } from '../core.js';
import { makeGitHub } from '../github.js';
import { githubToken } from '../github-app.js';
import * as kit from '../triage-kit.js';
import * as contributors from '../contributor-kit.js';

const TOKEN = githubToken();
export const enabled = !!TOKEN;
let gh = makeGitHub({ token: TOKEN, dryRun: process.env.KIRA_GITHUB_DRY_RUN === '1' });
const REPO = `/repos/${GITHUB.owner}/${WORK.repo}`;
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
// paused: { by, at } while /gh pause is on; log: reviewer login (lowercase) → timestamps of the last actions.
const triage = (state.triage ??= { paused: null, log: {} });
triage.log ??= {};

// Who is asking: their GitHub login if they may triage, else why not (a text for them).
function reviewer(user, work = state.work ?? {}) {
  if (triage.paused) return { refusal: `Triage through Kira is paused by the mods. ${triage.paused.reason ? `(${triage.paused.reason})` : ''}`.trim() };
  const login = contributors.loginOf(work, user.id, WORK.github);
  if (!login) return { refusal: 'Link your GitHub account first (`/link-github`), then `/verify-github`.' };
  if (!contributors.isVerified(work, user.id, WORK.github)) return { refusal: 'Verify your GitHub account first: `/verify-github`.' };
  if (!kit.isReviewer(login, TRIAGE.reviewers)) return { refusal: 'Triage through Kira is for Ludovic\'s trusted reviewers; **' + login + '** is not on the list.' };
  return { login };
}

// Runs one action on issue/PR `n`: checks, one write, the comment, the staff log. Returns the text for the reviewer.
// `write(issue)` does the change and returns what to say on GitHub; it throws a text (Error.expose) to refuse.
async function act(i, action, n, { write, summary, check = () => null }) {
  const who = reviewer(i.user);
  if (who.refusal) return who.refusal;
  const issue = await gh.get(`${REPO}/issues/${n}`);
  const refusal = kit.targetRefusal(issue, action, TRIAGE) ?? check(issue);
  if (refusal) return refusal;
  const now = Date.now();
  if (!kit.take(triage.log, who.login, now, TRIAGE.perDay)) return `You used your ${TRIAGE.perDay} actions of the last 24 hours. Try again later.`;
  save();
  let said;
  try {
    said = await write(issue);
  } catch (e) {
    kit.refund(triage.log, who.login, now);
    save();
    if (e.expose) return e.message;
    console.error('gh triage', action, n, e.message);
    return 'GitHub refused that (Kira\'s token may lack the permission). Nothing was changed.';
  }
  await gh.write('POST', `${REPO}/issues/${n}/comments`, { body: kit.comment(who.login, said) }).catch((e) => console.error('gh triage comment', n, e.message));
  await modlog('GitHub triage', `<@${i.user.id}> (**${who.login}**): ${summary}`, 0x5865f2, [{ name: 'Item', value: issue.html_url }]);
  return `✅ ${summary}. Kira commented on GitHub on your behalf.`;
}

const refuse = (message) => Object.assign(new Error(message), { expose: true });
const canonicalLabel = async (name) => {
  const found = await gh.get(`${REPO}/labels/${encodeURIComponent(name)}`);
  if (!found) throw refuse(`There is no label \`${name}\` in Horizon: Kira doesn't make new ones.`);
  return found.name;
};

const handlers_ = {
  async label(i) {
    const n = i.options.getInteger('number');
    const add = i.options.getString('action') === 'add';
    const typed = i.options.getString('label').trim().slice(0, 100);
    const blocked = kit.labelRefusal(typed, TRIAGE);
    if (blocked) return blocked;
    return act(i, 'label', n, {
      summary: `${add ? 'added' : 'removed'} label \`${typed}\` ${add ? 'to' : 'from'} #${n}`,
      check: (issue) => {
        const has = issue.labels.some((l) => String(l.name ?? l).toLowerCase() === typed.toLowerCase());
        if (add && has) return `#${n} already has \`${typed}\`.`;
        if (!add && !has) return `#${n} doesn't have \`${typed}\`.`;
        return null;
      },
      write: async () => {
        if (add) {
          const name = await canonicalLabel(typed);
          const again = kit.labelRefusal(name, TRIAGE); // the label's real name, as GitHub writes it
          if (again) throw refuse(again);
          await gh.write('POST', `${REPO}/issues/${n}/labels`, { labels: [name] });
          return `added the label \`${name}\`.`;
        }
        await gh.write('DELETE', `${REPO}/issues/${n}/labels/${encodeURIComponent(typed)}`);
        return `removed the label \`${typed}\`.`;
      },
    });
  },
  async close(i) {
    const n = i.options.getInteger('number');
    const reason = i.options.getString('reason') ?? 'completed';
    const text = i.options.getString('note');
    return act(i, 'close', n, {
      summary: `closed #${n} (${reason.replace('_', ' ')})`,
      write: async (issue) => {
        await gh.write('PATCH', `${REPO}/issues/${n}`, issue.pull_request ? { state: 'closed' } : { state: 'closed', state_reason: reason });
        return `closed this as ${reason.replace('_', ' ')}.${kit.note(text)}`;
      },
    });
  },
  async reopen(i) {
    const n = i.options.getInteger('number');
    return act(i, 'reopen', n, {
      summary: `reopened #${n}`,
      write: async () => {
        await gh.write('PATCH', `${REPO}/issues/${n}`, { state: 'open' });
        return 'reopened this.';
      },
    });
  },
  async duplicate(i) {
    const n = i.options.getInteger('number');
    const of = i.options.getInteger('of');
    if (n === of) return 'An item cannot be a duplicate of itself.';
    const who = reviewer(i.user);
    if (who.refusal) return who.refusal;
    const original = await gh.get(`${REPO}/issues/${of}`);
    if (!original) return `There is no #${of} in Horizon.`;
    return act(i, 'duplicate', n, {
      summary: `closed #${n} as a duplicate of #${of}`,
      write: async (issue) => {
        const label = await gh.get(`${REPO}/labels/duplicate`);
        if (label && !issue.labels.some((l) => String(l.name ?? l).toLowerCase() === 'duplicate')) await gh.write('POST', `${REPO}/issues/${n}/labels`, { labels: [label.name] });
        await gh.write('PATCH', `${REPO}/issues/${n}`, issue.pull_request ? { state: 'closed' } : { state: 'closed', state_reason: 'not_planned' });
        return `closed this as a duplicate of #${of}.`;
      },
    });
  },
  async pause(i) {
    if (i.user.id !== OWNER_ID && !isStaff(i.member)) return 'Only Ludovic and the mods pause triage.';
    triage.paused = { by: i.user.id, at: Date.now(), reason: (i.options.getString('reason') ?? '').slice(0, 100) };
    save();
    await modlog('GitHub triage paused', `<@${i.user.id}> paused \`/gh\` for everyone.`, 0xe67e22);
    return '⏸️ Triage through Kira is paused for everyone. `/gh resume` turns it back on.';
  },
  async resume(i) {
    if (i.user.id !== OWNER_ID && !isStaff(i.member)) return 'Only Ludovic and the mods resume triage.';
    triage.paused = null;
    save();
    await modlog('GitHub triage resumed', `<@${i.user.id}> resumed \`/gh\`.`, 0x2ecc71);
    return '▶️ Triage through Kira is on again.';
  },
};

export const commands = enabled ? [
  new SlashCommandBuilder().setName('gh').setDescription("Triage Horizon's issues and pull requests (Ludovic's trusted reviewers)")
    .addSubcommand((s) => s.setName('label').setDescription('Add or remove a label')
      .addIntegerOption((o) => o.setName('number').setDescription('Issue or pull request number').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('action').setDescription('add or remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .addStringOption((o) => o.setName('label').setDescription('The label (it must exist)').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('close').setDescription('Close an issue or pull request')
      .addIntegerOption((o) => o.setName('number').setDescription('Issue or pull request number').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('reason').setDescription('Why (default: completed)').addChoices({ name: 'completed', value: 'completed' }, { name: 'not planned', value: 'not_planned' }))
      .addStringOption((o) => o.setName('note').setDescription('A short note for the comment').setMaxLength(300)))
    .addSubcommand((s) => s.setName('reopen').setDescription('Reopen an issue or pull request')
      .addIntegerOption((o) => o.setName('number').setDescription('Issue or pull request number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('duplicate').setDescription('Close as a duplicate of another')
      .addIntegerOption((o) => o.setName('number').setDescription('The duplicate').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('of').setDescription('The original').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('pause').setDescription('Mods: stop /gh for everyone')
      .addStringOption((o) => o.setName('reason').setDescription('Shown to reviewers').setMaxLength(100)))
    .addSubcommand((s) => s.setName('resume').setDescription('Mods: turn /gh back on')),
] : [];

export const handlers = {
  async gh(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const run = handlers_[i.options.getSubcommand()];
    if (!run) return i.editReply(ephemeral('Unknown command.'));
    try {
      return await i.editReply(ephemeral(await run(i)));
    } catch (e) {
      console.error('gh', e.message);
      return i.editReply(ephemeral('GitHub is not answering right now: try again in a few minutes.'));
    }
  },
};

export const _test = { triage, setGitHub: (g) => { gh = g; } };
