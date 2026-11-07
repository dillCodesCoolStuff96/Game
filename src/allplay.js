import { useEffect, useState } from 'react'

// Lower-case, no accents, punctuation or extra spaces, no leading "the"/"a".
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
}

// Whether a typed answer matches a key answer ("a/b" accepts either).
export function matches(text, keyAnswer) {
  const typed = normalize(text)
  return typed !== '' && keyAnswer.split('/').some((option) => normalize(option) === typed)
}

// Suggested verdict for every answer, by id. In a list, each key item can only
// be matched once per team, so typing the same thing twice scores once.
export function suggestVerdicts(allplay, answers) {
  const verdicts = new Map()
  const usedByTeam = new Map()
  for (const answer of answers) {
    if (allplay.format === 'list') {
      const used = usedByTeam.get(answer.team_id) ?? new Set()
      usedByTeam.set(answer.team_id, used)
      const index = allplay.items.findIndex(
        (item, i) => !used.has(i) && matches(answer.text, item.answer),
      )
      if (index !== -1) used.add(index)
      verdicts.set(answer.id, index !== -1)
    } else {
      const item = allplay.items[answer.slot]
      verdicts.set(answer.id, Boolean(item) && matches(answer.text, item.answer))
    }
  }
  return verdicts
}

// The host's verdict if they've set one, otherwise the suggestion.
export function verdict(answer, suggestions) {
  return answer.correct ?? suggestions.get(answer.id) ?? false
}

// Correct answers per team, and the team(s) with the most (none if nobody scored).
export function tally(teams, answers, suggestions) {
  const counts = new Map(teams.map((t) => [t.id, 0]))
  for (const answer of answers) {
    if (answer.text.trim() && verdict(answer, suggestions)) {
      counts.set(answer.team_id, (counts.get(answer.team_id) ?? 0) + 1)
    }
  }
  const best = Math.max(0, ...counts.values())
  const winners = best > 0 ? teams.filter((t) => counts.get(t.id) === best) : []
  return { counts, winners }
}

// Where an all-play question is: waiting to start, taking answers, locked for
// grading, or showing results (after points are awarded).
export function allPlayStage(room, now) {
  if (room.phase === 'answer') return 'results'
  if (!room.allplay_ends_at) return 'ready'
  return now < Date.parse(room.allplay_ends_at) ? 'answering' : 'locked'
}

// Current time, ticking while active (for countdowns).
export function useNow(active, intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    // Catch up right away; the value may be stale from before the countdown.
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [active, intervalMs])
  return now
}
