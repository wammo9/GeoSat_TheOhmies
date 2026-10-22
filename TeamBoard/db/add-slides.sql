-- Customer-slides links upgrade: run ONCE in the Supabase SQL Editor (after the earlier upgrade scripts).
-- Only adds two optional columns; nothing existing changes.

alter table workspace_summary add column slides_pre_url text
  check (slides_pre_url is null or slides_pre_url ~* '^https?://\S+$');
alter table workspace_summary add column slides_post_url text
  check (slides_post_url is null or slides_post_url ~* '^https?://\S+$');

-- keep the change log informative about the new fields
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
