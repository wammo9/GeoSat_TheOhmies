import { describe, expect, it } from 'vitest';
import { meetingAfter, nextMeeting, nextSubmissionDue } from './slides';

describe('slide deck dates', () => {
  it('finds the next Wednesday meeting and Friday due date', () => {
    expect(nextMeeting('2026-10-22')).toBe('2026-10-28'); // Thursday -> next Wednesday
    expect(nextMeeting('2026-10-28')).toBe('2026-10-28'); // the meeting day itself
    expect(nextSubmissionDue('2026-10-22')).toBe('2026-10-23');
    expect(nextSubmissionDue('2026-10-23')).toBe('2026-10-23');
    expect(nextSubmissionDue('2026-10-24')).toBe('2026-10-30'); // weekend -> following Friday
  });
  it('presents a Friday copy at the following Wednesday meeting', () => {
    expect(meetingAfter('2026-10-23')).toBe('2026-10-28');
    expect(meetingAfter('2026-10-28')).toBe('2026-11-04'); // never the same day
  });
});
