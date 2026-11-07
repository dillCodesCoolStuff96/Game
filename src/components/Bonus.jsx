import { useEffect, useRef, useState } from 'react'
import { useNow } from '../allplay.js'
import { bonusItem } from '../bonus.js'
import { playAlarm, playBlip, playBuzzer } from '../sounds.js'
import {
  bonusChoose,
  bonusFinish,
  bonusMark,
  bonusStart,
  closeBonus,
} from '../storage.js'
import { teamColor } from '../teamColors.js'

// What the team is playing for, e.g. "5 × 5 points per right answer".
const stakes = (bonus) => `${bonus.multiplier} × ${bonus.points_per} points per right answer`

// TV overlay for a bonus game. Keys: Space start · C correct · P pass · Enter continue.
export function BonusTV({ room, teams, decks, run }) {
  const bonus = room.bonus
  const deck = decks.find((d) => d.id === bonus.deck_id)
  const team = teams.find((t) => t.id === bonus.team_id)
  const now = useNow(bonus.status === 'playing', 200)
  const endsAt = bonus.ends_at ? Date.parse(bonus.ends_at) : null
  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : bonus.seconds

  // Show the next item the moment the host presses C/P; the server catches up.
  // A pass sends the item to the back of the line (same as bonus_mark).
  const [local, setLocal] = useState({ index: 0, correct: 0, order: [] })
  const ahead = local.index > (bonus.index ?? 0)
  const index = ahead ? local.index : (bonus.index ?? 0)
  const correct = ahead ? local.correct : (bonus.correct ?? 0)
  const order = (ahead ? local.order : bonus.order) ?? []
  const outOfItems = bonus.order && index >= order.length
  const item = deck && bonusItem({ ...bonus, order }, deck, index)

  function mark(isCorrect) {
    if (bonus.status !== 'playing' || outOfItems || remaining <= 0) return
    if (isCorrect) playBlip()
    setLocal({
      index: index + 1,
      correct: correct + (isCorrect ? 1 : 0),
      order: isCorrect ? order : [...order, order[index]],
    })
    run(() => bonusMark(room.id, isCorrect))
  }

  // End the round once, when time runs out or the items run out.
  const finished = useRef(false)
  useEffect(() => {
    if (bonus.status !== 'playing' || finished.current) return
    if (remaining > 0 && !outOfItems) return
    finished.current = true
    if (remaining <= 0) playAlarm()
    // A moment for the last mark to reach the server before scoring.
    setTimeout(() => run(() => bonusFinish(room.id)), 600)
  }, [bonus.status, remaining, outOfItems, room.id, run])

  useEffect(() => {
    if (bonus.status === 'offer') playBuzzer()
  }, [bonus.status])

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea')) return
      let handler = null
      if (event.code === 'Space' && bonus.status === 'ready') handler = () => run(() => bonusStart(room.id))
      if (event.code === 'KeyC' && bonus.status === 'playing') handler = () => mark(true)
      if (event.code === 'KeyP' && bonus.status === 'playing') handler = () => mark(false)
      if (event.key === 'Enter' && bonus.status === 'done') handler = () => run(() => closeBonus(room.id))
      if (!handler) return
      event.preventDefault()
      event.stopImmediatePropagation()
      handler()
    }
    // Capture phase, so the board's own shortcuts don't also fire.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="wheel-overlay bonus-overlay" style={{ '--team': teamColor(teams, bonus.team_id) }}>
      <p className="wheel-title">
        <span>BONUS GAME!</span> {team?.name}
      </p>
      <p className="bonus-category">{bonus.name}</p>

      {bonus.status === 'offer' && (
        <div className="bonus-offer">
          <p>
            Play for <strong>{stakes(bonus)}</strong> in {bonus.seconds} seconds
          </p>
          <p className="muted">
            or keep the <strong>{bonus.value}</strong> points you just won
          </p>
          <p className="muted small">Decide on your phones</p>
        </div>
      )}

      {bonus.status === 'ready' && (
        <div className="bonus-offer">
          <p>
            Get ready! {bonus.seconds} seconds · {stakes(bonus)}
          </p>
        </div>
      )}

      {bonus.status === 'playing' && (
        <div className="bonus-play">
          <p className={`allplay-clock ${remaining <= 10 ? 'urgent' : ''}`}>{remaining}s</p>
          <div className="bonus-item">
            {outOfItems ? (
              <p className="muted">That's every item!</p>
            ) : item?.image_url ? (
              <img src={item.image_url} alt="" />
            ) : (
              <p>{item?.prompt}</p>
            )}
          </div>
          <p className="bonus-score">
            {correct} right · {bonus.multiplier * correct * bonus.points_per} points
          </p>
        </div>
      )}

      {bonus.status === 'done' && <p className="wheel-result">{bonus.result}</p>}

      <div className="host-controls">
        {bonus.status === 'offer' && (
          <>
            <button type="button" className="secondary" onClick={() => run(() => bonusChoose(room.id, true))}>
              They play
            </button>
            <button type="button" className="secondary" onClick={() => run(() => bonusChoose(room.id, false))}>
              They keep their points
            </button>
          </>
        )}
        {bonus.status === 'ready' && (
          <button type="button" className="primary big" onClick={() => run(() => bonusStart(room.id))}>
            Start (Space)
          </button>
        )}
        {bonus.status === 'playing' && (
          <>
            <button type="button" className="judge correct" onClick={() => mark(true)}>
              ✓ Correct (C)
            </button>
            <button type="button" className="judge wrong" onClick={() => mark(false)}>
              Pass (P)
            </button>
            <button type="button" className="link" onClick={() => run(() => bonusFinish(room.id))}>
              End now
            </button>
          </>
        )}
        {bonus.status === 'done' && (
          <button type="button" className="primary big" onClick={() => run(() => closeBonus(room.id))}>
            Continue (Enter)
          </button>
        )}
        {bonus.status !== 'done' && bonus.status !== 'playing' && (
          <button type="button" className="link" onClick={() => run(() => closeBonus(room.id))}>
            Cancel bonus
          </button>
        )}
      </div>
    </div>
  )
}

