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
