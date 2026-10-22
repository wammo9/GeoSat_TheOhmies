import { describe, expect, it } from 'vitest';
import type { Person, Task } from '../types';
import { addDays, nextWeekday, todayDenver, TUESDAY, THURSDAY, weekday } from './dates';
import { EMPTY_FILTERS, matches } from './filters';
import { threeWayMerge, toDraft } from './merge';
import { buildRoster } from './roster';
import { completionError, evidenceFrom, hasEvidence, isOverdue, noDeliverableEvidence, validateDraft } from './rules';
import { textOn } from './color';

const person = (id: string, initial: string): Person => ({
  id, workspace_id: 'w', initial, name: initial, color: '#7C4DBE', role: null, focus: null, user_id: null, active: true, version: 1,
});
const task = (o: Partial<Task>): Task => ({
  id: 't', workspace_id: 'w', title: 'T', owner_id: 'J', supporters: [], workstream: 'Hardware',
  due_date: '2026-10-22', deliverable: 'd', priority: 'Medium', col: 'backlog', blocked: false, blocker: null,
  dependencies: null, evidence: [], is_demo: false, version: 1, updated_by: null, updated_at: '', created_at: '', ...o,
});

describe('dates (America/Denver)', () => {
  it('uses Denver calendar day, not UTC', () => {
    // 2026-10-22 03:30 UTC is still Oct 21 evening in Denver (MDT, UTC-6)
    expect(todayDenver(new Date('2026-10-22T03:30:00Z'))).toBe('2026-10-21');
    expect(todayDenver(new Date('2026-10-22T07:00:00Z'))).toBe('2026-10-22');
  });
  it('finds meeting days', () => {
    expect(weekday('2026-10-21')).toBe(3); // Wednesday
    expect(nextWeekday('2026-10-21', THURSDAY)).toBe('2026-10-22');
    expect(nextWeekday('2026-10-21', TUESDAY)).toBe('2026-10-27');
    expect(nextWeekday('2026-10-22', THURSDAY)).toBe('2026-10-22');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('rules', () => {
  it('requires title, owner, due date, deliverable', () => {
    expect(Object.keys(validateDraft({})).sort()).toEqual(['deliverable', 'due_date', 'owner_id', 'title']);
    expect(validateDraft({ title: 'a', owner_id: 'J', due_date: '2026-01-01', deliverable: 'x' })).toEqual({});
    expect(validateDraft({ title: ' ', owner_id: 'J', due_date: '2026-01-01', deliverable: 'x' }).title).toBeTruthy();
  });
  it('requires a blocker description when blocked', () => {
    const base = { title: 'a', owner_id: 'J', due_date: '2026-01-01', deliverable: 'x' };
    expect(validateDraft({ ...base, blocked: true }).blocker).toBeTruthy();
    expect(validateDraft({ ...base, blocked: true, blocker: 'waiting' }).blocker).toBeUndefined();
  });
  it('requires a deliverable note (or an explicit "no deliverable") to complete', () => {
    expect(completionError({ evidence: [] })).toBeTruthy();
    expect(completionError({ evidence: [evidenceFrom('  ', 'u')] })).toBeTruthy();
    expect(completionError({ evidence: [evidenceFrom('https://x.dev/r', 'u')] })).toBeNull();
    expect(hasEvidence([evidenceFrom('Bench test log, run 4', 'u')])).toBe(true);
    expect(evidenceFrom('https://a.b/c', 'u').type).toBe('link');
    expect(evidenceFrom('Reviewed schematic v3', 'u').type).toBe('text');
    // "No deliverable" is an explicit, recorded answer that also allows completion
    expect(completionError({ evidence: [noDeliverableEvidence('u')] })).toBeNull();
    expect(noDeliverableEvidence('u').type).toBe('none');
  });
  it('overdue only when unfinished and past due; never auto-changes', () => {
    expect(isOverdue(task({ due_date: '2026-10-20' }), '2026-10-21')).toBe(true);
    expect(isOverdue(task({ due_date: '2026-10-20', col: 'completed' }), '2026-10-21')).toBe(false);
    expect(isOverdue(task({ due_date: '2026-10-21' }), '2026-10-21')).toBe(false);
  });
});

describe('filters', () => {
  const people = [person('J', 'J')];
  const t = task({ title: 'Define enclosure', blocked: true, blocker: 'x', priority: 'High', due_date: '2026-10-25' });
  const m = (f: Partial<typeof EMPTY_FILTERS>) => matches(t, { ...EMPTY_FILTERS, ...f }, '2026-10-21', people);
  it('filters by each dimension', () => {
    expect(m({})).toBe(true);
    expect(m({ owner: 'J' })).toBe(true);
    expect(m({ owner: 'A' })).toBe(false);
    expect(m({ workstream: 'GUI' })).toBe(false);
    expect(m({ priority: 'High' })).toBe(true);
    expect(m({ priority: 'Low' })).toBe(false);
    expect(m({ blocked: 'blocked' })).toBe(true);
    expect(m({ blocked: 'unblocked' })).toBe(false);
    expect(m({ due: 'week' })).toBe(true);
    expect(m({ due: 'overdue' })).toBe(false);
    expect(m({ due: 'later' })).toBe(false);
    expect(m({ q: 'ENCLOS' })).toBe(true);
    expect(m({ q: 'nothing' })).toBe(false);
  });
});

describe('roster', () => {
  it('is computed from tasks', () => {
    const rows = buildRoster(
      [person('J', 'J'), person('A', 'A')],
      [
        task({ id: '1', owner_id: 'J', due_date: '2026-10-25' }),
        task({ id: '2', owner_id: 'J', due_date: '2026-10-20', blocked: true, blocker: 'b' }),
        task({ id: '3', owner_id: 'J', col: 'completed' }),
        task({ id: '4', owner_id: 'A', supporters: ['J'] }),
      ],
      '2026-10-21',
    );
    expect(rows[0].open.map((x) => x.id)).toEqual(['2', '1']);
    expect(rows[0].nextDue).toBe('2026-10-20');
    expect(rows[0].overdue).toBe(1);
    expect(rows[0].blocked).toBe(1);
    expect(rows[0].supporting).toBe(1);
    expect(rows[1].open).toHaveLength(1);
  });
});

describe('three-way merge (simultaneous edits)', () => {
  const base = toDraft(task({}));
  it('merges edits to different fields without losing either', () => {
    const mine = { ...base, title: 'Mine' };
    const theirs = { ...base, due_date: '2026-11-01' };
    const r = threeWayMerge(base, mine, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.title).toBe('Mine');
    expect(r.merged.due_date).toBe('2026-11-01');
  });
  it('flags same-field conflicts instead of overwriting', () => {
    const r = threeWayMerge(base, { ...base, title: 'Mine' }, { ...base, title: 'Theirs' });
    expect(r.conflicts).toEqual(['title']);
    expect(r.merged.title).toBe('Theirs');
  });
  it('no conflict if both made the same change', () => {
    expect(threeWayMerge(base, { ...base, title: 'Same' }, { ...base, title: 'Same' }).conflicts).toEqual([]);
  });
});

describe('color', () => {
  it('picks readable text', () => {
    expect(textOn('#E6B800')).toBe('#1B2A3A');
    expect(textOn('#7C4DBE')).toBe('#FFFFFF');
  });
});
