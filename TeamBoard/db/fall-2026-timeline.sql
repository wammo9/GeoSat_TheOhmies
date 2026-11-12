-- Fall 2026 timeline for the calendar: dates from the Canvas list plus the Capstone Student Manual (Fall 2026).
-- Run ONCE in the Supabase SQL Editor (needs the Calendar and Recurring-events upgrades already applied).
-- Safe to run again: an event is skipped if one with the same title and start date already exists. Events you have
-- edited in the app are never changed or removed by this file; events you added yourself are never touched.
-- Everything is a normal calendar event, so you can edit or delete any of them in the app afterwards.
--
-- Week numbering: Week 10 = Oct 19-23 (PDR week), so Week 1 = Aug 17 and Oct 26-Nov 1 is Week 11.  Events of type "Plan" are our own suggested
-- checkpoints worked backwards from the manual's lead times (they are not course deadlines). They use the "Plan" event type.

-- Adds the "Plan" event type (same as db/add-plan-type.sql; harmless if already applied).
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check check (kind in ('meeting','milestone','deadline','review','plan','other'));

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'recur') then
    raise exception 'Run db/add-recurring.sql first (it adds repeating events), then run this file again.';
  end if;
  if not exists (select 1 from workspaces) then
    raise exception 'No team workspace yet. Create the workspace in the app first.';
  end if;
end $$;

-- If you ran an earlier version of this file: remove its events that moved or were renamed (only if nobody has edited them)...
delete from events
where updated_by is null
  and ((title = 'Week 10: PDR week + start Rev 3' and start_date = date '2026-10-26')
    or (title = 'Rev 3 sprint (Weeks 11-13): final PoC iteration' and start_date = date '2026-11-02')
    or (title = 'Plan: submit PCB Gerbers (Tuesday run)' and start_date = date '2026-10-27')
    or (title = 'Plan: LAST realistic PCB run for the Nov 20 deadline' and start_date = date '2026-11-03')
    or (title = 'Plan: pick the 2 risks/tests for the PoC demo' and start_date = date '2026-11-06')
    or (title = 'Plan: PoC dry run + PCB function check' and start_date = date '2026-11-17')
    or (title = 'Plan: Mini Expo rehearsal (poster, pitch, demo)' and start_date = date '2026-12-01')
    or (title = 'Plan: draft the Phase 1 final report' and start_date = date '2026-11-30'));

