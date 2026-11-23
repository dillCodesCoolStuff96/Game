import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoomByCode, loadRoomState, subscribeRoom } from './storage.js'

// Live state of one room: { room, teams, players, buzzes, ... }.
// status: 'loading' | 'ready' | 'missing' (no such room, or not joined).
export function useRoom(code) {
  const [roomId, setRoomId] = useState(null)
  const [status, setStatus] = useState('loading')
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  // The latest loaded room, so the next load can run all its queries at once.
  const lastRoom = useRef(null)
  // At most one load runs, plus one queued behind it. One click can change
  // several tables at once; every change notice that arrives while a load is
  // queued shares that load instead of starting its own.
  const running = useRef(null)
  const queued = useRef(null)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    getRoomByCode(code)
      .then((room) => {
        if (!active) return
        if (room) setRoomId(room.id)
        else setStatus('missing')
      })
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [code])

  const load = useCallback(async () => {
    const gen = generation.current
    try {
      const next = await loadRoomState(roomId, lastRoom.current)
      if (gen !== generation.current) return
      lastRoom.current = next.room
      setState(next)
      setStatus('ready')
      setError('')
    } catch (err) {
      if (gen === generation.current) setError(err.message)
    }
  }, [roomId])

  const refresh = useCallback(() => {
    if (!roomId) return Promise.resolve()
    if (queued.current) return queued.current
    const next = (running.current ?? Promise.resolve()).then(async () => {
      queued.current = null
      const current = load()
      running.current = current
      await current
      if (running.current === current) running.current = null
    })
    queued.current = next
    return next
  }, [roomId, load])

  useEffect(() => {
    if (!roomId) return
    const gen = generation
    const unsubscribe = subscribeRoom(roomId, refresh)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    // oxlint-disable-next-line react/set-state-in-effect -- refresh only sets state after an await
    refresh()
    return () => {
      gen.current++ // drop any in-flight load
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId, refresh])

  return { status, state, error, refresh }
}
