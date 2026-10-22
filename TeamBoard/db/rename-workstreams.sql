-- One-time: renames workstream labels on EXISTING tasks to match the new list.
-- Safe to run more than once. Run in the Supabase SQL Editor.
update tasks set workstream = 'Hardware'      where workstream = 'Hardware / PCB';
update tasks set workstream = 'Firmware'      where workstream = 'Firmware / RF';
update tasks set workstream = 'GUI'           where workstream = 'GUI / Data';
update tasks set workstream = 'Documentation' where workstream = 'Documentation / Sponsor';
-- Tasks that were "Firmware / RF" are now "Firmware"; re-tag any that are really RF or Power by hand in the app.
