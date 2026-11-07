import { useEffect, useState } from 'react'
import { playBuzzer, playDing } from '../sounds.js'
import { closeWheel, resolveWheel, spinWheel, startBonus, wheelSteal } from '../storage.js'
import { teamColor } from '../teamColors.js'
import { sliceColor, sliceLabel } from '../wheel.js'

const SPIN_MS = 6000

// The wheel drawing. Slice 0 starts at the top and slices go clockwise; the
// pointer is at the top. `rotation` turns the whole wheel clockwise.
export function WheelGraphic({ slices, rotation = 0, spinning = false }) {
  const step = 360 / Math.max(slices.length, 1)
  const point = (angle, radius) => {
    const rad = (angle * Math.PI) / 180
    return [radius * Math.sin(rad), -radius * Math.cos(rad)]
  }
  const fontSize = slices.length > 12 ? 7 : 9

  return (
    <svg className="wheel-graphic" viewBox="-105 -112 210 217" role="img" aria-label="Wheel">
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          // Turn around the wheel centre (0,0 in the viewBox).
          transformBox: 'view-box',
          transformOrigin: '0px 0px',
          transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.6, 0.1, 1)` : 'none',
        }}
      >
        {slices.map((slice, i) => {
          const [x1, y1] = point(i * step, 98)
          const [x2, y2] = point((i + 1) * step, 98)
          const mid = (i + 0.5) * step
          return (
            <g key={i}>
              <path
                d={`M0 0 L${x1} ${y1} A98 98 0 ${step > 180 ? 1 : 0} 1 ${x2} ${y2} Z`}
                fill={sliceColor(slice, i)}
                stroke="#0b1020"
                strokeWidth="1.2"
              />
              <text
                // Flip labels on the left half so none are upside down.
                transform={`rotate(${mid - 90}) translate(60 0)${mid > 180 ? ' rotate(180)' : ''}`}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fontSize}
                fontWeight="800"
                fill="#fff"
              >
                {sliceLabel(slice)}
              </text>
            </g>
          )
        })}
        <circle r="98" fill="none" stroke="#f5c542" strokeWidth="3" />
        <circle r="12" fill="#0b1020" stroke="#f5c542" strokeWidth="3" />
      </g>
      {/* Pointer, fixed at the top. */}
      <polygon points="-9,-111 9,-111 0,-92" fill="#f5c542" stroke="#0b1020" strokeWidth="1.5" />
    </svg>
  )
}

// How far to turn so slice `index` stops under the pointer, after a few full turns.
function landingRotation(index, count) {
  const step = 360 / count
  return 360 * 6 - (index + 0.5) * step
}

// TV overlay: wheel for the team that's spinning, then the result.
export function WheelTV({ room, teams, slices, run }) {
  const wheel = room.wheel
  const team = teams.find((t) => t.id === wheel.team_id)
  const landed = wheel.slice != null ? landingRotation(wheel.slice, slices.length) : 0
  // Start at rest so the spin animates; jump straight to the result if the
  // TV was opened after the spin.
  const [rotation, setRotation] = useState(wheel.status === 'spinning' ? 0 : landed)

  useEffect(() => {
    if (wheel.status !== 'spinning') return
    const frame = requestAnimationFrame(() => setRotation(landed))
    // Apply the slice once the wheel stops.
    const done = setTimeout(() => {
      playDing()
      run(() => resolveWheel(room.id))
    }, SPIN_MS + 200)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
    // Only a new spin should restart this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheel.status, wheel.slice])

  // Announce the wheel when it first appears.
  useEffect(() => {
    if (wheel.status === 'ready') playBuzzer()
  }, [wheel.status])

  const finished = wheel.status === 'done' || wheel.status === 'bonus'
  // After the Bonus slice, continuing offers the team a bonus game.
  const finish = () =>
    run(async () => {
      if (wheel.status === 'bonus') await startBonus(room.id, wheel.team_id)
      await closeWheel(room.id)
    })

  useEffect(() => {
    function onKey(event) {
      if (!finished || !['Escape', 'Enter'].includes(event.key)) return
      event.preventDefault()
      finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="wheel-overlay" style={{ '--team': teamColor(teams, wheel.team_id) }}>
      <p className="wheel-title">
        <span>WHEEL!</span> {team?.name}
      </p>

      <WheelGraphic slices={slices} rotation={rotation} spinning={wheel.status === 'spinning'} />

      <div className="wheel-status">
        {wheel.status === 'ready' && <p>Spin it on your phone!</p>}
        {wheel.status === 'spinning' && <p>Spinning…</p>}
        {(wheel.status === 'choose' || finished) && <p className="wheel-result">{wheel.result}</p>}
      </div>

      <div className="host-controls">
        {wheel.status === 'ready' && (
          <button type="button" className="secondary" onClick={() => run(() => spinWheel(room.id))}>
            Spin for them
          </button>
        )}
        {wheel.status === 'choose' &&
          teams
            .filter((t) => t.id !== wheel.team_id)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className="secondary"
                onClick={() => run(() => wheelSteal(room.id, t.id))}
              >
                Steal from {t.name}
              </button>
            ))}
        {finished && (
          <button type="button" className="primary big" onClick={finish}>
            {wheel.status === 'bonus' ? 'Play the bonus game' : 'Continue'} (Enter)
          </button>
        )}
        {!finished && (
          <button type="button" className="link" onClick={() => run(() => closeWheel(room.id))}>
            Cancel wheel
          </button>
        )}
      </div>
    </div>
  )
}
