export type ColId = 'backlog' | 'tuesday' | 'in_progress' | 'thursday' | 'completed';
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Person {
  id: string;
  workspace_id: string;
  initial: string;
  name: string | null;
  color: string;
  role: string | null;
  focus: string | null;
  user_id: string | null;
  active: boolean;
  version: number;
}

export interface Evidence {
  type: 'link' | 'text' | 'none'; // 'none' = completed with no deliverable
  value: string;
  added_by?: string;
  added_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  owner_id: string;
  supporters: string[];
  workstream: string;
  start_date: string | null; // optional; with due_date it makes a bar on the timeline
  due_date: string; // YYYY-MM-DD, America/Denver calendar date
  event_id: string | null; // optional calendar event this task supports
  deliverable: string;
  priority: Priority;
  col: ColId;
  blocked: boolean;
  blocker: string | null;
  dependencies: string | null;
  evidence: Evidence[];
  is_demo: boolean;
  version: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export type TaskDraft = Pick<
  Task,
  | 'title'
  | 'owner_id'
  | 'supporters'
  | 'workstream'
  | 'start_date'
  | 'due_date'
  | 'event_id'
  | 'deliverable'
  | 'priority'
  | 'col'
  | 'blocked'
  | 'blocker'
  | 'dependencies'
>;

export type EventKind = 'meeting' | 'milestone' | 'deadline' | 'review' | 'other';

export type Recur = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface CalEvent {
  id: string;
  workspace_id: string;
  title: string;
  kind: EventKind;
  start_date: string;
  end_date: string | null; // null = single day
  description: string | null;
  is_major: boolean;
  recur: Recur;
  recur_until: string | null; // last date a repeat may start on
  recur_skip: string[]; // cancelled occurrences (their start dates)
  version: number;
  updated_by: string | null;
  updated_at: string;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Activity {
  id: number;
  entity: string;
  task_id: string | null;
  actor_id: string | null;
  action: string;
  detail: Record<string, any> | null;
  at: string;
}

export interface Summary {
  workspace_id: string;
  weekly_goal: string;
  milestone: string;
  milestone_date: string | null;
  blockers_decisions: string;
  slides_pre_url: string | null;
  slides_post_url: string | null;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

export interface Member {
  user_id: string;
  email: string;
  is_admin: boolean;
}

export interface Invite {
  email: string;
  person_id: string | null;
}
