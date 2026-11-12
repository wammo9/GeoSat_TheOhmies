-- Task archive upgrade: completed tasks older than 7 days (or archived by hand) move out of the Completed column
-- into an Archive view. Run ONCE in the Supabase SQL Editor. Safe to run twice; no tasks are changed or deleted.

alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists archived_at timestamptz;

-- Tasks already in Completed: use their last change as the completion time (best information we have).
-- (The audit triggers are paused for this one bookkeeping update so it isn't logged as anyone's edit.)
alter table tasks disable trigger tasks_guard_t;
alter table tasks disable trigger tasks_log_t;
update tasks set completed_at = updated_at where col = 'completed' and completed_at is null;
alter table tasks enable trigger tasks_guard_t;
alter table tasks enable trigger tasks_log_t;

-- keep the completion time up to date from now on
create or replace function tasks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'workspace_id is immutable';
    end if;
    if new.version = old.version and old.event_id is not null and new.event_id is null
       and (to_jsonb(new) - 'event_id') = (to_jsonb(old) - 'event_id') then
      new.version := old.version + 1;   -- automatic unlink when a calendar event is deleted
    elsif new.version <> old.version + 1 then
      raise exception 'stale_version' using errcode = '40001';
    end if;
  else
    new.version := 1;
  end if;
  if not exists (select 1 from people where id = new.owner_id and workspace_id = new.workspace_id) then
    raise exception 'owner must belong to this workspace';
  end if;
  if new.event_id is not null
     and not exists (select 1 from events where id = new.event_id and workspace_id = new.workspace_id) then
    raise exception 'event must belong to this workspace';
  end if;
  -- completion bookkeeping: remember when a task entered Completed; reopening clears it (and any archive flag)
  if new.col = 'completed' then
    if tg_op = 'INSERT' or old.col <> 'completed' then
      new.completed_at := now();
      new.archived_at := null;
    end if;
  else
    new.completed_at := null;
    new.archived_at := null;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function tasks_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare diff jsonb; act text;
begin
  if tg_op = 'INSERT' then
    insert into activity(workspace_id, task_id, actor_id, action, detail)
    values (new.workspace_id, new.id, auth.uid(), 'created',
            jsonb_build_object('title', new.title, 'demo', new.is_demo));
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)) into diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('version', 'updated_at', 'updated_by', 'completed_at');
    if diff is not null then
      act := case when diff ? 'col' then 'moved' else 'edited' end;
      insert into activity(workspace_id, task_id, actor_id, action, detail)
      values (new.workspace_id, new.id, auth.uid(), act, diff);
    end if;
  else
    insert into activity(workspace_id, task_id, actor_id, action, detail)
    values (old.workspace_id, old.id, auth.uid(), 'deleted', jsonb_build_object('title', old.title));
  end if;
  return null;
end $$;
