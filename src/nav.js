import { useSyncExternalStore } from 'react'

// Tiny router: screens are picked from the URL's query string
// (?host, ?host=CODE, ?play=CODE, ?code=CODE), so Vercel needs no rewrites.

function subscribe(callback) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search)
  return new URLSearchParams(search)
}

export function navigate(search) {
  window.history.pushState(null, '', search || '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
}
