import { useEffect, useRef, useState } from 'react'
import { playBlip, playBuzzer, playDing } from '../sounds.js'
import { closeMatch3, pickMatch3Tile } from '../storage.js'
import { teamColor } from '../teamColors.js'

// The tile grid plus a legend of prizes and how many of each are found.
// onPick(tile) makes face-down tiles tappable.
function Match3Board({ match3, onPick }) {
  const revealed = new Map(match3.revealed.map((r) => [r.tile, r.symbol]))
  const found = (symbol) => match3.revealed.filter((r) => r.symbol === symbol).length
  const done = match3.status === 'done'

  return (
    <div className="match3">
      <ul className="match3-legend">
        {match3.symbols.map((s, i) => (
          <li key={i} className={done && match3.winner === i ? 'won' : ''}>
            <span className="match3-emoji">{s.emoji}</span>
            <strong>
              {s.points >= 0 ? '+' : ''}
              {s.points}
            </strong>
            <span className="match3-dots" aria-label={`${found(i)} of 3 found`}>
              {[0, 1, 2].map((d) => (
                <span key={d} className={d < found(i) ? 'on' : ''} />
              ))}
            </span>
          </li>
        ))}
      </ul>

      <div className="match3-grid">
        {Array.from({ length: match3.tiles }, (_, tile) => {
          // After a win the server sends the whole layout: unpicked tiles flip
          // over too (dimmed) so everyone sees what they missed.
          const picked = revealed.has(tile)
          const symbol = picked ? revealed.get(tile) : done ? match3.layout?.[tile] : undefined
          const shown = symbol != null
          const canPick = Boolean(onPick) && !shown && !done
          return (
            <button
              key={tile}
              type="button"
              className={`match3-tile ${shown ? 'flipped' : ''} ${shown && !picked ? 'missed' : ''} ${picked && done && symbol === match3.winner ? 'won' : ''}`}
              disabled={!canPick}
              onClick={() => canPick && onPick(tile)}
              aria-label={shown ? match3.symbols[symbol].emoji : `Tile ${tile + 1}`}
            >
              {shown ? match3.symbols[symbol].emoji : '🎀'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Plays a blip for each new flip and a fanfare on a match.
function useFlipSounds(match3) {
  const flips = useRef(match3.revealed.length)
  useEffect(() => {
    if (match3.revealed.length > flips.current) {
      if (match3.status === 'done') playDing()
      else playBlip()
    }
    flips.current = match3.revealed.length
  }, [match3.revealed.length, match3.status])
}

// TV overlay. The host can flip tiles too, as a backup. Enter continues.
export function Match3TV({ room, teams, run }) {
  const match3 = room.match3
  const team = teams.find((t) => t.id === match3.team_id)
  const done = match3.status === 'done'
  useFlipSounds(match3)

  useEffect(() => {
    playBuzzer()
  }, [])

  useEffect(() => {
    function onKey(event) {
      if (!done || event.key !== 'Enter') return
      event.preventDefault()
      event.stopImmediatePropagation()
      run(() => closeMatch3(room.id))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="wheel-overlay" style={{ '--team': teamColor(teams, match3.team_id) }}>
      <p className="wheel-title">
        <span>BONUS ROOM!</span> {team?.name}
      </p>
      <p className="muted">{done ? '' : 'Pick tiles on your phone — first to find 3 of a kind wins it!'}</p>

      <Match3Board match3={match3} onPick={(tile) => run(() => pickMatch3Tile(room.id, tile))} />

      {done && <p className="wheel-result">{match3.result}</p>}

      <div className="host-controls">
        {done ? (
          <button type="button" className="primary big" onClick={() => run(() => closeMatch3(room.id))}>
            Continue (Enter)
          </button>
        ) : (
          <>
            <span className="muted small">Click a tile to flip it for them</span>
            <button type="button" className="link" onClick={() => run(() => closeMatch3(room.id))}>
              Cancel bonus room
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Phone: the team that spun picks tiles; everyone else watches.
export function Match3Phone({ state, me, refresh }) {
  const { room, teams } = state
  const match3 = room.match3
  const mine = match3.team_id === me.team_id
  const team = teams.find((t) => t.id === me.team_id)
  const player = teams.find((t) => t.id === match3.team_id)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const done = match3.status === 'done'

  async function pick(tile) {
    if (pending != null) return
    navigator.vibrate?.(40)
    setPending(tile)
    setError('')
    try {
      await pickMatch3Tile(room.id, tile)
    } catch (err) {
      setError(err.message)
    }
    await refresh()
    setPending(null)
  }

  return (
    <div className="player match3-phone" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>
      <p className="allplay-badge">Bonus room</p>
      <p className="caption">
        {done
          ? match3.result
          : mine
            ? 'Tap tiles — first to find 3 of a kind wins it!'
            : `${player?.name} is in the bonus room…`}
      </p>
      <Match3Board match3={match3} onPick={mine && !done ? pick : null} />
      {error && <p className="error">{error}</p>}
    </div>
  )
}
