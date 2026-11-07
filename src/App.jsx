import { useEffect, useState } from 'react'
import Auth from './components/Auth.jsx'
import Game from './components/Game.jsx'
import { supabase } from './supabase.js'

export default function App() {
  // undefined = still checking for a saved session, null = signed out.
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabase) {
    return (
      <div className="screen">
        <h2>Supabase isn't configured</h2>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Supabase
          project's URL and publishable key, then restart <code>npm run dev</code>.
        </p>
      </div>
    )
  }

  if (session === undefined) return null
  if (!session) return <Auth />
  return <Game key={session.user.id} user={session.user} />
}
