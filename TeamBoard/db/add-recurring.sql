-- Recurring events upgrade: run ONCE in the Supabase SQL Editor, after db/add-calendar.sql.
-- Only adds columns; existing events become "does not repeat".

alter table events add column recur text not null default 'none'
  check (recur in ('none','daily','weekly','biweekly','monthly'));
alter table events add column recur_until date;
alter table events add column recur_skip date[] not null default '{}';
alter table events add constraint recur_until_after_start check (recur_until is null or recur_until >= start_date);
