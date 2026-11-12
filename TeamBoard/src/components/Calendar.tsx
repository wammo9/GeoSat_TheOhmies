import { useState } from 'react';
import type { EventKind, Task } from '../types';
import { KINDS, countdown, kindInfo, linkedStats, recurLabel, upcomingMajor } from '../lib/calendar';
import { formatDate } from '../lib/dates';
import { MonthView } from './MonthView';
import { Timeline } from './Timeline';
import { EventDialog } from './EventDialog';
import { useUI } from '../ctx';

type Sub = 'month' | 'timeline';

export function CalendarView({ tasks }: { tasks: Task[] }) {
  const { board } = useUI();
  const [sub, setSub] = useState<Sub>('month');
  const [dialog, setDialog] = useState<{ id?: string; date?: string; occurrence?: string } | null>(null);
  const [showTasks, setShowTasks] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [hidden, setHidden] = useState<Set<EventKind>>(new Set());
  const events = board.events.filter((e) => !hidden.has(e.kind));
  const toggleKind = (k: EventKind) => setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const big = upcomingMajor(board.events, board.today, 5);
  const monthTasks = showCompleted ? tasks : tasks.filter((t) => t.col !== 'completed');

  return (
    <div className="stack">
      <section className="panel big-events" aria-label="Big upcoming events">
        <div className="row between">
          <h2>Big upcoming events</h2>
          <button className="primary" onClick={() => setDialog({})}>+ Add event</button>
        </div>
        {big.length === 0 ? (
          <p className="muted">Nothing big on the horizon. Add an event and tick “Big event” to pin it here.</p>
        ) : (
          <ul className="big-list">
            {big.map((o) => {
              const e = o.event;
              const s = linkedStats(e.id, board.tasks, board.today);
              return (
                <li key={e.id}>
                  <button className="big-card" onClick={() => setDialog({ id: e.id, occurrence: o.start })}>
                    <span className="big-when">{countdown(o, board.today)}</span>
                    <strong><span aria-hidden="true">★ </span>{e.title}</strong>
                    <span className="muted">{kindInfo(e.kind).label} · {formatDate(o.start)}{o.end !== o.start ? ` – ${formatDate(o.end)}` : ''}{e.recur !== 'none' ? ` · ↻ ${recurLabel(e)}` : ''}</span>
                    <span className="big-tasks">
                      {s.total === 0 ? 'No tasks linked yet' : `${s.done} of ${s.total} linked tasks done`}
                      {s.overdue > 0 && <span className="badge overdue"><span aria-hidden="true">⚠ </span>{s.overdue} overdue</span>}
                      {s.blocked > 0 && <span className="badge blocked"><span aria-hidden="true">⛔ </span>{s.blocked} blocked</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="row between">
          <div className="seg" role="tablist" aria-label="Calendar view">
            <button role="tab" aria-selected={sub === 'month'} className={sub === 'month' ? 'on' : ''} onClick={() => setSub('month')}>Month</button>
            <button role="tab" aria-selected={sub === 'timeline'} className={sub === 'timeline' ? 'on' : ''} onClick={() => setSub('timeline')}>Timeline (Gantt)</button>
          </div>
          <div className="row">
            {sub === 'month' && <label className="check"><input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> Show task due dates</label>}
            <label className="check"><input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} /> Show completed tasks</label>
          </div>
        </div>
        <div className="kind-key" role="group" aria-label="Event types (click to show or hide)">
          <span className="muted small-text">Event types:</span>
          {KINDS.map((k) => {
            const n = board.events.filter((e) => e.kind === k.id).length;
            const on = !hidden.has(k.id);
            return (
              <button key={k.id} className={`kind-chip k-${k.id}${on ? '' : ' off'}`} aria-pressed={on} onClick={() => toggleKind(k.id)} title={on ? `Hide ${k.label} events` : `Show ${k.label} events`}>
                <span className="swatch" aria-hidden="true" />{k.icon} {k.label} <span className="kc-count">{n}</span>
              </button>
            );
          })}
        </div>
        {sub === 'month'
          ? <MonthView tasks={monthTasks} events={events} showTasks={showTasks} onOpenEvent={(id, occurrence) => setDialog({ id, occurrence })} onAddEvent={(date) => setDialog({ date })} />
          : <Timeline tasks={tasks} events={events} showCompleted={showCompleted} onOpenEvent={(id, occurrence) => setDialog({ id, occurrence })} />}
      </section>
      {dialog && <EventDialog key={dialog.id ?? dialog.date ?? 'new'} eventId={dialog.id} date={dialog.date} occurrence={dialog.occurrence} onClose={() => setDialog(null)} />}
    </div>
  );
}
