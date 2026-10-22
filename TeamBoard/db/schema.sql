-- GeoSat Team Board — Supabase/Postgres schema
-- Run once in the Supabase SQL editor (or `psql`) on a fresh project.

-- ---------------------------------------------------------------- tables

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Team profiles (J, A, W, M, T, B ...). Tasks are owned by a person; a person
-- may or may not be linked to a signed-in account yet.
create table people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  initial text not null check (length(trim(initial)) between 1 and 3),
  name text,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  role text,
  focus text,
  user_id uuid references auth.users on delete set null,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now()
);
create unique index people_initial_uq on people (workspace_id, lower(initial)) where active;

-- Accounts allowed into the workspace. One workspace per account.
create table members (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id uuid not null unique references auth.users on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Email addresses allowed to join (claimed automatically at first sign-in).
create table invites (
  workspace_id uuid not null references workspaces on delete cascade,
  email text not null check (email = lower(email)),
  person_id uuid references people on delete set null,
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'other' check (kind in ('meeting','milestone','deadline','review','other')),
  start_date date not null,                        -- calendar dates in America/Denver
  end_date date,                                   -- null = a single-day event
  description text,
  is_major boolean not null default false,         -- "big event": highlighted at the top of the Calendar
  recur text not null default 'none' check (recur in ('none','daily','weekly','biweekly','monthly')),
  recur_until date,                                -- last date a repeat may start on (null = no end)
  recur_skip date[] not null default '{}',         -- individual occurrences that were cancelled
  version int not null default 1,
  created_by uuid references auth.users on delete set null default auth.uid(),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint event_dates check (end_date is null or end_date >= start_date),
  constraint recur_until_after_start check (recur_until is null or recur_until >= start_date)
);
create index events_ws_idx on events (workspace_id, start_date);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  title text not null check (length(trim(title)) > 0),
  owner_id uuid not null references people on delete restrict,
  supporters uuid[] not null default '{}',
  workstream text not null,
  start_date date,                                 -- optional: shows the task as a bar on the Gantt timeline
  due_date date not null,                          -- a calendar date in America/Denver
  event_id uuid references events on delete set null,  -- optional calendar event this task supports
  deliverable text not null check (length(trim(deliverable)) > 0),
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  col text not null default 'backlog'
    check (col in ('backlog','tuesday','in_progress','thursday','completed')),
  blocked boolean not null default false,
  blocker text,
  dependencies text,                               -- integration dependencies
  evidence jsonb not null default '[]'::jsonb,     -- [{type:'link'|'text', value, added_by, added_at}]
  is_demo boolean not null default false,
  version int not null default 1,                  -- optimistic concurrency token
  created_by uuid references auth.users on delete set null default auth.uid(),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint evidence_required check (col <> 'completed' or jsonb_array_length(evidence) > 0),
  constraint blocker_described check (not blocked or length(trim(coalesce(blocker, ''))) > 0),
  constraint start_before_due check (start_date is null or start_date <= due_date)
);
create index tasks_ws_idx on tasks (workspace_id, col, due_date);

create table comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  task_id uuid not null references tasks on delete cascade,
  author_id uuid not null references auth.users default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create table activity (
  id bigserial primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  entity text not null default 'task',             -- task | comment | person | invite | member | summary
  task_id uuid,                                    -- no FK so the history survives deletes
  actor_id uuid,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index activity_ws_idx on activity (workspace_id, at desc);

create table workspace_summary (
  workspace_id uuid primary key references workspaces on delete cascade,
  weekly_goal text not null default '',
  milestone text not null default '',
  milestone_date date,
  blockers_decisions text not null default '',
  slides_pre_url text check (slides_pre_url is null or slides_pre_url ~* '^https?://\S+$'),    -- customer slides before the meeting (e.g. a Canva link)
  slides_post_url text check (slides_post_url is null or slides_post_url ~* '^https?://\S+$'),  -- customer slides after the meeting
  version int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

create or replace function is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from members where workspace_id = ws and user_id = auth.uid()) $$;

create or replace function is_admin(ws uuid) returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from members where workspace_id = ws and user_id = auth.uid() and is_admin) $$;

-- ---------------------------------------------------------------- triggers

-- Rejects stale writes (optimistic concurrency) and stamps who/when.
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
create trigger tasks_guard_t before insert or update on tasks
  for each row execute function tasks_guard();

-- Activity log for tasks: records only the fields that changed.
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
      and n.key not in ('version', 'updated_at', 'updated_by');
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
create trigger tasks_log_t after insert or update or delete on tasks
  for each row execute function tasks_log();

create or replace function comments_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity(workspace_id, entity, task_id, actor_id, action, detail)
  values (new.workspace_id, 'comment', new.task_id, new.author_id, 'commented',
          jsonb_build_object('body', new.body));
  return null;
end $$;
create trigger comments_log_t after insert on comments
  for each row execute function comments_log();

-- Membership / profile / summary changes are logged too.
create or replace function generic_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; ws uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws := (r ->> 'workspace_id')::uuid;
  if tg_op = 'UPDATE' and tg_table_name = 'workspace_summary' then
    r := jsonb_build_object('weekly_goal', new.weekly_goal, 'milestone', new.milestone,
                            'milestone_date', new.milestone_date, 'blockers_decisions', new.blockers_decisions,
                            'slides_pre_url', new.slides_pre_url, 'slides_post_url', new.slides_post_url);
  end if;
  insert into activity(workspace_id, entity, actor_id, action, detail)
  values (ws,
          case tg_table_name when 'people' then 'person' when 'invites' then 'invite'
                             when 'members' then 'member' when 'events' then 'event' else 'summary' end,
          auth.uid(), lower(tg_op), r);
  return null;
