import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoomByCode, loadRoomState, subscribeRoom } from './storage.js'

// Live state of one room: { room, teams, players, buzzes }.
// status: 'loading' | 'ready' | 'missing' (no such room, or not joined).
export function useRoom(code) {
  const [roomId, setRoomId] = useState(null)
  const [status, setStatus] = useState('loading')
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const latest = useRef(0)

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

  const refresh = useCallback(async () => {
    if (!roomId) return
    // Ignore responses that arrive after a newer request was sent.
    const request = ++latest.current
    try {
      const next = await loadRoomState(roomId)
      if (request !== latest.current) return
      setState(next)
      setStatus('ready')
      setError('')
    } catch (err) {
      if (request === latest.current) setError(err.message)
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) return
    const requests = latest
    const unsubscribe = subscribeRoom(roomId, refresh)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    // oxlint-disable-next-line react/set-state-in-effect -- refresh only sets state after an await
    refresh()
    return () => {
      requests.current++ // drop any in-flight refresh
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId, refresh])

  return { status, state, error, refresh }
}