// Phone during a bonus game: the team decides play or keep; everyone watches.
export function BonusPhone({ state, me, refresh }) {
  const { room, teams } = state
  const bonus = room.bonus
  const mine = bonus.team_id === me.team_id
  const team = teams.find((t) => t.id === me.team_id)
  const player = teams.find((t) => t.id === bonus.team_id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function choose(play) {
    setBusy(true)
    setError('')
    try {
      await bonusChoose(room.id, play)
    } catch (err) {
      setError(err.message)
    }
    await refresh()
    setBusy(false)
  }

  let body
  if (bonus.status === 'offer' && mine) {
    body = (
      <div className="stack bonus-choice">
        <p className="caption">
          Play <strong>{bonus.name}</strong> for {stakes(bonus)} in {bonus.seconds} seconds?
        </p>
        <button type="button" className="primary big" disabled={busy} onClick={() => choose(true)}>
          Play — trade our {bonus.value} points
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => choose(false)}>
          Keep our {bonus.value} points
        </button>
      </div>
    )
  } else if (bonus.status === 'offer') {
    body = <p className="caption">{player?.name} is deciding whether to play {bonus.name}…</p>
  } else if (bonus.status === 'ready' || bonus.status === 'playing') {
    body = (
      <p className="caption">
        {mine ? 'Shout your answers at the host!' : `${player?.name} is playing ${bonus.name}`}
      </p>
    )
  } else {
    body = <p className="caption wheel-result">{bonus.result}</p>
  }

  return (
    <div className="player" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>
      <p className="allplay-badge">Bonus game</p>
      {body}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
