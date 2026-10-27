/**
 * Runs the app's page preparation (src/lib/pdfpages.ts) in node, so its output can be
 * checked against the toy without a browser or a deploy:
 *
 *   node scripts/render-pdf-pages.ts <out_dir> file.pdf ...
 *
 * Writes "<file>.pdf p<N>.jpg" per marked page, exactly what the browser would upload.
 * Then in the toy: .venv/bin/python run.py --as-pdf <out_dir> && .venv/bin/python score.py
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { markedPages, renderPage, type MakeCanvas } from '../src/lib/pdfpages.ts'

const [outDir, ...files] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const make = ((w: number, h: number) => createCanvas(w, h)) as unknown as MakeCanvas

for (const f of files) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(f)) }).promise
  const pages = await markedPages(pdf)
  for (const pno of pages) {
    const canvas = (await renderPage(pdf, pno, make)) as unknown as ReturnType<typeof createCanvas>
    const out = join(outDir, `${basename(f)} p${pno + 1}.jpg`)
    writeFileSync(out, canvas.toBuffer('image/jpeg', 90))
    console.log(out, `${canvas.width}x${canvas.height}`)
  }
  if (!pages.length) console.log(basename(f), 'no marked pages')
}
