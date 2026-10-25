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
  storagePath: string
  fileName: string
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
