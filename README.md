# kira

The bot of Ludovic's Discord server, **ludovic's server**: the community around his videos, vibe
coding, his projects (Horizon, lsuite, DISPO, …) and rap (beatmakers and rappers). Free: it runs on
`ludothinkpad`, no paid bot.

## The server

`npm run setup` makes the server match [`src/config.js`](src/config.js):

- **Categories**: 👋 start here (welcome, rules, FAQ, announcements) · 💬 general (+ #resources) ·
  🛠️ ludovic's projects (Horizon first, the catalogue, #project-feedback, #releases) · 🤖 vibe coding
  (the community's projects, #help) · 🎬 creators (YouTubers, editors, thumbnail artists) · 🎤 music
  (beats, collabs, tracks) · 🔊 voice · 🛡️ staff. One place per purpose: no two channels do the same thing.
- **Forums** each have post guidelines, a template, required tags (some only mods set), a minimum time
  between posts, and a locked "📌 How to post here" post. Kira checks every new post against the template.
- **Roles** (top to bottom): kira · 👑 ludovic · 🛡️ Mod · 🧪 Horizon Tester · 💎 Booster · lvl 50 → lvl 5 ·
  🎶 Singer · 🎤 Rapper · 🥁 Beatmaker · 🧩 Modder · 🌅 Horizon · 🤖 Vibe coder · 📦 Releases · 🔔 Videos.
- **Onboarding** (3 questions when you join: what you're here for, what you make, which pings) and the
  **Server Guide** (Discord's newcomer home; bots can't set it, so it was applied from Ludovic's session:
  the body is in `state.serverGuide`),
  the same roles as buttons in `#welcome`, Community mode, Discord AutoMod rules, a permanent invite.

Run it again after changing `config.js`: it updates what it made (IDs in `data/state.json`), moves
channels, and deletes the empty categories it made earlier.

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
| Community | Welcome in `#general` (grouped when many people arrive), role buttons, 👍/👎 on suggestions and feedback, 🔥 on beats and community projects, ⭐ hall of fame (5 stars), `/remind` |
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
