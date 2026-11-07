import { useState } from 'react'
import { supabase } from '../supabase.js'

export default function Auth() {
  const [mode, setMode] = useState('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isSignUp = mode === 'signUp'

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    const { data, error } = isSignUp
      ? await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/?host` },
        })
      : await supabase.auth.signInWithPassword({ email, password })

    setBusy(false)
    if (error) {
      setError(error.message)
    } else if (isSignUp && !data.session) {
      // Supabase requires email confirmation before the first sign-in.
      setNotice('Check your email for a confirmation link, then sign in.')
      setMode('signIn')
    }
    // On success the auth listener in App shows the host screen.
  }

  function toggleMode() {
    setMode(isSignUp ? 'signIn' : 'signUp')
    setError('')
    setNotice('')
  }

  return (
    <div className="screen">
      <form className="card stack" onSubmit={handleSubmit}>
        <h1>{isSignUp ? 'Create a host account' : 'Host sign in'}</h1>
        <p className="muted">Players don't need an account — they join with the game code.</p>

        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="error">{error}</p>}
        {notice && <p>{notice}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" className="link" onClick={toggleMode}>
          {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  )
}
