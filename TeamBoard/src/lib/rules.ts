import type { Evidence, Task, TaskDraft } from '../types';

export const COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'tuesday', title: 'Tuesday Commitments' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'thursday', title: 'Thursday Review' },
  { id: 'completed', title: 'Completed' },
] as const;

export const colTitle = (id: string) => COLUMNS.find((c) => c.id === id)?.title ?? id;
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export function hasEvidence(ev: Evidence[] | undefined | null): boolean {
  return !!ev && ev.some((e) => e.value.trim().length > 0);
}

export const isOverdue = (t: Pick<Task, 'col' | 'due_date'>, today: string) =>
  t.col !== 'completed' && t.due_date < today;

export const isOpen = (t: Pick<Task, 'col'>) => t.col !== 'completed';

export function evidenceFrom(text: string, by: string): Evidence {
  const value = text.trim();
  return {
    type: /^https?:\/\/\S+$/i.test(value) ? 'link' : 'text',
    value,
    added_by: by,
    added_at: new Date().toISOString(),
  };
}

export const NO_DELIVERABLE_TEXT = 'No deliverable for this task.';

/** Recorded when a task is completed and the team says there was no deliverable. */
export function noDeliverableEvidence(by: string): Evidence {
  return { type: 'none', value: NO_DELIVERABLE_TEXT, added_by: by, added_at: new Date().toISOString() };
}

export type DraftErrors = Partial<Record<keyof TaskDraft, string>>;

/** Required fields for creating / saving a task. */
export function validateDraft(d: Partial<TaskDraft>): DraftErrors {
  const e: DraftErrors = {};
  if (!d.title?.trim()) e.title = 'A title is required.';
  if (!d.owner_id) e.owner_id = 'Choose one accountable owner.';
  if (!d.due_date) e.due_date = 'A due date is required.';
  if (!d.deliverable?.trim()) e.deliverable = 'Describe the concrete deliverable.';
  if (d.start_date && d.due_date && d.start_date > d.due_date) e.start_date = 'The start date cannot be after the due date.';
  if (d.blocked && !d.blocker?.trim()) e.blocker = 'Describe what is blocking this task.';
  if (d.owner_id && d.supporters?.includes(d.owner_id))
    e.supporters = 'The owner cannot also be a supporter.';
  return e;
}

export function completionError(t: Pick<Task, 'evidence'>): string | null {
  return hasEvidence(t.evidence)
    ? null
    : 'Say whether there was a deliverable (and if so, what it was and where it is) before marking this task Completed.';
}
