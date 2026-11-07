import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { navigate } from '../nav.js'
import { closeBuzzers, deleteTeam, openBuzzers } from '../storage.js'
import { teamColor } from '../teamColors.js'
import { useRoom } from '../useRoom.js'

// The TV view, driven from the host's PC. Space opens/closes the buzzers.
export default function HostScreen({ code }) {
  const { status, state, error, refresh } = useRoom(code)
  const [qr, setQr] = useState('')
  const joinUrl = `${window.location.origin}/?code=${code}`

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480 }).then(setQr)
  }, [joinUrl])

  const room = state?.room

  async function toggleBuzzers() {
    if (!room) return
    if (room.buzz_open) await closeBuzzers(room.id)
    else await openBuzzers(room)
    refresh()
  }

  useEffect(() => {
    function onKey(event) {
      if (event.code !== 'Space' || event.target.closest?.('input, textarea')) return
      event.preventDefault()
      toggleBuzzers()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleRemoveTeam(team) {
    if (!window.confirm(`Remove team "${team.name}"? Its players will pick a new team.`)) return
    await deleteTeam(team.id)
    refresh()
  }

  if (status === 'missing') {
    return (
      <div className="screen">
        <p>No game found with code {code}.</p>
        <button type="button" className="link" onClick={() => navigate('?host')}>
          ← Back
        </button>
      </div>
    )
  }
  if (!state) return <div className="screen muted">{error || 'Loading…'}</div>

  const { teams, players, buzzes } = state
  const firstTime = buzzes[0] && new Date(buzzes[0].buzzed_at).getTime()

  return (
    <div className="tv">
      <aside className="tv-side">
        <div className="join">
          {qr && <img src={qr} alt="QR code to join" />}
          <p className="muted">Join at {window.location.host}</p>
          <p className="room-code">{code}</p>
        </div>

        <ul className="team-list">
          {teams.map((team) => {
            const members = players.filter((p) => p.team_id === team.id)
            return (
              <li key={team.id} style={{ '--team': teamColor(teams, team.id) }}>
                <div className="team-row">
                  <span className="team-name">{team.name}</span>
                  <span className="team-score">{team.score}</span>
                  <button
                    type="button"
                    className="remove"
                    aria-label={`Remove ${team.name}`}
                    onClick={() => handleRemoveTeam(team)}
                  >
                    ×
                  </button>
                </div>
                <p className="muted small">
                  {members.map((p) => p.name).join(', ') || 'No players yet'}
                </p>
              </li>
            )
          })}
          {teams.length === 0 && <li className="muted">Waiting for teams to join…</li>}
        </ul>
      </aside>

      <main className="tv-main">
        <div className={`buzz-state ${room.buzz_open ? 'open' : ''}`}>
          {room.buzz_open ? 'Buzzers open!' : 'Buzzers closed'}
        </div>

        <ol className="buzz-order">
          {buzzes.map((b, i) => {
            const team = teams.find((t) => t.id === b.team_id)
            const player = players.find((p) => p.user_id === b.user_id)
            const gap = (new Date(b.buzzed_at).getTime() - firstTime) / 1000
            return (
              <li key={b.id} style={{ '--team': teamColor(teams, b.team_id) }}>
                <span className="place">{i + 1}</span>
                <span className="who">
                  <strong>{team?.name ?? 'Removed team'}</strong>
                  <span className="muted">{player?.name}</span>
                </span>
                <span className="gap muted">{i === 0 ? '' : `+${gap.toFixed(2)}s`}</span>
              </li>
            )
          })}
        </ol>

        <div className="host-controls">
          <button type="button" className="primary big" onClick={toggleBuzzers}>
            {room.buzz_open ? 'Close buzzers' : 'Open buzzers'}
          </button>
          <span className="muted small">or press Space</span>
          <button type="button" className="link" onClick={() => navigate('?host')}>
            ← Games
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  )
}
