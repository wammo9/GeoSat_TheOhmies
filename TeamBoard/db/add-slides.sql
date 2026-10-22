-- Customer slides upgrade (working deck / submitted deck / past decks).
-- Run ONCE in the Supabase SQL Editor. It is safe to run whether or not you ran an earlier
-- version of this script: it renames the earlier "pre/post" link columns if they exist
-- (keeping any links already saved) and adds anything that's missing.

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workspace_summary' and column_name = 'slides_pre_url') then
    alter table workspace_summary rename column slides_pre_url to slides_working_url;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workspace_summary' and column_name = 'slides_post_url') then
    alter table workspace_summary rename column slides_post_url to slides_submitted_url;
  end if;
end $$;

alter table workspace_summary add column if not exists slides_working_url text
  check (slides_working_url is null or slides_working_url ~* '^https?://\S+$');
alter table workspace_summary add column if not exists slides_submitted_url text
  check (slides_submitted_url is null or slides_submitted_url ~* '^https?://\S+$');
alter table workspace_summary add column if not exists slides_submitted_on date;

create table if not exists slide_archive (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  url text not null check (url ~* '^https?://\S+$'),
  submitted_on date,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists slide_archive_ws_idx on slide_archive (workspace_id, submitted_on desc);

alter table slide_archive enable row level security;
drop policy if exists archive_read on slide_archive;
drop policy if exists archive_add on slide_archive;
drop policy if exists archive_del on slide_archive;
create policy archive_read on slide_archive for select using (is_member(workspace_id));
create policy archive_add  on slide_archive for insert with check (is_member(workspace_id));
create policy archive_del  on slide_archive for delete using (is_member(workspace_id));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'slide_archive') then
    alter publication supabase_realtime add table slide_archive;
  end if;
end $$;

-- keep the change log informative about the slide fields
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
                            'slides_submitted_on', new.slides_submitted_on);
  end if;
  insert into activity(workspace_id, entity, actor_id, action, detail)
  values (ws,
          case tg_table_name when 'people' then 'person' when 'invites' then 'invite'
                             when 'members' then 'member' when 'events' then 'event' else 'summary' end,
          auth.uid(), lower(tg_op), r);
  return null;
end $$;

-- "Submit a new copy": atomically files the current submitted deck in the archive and
-- replaces it, refusing if someone else changed the slides since the caller loaded them.
create or replace function submit_slides_copy(p_url text, p_submitted_on date, p_base_version int) returns void
language plpgsql set search_path = public as $$
declare ws uuid; cur workspace_summary%rowtype;
begin
  select workspace_id into ws from members where user_id = auth.uid();
  if ws is null then raise exception 'not_a_member'; end if;
  select * into cur from workspace_summary where workspace_id = ws for update;
  if cur.version <> p_base_version then raise exception 'stale_version' using errcode = '40001'; end if;
  if cur.slides_submitted_url is not null then
    insert into slide_archive(workspace_id, url, submitted_on) values (ws, cur.slides_submitted_url, cur.slides_submitted_on);
  end if;
  update workspace_summary
     set slides_submitted_url = p_url, slides_submitted_on = p_submitted_on, version = cur.version + 1
   where workspace_id = ws;
end $$;
revoke execute on function submit_slides_copy(text, date, int) from public, anon;
grant execute on function submit_slides_copy(text, date, int) to authenticated;
