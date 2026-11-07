import { useEffect, useState } from 'react'
import { loadBoard } from '../storage.js'
import { useRoom } from '../useRoom.js'

// The host's private phone screen: just the answer to the question on the TV.
export default function AdminScreen({ code }) {
  const { status, state, error } = useRoom(code)
  const [board, setBoard] = useState(null)
  const boardId = state?.room.board_id

  useEffect(() => {
    if (!boardId) return
    loadBoard(boardId).then(setBoard)
  }, [boardId])

  // Keep the phone from dimming and locking mid-game (where supported).
  useEffect(() => {
    let lock = null
    async function request() {
      try {
        lock = await navigator.wakeLock?.request('screen')
      } catch {
        // Not supported or not allowed; the screen may sleep as usual.
      }
    }
    // The lock is dropped when the page is hidden, so take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && request()
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release()
    }
  }, [])

  if (status === 'missing') return <div className="screen">No game found with code {code}.</div>
  if (!state) return <div className="screen muted">{error || 'Loading…'}</div>

  const questionId = state.room.current_question_id
  const question = board
    ?.flatMap((c) => c.questions)
    .find((q) => q.id === questionId)

  return (
    <div className="admin">
      {question ? (
        <p className="admin-answer">{question.answer}</p>
      ) : (
        <p className="muted">Waiting for a question…</p>
      )}
    </div>
  )
}
