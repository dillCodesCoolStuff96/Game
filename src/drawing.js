// A team's drawing prompt: its secret one if the question has a list,
// otherwise the question's main prompt (also used for teams that join late).
export function drawingPrompt(allplay, teamId) {
  return allplay?.assignments?.[teamId] ?? allplay?.prompt ?? ''
}

// Deals the question's prompts out to the teams at random, one each (repeating
// only if there are more teams than prompts).
export function assignPrompts(prompts, teams) {
  const shuffled = [...prompts].sort(() => Math.random() - 0.5)
  return Object.fromEntries(teams.map((team, i) => [team.id, shuffled[i % shuffled.length]]))
}

// Gives prompts to teams that don't have one yet (e.g. they joined after the
// square opened), preferring prompts no team has. Returns null if nothing changed.
export function dealMissingPrompts(prompts, assignments, teams) {
  const dealt = { ...(assignments ?? {}) }
  const missing = teams.filter((team) => !dealt[team.id])
  if (!prompts.length || !missing.length) return null
  for (const team of missing) {
    const taken = new Set(Object.values(dealt))
    const unused = prompts.filter((prompt) => !taken.has(prompt))
    const pool = unused.length ? unused : prompts
    dealt[team.id] = pool[Math.floor(Math.random() * pool.length)]
  }
  return dealt
}
