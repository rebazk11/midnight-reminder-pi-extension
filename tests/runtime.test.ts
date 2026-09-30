import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideReminder, type LocalDateTime } from '../src/policy.ts';
import {
  CHECK_INTERVAL_MS,
  ReminderRuntime,
} from '../src/runtime.ts';

/** Explicit local date/time, defaulting to 2024-03-15 00:00:00 local. */
function local(overrides: Partial<LocalDateTime> = {}): LocalDateTime {
  return {
    year: 2024,
    month: 3,
    day: 15,
    hour: 0,
    minute: 0,
    second: 0,
    ...overrides,
  };
}

/** A controllable clock; tests advance it deliberately. */
class FakeClock {
  private current: LocalDateTime;

  constructor(initial: LocalDateTime) {
    this.current = initial;
  }

  now = (): LocalDateTime => ({ ...this.current });

  set(next: LocalDateTime): void {
    this.current = next;
  }
}

/**
 * A controllable timer. It never fires on its own; the test decides when a
 * callback runs. It also records how many timers are still active so tests can
 * assert cleanup and reload behavior without real time.
 */
class FakeTimers {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  /** Interval values passed to setInterval, in order. */
  readonly scheduledIntervalMs: number[] = [];

  setInterval = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.scheduledIntervalMs.push(ms);
    return id;
  };

  clearInterval = (handle: unknown): void => {
    this.callbacks.delete(handle as number);
  };

  get activeCount(): number {
    return this.callbacks.size;
  }

  /** Run every currently active timer callback exactly once. */
  tick(): void {
    for (const callback of [...this.callbacks.values()]) {
      callback();
    }
  }
}

function recordNotifications(): {
  notify: (message: string) => void;
  messages: string[];
} {
  const messages: string[] = [];
  return {
    messages,
    notify: (message: string) => {
      messages.push(message);
    },
  };
}

test('check interval is comfortably within the one-minute requirement', () => {
  assert.ok(CHECK_INTERVAL_MS <= 60_000, 'interval must be <= 60s');
  assert.ok(CHECK_INTERVAL_MS > 0, 'interval must be positive');
});

test('interactive startup inside the window delivers the reminder immediately', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 30 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();

  assert.equal(messages.length, 1);
  assert.equal(runtime.getLastRemindedDate(), '2024-03-15');
  assert.equal(timers.activeCount, 1);
});

test('startup after midnight but inside the window is checked immediately', () => {
  const clock = new FakeClock(local({ hour: 5, minute: 59, second: 59 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();

  assert.equal(messages.length, 1);
});

test('crossing midnight while idle delivers within one simulated interval', () => {
  const clock = new FakeClock(local({ day: 15, hour: 23, minute: 59 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();
  assert.equal(messages.length, 0, 'nothing before midnight');

  // The machine stays open and idle; only simulated time advances.
  clock.set(local({ day: 16, hour: 0, minute: 0 }));
  timers.tick();

  assert.equal(messages.length, 1, 'reminder after crossing midnight');
  assert.ok(
    timers.scheduledIntervalMs.every((ms) => ms <= 60_000),
    'every scheduled interval is within one minute',
  );
});

test('repeated timer checks on the same local date do not duplicate', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 1 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();
  assert.equal(messages.length, 1);

  clock.set(local({ hour: 0, minute: 2 }));
  timers.tick();
  clock.set(local({ hour: 0, minute: 30 }));
  timers.tick();

  assert.equal(messages.length, 1, 'no duplicate on the same local date');
});

test('the remembered date is committed synchronously with the decision', () => {
  const clock = new FakeClock(local({ hour: 1, minute: 0 }));
  const timers = new FakeTimers();
  const observedDates: Array<string | null> = [];
  let reentered = false;
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify: () => {
      // The date must already be committed when the notification fires.
      observedDates.push(runtime.getLastRemindedDate());
      if (!reentered) {
        reentered = true;
        // A re-entrant check must not race into a duplicate.
        runtime.check();
      }
    },
    isInteractive: true,
  });

  runtime.start();

  assert.deepEqual(observedDates, ['2024-03-15']);
  assert.equal(runtime.getLastRemindedDate(), '2024-03-15');
});

test('resuming after 06:00 does not deliver a missed reminder', () => {
  const clock = new FakeClock(local({ hour: 7, minute: 0 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();
  timers.tick();

  assert.equal(messages.length, 0);
  assert.equal(runtime.getLastRemindedDate(), null);
});

test('shutdown clears the timer and prevents later delivery', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();
  assert.equal(messages.length, 1);
  assert.equal(timers.activeCount, 1);

  runtime.stop();
  assert.equal(timers.activeCount, 0);

  clock.set(local({ day: 16, hour: 0, minute: 0 }));
  timers.tick();
  assert.equal(messages.length, 1, 'no delivery after shutdown');
});

test('stop is idempotent', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const { notify } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: true,
  });

  runtime.start();
  runtime.stop();
  runtime.stop();

  assert.equal(timers.activeCount, 0);
});

test('noninteractive operation creates no timer and no notification', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const { notify, messages } = recordNotifications();
  const runtime = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify,
    isInteractive: false,
  });

  runtime.start();
  timers.tick();

  assert.equal(messages.length, 0);
  assert.equal(timers.activeCount, 0);
  assert.equal(runtime.getLastRemindedDate(), null);
});

test('a new runtime does not reuse the stopped runtime timer or state', () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const first = recordNotifications();
  const runtimeA = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify: first.notify,
    isInteractive: true,
  });
  runtimeA.start();
  assert.equal(first.messages.length, 1);

  // Reload: old runtime shuts down, a fresh runtime starts with fresh state.
  runtimeA.stop();
  const second = recordNotifications();
  const runtimeB = new ReminderRuntime({
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    notify: second.notify,
    isInteractive: true,
  });
  runtimeB.start();

  assert.equal(timers.activeCount, 1, 'only the new timer is active');
  assert.equal(second.messages.length, 1, 'fresh runtime may remind again');

  timers.tick();
  assert.equal(first.messages.length, 1, 'old timer never fires again');
  assert.equal(second.messages.length, 1, 'no duplicate from the new timer');
});
