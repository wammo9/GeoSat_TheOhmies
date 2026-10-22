import type { Person, Task } from '../types';
import { addDays } from './dates';
import { isOverdue } from './rules';

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'later';

export interface Filters {
  owner: string; // person id or ''
  workstream: string;
  due: DueFilter;
  priority: string;
  blocked: 'any' | 'blocked' | 'unblocked';
  q: string;
}

export const EMPTY_FILTERS: Filters = {
  owner: '',
  workstream: '',
  due: 'any',
  priority: '',
  blocked: 'any',
  q: '',
};

export const isFiltering = (f: Filters) =>
  JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

export function matches(t: Task, f: Filters, today: string, people: Person[]): boolean {
  if (f.owner && t.owner_id !== f.owner) return false;
  if (f.workstream && t.workstream !== f.workstream) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.blocked === 'blocked' && !t.blocked) return false;
  if (f.blocked === 'unblocked' && t.blocked) return false;
  if (f.due !== 'any') {
    const week = addDays(today, 7);
    const ok =
      f.due === 'overdue'
        ? isOverdue(t, today)
        : f.due === 'today'
          ? t.due_date === today
          : f.due === 'week'
            ? t.due_date >= today && t.due_date <= week
            : t.due_date > week;
    if (!ok) return false;
  }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const owner = people.find((p) => p.id === t.owner_id);
    const hay = [t.title, t.deliverable, t.blocker, t.workstream, owner?.initial, owner?.name, ...t.evidence.map((e) => e.value)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const PRI = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;
export const byDueThenPriority = (a: Task, b: Task) =>
  a.due_date.localeCompare(b.due_date) || PRI[a.priority] - PRI[b.priority] || a.title.localeCompare(b.title);
