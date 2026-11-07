import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { deleteTeam } from '../storage.js'
import { teamColor } from '../teamColors.js'

// Left side of the TV: how to join, and every team's score.
export default function TeamSidebar({ code, state, refresh }) {
  const { room, teams, players } = state
  const [qr, setQr] = useState('')
  const joinUrl = `${window.location.origin}/?code=${code}`

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480 }).then(setQr)
  }, [joinUrl])

  async function handleRemoveTeam(team) {
    if (!window.confirm(`Remove team "${team.name}"? Its players will pick a new team.`)) return
    await deleteTeam(team.id)
    refresh()
  }

  return (
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
                {room.picking_team_id === team.id && <span className="picks">Picks next · </span>}
                {members.map((p) => p.name).join(', ') || 'No players yet'}
              </p>
            </li>
          )
        })}
        {teams.length === 0 && <li className="muted">Waiting for teams to join…</li>}
      </ul>
    </aside>
  )
}
