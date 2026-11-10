# Contributing to Kira

Kira is the bot of [Horizon](https://playhorizon.dev)'s Discord server. Fixes and features are welcome.

## Before you start

- Look at the open issues and pull requests first, so two people don't do the same thing.
- For a new feature, open an issue (or ask in Horizon's Discord) before writing much code: the server's layout and
  moderation are decided by the project.
- Run your own bot on your own test server (below).

## Run it locally

Never use Horizon's bot token or server: make your own bot and an empty test server.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), add a bot,
   turn on the **Server Members** and **Message Content** intents, and invite it to your test server with the
   Administrator permission.
2. `cp .env.example .env` and fill in `DISCORD_TOKEN`, `GUILD_ID` (your test server) and `KIRA_OWNER_ID` (your user ID).
   `.env` is ignored by git; never commit it.
3. Node 20 or later (CI uses 22):

       npm ci
       npm test                                   # no network, no tokens
       node --env-file=.env src/setup.js          # builds the layout on your server; additive
       node --env-file=.env src/bot.js

Without Discord, `KIRA_DISCORD=off KIRA_HTTP_PORT=8787 node src/bot.js` starts only the work board and the MCP server.
More in [README → Run your own copy](README.md#run-your-own-copy).

## Tests

`npm test` (Node's built-in runner, `test/*.test.js`) and `npm run check` run on every pull request in GitHub Actions
(`.github/workflows/test.yml`; no secrets, so fork PRs run it too). A first-time contributor's run waits for a
maintainer's approval. Both must be green to merge.

## Flags

A new feature ships **off by default**, behind an environment variable (like `KIRA_GOVERNANCE=on`, `KIRA_ELECTIONS=on`,
`KIRA_AI=1`): with the flag unset, Kira behaves exactly as before. Test both states. A maintainer turns it on after
review.

## Pull requests

- Keep them small and on one topic.
- `npm test` must pass. Add a test for what you change: most logic lives in pure `src/*-kit.js` modules so it can be
  tested without Discord (`test/*.test.js`, Node's built-in test runner).
- `npm run check` must pass (syntax of every source file).
- User-facing text goes in `src/texts.js` or `src/config.js`, next to the texts like it.
- No secrets, tokens, real members' messages, IDs paired with moderation data, or exports of the server in commits.
  Test data uses made-up users (`111111111111111111`, `sam`).
- Never add a code path that sends a member's messages or data to a new outside service.
- Say so if an AI agent wrote the pull request: its first line is
  `> 🤖 Opened by <login>'s AI agent (<tool, model>), not by <login> personally.`

## Review and deploy

**Every merge to `main` deploys Kira live to Horizon's server** (Railway, within minutes), so only maintainers merge.
Changes are reviewed by the Horizon Team or the council (see
[GOVERNANCE.md](https://github.com/horizon-rust/horizon/blob/main/GOVERNANCE.md) in horizon-rust/horizon). `main`
needs a pull request and a green `test` check.

## Security

Found a way to get past Kira's checks (the admin, staff or MCP routes, token handling, moderation)? Don't open a
public issue: tell a maintainer privately on Horizon's Discord, or use GitHub's private vulnerability reporting on
this repository.

## Licence

Contributions are MIT: by contributing you agree that your contribution is released under the [MIT licence](LICENSE).
