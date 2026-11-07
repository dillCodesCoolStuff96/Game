import { useEffect, useState } from 'react'
import { playAlarm } from './sounds.js'

function savedSeconds() {
  try {
    return Number(localStorage.getItem('answerSeconds')) || 5
  } catch {
    return 5
  }
}

// Countdown for the team currently answering (by place in the buzz order).
// It belongs to one buzz round, so opening a new round clears it.
export function useAnswerTimer(round) {
  const [seconds, setSecondsState] = useState(savedSeconds)
  const [timer, setTimer] = useState(null) // { round, index, endsAt, stoppedAt, status }
  const [now, setNow] = useState(() => Date.now())

  const current = timer && timer.round === round ? timer : null

  useEffect(() => {
    if (current?.status !== 'running') return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= current.endsAt) {
        clearInterval(id)
        setTimer((prev) => (prev === current ? { ...prev, status: 'expired' } : prev))
        playAlarm()
      }
    }, 100)
    return () => clearInterval(id)
  }, [current])

  function start(index) {
    const t = Date.now()
    setNow(t)
    setTimer({ round, index, endsAt: t + seconds * 1000, status: 'running' })
  }

  function stop() {
    setTimer((prev) =>
      prev?.status === 'running' ? { ...prev, status: 'stopped', stoppedAt: Date.now() } : prev,
    )
  }

  function setSeconds(value) {
    const next = Math.min(60, Math.max(1, value))
    setSecondsState(next)
    try {
      localStorage.setItem('answerSeconds', String(next))
    } catch {
      // Remembering the setting is only a convenience.
    }
  }

  let remaining = 0
  if (current?.status === 'running') remaining = Math.max(0, current.endsAt - now)
  if (current?.status === 'stopped') remaining = Math.max(0, current.endsAt - current.stoppedAt)

  return {
    current,
    remaining,
    progress: current ? remaining / (seconds * 1000) : 0,
    seconds,
    setSeconds,
    start,
    stop,
  }
}
