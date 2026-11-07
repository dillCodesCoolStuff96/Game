// Two images side by side. Differences are circled when revealed; in the
// editor (onAddSpot given) clicking an image marks a difference and clicking
// a marker removes it. Spots are fractions of the image size, so they line up
// at any screen size.
export default function SpotDiffImages({ spotdiff, reveal = false, onAddSpot, onRemoveSpot }) {
  const editing = Boolean(onAddSpot)
  const showSpots = reveal || editing

  function handleClick(event) {
    if (!editing) return
    const rect = event.currentTarget.getBoundingClientRect()
    const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
    onAddSpot({
      x: round((event.clientX - rect.left) / rect.width),
      y: round((event.clientY - rect.top) / rect.height),
    })
  }

  return (
    <div className={`spotdiff ${editing ? 'editing' : ''}`}>
      {[spotdiff.left, spotdiff.right].map((src, side) => (
        <div key={side} className="spotdiff-image">
          {src ? (
            // The wrapper hugs the image so markers line up with it.
            <div className="spotdiff-frame" onClick={handleClick}>
              <img src={src} alt={side === 0 ? 'Original picture' : 'Changed picture'} draggable={false} />
              {showSpots &&
                (spotdiff.spots ?? []).map((spot, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`spot ${reveal ? 'revealed' : ''}`}
                    style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, '--i': i }}
                    tabIndex={editing ? 0 : -1}
                    aria-label={editing ? `Remove difference ${i + 1}` : `Difference ${i + 1}`}
                    onClick={(event) => {
                      if (!editing) return
                      event.stopPropagation()
                      onRemoveSpot(i)
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
            </div>
          ) : (
            <div className="spotdiff-empty">No image yet</div>
          )}
        </div>
      ))}
    </div>
  )
}
