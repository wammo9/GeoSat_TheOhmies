import { useMemo } from 'react';
import { buildRoster } from '../lib/roster';
import { formatDate } from '../lib/dates';
import { OwnerChip } from './Chips';
import { useUI } from '../ctx';

export function Roster({ onPick, picked }: { onPick?: (personId: string) => void; picked?: string }) {
  const { board, openTask } = useUI();
  const rows = useMemo(() => buildRoster(board.people, board.tasks, board.today), [board.people, board.tasks, board.today]);
  return (
    <section className="roster" aria-label="Team roster">
      <h2>Team roster <span className="muted">· from live board data</span></h2>
      <ul>
        {rows.map((r) => (
          <li key={r.person.id} className={picked === r.person.id ? 'picked' : ''}>
            <button className="roster-head" onClick={() => onPick?.(r.person.id)} aria-pressed={picked === r.person.id}
              title={onPick ? 'Filter the board to this person' : undefined}>
              <OwnerChip person={r.person} />
            </button>
            <div className="roster-stats">
              <span><strong>{r.open.length}</strong> open</span>
              <span>{r.nextDue ? `next ${formatDate(r.nextDue)}` : 'nothing due'}</span>
              {r.overdue > 0 && <span className="badge overdue"><span aria-hidden="true">⚠ </span>{r.overdue} overdue</span>}
              {r.blocked > 0 && <span className="badge blocked"><span aria-hidden="true">⛔ </span>{r.blocked} blocked</span>}
              {r.supporting > 0 && <span className="muted">supporting {r.supporting}</span>}
            </div>
            {r.open.length > 0 && (
              <ul className="roster-tasks">
                {r.open.slice(0, 3).map((t) => (
                  <li key={t.id}><button className="link" onClick={() => openTask(t.id)}>{t.title}</button> <span className="muted">· {formatDate(t.due_date)}</span></li>
                ))}
                {r.open.length > 3 && <li className="muted">+{r.open.length - 3} more</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