end $$;
create trigger people_log_t after insert or update or delete on people for each row execute function generic_log();
create trigger invites_log_t after insert or delete on invites for each row execute function generic_log();
create trigger members_log_t after delete on members for each row execute function generic_log();
create trigger summary_log_t after update on workspace_summary for each row execute function generic_log();

create or replace function summary_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'stale_version' using errcode = '40001';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger summary_guard_t before update on workspace_summary
  for each row execute function summary_guard();

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

-- ---------------------------------------------------------------- RPCs

-- Is there already a team workspace? (Lets a first user know to bootstrap.)
create or replace function has_workspace() returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from workspaces) $$;

-- First-run setup. Only works while no workspace exists; the caller becomes admin.
create or replace function bootstrap_workspace(
  p_name text, p_my_initial text, p_people jsonb, p_invites jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ws uuid; uid uuid := auth.uid(); mail text := lower(auth.jwt() ->> 'email');
  p jsonb; i jsonb; pid uuid; mine uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  lock table workspaces in share row exclusive mode;
  if exists (select 1 from workspaces) then raise exception 'workspace_exists'; end if;

  insert into workspaces(name)
  values (coalesce(nullif(trim(p_name), ''), 'GeoSat Team Board')) returning id into ws;
  insert into workspace_summary(workspace_id) values (ws);
  insert into members(workspace_id, user_id, email, is_admin) values (ws, uid, mail, true);

  for p in select * from jsonb_array_elements(p_people) loop
    insert into people(workspace_id, initial, name, color, role, focus)
    values (ws, p ->> 'initial', coalesce(p ->> 'name', p ->> 'initial'),
            p ->> 'color', p ->> 'role', p ->> 'focus')
    returning id into pid;
    if lower(p ->> 'initial') = lower(p_my_initial) then mine := pid; end if;
  end loop;
  update people set user_id = uid where id = mine;

  for i in select * from jsonb_array_elements(p_invites) loop
    if coalesce(trim(i ->> 'email'), '') <> '' and lower(trim(i ->> 'email')) <> mail then
      insert into invites(workspace_id, email, person_id, invited_by)
      values (ws, lower(trim(i ->> 'email')),
              (select id from people where workspace_id = ws and lower(initial) = lower(i ->> 'initial')),
              uid)
      on conflict do nothing;
    end if;
  end loop;
  return ws;
end $$;

-- Called after sign-in: turns a matching invite into membership.
create or replace function claim_invite() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); mail text := lower(auth.jwt() ->> 'email');
  inv invites%rowtype; ws uuid;
begin
  if uid is null then return null; end if;
  select workspace_id into ws from members where user_id = uid;
  if found then return ws; end if;
  select * into inv from invites where email = mail limit 1;
  if not found then return null; end if;
  -- idempotent: concurrent calls (e.g. a double page load) must not fail
  insert into members(workspace_id, user_id, email) values (inv.workspace_id, uid, mail)
  on conflict do nothing;
  if inv.person_id is not null then
    update people set user_id = uid where id = inv.person_id and user_id is null;
  end if;
  delete from invites where workspace_id = inv.workspace_id and email = mail;
  insert into activity(workspace_id, entity, actor_id, action, detail)
  values (inv.workspace_id, 'member', uid, 'joined', jsonb_build_object('email', mail));
  return inv.workspace_id;
end $$;

revoke execute on function has_workspace(), bootstrap_workspace(text, text, jsonb, jsonb), claim_invite()
  from public, anon;
grant execute on function has_workspace(), bootstrap_workspace(text, text, jsonb, jsonb), claim_invite()
  to authenticated;

-- ---------------------------------------------------------------- row-level security

alter table workspaces enable row level security;
alter table people enable row level security;
alter table members enable row level security;
alter table invites enable row level security;
alter table tasks enable row level security;
alter table comments enable row level security;
alter table activity enable row level security;
alter table workspace_summary enable row level security;
alter table events enable row level security;

create policy ws_read      on workspaces for select using (is_member(id));
create policy people_read  on people for select using (is_member(workspace_id));
create policy people_write on people for insert with check (is_member(workspace_id));
create policy people_edit  on people for update using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy people_del   on people for delete using (is_admin(workspace_id));
create policy members_read on members for select using (is_member(workspace_id));
create policy members_edit on members for update using (is_admin(workspace_id)) with check (is_admin(workspace_id));
create policy members_del  on members for delete using (is_admin(workspace_id));
create policy invites_read on invites for select using (is_member(workspace_id));
create policy invites_add  on invites for insert with check (is_admin(workspace_id));
create policy invites_del  on invites for delete using (is_admin(workspace_id));
create policy tasks_all    on tasks for all using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy comments_read on comments for select using (is_member(workspace_id));
create policy comments_add on comments for insert with check (is_member(workspace_id) and author_id = auth.uid());
create policy comments_del on comments for delete using (author_id = auth.uid());
create policy activity_read on activity for select using (is_member(workspace_id));
create policy summary_read on workspace_summary for select using (is_member(workspace_id));
create policy events_all   on events for all using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy summary_edit on workspace_summary for update using (is_member(workspace_id)) with check (is_member(workspace_id));

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table tasks, comments, activity, workspace_summary, people, members, invites, events;
