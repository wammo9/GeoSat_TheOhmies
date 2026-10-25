-- Budget upgrade: adds the orders table (parts and supplies). Run ONCE in the Supabase SQL Editor.
-- Safe to run twice. Only adds things; nothing existing changes.

-- Budget: parts and supplies orders (one row per order line).
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  item text not null check (length(trim(item)) > 0),           -- part name / number
  description text,                                            -- what it's for
  quantity int not null default 1 check (quantity >= 1),
  unit_price numeric(10, 2) not null default 0 check (unit_price >= 0),
  fidelity text,                                               -- e.g. "Rev 2", "Rev 2+"
  supplier text,
  date_needed date,
  date_ordered date,
  wufoo_no text,                                               -- the request-form number
  date_received date,
  notes text,
  product_link text check (product_link is null or product_link ~* '^https?://\S+$'),
  version int not null default 1,
  created_by uuid references auth.users on delete set null default auth.uid(),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint received_after_ordered check (date_received is null or date_ordered is not null)
);
create index if not exists orders_ws_idx on orders (workspace_id, date_needed);

create or replace function orders_guard() returns trigger
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
drop trigger if exists orders_guard_t on orders;
create trigger orders_guard_t before insert or update on orders
  for each row execute function orders_guard();
drop trigger if exists orders_log_t on orders;
create trigger orders_log_t after insert or update or delete on orders
  for each row execute function generic_log();

-- make the change log label order changes properly
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
                             when 'members' then 'member' when 'events' then 'event' when 'orders' then 'order' else 'summary' end,
          auth.uid(), lower(tg_op), r);
  return null;
end $$;

alter table orders enable row level security;
drop policy if exists orders_all on orders;
create policy orders_all on orders for all using (is_member(workspace_id)) with check (is_member(workspace_id));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table orders;
  end if;
end $$;
