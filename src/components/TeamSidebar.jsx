import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { adjustScore, deleteTeam } from '../storage.js'
import { teamColor } from '../teamColors.js'

// Left side of the TV: how to join, and every team's score.
export default function TeamSidebar({ code, state, refresh }) {
  const { room, teams, players } = state
  const [qr, setQr] = useState('')
  const joinUrl = `${window.location.origin}/?code=${code}`

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480 }).then(setQr)
  }, [joinUrl])

  async function adjust(team, points) {
    try {
      await adjustScore(team.id, points)
    } catch (err) {
      window.alert(err.message)
    }
    refresh()
  }

  function handleCustomAdjust(team) {
    const input = window.prompt(`Points to add for ${team.name} (use a minus sign to take away, e.g. -200):`)
    const points = Number.parseInt(input ?? '', 10)
    if (Number.isFinite(points) && points !== 0) adjust(team, points)
  }

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
                <span className="score-adjust">
                  <button
                    type="button"
                    aria-label={`Take 50 from ${team.name}`}
                    onClick={() => adjust(team, -50)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="team-score"
                    title="Click to add or take away any amount"
                    onClick={() => handleCustomAdjust(team)}
                  >
                    {team.score}
                  </button>
                  <button
                    type="button"
                    aria-label={`Give 50 to ${team.name}`}
                    onClick={() => adjust(team, 50)}
                  >
                    +
                  </button>
                </span>
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
