/**
 * Annotated PDF pages -> images the model can read, notes included.
 * Browser port of ~/Projects/highlights-toy/pdfpages.py (the answer key). Keep them in step.
 *
 * Two things happen to each page before it goes to the model:
 * 1. Only card marks stay. Highlights in the card colour and pen drawings stay; every
 *    other highlight, underline, sticky-note icon etc. is hidden, so ordinary reading
 *    highlights can never turn into cards.
 * 2. Comments become visible. A PDF stores the reader's comments as text, and they don't
 *    show when the page is rendered (a Zotero note is a bare yellow icon, a comment on a
 *    highlight is nothing at all). Each comment is written into a white strip beside the
 *    page, at the height of its mark, with a thin line to it, like a margin note on paper.
 * Only pages with a card mark are prepared at all.
 *
 * KNOWN WEAKNESS (agreed with Hilmar, 27 Oct 2026): "is this blue?" is decided here by
 * fixed hue ranges (HUES), not by a model. Exact for clear colours, but a highlight near
 * a boundary (turquoise, blue-violet) can land on the wrong side. If that bites: let a
 * model turn the user's colour setting into something this code can use.
 *
 * No runtime import of pdfjs here (types only), so the same file runs in the browser and
 * in node (scripts/render-pdf-pages.ts, which checks it against the toy).
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export const CARD_COLOUR = 'blue' // later a user setting
export const SCALE = 150 / 72 // 150 dpi, same as the toy
const MARGIN = 170 // points of white strip added on a side that has notes
const NOTE_RGB = 'rgb(191, 13, 13)'
const FONT_PT = 10
const ENABLE_STORAGE = 3 // pdfjs AnnotationMode.ENABLE_STORAGE: render, honouring per-annotation noView

const PEN_MARKS = new Set(['Ink', 'Circle', 'Square', 'Polygon', 'PolyLine'])
const NOTES = new Set(['Text'])

/** Named colours as hue ranges in degrees. Identical to HUES in the toy. */
const HUES: [string, number, number][] = [
  ['red', 345, 15], ['orange', 15, 40], ['yellow', 40, 70], ['green', 70, 165],
  ['blue', 165, 250], ['purple', 250, 290], ['pink', 290, 345],
]

/** rgb 0..1 -> colour name. Same maths as Python's colorsys.rgb_to_hls. */
export function colourName(rgb: number[] | null | undefined): string | null {
  if (!rgb || rgb.length < 3) return null
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return 'grey'
  const d = max - min
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  if (s < 0.25 || l < 0.12 || l > 0.95) return 'grey'
  let h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d
  h = ((h / 6) % 1 + 1) % 1
  const deg = h * 360
  for (const [name, lo, hi] of HUES) {
    if (lo < hi ? deg >= lo && deg < hi : deg >= lo || deg < hi) return name
  }
  return null
}

/** The subset of pdfjs annotation data we use. */
interface Annot {
  id: string
  subtype: string
  color: Uint8ClampedArray | number[] | null
  contentsObj?: { str: string }
  rect: number[] // PDF space, y up
}

const rgb01 = (a: Annot) => (a.color ? Array.from(a.color).map((v) => v / 255) : null)
const commentOf = (a: Annot) => (a.contentsObj?.str ?? '').trim()

export function isCardMark(a: Annot, cardColour = CARD_COLOUR): boolean {
  if (PEN_MARKS.has(a.subtype)) return true
  return a.subtype === 'Highlight' && colourName(rgb01(a)) === cardColour
}

/** 0-based numbers of pages with at least one card mark. Only these are ever sent. */
export async function markedPages(pdf: PDFDocumentProxy, cardColour = CARD_COLOUR): Promise<number[]> {
  const out: number[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const annots = (await (await pdf.getPage(i)).getAnnotations()) as Annot[]
    if (annots.some((a) => isCardMark(a, cardColour))) out.push(i - 1)
  }
  return out
}

/** Minimal canvas surface shared by HTMLCanvasElement and @napi-rs/canvas. */
export interface CanvasLike {
  width: number
  height: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getContext(type: '2d'): any
}
export type MakeCanvas = (w: number, h: number) => CanvasLike

