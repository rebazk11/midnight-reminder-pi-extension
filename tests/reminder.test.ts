import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LocalDateTime } from '../src/policy.ts';
import {
  CHECK_INTERVAL_MS,
  REMINDER_MESSAGE,
  createReminderExtension,
  type ReminderEnvironment,
} from '../src/reminder.ts';

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

class FakeTimers {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setInterval = (callback: () => void, _ms: number): number => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };

  clearInterval = (handle: unknown): void => {
    this.callbacks.delete(handle as number);
  };

  get activeCount(): number {
    return this.callbacks.size;
  }

  tick(): void {
    for (const callback of [...this.callbacks.values()]) {
      callback();
    }
  }
}

function makeEnvironment(
  clock: FakeClock,
  timers: FakeTimers,
): ReminderEnvironment {
  return {
    now: clock.now,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };
}

interface FakeCommand {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
}

type Handler = (event: any, ctx: any) => unknown;

/** Minimal stand-in for the Pi ExtensionAPI. */
class FakePi {
  readonly commands = new Map<string, FakeCommand>();
  private readonly handlers = new Map<string, Handler[]>();

  registerCommand(name: string, options: FakeCommand): void {
    this.commands.set(name, options);
  }

  on(event: string, handler: Handler): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => {
      const current = this.handlers.get(event) ?? [];
      this.handlers.set(
        event,
        current.filter((candidate) => candidate !== handler),
      );
    };
  }

  async emit(event: string, payload: any, ctx: any): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }
}

function makeContext(
  mode: 'tui' | 'rpc' | 'json' | 'print',
  notify: (message: string, type?: 'info' | 'warning' | 'error') => void,
): any {
  return {
    mode,
    hasUI: mode === 'tui' || mode === 'rpc',
    ui: { notify },
  };
}

function recordNotifications(): {
  notify: (message: string, type?: 'info' | 'warning' | 'error') => void;
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

test('registers /bedtime-test and the session lifecycle handlers', () => {
  const clock = new FakeClock(local());
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();

  created.factory(pi as any);

  assert.ok(pi.commands.has('bedtime-test'));
  const command = pi.commands.get('bedtime-test');
  assert.ok(command?.description && command.description.length > 0);
});

test('interactive startup inside the window reminds and schedules a check', async () => {
  const clock = new FakeClock(local({ hour: 0, minute: 30 }));
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();
  created.factory(pi as any);
  const recorder = recordNotifications();

  await pi.emit(
    'session_start',
    { type: 'session_start', reason: 'startup' },
    makeContext('tui', recorder.notify),
  );

  assert.deepEqual(recorder.messages, [REMINDER_MESSAGE]);
  assert.equal(timers.activeCount, 1);
  assert.equal(created.getRuntime()?.getLastRemindedDate(), '2024-03-15');
});

test('noninteractive startup creates no timer and no notification', async () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();
  created.factory(pi as any);
  const recorder = recordNotifications();

  await pi.emit(
    'session_start',
    { type: 'session_start', reason: 'startup' },
    makeContext('print', recorder.notify),
  );
  timers.tick();

  assert.equal(recorder.messages.length, 0);
  assert.equal(timers.activeCount, 0);
});

test('/bedtime-test previews without changing automatic reminder state', async () => {
  const clock = new FakeClock(local({ hour: 23, minute: 59 }));
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();
  created.factory(pi as any);
  const recorder = recordNotifications();
  const ctx = makeContext('tui', recorder.notify);

  await pi.emit(
    'session_start',
    { type: 'session_start', reason: 'startup' },
    ctx,
  );
  assert.equal(recorder.messages.length, 0, 'outside window, nothing yet');
  assert.equal(created.getRuntime()?.getLastRemindedDate(), null);

  await pi.commands.get('bedtime-test')!.handler('', ctx);

  assert.deepEqual(recorder.messages, [REMINDER_MESSAGE]);
  assert.equal(
    created.getRuntime()?.getLastRemindedDate(),
    null,
    'preview must not record an automatic reminder',
  );

  // The preview must not suppress the real automatic reminder.
  clock.set(local({ day: 16, hour: 0, minute: 0 }));
  timers.tick();

  assert.equal(recorder.messages.length, 2);
  assert.equal(created.getRuntime()?.getLastRemindedDate(), '2024-03-16');
});

test('shutdown clears the timer', async () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();
  created.factory(pi as any);
  const recorder = recordNotifications();
  const ctx = makeContext('tui', recorder.notify);

  await pi.emit('session_start', { type: 'session_start', reason: 'startup' }, ctx);
  assert.equal(timers.activeCount, 1);

  await pi.emit('session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx);

  assert.equal(timers.activeCount, 0);
  assert.equal(created.getRuntime(), undefined);
});

test('reload does not accumulate timers and never reuses the old context', async () => {
  const clock = new FakeClock(local({ hour: 0, minute: 0 }));
  const timers = new FakeTimers();
  const created = createReminderExtension(makeEnvironment(clock, timers));
  const pi = new FakePi();
  created.factory(pi as any);

  const firstCtx = recordNotifications();
  await pi.emit(
    'session_start',
    { type: 'session_start', reason: 'startup' },
    makeContext('tui', firstCtx.notify),
  );
  assert.equal(firstCtx.messages.length, 1);
  assert.equal(timers.activeCount, 1);

  await pi.emit(
    'session_shutdown',
    { type: 'session_shutdown', reason: 'reload' },
    makeContext('tui', firstCtx.notify),
  );
  assert.equal(timers.activeCount, 0);

  const secondCtx = recordNotifications();
  await pi.emit(
    'session_start',
    { type: 'session_start', reason: 'reload' },
    makeContext('tui', secondCtx.notify),
  );

  assert.equal(timers.activeCount, 1, 'only one timer should be active');
  assert.equal(secondCtx.messages.length, 1, 'fresh runtime may remind again');

  timers.tick();

  assert.equal(firstCtx.messages.length, 1, 'old context must not receive events');
  assert.equal(secondCtx.messages.length, 1, 'no duplicate on the new timer');
});

test('check interval used by the runtime is within one minute', () => {
  assert.ok(CHECK_INTERVAL_MS <= 60_000);
});