-- ...and refresh the wording/dates of events this file created that nobody has edited in the app since.
with ws as (select id from workspaces order by created_at limit 1),
v as (select * from (values
    ('Week 10: PDR week', 'review', '2026-10-19', '2026-10-23', false, 'none', NULL, 'Preliminary Design Review week - done. (For reference: 20-minute presentation plus 5-10 min of questions, every member presents, PDF slides to Canvas the night before; each student also attends 2 other teams'' PDRs for 5 pts each. Manual sections 18 and 6.3.5.) Rev 3 started right after.'),
    ('Rev 3 sprint (Weeks 11-13): final PoC iteration', 'other', '2026-10-26', '2026-11-15', false, 'none', NULL, 'Build Rev 3 of the product design, update ALL documentation, and plan the PoC demo. (Manual section 15.10.1: weeks 11-13 = Oct 26 - Nov 15.)'),
    ('Fall break (no class, nothing due)', 'other', '2026-11-23', '2026-11-29', false, 'none', NULL, 'Week 15 is fall break in the manual, and Canvas has nothing due between Nov 21 and Nov 29. Take a break!'),
    ('Weekly sponsor meeting (Wednesday)', 'meeting', '2026-10-28', NULL, false, 'weekly', '2026-11-18', 'Our weekly sponsor briefing. Update the working deck beforehand; afterwards copy it and submit the copy on Friday. Matches Sponsor Meeting Slides 9-12 on Canvas. (Edit ''repeat until'' if meetings continue.)'),
    ('Sponsor meeting slides due (Fri 11:59 PM)', 'deadline', '2026-10-30', NULL, false, 'weekly', '2026-11-20', 'Canvas: Sponsor Meeting Slides 9 (Oct 30), 10 (Nov 6), 11 (Nov 13), 12 (Nov 20) - 5 pts each. Post an updated copy even if there was no meeting. The Phase 1 Final Report counts as the week-16 sponsor slides.'),
    ('TA Check-In 4 due', 'deadline', '2026-11-02', NULL, false, 'none', NULL, 'Week 12. 20 pts, individual. Under 3 minutes each; one slide per team member on Canvas by 9:30 AM (morning section) or 2:15 PM (afternoon section) on the check-in day. Cover: goals for the last 2 weeks, what YOU accomplished and why it mattered (most important), goals for the next weeks. If you can''t attend, email your TA before class or get a 0.'),
    ('Badge quizzes due (10 badges)', 'deadline', '2026-11-06', NULL, false, 'none', NULL, 'All open until Nov 6, 11:59 PM, 10 pts each: Don''t blow things up, 3D Printing, Stencil, Scope and Function Generator, SMT Soldering, Thru Hole Soldering, Bootloading ''328, Mechanical Fabrication, Capstone Drill Press, SBB best practices. Only 3 badges count toward your grade each semester - each person picks the ones their part of the project needs. Each badge = pdf + hands-on activity + quiz; show your TA a screenshot of the result.'),
    ('Peer Evaluation 2 (opens Nov 8, due Nov 13)', 'deadline', '2026-11-08', '2026-11-13', false, 'none', NULL, '10 pts, individual. Opens Nov 8 at 12:00 AM, due Nov 13 at 11:59 PM. Rate each teammate and yourself green / yellow / red.'),
    ('Mini Expo poster due (Morning and Afternoon sections)', 'deadline', '2026-11-13', NULL, false, 'none', NULL, '20 pts - there is one Canvas assignment per section (Morning, Afternoon); submit to yours. Upload a high-resolution PDF, 48 x 36 in, with the team name in the subject line, by 11:59 PM. Capstone orders the print from FedEx and it can take up to a week to come back. Poster: product/team/sponsor, a hook (<=7 words solution that <=7 words problem), pictures, 3 key features, your journey, <150 words of text. (Manual section 22)'),
    ('PoC Demo due', 'milestone', '2026-11-19', NULL, true, 'none', NULL, '100 pts. Pick TWO major risks (high uncertainty AND high impact), show the tests that reduce them, and present your full risk list. You are scored on how non-trivial the tests are and how you analyze them and decide what''s next - NOT on whether the product passes. Also show a fully functional PCB at the end of the demo (see Functional PCB). Due Nov 19 on Canvas, in week 14 (Nov 16-20), when the manual schedules the PoC demonstrations. (Manual sections 6.4.2, 19)'),
    ('Functional PCB due', 'deadline', '2026-11-20', NULL, true, 'none', NULL, '50 pts (the other 50 pts were for an assembled PCB by week 8). The PCB must be fully functional at the end of the PoC demo. It should be useful for the final product but not necessarily the final design. Remember a PCB spin can take up to 4 weeks (up to 2 weeks vendor lead time, plus assembly and test). (Manual section 6.4.4)'),
    ('TA Check-In 5 due', 'deadline', '2026-11-30', NULL, false, 'none', NULL, 'Week 16. 20 pts, individual - same format as TA Check-In 4: one slide per member, what YOU accomplished.'),
    ('Portfolio and Career Path due', 'deadline', '2026-11-30', NULL, false, 'none', NULL, '10 pts, individual. (Manual section 23: portfolio page, resume, career planning.)'),
    ('Mini Expo presentation', 'milestone', '2026-12-03', NULL, true, 'none', NULL, '50 pts. Open house in the capstone lab: poster, elevator pitch and a short proof-of-concept demo on your bench. Half the class demos to the other half, then they switch after 45 minutes. TAs assess that you have a poster, a demo and an elevator pitch ready. (Manual section 6.4.9)'),
    ('Personal Reflection due', 'deadline', '2026-12-04', NULL, false, 'none', NULL, '10 pts, individual. A short write-up of what you learned and how it shapes your next steps. Must be written by you, not an AI.'),
    ('Project Metrics due', 'deadline', '2026-12-04', NULL, false, 'none', NULL, '25 pts (plus up to 25 extra credit). Staff assess project complexity and how well the team implemented the re-scoped project. (Manual section 6.4.10)'),
    ('Phase 1 Final Report due', 'deadline', '2026-12-07', NULL, true, 'none', NULL, '50 pts. Due 11:59 PM Monday of finals week. About 2000 words with many pictures: an executive summary of the product as it is now and as planned for EXPO, with the latest sponsor slides appended. Ask the sponsor what is confidential before sharing it. Counts as the week-16 sponsor slides. (Manual section 24)'),
    ('Submit PCB Gerbers (Tuesday run)', 'plan', '2026-10-27', NULL, false, 'none', NULL, 'SUGGESTED. Free 2-layer run: upload TeamName_gerber.zip plus the JLC DFM-pass PDF to Canvas by 12:00 PM Tuesday. The order goes in that day and boards arrive by the end of next week (about Nov 6), leaving ~2 weeks to assemble and test before the Nov 19-20 PoC / Functional PCB deadlines. Needs 2+ teams submitting; no assembly, 2-layer, under 100x100 mm, green mask, 5 boards. (Manual sections 9.8 and 11)'),
    ('LAST realistic PCB run for the Nov 20 deadline', 'plan', '2026-11-03', NULL, false, 'none', NULL, 'SUGGESTED. A Tuesday Nov 3 Gerber submission (12:00 PM) gets boards by about Nov 13, leaving only ~6 days to hand-assemble and test before the PoC demo. Later runs won''t arrive in time. A JLC-assembled order from our budget (about 2 weeks delivery, via WUFOO) would also have to be placed around now.'),
    ('Pick the 2 risks/tests for the PoC demo', 'plan', '2026-11-06', NULL, false, 'none', NULL, 'SUGGESTED. Decide which two high-uncertainty, high-impact tests we will show, so the last two weeks of Rev 3 are spent building and collecting data for exactly those.'),
    ('PoC dry run + PCB function check', 'plan', '2026-11-17', NULL, false, 'none', NULL, 'SUGGESTED. Rehearse the full PoC demo, confirm the PCB works, and have the test data and analysis ready - two days before the Nov 19 due date.'),
    ('Mini Expo rehearsal (poster, pitch, demo)', 'plan', '2026-12-01', NULL, false, 'none', NULL, 'SUGGESTED. Practice the elevator pitch and the bench demo; confirm the printed poster arrived.'),
    ('Draft the Phase 1 final report', 'plan', '2026-11-30', '2026-12-06', false, 'none', NULL, 'SUGGESTED. Start from the latest sponsor slides (about 2000 words + pictures), get the sponsor''s OK on confidentiality, finish before Monday Dec 7.')
) as t(title, kind, start_date, end_date, is_major, recur, recur_until, description))
update events e
   set kind = v.kind, end_date = v.end_date::date, is_major = v.is_major::boolean, recur = v.recur, recur_until = v.recur_until::date,
       description = v.description, version = e.version + 1
  from v, ws
 where e.workspace_id = ws.id and e.title = v.title and e.start_date = v.start_date::date and e.updated_by is null;

