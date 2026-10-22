import { describe, expect, it } from 'vitest';
import type { CalEvent, Task } from '../types';
import { addMonths, bar, countdown, eventsOnDay, linkedStats, monthGrid, taskSpan, upcomingMajor, weekStart } from './calendar';

const ev = (o: Partial<CalEvent>): CalEvent => ({
  id: 'e', workspace_id: 'w', title: 'E', kind: 'other', start_date: '2026-11-12', end_date: null, description: null,
  is_major: false, version: 1, updated_by: null, updated_at: '', ...o,
});
const task = (o: Partial<Task>): Task => ({
  id: 't', workspace_id: 'w', title: 'T', owner_id: 'J', supporters: [], workstream: 'Hardware', start_date: null,
  due_date: '2026-10-22', event_id: null, deliverable: 'd', priority: 'Medium', col: 'backlog', blocked: false, blocker: null,
  dependencies: null, evidence: [], is_demo: false, version: 1, updated_by: null, updated_at: '', created_at: '', ...o,
});

describe('month grid', () => {
  it('covers the month in Sunday-first weeks', () => {
    const g = monthGrid('2026-10-21');
    expect(g[0][0]).toBe('2026-09-27'); // Oct 1 2026 is a Thursday
    expect(g.flat()).toContain('2026-10-31');
    expect(g.at(-1)!.at(-1)).toBe('2026-10-31'); // a Saturday: five weeks
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
  it('shifts months across year ends', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });
  it('finds the week start', () => expect(weekStart('2026-10-22')).toBe('2026-10-18'));
});

describe('events', () => {
  it('multi-day events appear on each of their days', () => {
    const e = ev({ start_date: '2026-11-12', end_date: '2026-11-14' });
    expect(eventsOnDay([e], '2026-11-13')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-15')).toHaveLength(0);
    expect(eventsOnDay([ev({})], '2026-11-12')).toHaveLength(1);
  });
  it('lists only upcoming big events, soonest first', () => {
    const list = upcomingMajor([
      ev({ id: 'a', is_major: true, start_date: '2026-12-01' }),
      ev({ id: 'b', is_major: true, start_date: '2026-11-01' }),
      ev({ id: 'c', is_major: false, start_date: '2026-10-30' }),
      ev({ id: 'd', is_major: true, start_date: '2026-10-01' }), // already over
      ev({ id: 'e', is_major: true, start_date: '2026-10-20', end_date: '2026-10-23' }), // ongoing
    ], '2026-10-22');
    expect(list.map((x) => x.id)).toEqual(['e', 'b', 'a']);
  });
  it('words the countdown', () => {
    expect(countdown(ev({ start_date: '2026-10-23' }), '2026-10-22')).toBe('tomorrow');
    expect(countdown(ev({ start_date: '2026-11-01' }), '2026-10-22')).toBe('in 10 days');
    expect(countdown(ev({ start_date: '2026-10-22' }), '2026-10-22')).toBe('today');
    expect(countdown(ev({ start_date: '2026-10-20', end_date: '2026-10-25' }), '2026-10-22')).toBe('happening now');
  });
});

describe('timeline bars', () => {
  const win = '2026-10-18';
  it('positions and clips ranges', () => {
    expect(bar('2026-10-20', '2026-10-22', win, 28)).toEqual({ left: 2, width: 3, clipL: false, clipR: false });
    expect(bar('2026-10-10', '2026-10-19', win, 28)).toEqual({ left: 0, width: 2, clipL: true, clipR: false });
    expect(bar('2026-11-10', '2026-12-01', win, 28)).toEqual({ left: 23, width: 5, clipL: false, clipR: true });
    expect(bar('2026-09-01', '2026-10-01', win, 28)).toBeNull();
    expect(bar('2026-12-01', '2026-12-02', win, 28)).toBeNull();
  });
  it('treats tasks without a start date as a single due day', () => {
    expect(taskSpan(task({}))).toEqual({ start: '2026-10-22', end: '2026-10-22', isRange: false });
    expect(taskSpan(task({ start_date: '2026-10-10' })).isRange).toBe(true);
  });
});

describe('linked task stats', () => {
  it('counts done, overdue and blocked tasks for an event', () => {
    const s = linkedStats('e', [
      task({ id: '1', event_id: 'e', col: 'completed' }),
      task({ id: '2', event_id: 'e', due_date: '2026-10-01' }),
      task({ id: '3', event_id: 'e', blocked: true, blocker: 'x', due_date: '2026-12-01' }),
      task({ id: '4', event_id: 'other' }),
    ], '2026-10-22');
    expect(s).toEqual({ total: 3, done: 1, overdue: 1, blocked: 1 });
  });
});
