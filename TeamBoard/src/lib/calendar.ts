import type { CalEvent, EventKind, Recur, Task } from '../types';
import { addDays, daysBetween, formatDate, weekday } from './dates';
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

export const RECURS: { id: Recur; label: string }[] = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Every month' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Repeats every Thursday", "Repeats monthly on the 5th", … */
export function recurLabel(e: Pick<CalEvent, 'start_date' | 'recur' | 'recur_until'>): string {
  const day = WEEKDAYS[weekday(e.start_date)];
  const base =
    e.recur === 'daily' ? 'Repeats every day'
    : e.recur === 'weekly' ? `Repeats every ${day}`
    : e.recur === 'biweekly' ? `Repeats every other ${day}`
    : e.recur === 'monthly' ? `Repeats monthly on day ${Number(e.start_date.slice(8))}`
    : '';
  return base && e.recur_until ? `${base} until ${formatDate(e.recur_until)}` : base;
}

/** One concrete appearance of an event (a repeating event has many). */
export interface Occurrence {
  event: CalEvent;
  start: string;
  end: string;
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m is 0-based

/**
 * Every occurrence that touches [from, to] (inclusive dates). Non-repeating events yield at most one.
 * Repeats keep the event's length; a monthly repeat on the 29th–31st lands on the month's last day when needed.
 * Skipped (cancelled) dates are left out.
 */
export function occurrences(e: CalEvent, from: string, to: string): Occurrence[] {
  const dur = e.end_date ? daysBetween(e.start_date, e.end_date) : 0;
  const make = (s: string): Occurrence => ({ event: e, start: s, end: addDays(s, dur) });
  const recur = e.recur ?? 'none';
  if (recur === 'none') {
    const o = make(e.start_date);
    return o.end >= from && o.start <= to ? [o] : [];
  }
  const skip = new Set(e.recur_skip ?? []);
  const lastStart = e.recur_until && e.recur_until < to ? e.recur_until : to;
  const out: Occurrence[] = [];
  const earliestStart = addDays(from, -dur); // an occurrence starting this late still reaches `from`
  const take = (s: string) => { if (!skip.has(s)) out.push(make(s)); };
  if (recur === 'monthly') {
    const baseDay = Number(e.start_date.slice(8));
    const m0 = monthIndex(e.start_date);
    for (let k = Math.max(0, monthIndex(earliestStart) - m0 - 1); out.length < 2000; k++) {
      const mi = m0 + k, y = Math.floor(mi / 12), m = mi % 12;
      const s = `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(baseDay, daysInMonth(y, m))).padStart(2, '0')}`;
      if (s > lastStart) break;
      if (s >= earliestStart) take(s);
    }
    return out;
  }
  const step = recur === 'daily' ? 1 : recur === 'weekly' ? 7 : 14;
  const k0 = Math.max(0, Math.ceil(daysBetween(e.start_date, earliestStart) / step));
  for (let k = k0; out.length < 2000; k++) {
    const s = addDays(e.start_date, k * step);
    if (s > lastStart) break;
    take(s);
  }
  return out;
}

export const occurrencesOnDay = (events: CalEvent[], day: string): Occurrence[] =>
  events.flatMap((e) => occurrences(e, day, day));

/** Big events that haven't finished yet (the next occurrence of repeating ones), soonest first. */
export function upcomingMajor(events: CalEvent[], today: string, limit = 5): Occurrence[] {
  return events
    .filter((e) => e.is_major)
    .map((e) => occurrences(e, today, addDays(today, 800))[0])
    .filter((o): o is Occurrence => !!o)
    .sort((a, b) => a.start.localeCompare(b.start) || a.event.title.localeCompare(b.event.title))
    .slice(0, limit);
}

export function countdown(span: { start: string; end: string }, today: string): string {
  if (span.start > today) {
    const n = daysBetween(today, span.start);
    return n === 1 ? 'tomorrow' : `in ${n} days`;
  }
  if (span.end >= today) return span.start === today ? 'today' : 'happening now';
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
