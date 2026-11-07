import { signOut } from '../storage.js'

// Placeholder: the game itself gets built here once the ideas are in.
export default function Game({ user }) {
  return (
    <div className="screen">
      <p>Signed in as {user.email}</p>
      <button type="button" onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}