insert into events (workspace_id, title, kind, start_date, end_date, is_major, recur, recur_until, description)
select ws.id, v.title, v.kind, v.start_date::date, v.end_date::date, v.is_major, v.recur, v.recur_until::date, v.description
from (select id from workspaces order by created_at limit 1) ws,
(values
    ('Week 10: PDR week', 'review', '2026-10-19', '2026-10-23', false, 'none', NULL, 'Preliminary Design Review week - done. (For reference: 20-minute presentation plus 5-10 min of questions, every member presents, PDF slides to Canvas the night before; each student also attends 2 other teams'' PDRs for 5 pts each. Manual sections 18 and 6.3.5.) Rev 3 started right after.'),
    ('Rev 3 sprint (Weeks 11-13): final PoC iteration', 'other', '2026-10-26', '2026-11-15', false, 'none', NULL, 'Build Rev 3 of the product design, update ALL documentation, and plan the PoC demo. (Manual section 15.10.1: weeks 11-13 = Oct 26 - Nov 15.)'),
    ('Fall break (no class, nothing due)', 'other', '2026-11-23', '2026-11-29', false, 'none', NULL, 'Week 15 is fall break in the manual, and Canvas has nothing due between Nov 21 and Nov 29. Take a break!'),
    ('Weekly sponsor meeting (Wednesday)', 'meeting', '2026-10-28', NULL, false, 'weekly', '2026-11-18', 'Our weekly sponsor briefing. Update the working deck beforehand; afterwards copy it and submit the copy on Friday. Matches Sponsor Meeting Slides 9-12 on Canvas. (Edit ''repeat until'' if meetings continue.)'),
    ('Sponsor meeting slides due (Fri 11:59 PM)', 'deadline', '2026-10-30', NULL, false, 'weekly', '2026-11-20', 'Canvas: Sponsor Meeting Slides 9 (Oct 30), 10 (Nov 6), 11 (Nov 13), 12 (Nov 20) - 5 pts each. Post an updated copy even if there was no meeting. The Phase 1 Final Report counts as the week-16 sponsor slides.'),
    ('TA Check-In 4 due', 'deadline', '2026-11-02', NULL, false, 'none', NULL, 'Week 12. 20 pts, individual. Under 3 minutes each; one slide per team member on Canvas by 9:30 AM (morning section) or 2:15 PM (afternoon section) on the check-in day. Cover: goals for the last 2 weeks, what YOU accomplished and why it mattered (most important), goals for the next weeks. If you can''t attend, email your TA before class or get a 0.'),
    ('Badge quizzes due (10 badges)', 'deadline', '2026-11-06', NULL, false, 'none', NULL, 'All open until Nov 6, 11:59 PM, 10 pts each: Don''t blow things up, 3D Printing, Stencil, Scope and Function Generator, SMT Soldering, Thru Hole Soldering, Bootloading ''328, Mechanical Fabrication, Capstone Drill Press, SBB best practices. Only 3 badges count toward your grade each semester - each person picks the ones their part of the project needs. Each badge = pdf + hands-on activity + quiz; show your TA a screenshot of the result.'),
    ('Peer Evaluation 2 (opens Nov 8, due Nov 13)', 'deadline', '2026-11-08', '2026-11-13', false, 'none', NULL, '10 pts, individual. Opens Nov 8 at 12:00 AM, due Nov 13 at 11:59 PM. Rate each teammate and yourself green / yellow / red.'),
    ('Mini Expo poster due (Morning and Afternoon sections)', 'deadline', '2026-11-13', NULL, false, 'none', NULL, '20 pts - there is one Canvas assignment per section (Morning, Afternoon); submit to yours. Upload a high-resolution PDF, 48 x 36 in, with the team name in the subject line, by 11:59 PM. Capstone orders the print from FedEx and it can take up to a week to come back. Poster: product/team/sponsor, a hook (<=7 words solution that <=7 words problem), pictures, 3 key features, your journey, <150 words of text. (Manual section 22)'),
    ('PoC Demo due', 'milestone', '2026-11-19', NULL, true, 'none', NULL, '100 pts. Pick TWO major risks (high uncertainty AND high impact), show the tests that reduce them, and present your full risk list. You are scored on how non-trivial the tests are and how you analyze them and decide what''s next - NOT on whether the product passes. Also show a fully functional PCB at the end of the demo (see Functional PCB). Due Nov 19 on Canvas, in week 14 (Nov 16-20), when the manual schedules the PoC demonstrations. (Manual sections 6.4.2, 19)'),
    ('Functional PCB due', 'deadline', '2026-11-20', NULL, true, 'none', NULL, '50 pts (the other 50 pts were for an assembled PCB by week 8). The PCB must be fully functional at the end of the PoC demo. It should be useful for the final product but not necessarily the final design. Remember a PCB spin can take up to 4 weeks (up to 2 weeks vendor lead time, plus assembly and test). (Manual section 6.4.4)'),
    ('TA Check-In 5 due', 'deadline', '2026-11-30', NULL, false, 'none', NULL, 'Week 16. 20 pts, individual - same format as TA Check-In 4: one slide per member, what YOU accomplished.'),
    ('Portfolio and Career Path due', 'deadline', '2026-11-30', NULL, false, 'none', NULL, '10 pts, individual. (Manual section 23: portfolio page, resume, career planning.)'),
    ('Mini Expo presentation', 'milestone', '2026-12-03', NULL, true, 'none', NULL, '50 pts. Open house in the capstone lab: poster, elevator pitch and a short proof-of-concept demo on your bench. Half the class demos to the other half, then they switch after 45 minutes. TAs assess that you have a poster, a demo and an elevator pitch ready. (Manual section 6.4.9)'),
    ('Personal Reflection due', 'deadline', '2026-12-04', NULL, false, 'none', NULL, '10 pts, individual. A short write-up of what you learned and how it shapes your next steps. Must be written by you, not an AI.'),
    ('Project Metrics due', 'deadline', '2026-12-04', NULL, false, 'none', NULL, '25 pts (plus up to 25 extra credit). Staff assess project complexity and how well the team implemented the re-scoped project. (Manual section 6.4.10)'),
    ('Phase 1 Final Report due', 'deadline', '2026-12-07', NULL, true, 'none', NULL, '50 pts. Due 11:59 PM Monday of finals week. About 2000 words with many pictures: an executive summary of the product as it is now and as planned for EXPO, with the latest sponsor slides appended. Ask the sponsor what is confidential before sharing it. Counts as the week-16 sponsor slides. (Manual section 24)'),
    ('Submit PCB Gerbers (Tuesday run)', 'plan', '2026-10-27', NULL, false, 'none', NULL, 'SUGGESTED. Free 2-layer run: upload TeamName_gerber.zip plus the JLC DFM-pass PDF to Canvas by 12:00 PM Tuesday. The order goes in that day and boards arrive by the end of next week (about Nov 6), leaving ~2 weeks to assemble and test before the Nov 19-20 PoC / Functional PCB deadlines. Needs 2+ teams submitting; no assembly, 2-layer, under 100x100 mm, green mask, 5 boards. (Manual sections 9.8 and 11)'),
    ('LAST realistic PCB run for the Nov 20 deadline', 'plan', '2026-11-03', NULL, false, 'none', NULL, 'SUGGESTED. A Tuesday Nov 3 Gerber submission (12:00 PM) gets boards by about Nov 13, leaving only ~6 days to hand-assemble and test before the PoC demo. Later runs won''t arrive in time. A JLC-assembled order from our budget (about 2 weeks delivery, via WUFOO) would also have to be placed around now.'),
    ('Pick the 2 risks/tests for the PoC demo', 'plan', '2026-11-06', NULL, false, 'none', NULL, 'SUGGESTED. Decide which two high-uncertainty, high-impact tests we will show, so the last two weeks of Rev 3 are spent building and collecting data for exactly those.'),
    ('PoC dry run + PCB function check', 'plan', '2026-11-17', NULL, false, 'none', NULL, 'SUGGESTED. Rehearse the full PoC demo, confirm the PCB works, and have the test data and analysis ready - two days before the Nov 19 due date.'),
    ('Mini Expo rehearsal (poster, pitch, demo)', 'plan', '2026-12-01', NULL, false, 'none', NULL, 'SUGGESTED. Practice the elevator pitch and the bench demo; confirm the printed poster arrived.'),
    ('Draft the Phase 1 final report', 'plan', '2026-11-30', '2026-12-06', false, 'none', NULL, 'SUGGESTED. Start from the latest sponsor slides (about 2000 words + pictures), get the sponsor''s OK on confidentiality, finish before Monday Dec 7.')
) as v(title, kind, start_date, end_date, is_major, recur, recur_until, description)
where not exists (
  select 1 from events e where e.workspace_id = ws.id and e.title = v.title and e.start_date = v.start_date::date
);
