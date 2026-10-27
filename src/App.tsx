import { useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { AuthGate } from './auth/AuthGate'
import { photoUrl, uploadPage, uploadPdf, watchCards, watchUploads, type Card, type Upload } from './lib/uploads'

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

/** "what the model saw": the prepared page image, opened in a new tab. */
function PageLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    photoUrl(path).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [path])
  return url ? (
    <a className="dim" href={url} target="_blank" rel="noreferrer">
      what the model saw
    </a>
  ) : null
}

function CardView({ c }: { c: Card }) {
  return (
    <div className="card">
      <div className="q">{c.front}</div>
      <div className="a">{c.back}</div>
      <div className="quote">“{c.quote}”</div>
    </div>
  )
}

function UploadItem({ upload, cards }: { upload: Upload; cards: Card[] }) {
  const mine = cards
    .filter((c) => c.uploadId === upload.id)
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.index - b.index)
  const when = upload.createdAt?.toDate().toLocaleString()
  const isPdf = upload.kind === 'pdf'
  const pages = upload.pages ?? []
  return (
    <section className="upload">
      <div className="upload-head">
        <Photo path={upload.storagePath} />
        <div className="upload-meta">
          {isPdf && <div className="filename">{upload.fileName}</div>}
          {isPdf && (
            <div className="dim">
              {pages.length} marked {pages.length === 1 ? 'page' : 'pages'} of {upload.pageCount}
              {upload.pdfPath ? '' : ' · PDF too large to keep, pages kept'}
            </div>
          )}
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
      {upload.status === 'done' && mine.length === 0 && (
        <p className="dim">{isPdf ? 'No cards came out of the marked pages.' : 'No circled text found on this page.'}</p>
      )}
      {upload.failedPages && upload.failedPages.length > 0 && (
        <p className="status status-error">Failed on page {upload.failedPages.join(', ')}.</p>
      )}
      {isPdf
        ? pages.map((p) => {
            const onPage = mine.filter((c) => c.page === p.page)
            return (
              <div key={p.page} className="pdf-page">
                <div className="pdf-page-head">
                  <span>Page {p.page}</span>
                  <PageLink path={p.storagePath} />
                </div>
                {onPage.map((c) => (
                  <CardView key={c.id} c={c} />
                ))}
              </div>
            )
          })
        : mine.map((c) => <CardView key={c.id} c={c} />)}
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
          <b>Add a short note if you want to steer it</b>, in your own words: a few words on what
          the question should be about, or that several circles belong on one card. A note is an
          instruction, never card text.
        </li>
        <li>
          <b>Everything else is ignored:</b> underlines, highlighting, ticks. Mark as you normally
          do.
        </li>
        <li>
          <b>In a PDF</b> (Zotero, Preview, …): <b>highlight in blue</b> what you want to be
          asked (or circle it with the pen). One card per highlight. A comment on the highlight,
          or a note next to it, steers it like a margin note. Other colours are ignored. In
          Zotero, use File → Export PDF so the marks are inside the file.
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
  const [busy, setBusy] = useState<string | null>(null) // progress text while uploading
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
    setBusy('Uploading…')
    setError(null)
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      if (isPdf) await uploadPdf(uid, file, setBusy)
      else await uploadPage(uid, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      console.error('[cards] upload failed', err)
    } finally {
      setBusy(null)
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
      <input ref={input} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={onPick} />
      <button className="btn btn-primary wide" onClick={() => input.current?.click()} disabled={busy != null}>
        {busy ?? 'Upload a marked page or PDF'}
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
