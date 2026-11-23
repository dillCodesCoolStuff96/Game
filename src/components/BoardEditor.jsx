import { useEffect, useState } from 'react'
import { navigate } from '../nav.js'
import { ensureBoard, loadBoard, updateQuestion, uploadQuestionImage } from '../storage.js'
import BoardView from './BoardView.jsx'
import BonusEditor from './BonusEditor.jsx'
import Match3Editor from './Match3Editor.jsx'
import SpotDiffImages from './SpotDiffImages.jsx'
import WheelEditor from './WheelEditor.jsx'

const typeTag = (q) => {
  if (q.kind === 'allplay') return 'All play'
  if (q.kind === 'drawing') return 'AI drawing'
  if (q.spotdiff) return 'Spot diff'
  return null
}

// Question setup: pick a square, then edit its question. A first piece of the
// full game editor; for now it covers buzz-in and spot-the-difference questions.
export default function BoardEditor() {
  const [boardId, setBoardId] = useState(null)
  const [board, setBoard] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  async function reload() {
    try {
      setBoard(await loadBoard(await ensureBoard()))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    let active = true
    ensureBoard()
      .then(async (id) => {
        const next = await loadBoard(id)
        if (!active) return
        setBoardId(id)
        setBoard(next)
      })
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [])

  const category = (q) => board.find((c) => c.questions.some((x) => x.id === q.id))?.name

  return (
    <div className="editor">
      <header className="editor-header">
        <button type="button" className="link" onClick={() => navigate('?host')}>
          ← Host
        </button>
        <h1>Question setup</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {editing ? (
        <QuestionForm
          key={editing.id}
          question={editing}
          category={category(editing)}
          onDone={async (saved) => {
            if (saved) await reload()
            setEditing(null)
          }}
        />
      ) : board ? (
        <>
          <p className="muted">Click a square to edit it.</p>
          <BoardView
            board={board}
            played={new Set()}
            onPick={setEditing}
            onReopen={setEditing}
            tag={typeTag}
          />
          {boardId && <WheelEditor boardId={boardId} />}
          {boardId && <BonusEditor boardId={boardId} />}
          {boardId && <Match3Editor boardId={boardId} />}
        </>
      ) : (
        <p className="muted">Loading board…</p>
      )}
    </div>
  )
}

function QuestionForm({ question, category, onDone }) {
  const [prompt, setPrompt] = useState(question.prompt)
  const [answer, setAnswer] = useState(question.answer)
  const [spotdiff, setSpotdiff] = useState(question.spotdiff)
  const [drawing, setDrawing] = useState(question.kind === 'drawing')
  const [drawSeconds, setDrawSeconds] = useState(question.allplay?.seconds ?? 180)
  const [drawPrompts, setDrawPrompts] = useState((question.allplay?.prompts ?? []).join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (question.kind === 'allplay') {
    return (
      <div className="card stack editor-form">
        <h2>
          {category} · {question.value} <span className="allplay-badge">All play</span>
        </h2>
        <p>{question.prompt}</p>
        <p className="muted">All-play questions can be edited once the full editor is built.</p>
        <button type="button" className="secondary" onClick={() => onDone(false)}>
          Back
        </button>
      </div>
    )
  }

  async function handleImage(side, file) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const url = await uploadQuestionImage(file)
      setSpotdiff((current) => ({ ...current, [side]: url }))
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!drawing && spotdiff && !(spotdiff.left && spotdiff.right)) {
      setError('Add both pictures, or switch back to a normal question.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await updateQuestion(
        question.id,
        drawing
          ? {
              prompt,
              answer: answer || 'Judged by the AI',
              kind: 'drawing',
              allplay: {
                seconds: drawSeconds,
                prompts: drawPrompts
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              },
              spotdiff: null,
            }
          : { prompt, answer, kind: 'buzz', allplay: null, spotdiff },
      )
      onDone(true)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const spots = spotdiff?.spots ?? []

  return (
    <form className="card stack editor-form" onSubmit={handleSave}>
      <h2>
        {category} · {question.value}
      </h2>

      <div className="segmented">
        <button
          type="button"
          className={!spotdiff && !drawing ? 'selected' : ''}
          onClick={() => {
            setSpotdiff(null)
            setDrawing(false)
          }}
        >
          Buzz-in question
        </button>
        <button
          type="button"
          className={spotdiff && !drawing ? 'selected' : ''}
          onClick={() => {
            setDrawing(false)
            setSpotdiff((current) => current ?? question.spotdiff ?? { left: '', right: '', spots: [] })
          }}
        >
          Spot the difference
        </button>
        <button
          type="button"
          className={drawing ? 'selected' : ''}
          onClick={() => {
            setSpotdiff(null)
            setDrawing(true)
          }}
        >
          AI drawing
        </button>
      </div>

      <label className="field">
        <span>
          {drawing
            ? 'Title on the TV (or the one prompt for everyone)'
            : spotdiff
              ? 'Text shown above the pictures'
              : 'Question'}
        </span>
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            drawing ? 'Secret drawing challenge!' : spotdiff ? 'Spot the 4 differences!' : ''
          }
          required
        />
      </label>

      {drawing && (
        <label className="field">
          <span>Secret prompts, one per line (each team gets a different one)</span>
          <textarea
            rows={5}
            value={drawPrompts}
            onChange={(e) => setDrawPrompts(e.target.value)}
            placeholder={'Santa on summer vacation\nA reindeer at the gym\nThe Grinch doing his taxes'}
          />
          <span className="muted small">
            Leave empty to give every team the title above as their prompt.
          </span>
        </label>
      )}

      {drawing && (
        <label className="field">
          <span>Drawing time (seconds)</span>
          <input
            type="number"
            min="30"
            max="600"
            step="30"
            value={drawSeconds}
            onChange={(e) => setDrawSeconds(Number(e.target.value))}
          />
          <span className="muted small">
            Teams photograph their paper drawing; the AI judge scores them and the best wins.
          </span>
        </label>
      )}

      {spotdiff && !drawing && (
        <>
          <div className="editor-uploads">
            {[
              ['left', 'Original picture'],
              ['right', 'Changed picture'],
            ].map(([side, label]) => (
              <label key={side} className="field">
                <span>{label}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={busy}
                  onChange={(e) => handleImage(side, e.target.files[0])}
                />
              </label>
            ))}
          </div>
          <p className="muted small">
            Click each difference on either picture to mark it. Click a numbered marker to remove
            it. {spots.length} marked.
          </p>
          <SpotDiffImages
            spotdiff={spotdiff}
            onAddSpot={(spot) => setSpotdiff((current) => ({ ...current, spots: [...spots, spot] }))}
            onRemoveSpot={(index) =>
              setSpotdiff((current) => ({
                ...current,
                spots: spots.filter((_, i) => i !== index),
              }))
            }
          />
        </>
      )}

      {!drawing && (
        <label className="field">
          <span>{spotdiff ? 'The differences (shown on your admin phone)' : 'Answer'}</span>
          <textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <div className="editor-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Working…' : 'Save'}
        </button>
        <button type="button" className="secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
