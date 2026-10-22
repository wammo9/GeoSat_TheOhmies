import { addDays, FRIDAY, nextWeekday, WEDNESDAY } from './dates';

/** The Wednesday meeting the working deck is being edited for (today, if today is Wednesday). */
export const nextMeeting = (today: string) => nextWeekday(today, WEDNESDAY);

/** The Friday the next copy is due (today, if today is Friday). */
export const nextSubmissionDue = (today: string) => nextWeekday(today, FRIDAY);

/** A deck submitted on `submittedOn` is presented at the first Wednesday meeting after that date. */
export const meetingAfter = (submittedOn: string) => nextWeekday(addDays(submittedOn, 1), WEDNESDAY);
