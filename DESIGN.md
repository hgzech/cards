# Cards — design

Test app for the Highlights spin-off of Remimbers: photograph a page you marked while reading, get flashcards. **Goal of this stage: find out whether marking pages produces good cards.** No review, no coupling to Remimbers. Users: Hilmar and one friend.

Background and the marking system: `~/Notes/Remimbers/Highlights spin-off.md`. Plain-language explanations: `Highlights concepts.md` next to it.

## 1. Where things live

| piece | where |
|---|---|
| Website | GitHub Pages, `hgzech.github.io/cards`, repo `hgzech/cards` (public) |
| Sign-in | Firebase Auth (Google) of the `remimbers` project, shared with Remimbers |
| Data | Firestore database **`highlights`** (europe-west3) in the `remimbers` project |
| Photos | Firebase Storage, bucket `remimbers.firebasestorage.app`, under `highlights/` (next step) |
| Model calls | Cloud Functions prefixed `hl_`, codebase `highlights` (next step) |

**Why the shared project:** it is already on Blaze with the APIs enabled and `hgzech.github.io` authorised for sign-in, so setup cost nothing. The price is a shared function namespace, so three rules (also in `CLAUDE.md`):

1. Own database (`highlights`), with its own rules and invite list. Deletable as a whole.
2. Functions prefixed `hl_` and in their own codebase `highlights`, so a deploy from this repo cannot delete Remimbers' functions.
3. Functions always deployed by name. Check `firebase functions:list` before and after.

## 2. Access

Own invite list: `allowlist/{email}` in the `highlights` database. Hilmar's entry has `role: owner`. Inviting someone = creating a document with their lowercase email as id (console for now). Rules: you can read your own entry, only owners can list or change entries, and nobody can change their own. Everything a user owns sits under `users/{uid}/…`, readable and writable only by that signed-in, invited user.

## 3. Decisions so far

- **No PWA and no router yet.** A service worker's main effect in Remimbers was serving stale code after a deploy; this app has one screen. Add both when needed, with one shared base path.
- **No offline persistence.** Uploading needs the network anyway.
- **Model:** Gemini 3.5 Flash-Lite only, key in the secret `GEMINI_API_KEY` (the toy's key, $5 prepaid, which doubles as a hard spending cap).
- **Card fields (planned):** front, back, quote, upload id, model, prompt version. Prompt in one versioned file, copied from `~/Projects/highlights-toy/prompt.txt`.
- **Privacy:** parked until later (Hilmar, 25 Oct 2026).
