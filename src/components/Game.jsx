import { useState } from 'react'
import { signOut } from '../storage.js'

export default function Game({ user }) {
  const [tab, setTab] = useState('play')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Game</h1>
        <div className="account">
          <span className="muted small">{user.email}</span>
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        {tab === 'play' ? (
          <div className="card empty">
            <h2>Coming soon</h2>
            <p>The game goes here.</p>
          </div>
        ) : (
          <div className="card">
            <h2>Profile</h2>
            <p className="muted">Signed in as {user.email}</p>
          </div>
        )}
      </main>

      <nav className="tab-bar">
        <button
          type="button"
          className={tab === 'play' ? 'active' : ''}
          onClick={() => setTab('play')}
        >
          Play
        </button>
        <button
          type="button"
          className={tab === 'profile' ? 'active' : ''}
          onClick={() => setTab('profile')}
        >
          Profile
        </button>
      </nav>
    </div>
  )
}
