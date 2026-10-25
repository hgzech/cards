import { AuthProvider, useAuth } from './auth/AuthProvider'
import { AuthGate } from './auth/AuthGate'

/** Placeholder home. Upload and cards come in the next step. */
function Home() {
  const { user, signOutNow } = useAuth()
  return (
    <div className="centered splash">
      <h1 className="wordmark">cards</h1>
      <p className="tagline">Signed in as {user?.email}.</p>
      <p className="tagline">Upload comes next.</p>
      <button className="btn" onClick={signOutNow}>
        Sign out
      </button>
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
