import type { Person, Task } from '../types';
import { isOpen, isOverdue } from './rules';

export interface RosterRow {
  person: Person;
  open: Task[]; // sorted by due date
  nextDue: string | null;
  overdue: number;
  blocked: number;
  supporting: number;
}

export function buildRoster(people: Person[], tasks: Task[], today: string): RosterRow[] {
  return people
    .filter((p) => p.active)
    .map((person) => {
      const open = tasks
        .filter((t) => t.owner_id === person.id && isOpen(t))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
      return {
        person,
        open,
        nextDue: open[0]?.due_date ?? null,
        overdue: open.filter((t) => isOverdue(t, today)).length,
        blocked: open.filter((t) => t.blocked).length,
        supporting: tasks.filter((t) => isOpen(t) && t.supporters.includes(person.id)).length,
      };
    });
}
