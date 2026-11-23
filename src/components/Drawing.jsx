import { useEffect, useRef, useState } from 'react'
import { allPlayStage, useNow } from '../allplay.js'
import { drawingPrompt } from '../drawing.js'
import { playAlarm, playBlip, playBuzzer } from '../sounds.js'
import { awardAllPlay, judgeDrawings, setAllPlayTimer, submitDrawing } from '../storage.js'
import { teamColor } from '../teamColors.js'

const REVEAL_MS = 2800

// Teams with the best score (none if nothing was scored).
function topScorers(drawings) {
  const best = Math.max(0, ...drawings.map((d) => d.score ?? 0))
  return best > 0 ? drawings.filter((d) => d.score === best).map((d) => d.team_id) : []
}

// TV view of a drawing question: start the clock, collect photos, ask the AI
// judge, reveal its verdicts one by one, then award the winner(s).
// Keys: Space starts / locks · J asks the judge · Enter awards.
export default function DrawingHost({ question, state, run, controls }) {
  const { room, teams, drawings } = state
  const [seconds, setSeconds] = useState(room.allplay.seconds ?? 180)
  const now = useNow(Boolean(room.allplay_ends_at) && room.phase === 'question')
  const stage = allPlayStage(room, now)
  const remaining = room.allplay_ends_at
    ? Math.max(0, Math.ceil((Date.parse(room.allplay_ends_at) - now) / 1000))
    : seconds
  const judged = Boolean(room.allplay.judged)
  const [judging, setJudging] = useState(false)

  // Reveal the verdicts one at a time once they arrive.
  const [revealed, setRevealed] = useState(judged ? drawings.length : 0)
  useEffect(() => {
    if (!judged || revealed >= drawings.length) return
    const id = setTimeout(() => {
      playBlip()
      setRevealed((n) => n + 1)
    }, revealed === 0 ? 600 : REVEAL_MS)
    return () => clearTimeout(id)
  }, [judged, revealed, drawings.length])
  const allRevealed = judged && revealed >= drawings.length

  // The host can override the judge by clicking drawings.
  const [chosen, setChosen] = useState(null)
  const winners = chosen ?? topScorers(drawings)
  const share = Math.floor(question.value / Math.max(winners.length, 1))

  // Alarm when time runs out.
  const lastStage = useRef(stage)
  useEffect(() => {
    if (lastStage.current === 'answering' && stage === 'locked') playAlarm()
    lastStage.current = stage
  }, [stage])

  const start = () => run(() => setAllPlayTimer(room.id, seconds))
  const lock = () => run(() => setAllPlayTimer(room.id, 0))
  const judge = () => {
    if (judging || !drawings.length) return
    setJudging(true)
    playBuzzer()
    run(async () => {
      try {
        await judgeDrawings(room.id)
      } finally {
        setJudging(false)
      }
    })
  }
  const award = () => run(() => awardAllPlay(room.id, winners, []))
  const toggleWinner = (teamId) => {
    if (stage !== 'locked' || !allRevealed) return
    setChosen(winners.includes(teamId) ? winners.filter((id) => id !== teamId) : [...winners, teamId])
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea') || event.ctrlKey || event.metaKey) return
      let handler = null
      if (event.code === 'Space' && stage === 'ready') handler = start
      if (event.code === 'Space' && stage === 'answering') handler = lock
      if (event.code === 'KeyJ' && stage === 'locked' && !judged) handler = judge
      if (event.code === 'Enter' && stage === 'locked' && allRevealed) handler = award
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const resultWinners = room.allplay.winners ?? []
  const shownWinners = stage === 'results' ? resultWinners : allRevealed ? winners : []
  const winnerNames = teams
    .filter((t) => winners.includes(t.id))
    .map((t) => t.name)
    .join(' & ')

  return (
    <>
      <div className="question-view drawing-view">
        <p className="question-meta">
          <span className="allplay-badge">AI drawing</span> {question.category} ·{' '}
          <strong>{question.value}</strong>
        </p>
        <p className={`question-prompt ${stage === 'ready' || stage === 'answering' ? '' : 'small'}`}>
          {question.prompt}
        </p>
        {room.allplay.assignments && (stage === 'ready' || stage === 'answering') && (
          <p className="muted">Each team has a secret prompt on their phone 🤫</p>
        )}

        {stage === 'ready' && (
          <p className="muted">Grab paper and a pen. Each team picks one artist!</p>
        )}
        {stage === 'answering' && (
          <>
            <p className={`allplay-clock ${remaining <= 15 ? 'urgent' : ''}`}>
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </p>
            <ul className="allplay-progress">
              {teams.map((t) => (
                <li key={t.id} style={{ '--team': teamColor(teams, t.id) }}>
                  <strong>{t.name}</strong>
                  <span className="muted">
                    {drawings.some((d) => d.team_id === t.id) ? '📷 Photo in' : 'Drawing…'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {(stage === 'locked' || stage === 'results') && (
          <>
            {judging && <p className="judge-thinking">The AI judge is studying the art…</p>}
            <div className="drawing-gallery" style={{ '--count': Math.max(drawings.length, 1) }}>
              {drawings.map((d, i) => {
                const team = teams.find((t) => t.id === d.team_id)
                const shown = stage === 'results' || i < revealed
                const won = shownWinners.includes(d.team_id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`drawing-card ${won ? 'winner' : ''}`}
                    style={{ '--team': teamColor(teams, d.team_id) }}
                    onClick={() => toggleWinner(d.team_id)}
                  >
                    <img src={d.image_url} alt={`${team?.name}'s drawing`} />
                    <span className="drawing-team">{team?.name}</span>
                    {room.allplay.assignments && (
                      <span className="drawing-prompt">“{drawingPrompt(room.allplay, d.team_id)}”</span>
                    )}
                    {judged && shown && d.score != null ? (
                      <span className="drawing-verdict">
                        <strong>{d.score}/10</strong>
                        <span>{d.comment}</span>
                      </span>
                    ) : (
                      judged && <span className="drawing-verdict muted">…</span>
                    )}
                    {won && <span className="drawing-crown">👑</span>}
                  </button>
                )
              })}
              {drawings.length === 0 && <p className="muted">No drawings were handed in.</p>}
            </div>
          </>
        )}
      </div>

      <div className="host-controls">
        {stage === 'ready' && (
          <>
            <button type="button" className="primary big" onClick={start}>
              Start drawing (Space)
            </button>
            <span className="answer-time">
              <span className="muted small">Time</span>
              <button type="button" aria-label="Less time" onClick={() => setSeconds(Math.max(30, seconds - 30))}>
                −
              </button>
              <strong>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </strong>
              <button type="button" aria-label="More time" onClick={() => setSeconds(seconds + 30)}>
                +
              </button>
            </span>
          </>
        )}
        {stage === 'answering' && (
          <button type="button" className="primary big" onClick={lock}>
            Pens down (Space)
          </button>
        )}
        {stage === 'locked' && !judged && (
          <button
            type="button"
            className="primary big"
            disabled={judging || !drawings.length}
            onClick={judge}
          >
            {judging ? 'Judging…' : 'Ask the AI judge (J)'}
          </button>
        )}
        {stage === 'locked' && allRevealed && (
          <>
            <span className="muted small">Click drawings to change the winner</span>
            <button type="button" className="primary big" onClick={award}>
              {winners.length === 0
                ? 'No winner — show results (Enter)'
                : winners.length > 1
                  ? `Split ${question.value}: ${share} each to ${winnerNames} (Enter)`
                  : `Award ${question.value} to ${winnerNames} (Enter)`}
            </button>
          </>
        )}
        {controls}
      </div>
    </>
  )
}

// Phone during a drawing question: one photo per team, retakes allowed until
// time's up; afterwards the team sees its score and the judge's comment.
export function DrawingPhone({ state, me, refresh }) {
  const { room, teams, drawings } = state
  const team = teams.find((t) => t.id === me.team_id)
  const now = useNow(Boolean(room.allplay_ends_at) && room.phase === 'question')
  const stage = allPlayStage(room, now)
  const remaining = room.allplay_ends_at
    ? Math.max(0, Math.ceil((Date.parse(room.allplay_ends_at) - now) / 1000))
    : null
  const ours = drawings.find((d) => d.team_id === me.team_id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const winners = room.allplay.winners ?? []

  async function handlePhoto(file) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await submitDrawing(room.id, file)
    } catch (err) {
      setError(err.message)
    }
    await refresh()
    setBusy(false)
  }

  return (
    <div className="player allplay-phone" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>
      <p className="allplay-badge">AI drawing</p>
      {room.allplay.assignments?.[me.team_id] && <p className="muted small secret-label">Your secret prompt</p>}
      <p className="allplay-phone-prompt">{drawingPrompt(room.allplay, me.team_id)}</p>

      {stage === 'ready' && <p className="caption">Get paper ready and pick one artist!</p>}
      {stage === 'answering' && (
        <p className={`allplay-clock small ${remaining <= 15 ? 'urgent' : ''}`}>
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </p>
      )}

      {ours && <img className="drawing-preview" src={ours.image_url} alt="Your team's drawing" />}

      {stage === 'answering' && (
        <label className={`primary big photo-button ${busy ? 'busy' : ''}`}>
          {busy ? 'Uploading…' : ours ? '📷 Retake photo' : '📷 Take a photo of your drawing'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              handlePhoto(e.target.files[0])
              e.target.value = ''
            }}
          />
        </label>
      )}

      {stage === 'locked' && !ours?.score && (
        <p className="caption">
          {ours ? "Pens down! Waiting for the AI judge…" : 'Time’s up — no photo was handed in'}
        </p>
      )}
      {ours?.score != null && stage === 'results' && (
        <div className="drawing-phone-verdict">
          <strong>{ours.score}/10</strong>
          <span>{ours.comment}</span>
        </div>
      )}
      {stage === 'results' && (
        <p className="caption">
          {winners.includes(me.team_id) ? 'Your team won this one! 👑' : 'Results are on the TV'}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
