import { useEffect, useState } from 'react'
import { deleteBonusDeck, loadBonusDecks, saveBonusDeck, uploadQuestionImage } from '../storage.js'

const newDeck = (boardId) => ({
  board_id: boardId,
  name: 'New bonus game',
  difficulty: null,
  points_per: 5,
  seconds: 60,
  items: [],
})

// "nike-logo.png" -> "nike logo"
const answerFromFileName = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()

// Bonus game decks: one per rapid-fire category (logos, sports, celebrities…).
export default function BonusEditor({ boardId }) {
  const [decks, setDecks] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadBonusDecks(boardId)
      .then(setDecks)
      .catch((err) => setError(err.message))
  }, [boardId])

  if (!decks) return null

  async function handleSaved() {
    setDecks(await loadBonusDecks(boardId))
    setEditing(null)
  }

  return (
    <section className="card stack bonus-editor">
      <h2>Bonus games</h2>
      <p className="muted small">
        When the wheel lands on Bonus game, one of these is picked at random. Teams can trade the
        points they just won to play: (points won ÷ 100) × right answers × points each.
      </p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <DeckForm
          key={editing.id ?? 'new'}
          deck={editing}
          onCancel={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : (
        <>
          <ul className="room-list">
            {decks.map((deck) => (
              <li key={deck.id}>
                <button type="button" onClick={() => setEditing(deck)}>
                  <strong>{deck.name}</strong>
                  <span className="muted">
                    {deck.items.length} items · {deck.points_per} pts each · {deck.seconds}s
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="secondary" onClick={() => setEditing(newDeck(boardId))}>
            Add a bonus game
          </button>
        </>
      )}
    </section>
  )
}

function DeckForm({ deck: initial, onCancel, onSaved }) {
  const [deck, setDeck] = useState(initial)
  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const set = (fields) => setDeck((d) => ({ ...d, ...fields }))
  const setItem = (index, fields) =>
    set({ items: deck.items.map((item, i) => (i === index ? { ...item, ...fields } : item)) })

  // "France = Paris" per line (an answer-less line uses the prompt as the answer).
  function addBulk() {
    const items = bulk
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [prompt, ...rest] = line.split('=')
        return { prompt: prompt.trim(), answer: (rest.join('=') || prompt).trim() }
      })
    set({ items: [...deck.items, ...items] })
    setBulk('')
  }

  async function addPictures(files) {
    setBusy('Uploading pictures…')
    setError('')
    try {
      const added = []
      for (const file of files) {
        added.push({ image_url: await uploadQuestionImage(file), answer: answerFromFileName(file.name) })
      }
      setDeck((d) => ({ ...d, items: [...d.items, ...added] }))
    } catch (err) {
      setError(err.message)
    }
    setBusy('')
  }

  async function handleSave() {
    setBusy('Saving…')
    setError('')
    try {
      await saveBonusDeck(deck)
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy('')
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${deck.name}"?`)) return
    await deleteBonusDeck(deck.id)
    onSaved()
  }

  return (
    <div className="stack">
      <div className="deck-settings">
        <label className="field">
          <span>Name</span>
          <input value={deck.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Points per right answer</span>
          <input
            type="number"
            min="0"
            value={deck.points_per}
            onChange={(e) => set({ points_per: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>Seconds</span>
          <input
            type="number"
            min="10"
            max="600"
            step="5"
            value={deck.seconds}
            onChange={(e) => set({ seconds: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Difficulty (for later)</span>
          <select
            value={deck.difficulty ?? ''}
            onChange={(e) => set({ difficulty: e.target.value || null })}
          >
            <option value="">—</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>

      <p className="field-label">{deck.items.length} items</p>
      <ol className="deck-items">
        {deck.items.map((item, i) => (
          <li key={i}>
            {item.image_url ? (
              <img src={item.image_url} alt="" />
            ) : (
              <input
                aria-label="Shown on TV"
                value={item.prompt ?? ''}
                onChange={(e) => setItem(i, { prompt: e.target.value })}
              />
            )}
            <span className="muted">→</span>
            <input
              aria-label="Answer"
              value={item.answer}
              onChange={(e) => setItem(i, { answer: e.target.value })}
            />
            <button
              type="button"
              className="remove"
              aria-label="Remove item"
              onClick={() => set({ items: deck.items.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <div className="deck-add">
        <label className="field">
          <span>Add text items, one per line: shown on TV = answer</span>
          <textarea
            rows={3}
            placeholder={'France = Paris\nJapan = Tokyo'}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
        </label>
        <button type="button" className="secondary" disabled={!bulk.trim()} onClick={addBulk}>
          Add these
        </button>
        <label className="field">
          <span>Or add pictures (e.g. logos); the file name becomes the answer</span>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={Boolean(busy)}
            onChange={(e) => addPictures([...e.target.files])}
          />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={handleSave}>
          {busy || 'Save bonus game'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {deck.id && (
          <button type="button" className="link danger-link" onClick={handleDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
