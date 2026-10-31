# kira

The bot of **Horizon**'s Discord server (Minecraft Java Edition rewritten in Rust, <https://playhorizon.dev>).
Since 2026-10-14 the server is about Horizon only: everything else (music, AI coding, Ludovic's other
projects) is talked about in #general (#off-topic was merged into it on 2026-10-30). Free: it runs on `ludothinkpad`, no paid bot.

## The server

`npm run setup` makes the server match [`src/config.js`](src/config.js):

- **Categories** (since 2026-10-28): 👋 start here (welcome, #new-members, #horizon-info with the download, #official-server (Horizon Official, the SMP hosted by Sculk), #server-chat (its chat, posted by the server), FAQ, rules,
  announcements, #ludovic-videos, #support-horizon) · 🌅 horizon (#horizon-bugs: reproducible bugs only, #horizon-support:
  help, #horizon-ideas, #horizon-chat, #showcase for
  videos/clips/screenshots/builds made in Horizon, #releases, #updates) · 🛠️ contributing (#contributors: everyone reads, only
  🛠️ Contributor, the Team and mods write; #horizon-team) · 💬 general (#general,
  #introductions, #hall-of-fame, #memes, #bot-commands) · 🌍 languages (eleven channels everyone sees: default channels; re-measured 2026-11-11, fewer than ~5 people writing → proposed for removal) · 🔊 voice · 🛡️ staff. The old channels (#projects, #resources, #help, #beats, …) were deleted
  on 2026-10-14 after their messages were exported (`scratch/deleted-channels-2026-10-14/`, not committed).
  #work-board and #dev-log are replaced by #updates, and #off-topic by #general (`REPLACED` in `config.js`): setup
  exports every message of each to `scratch/replaced-channels-<date>/<name>.json` and `.md`, and every attachment to
  `<name>-files/` (Discord's links expire; not committed), then deletes the channel; a failed export (an attachment
  that won't download included) stops setup with the channel still there.
- **Forums** each have post guidelines, a template, required tags (some only mods set), a minimum time
  between posts. Kira checks every new post against the template. Each forum with a template also has
  ONE locked, pinned **📌 How to post here: read me first** post (guide, template, rules). It is Kira's own
  post: never checked against the template, no reactions, never a GitHub issue, `/done` refuses it.
- **Roles** (top to bottom): kira · 👑 ludovic · 🌌 Horizon Team · 🛡️ Mod · 🤝 Support · 💚 Sponsor · 🧪 Horizon Tester · 💎 Booster · lvl 50 → lvl 5 ·
  🛠️ Contributor (earned with a merged PR and `/verify-github`, not picked: see [Contributors](#contributors)) · 🧩 Modder · 🎬 Videos · 📣 Big news · 📦 Releases.
- **Onboarding** (2 questions when you join: what brings you to Horizon, which pings; the default
  channels, `DEFAULT_CHANNELS` in `config.js`, include #new-members) and the
  **Server Guide** (Discord's newcomer home; bots get "Bots cannot use this endpoint", so Ludovic applies it
  by hand in Server Settings → Onboarding: setup writes the wanted body to `state.serverGuide`), the server icon
  (`assets/horizon-icon.png`, Horizon's mark: the horizon repo's `docs/media/brand/avatar.svg` at 512 px;
  uploaded again only when it changes; the running bot applies it and Kira's own avatar `assets/kira-avatar.png`
  too, on start, when either file changes: `src/brand.js`),
  the same roles as buttons in `#welcome`, Community mode, **rules screening** (new members read and agree to
  the rules before they can talk: one TERMS field with each rule as "Title. first sentence", built from `RULES`
  by [`src/screening.js`](src/screening.js) and sent by setup, which only ever turns it on), Discord AutoMod rules,
  a permanent invite.

Only the AutoMod rules (or a channel's `slowmode`) changed? `node scripts/apply-moderation.js [--dry-run]` (with `DISCORD_TOKEN`)
applies just those, finding channels and roles by name.

Run it again after changing `config.js`: it updates what it made (IDs in `data/state.json`), moves
channels, and deletes the empty categories it made earlier. If the IDs are ever lost it finds its
channels, roles, messages, guides and posts again by name instead of making new ones, and it stops if it finds
two copies of the same thing. The bot and setup each keep to their own keys in `state.json`, so running
setup while Kira is up is safe; restart Kira afterwards so it knows the new channels.

## What kira does

| | |
| --- | --- |
| Moderation | Floods / copy-paste / link floods (5 messages with links in 30 s) → messages deleted, timeout of 10 min, then 1 h, then 1 day the same day. All-caps, emoji walls, more than 5 links in a message and executables removed. Accounts under 3 days can't post links. Discord AutoMod (`src/automod.js`, applied by setup): spam, slurs, mention spam, invites and scams, bad names, piracy (rule 3: TLauncher, SKlauncher, cracked Minecraft, offline mode + bypass, warez… `MOD.piracy` in `config.js`), and Telegram links (t.me, telegram.me/.dog/.org, tg://, "t . me/": blocked and a 1-hour timeout; `TELEGRAM_PATTERNS`). Every rule alerts #mod-log (the piracy alert too, since 2026-10-30: #mod-chat is for the mods talking); mods and the Horizon Team are exempt. In every language, Kira's AI reads the 🌍 languages channels, #horizon-chat, #general and non-English messages anywhere: clear cases removed, borderline ones flagged for a mod (see [AI answers](#ai-answers)). Raids (15 accounts younger than 7 days in 2 minutes) → raid mode for an hour: verified phone, DMs between members paused. No slowmode (Ludovic, 2026-10-28): none set (`slowmode` in `LAYOUT`) and none automatic (`MOD.autoSlowmode`); mods and the Horizon Team have Bypass slowmode for when they set one with `/slowmode`. Verification level high (10 minutes on the server before talking); @everyone can't ping everyone, open threads or use outside apps. `/warn` (3 in 30 days → 1 h timeout), `/warnings`, `/clearwarnings`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban` (kick and ban: the Horizon Team only; mods time out), `/purge`, `/clear-chat`, `/slowmode`, `/lock`, `/unlock`, `/raidmode` |
| Chat clears | Every 6 hours the messages older than 24 h in #horizon-chat and #general are deleted (bulk deletes under 14 days, one by one beyond, paced); pins and messages that started a thread stay, nothing else is touched. One line in `#mod-log` per run. `/clear-chat [older_than:<hours>]` (Manage Messages) does it now in the current chat channel. `CLEAR` in `config.js`; [`src/features/chatclear.js`](src/features/chatclear.js) |
| Logs (`#mod-log`) | Joins (account age, **which invite**) and leaves grouped every minute, deleted and edited messages, nicknames, bans, timeouts, AutoMod |
| Reports | `/report-member` and "Report to mods" (right-click a message → Apps) → `#reports` (`/report` is the bug form: below) |
| Mod-mail | DM kira → a thread in `#mod-mail`; mods answer in the thread (`//` for notes, `//close`) |
| Levels | XP for messages (once a minute) and for voice time with others; lvl 5/10/20/30/50 roles; `/rank`, `/leaderboard`, `/givexp` |
| Voice rooms | Join **➕ create your room** → your own channel; `/room lock / unlock / private / public / invite / kick / limit / rename / claim / transfer`; deleted when empty. **🎙️ ludovic** is locked: people wait in **⏳ waiting room** and Ludovic or a mod `/pull`s them in |
| Forums | Each new post is checked against its template; Kira lists what's missing and closes it after an hour if it's still missing. `/done` closes your post with its tag (solved, taken, found, filled, done) |
| #horizon-support | Help, apart from the bugs (Ludovic, 2026-10-30): can't start, performance, the launcher, sign-in, multiplayer. Everyone opens posts; only the poster, 🤝 **Support** and the staff write in a post (Kira removes other replies, one short note per member every 10 minutes, logged in #mod-log); 🤝 Support has Manage Threads in this forum only (the ✅ solved tag, closing, `/done` on any post). A post that follows the template gets Kira's first answer when her AI is on (from her sources only, nothing posted when they don't settle it) and a note for 🤝 Support, pinging the role at most once every 15 minutes (the next ping names the posts that came in between). Never GitHub issues. `SUPPORT` in `config.js`; [`src/features/support.js`](src/features/support.js) |
| Community | Welcome in `#new-members` (grouped when many people arrive), role buttons, 👍/👎 on ideas, 🔥 in #showcase, ⭐ hall of fame (5 stars), `/remind` |
| The hub's verbs | Kira is the front desk of [playhorizon.dev/hub](https://playhorizon.dev/hub) with the same verbs, as slash commands and as `@Kira <verb>`: `report` (a bug form → a post in `#horizon-bugs` and a GitHub issue), `roadmap` / `roadmap <area>` (the whole roadmap, or one area in full), `claim`, `status`: see [The hub](#the-hub) |
| GitHub issues | Posts in `#horizon-bugs` that pass their template, and `/report`, become issues in horizon-rust/horizon (a post that reads as a request for help, tagged only install / launch or performance, is pointed to #horizon-support instead; the poster's reply **bug** files it); answers on GitHub come back to the post, pinging the poster. `#horizon-ideas` posts go to the suggestion queue instead. `/issue` (staff). Off until its token exists: see below |
| Ludovic's videos | His YouTube channel (@lu4ovic) → `#ludovic-videos`, a read-only channel: every new video, Short or live stream, once, as `<@&🎬 Videos> 🎬 New video: **title**` and its link (Discord shows the player). Pings only the opt-in **🎬 Videos** role (picked in Onboarding's "Want to be pinged?" or with the buttons in `#welcome`; `allowedMentions: { parse: [], roles: [that role] }`, so nothing in a title can ping; the role's key is `newvideos`, not the retired `videos` of the old server). The channel's public Atom feed every 10 minutes ([`src/videos.js`](src/videos.js), channel id in `VIDEOS` in `config.js`); the ids posted are in `state.videos`. The first run only records the videos already out and sets the date before which nothing is ever posted; a feed error is logged and retried 10 minutes later. Giving the role to the members already on the server is a one-off: `scripts/grant-videos-role.js` (below) |
| Releases | Releases of horizon-rust/horizon → `#releases`: the game (`vX.Y.Z` tags, a summary of New and Fixed) and the launcher (`launcher@X.Y.Z`; before 0.2 `launcher-v…`), nothing else (REST API every 3 minutes, newest 200; [`src/releases.js`](src/releases.js)). One channel since 2026-10-23: every release gets one post, once by release id (`state.releases`; ids posted as Alpha before that, `state.nightlies`, are never posted again). Every post is silent (no role, Discord's `SUPPRESS_NOTIFICATIONS` flag 4096) except one a day: the first game release published after 20:00 UTC pings the 📦 Releases role and lists the game releases since the last ping ("Out since the last ping"; `state.releasePings`). Launcher releases never ping. No dates in the posts. Drafts never. Hand-written posts: `ONE_OFFS` in `config.js`, each posted once |
| X | Releases, the weekly summary and announced shipped items, from the same journal, ≤ 240 characters; off without credentials, `X_DRY_RUN=1` prints: see below |
| `#updates` | One feed generated from the hub's journal: merged work grouped by roadmap item, releases (pointing to `#releases`), shipped items, the weekly summary; the board's summary on top: see below |
| Work board | The board behind the hub's kanban, `/claim`, `/unclaim`, `/working`, `/board`, `/move`, `/link-github`, `/mytasks`, `/goodfirst`, `/notify`: see below |
| Sponsors | 💚 Sponsor for anyone GitHub reports as a sponsor of Ludovic (one-time included). `/sponsor github:<login>`: Kira asks GitHub's `isSponsoredBy`, then gives a code to put in the account's bio or a public gist (`kira.txt`) and a **Verify** button; on success the role and a #mod-log line. A daily recheck takes back only the roles Kira gave, when GitHub stops reporting the sponsorship (a DM says so). Private sponsorships read false: the mods use `/sponsor-grant user: [github:] [remove:]`; roles given by hand are never taken back. 6 tries an hour per member. `SPONSORS` in `config.js`; [`src/features/sponsors.js`](src/features/sponsors.js), rules in [`src/sponsor-kit.js`](src/sponsor-kit.js) |
| Applications | `/apply role:` (🤝 Support, 🛡️ Mod, 🌌 Horizon Team; Ludovic, 2026-10-30) is the Discord side of the applications on the website's staff dashboards ([docs/staff-api.md](docs/staff-api.md)): Kira asks the staff side whether the member may apply (one open application per role, 14 days after a no), then DMs a one-time link to the form (never in a channel; a refusal is said in words). Applications go to a vote on the dashboards, then Ludovic's 12-hour veto window: the staff side DMs him once through Kira's `dm` hook when it opens (`DECISION_TEXTS.vetoWindow`). When the decision is final, the dashboards call Kira's `decide` (`src/staff-hooks.js`): accept gives the role and DMs where to start, decline DMs a short no with the date they may apply again; each one is a line in #mod-log, and what failed (left the server, closed DMs) goes back to the card. `APPLY` in `config.js`; [`src/features/apply.js`](src/features/apply.js), texts in [`src/apply-kit.js`](src/apply-kit.js) |
| Contributors | `/verify-github` proves a linked GitHub account is the member's; a merged pull request in Horizon then gives 🛠️ Contributor: see [Contributors](#contributors) |
| Triage | `/gh` (`label`, `close`, `reopen`, `duplicate`, `pause`, `resume`) for Ludovic's trusted reviewers, through Kira's GitHub token: see [Triage through Kira](#triage-through-kira) |
| Agents | Kira's MCP server for contributors' AI agents, `/agent connect`, `/agent tokens`, `/agent revoke`, `#agent-log`: see below |
| AI answers | A message that mentions Kira or replies to her gets one answer from Claude, grounded in the FAQ, Horizon's docs and release notes; what she can't answer goes to the team. Off unless `KIRA_AI` is set; `/kira-ai off\|on\|status`: see [AI answers](#ai-answers) |
| Game chat | On a Minecraft server with the [kira-pumpkin](https://github.com/horizon-rust/kira-pumpkin) plugin, a chat message starting with `kira` or `@kira` gets one answer in chat (`<Kira> …`): the same sources, budget, off switch and moderation as her Discord answers, at most 256 characters, plain text, links only to playhorizon.dev. `POST /game/ask` with the server's token: see [Game chat](#game-chat) |
| Info | `/help` (a short tour of the server with channel mentions, then what Kira does and its commands; `helpText()` in `src/texts.js`), `/links`, `/horizon`, `/userinfo`, `/serverinfo`, `/avatar`, `/modmail` |

## Running it

Discord app **kira** (application ID `1559239271271891004`, private bot; Server Members and Message
Content intents), owned by Ludovic's account. Token: `op://Agents/Discord bot Kira/credential`.

    npm ci
    ~/fleet/op run --env-file .env.op -- npm run setup     # layout, once and after config changes
    systemctl --user restart kira                           # the bot (deploy/kira.service)
    journalctl --user -u kira -f

Install the unit with `ln -s ~/code/kira/deploy/kira.service ~/.config/systemd/user/`.

## #updates

[`src/features/updates.js`](src/features/updates.js) reads the hub's journal (`HUB_JOURNAL_URL`, default
`https://playhorizon.dev/data/journal.json`, every 10 minutes) and posts each new entry once (`state.updates.seen`),
silently and with no pings ([`src/journal.js`](src/journal.js)):

- merged pull requests, **grouped by roadmap item** (their `roadmap:<id>` label): one post per item, its name
  linked to `<hub>#<id>`, one line per pull request in plain words; merges with no item under "Other changes";
- each **release**: one line with its link, pointing to `#releases` for the notes (Kira still posts those there);
- each roadmap item that **shipped**, with its `post` (or `plain`) text and the release;
- the **weekly summary** (written by the maintainers into the horizon repo's `roadmap/journal/`), as an embed.

The first look only records what is already there; until setup has made `#updates` nothing is fetched or recorded.
Kira also keeps its own **pinned copy of the whole roadmap** (what `/roadmap` shows, one or two messages): posted and
pinned once, then edited in place when `roadmap.json` changes (checked every 10 minutes and at every start; the message
ids and a hash of what they show are `state.roadmapPin`, a message a moderator deletes is posted again at the next check).

At the top of the channel, one pinned message is the **board's summary** (the columns' counts, three good first
tasks, the hub's link), edited in place after every board refresh.

**journal.json** (generated in the horizon repo): `{ "entries": [ { "id", "kind", "date", "title", "plain"?,
"dev"?, "url"?, "item"?, "item_title"?, "number"?, "tag"?, "shipped_in"?, "post"?, "announce"? } ] }`. `kind` is
`merge`, `release`, `weekly` or `shipped` (others are skipped); `id` never changes (it is what "posted once" keys
on); `item` is a roadmap id; links outside github.com and playhorizon.dev are not shown.

## X (broadcast only)

X only broadcasts: [`src/xposter.js`](src/xposter.js) and [`src/features/x.js`](src/features/x.js) post, from each
journal fetch of #updates, every new **release**, **weekly summary** and **shipped** item flagged `announce: true`,
once each (`state.x.seen`; the first look only records), at most 3 a round and 10 a day. Each post is at most 240
characters: the entry's `post` (or `plain`) cut at a word, then its link (github.com or playhorizon.dev, else the
hub); `@` names are broken so nobody is mentioned. Nothing is read or answered on X.

- **Off** unless credentials are set: `X_ACCESS_TOKEN` and/or `X_REFRESH_TOKEN` (OAuth 2.0 user context of the
  Horizon account's own X app, scopes `tweet.write users.read tweet.read offline.access`), `X_CLIENT_ID`, and
  `X_CLIENT_SECRET` for a confidential client. Access tokens last two hours: on a 401 Kira refreshes once and keeps
  the new pair (X rotates the refresh token) in `x-tokens.json` next to the state (mode 600), which wins over the
  variables from then on. Errors never include X's answer to a refresh.
- **`X_DRY_RUN=1`**: every post is printed in the log instead (`x dry-run: "…"`), with or without credentials.
- **Preview** without Kira: `node scripts/x-preview.mjs [journal.json]` prints every text it would post, with its
  length.

## Work board

The board is built from GitHub every 10 minutes, after each command, and 30 s after someone posts a link to a
Horizon issue or pull request; people see it as the kanban on the hub (built from the same public GitHub data), and
on Discord through `/board`, `/working`, `/mytasks` and the summary in `#updates`. Each card is the issue or pull
request (link), who is on it (🔨 = claimed on Discord), its labels, its pull requests and their status (draft, CI,
review), and when.

- **Where GitHub puts a card** (`autoColumn` in [`src/board.js`](src/board.js)): an open issue → To do; claimed,
  assigned, a branch named for it (`40-…`, `issue-40`) or a draft pull request that fixes it → In progress; a
  pull request ready for review that fixes it → Review; the `backlog` label → Backlog; closed in the last 7 days →
  Done. A pull request that fixes no issue on the board is a card of its own (draft → In progress, ready →
  Review, merged → Done). Issues labelled `test` stay off the board.
- **By hand**: `/move <number> <column>` (maintainers, and a member on a card they claimed). A manual move
  holds until the card's state on GitHub changes; moving a card back where GitHub puts it clears it.
- **Claims**: `/claim <issue>` adds the `in progress` label and a "Claimed by … on Discord" comment and records
  the claim; `/unclaim`. A claim lapses after 14 days without activity (a comment, a commit or a pull request
  mentioning the issue), with a DM 3 days before. `/link-github <username>` shows Discord names on pull requests
  (Ludovic and Cosmic are in `WORK.github`).
- **One identity per contributor**: `/link-github <username> credit:True` also puts the pair on the hub's contributors
  page, which reads `GET /contributors.json` on Kira's HTTP server (the MCP host without `/mcp`, public, CORS open,
  cached 5 minutes): `{ "contributors": [{ "github", "discord" }] }`, the GitHub login and the Discord display name of
  each member who said yes and is still on the server, nothing else. `credit:False` hides it; a mod linking someone
  else never shows them (they choose by running it themselves).
- **CI**: a pull request's author gets a DM when CI starts failing on its commit, if they linked GitHub and turned on
  `/notify dm:on` (5 DMs an hour at most). Nothing for what was already failing at Kira's first look.
- **Good first tasks**: open, unclaimed issues in To do labelled `good first issue` or `help wanted`
  (`board.goodFirst`); `/goodfirst` lists them, the summary in `#updates` shows three.
- **For other programs** (the coming agent/MCP feature): [`src/board.js`](src/board.js) has no Discord and no
  network: `build(github, work)` → `{ snapshot, stale }`, `list(snapshot, { column, person, kind })`,
  `find(snapshot, ref)`, `move(work, snapshot, ref, column, by)`, `assign` / `unassign` (claims). Each refresh
  writes the snapshot to `data/board.json` (`version`, `repo`, `generatedAt`, `columns[].cards[]` with `id`,
  `kind`, `number`, `title`, `url`, `state`, `column`, `auto`, `moved`, `people`, `claim`, `labels`, `prs`,
  `branches`). The claims, moves and the summary's message id live in `state.work`.

The token needs **Issues: Read and write** on horizon (labels and comments). Pull requests, checks and
branches are read without a permission because the repo is public; if it ever goes private, add **Pull
requests: Read-only**, **Commit statuses: Read-only** and **Checks: Read-only**.

## Agents (MCP server)

Contributors connect their AI coding agent (Claude Code, Codex, Cursor…) to Kira's MCP server at the
endpoint in the Railway variable `KIRA_MCP_URL` (now `https://kira-production-500e.up.railway.app/mcp`; later
`https://mcp.playhorizon.dev/mcp`, once its DNS record exists). That one value feeds `/agent connect`, the
announcement in #announcements and the pinned guide in #horizon-info (`ONE_OFFS` `agents-live` and
`agents-info`, edited in place at every start): switching domains is setting the variable. Railway keeps the
generated `*.up.railway.app` domain working after a custom domain is added, so agents set up with the old
URL keep working.
with a personal token from `/agent connect`. Streamable HTTP, stateless, the official SDK
([`src/mcp.js`](src/mcp.js)); tokens and limits in [`src/agents.js`](src/agents.js); the Discord side and the
actions in [`src/features/agents.js`](src/features/agents.js).

| Tool | Scope | What |
| --- | --- | --- |
| `whoami` | read | the token's owner, scope, whether they are a maintainer |
| `board_list` | read | the board's cards, filtered by column, label (area), person, kind |
| `task_get` | read | one card, its issue or pull request text and latest comments |
| `ludovic_now` | read | what Ludovic works on: his `/status`, his open pull requests, the repo's branches, his cards. Public data only |
| `task_claim`, `task_unclaim` | write | `/claim` and `/unclaim`, in the token owner's name |
| `card_move`, `card_note` | write | move or note **their own** cards: an issue they claimed, or a Kira card they own (not to Done: maintainers only) |
| `card_add` | write | a card of Kira's own (`card#N`) for work that is not a GitHub issue or pull request |
| `ask` | write | a question in #horizon-chat, as "<name>'s agent", 5 an hour |
| `task_assign`, `card_close` | maintain | claim for someone else; close Kira's cards; move any card |
| `ai_handoffs` | maintain | the questions Kira's AI passed to the team (member text marked untrusted); `close` the ones answered |

**Tokens.** `/agent connect scope: days: label:` answers with the token once, ephemerally, with the config
snippets; Kira keeps only its SHA-256 (`data/agents.json`, mode 600). `kira_<id>_<secret>`: the 8-character
id names it in `/agent tokens` and the logs. Scopes `read` < `write` < `maintain` (maintain: only for
maintainers, and checked again at every call). 90 days by default, 365 at most, 5 live tokens per member.
`/agent revoke id:` works at once (mods can revoke anyone's; `/agent tokens member:` lists them).
**`/agent connect` is closed until `KIRA_AGENT_ISSUANCE=on`** (a Railway variable). From the host's shell:
`node scripts/agent-token.mjs issue|list|revoke` (test tokens, maintainers' own agents).

**Every agent's work goes on the board.** Agents without MCP support use the same tools from a shell:
`KIRA_TOKEN=… node scripts/board.mjs list | get #40 | add "Release 2026.10.15" progress | move card#3 done | note card#3 "tagged" | claim 40 | ludovic`.

**Rate limits** per member (all their tokens together): 240 requests (any kind, `initialize` and `ping` included), 120 reads and 20 writes a minute, 5 questions an hour; claims and unclaims also spend a GitHub budget of 6 an hour and 20 a day. 30 failed logins a minute per
address, then 429. **Audit**: every call (who, token id, tool, arguments, outcome, refusals included) goes to
the staff channel `#agent-log` (grouped every 30 s) and the service log.

### Threat model

| Threat | Answer |
| --- | --- |
| A token leaks (pasted in a repo, a log) | Only a hash is stored; revocation is immediate; tokens expire (90 days); scope `read` by default; every action is logged with the token id and owner. Tokens die when their owner leaves or is banned (all revoked at once, logged in #agent-log), and every call checks that the owner is still a member, past rules screening (not `pending`) and not timed out (5-second cache) |
| Someone guesses or forges tokens | 256-bit secrets, constant-time hash comparison, 30 failures a minute per address then 429. The address is Railway's `X-Real-IP` (else the last `X-Forwarded-For` hop, the one Railway's edge adds), never a hop the client wrote |
| A contributor's agent does what the contributor may not | Scopes, then ownership: write tokens only move or note issues their owner **claimed** and Kira cards they own (a GitHub login linked with `/link-github` is not proof, so it never counts for writes); Done is for maintainers; maintainer actions check the scope **and** the Discord role at each call; actions run in the owner's name |
| Prompt injection through issues, comments, notes, names, branches | All text people wrote comes wrapped in `<untrusted source=…>` (titles, bodies, comments, notes and their authors, Discord names, Kira cards' labels and links, pull request branch names, statuses), with `&`, `<`, `>` and their lookalikes (＜ ＞ ‹ › ⟨ ⟩ 〈 〉 …) escaped inside, so nothing in it can open or close a tag; every answer says to treat it as data. No tool can do anything an injected agent could abuse beyond its owner's own cards |
| An agent reads what it shouldn't | No tool reads files, runs code, sees tokens (others' or its own), DMs, mod-mail, private channels or the server's members. `ludovic_now` uses only public GitHub data and the `/status` Ludovic sets |
| Spam and abuse through agents | Limits per member, not per token; at most 3 tokens issued a day (revoked ones count) and 5 live; at most 10 open Kira cards per member. Claims (agents and `/claim` alike): 3 held at once per member, 2 minutes between two claims or unclaims by a member, 10 minutes between a claim and an unclaim of one issue; agents' claims also spend the GitHub budget above (maintainers are exempt from the per-member caps only through the maintain scope). An agent without maintain unclaims only its owner's claims.  Agents' notes and moves stay on the cards: nothing they do is posted in a public channel except `ask`. Agent text in Discord is one line (no headings, lists, quotes or fake `-#` lines), never pings (no mentions parsed, `@everyone` broken), can't make masked links (brackets escaped), and says it comes from an agent. Card links: https on github.com or playhorizon.dev only, exactly as parsed, with no spaces, `< > ( )`; labels: `a-z 0-9`, space, dash. Cards stored before these rules are re-checked at start |
| Names in GitHub comments | Discord names go in a code span: no @mention, link or Markdown |
| Malformed or oversized input, and errors | zod schemas on every argument (numbers, refs, columns, lengths, card links), 64 KB bodies, POST only, 15/30 s timeouts. Agents see refusals; any other error is logged and shown as "Internal error." |
| The host is compromised | Kira runs on Railway, not on Ludovic's machines, as the unprivileged `node` user (the entrypoint only chowns `/data` as root); it holds only the Discord bot token and the fine-grained GitHub token (Issues: write on horizon). Nothing on the internet talks to the ThinkPad |
| The admin routes (`/admin/backup`, `/admin/restore`: Kira's files, for moving hosts) | **Off**: `KIRA_ADMIN_TOKEN_SHA256` is empty on Railway, so the routes don't exist. Turned on only for a move (below), with a separate random token whose secret is only in 1Password; constant-time check; failures rate-limited like logins; a restore must have a well-formed agents.json. A backup holds token hashes, never tokens |
| Secrets in transit to the host | Sealed: `op read … \| node scripts/seal.mjs <host>/seal-key` encrypts with a key generated on the host's volume; only ciphertext (`FOO_SEALED`) is in Railway's variables and anyone's terminal |

## One-off: the 🎬 Videos role for everyone already here

After setup made the role and Kira is deployed with the ping, give it to the members already on the server
(bots skipped; from then on it is opt-in). Sequential, honours Discord's 429 `retry_after`, safe to run again
(members who have it are skipped), prints counts only:

    ~/fleet/op run --env-file .env.op -- node scripts/grant-videos-role.js --dry-run
    ~/fleet/op run --env-file .env.op -- node scripts/grant-videos-role.js

`--role <id>` skips the lookup by name. The code is [`src/grant.js`](src/grant.js).

## Triage through Kira

GitHub has no Triage role on a personal account's repo, and write access would let a branch push run workflows with
the repo's secrets. So the reviewers Ludovic trusts (`TRIAGE.reviewers` in `config.js`: kacpherek, rdbtCVS,
Online5277, the three with most merged PRs; he edits the list) triage horizon-rust/horizon **through Kira**, with Kira's token
([`src/features/triage.js`](src/features/triage.js), rules in [`src/triage-kit.js`](src/triage-kit.js)):

- `/gh label <#> add|remove <label>` (the label must exist), `/gh close <#> [reason] [note]`, `/gh reopen <#>`,
  `/gh duplicate <#> of <#>` (labels `duplicate`, closes as not planned), for issues and pull requests.
- Never merge. Never a label with "release" in its name (`release-now`, `release-blocker`, `skip-release`…) nor Kira's
  `in progress`. Never a pull request by ludovic111 (his and his agents'), never a merged one.
- Each action is a GitHub comment "🤖 Kira, on behalf of @login: …" (free text goes through the same neutraliser as
  forum posts: no pings, no cross-references) and a line in `#mod-log`. 60 actions per reviewer in any 24 hours; an
  action GitHub refuses is not counted.
- The member needs a verified link (`/verify-github`) to a listed login. Ludovic removes someone by editing the list;
  `/gh pause` (Ludovic or a mod) stops everyone until `/gh resume`.
- Kira's token needs permission to write issues and pull requests for closing and labelling a pull request; if
  GitHub refuses, the reviewer is told nothing changed.

## Contributors

🛠️ **Contributor** is earned: a member whose **verified** GitHub account has at least one merged pull request in
horizon-rust/horizon. Members don't pick it any more (no button, not an Onboarding answer). The code is
[`src/features/contributors.js`](src/features/contributors.js) (Discord) and
[`src/contributor-kit.js`](src/contributor-kit.js) (the rules, no Discord).

- **Verifying** (`/link-github` alone proves nothing): after `/link-github <login>`, `/verify-github` gives a one-time
  code (`kira-` and 8 characters, valid 30 minutes) to put in the GitHub profile bio, or in a public gist named
  `kira.txt`; `/verify-github check:True` reads the bio (`/users/<login>`) or the gist and, on a match, marks the link
  verified (`state.work.verified`). A mod can verify someone by hand with `/verify-github member:`; it is logged in
  `#mod-log`. Linking another login clears the verification (and takes the role). The logins in `WORK.github`
  (config.js, set by Ludovic) count as verified.
- **Granting**: on a successful verification Kira counts the merged pull requests (`/search/issues`, its own limit of
  30 a minute, `repo:… is:pr is:merged author:<login>`) and gives the role at 1 or more, with one welcome line in
  `#contributors`. It also gives it when the board's refresh sees a verified author's pull request merged, and a
  daily sweep catches the ones it missed. Kira never takes the role away because of a count: only when the link or
  the verification goes.
- **The role clean-up** (one-off, 2026-10-27, `cleanup()` in the feature): holders who are staff keep it; verified with
  a merged pull request keep it; a linked login with a merged pull request that isn't verified gets a DM and 7 days to
  run `/verify-github` (the daily sweep removes the role after that). A holder who never linked GitHub is compared with
  every author of a merged pull request in Horizon (the search API, split by merge date because it shows 1000 results
  at most): the Discord **username** (display names are too loose), without spaces, dots and underscores, equal to a
  login or containing it (or the other way round) when both have at least 5 characters, with look-alike digits read as
  letters (`Excurs1ons`). A match gets a DM and the same 7 days to `/link-github` and `/verify-github`. Ludovic's
  trusted reviewers (`CONTRIBUTORS.protectedMembers`, by Discord id) always count with their login and are never removed
  automatically. Everyone else (no merged PR) loses the role **at once**, with no grace (Ludovic, 2026-10-27), and gets one DM
  saying how to get it back; Kira posts one line without a ping in `#announcements`. It runs inside Kira (it needs the state), through the admin routes: with `KIRA_ADMIN_TOKEN_SHA256`
  set, `POST /admin/contributors-cleanup` starts a **dry run** (nothing changes) and `{"dry": false}` the real one;
  `GET /admin/contributors-cleanup` returns the last result: counts, and the `matches` (Discord name and the GitHub
  login it was matched to) for the staff to read.

## AI answers

Kira answers questions herself with the Claude API ([`src/ai.js`](src/ai.js), [`src/ai-kit.js`](src/ai-kit.js), [`src/features/ai.js`](src/features/ai.js)).

- **When:** a message that mentions Kira, or replies to one of her messages, gets one answer. A reply in a `#horizon-bugs` or `#horizon-ideas` post counts only with a mention, because those posts get Kira's template notices. `@Kira <verb>` and a bare `@Kira` stay the hub's. `KIRA_AI=all` also answers questions (with a `?`) in `AI.helpChannels`; that list is empty for now.
- **From what:**
  - the FAQ in `config.js` (both lists, `FAQ` and `FAQ_MORE`);
  - the **server guide**, built from `config.js` by `serverGuideText()` in [`src/texts.js`](src/texts.js) (no GitHub call, always there): the welcome text, every channel by category with its topic and, for forums, the how-to-post guide and template, the roles (`about` in `ROLES`), the rules, `/help` and the official server. So "how does this server work", "where do I ask for help", "how do I become a mod" are answered from the server's own texts; `#channel-name` in a reply becomes a clickable mention;
  - from horizon-rust/horizon main, the README and `docs/*.md` (refreshed daily) and the notes of the latest published releases (hourly).
  - All of it is read through `github.js`'s `makePublicGitHub`: the GitHub App with a reserve of its own (`KIRA_GITHUB_PUBLIC_KEEP`, default 100, so the sources still load when the board has stopped for the hour at `KIRA_GITHUB_KEEP`), else without a token (60 an hour per IP); never Ludovic's token. A doc is fetched again only when its sha changes.
  - A failed refresh keeps the last good copy, saved in `/data/ai-sources.json` (`KIRA_AI_SOURCES`): a restart during a GitHub outage or a held-back hour still answers from it. "Sources not loaded" (passed to the team) only when nothing was ever loaded. A failure is logged once until that part loads again.
  - When sources disagree, the FAQ wins, then the server guide, then the release notes, known issues, the README and the docs.
- **Models:** `claude-haiku-5-5`. `claude-sonnet-5-5` only when Haiku says it is unsure, or for a reply chain of 4 messages or more. The model's only tool is `read_doc` (read-only). Its output is JSON: answer, pass, or unsure.
- **Safety:**
  - Member text goes in as data inside `<member_message>`/`<context>` tags, and our own tags inside it are defused.
  - Every reply goes through `checkReply()` before it is posted. It allows links only to playhorizon.dev, github.com/{ludovic111,horizon-rust}/*, the server invite and microsoft.com/link (the FAQ's sign-in page). It blocks code blocks, commands, dates and promises, strips pings, and caps the length. A reply that fails is replaced by "passed to the team".
  - Replies go out with `allowedMentions: { parse: [] }`.
- **Limits:** 5 questions per member an hour, and `KIRA_AI_DAILY_USD` dollars a day (default 3, UTC days), counted from each response's `usage`. Over the budget, Kira says she has passed the question to the team.
- **Logs:** every answer goes in `#mod-log`: the question link, the reply, the model, the tokens, the cost and the day's total. Questions passed to the team are kept in `state.kiraAi.handoffs`; the orchestrator reads them, and closes them once answered, with the MCP tool `ai_handoffs` (maintainers).
- **Usage:** `GET /ai-usage` with `Authorization: Bearer <KIRA_USAGE_TOKEN>` (1Password `Kira usage token`; no variable, no route) returns the spending per UTC day (`cost_usd`, `answers`, `passed_to_team`, `bug_reviews`, `moderated`: messages read for moderation, `models`: calls per model), the current month's totals, `daily_budget_usd`, `bugs` (bug reports read or not) and `moderation` (on or not). It has no message text and no user ids. The LifeOS control center reads it.
- **Bug reports** (`KIRA_AI_BUGS=1`, off by default): before a `#horizon-bugs` post or a `/report` becomes an issue, GitHub's search finds open issues for its title and one Haiku call reads the report next to them (about $0.0003 a report). Clearly the same bug: the report goes on that issue as a comment and the post follows it. Maybe the same: Kira asks the reporter, and **yes** adds it there, **no** files a new issue; with no answer in 30 minutes it's filed as new, naming the possible duplicate. A new issue keeps the reporter's text as written; the model only fixes the title's spelling (or writes one when the title says nothing, like "bug") and copies the version and OS above the report, which code checks are the report's own words. Kira then asks once for what's missing (version, OS, steps, a log or screenshot); the replies go to the issue. Without the model (variable unset, `/kira-ai off`, budget spent, an API error) reports are filed as before. Each one is logged in #mod-log.
- **Moderation in every language** (`KIRA_AI_MOD`, on whenever `KIRA_AI` is; `KIRA_AI_MOD=0` turns it off): AutoMod would need regexes per language, so Kira's AI reads what the filters let through in the 🌍 languages channels, in #horizon-chat and #general (every message, any language), and non-English messages anywhere (another script, or common words of the server's other languages). Staff, bots and messages without letters are skipped, and so is anything a filter already removed. Messages of one channel that arrive within 4 seconds go in one Haiku call (10 at most). The rules from `config.js` are the cached first block of the user turn, the messages come after it as data (our own tags defused). The model returns JSON per message: `verdict` (ok, flag, remove), `category`, `rule`, `reason`, `english` (a translation), `language`; `checkModeration()` checks every field and drops the whole batch on any doubt.
  - **remove**, only for slurs, hate, threats, sexual content, doxxing, scams and targeted harassment (any other category is downgraded to a flag): the message is deleted, the usual short note is posted for 12 seconds in the member's language (English, or one of the eleven language channels' languages), and #mod-log gets the original, the English translation, the rule and the model's reason. From the second removal in a day, the spam timeout ladder applies (10 min, 1 h, 1 day).
  - **flag**: nothing is deleted; #mod-log gets the original, the translation and a jump link, and a mod decides.
  - Nothing else is ever done on the model's say: no bans, no warnings, no roles. Budget spent, the API down (the check pauses 5 minutes after an error) or switched off: nothing is read and the filters still run.
  - **Cost, measured** on 50 real messages from the language channels and #off-topic, before it merged into #general (`node scripts/measure-ai-mod.mjs`, read-only): $0.00009 per message (36 calls; the ~2K-token rules block read from cache, ~140 output tokens a call). 10,000 messages a day would cost about $0.90 of the daily budget.
- **Off switch:** `/kira-ai off` (Ludovic and the mods) stops all of it (answers, bug reports, moderation) at once, `/kira-ai mod off` only the moderation (`mod on` restarts it), `/kira-ai on` restarts it, and `/kira-ai status` shows the day's use. Removing `KIRA_AI` (or setting it to `0`) turns it off for good.
- **Variables:** `KIRA_AI`, `ANTHROPIC_API_KEY` (1Password `Horizon Claude API Key ludo47j`, set on Railway with the CLI, never printed), `KIRA_AI_DAILY_USD`, `KIRA_USAGE_TOKEN`, `KIRA_AI_BUGS`, `KIRA_AI_MOD`.
- **Cost, measured** on 38 real questions from the server's history: $0.0013 per answer with Haiku and a warm cache. The 21K-token sources block is cached for an hour as the first block of the user turn: a breakpoint on the system prompt was never read back on this account.

## Game chat

`POST /game/ask` (`src/features/game.js`, rules and checks in `src/game-kit.js`): `Authorization: Bearer <server token>`,
body `{ "player": "<Minecraft name>", "question": "kira why …" }` (the `kira`/`@kira` prefix is optional), answer
`{ "answer": "…" }` (empty: say nothing). The token names the server; a body can't claim another.

- **Tokens**, one per server, in `data/game-servers.json` (never usable for MCP). Kira issues one and **DMs it to the
  server's owner herself**, so it is never printed anywhere: with the admin routes on (see Hosting),
  `node scripts/admin.mjs game-token https://mcp.playhorizon.dev '{"action":"issue","server":"<address>","owner":"<discord id>","deliver":"dm"}'`
  answers its id only; a failed DM revokes it at once. `{"action":"list"}`, `{"action":"revoke","id":"…"}`;
  `"deliver":"response"` gives a test token for a day. From a shell on the host, `scripts/game-token.mjs` does the same.
- **Limits** (`GAME` in `src/game-kit.js`): 20 questions per player an hour (then "ask me again a bit later"), 60 per
  server an hour and 200 a day (then nothing in chat); failed logins per address like the other routes; and the AI's
  daily budget.
- **Rules**: her Discord rules (only what works in a release, no dates or promises, no piracy), then game chat's: 240
  characters, plain text, playful is fine, server questions go to its staff, passes point to Horizon's Discord. A
  question AutoMod's piracy or scam rules would block, or the moderation model would remove, gets "I'm not answering
  that one."; a reply that fails the checks becomes the pass line.
- **Log**: one line per question in #mod-log (`🎮 Kira answered in game`): server, player, question, reply, model, cost.

## Hosting (Railway)

Kira runs on Railway (project **kira**, service **kira**, volume `kira-data` at `/data`: `state.json`,
`board.json`, `agents.json`, `seal-key.pem`, `ai-sources.json`, `github-etags.json`: the GitHub clients' ETag caches, saved every 5 minutes and on SIGTERM so a deploy starts with conditional reads; `KIRA_GITHUB_ETAGS`), built from this repo's `Dockerfile` on every push to `main`.
Variables: `KIRA_STATE=/data/state.json`, `DISCORD_TOKEN_SEALED`, `GITHUB_TOKEN_SEALED`, `GITHUB_APP_ID` +
`GITHUB_APP_PRIVATE_KEY_SEALED` (the GitHub App kira-horizon: Kira's own hour of calls; `/sponsor` keeps
`GITHUB_TOKEN`; key in 1Password `GitHub App Kira`, a document: `op document get`),
`ROADMAP_SUGGESTIONS_CHANNEL_ID`,
`KIRA_AGENT_ISSUANCE` (`on` opens `/agent connect`), and for tests `KIRA_DISCORD=off` (no Discord: board and
MCP server only) and `KIRA_GITHUB_DRY_RUN=1`. Health: `GET /health`.

- **A secret changes**: `~/fleet/op read "op://Agents/<item>/credential" | node scripts/seal.mjs https://mcp.playhorizon.dev/seal-key`,
  then set the printed blob as `<NAME>_SEALED`. A new volume means a new key: seal again.
- **Moving Kira's files** (state.json, agents.json): the admin routes are off. For a move, set
  `KIRA_ADMIN_TOKEN_SHA256` to `~/fleet/op read "op://Agents/Kira admin token/credential" | tr -d '\n' | sha256sum`
  (the hash only), then `node scripts/admin.mjs backup|restore <host>` with the
  admin token (`op://Agents/Kira admin token/credential`; Railway only has its SHA-256 in
  `KIRA_ADMIN_TOKEN_SHA256`). A restore replaces the files and restarts the service on them. Empty the variable again afterwards.
- **Setup** (`npm run setup`): back up, run setup on the ThinkPad against the backup's state
  (`KIRA_STATE=… npm run setup`), restore it. Setup only touches Discord and its own keys of the state.
- **Rollback to the ThinkPad**: back up from Railway, set `KIRA_DISCORD=off` on Railway (or remove the
  service), put the backup's `state` and `agents` in `~/code/kira/data/state.json` and `data/agents.json`,
  `systemctl --user enable --now kira`. The unit stays installed there, disabled.

## The hub

One place where the work is written (the horizon repo: `roadmap/roadmap.toml`, issues for bugs only, pull requests
labelled `roadmap:<id>`, a generated journal), one public entry point (<https://playhorizon.dev/hub>), one intake:
a bug becomes a GitHub issue wherever it comes from, an idea goes to the suggestion queue (never an issue), and the
answer goes back where the request came from. Kira is that intake on Discord ([`src/hub.js`](src/hub.js) has no
Discord, [`src/features/hub.js`](src/features/hub.js) does the talking):

| Verb | Slash command | `@Kira …` | What happens |
| --- | --- | --- | --- |
| report | `/report` (a form: title, steps, what happened and what you expected, version, OS/CPU/GPU) | `@Kira report` (a button that opens the form) | Kira makes a post in `#horizon-bugs` in the member's name (staff tag `via /report`, no ping) and sends it to GitHub like any other post: the member owns it, their replies become comments and the answers ping them there. 3 an hour per member, then the GitHub limits |
| roadmap | `/roadmap [area:]` | `@Kira roadmap [area]` | the whole roadmap: one embed per area in the roadmap's order, its items by Now, Next, Later and Help wanted as titles linked to `<hub>#<id>`, Shipped as a count; several messages (the first answers, the others follow in the same place). With an area: every item of that area in plain words, shipped ones too. No dates |
| claim | `/claim issue:` | `@Kira claim 123` | the work board's claim (below) |
| status | `/status [of:] [text:] [clear:]` | `@Kira status [#123 \| item]` | yours (status text, claims, reports and their state), a card of the board, or a roadmap item; `text:` sets what you are on (agents and `/working` show it) |

Ideas reach the queue only as `#horizon-ideas` posts (Ludovic, 2026-10-30: `/suggest` and `@Kira suggest` are gone;
`@Kira suggest` now answers with a pointer to the forum). A post in `#horizon-ideas` that follows its template goes to
the queue once (`state.suggestions`, an embed with who and a link back), and Kira says so in the post with the
roadmap's link; ideas sent to GitHub before keep their issue, votes line and answers. A mod's
`/issue` in an idea post still opens an issue by hand.

**What Kira reads.** The website publishes the roadmap as JSON at `HUB_ROADMAP_URL` (default
`https://playhorizon.dev/data/roadmap.json`): `{ "areas": [{ "id", "name" }], "items": [{ "id", "title", "status",
"area", "plain", "dev", "links", "shipped_in"?, "focus"? }] }`, the fields of `roadmap.toml`. Fetched at most every 5
minutes; a failed fetch keeps the last good one, and with none Kira answers with the hub's link. Item links are
`<hub>#<id>`.

**Variables**: `ROADMAP_SUGGESTIONS_CHANNEL_ID` (the queue: the ID of the staff-only `#roadmap-suggestions` setup makes; unset: `#horizon-ideas` posts stay in the
forum), `HUB_URL`, `HUB_ROADMAP_URL`, `HUB_JOURNAL_URL`.

**Open idea issues** (the one-off move to the roadmap): `node scripts/idea-issues.mjs [--json]` lists them (number,
👍 on Discord, age, from Discord or GitHub, title, link). It only reads; each one is moved to the roadmap or closed
with a link to it by hand.

## GitHub issues

When a post in `#horizon-bugs` passes its template (at once, or after an edit), or a member sends `/report`,
Kira opens an issue in `horizon-rust/horizon`. The mapping is in `GITHUB` in [`src/config.js`](src/config.js);
the code is [`src/features/github.js`](src/features/github.js) and [`src/issuekit.js`](src/issuekit.js).

- **The issue**: the post's title; the post quoted (no HTML, `@mentions`, `#refs`, issue links or
  closing keywords survive), the poster's display name, the thread link, attachments as links
  (Discord's links expire; the thread keeps the files); labels `bug` / `enhancement` and
  `from-discord` (created if missing). Ideas carry a `👍 N on Discord` line, updated every 30 minutes.
- **Once per post**: the post → issue mapping is in `data/state.json` (`github.issues`), so restarts
  and edits never open a second issue. At most 3 issues per member and 20 in all per hour; beyond
  that Kira tells `#mod-log` and a mod can use `/issue`.
- **Follow-ups**: the poster's later replies in the post become one issue comment at most every
  10 minutes ("+1", "same", thanks and emoji-only replies are skipped). Nobody else's replies go.
- **Answers** (polled every 5 minutes, one request per repo): the issue closed as completed ("Fixed
  in <release>" when the closing commit or merged PR is in a release, else "Fixed"; the post gets its
  done tag and is archived), closed as not planned or duplicate (with the comments that explain why),
  or a comment from ludovic111 or a collaborator. Kira replies in the post and pings the poster alone
  (no ping if they left the server); comments within 10 minutes come as one message. Archived posts
  are unarchived to answer, then archived again. `notifyByDm: true` in the config also DMs them.
- **`/issue`** (mods, in a forum post): sends the post by hand (`repo:` and `kind:` when the forum or
  tags don't say); `/issue link:<number>` links the post to an existing issue instead (duplicates).
- **Dry run**: `KIRA_GITHUB_DRY_RUN=1` logs every write (issues, comments, labels, Discord replies)
  instead of doing it, and keeps nothing in the state. It also works without a token (public repos).
- **Tests**: `npm test` (recorded GitHub answers, no network).

Kira's issues and comments appear under the token owner's name (ludovic111); its own comments carry a
hidden `<!-- kira -->` marker so they're never relayed back.

### Turning it on (or renewing the token)

It's on: the token (fine-grained, the seven repos, Issues read/write and Contents read, expires
2027-10-13) is `op://Agents/GitHub Kira issues/credential`, in `.env.op`. Without `GITHUB_TOKEN` the feature is off: Kira logs `github issues: off` and runs as before. Never
give it the desktop's `gh` login: that token can do everything.

1. Create a **fine-grained** token at <https://github.com/settings/personal-access-tokens/new>:
   name `Kira issues`, resource owner `ludovic111`, an expiry you'll remember (1 year), **Only select
   repositories**: horizon, lsuite, ryolune, kimchi, nori, folio, DISPO. Repository permissions:
   **Issues: Read and write**, **Contents: Read-only** (for release lookup; Metadata: Read-only is
   added by itself). Nothing else.
   Since 2026-10-27 Horizon's repos are in the `horizon-rust` organisation: a token whose resource owner is `ludovic111`
   can no longer reach `horizon-rust/horizon`; it needs `horizon-rust` as resource owner (and the org must allow it).
2. In 1Password, vault **Agents**, a new **API Credential** item named `GitHub Kira issues` with the
   token in its `credential` field (`op://Agents/GitHub Kira issues/credential`).
3. Only then add it to `.env.op` (before the item exists, `op run` fails and Kira can't start):

       GITHUB_TOKEN="op://Agents/GitHub Kira issues/credential"

   commit, push, and deploy on the ThinkPad:
   `cd ~/code/kira && git pull --ff-only && npm ci && systemctl --user restart kira`.
4. `journalctl --user -u kira -n 30` should say `github issues: on, 0 posts linked`.

To try it first without writing anything, add `Environment=KIRA_GITHUB_DRY_RUN=1` with
`systemctl --user edit kira`, restart, and read the journal. Test end to end in a staff-only forum
post (`/issue repo:horizon`), with a throwaway issue labelled `test`, closed afterwards.

## Discord brand assets

The Discord server's and Kira's images live here, not in the horizon repo (which holds only the game, the launcher and
the website). Moved from horizon's `docs/media/brand` on 2026-10-15.

| File | What | Made from |
|------|------|-----------|
| `assets/horizon-icon.png` | the server icon | `rsvg-convert -w 512 -h 512 ~/code/horizon/docs/media/brand/avatar.svg` |
| `assets/kira-avatar.svg` | Kira's avatar, master: Horizon's mark on violet, so Kira reads apart from the project | |
| `assets/kira-avatar.png` | Kira's avatar | `rsvg-convert -w 512 -h 512 assets/kira-avatar.svg` |
| `assets/discord-banner.html` | the server banner, as a page (uses the mark and fonts from a horizon checkout next to this one) | |
| `assets/discord-banner.png` | the server banner, 960×540 (needs boost level 2) | a 960×540 Playwright screenshot of the page |

Uploading (Ludovic's accounts): server icon and banner in *Server Settings › Server Profile*; Kira's avatar in
discord.com/developers/applications › Kira › *Bot* (the running bot also applies both icons when they change).

## Staff dashboards

Two dashboards on the website, each behind a password its member sets: **playhorizon.dev/staff/team** (🌌 Horizon
Team) and **playhorizon.dev/staff/mod** (🛡️ Mod); Ludovic sees both. Applications for Mod, Support and the Team are
a form at playhorizon.dev/apply. Who owns what between the dashboards and the Discord side:
[`docs/staff-api.md`](docs/staff-api.md).

- **Passwords and sessions** ([`src/staff-auth.js`](src/staff-auth.js)): scrypt hashes; one-time links (30 minutes to
  set a password, 24 hours to apply) and sessions (12 hours idle, 7 days at most) are kept as SHA-256 only.
- **The file** ([`src/staff-store.js`](src/staff-store.js)): `/data/staff.json` (`KIRA_STAFF`), mode 600, written
  only by the bot. Before the first write of each day the file is copied to `/data/staff-backups/staff-<date>.json`
  (mode 600, the last 7 days kept). A file Kira can't read stops the staff side with a message; nothing else of
  Kira stops.
- **Restoring a backup**: `railway ssh --project kira --service kira` (it needs an SSH key on the Railway account
  first: `railway ssh keys add`, Ludovic's call), then
  `ls -l /data/staff-backups/` and `cp /data/staff-backups/staff-<date>.json /data/staff.json`, then restart the
  service (`railway redeploy --service kira` or the dashboard). Everything since that copy is lost (sessions,
  decisions, applications), and members whose password was set later need a new link.
- **Getting in**: `/staff password` (Team and Mods; `member:` sends it to another of them) DMs a one-time link
  `playhorizon.dev/staff/setup#…`; the username is the Discord username. Losing the role, or leaving, removes the
  password and ends the sessions at once (and at start, for what happened while Kira was away).
- **Counters** ([`src/staff-counters.js`](src/staff-counters.js)): per day, counts only (messages, distinct authors,
  joins, leaves, reports, mod-mail threads, warns, timeouts, kicks, bans, AutoMod blocks), 120 days kept.
- **Variables**: `STAFF_PROXY_KEY` (the same secret as the site's, `op://Agents/Horizon staff proxy key/credential`;
  unset: no `/staff/api` routes at all), `STAFF_SITE_URL` (default `https://playhorizon.dev`: the Origin writes must
  come from, and the links' host), `KIRA_STAFF` (the file).
- **Applications** ([`src/applications.js`](src/applications.js), routes in
  [`src/features/staff-apply.js`](src/features/staff-apply.js)): the form at playhorizon.dev/apply opens with the
  link `/apply` DMs (24 hours, once, for one role); Kira records the answers and what GitHub says about the member
  (their linked login, whether `/verify-github` proved it, their merged pull requests in Horizon: verified
  contributors are listed first). Then a vote on the dashboards ([`src/application-votes.js`](src/application-votes.js)):
  Mods vote on Mod and Support applications (shown on /staff/mod), the Team on Team and Support ones (/staff/team);
  For / Against (with a comment) / Abstain, blind until you vote (then the others' ballots show; Ludovic sees only the counts and the Against comments, without names, until it closes), changeable until
  it closes, recusal; quorum max(2, ceil(40% of
  the voters active in the last 30 days: logged in or acted)); it passes with 2/3 of For and Against; it closes 72 h
  after the first ballot or once every active voter voted; without quorum it is extended once by 48 h, then Ludovic
  decides. A decline goes out at once; a pass opens Ludovic's 12-hour veto window (one DM), after which the Discord side
  grants the role and DMs (`docs/staff-api.md`). Ludovic can veto at any time before that, approve early, and take
  the role back later. A Team accept grants only the Discord role: GitHub organisation or team access stays his, by
  hand. Every step is in the append-only audit log (`audit` in staff.json). Answers are deleted 90 days after the
  decision; a decline keeps only its member, role and date, for the 14-day cooldown.
- **The Team dashboard's data** ([`src/team-data.js`](src/team-data.js), routes in
  [`src/features/staff-team.js`](src/features/staff-team.js)): the decisions log (who, what, when, a link, a roadmap
  item; an edit keeps the previous version, a withdrawn decision stays listed), the Team kanban (To do, Doing, Done:
  coordination that is not a GitHub issue), and the roadmap's Team layer: notes on public items (owner, priority,
  note) and **Team-only items**, which stay in staff.json. "Publish" gives the item's `roadmap.toml` entry for a
  person or an agent to propose in a pull request to horizon; when the website's roadmap.json lists the id, the item
  is marked public. Kira never writes to the public repo for this. The work board is shown read-only (moves stay
  `/move` and the MCP tools).
- **Statistics** ([`src/team-stats.js`](src/team-stats.js), fetched by
  [`src/features/staff-stats.js`](src/features/staff-stats.js) a minute after start and then every hour, through
  GraphQL's own budget, ~2.5 minutes a round): for the Team, the last 12 weeks of horizon's pull requests (opened and
  merged per week and per person, median hours to the first review by someone else and to merge, the share reviewed),
  the open ones' CI state, open bugs (by area label, by source, crucial), pull requests per roadmap item (their
  `roadmap:<id>` label), game and launcher releases per week, and Discord activity from the counters. For the Mods,
  the moderation counters per week and over 7 and 30 days, and the applications waiting. Only public GitHub data
  and counts; a failed round keeps the last numbers.
- **Working on the pages**: `node scripts/staff-dev.mjs` serves the staff API with fake members, applications,
  decisions and made-up stats on 127.0.0.1 (no Discord, no GitHub, a fresh store in a temporary folder) and prints how
  to point horizon-site's `serve.mjs` at it, the test logins, a password link and an application link.
