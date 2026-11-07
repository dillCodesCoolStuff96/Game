import { useEffect, useRef, useState } from 'react'
import { allPlayStage, useNow } from '../allplay.js'
import { addAllPlayAnswer, removeAllPlayAnswer, setAllPlayAnswer } from '../storage.js'
import { teamColor } from '../teamColors.js'

// A team's shared answer sheet for an all-play question. Any phone on the
// team can add or edit answers; teammates see each other's changes live.
export default function AllPlayPhone({ state, me, refresh }) {
  const { room, teams, answers } = state
  const allplay = room.allplay
  const team = teams.find((t) => t.id === me.team_id)
  const now = useNow(Boolean(room.allplay_ends_at) && room.phase === 'question')
  const stage = allPlayStage(room, now)
  const remaining = room.allplay_ends_at
    ? Math.max(0, Math.ceil((Date.parse(room.allplay_ends_at) - now) / 1000))
    : null
  const [error, setError] = useState('')

  // The server only sends this team's answers, but filter anyway.
  const ours = answers.filter((a) => a.team_id === me.team_id)

  async function save(action) {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
    }
    refresh()
  }

  const winners = allplay.winners ?? []
  const editable = stage === 'answering'

  return (
    <div className="player allplay-phone" style={{ '--team': teamColor(teams, me.team_id) }}>
      <header className="player-header">
        <span className="team-name">{team?.name}</span>
        <span className="team-score">{team?.score} pts</span>
      </header>

      <p className="allplay-badge">All play</p>
      <p className="allplay-phone-prompt">{allplay.prompt}</p>

      {stage === 'ready' && <p className="caption">Get ready — answers open soon</p>}
      {stage === 'answering' && (
        <p className={`allplay-clock small ${remaining <= 10 ? 'urgent' : ''}`}>{remaining}s</p>
      )}
      {stage === 'locked' && <p className="caption">Answers locked — waiting for the host</p>}
      {stage === 'results' && (
        <p className="caption">
          {winners.includes(me.team_id)
            ? 'Your team won this one!'
            : winners.length
              ? `${teams
                  .filter((t) => winners.includes(t.id))
                  .map((t) => t.name)
                  .join(' & ')} won this one`
              : 'Nobody scored'}
        </p>
      )}

      {stage !== 'ready' &&
        (allplay.format === 'list' ? (
          <ListSheet room={room} answers={ours} editable={editable} save={save} />
        ) : (
          <BoxSheet room={room} answers={ours} editable={editable} save={save} />
        ))}

      {error && <p className="error">{error}</p>}
    </div>
  )
}

function Mark({ answer }) {
  if (answer.correct === true) return <span className="mark right">✓</span>
  if (answer.correct === false) return <span className="mark wrong">✗</span>
  return null
}

function ListSheet({ room, answers, editable, save }) {
  const [text, setText] = useState('')
  const filled = answers.filter((a) => a.text.trim())

  function handleAdd(event) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    setText('')
    save(() => addAllPlayAnswer(room.id, value))
  }

  return (
    <div className="allplay-sheet">
      {editable && (
        <form className="allplay-add" onSubmit={handleAdd}>
          <input
            placeholder="Type an answer"
            maxLength={100}
            autoComplete="off"
            enterKeyHint="send"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="primary">
            Add
          </button>
        </form>
      )}
      <p className="muted small">
        {filled.length} answer{filled.length === 1 ? '' : 's'}
      </p>
      <ul className="allplay-list">
        {filled.map((a) => (
          <li key={a.id}>
            <span>{a.text}</span>
            <Mark answer={a} />
            {editable && (
              <button
                type="button"
                className="remove"
                aria-label={`Remove ${a.text}`}
                onClick={() => save(() => removeAllPlayAnswer(a.id))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Blanks (labelled boxes) or a single box. Typing saves after a short pause
// and when leaving the box; while you type, teammates' edits to that box
// don't overwrite yours.
function BoxSheet({ room, answers, editable, save }) {
  const labels = room.allplay.format === 'single' ? [''] : room.allplay.labels
  const [drafts, setDrafts] = useState({})
  const [focused, setFocused] = useState(null)
  const timers = useRef({})

  useEffect(() => {
    const pending = timers.current
    return () => Object.values(pending).forEach(clearTimeout)
  }, [])

  const saved = (slot) => answers.find((a) => a.slot === slot)

  function commit(slot, value) {
    clearTimeout(timers.current[slot])
    if (value === (saved(slot)?.text ?? '')) return
    save(() => setAllPlayAnswer(room.id, slot, value))
  }

  function handleChange(slot, value) {
    setDrafts((d) => ({ ...d, [slot]: value }))
    clearTimeout(timers.current[slot])
    timers.current[slot] = setTimeout(() => commit(slot, value), 600)
  }

  return (
    <div className="allplay-sheet">
      {labels.map((label, slot) => {
        const answer = saved(slot)
        const value = focused === slot ? (drafts[slot] ?? '') : (answer?.text ?? '')
        return (
          <label key={slot} className="allplay-box">
            {label && <span>{label}</span>}
            <span className="allplay-box-input">
              <input
                placeholder={label ? 'Your answer' : 'Type your answer'}
                maxLength={100}
                autoComplete="off"
                value={value}
                readOnly={!editable}
                onFocus={() => {
                  setFocused(slot)
                  setDrafts((d) => ({ ...d, [slot]: answer?.text ?? '' }))
                }}
                onChange={(e) => handleChange(slot, e.target.value)}
                onBlur={() => {
                  if (editable) commit(slot, drafts[slot] ?? '')
                  setFocused(null)
                }}
              />
              {answer && <Mark answer={answer} />}
            </span>
          </label>
        )
      })}
    </div>
  )
}