/** Wrap text into lines that fit maxWidth (canvas pixels). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrap(ctx: any, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of text.split(/\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

/**
 * Render page pno (0-based): card marks drawn, other marks hidden, comments in the margin.
 * Returns the finished canvas; the caller encodes it (toBlob in the browser, toBuffer in node).
 */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pno: number,
  makeCanvas: MakeCanvas,
  cardColour = CARD_COLOUR,
): Promise<CanvasLike> {
  const page: PDFPageProxy = await pdf.getPage(pno + 1)
  const annots = (await page.getAnnotations()) as Annot[]
  const viewport = page.getViewport({ scale: SCALE })

  // Hide everything that isn't a card mark (typed text boxes stay: they're visible text).
  for (const a of annots) {
    const keep = isCardMark(a, cardColour) || a.subtype === 'FreeText'
    pdf.annotationStorage.setValue(a.id, { noView: !keep })
  }
  const shot = makeCanvas(Math.round(viewport.width), Math.round(viewport.height))
  const sctx = shot.getContext('2d')
  sctx.fillStyle = '#fff'
  sctx.fillRect(0, 0, shot.width, shot.height)
  await page.render({ canvasContext: sctx, canvas: shot, viewport, annotationMode: ENABLE_STORAGE } as never).promise

  // Comments that count: sticky notes, and comments on card marks. Popups only repeat them.
  const notes = annots
    .filter((a) => commentOf(a) && (NOTES.has(a.subtype) || isCardMark(a, cardColour)))
    .map((a) => {
      // (pdfjs 6 dropped convertToViewportRectangle; two corners do the same.)
      const [x0, y0] = viewport.convertToViewportPoint(a.rect[0], a.rect[1])
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[2], a.rect[3])
      return {
        x0: Math.min(x0, x1), x1: Math.max(x0, x1),
        y0: Math.min(y0, y1), y1: Math.max(y0, y1),
        text: commentOf(a),
      }
    })
    .sort((a, b) => a.y0 - b.y0)
  if (notes.length === 0) return shot

  // Each note goes into the strip on the side where its mark sits, so its line
  // doesn't cross the text.
  const w = shot.width
  const h = shot.height
  const m = MARGIN * SCALE
  const sides = {
    L: notes.filter((n) => (n.x0 + n.x1) / 2 < w / 2),
    R: notes.filter((n) => (n.x0 + n.x1) / 2 >= w / 2),
  }
  const left = sides.L.length ? m : 0
  const right = sides.R.length ? m : 0
  const out = makeCanvas(Math.round(w + left + right), h)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(shot, left, 0)
  ctx.strokeStyle = 'rgb(217, 217, 217)'
  ctx.lineWidth = 0.5 * SCALE
  for (const x of [left ? left : null, right ? left + w : null]) {
    if (x == null) continue
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }

  const font = FONT_PT * SCALE
  const lineH = font * 1.2
  ctx.font = `${font}px Helvetica, Arial, sans-serif`
  ctx.textBaseline = 'top'
  for (const [side, items] of Object.entries(sides)) {
    const bx0 = side === 'L' ? 8 * SCALE : left + w + 10 * SCALE
    const bw = m - 18 * SCALE
    let yFree = 6 * SCALE
    for (const n of items) {
      const y = Math.max(n.y0 - 2 * SCALE, yFree)
      const lines = wrap(ctx, n.text, bw)
      const bh = lines.length * lineH
      ctx.fillStyle = NOTE_RGB
      lines.forEach((ln, i) => ctx.fillText(ln, bx0, y + i * lineH))
      ctx.strokeStyle = NOTE_RGB
      ctx.lineWidth = 0.6 * SCALE
      ctx.strokeRect(bx0 - 3 * SCALE, y - 2 * SCALE, bw + 6 * SCALE, bh + 4 * SCALE)
      // Thin line from the note to its mark (sticky notes: to where the icon was).
      const my = (n.y0 + n.y1) / 2
      const sy = y + bh / 2
      const [sx, ex] = side === 'L' ? [bx0 + bw + 3 * SCALE, n.x0 + left] : [bx0 - 3 * SCALE, n.x1 + left]
      if (Math.abs(ex - sx) > 6 * SCALE) {
        ctx.lineWidth = 0.5 * SCALE
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, my); ctx.stroke()
      }
      yFree = y + bh + 8 * SCALE
    }
  }
  return out
}
