# Notes for Claude

Read the `firebase-github-pages-app` skill first, and `DESIGN.md`.

## Shared Firebase project: do not break Remimbers

This app lives in the `remimbers` Firebase project next to Remimbers (Hilmar's daily-use app).

- Firestore database is **`highlights`**. Deploy rules with `firebase deploy --only firestore:highlights --project remimbers`.
- Functions: prefix `hl_`, codebase `highlights`, deploy **only by name**: `--only functions:highlights:hl_name` (or `functions:hl_name`). Never a bare `--only functions`.
- Before and after every functions deploy run `firebase functions:list --project remimbers`. Remimbers' five (25 Oct 2026): `dryRunCards`, `ping`, `realtimeToken`, `transcribe`, `onNoteCreated`. They must still be there.
- Always pass `--project remimbers`.

## Shell

Use Desktop Commander (the Mac) for npm, git, firebase and gh.

- Hilmar's shell sets `NODE_ENV=production`, so plain `npm install` skips dev dependencies (no `tsc`, no `vite`). Use `NODE_ENV=development npm install --include=dev`.
- Node: `~/.nvm/versions/node/v22.23.2/bin` (prepend to PATH; non-interactive shells don't load nvm).
- Mac git is 2.18: no `git init -b`, no `git switch`.
- Long commands (npm install, deploys): run detached with nohup, poll the log; the bridge times out at 60 s.

## Git

Deploy key at `.git/cards_deploy_key`, used via repo-local `core.sshCommand`. A plain `git push` works. A push to `main` ships the live site.
