import type { TradingRun } from '../api/types'
import { displayStatus, humanizeLabel, normalizeStatus } from '../utils/run'

export interface AgentMatrixProps {
  run: TradingRun | null
}

export function AgentMatrix({ run }: AgentMatrixProps) {
  const agents = Object.entries(run?.agent_status ?? {})
  return (
    <aside className="agent-matrix" aria-labelledby="agent-matrix-heading">
      <div className="subpanel-heading">
        <span className="subpanel-heading__code">NODE STATUS</span>
        <h3 id="agent-matrix-heading">Agent Matrix</h3>
        <span className="subpanel-heading__count">{agents.length.toString().padStart(2, '0')}</span>
      </div>
      {agents.length ? (
        <ol className="agent-list">
          {agents.map(([name, raw]) => {
            const status = typeof raw === 'string' ? raw : raw.status ?? raw.state ?? 'unknown'
            const normalized = normalizeStatus(status)
            return (
              <li key={name} className={`agent-item agent-item--${normalized}`}>
                <span className="status-dot" aria-hidden="true" />
                <span className="agent-item__name">{humanizeLabel(name)}</span>
                <span className="agent-item__status">{displayStatus(status)}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="subpanel-empty">
          <span aria-hidden="true">◇</span>
          <p>Agent nodes appear when a cycle begins.</p>
        </div>
      )}
    </aside>
  )
}
