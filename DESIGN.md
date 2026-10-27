# Cards — design

Test app for the Highlights spin-off of Remimbers: photograph a page you marked while reading, get flashcards. **Goal of this stage: find out whether marking pages produces good cards.** No review, no coupling to Remimbers. Users: Hilmar and one friend.

Background and the marking system: `~/Notes/Remimbers/Highlights spin-off.md`. Plain-language explanations: `Highlights concepts.md` next to it.

## 1. Where things live

| piece | where |
|---|---|
| Website | GitHub Pages, `hgzech.github.io/cards`, repo `hgzech/cards` (public) |
| Sign-in | Firebase Auth (Google) of the `remimbers` project, shared with Remimbers |
| Data | Firestore database **`highlights`** (europe-west3) in the `remimbers` project |
| Photos, PDF pages, PDFs | Firebase Storage, bucket `remimbers.firebasestorage.app`, under `highlights/` |
| Model calls | Cloud Function `hl_onUploadCreated`, codebase `highlights` |

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
- **Card fields:** front, back, quote, upload id, model, prompt version. Prompt in one versioned file, copied from `~/Projects/highlights-toy/prompt.txt`.
- **Privacy:** parked until later (Hilmar, 25 Oct 2026).

## 4. Upload → cards (built 25 Oct 2026)

1. Browser shrinks the photo to max 2048 px JPEG (same as the toy's `sips -Z 2048`) and stores it at `highlights/{uid}/{uploadId}.jpg`. Only the shrunk version is kept: it is exactly what the model saw, so re-runs are comparable.
2. Browser writes `users/{uid}/uploads/{uploadId}` with `status: 'pending'` and the photo path.
3. **`hl_onUploadCreated`** (Firestore trigger, europe-west3) fires, checks the path is inside that user's folder, sends the photo to Gemini with `functions/src/prompt.ts` (verbatim copy of the toy prompt, version `toy-1`), writes `users/{uid}/cards/{uploadId}_{i}` and sets the upload to `done` (with card count, cost, seconds) or `error`.
4. Browser listens to both collections and shows the cards as they land.

Why a trigger rather than an HTTP function: no CORS, no Cloud Run public-access step, no token check to get wrong, and it finishes even if the phone locks mid-upload. Only invited users can write step 2, so only they can make it spend money. Deterministic card ids, so a duplicate trigger overwrites instead of duplicating.

**Storage rules** (`storage.rules`, the bucket's only rules file): owner-only read; create-only with `resource == null` (no overwrite, no delete; until 27 Oct overwriting was in fact allowed), verified email, type and size limits per path (see §5). Tested with `scripts/rules-test.mjs` against the emulators. They do **not** check the invite list: the cross-service lookup (`firestore.exists` in the `highlights` database) passed in the emulator but was **denied in production** on 27 Oct 2026, most likely because production cross-service rules only reach the `(default)` database. Gap: an uninvited Google account could store files in its own folder, but could not make cards. If Remimbers ever uses Storage, its rules must be merged into this file.

Photos are shown with `getDownloadURL`. Those URLs carry a token and work for anyone who has the link. Acceptable for a two-person test.

**Verified 25 Oct 2026:** toy photo `photo02_bracket_1C.jpg` pushed through the deployed function as admin under test uid `claude-test` → 3 cards matching the toy's Flash-Lite output and `photos/expected.json`, 2.5 s, 0.11¢. (That test upload was deleted on 27 Oct.) Unauthenticated reads of cards, allowlist and photo all return 403.

## 5. PDF upload (built 27 Oct 2026)

**Convention** (decided with Hilmar): a **blue highlight** makes a card, and so does a circle drawn with the pen tool. A comment on that highlight, or a sticky note next to it, is the instruction ("1C", what to ask). Highlights in other colours, underlines etc. are reading marks. One highlight = one card even when it is long (the reader adds "3C" if they want more). Later the colour becomes a user setting.

**Flow:**
1. The browser opens the PDF with pdf.js (**legacy build**: the modern one needs the JS `Iterator` global, which Safari before 18.4 lacks) and finds the pages with a card mark. Only those are ever sent; a PDF without one is refused with a message. At most 50 marked pages per upload.
2. Each marked page is prepared by `src/lib/pdfpages.ts`, a port of the toy's `pdfpages.py`: other marks and sticky-note icons are hidden (pdf.js `annotationStorage` `noView`), the reader's comments, which a PDF stores as invisible text, are written into a white strip beside the page with a line to their mark. 150 dpi JPEG to `highlights/{uid}/{uploadId}/p{N}.jpg`: exactly what the model sees, kept so prompts can be re-run.
3. The original PDF goes to `highlights/{uid}/{uploadId}/original.pdf` if it is 30 MB or less (decided with Hilmar).
4. Upload doc with `kind: 'pdf'`, `pages: [{page, storagePath}]`, `pageCount`, `pdfPath`. `hl_onUploadCreated` sends the pages to Flash-Lite, 4 at a time, with prompt **`pdf-2`**; cards `{uploadId}_p{N}_{i}` carry the page number; failed pages are listed in `failedPages`.

**Known weakness (agreed):** "is it blue?" is decided in code by hue ranges (`HUES` in `pdfpages.ts`), not by a model. Clear colours are exact; a turquoise or blue-violet highlight could land on the wrong side. Possible later fix: a model turns the user's colour setting into something the code can use.

**Answer key:** `~/Projects/highlights-toy` (private repo `hgzech/highlights-toy`), `pdfs/` with `expected.json`. Prompt changes start there. To check this app's page preparation against it: `node scripts/render-pdf-pages.ts <dir> <pdfs>` (node) or `scripts/harness.html` + `node scripts/harness-run.mjs <dir>` (headless Chrome, with `npx vite --port 5179` running), then in the toy `run.py --as-pdf <dir>` and `score.py`.

**Verified 27 Oct 2026:** pages prepared by this code in node and in Chrome: 13/13 on the toy's key with `pdf-2` (twice). Live: Hilmar's Zotero export (`Peeters, 2012_b.pdf`, highlight comment "One card please.") → 1 card, 0.07¢, 2.5 s; a photo upload still works under the new rules. Not yet tried: a PDF from an editor other than Zotero, and iPhone.
