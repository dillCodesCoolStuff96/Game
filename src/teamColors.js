// Team colors by join order, shown on the TV and on each player's phone.
const colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#14b8a6']

export function teamColor(teams, teamId) {
  const index = teams.findIndex((t) => t.id === teamId)
  return colors[Math.max(index, 0) % colors.length]
}
