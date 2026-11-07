import { useState } from 'react'
import { navigate } from '../nav.js'
import { playBlip } from '../sounds.js'
import { buzz, createTeam, setMyTeam } from '../storage.js'
import { teamColor } from '../teamColors.js'
import { useRoom } from '../useRoom.js'
import AllPlayPhone from './AllPlayPhone.jsx'
import WheelPhone from './WheelPhone.jsx'

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
  if (!me.team_id) return <TeamPicker {...props} />
  if (state.room.wheel) return <WheelPhone {...props} />
  // All-play questions swap the buzzer for the team's answer sheet.
  if (state.room.allplay && state.room.phase !== 'board') {
    return <AllPlayPhone key={state.room.buzz_round} {...props} />
  }
  return <Buzzer {...props} />
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
  // True from the tap until the server answers, so the button reacts instantly.
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const team = teams.find((t) => t.id === me.team_id)
  // Timed-out buzzes are out of line; the team can buzz again after one.
  // Buzzes still waiting for the host. A team whose last buzz timed out or was
  // judged wrong can buzz again.
  const inLine = buzzes.filter((b) => !b.expired && !b.result)
  const teamBuzz = inLine.find((b) => b.team_id === me.team_id)
  const place = teamBuzz ? inLine.indexOf(teamBuzz) + 1 : null
  const lastTeamBuzz = buzzes.findLast((b) => b.team_id === me.team_id)
  const gotItRight = lastTeamBuzz?.result === 'correct'
  const buzzer = teamBuzz && players.find((p) => p.user_id === teamBuzz.user_id)

  async function handleBuzz() {
    if (!room.buzz_open || teamBuzz || gotItRight || pending) return
    navigator.vibrate?.(60)
    playBlip()
    setPending(true)
    setError('')
    try {
      await buzz(room.id)
    } catch (err) {
      setError(err.message)
    }
    await refresh()
    setPending(false)
  }

  let label = 'Wait…'
  if (teamBuzz) label = `#${place}`
  else if (gotItRight) label = '✓'
  else if (pending) label = '…'
  else if (room.buzz_open) label = 'BUZZ'

  let caption = 'Buzzers are closed'
  if (teamBuzz) {
    caption = teamBuzz.user_id === me.user_id ? 'You buzzed in!' : `${buzzer?.name} buzzed in`
  } else if (gotItRight) caption = 'Correct!'
  else if (lastTeamBuzz) {
    const what = lastTeamBuzz.result === 'wrong' ? 'Wrong' : "Time's up"
    caption = room.buzz_open ? `${what} — buzz again if you know it` : what
  } else if (room.buzz_open) caption = 'Tap to buzz in'

  return (
    <div className="player" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>

      <button
        type="button"
        className={`buzz-button ${room.buzz_open && !teamBuzz && !gotItRight ? 'live' : ''} ${place === 1 || gotItRight ? 'first' : ''}`}
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
