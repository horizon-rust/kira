# Contributing to Kira

Kira is the bot of [Horizon](https://playhorizon.dev)'s Discord server. Fixes and features are welcome.

## Before you start

- Look at the open issues and pull requests first, so two people don't do the same thing.
- For a new feature, open an issue (or ask in Horizon's Discord) before writing much code: the server's layout and
  moderation are decided by the project.
- Run your own bot on your own test server: [README → Run your own copy](README.md#run-your-own-copy).

## Pull requests

- Keep them small and on one topic.
- `npm test` must pass. Add a test for what you change: most logic lives in pure `src/*-kit.js` modules so it can be
  tested without Discord (`test/*.test.js`, Node's built-in test runner).
- `npm run check` must pass (syntax of every source file).
- User-facing text goes in `src/texts.js` or `src/config.js`, next to the texts like it.
- No secrets, tokens, real members' messages, IDs paired with moderation data, or exports of the server in commits.
  Test data uses made-up users (`111111111111111111`, `sam`).
- Never add a code path that sends a member's messages or data to a new outside service.
- Pushing to `main` deploys Kira, so only maintainers merge.

## Security

Found a way to get past Kira's checks (the admin, staff or MCP routes, token handling, moderation)? Don't open a
public issue: tell a maintainer privately on Horizon's Discord, or use GitHub's private vulnerability reporting on
this repository.

## Licence

By contributing you agree that your contribution is released under the [MIT licence](LICENSE).
