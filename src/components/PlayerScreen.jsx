import { useState } from 'react'
import { navigate } from '../nav.js'
import { buzz, createTeam, setMyTeam } from '../storage.js'
import { teamColor } from '../teamColors.js'
import { useRoom } from '../useRoom.js'

export default function PlayerScreen({ code, userId }) {
  const { status, state, error, refresh } = useRoom(code)

  const me = state?.players.find((p) => p.user_id === userId)

  // Not in this room (or it doesn't exist): back to the join form.
  if (status === 'missing' || (state && !me)) {
    return (
      <div className="screen">
        <div className="card stack">
          <p>You haven't joined game {code} yet.</p>
          <button type="button" className="primary" onClick={() => navigate(`?code=${code}`)}>
            Join game {code}
          </button>
        </div>
      </div>
    )
  }
  if (!state) return <div className="screen muted">{error || 'Loading…'}</div>

  const props = { state, me, refresh }
  return me.team_id ? <Buzzer {...props} /> : <TeamPicker {...props} />
}

function TeamPicker({ state, me, refresh }) {
  const { room, teams, players } = state
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  function handleCreate(event) {
    event.preventDefault()
    run(async () => {
      const team = await createTeam(room.id, newName)
      await setMyTeam(room.id, me.user_id, team.id)
    })
  }

  return (
    <div className="screen">
      <div className="card stack">
        <h1>Hi {me.name}! Pick your team</h1>

        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className="team-choice"
            style={{ '--team': teamColor(teams, team.id) }}
            disabled={busy}
            onClick={() => run(() => setMyTeam(room.id, me.user_id, team.id))}
          >
            <strong>{team.name}</strong>
            <span className="muted small">
              {players
                .filter((p) => p.team_id === team.id)
                .map((p) => p.name)
                .join(', ') || 'Nobody yet'}
            </span>
          </button>
        ))}

        <form className="stack" onSubmit={handleCreate}>
          <input
            placeholder="New team name"
            maxLength={30}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <button type="submit" className="primary" disabled={busy}>
            Create team
          </button>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

function Buzzer({ state, me, refresh }) {
  const { room, teams, players, buzzes } = state
  // Round number we pressed in, so the button reacts before the server answers.
  const [pressedRound, setPressedRound] = useState(null)
  const [error, setError] = useState('')

  const team = teams.find((t) => t.id === me.team_id)
  const teamBuzz = buzzes.find((b) => b.team_id === me.team_id)
  const place = teamBuzz ? buzzes.indexOf(teamBuzz) + 1 : null
  const buzzer = teamBuzz && players.find((p) => p.user_id === teamBuzz.user_id)
  const pending = pressedRound === room.buzz_round && !teamBuzz

  async function handleBuzz() {
    if (!room.buzz_open || teamBuzz || pending) return
    navigator.vibrate?.(60)
    setPressedRound(room.buzz_round)
    setError('')
    try {
      await buzz(room.id)
    } catch (err) {
      setError(err.message)
      setPressedRound(null)
    }
    refresh()
  }

  let label = 'Wait…'
  if (teamBuzz) label = `#${place}`
  else if (pending) label = '…'
  else if (room.buzz_open) label = 'BUZZ'

  let caption = 'Buzzers are closed'
  if (teamBuzz) {
    caption = teamBuzz.user_id === me.user_id ? 'You buzzed in!' : `${buzzer?.name} buzzed in`
  } else if (room.buzz_open) caption = 'Tap to buzz in'

  return (
    <div className="player" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>

      <button
        type="button"
        className={`buzz-button ${room.buzz_open && !teamBuzz ? 'live' : ''} ${place === 1 ? 'first' : ''}`}
        disabled={!room.buzz_open && !teamBuzz}
        onPointerDown={handleBuzz}
      >
        {label}
      </button>
      <p className="caption">{caption}</p>
      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="link"
        onClick={() => setMyTeam(room.id, me.user_id, null).then(refresh)}
      >
        Switch team
      </button>
    </div>
  )
}
