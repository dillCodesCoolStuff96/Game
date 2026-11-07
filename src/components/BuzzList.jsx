import { teamColor } from '../teamColors.js'

// Teams in the order they buzzed, with the answer countdown and verdicts.
export default function BuzzList({ state, timer, value }) {
  const { teams, players, buzzes } = state
  const firstTime = buzzes[0] && new Date(buzzes[0].buzzed_at).getTime()

  return (
    <ol className="buzz-order">
      {buzzes.map((b, i) => {
        const team = teams.find((t) => t.id === b.team_id)
        const player = players.find((p) => p.user_id === b.user_id)
        const gap = (new Date(b.buzzed_at).getTime() - firstTime) / 1000
        const answering = timer.current?.index === i && !b.result
        // Place among buzzes that are still in line (timed-out ones don't count).
        const place = b.expired ? '–' : buzzes.slice(0, i + 1).filter((x) => !x.expired).length

        let className = ''
        let right = <span className="gap muted">{i === 0 ? '' : `+${gap.toFixed(2)}s`}</span>
        if (b.result === 'correct') {
          className = 'correct'
          right = <span className="verdict">✓ +{value}</span>
        } else if (b.result === 'wrong') {
          className = 'wrong'
          right = <span className="verdict">✗ −{Math.floor(value / 2)}</span>
        } else if (answering) {
          className = `answering ${timer.current.status}`
          right = (
            <span className="countdown">
              {timer.current.status === 'expired' ? "TIME'S UP" : Math.ceil(timer.remaining / 1000)}
            </span>
          )
        } else if (b.expired) {
          className = 'timed-out'
          right = <span className="gap muted">Time's up</span>
        }

        return (
          <li
            key={b.id}
            className={className}
            style={{ '--team': teamColor(teams, b.team_id), '--progress': timer.progress }}
          >
            <span className="place">{place}</span>
            <span className="who">
              <strong>{team?.name ?? 'Removed team'}</strong>
              <span className="muted">{player?.name}</span>
            </span>
            {right}
          </li>
        )
      })}
    </ol>
  )
}
