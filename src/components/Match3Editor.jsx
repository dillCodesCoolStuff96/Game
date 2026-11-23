import { useEffect, useState } from 'react'
import { loadMatch3, saveMatch3 } from '../storage.js'

const defaultMatch3 = {
  symbols: [
    { emoji: '🎄', points: 100, count: 7 },
    { emoji: '🎁', points: 250, count: 6 },
    { emoji: '⭐', points: 500, count: 4 },
    { emoji: '👑', points: 1000, count: 3 },
  ],
}

// Bonus room setup: each symbol's prize and how many tiles carry it.
export default function Match3Editor({ boardId }) {
  const [match3, setMatch3] = useState(null)
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadMatch3(boardId)
      .then((m) => {
        setMatch3(m)
        setSaved(m)
      })
      .catch((err) => setMessage(err.message))
  }, [boardId])

  if (!match3) return null

  const dirty = JSON.stringify(match3) !== JSON.stringify(saved)
  const total = match3.symbols.reduce((sum, s) => sum + (s.count || 0), 0)
  const setSymbol = (index, fields) =>
    setMatch3({ symbols: match3.symbols.map((s, i) => (i === index ? { ...s, ...fields } : s)) })

  async function handleSave() {
    setBusy(true)
    setMessage('')
    try {
      await saveMatch3(boardId, match3)
      setSaved(match3)
      setMessage('Saved')
    } catch (err) {
      setMessage(err.message)
    }
    setBusy(false)
  }

  return (
    <section className="card stack">
      <h2>Bonus room</h2>
      <p className="muted small">
        A wheel slice. The team flips hidden tiles until one symbol turns up 3 times and wins its
        prize. Give cheaper prizes more tiles so they're found first more often.
      </p>

      <ol className="wheel-slices match3-symbols">
        {match3.symbols.map((s, i) => (
          <li key={i}>
            <input
              aria-label="Symbol"
              className="match3-emoji-input"
              value={s.emoji}
              maxLength={4}
              onChange={(e) => setSymbol(i, { emoji: e.target.value })}
            />
            <label>
              <span className="muted small">Prize</span>
              <input
                type="number"
                step="50"
                value={s.points}
                onChange={(e) => setSymbol(i, { points: Number(e.target.value) })}
              />
            </label>
            <label>
              <span className="muted small">Tiles</span>
              <input
                type="number"
                min="3"
                max="12"
                value={s.count}
                onChange={(e) => setSymbol(i, { count: Math.max(0, Number(e.target.value)) })}
              />
            </label>
            <button
              type="button"
              className="remove"
              aria-label="Remove symbol"
              onClick={() => setMatch3({ symbols: match3.symbols.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {total} tiles in total
        {match3.symbols.some((s) => s.count < 3) && ' · symbols with fewer than 3 tiles can never win'}
      </p>

      <div className="editor-actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setMatch3({ symbols: [...match3.symbols, { emoji: '🍪', points: 100, count: 3 }] })
          }
        >
          Add symbol
        </button>
        <button type="button" className="secondary" onClick={() => setMatch3(defaultMatch3)}>
          Reset to default
        </button>
        <button type="button" className="primary" disabled={busy || !dirty} onClick={handleSave}>
          {busy ? 'Saving…' : 'Save bonus room'}
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </section>
  )
}
