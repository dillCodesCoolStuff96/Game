// The category grid. Played questions are blank; clicking one offers to reopen it.
export default function BoardView({ board, played, onPick, onReopen }) {
  const rows = Math.max(0, ...board.map((c) => c.questions.length))

  return (
    <div className="board" style={{ '--columns': board.length }}>
      {board.map((category) => (
        <div key={category.id} className="board-category">
          {category.name}
        </div>
      ))}
      {Array.from({ length: rows }, (_, row) =>
        board.map((category) => {
          const q = category.questions[row]
          if (!q) return <div key={`${category.id}-${row}`} className="board-cell empty" />
          const done = played.has(q.id)
          return (
            <button
              key={q.id}
              type="button"
              className={`board-cell ${done ? 'played' : ''}`}
              onClick={() => (done ? onReopen(q) : onPick(q))}
              aria-label={`${category.name} for ${q.value}${done ? ' (played)' : ''}`}
            >
              {done ? '' : q.value}
            </button>
          )
        }),
      )}
    </div>
  )
}
