// Tests storage.rules against local emulators.
// NOTE (27 Oct 2026): the invite-list lookup passed here but was denied in production
// (named database), so the live rules only check a verified email. The two "NOT invited"
// checks below therefore expect SUCCESS: they document the known gap, not a wish.
// Never touches the real project (demo- ids are offline-only). Needs Java 21+.
//
//   firebase emulators:exec --project demo-cards --only firestore,storage "node scripts/rules-test.mjs"
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'

const PROJECT = 'demo-cards'
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
})

// Invite one email in the NAMED database, the way the console does (bypasses rules).
const invite = async (email) => {
  const url = `http://127.0.0.1:8085/v1/projects/${PROJECT}/databases/highlights/documents/allowlist/${email}`
  const res = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: {} }) })
  if (!res.ok) throw new Error(`invite failed: ${res.status} ${await res.text()}`)
}
await invite('invited@example.com')

const as = (uid, email, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).storage()
const A = as('uidA', 'Invited@Example.com') // invited (email case differs on purpose)
const C = as('uidC', 'stranger@example.com') // signed in, verified, NOT invited
const U = as('uidU', 'invited@example.com', false) // invited email, not verified
const anon = env.unauthenticatedContext().storage()

const bytes = (n) => new Uint8Array(n)
const put = (s, path, n, contentType) => s.ref(path).put(bytes(n), { contentType })

let failed = 0
async function check(name, expectOk, p) {
  try {
    await (expectOk ? assertSucceeds(p) : assertFails(p))
    console.log(`ok    ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}: ${String(e).slice(0, 200)}`)
  }
}

const MB = 1024 * 1024
await check('invited: photo', true, put(A, 'highlights/uidA/u1.jpg', 1000, 'image/jpeg'))
await check('invited: PDF page image', true, put(A, 'highlights/uidA/u2/p3.jpg', 1000, 'image/jpeg'))
await check('invited: original PDF, 1 MB', true, put(A, 'highlights/uidA/u2/original.pdf', MB, 'application/pdf'))
await check('invited: original PDF, 30 MB exactly', true, put(A, 'highlights/uidA/u3/original.pdf', 30 * MB, 'application/pdf'))
await check('invited: original PDF over 30 MB', false, put(A, 'highlights/uidA/u4/original.pdf', 30 * MB + 1, 'application/pdf'))
await check('invited: page image 10 MB+', false, put(A, 'highlights/uidA/u2/p4.jpg', 10 * MB, 'image/jpeg'))
await check('invited: other file name in upload folder', false, put(A, 'highlights/uidA/u2/evil.html', 10, 'text/html'))
await check('invited: PDF disguised as page image', false, put(A, 'highlights/uidA/u2/p5.jpg', 10, 'application/pdf'))
await check('invited: photo that is not an image', false, put(A, 'highlights/uidA/u5.jpg', 10, 'application/pdf'))
await check('invited: into someone else\'s folder', false, put(A, 'highlights/uidC/u1.jpg', 10, 'image/jpeg'))
await check('invited: overwrite an existing photo', false, put(A, 'highlights/uidA/u1.jpg', 10, 'image/jpeg'))
await check('invited: delete own photo', false, A.ref('highlights/uidA/u1.jpg').delete())
await check('invited: read own PDF page', true, A.ref('highlights/uidA/u2/p3.jpg').getMetadata())
await check('NOT invited: photo in own folder (known gap)', true, put(C, 'highlights/uidC/u1.jpg', 10, 'image/jpeg'))
await check('NOT invited: PDF page in own folder (known gap)', true, put(C, 'highlights/uidC/u2/p1.jpg', 10, 'image/jpeg'))
await check('NOT invited: read someone else\'s page', false, C.ref('highlights/uidA/u2/p3.jpg').getMetadata())
await check('unverified email: photo', false, put(U, 'highlights/uidU/u1.jpg', 10, 'image/jpeg'))
await check('signed out: photo', false, put(anon, 'highlights/uidA/u9.jpg', 10, 'image/jpeg'))
await check('signed out: read', false, anon.ref('highlights/uidA/u1.jpg').getMetadata())

await env.cleanup()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
