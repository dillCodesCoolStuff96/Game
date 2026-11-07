import { useState } from 'react'
import { navigate } from '../nav.js'
import { ensurePlayerSession, joinRoom } from '../storage.js'

function savedName() {
  try {
    return localStorage.getItem('playerName') ?? ''
  } catch {
    return ''
  }
}

// Players land here (usually from the TV's QR code, which fills in the code).
export default function Home({ initialCode }) {
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState(savedName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await ensurePlayerSession()
      await joinRoom(code, name)
      try {
        localStorage.setItem('playerName', name.trim())
      } catch {
        // Remembering the name is only a convenience.
      }
      navigate(`?play=${code.trim().toUpperCase()}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <form className="card stack" onSubmit={handleSubmit}>
        <h1>Join the game</h1>

        <input
          className="code-input"
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
        />
        <input
          placeholder="Your name"
          autoComplete="nickname"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>

      <button type="button" className="link host-link" onClick={() => navigate('?host')}>
        Hosting? Sign in here
      </button>
    </div>
  )
}
