# kira

The bot of **Horizon**'s Discord server (Minecraft Java Edition rewritten in Rust, <https://playhorizon.dev>).
Since 2026-10-14 the server is about Horizon only: everything else (music, AI coding, Ludovic's other
projects) is talked about in #off-topic. Free: it runs on `ludothinkpad`, no paid bot.

## The server

`npm run setup` makes the server match [`src/config.js`](src/config.js):

- **Categories**: 👋 start here (welcome, #new-members, rules, FAQ, announcements) · 🌅 horizon (#horizon-info,
  #horizon-chat, #horizon-bugs, #horizon-ideas, #showcase for videos/clips/screenshots/builds made in Horizon,
  #releases, #work-board, #dev-log) · 💬 general (#general, #introductions, #off-topic, #memes, #hall-of-fame,
  #bot-commands) · 🔊 voice · 🛡️ staff. The old channels (#projects, #resources, #help, #beats, …) were deleted
  on 2026-10-14 after their messages were exported (`scratch/deleted-channels-2026-10-14/`, not committed).
- **Forums** each have post guidelines, a template, required tags (some only mods set), a minimum time
  between posts. Kira checks every new post against the template. Each forum with a template also has
  ONE locked, pinned **📌 How to post here: read me first** post (guide, template, rules). It is Kira's own
  post: never checked against the template, no reactions, never a GitHub issue, `/done` refuses it.
- **Roles** (top to bottom): kira · 👑 ludovic · 🛡️ Mod · 🧪 Horizon Tester · 💎 Booster · lvl 50 → lvl 5 ·
  🛠️ Contributor · 🧩 Modder · 📣 Big news · 📦 Releases.
- **Onboarding** (2 questions when you join: what brings you to Horizon, which pings; the default
  channels, `DEFAULT_CHANNELS` in `config.js`, include #new-members) and the
  **Server Guide** (Discord's newcomer home; bots get "Bots cannot use this endpoint", so Ludovic applies it
  by hand in Server Settings → Onboarding: setup writes the wanted body to `state.serverGuide`), the server icon
  (`assets/horizon-icon.png`, the website's favicon.svg at 512 px; uploaded again only when it changes),
  the same roles as buttons in `#welcome`, Community mode, **rules screening** (new members read and agree to
  the rules before they can talk: one TERMS field with each rule as "Title. first sentence", built from `RULES`
  by [`src/screening.js`](src/screening.js) and sent by setup, which only ever turns it on), Discord AutoMod rules,
  a permanent invite.

Run it again after changing `config.js`: it updates what it made (IDs in `data/state.json`), moves
channels, and deletes the empty categories it made earlier. If the IDs are ever lost it finds its
channels, roles, messages, guides and posts again by name instead of making new ones, and it stops if it finds
two copies of the same thing. The bot and setup each keep to their own keys in `state.json`, so running
setup while Kira is up is safe; restart Kira afterwards so it knows the new channels.

## What kira does

| | |
| --- | --- |
| Moderation | Floods / copy-paste → messages deleted, timeout of 10 min, then 1 h, then 1 day the same day. All-caps, emoji walls and executables removed. Accounts under 3 days can't post links. Raids (15 accounts younger than 7 days in 2 minutes) → raid mode for an hour: verified phone, DMs between members paused. Automatic slowmode on channels too fast to read. Verification level high (10 minutes on the server before talking); @everyone can't ping everyone, open threads or use outside apps. `/warn` (3 in 30 days → 1 h timeout), `/warnings`, `/clearwarnings`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/raidmode` |
| Logs (`#mod-log`) | Joins (account age, **which invite**) and leaves grouped every minute, deleted and edited messages, nicknames, bans, timeouts, AutoMod |
| Reports | `/report` and "Report to mods" (right-click a message → Apps) → `#reports` |
| Mod-mail | DM kira → a thread in `#mod-mail`; mods answer in the thread (`//` for notes, `//close`) |
| Levels | XP for messages (once a minute) and for voice time with others; lvl 5/10/20/30/50 roles; `/rank`, `/leaderboard`, `/givexp` |
| Voice rooms | Join **➕ create your room** → your own channel; `/room lock / unlock / private / public / invite / kick / limit / rename / claim / transfer`; deleted when empty. **🎙️ ludovic** is locked: people wait in **⏳ waiting room** and Ludovic or a mod `/pull`s them in |
| Forums | Each new post is checked against its template; Kira lists what's missing and closes it after an hour if it's still missing. `/done` closes your post with its tag (solved, taken, found, filled, done) |
| Community | Welcome in `#new-members` (grouped when many people arrive), role buttons, 👍/👎 on ideas, 🔥 in #showcase, ⭐ hall of fame (5 stars), `/remind` |
| GitHub issues | Posts in `#horizon-bugs` and `#horizon-ideas` that pass their template become issues in ludovic111/horizon; answers on GitHub come back to the post, pinging the poster. `/issue` (staff). Off until its token exists: see below |
| Releases | Published releases of ludovic111/horizon → `#releases`: the game (`v…` tags, a summary of New and Fixed) and the launcher (`launcher-v…`), nothing else (REST API every 3 minutes, each release once by id; drafts and prereleases never; [`src/releases.js`](src/releases.js)). Hand-written posts: `ONE_OFFS` in `config.js`, each posted once |
| Work board | The kanban in `#work-board`, `#dev-log`, `/claim`, `/unclaim`, `/working`, `/board`, `/move`, `/link-github`: see below |
| Info | `/links`, `/horizon`, `/roadmap`, `/userinfo`, `/serverinfo`, `/avatar`, `/modmail` |

## Running it

Discord app **kira** (application ID `1559239271271891004`, private bot; Server Members and Message
Content intents), owned by Ludovic's account. Token: `op://Agents/Discord bot Kira/credential`.

    npm ci
    ~/fleet/op run --env-file .env.op -- npm run setup     # layout, once and after config changes
    systemctl --user restart kira                           # the bot (deploy/kira.service)
    journalctl --user -u kira -f

Install the unit with `ln -s ~/code/kira/deploy/kira.service ~/.config/systemd/user/`.

## Work board

`#work-board` is Horizon's kanban: Kira's guide (posted by setup), then **one pinned message per column**,
Backlog · To do · In progress · Review · Done, edited in place after every refresh (every 10 minutes, after
each command, and 30 s after someone posts a link to a Horizon issue or pull request). Each card is one line:
the issue or pull request (link), who is on it (🔨 = claimed on Discord), its labels, its pull requests and
their status (draft, CI, review), and when.

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
- **`#dev-log`**: one line, no pings, per pull request opened or merged, per claim, unclaim, lapse and move.
- **For other programs** (the coming agent/MCP feature): [`src/board.js`](src/board.js) has no Discord and no
  network: `build(github, work)` → `{ snapshot, stale }`, `list(snapshot, { column, person, kind })`,
  `find(snapshot, ref)`, `move(work, snapshot, ref, column, by)`, `assign` / `unassign` (claims). Each refresh
  writes the snapshot to `data/board.json` (`version`, `repo`, `generatedAt`, `columns[].cards[]` with `id`,
  `kind`, `number`, `title`, `url`, `state`, `column`, `auto`, `moved`, `people`, `claim`, `labels`, `prs`,
  `branches`). The claims and moves live in `state.work`.

The token needs **Issues: Read and write** on horizon (labels and comments). Pull requests, checks and
branches are read without a permission because the repo is public; if it ever goes private, add **Pull
requests: Read-only**, **Commit statuses: Read-only** and **Checks: Read-only**.

## GitHub issues

When a post in `#horizon-bugs` or `#horizon-ideas` passes its template (at once, or after an edit),
Kira opens an issue in `ludovic111/horizon`. The mapping is in `GITHUB` in [`src/config.js`](src/config.js);
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
