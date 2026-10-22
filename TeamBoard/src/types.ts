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
  due_date: string; // YYYY-MM-DD, America/Denver calendar date
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
  | 'due_date'
  | 'deliverable'
  | 'priority'
  | 'col'
  | 'blocked'
  | 'blocker'
  | 'dependencies'
>;

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
