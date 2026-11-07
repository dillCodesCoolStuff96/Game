import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { navigate } from '../nav.js'
import { playBlip, playBuzzer } from '../sounds.js'
import { closeBuzzers, deleteTeam, expireBuzz, openBuzzers } from '../storage.js'
import { teamColor } from '../teamColors.js'
import { useAnswerTimer } from '../useAnswerTimer.js'
import { useRoom } from '../useRoom.js'

// The TV view, driven from the host's PC.
// Keys: Space opens/closes the buzzers, S stops the answer timer, N times the next team.
export default function HostScreen({ code }) {
  const { status, state, error, refresh } = useRoom(code)
  const [qr, setQr] = useState('')
  const joinUrl = `${window.location.origin}/?code=${code}`

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480 }).then(setQr)
  }, [joinUrl])

  const room = state?.room
  const buzzes = state?.buzzes
  // Time ran out: the team's buzz is cancelled so they can buzz again.
  const timer = useAnswerTimer(room?.buzz_round, (index) => {
    const expired = buzzes?.[index]
    if (expired) expireBuzz(expired.id).then(refresh)
  })

  // Buzz ids already heard; null until the first load, so opening the screen
  // mid-round doesn't replay old buzzes.
  const heard = useRef(null)
  useEffect(() => {
    if (!buzzes) return
    const fresh = heard.current ? buzzes.filter((b) => !heard.current.has(b.id)) : []
    heard.current = new Set(buzzes.map((b) => b.id))
    if (fresh.length === 0) return
    if (fresh.some((b) => b.id === buzzes[0].id)) {
      playBuzzer()
      timer.start(0)
    } else playBlip()
    // Only new buzzes should trigger this, not timer re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzes])

  async function toggleBuzzers() {
    if (!room) return
    if (room.buzz_open) await closeBuzzers(room.id)
    else await openBuzzers(room)
    refresh()
  }

  // Next team in line after the one being timed (or the first, if nobody has
  // been timed yet), skipping buzzes that already timed out.
  const after = timer.current ? timer.current.index : -1
  const nextIndex = buzzes?.findIndex((b, i) => i > after && !b.expired) ?? -1
  const canTimeNext = nextIndex !== -1

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea')) return
      if (event.code === 'Space') toggleBuzzers()
      else if (event.code === 'KeyS') timer.stop()
      else if (event.code === 'KeyN' && canTimeNext) timer.start(nextIndex)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleRemoveTeam(team) {
    if (!window.confirm(`Remove team "${team.name}"? Its players will pick a new team.`)) return
    await deleteTeam(team.id)
    refresh()
  }

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

  const { teams, players } = state
  const firstTime = buzzes[0] && new Date(buzzes[0].buzzed_at).getTime()

  return (
    <div className="tv">
      <aside className="tv-side">
        <div className="join">
          {qr && <img src={qr} alt="QR code to join" />}
          <p className="muted">Join at {window.location.host}</p>
          <p className="room-code">{code}</p>
        </div>

        <ul className="team-list">
          {teams.map((team) => {
            const members = players.filter((p) => p.team_id === team.id)
            return (
              <li key={team.id} style={{ '--team': teamColor(teams, team.id) }}>
                <div className="team-row">
                  <span className="team-name">{team.name}</span>
                  <span className="team-score">{team.score}</span>
                  <button
                    type="button"
                    className="remove"
                    aria-label={`Remove ${team.name}`}
                    onClick={() => handleRemoveTeam(team)}
                  >
                    ×
                  </button>
                </div>
                <p className="muted small">
                  {members.map((p) => p.name).join(', ') || 'No players yet'}
                </p>
              </li>
            )
          })}
          {teams.length === 0 && <li className="muted">Waiting for teams to join…</li>}
        </ul>
      </aside>

      <main className="tv-main">
        <div className={`buzz-state ${room.buzz_open ? 'open' : ''}`}>
          {room.buzz_open ? 'Buzzers open!' : 'Buzzers closed'}
        </div>

        <ol className="buzz-order">
          {buzzes.map((b, i) => {
            const team = teams.find((t) => t.id === b.team_id)
            const player = players.find((p) => p.user_id === b.user_id)
            const gap = (new Date(b.buzzed_at).getTime() - firstTime) / 1000
            const answering = timer.current?.index === i
            // Place among buzzes that are still in line (timed-out ones don't count).
            const place = b.expired ? '–' : buzzes.slice(0, i + 1).filter((x) => !x.expired).length
            return (
              <li
                key={b.id}
                className={answering ? `answering ${timer.current.status}` : b.expired ? 'timed-out' : ''}
                style={{ '--team': teamColor(teams, b.team_id), '--progress': timer.progress }}
              >
                <span className="place">{place}</span>
                <span className="who">
                  <strong>{team?.name ?? 'Removed team'}</strong>
                  <span className="muted">{player?.name}</span>
                </span>
                {answering ? (
                  <span className="countdown">
                    {timer.current.status === 'expired'
                      ? "TIME'S UP"
                      : Math.ceil(timer.remaining / 1000)}
                  </span>
                ) : b.expired ? (
                  <span className="gap muted">Time's up</span>
                ) : (
                  <span className="gap muted">{i === 0 ? '' : `+${gap.toFixed(2)}s`}</span>
                )}
              </li>
            )
          })}
        </ol>

        <div className="host-controls">
          <button type="button" className="primary big" onClick={toggleBuzzers}>
            {room.buzz_open ? 'Close buzzers' : 'Open buzzers'}
          </button>
          <span className="muted small">or press Space</span>
          {timer.current?.status === 'running' && (
            <button type="button" className="secondary" onClick={timer.stop}>
              Stop timer (S)
            </button>
          )}
          {canTimeNext && (
            <button type="button" className="secondary" onClick={() => timer.start(nextIndex)}>
              {timer.current ? 'Next team' : 'Start timer'} (N)
            </button>
          )}
          <span className="answer-time">
            <span className="muted small">Answer time</span>
            <button type="button" aria-label="Less time" onClick={() => timer.setSeconds(timer.seconds - 1)}>
              −
            </button>
            <strong>{timer.seconds}s</strong>
            <button type="button" aria-label="More time" onClick={() => timer.setSeconds(timer.seconds + 1)}>
              +
            </button>
          </span>
          <button type="button" className="link" onClick={() => navigate('?host')}>
            ← Games
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  )
}
