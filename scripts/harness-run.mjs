// Runs scripts/harness.html in headless Chrome and saves each prepared page as a JPEG.
// Needs `npx vite --port 5179` running. Usage: node scripts/harness-run.mjs <out_dir>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? '/tmp/chromepages'
mkdirSync(outDir, { recursive: true })
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  '--user-data-dir=/tmp/chrome-harness', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let targets
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200)
    targets = await fetch('http://localhost:9333/json').then((r) => r.json()).catch(() => null)
  }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value

  await send('Page.navigate', { url: 'http://localhost:5179/scripts/harness.html' })
  const t0 = Date.now()
  while (!(await evaluate('document.body?.dataset.done === "1"'))) {
    if (Date.now() - t0 > 45000) throw new Error('timed out')
    await sleep(300)
  }
  const errors = await evaluate('[...document.querySelectorAll("pre[data-error]")].map(p => p.dataset.error + ": " + p.textContent)')
  const pages = await evaluate('[...document.querySelectorAll("pre[data-label]")].map(p => [p.dataset.label, p.textContent])')
  for (const e of errors) console.log('ERROR', e)
  for (const [label, url] of pages) {
    writeFileSync(join(outDir, `${label}.jpg`), Buffer.from(url.split(',')[1], 'base64'))
    console.log(label)
  }
  console.log(pages.length, 'pages in', ((Date.now() - t0) / 1000).toFixed(1), 's')
  ws.close()
} finally {
  chrome.kill()
}
