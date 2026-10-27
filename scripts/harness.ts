import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { markedPages, renderPage } from '../src/lib/pdfpages'

// Same worker setup as src/lib/uploads.ts, so this exercises the real browser path.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const files = import.meta.glob('./harness-pdfs/*.pdf', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>
const out = document.getElementById('out')!
const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })

for (const [path, url] of Object.entries(files)) {
  const name = decodeURIComponent(path.split('/').pop()!)
  try {
    const loading = pdfjs.getDocument({ data: new Uint8Array(await (await fetch(url)).arrayBuffer()) })
    const pdf = await loading.promise
    for (const pno of await markedPages(pdf)) {
      const c = (await renderPage(pdf, pno, makeCanvas)) as HTMLCanvasElement
      const pre = document.createElement('pre')
      pre.dataset.label = `${name} p${pno + 1}`
      pre.textContent = c.toDataURL('image/jpeg', 0.9)
      out.append(pre)
    }
    await loading.destroy()
  } catch (e) {
    const pre = document.createElement('pre')
    pre.dataset.error = name
    pre.textContent = String(e)
    out.append(pre)
  }
}
document.body.dataset.done = '1'
