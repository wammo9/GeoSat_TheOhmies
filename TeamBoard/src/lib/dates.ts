export const TZ = 'America/Denver';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

/** Today's calendar date (YYYY-MM-DD) in America/Denver. */
export function todayDenver(now: Date = new Date()): string {
  return dayFmt.format(now);
}

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function addDays(iso: string, n: number): string {
  const d = noon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(iso: string): number {
  return noon(iso).getUTCDay();
}

/** First date on or after `from` that falls on weekday `dow`. */
export function nextWeekday(from: string, dow: number): string {
  let d = from;
  while (weekday(d) !== dow) d = addDays(d, 1);
  return d;
}

export const TUESDAY = 2;
export const THURSDAY = 4;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return noon(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatStamp(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysBetween(a: string, b: string): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 86400000);
}
