import { useMemo, useState } from 'react';
import type { CalEvent, Task } from '../types';
import { bar, eachDay, eventEnd, kindInfo, taskSpan, weekStart } from '../lib/calendar';
import { addDays, formatDate, weekday } from '../lib/dates';
import { isOverdue } from '../lib/rules';
import { OwnerChip } from './Chips';
import { useUI } from '../ctx';

type Group = 'none' | 'owner' | 'workstream';
const LABEL_W = 230;
const DAY_PX: Record<number, number> = { 4: 34, 8: 20, 12: 13 };

export function Timeline({ tasks, showCompleted, onOpenEvent }: { tasks: Task[]; showCompleted: boolean; onOpenEvent: (id: string) => void }) {
  const { board, openTask } = useUI();
  const [weeks, setWeeks] = useState(8);
  const [offset, setOffset] = useState(0); // weeks from the current week
  const [group, setGroup] = useState<Group>('owner');

  const winStart = addDays(weekStart(board.today), offset * 7);
  const days = weeks * 7;
  const px = DAY_PX[weeks];
  const winEnd = addDays(winStart, days - 1);
  const allDays = useMemo(() => eachDay(winStart, winEnd), [winStart, winEnd]);
  const todayIdx = bar(board.today, board.today, winStart, days);

  const visibleTasks = tasks.filter((t) => showCompleted || t.col !== 'completed');
  const placed = visibleTasks
    .map((t) => ({ t, b: bar(taskSpan(t).start, taskSpan(t).end, winStart, days), span: taskSpan(t) }))
    .filter((x) => x.b)
    .sort((a, b) => a.span.start.localeCompare(b.span.start) || a.span.end.localeCompare(b.span.end));
  const outside = visibleTasks.length - placed.length;
  const events = board.events.filter((e) => bar(e.start_date, eventEnd(e), winStart, days));

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', rows: placed }];
    const map = new Map<string, typeof placed>();
    for (const r of placed) {
      const key = group === 'owner' ? r.t.owner_id : r.t.workstream;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    const label = (k: string) => (group === 'owner' ? board.person(k)?.initial + (board.person(k)?.name && board.person(k)?.name !== board.person(k)?.initial ? ` — ${board.person(k)?.name}` : '') : k);
    return [...map.entries()].sort((a, b) => label(a[0]).localeCompare(label(b[0]))).map(([key, rows]) => ({ key, label: label(key), rows }));
  }, [placed, group, board]);

  const trackStyle = { width: days * px, ['--px' as any]: `${px}px` };
  const months: { label: string; left: number; width: number }[] = [];
  for (const d of allDays) {
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const last = months.at(-1);
    if (last && last.label === label) last.width += px;
    else months.push({ label, left: (months.at(-1) ? months.reduce((s, m) => s + m.width, 0) : 0), width: px });
  }

  const TaskBar = ({ t, b, span }: { t: Task; b: NonNullable<ReturnType<typeof bar>>; span: ReturnType<typeof taskSpan> }) => {
    const owner = board.person(t.owner_id);
    const late = isOverdue(t, board.today);
    const desc = `${t.title}: ${span.isRange ? `${formatDate(span.start)} to ` : 'due '}${formatDate(span.end)}, ${owner?.initial ?? '?'}${late ? ', overdue' : ''}${t.blocked ? ', blocked' : ''}${t.col === 'completed' ? ', completed' : ''}`;
    const style = { left: b.left * px, ['--owner' as any]: owner?.color ?? '#9fb3c8' } as React.CSSProperties;
    if (!span.isRange) {
      return (
        <button className={`gmark${late ? ' late' : ''}${t.col === 'completed' ? ' done' : ''}`} style={{ ...style, left: b.left * px + px / 2 - 9 }}
          title={desc} aria-label={desc} onClick={() => openTask(t.id)}>
          <span aria-hidden="true">{late ? '!' : ''}</span>
        </button>
      );
    }
    return (
      <button className={`gbar${late ? ' late' : ''}${t.col === 'completed' ? ' done' : ''}${b.clipL ? ' clip-l' : ''}${b.clipR ? ' clip-r' : ''}`}
        style={{ ...style, width: b.width * px - 2 }} title={desc} aria-label={desc} onClick={() => openTask(t.id)}>
        {b.width * px > 60 && <span className="gbar-text"><strong>{owner?.initial}</strong>{late ? ' ⚠' : ''}{t.blocked ? ' ⛔' : ''}</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="gantt-controls row">
        <button onClick={() => setOffset(offset - Math.max(1, weeks / 2))} aria-label="Earlier">‹ Earlier</button>
        <button className="small" onClick={() => setOffset(0)}>This week</button>
        <button onClick={() => setOffset(offset + Math.max(1, weeks / 2))} aria-label="Later">Later ›</button>
        <label>Show
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option>
          </select>
        </label>
        <label>Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            <option value="owner">Owner</option><option value="workstream">Workstream</option><option value="none">Nothing</option>
          </select>
        </label>
        <span className="muted small-text">{formatDate(winStart)} – {formatDate(winEnd)}</span>
      </div>
      <p className="muted small-text gantt-legend">
        <span className="lg-bar" /> task with start → due dates &nbsp; <span className="lg-mark" /> due date only (add a start date to make it a bar) &nbsp;
        <span className="lg-late" /> overdue &nbsp; <span className="lg-done" /> completed
      </p>

      <div className="gantt" role="region" aria-label="Task timeline" tabIndex={0}>
        <div className="g-inner" style={{ width: LABEL_W + days * px }}>
          <div className="g-row g-head">
            <div className="g-label" />
            <div className="g-track" style={trackStyle}>
              <div className="g-months">{months.map((m) => <span key={m.label} style={{ left: m.left, width: m.width }}>{m.label}</span>)}</div>
              <div className="g-days">
                {allDays.map((d) => (
                  <span key={d} className={`g-day${weekday(d) === 0 || weekday(d) === 6 ? ' wknd' : ''}${weekday(d) === 2 || weekday(d) === 4 ? ' meet' : ''}${d === board.today ? ' today' : ''}`}
                    title={formatDate(d)}>{px >= 20 || weekday(d) === 0 ? Number(d.slice(8)) : ''}</span>
                ))}
              </div>
            </div>
          </div>

          {events.length > 0 && (
            <>
              <div className="g-group">Calendar events</div>
              {events.map((e: CalEvent) => {
                const b = bar(e.start_date, eventEnd(e), winStart, days)!;
                const desc = `${e.title}: ${formatDate(e.start_date)}${e.end_date ? ` to ${formatDate(e.end_date)}` : ''}${e.is_major ? ', big event' : ''}`;
                return (
                  <div className="g-row" key={e.id}>
                    <div className="g-label"><button className="link" onClick={() => onOpenEvent(e.id)}>{e.is_major ? '★' : kindInfo(e.kind).icon} {e.title}</button></div>
                    <div className="g-track" style={trackStyle}>
                      <button className={`gbar ev k-${e.kind}${b.clipL ? ' clip-l' : ''}${b.clipR ? ' clip-r' : ''}`} style={{ left: b.left * px, width: Math.max(b.width * px - 2, 14) }}
                        title={desc} aria-label={desc} onClick={() => onOpenEvent(e.id)}>
                        {b.width * px > 70 && <span className="gbar-text">{e.title}</span>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              {g.label && <div className="g-group">{g.label} <span className="count">{g.rows.length}</span></div>}
              {g.rows.map(({ t, b, span }) => (
                <div className="g-row" key={t.id}>
                  <div className="g-label">
                    <OwnerChip person={board.person(t.owner_id)} name={false} />
                    <div className="g-label-text">
                      <button className="link" onClick={() => openTask(t.id)}>{t.title}</button>
                      <span className="muted small-text">
                        {span.isRange ? `${formatDate(span.start)} → ` : 'due '}{formatDate(span.end)}
                        {t.event_id && <> · ↳ {board.events.find((e) => e.id === t.event_id)?.title}</>}
                      </span>
                    </div>
                  </div>
                  <div className="g-track" style={trackStyle}><TaskBar t={t} b={b!} span={span} /></div>
                </div>
              ))}
            </div>
          ))}
          {todayIdx && <div className="g-today" style={{ left: LABEL_W + todayIdx.left * px + px / 2 }} aria-hidden="true" />}
        </div>
      </div>
      {placed.length === 0 && <p className="col-empty">No tasks fall in this window.</p>}
      {outside > 0 && <p className="muted small-text">{outside} task{outside === 1 ? ' is' : 's are'} outside this window — use Earlier / Later or show more weeks.</p>}
    </div>
  );
}
