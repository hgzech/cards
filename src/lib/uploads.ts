import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { app, db } from './firebase'

const storage = getStorage(app)

export interface Upload {
  id: string
  kind?: 'pdf' // absent = photo
  storagePath: string // photo; for a PDF the first prepared page (thumbnail)
  fileName: string
  pages?: { page: number; storagePath: string }[] // PDF: one prepared image per marked page
  pageCount?: number // PDF: pages in the whole file
  pdfPath?: string | null // PDF: the original file, if it was small enough to keep
  failedPages?: number[]
  status: 'pending' | 'done' | 'error'
  error?: string
  cardCount?: number
  model?: string
  promptVersion?: string
  cost?: number
  seconds?: number
  createdAt?: Timestamp
}

export interface Card {
  id: string
  front: string
  back: string
  quote: string
  uploadId: string
  page?: number // PDF only, 1-based
  index: number
  model: string
  promptVersion: string
}

/** Same size the toy sent: longest side at most 2048 px, JPEG. */
const MAX_SIDE = 2048

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  // 'from-image' applies the photo's rotation flag, so a portrait photo stays upright.
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const width = Math.round(bmp.width * scale)
  const height = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode photo'))), 'image/jpeg', 0.9),
  )
  return { blob, width, height }
}

/**
 * 1. shrink the photo, 2. put it in Storage, 3. write the upload document.
 * Step 3 is what starts card-making on the server (hl_onUploadCreated), so it
 * must come after the photo is safely stored.
 */
export async function uploadPage(uid: string, file: File): Promise<string> {
  const { blob, width, height } = await shrink(file)
  const uploadRef = doc(collection(db, 'users', uid, 'uploads'))
  const storagePath = `highlights/${uid}/${uploadRef.id}.jpg`
  await uploadBytes(ref(storage, storagePath), blob, { contentType: 'image/jpeg' })
  await setDoc(uploadRef, {
    storagePath,
    contentType: 'image/jpeg',
    fileName: file.name,
    width,
    height,
    bytes: blob.size,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
  return uploadRef.id
}

/** Keep the original PDF only up to this size (decided 27 Oct 2026). Page images are always kept. */
export const PDF_KEEP_MAX_BYTES = 30 * 1024 * 1024
/** Most marked pages per PDF upload. Same limit in the function. */
export const MAX_PDF_PAGES = 50

const canvasToJpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode page'))), 'image/jpeg', 0.9),
  )

/**
 * A PDF annotated in a reading app (Zotero, Preview, ...):
 * 1. find the pages with a card mark (blue highlight or pen circle) — nothing else is sent;
 * 2. prepare each one in the browser (src/lib/pdfpages.ts: other marks hidden, comments
 *    written into the margin) and store it as a JPEG, exactly what the model will see;
 * 3. store the original PDF too, unless it's over 30 MB;
 * 4. write the upload document, which starts card-making on the server.
 * pdf.js is loaded only here, so photo-only use doesn't download it.
 *
 * The LEGACY build on purpose: the modern one uses the JS `Iterator` global at load
 * time, which Safari lacked ("Can't find variable: Iterator", 27 Oct 2026). Legacy
 * polyfills it. Main script and worker must come from the same build.
 */
export async function uploadPdf(uid: string, file: File, onProgress: (msg: string) => void): Promise<string> {
  onProgress('Reading the PDF…')
  const [pdfjs, { default: workerUrl }, pp] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    import('./pdfpages'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loading.promise
  try {
    const marked = await pp.markedPages(pdf)
    if (marked.length === 0) {
      throw new Error(
        `No ${pp.CARD_COLOUR} highlights or pen circles found in this PDF, so there's nothing to make cards from.`,
      )
    }
    if (marked.length > MAX_PDF_PAGES) {
      throw new Error(`${marked.length} marked pages; at most ${MAX_PDF_PAGES} per upload for now.`)
    }

    const uploadRef = doc(collection(db, 'users', uid, 'uploads'))
    const folder = `highlights/${uid}/${uploadRef.id}`
    const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })
    const pages: { page: number; storagePath: string }[] = []
    for (const [k, pno] of marked.entries()) {
      onProgress(`Preparing marked page ${k + 1} of ${marked.length}…`)
      const canvas = (await pp.renderPage(pdf, pno, makeCanvas)) as HTMLCanvasElement
      const storagePath = `${folder}/p${pno + 1}.jpg`
      await uploadBytes(ref(storage, storagePath), await canvasToJpeg(canvas), { contentType: 'image/jpeg' })
      pages.push({ page: pno + 1, storagePath })
    }

    let pdfPath: string | null = null
    if (file.size <= PDF_KEEP_MAX_BYTES) {
      onProgress('Keeping a copy of the PDF…')
      pdfPath = `${folder}/original.pdf`
      await uploadBytes(ref(storage, pdfPath), file, { contentType: 'application/pdf' })
    }

    await setDoc(uploadRef, {
      kind: 'pdf',
      fileName: file.name,
      storagePath: pages[0].storagePath,
      pages,
      pageCount: pdf.numPages,
      pdfPath,
      pdfBytes: file.size,
      status: 'pending',
      createdAt: serverTimestamp(),
    })
    return uploadRef.id
  } finally {
    await loading.destroy() // frees the worker's memory for this file
  }
}

export function watchUploads(uid: string, cb: (u: Upload[]) => void) {
  const q = query(collection(db, 'users', uid, 'uploads'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Upload)))
}

/** All of the user's cards; grouped by upload in the UI. Fine at test-app scale. */
export function watchCards(uid: string, cb: (c: Card[]) => void) {
  return onSnapshot(collection(db, 'users', uid, 'cards'), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Card)),
  )
}

export function photoUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath))
}
