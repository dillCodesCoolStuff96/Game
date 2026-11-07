import { useEffect, useState } from 'react'
import Auth from './components/Auth.jsx'
import Home from './components/Home.jsx'
import HostHome from './components/HostHome.jsx'
import HostScreen from './components/HostScreen.jsx'
import PlayerScreen from './components/PlayerScreen.jsx'
import { useSearchParams } from './nav.js'
import { supabase } from './supabase.js'

export default function App() {
  // undefined = still checking for a saved session, null = signed out.
  const [session, setSession] = useState(undefined)
  const params = useSearchParams()

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

  // Host pages need a real (email) account; players are anonymous.
  if (params.has('host')) {
    if (!session || session.user.is_anonymous) return <Auth />
    const code = params.get('host')
    if (code) return <HostScreen key={code} code={code} />
    return <HostHome user={session.user} />
  }

  const playCode = params.get('play')
  if (playCode && session) {
    return <PlayerScreen key={playCode} code={playCode} userId={session.user.id} />
  }

  return <Home initialCode={params.get('code') ?? playCode ?? ''} />
}
