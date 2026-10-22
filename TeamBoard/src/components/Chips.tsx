import type { Person, Task } from '../types';
import { textOn } from '../lib/color';
import { formatDate } from '../lib/dates';
import { isOverdue } from '../lib/rules';

export function OwnerChip({ person, name = true }: { person: Person | undefined; name?: boolean }) {
  if (!person) return <span className="chip">Unknown</span>;
  return (
    <span className="owner" title={`${person.name ?? person.initial}${person.role ? ` — ${person.role}` : ''}`}>
      <span className="avatar" style={{ background: person.color, color: textOn(person.color) }} aria-hidden="true">
        {person.initial}
      </span>
      <span className={name ? '' : 'sr-only'}>
        <span className="sr-only">Owner: </span>
        {person.name && person.name !== person.initial ? person.name : person.initial}
      </span>
    </span>
  );
}

export function Badges({ task, today }: { task: Task; today: string }) {
  return (
    <>
      {task.blocked && <span className="badge blocked"><span aria-hidden="true">⛔ </span>Blocked</span>}
      {isOverdue(task, today) && <span className="badge overdue"><span aria-hidden="true">⚠ </span>Overdue</span>}
      {task.is_demo && <span className="badge demo">DEMO</span>}
    </>
  );
}

export function DueDate({ task, today }: { task: Task; today: string }) {
  return (
    <span className={isOverdue(task, today) ? 'due late' : 'due'}>
      <span aria-hidden="true">📅 </span>
      <span className="sr-only">Due </span>
      {formatDate(task.due_date)}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="center-note" role="status">
      <div className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
