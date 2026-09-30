/**
 * Pure local-time reminder policy.
 *
 * This module is intentionally free of Pi APIs, timers, and I/O. It only
 * receives explicit local date/time components and the local calendar date of
 * the last automatic reminder, and decides whether to remind.
 */

/** Explicit local date/time fields. Never derived from a UTC/ISO date. */
export interface LocalDateTime {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
  /** 0-59 (optional; lets boundary tests pin the exact second). */
  second?: number;
}

/** The result of one policy evaluation. */
export interface ReminderDecision {
  /** Whether an automatic reminder should be delivered for this instant. */
  shouldRemind: boolean;
  /**
   * Local calendar date key derived from the supplied local fields
   * (format `YYYY-MM-DD`), used to enforce once-per-local-date.
   */
  localDate: string;
}

/** Late night starts at 00:00 local (inclusive). */
const LATE_NIGHT_START_HOUR = 0;
/** Late night ends at 06:00 local (exclusive). */
const LATE_NIGHT_END_HOUR = 6;

/**
 * Derive a local calendar date key from explicit local fields only.
 * No Date, no UTC conversion, no system clock.
 */
function toLocalDateKey(now: LocalDateTime): string {
  const year = String(now.year).padStart(4, '0');
  const month = String(now.month).padStart(2, '0');
  const day = String(now.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Decide whether an automatic reminder is due.
 *
 * @param now supplied local date/time components (authoritative local clock)
 * @param lastRemindedDate local calendar date of the last automatic reminder,
 *   or `null` if none has been delivered in this session
 */
export function decideReminder(
  now: LocalDateTime,
  lastRemindedDate: string | null,
): ReminderDecision {
  const localDate = toLocalDateKey(now);

  const inLateNightWindow =
    now.hour >= LATE_NIGHT_START_HOUR && now.hour < LATE_NIGHT_END_HOUR;
  const alreadyRemindedToday = lastRemindedDate === localDate;

  return {
    shouldRemind: inLateNightWindow && !alreadyRemindedToday,
    localDate,
  };
}