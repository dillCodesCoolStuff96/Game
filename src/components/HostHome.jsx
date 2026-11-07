import { useEffect, useState } from 'react'
import { navigate } from '../nav.js'
import { createRoom, ensureBoard, listMyRooms, signOut } from '../storage.js'

export default function HostHome({ user }) {
  const [rooms, setRooms] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listMyRooms(user.id)
      .then(setRooms)
      .catch((err) => setError(err.message))
  }, [user.id])

  async function handleCreate() {
    setBusy(true)
    setError('')
    try {
      const code = await createRoom(await ensureBoard())
      navigate(`?host=${code}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="card stack">
        <h1>Host</h1>
        <p className="muted">Signed in as {user.email}</p>

        <button type="button" className="primary" disabled={busy} onClick={handleCreate}>
          {busy ? 'Creating…' : 'Start a new game'}
        </button>

        {error && <p className="error">{error}</p>}

        {rooms.length > 0 && (
          <>
            <h2>Recent games</h2>
            <ul className="room-list">
              {rooms.map((room) => (
                <li key={room.code}>
                  <button type="button" onClick={() => navigate(`?host=${room.code}`)}>
                    <strong>{room.code}</strong>
                    <span className="muted">{new Date(room.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </button>
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => navigate(`?admin=${room.code}`)}
                  >
                    Admin
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button type="button" className="link" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
