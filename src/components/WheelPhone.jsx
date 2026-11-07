import { useState } from 'react'
import { spinWheel, wheelSteal } from '../storage.js'
import { teamColor } from '../teamColors.js'

// Phone during the wheel: the spinning team gets the SPIN button (and picks a
// team after a Steal); everyone else watches.
export default function WheelPhone({ state, me, refresh }) {
  const { room, teams } = state
  const wheel = room.wheel
  const spinner = teams.find((t) => t.id === wheel.team_id)
  const team = teams.find((t) => t.id === me.team_id)
  const mine = wheel.team_id === me.team_id
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(action) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
    }
    await refresh()
    setBusy(false)
  }

  let body
  if (wheel.status === 'ready' && mine) {
    body = (
      <>
        <button
          type="button"
          className="buzz-button live"
          disabled={busy}
          onPointerDown={() => {
            if (busy) return
            navigator.vibrate?.(80)
            act(() => spinWheel(room.id))
          }}
        >
          SPIN
        </button>
        <p className="caption">Your team gets to spin the wheel!</p>
      </>
    )
  } else if (wheel.status === 'ready') {
    body = <p className="caption">{spinner?.name} is about to spin the wheel!</p>
  } else if (wheel.status === 'spinning') {
    body = <p className="caption wheel-phone-spinning">Spinning…</p>
  } else if (wheel.status === 'choose' && mine) {
    body = (
      <div className="stack wheel-steal">
        <p className="caption">Steal {wheel.amount} from…</p>
        {teams
          .filter((t) => t.id !== me.team_id)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className="team-choice"
              style={{ '--team': teamColor(teams, t.id) }}
              disabled={busy}
              onClick={() => act(() => wheelSteal(room.id, t.id))}
            >
              <strong>{t.name}</strong>
              <span className="muted small">{t.score} pts</span>
            </button>
          ))}
      </div>
    )
  } else if (wheel.status === 'choose') {
    body = <p className="caption">{spinner?.name} is choosing who to steal from…</p>
  } else {
    body = <p className="caption wheel-result">{wheel.result}</p>
  }

  return (
    <div className="player" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>
      <p className="allplay-badge">Wheel</p>
      {body}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
