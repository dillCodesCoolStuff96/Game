import { useEffect, useState } from 'react'
import { loadWheel, saveWheel } from '../storage.js'
import { defaultWheel, sliceTypes } from '../wheel.js'
import { WheelGraphic } from './Wheel.jsx'

// Wheel setup: how often it comes up after a correct answer, and its slices.
export default function WheelEditor({ boardId }) {
  const [wheel, setWheel] = useState(null)
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadWheel(boardId)
      .then((w) => {
        setWheel(w)
        setSaved(w)
      })
      .catch((err) => setMessage(err.message))
  }, [boardId])

  if (!wheel) return null

  const dirty = JSON.stringify(wheel) !== JSON.stringify(saved)
  const setSlice = (index, slice) =>
    setWheel({ ...wheel, slices: wheel.slices.map((s, i) => (i === index ? slice : s)) })

  async function handleSave() {
    setBusy(true)
    setMessage('')
    try {
      await saveWheel(boardId, wheel)
      setSaved(wheel)
      setMessage('Saved')
    } catch (err) {
      setMessage(err.message)
    }
    setBusy(false)
  }

  return (
    <section className="card stack wheel-editor">
      <h2>Wheel</h2>

      <label className="field wheel-chance">
        <span>Chance the wheel comes up after a correct answer</span>
        <span className="wheel-chance-row">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(wheel.chance * 100)}
            onChange={(e) => setWheel({ ...wheel, chance: Number(e.target.value) / 100 })}
          />
          <strong>{Math.round(wheel.chance * 100)}%</strong>
        </span>
      </label>

      <div className="wheel-editor-body">
        <ol className="wheel-slices">
          {wheel.slices.map((slice, i) => {
            const type = sliceTypes[slice.type]
            return (
              <li key={i}>
                <select
                  value={slice.type}
                  onChange={(e) => {
                    const next = { type: e.target.value }
                    if (sliceTypes[next.type].hasAmount) next.amount = slice.amount ?? 100
                    setSlice(i, next)
                  }}
                >
                  {Object.entries(sliceTypes).map(([key, t]) => (
                    <option key={key} value={key}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {type?.hasAmount && (
                  <input
                    type="number"
                    min="0"
                    step="50"
                    aria-label="Amount"
                    value={slice.amount}
                    onChange={(e) => setSlice(i, { ...slice, amount: Math.max(0, Number(e.target.value)) })}
                  />
                )}
                <button
                  type="button"
                  className="remove"
                  aria-label="Remove slice"
                  onClick={() => setWheel({ ...wheel, slices: wheel.slices.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ol>
        <div className="wheel-preview">
          {wheel.slices.length > 0 ? (
            <WheelGraphic slices={wheel.slices} />
          ) : (
            <p className="muted">Add some slices</p>
          )}
        </div>
      </div>

      <div className="editor-actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setWheel({ ...wheel, slices: [...wheel.slices, { type: 'points', amount: 100 }] })
          }
        >
          Add slice
        </button>
        <button type="button" className="secondary" onClick={() => setWheel(defaultWheel)}>
          Reset to default
        </button>
        <button type="button" className="primary" disabled={busy || !dirty} onClick={handleSave}>
          {busy ? 'Saving…' : 'Save wheel'}
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </section>
  )
}
