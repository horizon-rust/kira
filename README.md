# kira

The bot of Ludovic's Discord server, **ludovic's server**: the community around his videos, vibe
coding, his projects (Horizon, lsuite, DISPO, …) and rap (beatmakers and rappers). Free: it runs on
`ludothinkpad`, no paid bot.

## The server

`npm run setup` makes the server match [`src/config.js`](src/config.js):

- **Categories**: 👋 start here · 💬 general · 🤖 vibe coding (with the community's projects) ·
  🛠️ ludovic's projects (Horizon first) · 🎤 music (beats, collabs, tracks) · 🔊 voice · 🛡️ staff.
- **Roles** (top to bottom): kira · 👑 ludovic · 🛡️ Mod · 🧪 Horizon Tester · 💎 Booster · lvl 50 → lvl 5 ·
  🎶 Singer · 🎤 Rapper · 🥁 Beatmaker · 🧩 Modder · 🌅 Horizon · 🤖 Vibe coder · 📦 Releases · 🔔 Videos.
- **Onboarding** (3 questions when you join: what brings you here, what you do in music, which pings),
  the same roles as buttons in `#welcome`, Community mode, Discord AutoMod rules, a permanent invite.

Run it again after changing `config.js`: it updates what it made (IDs in `data/state.json`), moves
channels, and deletes the empty categories it made earlier.

## What kira does

| | |
| --- | --- |
| Moderation | Floods / copy-paste → messages deleted, 10 min timeout. All-caps removed. Accounts under 3 days can't post links. Raid detection (8 joins a minute → highest verification level). `/warn` (3 in 30 days → 1 h timeout), `/warnings`, `/clearwarnings`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/raidmode` |
| Logs (`#mod-log`) | Joins (account age, **which invite**), leaves, deleted and edited messages, nicknames, bans, timeouts, AutoMod |
| Reports | `/report` and "Report to mods" (right-click a message → Apps) → `#reports` |
| Mod-mail | DM kira → a thread in `#mod-mail`; mods answer in the thread (`//` for notes, `//close`) |
| Levels | XP for messages (once a minute) and for voice time with others; lvl 5/10/20/30/50 roles; `/rank`, `/leaderboard`, `/givexp` |
| Voice rooms | Join **➕ create your room** → your own channel; `/room lock / unlock / private / public / invite / kick / limit / rename / claim / transfer`; deleted when empty. **🎙️ ludovic** is locked: people wait in **⏳ waiting room** and Ludovic or a mod `/pull`s them in |
| Community | Welcome in `#general`, role buttons, 👍/👎 on suggestions and feedback, 🔥 on beats and community projects, a comment thread on each post in `#showcase` and `#tracks`, ⭐ hall of fame (5 stars), `/remind` |
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
