import type { Task, TaskDraft } from '../types';

export const MERGE_FIELDS: (keyof TaskDraft)[] = [
  'title',
  'owner_id',
  'supporters',
  'workstream',
  'due_date',
  'deliverable',
  'priority',
  'col',
  'blocked',
  'blocker',
  'dependencies',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function toDraft(t: Task): TaskDraft {
  const d: any = {};
  for (const f of MERGE_FIELDS) d[f] = t[f];
  return d;
}

export interface MergeResult {
  merged: TaskDraft;
  /** Fields both people changed to different values. */
  conflicts: (keyof TaskDraft)[];
}

/**
 * Three-way merge of a task: `base` is what the editor started from, `mine` is
 * their edited draft, `theirs` is the latest saved version. Fields changed by
 * only one side merge automatically; fields changed by both to different values
 * are reported as conflicts (defaulting to the saved version until the user chooses).
 */
export function threeWayMerge(base: TaskDraft, mine: TaskDraft, theirs: TaskDraft): MergeResult {
  const merged: any = { ...theirs };
  const conflicts: (keyof TaskDraft)[] = [];
  for (const f of MERGE_FIELDS) {
    const iChanged = !same(base[f], mine[f]);
    const theyChanged = !same(base[f], theirs[f]);
    if (iChanged && !theyChanged) merged[f] = mine[f];
    else if (iChanged && theyChanged && !same(mine[f], theirs[f])) conflicts.push(f);
  }
  return { merged, conflicts };
}

export function changedFields(base: TaskDraft, mine: TaskDraft): (keyof TaskDraft)[] {
  return MERGE_FIELDS.filter((f) => !same(base[f], mine[f]));
}
