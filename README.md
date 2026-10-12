# Kira

The bot of Ludovic's Discord server, **ludovic's server**: the community around his videos, AI coding,
Horizon (Minecraft rewritten in Rust) and his other projects (lsuite, DISPO, …). Free: it runs on
`ludothinkpad`, no paid bot.

## What it does

- **Setup** (`npm run setup`): makes the server match [`src/config.js`](src/config.js): roles, categories
  and channels with their permissions, Community mode, Onboarding (members pick their roles), the
  welcome / rules / Horizon posts, one post per project in `#projects`, Discord AutoMod rules (spam,
  slurs, mention spam, invites and fake Nitro) and a permanent invite. Run it again after changing
  `config.js`: it updates what it created (IDs in `data/state.json`).
- **Moderation**: floods (6 messages in 8 s) or the same message 3 times in a minute → messages deleted,
  10-minute timeout. Accounts younger than 3 days can't post links. `/warn` (3 warnings in 30 days →
  1-hour timeout), `/warnings`, `/clearwarnings`, `/purge`, `/slowmode`. Joins, leaves, deleted and edited
  messages, bans and timeouts are logged in `#mod-log`.
- **Feeds** (every 10 min): new videos on youtube.com/@lu4ovic → `#announcements` (pings 🔔 Videos);
  new GitHub releases of the public repos → `#releases` (pings 📦 Releases).
- **Community**: welcomes newcomers in `#general`; 👍/👎 on every post in `#horizon-suggestions` and
  `#feedback`; `/links`, `/horizon`, `/roadmap`, `/projects`.

## Running it

Discord app **Kira** (application ID `1559239271271891004`, private bot, Server Members and Message
Content intents), owned by Ludovic's account. Its token is in 1Password: `op://Agents/Discord bot Kira/credential`.

    npm ci
    ~/fleet/op run --env-file .env.op -- npm run setup     # layout, once and after config changes
    systemctl --user enable --now kira                      # the bot (deploy/kira.service)
    journalctl --user -u kira -f

Install the unit with `ln -s ~/code/kira/deploy/kira.service ~/.config/systemd/user/`.
