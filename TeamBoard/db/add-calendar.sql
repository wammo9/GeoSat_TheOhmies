-- Calendar upgrade: adds events, task start dates, and task-to-event links.
-- For projects that already ran the earlier db/schema.sql. Run ONCE in the Supabase SQL Editor.
-- It only adds things; existing tasks, comments and people are untouched.

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'other' check (kind in ('meeting','milestone','deadline','review','other')),
  start_date date not null,                        -- calendar dates in America/Denver
  end_date date,                                   -- null = a single-day event
  description text,
  is_major boolean not null default false,         -- "big event": highlighted at the top of the Calendar
  version int not null default 1,
  created_by uuid references auth.users on delete set null default auth.uid(),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_dates check (end_date is null or end_date >= start_date)
);
create index events_ws_idx on events (workspace_id, start_date);

alter table tasks add column start_date date;
alter table tasks add column event_id uuid references events on delete set null;
alter table tasks add constraint start_before_due check (start_date is null or start_date <= due_date);

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
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function generic_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; ws uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws := (r ->> 'workspace_id')::uuid;
  if tg_op = 'UPDATE' and tg_table_name = 'workspace_summary' then
    r := jsonb_build_object('weekly_goal', new.weekly_goal, 'milestone', new.milestone,
                            'milestone_date', new.milestone_date, 'blockers_decisions', new.blockers_decisions);
  end if;
  insert into activity(workspace_id, entity, actor_id, action, detail)
  values (ws,
          case tg_table_name when 'people' then 'person' when 'invites' then 'invite'
                             when 'members' then 'member' when 'events' then 'event' else 'summary' end,
          auth.uid(), lower(tg_op), r);
  return null;
end $$;

-- Calendar events: versioned writes, stamped, and logged.
create or replace function events_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'workspace_id is immutable';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'stale_version' using errcode = '40001';
    end if;
  else
    new.version := 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger events_guard_t before insert or update on events
  for each row execute function events_guard();
create trigger events_log_t after insert or update or delete on events
  for each row execute function generic_log();

alter table events enable row level security;
create policy events_all on events for all using (is_member(workspace_id)) with check (is_member(workspace_id));
alter publication supabase_realtime add table events;
