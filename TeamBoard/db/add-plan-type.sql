-- Adds "Plan" as a calendar event type (for our own suggested checkpoints, separate from real deadlines).
-- Run ONCE in the Supabase SQL Editor. Safe to run twice; existing events are untouched.

alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check
  check (kind in ('meeting','milestone','deadline','review','plan','pcb','other'));
