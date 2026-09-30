/**
 * Pi extension entry point for the Midnight Reminder.
 *
 * The factory wires the Pi lifecycle (`session_start`, `session_shutdown`)
 * and the `/bedtime-test` command to a `ReminderRuntime`. Timers are created
 * only from `session_start` and are always cleared by an idempotent
 * `session_shutdown`, so a reload cannot accumulate timers or reuse a stale
 * session context.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { LocalDateTime } from './policy.ts';
import {
  REMINDER_MESSAGE,
  ReminderRuntime,
  type ReminderRuntimeOptions,
} from './runtime.ts';

export { REMINDER_MESSAGE, CHECK_INTERVAL_MS } from './runtime.ts';

/** Injected side-effect dependencies; keeps the timer and clock testable. */
export interface ReminderEnvironment {
  now: () => LocalDateTime;
  setInterval: ReminderRuntimeOptions['setInterval'];
  clearInterval: ReminderRuntimeOptions['clearInterval'];
}

/** Reads the machine's current local time from explicit local fields. */
export function currentLocalDateTime(): LocalDateTime {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
}

export const defaultEnvironment: ReminderEnvironment = {
  now: currentLocalDateTime,
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) =>
    globalThis.clearInterval(
      handle as Parameters<typeof globalThis.clearInterval>[0],
    ),
};

export interface ReminderExtension {
  /** The function Pi calls with its `ExtensionAPI`. */
  factory: (pi: ExtensionAPI) => void;
  /** The runtime for the active session, if any (used by tests). */
  getRuntime: () => ReminderRuntime | undefined;
}

/**
 * Builds the extension factory with injectable side effects. The default
 * export uses the real clock and real timers.
 */
export function createReminderExtension(
  environment: ReminderEnvironment = defaultEnvironment,
): ReminderExtension {
  let runtime: ReminderRuntime | undefined;

  function factory(pi: ExtensionAPI): void {
    pi.registerCommand('bedtime-test', {
      description:
        'Preview the midnight reminder without changing automatic reminder state',
      handler: async (_args, ctx) => {
        // Manual preview only: never reads or writes automatic state.
        ctx.ui.notify(REMINDER_MESSAGE, 'info');
      },
    });

    pi.on('session_start', (_event, ctx) => {
      // Defensive: a previous timer must never survive into a new session.
      runtime?.stop();
      runtime = new ReminderRuntime({
        now: environment.now,
        setInterval: environment.setInterval,
        clearInterval: environment.clearInterval,
        notify: (message) => ctx.ui.notify(message, 'info'),
        isInteractive: ctx.mode === 'tui',
      });
      runtime.start();
    });

    pi.on('session_shutdown', () => {
      runtime?.stop();
      runtime = undefined;
    });
  }

  return { factory, getRuntime: () => runtime };
}

export default createReminderExtension().factory;
