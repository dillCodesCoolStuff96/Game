// All database access lives here, so swapping storage only touches this file.
// Game data functions get added as the game's features are built.
import { supabase } from './supabase.js'

export async function signOut() {
  await supabase.auth.signOut()
}
