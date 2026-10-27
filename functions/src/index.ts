import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import {
  CARD_SCHEMA,
  PDF_PROMPT_VERSION,
  PDF_SYSTEM_PROMPT,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  USER_TEXT,
} from './prompt.js'

/**
 * Shares the `remimbers` Firebase project with Remimbers. Every function here
 * is named hl_* and lives in the `highlights` codebase (firebase.json), so a
 * deploy from this repo can never delete Remimbers' functions. Still: deploy
 * by name only, and check `firebase functions:list` before and after.
 */
const app = initializeApp()

/** Our own named database. Without this argument the admin SDK writes to '(default)'. */
const DATABASE_ID = 'highlights'
const db = getFirestore(app, DATABASE_ID)

const geminiKey = defineSecret('GEMINI_API_KEY')

/** One model for now. Prices per 1M tokens (checked 25 Oct 2026). */
const MODEL = { id: 'gemini-3.5-flash-lite', priceIn: 0.3, priceOut: 2.5 }

/** Most marked pages one PDF upload may send (~0.07¢ each). The browser enforces it too. */
const MAX_PDF_PAGES = 50
/** Pages sent to the model at the same time, per upload. */
const PDF_CONCURRENCY = 4

interface Card {
  front: string
  back: string
  quote: string
}

/** Raw fetch, no SDK. Same request as the toy's call_gemini, so the cards should match. */
async function callGemini(key: string, system: string, imageB64: string, mime: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL.id}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: imageB64 } }, { text: USER_TEXT }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: CARD_SCHEMA },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await res.json()) as any
  const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  const u = j.usageMetadata ?? {}
  const tokensIn: number = u.promptTokenCount ?? 0
  // Thinking tokens bill as output.
  const tokensOut: number = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
  const cards = (JSON.parse(text).cards ?? []) as Card[]
  return { cards, tokensIn, tokensOut }
}

const costOf = (tokensIn: number, tokensOut: number) => (tokensIn * MODEL.priceIn + tokensOut * MODEL.priceOut) / 1e6

/** One image in Storage -> cards. Refuses any path outside this user's own folder. */
async function cardsForImage(uid: string, path: string, mime: string, system: string) {
  if (!path.startsWith(`highlights/${uid}/`)) throw new Error('page path is not in your folder')
  const [buf] = await getStorage().bucket().file(path).download()
  return callGemini(geminiKey.value(), system, buf.toString('base64'), mime)
}

/** Run fn over items, at most `limit` at a time, keeping order. Never rejects. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        out[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * An upload document appeared -> make the cards.
 *
 * The browser has already put the image(s) in Storage and then written
 * users/{uid}/uploads/{uploadId} with status 'pending':
 * - a photo: `storagePath` (one image), prompt toy-1;
 * - a PDF (`kind: 'pdf'`): `pages: [{page, storagePath}]`, one prepared image per
 *   marked page (see src/lib/pdfpages.ts), prompt pdf-2.
 * This runs on the server, holds the API key, and writes the cards back.
 *
 * A trigger (rather than an HTTP endpoint the browser calls) means: no CORS,
 * no public-access setting, and card-making finishes even if the phone locks.
 * Only invited users can create the upload doc (firestore.rules), so only
 * they can make this spend money.
 */
export const hl_onUploadCreated = onDocumentCreated(
  {
    document: 'users/{uid}/uploads/{uploadId}',
    database: DATABASE_ID,
    region: 'europe-west3', // must match the database's region
    secrets: [geminiKey],
    maxInstances: 2,
    timeoutSeconds: 300, // a 50-page PDF at 4 pages at a time
    memory: '512MiB',
  },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const { uid, uploadId } = event.params
    const data = snap.data()
    const ref = snap.ref

    // Triggers can fire twice. Only a pending upload is processed.
    if (data.status !== 'pending') return
    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 100) / 10

    try {
      if (data.kind === 'pdf') {
        const pages = ((data.pages ?? []) as { page: number; storagePath: string }[]).slice(0, MAX_PDF_PAGES)
        const results = await pool(pages, PDF_CONCURRENCY, (p) =>
          cardsForImage(uid, p.storagePath, 'image/jpeg', PDF_SYSTEM_PROMPT),
        )
        const batch = db.batch()
        let cardCount = 0
        let tokensIn = 0
        let tokensOut = 0
        const failedPages: number[] = []
        results.forEach((r, k) => {
          const p = pages[k]
          if (r.status === 'rejected') {
            failedPages.push(p.page)
            logger.error('page failed', { uid, uploadId, page: p.page, err: String(r.reason) })
            return
          }
          tokensIn += r.value.tokensIn
          tokensOut += r.value.tokensOut
          r.value.cards.forEach((c, i) => {
            cardCount++
            // Deterministic ids: a second run of the trigger overwrites, never duplicates.
            batch.set(db.doc(`users/${uid}/cards/${uploadId}_p${p.page}_${i}`), {
              front: c.front,
              back: c.back,
              quote: c.quote,
              uploadId,
              storagePath: p.storagePath,
              page: p.page,
              index: i,
              model: MODEL.id,
              promptVersion: PDF_PROMPT_VERSION,
              createdAt: FieldValue.serverTimestamp(),
            })
          })
        })
        const allFailed = pages.length > 0 && failedPages.length === pages.length
        batch.update(ref, {
          status: allFailed ? 'error' : 'done',
          ...(allFailed ? { error: 'every page failed; see the function logs' } : {}),
          cardCount,
          failedPages,
          model: MODEL.id,
          promptVersion: PDF_PROMPT_VERSION,
          tokensIn,
          tokensOut,
          cost: costOf(tokensIn, tokensOut),
          seconds: seconds(),
          finishedAt: FieldValue.serverTimestamp(),
        })
        await batch.commit()
        logger.info('pdf cards made', { uid, uploadId, pages: pages.length, failedPages, cards: cardCount })
        return
      }

      // A photo: one image.
      const path: string = data.storagePath ?? ''
      const mime: string = data.contentType ?? 'image/jpeg'
      const { cards, tokensIn, tokensOut } = await cardsForImage(uid, path, mime, SYSTEM_PROMPT)
      const batch = db.batch()
      cards.forEach((c, i) => {
        // Deterministic ids: a second run of the trigger overwrites, never duplicates.
        batch.set(db.doc(`users/${uid}/cards/${uploadId}_${i}`), {
          front: c.front,
          back: c.back,
          quote: c.quote,
          uploadId,
          storagePath: path,
          index: i,
          model: MODEL.id,
          promptVersion: PROMPT_VERSION,
          createdAt: FieldValue.serverTimestamp(),
        })
      })
      batch.update(ref, {
        status: 'done',
        cardCount: cards.length,
        model: MODEL.id,
        promptVersion: PROMPT_VERSION,
        tokensIn,
        tokensOut,
        cost: costOf(tokensIn, tokensOut),
        seconds: seconds(),
        finishedAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()
      logger.info('cards made', { uid, uploadId, cards: cards.length })
    } catch (err) {
      logger.error('card making failed', { uid, uploadId, err: String(err) })
      await ref.update({ status: 'error', error: String(err).slice(0, 500) })
    }
  },
)
