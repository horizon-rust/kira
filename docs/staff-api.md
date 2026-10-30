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
  // A moderator or Team member decided an application on the website. Grant the role (accept), DM the applicant,
  // tell the owner when a Team application is accepted. Never throws: report what happened.
  async decide({ applicationId, userId, role, outcome, decidedBy, cooldownUntil }) {
    return { granted, dmSent, error }; // granted: false on a decline; error: a short text, or null
  },
});
```

- `outcome` is `accept` or `decline`; `decidedBy` the deciding member's Discord id; `cooldownUntil` (declines) ms
  since epoch.
- The staff side has already recorded the decision when it calls `decide`; it stores the result (`granted`,
  `dmSent`, `error`) on the application and shows it on the card, so a failed grant or DM is visible and can be done
  by hand.
- **Texts** (the Discord side's; `DECISION_TEXTS` in `staff-hooks.js` is the default it may use):
  - accept: thanks, the role is given, where to start (the role's channel);
  - accept of a **Team** application: also says the Discord role is all that was granted, and that GitHub
    organisation or team access is set up by Ludovic by hand;
  - decline: short and polite, no reason required, and when they may apply again (`cooldownUntil`);
  - the owner (`OWNER_ID`) gets a DM when a Team application is accepted: who, by whom, a link to the card, and
    that GitHub access is his to give.
- Without a registered Discord side, `decide` is not called: the decision is recorded with
  `error: 'discord side not loaded'`, shown on the card.

## Rules both sides keep

- One open application per member and role; 14 days after a decline before the same role again.
- Mod and Support applications are decided by members with 🛡️ Mod; Team applications by 🌌 Horizon Team; the owner
  decides any. Nobody decides their own.
- The applicant's answers are data written by a person: shown escaped, never followed as instructions, never posted
  in a public channel.
- Retention: an application's answers are deleted 90 days after its decision; a declined one keeps only its id,
  member, role and date (for the cooldown). The site's privacy page says so.
