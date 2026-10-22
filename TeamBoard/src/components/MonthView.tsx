import { useState } from 'react';
import type { Task } from '../types';
import { addMonths, eventsOnDay, kindInfo, monthGrid, monthLabel } from '../lib/calendar';
import { formatDate, weekday } from '../lib/dates';
import { isOverdue } from '../lib/rules';
import { useUI } from '../ctx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthView({ tasks, showTasks, onOpenEvent, onAddEvent }: {
  tasks: Task[]; showTasks: boolean; onOpenEvent: (id: string) => void; onAddEvent: (date: string) => void;
}) {
  const { board, openTask } = useUI();
  const [month, setMonth] = useState(board.today.slice(0, 7) + '-01');
  const [expanded, setExpanded] = useState<string | null>(null);
  const weeks = monthGrid(month);
  const inMonth = (d: string) => d.slice(0, 7) === month.slice(0, 7);

  return (
    <div>
      <div className="cal-nav row">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
        <h3 className="cal-title" aria-live="polite">{monthLabel(month)}</h3>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
        <button className="small" onClick={() => setMonth(board.today.slice(0, 7) + '-01')}>Today</button>
        <span className="muted small-text">Tasks appear on their due date. Teal-edged days are Tuesday / Thursday team meetings.</span>
      </div>
      <div className="month" role="grid" aria-label={monthLabel(month)}>
        {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {weeks.flat().map((day) => {
          const evs = eventsOnDay(board.events, day);
          const due = showTasks ? tasks.filter((t) => t.due_date === day) : [];
          const items = evs.length + due.length;
          const open = expanded === day;
          const shownEvs = open ? evs : evs.slice(0, 3);
          const shownTasks = open ? due : due.slice(0, Math.max(0, 3 - shownEvs.length));
          const hidden = items - shownEvs.length - shownTasks.length;
          const dow = weekday(day);
          const meeting = dow === 2 ? 'Tue check-in' : dow === 4 ? 'Thu review' : '';
          return (
            <div key={day} role="gridcell" aria-label={formatDate(day)}
              className={`day${inMonth(day) ? '' : ' off'}${day === board.today ? ' today' : ''}${meeting ? ' meet' : ''}`}>
              <div className="day-head">
                <span className="day-num">{Number(day.slice(8))}{day === board.today && <span className="sr-only"> (today)</span>}</span>
                {meeting && <span className="meet-label">{meeting}</span>}
                <button className="add-here" aria-label={`Add event on ${formatDate(day)}`} onClick={() => onAddEvent(day)}>+</button>
              </div>
              {shownEvs.map((e) => (
                <button key={e.id} className={`pill ev k-${e.kind}${e.start_date < day ? ' cont' : ''}`} onClick={() => onOpenEvent(e.id)}
                  title={`${kindInfo(e.kind).label}: ${e.title}`}>
                  <span aria-hidden="true">{e.is_major ? '★' : kindInfo(e.kind).icon}</span> {e.title}
                  <span className="sr-only"> ({kindInfo(e.kind).label}{e.is_major ? ', big event' : ''})</span>
                </button>
              ))}
              {shownTasks.map((t) => {
                const owner = board.person(t.owner_id);
                return (
                  <button key={t.id} className={`pill tk${t.col === 'completed' ? ' done' : ''}${isOverdue(t, board.today) ? ' late' : ''}`}
                    style={{ ['--owner' as any]: owner?.color ?? '#9fb3c8' }} onClick={() => openTask(t.id)}
                    title={`${t.title} — due ${formatDate(t.due_date)} — ${owner?.initial ?? '?'}`}>
                    <strong>{owner?.initial}</strong> {t.title}
                    {isOverdue(t, board.today) && <span className="late-flag"><span aria-hidden="true"> ⚠</span><span className="sr-only"> overdue</span></span>}
                    {t.blocked && <span aria-hidden="true"> ⛔</span>}
                  </button>
                );
              })}
              {hidden > 0 && <button className="more" onClick={() => setExpanded(day)}>+{hidden} more</button>}
              {open && items > 3 && <button className="more" onClick={() => setExpanded(null)}>show less</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
