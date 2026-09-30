/**
 * Pi runtime for the Midnight Reminder.
 *
 * All time decisions come from the pure policy in `./policy.ts`; this module
 * only owns the timer, the remembered local date, and delivery of the
 * notification. Every side effect is injected so the runtime can be tested
 * with a fake clock, a controllable timer, and a fake notification function.
 */

import { decideReminder, type LocalDateTime } from './policy.ts';

/** The reminder shown to the user. */
export const REMINDER_MESSAGE =
  'It is after midnight. Consider saving your work and getting some sleep.';

/** Periodic check interval, comfortably within the one-minute requirement. */
export const CHECK_INTERVAL_MS = 30_000;

export interface ReminderRuntimeOptions {
  /** Reads the current local time on every check (never assumes elapsed time). */
  now: () => LocalDateTime;
  /** Schedules a repeating callback; returns a handle for `clearInterval`. */
  setInterval: (callback: () => void, ms: number) => unknown;
  /** Cancels a handle returned by `setInterval`. */
  clearInterval: (handle: unknown) => void;
  /** Delivers the reminder message. */
  notify: (message: string) => void;
  /** Whether the session has an interactive TUI. */
  isInteractive: boolean;
}

export class ReminderRuntime {
  private readonly options: ReminderRuntimeOptions;
  private lastRemindedDate: string | null = null;
  private timerHandle: unknown | undefined;

  constructor(options: ReminderRuntimeOptions) {
    this.options = options;
  }

  /** Idempotent startup: immediate check, then a periodic check. */
  start(): void {
    if (!this.options.isInteractive) {
      return;
    }
    this.check();
    this.timerHandle = this.options.setInterval(
      () => this.check(),
      CHECK_INTERVAL_MS,
    );
  }

  /**
   * Runs one automatic decision using the pure policy.
   *
   * The remembered date is committed synchronously before the notification is
   * delivered, so a re-entrant check can never race into a duplicate.
   */
  check(): void {
    const decision = decideReminder(this.options.now(), this.lastRemindedDate);
    if (!decision.shouldRemind) {
      return;
    }
    this.lastRemindedDate = decision.localDate;
    this.options.notify(REMINDER_MESSAGE);
  }

  /** Stops the timer. Safe to call repeatedly. */
  stop(): void {
    if (this.timerHandle === undefined) {
      return;
    }
    this.options.clearInterval(this.timerHandle);
    this.timerHandle = undefined;
  }

  /** Local date of the last automatic reminder, for tests/inspection. */
  getLastRemindedDate(): string | null {
    return this.lastRemindedDate;
  }

  /** Whether a timer is currently scheduled, for tests/inspection. */
  isTimerActive(): boolean {
    return this.timerHandle !== undefined;
  }
}
