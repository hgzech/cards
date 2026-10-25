import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { CARD_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, USER_TEXT } from './prompt.js'

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

interface Card {
  front: string
  back: string
  quote: string
}

/** Raw fetch, no SDK. Same request as the toy's call_gemini, so the cards should match. */
async function callGemini(key: string, imageB64: string, mime: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL.id}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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

/**
 * An upload document appeared -> make the cards.
 *
 * The browser has already put the photo in Storage and then written
 * users/{uid}/uploads/{uploadId} with status 'pending' and the photo's path.
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
    timeoutSeconds: 120,
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

    const path: string = data.storagePath ?? ''
    // Never read a photo outside this user's own folder, whatever the doc says.
    if (!path.startsWith(`highlights/${uid}/`)) {
      await ref.update({ status: 'error', error: 'photo path is not in your folder' })
      return
    }

    const started = Date.now()
    try {
      const [buf] = await getStorage().bucket().file(path).download()
      const mime: string = data.contentType ?? 'image/jpeg'
      const { cards, tokensIn, tokensOut } = await callGemini(geminiKey.value(), buf.toString('base64'), mime)
      const cost = (tokensIn * MODEL.priceIn + tokensOut * MODEL.priceOut) / 1e6

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
        cost,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        finishedAt: FieldValue.serverTimestamp(),
      })
      await batch.commit()
      logger.info('cards made', { uid, uploadId, cards: cards.length, cost })
    } catch (err) {
      logger.error('card making failed', { uid, uploadId, err: String(err) })
      await ref.update({ status: 'error', error: String(err).slice(0, 500) })
    }
  },
)
