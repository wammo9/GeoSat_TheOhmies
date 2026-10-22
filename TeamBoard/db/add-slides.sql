-- Customer slides upgrade (working deck / submitted deck as an uploaded file / past decks).
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
alter table workspace_summary add column if not exists slides_submitted_file text;
alter table workspace_summary add column if not exists slides_submitted_file_name text;

create table if not exists slide_archive (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  url text check (url ~* '^https?://\S+$'),
  file_path text,
  file_name text,
  submitted_on date,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
-- (for projects that already have the earlier archive table)
alter table slide_archive add column if not exists file_path text;
alter table slide_archive add column if not exists file_name text;
alter table slide_archive alter column url drop not null;
alter table slide_archive drop constraint if exists archive_has_target;
alter table slide_archive add constraint archive_has_target check (url is not null or file_path is not null);
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
                            'slides_submitted_file_name', new.slides_submitted_file_name,
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
-- replaces it (with an uploaded file, or a link), refusing if someone else changed the
-- slides since the caller loaded them.
drop function if exists submit_slides_copy(text, date, int);
create or replace function submit_slides_copy(
  p_url text, p_file_path text, p_file_name text, p_submitted_on date, p_base_version int
) returns void
language plpgsql set search_path = public as $$
declare ws uuid; cur workspace_summary%rowtype;
begin
  select workspace_id into ws from members where user_id = auth.uid();
  if ws is null then raise exception 'not_a_member'; end if;
  if (p_url is null) = (p_file_path is null) then raise exception 'provide either a link or a file'; end if;
  if p_file_path is not null and split_part(p_file_path, '/', 1) <> ws::text then
    raise exception 'file must be stored in your workspace folder';
  end if;
  select * into cur from workspace_summary where workspace_id = ws for update;
  if cur.version <> p_base_version then raise exception 'stale_version' using errcode = '40001'; end if;
  if cur.slides_submitted_url is not null or cur.slides_submitted_file is not null then
    insert into slide_archive(workspace_id, url, file_path, file_name, submitted_on)
    values (ws, cur.slides_submitted_url, cur.slides_submitted_file, cur.slides_submitted_file_name, cur.slides_submitted_on);
  end if;
  update workspace_summary
     set slides_submitted_url = p_url, slides_submitted_file = p_file_path, slides_submitted_file_name = p_file_name,
         slides_submitted_on = p_submitted_on, version = cur.version + 1
   where workspace_id = ws;
end $$;
revoke execute on function submit_slides_copy(text, text, text, date, int) from public, anon;
grant execute on function submit_slides_copy(text, text, text, date, int) to authenticated;

-- ---------------------------------------------------------------- file storage (submitted slide decks)

-- Folder names in the bucket are workspace ids; this returns null for anything else.
create or replace function try_uuid(t text) returns uuid
language plpgsql immutable as $$ begin return t::uuid; exception when others then return null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slide-decks', 'slide-decks', false, 52428800, array[
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf'
])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "slide decks: members read" on storage.objects;
drop policy if exists "slide decks: members upload" on storage.objects;
drop policy if exists "slide decks: members delete" on storage.objects;
create policy "slide decks: members read" on storage.objects for select to authenticated
  using (bucket_id = 'slide-decks' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy "slide decks: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'slide-decks' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy "slide decks: members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'slide-decks' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
