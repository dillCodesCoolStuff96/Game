import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../nav.js'
import { playBlip, playBuzzer } from '../sounds.js'
import {
  backToBoard,
  closeBuzzers,
  expireBuzz,
  judgeAnswer,
  loadBoard,
  openBuzzers,
  reopenQuestion,
  revealAnswer,
  showQuestion,
  undoLastScore,
} from '../storage.js'
import { teamColor } from '../teamColors.js'
import { useAnswerTimer } from '../useAnswerTimer.js'
import { useRoom } from '../useRoom.js'
import BoardView from './BoardView.jsx'
import BuzzList from './BuzzList.jsx'
import TeamSidebar from './TeamSidebar.jsx'

// A buzz still waiting for the host's verdict (not timed out or judged).
const waiting = (b) => !b.expired && !b.result

// The TV view, driven from the host's PC. Keys:
// Space buzzers open/close · C correct · W wrong · A reveal answer · B back to board
// S stop timer · N time the next team · U undo last score
export default function HostScreen({ code }) {
  const { status, state, error, refresh } = useRoom(code)
  const [board, setBoard] = useState(null)
  const [actionError, setActionError] = useState('')

  const room = state?.room
  const buzzes = state?.buzzes

  useEffect(() => {
    if (!room?.board_id) return
    loadBoard(room.board_id)
      .then(setBoard)
      .catch((err) => setActionError(err.message))
  }, [room?.board_id])

  const questions = useMemo(() => {
    const byId = new Map()
    for (const category of board ?? []) {
      for (const q of category.questions) byId.set(q.id, { ...q, category: category.name })
    }
    return byId
  }, [board])
  const question = room?.current_question_id ? questions.get(room.current_question_id) : null

  // When time runs out the alarm plays and the team stays on the clock until
  // the host picks Correct, Wrong or Next team.
  const timer = useAnswerTimer(room?.buzz_round)

  // Buzz ids already heard; null until the first load, so opening the screen
  // mid-round doesn't replay old buzzes.
  const heard = useRef(null)
  useEffect(() => {
    if (!buzzes) return
    const fresh = heard.current ? buzzes.filter((b) => !heard.current.has(b.id)) : []
    heard.current = new Set(buzzes.map((b) => b.id))
    if (fresh.length === 0) return
    // A new buzz that's now first in line (the very first buzz, or a re-buzz
    // when nobody else is waiting) goes straight on the clock.
    const first = buzzes.findIndex(waiting)
    if (first !== -1 && fresh.includes(buzzes[first]) && timer.current?.status !== 'running') {
      playBuzzer()
      timer.start(first)
    } else playBlip()
    // Only new buzzes should trigger this, not timer re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzes])

  // The buzz being judged: the team on the clock (until judged; Next team moves
  // the clock on). With no clock yet, the first team still waiting.
  const onClock = timer.current && buzzes?.[timer.current.index]
  let judgeIndex = buzzes?.findIndex(waiting) ?? -1
  if (onClock) judgeIndex = waiting(onClock) ? timer.current.index : -1

  // Next team in line after the one being timed (or the first, if nobody has
  // been timed yet), skipping buzzes that timed out or were judged.
  const nextAfter = (index) => buzzes?.findIndex((b, i) => i > index && waiting(b)) ?? -1
  const nextIndex = nextAfter(timer.current ? timer.current.index : -1)

  async function run(action) {
    setActionError('')
    try {
      await action()
    } catch (err) {
      setActionError(err.message)
    }
    refresh()
  }

  const actions = {
    toggleBuzzers: () =>
      run(() => (room.buzz_open ? closeBuzzers(room.id) : openBuzzers(room))),
    pick: (q) => run(() => showQuestion(room, q.id)),
    reopen: (q) => {
      if (window.confirm(`Reopen "${q.category}" for ${q.value}?`)) {
        run(() => reopenQuestion(room.id, q.id))
      }
    },
    correct: () => {
      if (judgeIndex === -1) return
      timer.stop()
      run(() => judgeAnswer(buzzes[judgeIndex].id, true))
    },
    // Penalty only; the host presses Next team to put the next team on the clock.
    wrong: () => {
      if (judgeIndex === -1) return
      timer.stop()
      run(() => judgeAnswer(buzzes[judgeIndex].id, false))
    },
    reveal: () => {
      timer.stop()
      run(() => revealAnswer(room.id))
    },
    backToBoard: () => {
      timer.stop()
      run(() => backToBoard(room.id))
    },
    undo: () => run(() => undoLastScore(room.id)),
    // Time the next team in line. If the team on the clock wasn't judged, they're
    // skipped without a penalty (and may buzz again).
    timeNext: () => {
      const skipped = onClock && waiting(onClock) ? onClock : null
      if (nextIndex !== -1) timer.start(nextIndex)
      else timer.stop()
      if (skipped) run(() => expireBuzz(skipped.id))
    },
  }

  useEffect(() => {
    function onKey(event) {
      if (!room || event.target.closest?.('input, textarea')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const inQuestion = room.phase === 'question'
      const keys = {
        Space: inQuestion && actions.toggleBuzzers,
        KeyC: inQuestion && actions.correct,
        KeyW: inQuestion && actions.wrong,
        KeyA: inQuestion && actions.reveal,
        KeyB: room.phase !== 'board' && actions.backToBoard,
        KeyS: timer.stop,
        KeyN: actions.timeNext,
        KeyU: actions.undo,
      }
      const handler = keys[event.code]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (status === 'missing') {
    return (
      <div className="screen">
        <p>No game found with code {code}.</p>
        <button type="button" className="link" onClick={() => navigate('?host')}>
          ← Back
        </button>
      </div>
    )
  }
  if (!state) return <div className="screen muted">{error || 'Loading…'}</div>

  const { teams } = state
  const pickingTeam = teams.find((t) => t.id === room.picking_team_id)

  return (
    <div className="tv">
      <TeamSidebar code={code} state={state} refresh={refresh} />

      <main className="tv-main">
        {!room.board_id ? (
          <p className="muted">This game has no board. Start a new game from the host page.</p>
        ) : room.phase === 'board' || !question ? (
          <>
            <h2 className="tv-heading">
              {pickingTeam ? (
                <>
                  <span style={{ color: teamColor(teams, pickingTeam.id) }}>{pickingTeam.name}</span>
                  's pick
                </>
              ) : (
                'Pick a question'
              )}
            </h2>
            {board ? (
              <BoardView
                board={board}
                played={state.played}
                onPick={actions.pick}
                onReopen={(q) => actions.reopen(questions.get(q.id))}
              />
            ) : (
              <p className="muted">Loading board…</p>
            )}
          </>
        ) : (
          <QuestionView
            question={question}
            phase={room.phase}
            state={state}
            timer={timer}
          />
        )}

        <div className="host-controls">
          {room.phase === 'question' && (
            <>
              <button type="button" className="primary big" onClick={actions.toggleBuzzers}>
                {room.buzz_open ? 'Close buzzers' : 'Open buzzers'} (Space)
              </button>
              {judgeIndex !== -1 && (
                <>
                  <button type="button" className="judge correct" onClick={actions.correct}>
                    ✓ Correct (C)
                  </button>
                  <button type="button" className="judge wrong" onClick={actions.wrong}>
                    ✗ Wrong (W)
                  </button>
                </>
              )}
              {timer.current?.status === 'running' && (
                <button type="button" className="secondary" onClick={timer.stop}>
                  Stop timer (S)
                </button>
              )}
              {(nextIndex !== -1 || (onClock && waiting(onClock))) && (
                <button type="button" className="secondary" onClick={actions.timeNext}>
                  {timer.current ? 'Next team' : 'Start timer'} (N)
                </button>
              )}
              <button type="button" className="secondary" onClick={actions.reveal}>
                Reveal answer (A)
              </button>
              {/* Leaves the question unplayed, e.g. after picking the wrong square. */}
              <button type="button" className="secondary" onClick={actions.backToBoard}>
                Back to board (B)
              </button>
            </>
          )}
          {room.phase === 'answer' && (
            <button type="button" className="primary big" onClick={actions.backToBoard}>
              Back to board (B)
            </button>
          )}
          <button type="button" className="secondary" onClick={actions.undo}>
            Undo last score (U)
          </button>
          <span className="answer-time">
            <span className="muted small">Answer time</span>
            <button
              type="button"
              aria-label="Less time"
              onClick={() => timer.setSeconds(timer.seconds - 1)}
            >
              −
            </button>
            <strong>{timer.seconds}s</strong>
            <button
              type="button"
              aria-label="More time"
              onClick={() => timer.setSeconds(timer.seconds + 1)}
            >
              +
            </button>
          </span>
          <button type="button" className="link" onClick={() => navigate('?host')}>
            ← Games
          </button>
        </div>
        {(actionError || error) && <p className="error">{actionError || error}</p>}
      </main>
    </div>
  )
}

function QuestionView({ question, phase, state, timer }) {
  const { room, buzzes } = state
  const winner = buzzes.find((b) => b.result === 'correct')
  const winnerTeam = winner && state.teams.find((t) => t.id === winner.team_id)

  return (
    <div className="question-view">
      <p className="question-meta">
        {question.category} · <strong>{question.value}</strong>
      </p>
      <p className={`question-prompt ${phase === 'answer' ? 'small' : ''}`}>{question.prompt}</p>
      {question.image_url && <img className="question-image" src={question.image_url} alt="" />}

      {phase === 'answer' ? (
        <div className="answer-reveal">
          <p className="answer-text">{question.answer}</p>
          {winnerTeam ? (
            <p style={{ color: teamColor(state.teams, winnerTeam.id) }}>
              ✓ {winnerTeam.name} +{question.value}
            </p>
          ) : (
            <p className="muted">Nobody got it</p>
          )}
        </div>
      ) : (
        <p className={`buzz-state small ${room.buzz_open ? 'open' : ''}`}>
          {room.buzz_open ? 'Buzzers open!' : 'Buzzers closed'}
        </p>
      )}

      <BuzzList state={state} timer={timer} value={question.value} />
    </div>
  )
}
