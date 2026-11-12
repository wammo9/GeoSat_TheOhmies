-- Purchase requests upgrade: adds the order_requests table. Run ONCE in the Supabase SQL Editor (after db/add-budget.sql).
-- Safe to run twice. Only adds things; nothing existing changes.

-- Purchase requests: anyone on the team asks for something to be ordered; the team approves or declines,
-- and an approved request is turned into a normal budget order.
create table if not exists order_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  item text not null check (length(trim(item)) > 0),
  reason text not null check (length(trim(reason)) > 0),       -- why we need it / what it's for
  quantity int not null default 1 check (quantity >= 1),
  est_unit_price numeric(10, 2) check (est_unit_price is null or est_unit_price >= 0),
  supplier text,
  product_link text check (product_link is null or product_link ~* '^https?://\S+$'),
  needed_by date,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'added')),
  decision_note text,
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  order_id uuid references orders on delete set null,          -- the budget order this became
  requested_by uuid references auth.users on delete set null default auth.uid(),
  version int not null default 1,
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists order_requests_ws_idx on order_requests (workspace_id, status, created_at desc);

-- The server, not the browser, decides who requested and who decided (so neither can be faked).
create or replace function order_requests_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.status := 'pending';
    new.requested_by := auth.uid();
    new.decided_by := null; new.decided_at := null; new.decision_note := null; new.order_id := null;
  else
    if new.workspace_id <> old.workspace_id then
      raise exception 'workspace_id is immutable';
    end if;
    if new.version = old.version and old.order_id is not null and new.order_id is null
       and (to_jsonb(new) - 'order_id') = (to_jsonb(old) - 'order_id') then
      new.version := old.version + 1;   -- automatic unlink when the budget order is deleted
    elsif new.version <> old.version + 1 then
      raise exception 'stale_version' using errcode = '40001';
    end if;
    new.requested_by := old.requested_by;
    if new.status is distinct from old.status then
      if new.status = 'pending' then
        new.decided_by := null; new.decided_at := null; new.decision_note := null; new.order_id := null;
      else
        new.decided_by := auth.uid(); new.decided_at := now();
      end if;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists order_requests_guard_t on order_requests;
create trigger order_requests_guard_t before insert or update on order_requests
  for each row execute function order_requests_guard();
drop trigger if exists order_requests_log_t on order_requests;
create trigger order_requests_log_t after insert or update or delete on order_requests
  for each row execute function generic_log();

-- make the change log label request changes properly
create or replace function generic_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; ws uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws := (r ->> 'workspace_id')::uuid;
  if tg_op = 'UPDATE' and tg_table_name = 'workspace_summary' then
    r := jsonb_build_object('weekly_goal', new.weekly_goal, 'milestone', new.milestone,
                            'milestone_date', new.milestone_date, 'blockers_decisions', new.blockers_decisions,
                            'slides_working_url', new.slides_working_url, 'slides_submitted_url', new.slides_submitted_url,
                            'slides_submitted_file_name', new.slides_submitted_file_name,
                            'slides_submitted_on', new.slides_submitted_on);
  end if;
  insert into activity(workspace_id, entity, actor_id, action, detail)
  values (ws,
          case tg_table_name when 'people' then 'person' when 'invites' then 'invite'
                             when 'members' then 'member' when 'events' then 'event' when 'orders' then 'order' when 'order_requests' then 'request' else 'summary' end,
          auth.uid(), lower(tg_op), r);
  return null;
end $$;

alter table order_requests enable row level security;
drop policy if exists requests_read on order_requests;
drop policy if exists requests_add on order_requests;
drop policy if exists requests_edit on order_requests;
drop policy if exists requests_del on order_requests;
create policy requests_read on order_requests for select using (is_member(workspace_id));
create policy requests_add  on order_requests for insert with check (is_member(workspace_id));
create policy requests_edit on order_requests for update using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy requests_del  on order_requests for delete using (is_member(workspace_id) and (requested_by = auth.uid() or is_admin(workspace_id)));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_requests') then
    alter publication supabase_realtime add table order_requests;
  end if;
end $$;
