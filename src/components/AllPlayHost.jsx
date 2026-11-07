import { useEffect, useMemo, useRef, useState } from 'react'
import { allPlayStage, suggestVerdicts, tally, useNow, verdict } from '../allplay.js'
import { playAlarm } from '../sounds.js'
import { awardAllPlay, setAllPlayTimer } from '../storage.js'
import { teamColor } from '../teamColors.js'

const formatHelp = {
  list: 'Add as many answers as you can',
  blanks: 'Fill in every box',
  single: 'One answer per team',
}

// TV view of an all-play question: start the countdown, watch answers come in,
// grade them when time's up, and award the square to the team(s) with the most.
// Keys: Space starts / locks · Enter awards points.
export default function AllPlayHost({ question, state, run, controls }) {
  const { room, teams, answers } = state
  const allplay = question.allplay
  const [seconds, setSeconds] = useState(allplay.seconds ?? 60)
  const now = useNow(Boolean(room.allplay_ends_at) && room.phase === 'question')
  const stage = allPlayStage(room, now)
  const remaining = room.allplay_ends_at
    ? Math.max(0, Math.ceil((Date.parse(room.allplay_ends_at) - now) / 1000))
    : seconds

  // The host's ticks override the suggestions from the answer key.
  const suggestions = useMemo(() => suggestVerdicts(allplay, answers), [allplay, answers])
  const filled = answers.filter((a) => a.text.trim())
  const { counts, winners } = tally(teams, filled, suggestions)
  const [overrides, setOverrides] = useState(new Map())
  const judged = (answer) =>
    overrides.has(answer.id) ? overrides.get(answer.id) : verdict(answer, suggestions)
  const graded = tally(
    teams,
    filled.map((a) => ({ ...a, correct: judged(a) })),
    suggestions,
  )

  // Alarm when the countdown hits zero.
  const lastStage = useRef(stage)
  useEffect(() => {
    if (lastStage.current === 'answering' && stage === 'locked') playAlarm()
    lastStage.current = stage
  }, [stage])

  const start = () => run(() => setAllPlayTimer(room.id, seconds))
  const lock = () => run(() => setAllPlayTimer(room.id, 0))
  const award = () =>
    run(() =>
      awardAllPlay(
        room.id,
        graded.winners.map((t) => t.id),
        filled.filter(judged).map((a) => a.id),
      ),
    )
  const toggle = (answer) => {
    if (stage !== 'locked') return
    setOverrides((prev) => new Map(prev).set(answer.id, !judged(answer)))
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea') || event.ctrlKey || event.metaKey) return
      let handler = null
      if (event.code === 'Space' && stage === 'ready') handler = start
      if (event.code === 'Space' && stage === 'answering') handler = lock
      if (event.code === 'Enter' && stage === 'locked') handler = award
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const winnerIds = room.allplay?.winners ?? []
  // Ties split the value evenly, rounded down (matches award_allplay).
  const share = (count) => Math.floor(question.value / Math.max(count, 1))
  const winnerNames = graded.winners.map((t) => t.name).join(' & ')
  const awardLabel =
    graded.winners.length > 1
      ? `Split ${question.value}: ${share(graded.winners.length)} each to ${winnerNames} (Enter)`
      : `Award ${question.value} to ${winnerNames} (Enter)`
  const showGrading = stage === 'locked' || stage === 'results'
  const results = stage === 'results' ? { counts: counts, winners } : graded

  return (
    <>
      <div className="question-view allplay">
        <p className="question-meta">
          <span className="allplay-badge">All play</span> {question.category} ·{' '}
          <strong>{question.value}</strong>
        </p>
        <p className={`question-prompt ${showGrading ? 'small' : ''}`}>{question.prompt}</p>
        {question.image_url && <img className="question-image" src={question.image_url} alt="" />}

        {stage === 'results' && (
          <div className="answer-reveal">
            <p className="answer-text">{question.answer}</p>
            {winnerIds.length ? (
              teams
                .filter((t) => winnerIds.includes(t.id))
                .map((t) => (
                  <p key={t.id} style={{ color: teamColor(teams, t.id) }}>
                    ✓ {t.name} +{share(winnerIds.length)}
                  </p>
                ))
            ) : (
              <p className="muted">Nobody scored</p>
            )}
          </div>
        )}

        {(stage === 'ready' || stage === 'answering') && (
          <>
            <p className="muted">{formatHelp[allplay.format]} on your phones</p>
            {allplay.format === 'blanks' && (
              <ol className="allplay-labels">
                {allplay.items.map((item, i) => (
                  <li key={i}>{item.label}</li>
                ))}
              </ol>
            )}
            <p className={`allplay-clock ${stage === 'answering' && remaining <= 10 ? 'urgent' : ''}`}>
              {remaining}s
            </p>
            {stage === 'answering' && (
              <ul className="allplay-progress">
                {teams.map((t) => {
                  const mine = filled.filter((a) => a.team_id === t.id).length
                  return (
                    <li key={t.id} style={{ '--team': teamColor(teams, t.id) }}>
                      <strong>{t.name}</strong>
                      <span className="muted">
                        {allplay.format === 'list'
                          ? `${mine} answer${mine === 1 ? '' : 's'}`
                          : `${mine} of ${allplay.items.length}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {showGrading && (
          <Grading
            allplay={allplay}
            teams={teams}
            answers={filled}
            judged={stage === 'results' ? (a) => Boolean(a.correct) : judged}
            counts={results.counts}
            onToggle={toggle}
            editable={stage === 'locked'}
          />
        )}
      </div>

      <div className="host-controls">
        {stage === 'ready' && (
          <>
            <button type="button" className="primary big" onClick={start}>
              Start answering (Space)
            </button>
            <span className="answer-time">
              <span className="muted small">Time</span>
              <button type="button" aria-label="Less time" onClick={() => setSeconds(Math.max(10, seconds - 10))}>
                −
              </button>
              <strong>{seconds}s</strong>
              <button type="button" aria-label="More time" onClick={() => setSeconds(seconds + 10)}>
                +
              </button>
            </span>
          </>
        )}
        {stage === 'answering' && (
          <button type="button" className="primary big" onClick={lock}>
            Lock answers now (Space)
          </button>
        )}
        {stage === 'locked' && (
          <>
            <span className="muted small">Tap answers to mark ✓ / ✗</span>
            <button type="button" className="primary big" onClick={award}>
              {graded.winners.length
                ? awardLabel
                : 'Nobody scored — show answer (Enter)'}
            </button>
          </>
        )}
        {controls}
      </div>
    </>
  )
}

function Grading({ allplay, teams, answers, judged, counts, onToggle, editable }) {
  const byTeam = (teamId) => answers.filter((a) => a.team_id === teamId)

  const cell = (answer) =>
    answer ? (
      <button
        key={answer.id}
        type="button"
        className={`allplay-answer ${judged(answer) ? 'right' : 'wrong'}`}
        disabled={!editable}
        onClick={() => onToggle(answer)}
      >
        {judged(answer) ? '✓' : '✗'} {answer.text}
      </button>
    ) : (
      <span className="allplay-answer empty">—</span>
    )

  if (allplay.format === 'list') {
    return (
      <div className="allplay-grid" style={{ '--columns': teams.length }}>
        {teams.map((t) => (
          <div key={t.id} className="allplay-column" style={{ '--team': teamColor(teams, t.id) }}>
            <p className="allplay-team">
              {t.name} <span className="allplay-count">{counts.get(t.id) ?? 0}</span>
            </p>
            {byTeam(t.id).map(cell)}
            {byTeam(t.id).length === 0 && <span className="allplay-answer empty">No answers</span>}
          </div>
        ))}
      </div>
    )
  }

  // Blanks / single: one row per box, one column per team, plus the key.
  return (
    <div className="allplay-table" style={{ '--columns': teams.length }}>
      <span />
      {teams.map((t) => (
        <p key={t.id} className="allplay-team" style={{ '--team': teamColor(teams, t.id) }}>
          {t.name} <span className="allplay-count">{counts.get(t.id) ?? 0}</span>
        </p>
      ))}
      {allplay.items.map((item, slot) => (
        <Row key={slot}>
          <div className="allplay-key">
            {item.label && <strong>{item.label}</strong>}
            <span className="muted">{item.answer.split('/')[0]}</span>
          </div>
          {teams.map((t) => (
            <div key={t.id} style={{ '--team': teamColor(teams, t.id) }}>
              {cell(byTeam(t.id).find((a) => a.slot === slot))}
            </div>
          ))}
        </Row>
      ))}
    </div>
  )
}

// Grid rows are just their cells; this keeps the map above readable.
function Row({ children }) {
  return children
}
