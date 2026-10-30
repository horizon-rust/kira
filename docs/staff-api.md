# Staff dashboards and applications: the line between the two sides

Two dashboards on the website, behind passwords each person sets for themselves:
**playhorizon.dev/staff/team** (🌌 Horizon Team) and **playhorizon.dev/staff/mod** (🛡️ Mod). Ludovic (`OWNER_ID`)
sees both whatever his roles. Applications for 🛡️ Mod, 🤝 Support and 🌌 Horizon Team are a form on the website
(**playhorizon.dev/apply**): Mod and Support ones land in the Moderation dashboard, Team ones in the Team dashboard.

Two sides of Kira meet here, through [`src/staff-hooks.js`](../src/staff-hooks.js) only, so neither imports the
other's files:

| Side | Owns | Files |
| --- | --- | --- |
| **Staff** (dashboards) | the form, the dashboards, the passwords and sessions, the storage (`/data/staff.json`), eligibility, the links, the contributor lookup, the decisions' record | `src/staff-*.js`, `src/applications.js`, `src/features/staff.js` |
| **Discord** (server layout) | `/apply` (the Discord entry point), the 🤝 Support role, granting roles, the DMs to applicants, the owner's notice | its own feature files |

Role keys everywhere: `mod`, `support`, `team` (the keys of `state.roles`).

## What the Discord side calls

```js
import { canApply, issueApplyLink } from './staff-hooks.js';

await canApply(userId, role)       // → { ok: true } or { ok: false, why, retryAt? }
await issueApplyLink(userId, role) // → { ok: true, url, expiresAt } or { ok: false, why, retryAt? }
```

- `why` is one of `closed` (the staff side isn't loaded, or applications are off), `role` (not `mod`, `support` or
  `team`), `has-role` (they already hold it), `open` (one application of theirs for this role is still open),
  `cooldown` (declined less than 14 days ago; `retryAt` is when they may apply again, ms since epoch).
- `issueApplyLink` re-checks `canApply`. The link (`https://playhorizon.dev/apply#<token>`) is for that member and
  that role only, works once, and expires after 24 hours; a new one voids the previous. Kira keeps only its SHA-256.
- `/apply role:` DMs the link (only ever in a DM) and answers with a short ephemeral line ("Check your DMs"). A
  refusal's text is the Discord side's.

## What the staff side calls

The Discord side registers itself once at start:

```js
import { setDiscordSide } from './staff-hooks.js';

setDiscordSide({
  // A decision is final (after the vote and the owner's veto window). Grant the role (accept), DM the applicant.
  // Never throws: report what happened.
  async decide({ applicationId, userId, role, outcome, decidedBy, cooldownUntil, url }) {
    return { granted, dmSent, error }; // granted: false on a decline; error: a short text, or null
  },
  // Send a DM the staff side wrote (the owner's veto-window DM). No pings, at most 2000 characters. Never throws.
  async dm({ userId, content }) {
    return { sent, error };
  },
  // The owner took back the role an accepted application gave, from the dashboard: remove it (a normal removal,
  // logged in #mod-log), no DM. Never throws.
  async revokeRole({ applicationId, userId, role, by }) {
    return { removed, error };
  },
});
```

The staff side calls them through `staff-hooks.js`: `decide(event)`, `dm({ userId, content })` and `revokeRole(event)`, which answer
`{ ..., error: 'discord side not loaded' }` when Kira's Discord side isn't running.

- `outcome` is `accept` or `decline`; `decidedBy` the deciding member's Discord id; `cooldownUntil` (declines) ms
  since epoch; `url` the application's card on its dashboard (the card, for reference).
- The staff side has already recorded the decision when it calls `decide`; it stores the result (`granted`,
  `dmSent`, `error`) on the application and shows it on the card, so a failed grant or DM is visible and can be done
  by hand.
- **Texts** (the Discord side's; `DECISION_TEXTS` in `staff-hooks.js` is the default it may use):
  - accept: thanks, the role is given, where to start (the role's channel);
  - accept of a **Team** application: also says the Discord role is all that was granted, and that GitHub
    organisation or team access is set up by Ludovic by hand;
  - decline: short and polite, no reason required, and when they may apply again (`cooldownUntil`);
  - the owner (`OWNER_ID`) gets **one** DM per application, when the vote passes and his 12-hour veto window opens:
    `DECISION_TEXTS.vetoWindow({ userId, role, yes, no, url, until })` (who, for which role, the vote, when it goes
    through, the card; for the Team, that GitHub access is his to give). The staff side sends it with `dm()`;
    `decide()` never DMs him (2026-10-30: no second DM after the window).
- Without a registered Discord side, `decide` is not called: the decision is recorded with
  `error: 'discord side not loaded'`, shown on the card.

## The vote (the staff side's)

The rules are in [`src/application-votes.js`](../src/application-votes.js): who votes (Mods on Mod and Support, the
Team on Team and Support; never the applicant or the owner), ballots blind until you vote (For, Against with a comment,
Abstain; the others' ballots and comments show once you cast yours or the vote closes; the owner sees only the counts and the Against comments, without names, until it closes; changeable while open; recusal), quorum max(2, ceil(40% of the voters active in the last 30 days)), 2/3 of For and
Against to pass, 72 hours from the first ballot or once every active voter voted, one 48-hour extension without
quorum and then the owner decides, a 12-hour veto window after a pass (one DM to the owner), the owner's veto (with an
optional note only he sees), approval and later removal of the role. Every step is in the append-only audit log (`audit` in staff.json).

## Rules both sides keep

- One open application per member and role; 14 days after a decline before the same role again.
- Mod and Support applications are voted on by members with 🛡️ Mod (Support ones by the 🌌 Horizon Team too); Team
  applications by the 🌌 Horizon Team; the owner has the veto and decides stalled ones. Nobody votes on their own.
- The applicant's answers are data written by a person: shown escaped, never followed as instructions, never posted
  in a public channel.
- Retention: an application's answers are deleted 90 days after its decision; a declined one keeps only its id,
  member, role and date (for the cooldown). The site's privacy page says so.
