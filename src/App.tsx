import { useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { AuthGate } from './auth/AuthGate'
import { photoUrl, uploadPage, watchCards, watchUploads, type Card, type Upload } from './lib/uploads'

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    photoUrl(path).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [path])
  if (!url) return <div className="photo photo-empty" />
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="photo" src={url} alt="uploaded page" />
    </a>
  )
}

function UploadItem({ upload, cards }: { upload: Upload; cards: Card[] }) {
  const mine = cards.filter((c) => c.uploadId === upload.id).sort((a, b) => a.index - b.index)
  const when = upload.createdAt?.toDate().toLocaleString()
  return (
    <section className="upload">
      <div className="upload-head">
        <Photo path={upload.storagePath} />
        <div className="upload-meta">
          <div>{when ?? 'just now'}</div>
          {upload.status === 'pending' && <div className="status">Making cards…</div>}
          {upload.status === 'error' && <div className="status status-error">Failed: {upload.error}</div>}
          {upload.status === 'done' && (
            <div className="dim">
              {upload.cardCount} cards · {upload.model} · prompt {upload.promptVersion}
              {upload.cost != null && ` · ${(upload.cost * 100).toFixed(2)}¢`}
              {upload.seconds != null && ` · ${upload.seconds}s`}
            </div>
          )}
        </div>
      </div>
      {upload.status === 'done' && mine.length === 0 && <p className="dim">No circled text found on this page.</p>}
      {mine.map((c) => (
        <div key={c.id} className="card">
          <div className="q">{c.front}</div>
          <div className="a">{c.back}</div>
          <div className="quote">“{c.quote}”</div>
        </div>
      ))}
    </section>
  )
}

/** The marking system, in the words a reader needs. Mirrors CONVENTION in functions/src/prompt.ts. */
function HowToMark({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details className="guide" open={open} onToggle={(e) => {
        // The toggle event also fires when React changes `open` itself; only a tap by the reader counts.
        if (e.currentTarget.open !== open) onToggle(e.currentTarget.open)
      }}>
      <summary>How to mark a page</summary>
      <ul>
        <li>
          <b>Circle what you want to be asked.</b> The circled words become the answer, and the
          question is built around them. One card per circle.
        </li>
        <li>
          <b>Add a short note if you want to steer it</b>, in your own words. A note is an
          instruction, never card text. It can say what to ask, or join several circles into one
          card.
          <div className="example">
            e.g. “1st assistant” next to a circled name, or a bracket / “one card” around two
            circles
          </div>
        </li>
        <li>
          <b>Everything else is ignored:</b> underlines, highlighting, ticks. Mark as you normally
          do.
        </li>
        <li className="dim">Photo tip: one page per photo, flat and well lit.</li>
      </ul>
    </details>
  )
}

function Home() {
  const { user, signOutNow } = useAuth()
  const uid = user!.uid
  const [uploads, setUploads] = useState<Upload[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guide starts open until there's a first upload; after that the reader's own toggle wins.
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => watchUploads(uid, setUploads), [uid])
  useEffect(() => watchCards(uid, setCards), [uid])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadPage(uid, file)
    } catch (err) {
      setError(String(err))
      console.error('[cards] upload failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="top">
        <span className="wordmark small">cards</span>
        <button className="btn btn-small" onClick={signOutNow}>
          Sign out
        </button>
      </header>
      <HowToMark open={guideOpen ?? uploads.length === 0} onToggle={setGuideOpen} />
      <input ref={input} type="file" accept="image/*" hidden onChange={onPick} />
      <button className="btn btn-primary wide" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : 'Upload a marked page'}
      </button>
      {error && <pre className="diag">{error}</pre>}
      {uploads.map((u) => (
        <UploadItem key={u.id} upload={u} cards={cards} />
      ))}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <Home />
      </AuthGate>
    </AuthProvider>
  )
}
