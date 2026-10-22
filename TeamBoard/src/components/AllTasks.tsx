import { useState } from 'react';
import type { Task } from '../types';
import { byDueThenPriority } from '../lib/filters';
import { colTitle } from '../lib/rules';
import { Badges, DueDate, OwnerChip } from './Chips';
import { useUI } from '../ctx';

export function AllTasks({ tasks }: { tasks: Task[] }) {
  const { board, openTask } = useUI();
  const [showDone, setShowDone] = useState(false);
  const list = tasks.filter((t) => showDone || t.col !== 'completed').sort(byDueThenPriority);
  return (
    <section className="panel">
      <div className="row between">
        <h2>All tasks <span className="count">{list.length}</span></h2>
        <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
      </div>
      <p className="muted">Every task, including unfinished work from previous weeks, sorted by due date.</p>
      <div className="table-wrap">
        <table className="tasks">
          <thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Column</th><th>Workstream</th><th>Priority</th><th>Flags</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className={t.col !== 'completed' && t.due_date < board.today ? 'late-row' : ''}>
                <td><button className="link" onClick={() => openTask(t.id)}>{t.title}</button></td>
                <td><OwnerChip person={board.person(t.owner_id)} /></td>
                <td><DueDate task={t} today={board.today} /></td>
                <td>{colTitle(t.col)}</td>
                <td>{t.workstream}</td>
                <td>{t.priority}</td>
                <td><Badges task={t} today={board.today} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="col-empty">No tasks match.</p>}
      </div>
    </section>
  );
}
