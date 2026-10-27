# Notes for Claude

Read the `firebase-github-pages-app` skill first, and `DESIGN.md`.

## Shared Firebase project: do not break Remimbers

This app lives in the `remimbers` Firebase project next to Remimbers (Hilmar's daily-use app).

- Firestore database is **`highlights`**. Deploy rules with `firebase deploy --only firestore:highlights --project remimbers`.
- Functions: prefix `hl_`, codebase `highlights`, deploy **only by name**: `--only functions:highlights:hl_name` (or `functions:hl_name`). Never a bare `--only functions`.
- Before and after every functions deploy run `firebase functions:list --project remimbers`. Remimbers' five (25 Oct 2026): `dryRunCards`, `ping`, `realtimeToken`, `transcribe`, `onNoteCreated`. They must still be there.
- Always pass `--project remimbers`.

## Prompts and tests

- Prompts are copied verbatim from `~/Projects/highlights-toy` (the answer key; see DESIGN.md §5). Change them there first, give the copy a new version name, never edit a shipped version.
- Storage rules: `firebase emulators:exec --project demo-cards --only firestore,storage "node scripts/rules-test.mjs"` before every deploy. Needs Java 21+ (the Mac's default is 19; a JDK 21 in /tmp works via JAVA_HOME). Port 8080 is taken on the Mac, so the Firestore emulator runs on 8085.
- Emulator ≠ production: cross-service rules (Storage reading Firestore) passed in the emulator and failed live for the named database. Anything new in rules: check it live right after deploying, with Hilmar.

## Shell

Use Desktop Commander (the Mac) for npm, git, firebase and gh.

- Hilmar's shell sets `NODE_ENV=production`, so plain `npm install` skips dev dependencies (no `tsc`, no `vite`). Use `NODE_ENV=development npm install --include=dev`, but `unset NODE_ENV` again before `vite build`, or the bundle comes out as a development build.
- Node: `~/.nvm/versions/node/v22.23.2/bin` (prepend to PATH; non-interactive shells don't load nvm).
- Mac git is 2.18: no `git init -b`, no `git switch`.
- Long commands (npm install, deploys): run detached with nohup, poll the log; the bridge times out at 60 s.

## Git

Deploy key at `.git/cards_deploy_key`, used via repo-local `core.sshCommand`. A plain `git push` works. A push to `main` ships the live site.
