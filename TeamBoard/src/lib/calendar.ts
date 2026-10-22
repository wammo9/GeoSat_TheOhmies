import type { CalEvent, EventKind, Task } from '../types';
import { addDays, daysBetween, weekday } from './dates';
import { isOverdue } from './rules';

export const KINDS: { id: EventKind; label: string; icon: string }[] = [
  { id: 'meeting', label: 'Meeting', icon: '👥' },
  { id: 'milestone', label: 'Milestone', icon: '🏁' },
  { id: 'deadline', label: 'Deadline', icon: '⚑' },
  { id: 'review', label: 'Review', icon: '🔎' },
  { id: 'other', label: 'Other', icon: '📌' },
];
export const kindInfo = (k: EventKind) => KINDS.find((x) => x.id === k) ?? KINDS[4];

/** Sunday on or before the date. */
export const weekStart = (iso: string) => addDays(iso, -weekday(iso));

/** First day of the month containing `iso`, shifted by `n` months. */
export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

export function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Weeks (Sunday-first) covering the whole month containing `iso`. */
export function monthGrid(iso: string): string[][] {
  const first = `${iso.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const days = eachDay(weekStart(first), addDays(weekStart(last), 6));
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export const eventEnd = (e: Pick<CalEvent, 'start_date' | 'end_date'>) => e.end_date ?? e.start_date;
export const eventsOnDay = (events: CalEvent[], day: string) => events.filter((e) => e.start_date <= day && day <= eventEnd(e));

/** Big events that haven't finished yet, soonest first. */
export function upcomingMajor(events: CalEvent[], today: string, limit = 5): CalEvent[] {
  return events
    .filter((e) => e.is_major && eventEnd(e) >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function countdown(event: Pick<CalEvent, 'start_date' | 'end_date'>, today: string): string {
  if (event.start_date > today) {
    const n = daysBetween(today, event.start_date);
    return n === 1 ? 'tomorrow' : `in ${n} days`;
  }
  if (eventEnd(event) >= today) return event.start_date === today ? 'today' : 'happening now';
  return 'past';
}

export interface Bar {
  left: number; // days from window start
  width: number; // days (inclusive)
  clipL: boolean;
  clipR: boolean;
}

/** Position an inclusive date range inside a window of `days` days; null when it doesn't overlap. */
export function bar(start: string, end: string, winStart: string, days: number): Bar | null {
  const winEnd = addDays(winStart, days - 1);
  if (end < winStart || start > winEnd) return null;
  const s = start < winStart ? winStart : start;
  const e = end > winEnd ? winEnd : end;
  return { left: daysBetween(winStart, s), width: daysBetween(s, e) + 1, clipL: start < winStart, clipR: end > winEnd };
}

/** The dates a task occupies on the timeline; tasks without a start date are a single "due" day. */
export const taskSpan = (t: Pick<Task, 'start_date' | 'due_date'>) => ({
  start: t.start_date ?? t.due_date,
  end: t.due_date,
  isRange: !!t.start_date && t.start_date < t.due_date,
});

export function linkedStats(eventId: string, tasks: Task[], today: string) {
  const linked = tasks.filter((t) => t.event_id === eventId);
  return {
    total: linked.length,
    done: linked.filter((t) => t.col === 'completed').length,
    overdue: linked.filter((t) => isOverdue(t, today)).length,
    blocked: linked.filter((t) => t.blocked && t.col !== 'completed').length,
  };
}
