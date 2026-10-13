# kira

The bot of Ludovic's Discord server, **ludovic's server**: the community around his videos, vibe
coding, his projects (Horizon, lsuite, DISPO, …) and rap (beatmakers and rappers). Free: it runs on
`ludothinkpad`, no paid bot.

## The server

`npm run setup` makes the server match [`src/config.js`](src/config.js):

- **Categories**: 👋 start here (welcome, #new-members, rules, FAQ, announcements) · 💬 general (+ #resources) ·
  🛠️ ludovic's projects (Horizon first, the catalogue, #project-feedback, #releases) · 🤖 vibe coding
  (the community's projects, #help) · 🎬 creators (YouTubers, editors, thumbnail artists) · 🎤 music
  (beats, collabs, tracks) · 🔊 voice · 🛡️ staff. One place per purpose: no two channels do the same thing.
- **Forums** each have post guidelines, a template, required tags (some only mods set), a minimum time
  between posts. Kira checks every new post against the template.
- **Roles** (top to bottom): kira · 👑 ludovic · 🛡️ Mod · 🧪 Horizon Tester · 💎 Booster · lvl 50 → lvl 5 ·
  🎶 Singer · 🎤 Rapper · 🥁 Beatmaker · 🧩 Modder · 🌅 Horizon · 🤖 Vibe coder · 📦 Releases · 🔔 Videos.
- **Onboarding** (3 questions when you join: what you're here for, what you make, which pings) and the
  **Server Guide** (Discord's newcomer home; bots can't set it, so it was applied from Ludovic's session:
  the body is in `state.serverGuide`),
  the same roles as buttons in `#welcome`, Community mode, Discord AutoMod rules, a permanent invite.

Run it again after changing `config.js`: it updates what it made (IDs in `data/state.json`), moves
channels, and deletes the empty categories it made earlier. If the IDs are ever lost it finds its
channels, roles, messages and posts again by name instead of making new ones, and it stops if it finds
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
| Community | Welcome in `#new-members` (grouped when many people arrive), role buttons, 👍/👎 on suggestions and feedback, 🔥 on beats and community projects, ⭐ hall of fame (5 stars), `/remind` |
| GitHub issues | Posts in `#horizon-bugs`, `#horizon-ideas` and `#project-feedback` (project + bug/idea tags) that pass their template become issues; answers on GitHub come back to the post, pinging the poster. `/issue` (staff). Off until its token exists: see below |
| Feeds | New videos on youtube.com/@lu4ovic → `#announcements`; GitHub releases of the public repos → `#releases` |
| Info | `/links`, `/horizon`, `/roadmap`, `/projects`, `/userinfo`, `/serverinfo`, `/avatar`, `/modmail` |

## Running it

Discord app **kira** (application ID `1559239271271891004`, private bot; Server Members and Message
Content intents), owned by Ludovic's account. Token: `op://Agents/Discord bot Kira/credential`.

    npm ci
    ~/fleet/op run --env-file .env.op -- npm run setup     # layout, once and after config changes
    systemctl --user restart kira                           # the bot (deploy/kira.service)
    journalctl --user -u kira -f

Install the unit with `ln -s ~/code/kira/deploy/kira.service ~/.config/systemd/user/`.

## GitHub issues

When a post in `#horizon-bugs` or `#horizon-ideas` passes its template (at once, or after an edit),
Kira opens an issue in `ludovic111/horizon`. In `#project-feedback`, a post with a project tag and
the `bug` or `idea` tag goes to that project's repo (lsuite, ryolune, kimchi, nori, folio, DISPO;
DISPO is private, so Discord only sees `DISPO#N`, no link). The mapping is in `GITHUB` in
[`src/config.js`](src/config.js); the code is [`src/features/github.js`](src/features/github.js)
and [`src/issuekit.js`](src/issuekit.js).

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
