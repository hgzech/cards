import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { firebaseConfig } from './env'

/**
 * This app lives inside the `remimbers` Firebase project, next to Remimbers.
 * It shares the project (and so the Google sign-in), but keeps its data in
 * its OWN database, `highlights`, with its own rules and allowlist.
 *
 * The SDK assumes the '(default)' database unless told otherwise. If reads
 * come back empty, check that this id matches the `database` key in
 * firebase.json.
 */
export const DATABASE_ID = 'highlights'

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// No offline persistence: uploading a photo needs the network anyway, and a
// plain in-memory cache avoids the "write looks done but isn't" trap.
export const db = getFirestore(app, DATABASE_ID)
