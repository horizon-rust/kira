// The rules of /gh (triage by Ludovic's trusted reviewers, through Kira's GitHub token), with no Discord and no
// network: who may, what is refused, the daily limit and the comment Kira leaves. src/features/triage.js does the rest.
import { neutralise, MARK as KIRA_MARK } from './issuekit.js';
import { MARK as WORK_MARK } from './workkit.js';

const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
export const DAY = 86_400_000;

export const isReviewer = (login, reviewers) => reviewers.some((r) => same(r, login));

// null when the label may be added or removed, else why not.
export function labelRefusal(name, { noLabels, keepLabels }) {
  if (noLabels.test(name)) return `\`${name}\` is a release label: only Ludovic's side touches those.`;
  if (keepLabels.some((l) => same(l, name))) return `\`${name}\` is Kira's own claim label: members use /claim and /unclaim.`;
  return null;
}

// null when the item may be acted on, else why not. `issue`: GitHub's issue object (pull requests have `pull_request`).
export function targetRefusal(issue, action, { ownPullsOf }) {
  if (!issue) return 'There is no such issue or pull request in Horizon.';
  const pr = issue.pull_request;
  if (pr && same(issue.user?.login, ownPullsOf)) return `Pull requests by ${ownPullsOf} are not for triage.`;
  if (pr?.merged_at && ['close', 'reopen', 'duplicate'].includes(action)) return 'That pull request is already merged.';
  if (action === 'close' || action === 'duplicate') return issue.state === 'closed' ? 'It is already closed.' : null;
  if (action === 'reopen') return issue.state === 'open' ? 'It is already open.' : null;
  return null;
}

// Each reviewer's actions in the last 24 hours: log is { login: [timestamps] }.
export function usedToday(log, login, now) {
  return (log[login.toLowerCase()] ?? []).filter((t) => t > now - DAY).length;
}
export function take(log, login, now, max) {
  const key = login.toLowerCase();
  const list = (log[key] ?? []).filter((t) => t > now - DAY);
  if (list.length >= max) { log[key] = list; return false; }
  list.push(now);
  log[key] = list;
  return true;
}
export function refund(log, login, now) {
  const list = log[login.toLowerCase()];
  const i = list?.lastIndexOf(now) ?? -1;
  if (i >= 0) list.splice(i, 1);
}

// What Kira writes on the issue. `what` is built here; free text from Discord goes through neutralise.
export const comment = (login, what) => `${KIRA_MARK}${WORK_MARK}\n🤖 Kira, on behalf of @${login}: ${what}`;
export const note = (text) => (text ? ` Note: ${neutralise(text, 300)}` : '');
