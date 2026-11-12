import { useMemo, useState } from 'react';
import type { Task } from '../types';
import { byDueThenPriority } from '../lib/filters';
import { ARCHIVE_AFTER_DAYS, canUnarchive, isArchived } from '../lib/rules';
import { TZ } from '../lib/dates';
import WORKSTREAMS from '../../config/workstreams.json';
import { OwnerChip } from './Chips';
import { useUI } from '../ctx';

const completedDay = (t: Task) => new Date(t.completed_at ?? t.updated_at).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD in Denver
const monthLabel = (day: string) => new Date(`${day.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** Its own tab: completed tasks that have been out of the way for a week (or were archived by hand). */
export function ArchiveView() {
  const { board, openTask, move } = useUI();
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [workstream, setWorkstream] = useState('');
  const now = Date.now();
  const all = board.tasks.filter((t) => isArchived(t, now));
  const stillOnBoard = board.tasks.filter((t) => t.col === 'completed' && !isArchived(t, now));

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = all
      .filter((x) => !owner || x.owner_id === owner)
      .filter((x) => !workstream || x.workstream === workstream)
      .filter((x) => !t || [x.title, x.deliverable, x.workstream, ...x.evidence.map((e) => e.value)].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at) || byDueThenPriority(a, b));
    const byMonth = new Map<string, Task[]>();
    for (const x of list) {
      const m = completedDay(x).slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), x]);
    }
    return { list, months: [...byMonth.entries()] };
  }, [all, q, owner, workstream]);

  return (
    <section className="panel" aria-label="Archive">
      <div className="row between">
        <h2>Archive <span className="count">{all.length}</span></h2>
        {stillOnBoard.length > 0 && (
          <button onClick={() => board.archiveMany(stillOnBoard)} title="Move everything in the Board’s Completed column into the archive right now">
            Archive the {stillOnBoard.length} in Completed now
          </button>
        )}
      </div>
      <p className="muted">Finished tasks leave the Board’s Completed column {ARCHIVE_AFTER_DAYS} days after they’re done and wait here, so the Board stays tidy. Nothing is deleted — search, open or reopen any of them.</p>

      <form className="row archive-filters" role="search" aria-label="Search the archive" onSubmit={(e) => e.preventDefault()}>
        <label className="grow">Search
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, deliverable, evidence…" />
        </label>
        <label>Owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Everyone</option>
            {board.people.filter((p) => p.active || all.some((t) => t.owner_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.initial}</option>)}
          </select>
        </label>
        <label>Workstream
          <select value={workstream} onChange={(e) => setWorkstream(e.target.value)}>
            <option value="">All</option>
            {WORKSTREAMS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <span className="muted small-text" aria-live="polite">{groups.list.length} of {all.length}</span>
      </form>

      {all.length === 0 ? (
        <p className="col-empty">Nothing archived yet. Completed tasks will land here {ARCHIVE_AFTER_DAYS} days after they’re finished.</p>
      ) : groups.list.length === 0 ? (
        <p className="col-empty">No archived tasks match.</p>
      ) : (
        groups.months.map(([month, tasks]) => (
          <div key={month} className="archive-month">
            <h3>{monthLabel(month)} <span className="muted small-text">· {tasks.length}</span></h3>
            <ul className="archive-list">
              {tasks.map((t) => (
                <li key={t.id}>
                  <div className="archive-main">
                    <button className="link" onClick={() => openTask(t.id)}>{t.title}</button>
                    <div className="card-row">
                      <OwnerChip person={board.person(t.owner_id)} />
                      <span className="tag">{t.workstream}</span>
                      <span className="muted small-text">Completed {dayLabel(completedDay(t))}</span>
                    </div>
                    <p className="muted small-text">{t.evidence.at(-1)?.value ?? t.deliverable}</p>
                  </div>
                  <div className="row archive-actions">
                    {canUnarchive(t, now) && <button className="small" onClick={() => board.archiveTask(t, false)}>Unarchive</button>}
                    <button className="small" onClick={() => move(t, 'in_progress')} title="Move it back to In Progress">Reopen</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
