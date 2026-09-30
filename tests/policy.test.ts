import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideReminder,
  type LocalDateTime,
} from '../src/policy.ts';

/**
 * Build an explicit local date/time. Defaults to 2024-03-15 00:00 local.
 * All fields are supplied directly; no Date/UTC/ISO is involved.
 */
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

test('23:59 with no prior reminder -> no reminder', () => {
  const decision = decideReminder(local({ hour: 23, minute: 59 }), null);
  assert.equal(decision.shouldRemind, false);
});

test('00:00 with no prior reminder -> reminder', () => {
  const decision = decideReminder(local({ hour: 0, minute: 0 }), null);
  assert.equal(decision.shouldRemind, true);
});

test('00:01 already reminded on the same local date -> no duplicate', () => {
  const decision = decideReminder(
    local({ hour: 0, minute: 1 }),
    '2024-03-15',
  );
  assert.equal(decision.shouldRemind, false);
});

test('05:59 with no prior reminder today -> reminder', () => {
  const decision = decideReminder(local({ hour: 5, minute: 59 }), null);
  assert.equal(decision.shouldRemind, true);
});

test('05:59:59 is still inside the window -> reminder', () => {
  const decision = decideReminder(
    local({ hour: 5, minute: 59, second: 59 }),
    null,
  );
  assert.equal(decision.shouldRemind, true);
});

test('06:00 -> no reminder', () => {
  const decision = decideReminder(local({ hour: 6, minute: 0 }), null);
  assert.equal(decision.shouldRemind, false);
});

test('noon -> no reminder', () => {
  const decision = decideReminder(local({ hour: 12, minute: 0 }), null);
  assert.equal(decision.shouldRemind, false);
});

test('midnight on the next local calendar date -> reminder again', () => {
  const decision = decideReminder(
    local({ day: 16, hour: 0, minute: 0 }),
    '2024-03-15',
  );
  assert.equal(decision.shouldRemind, true);
});

test('decision derives the local calendar date from explicit local fields', () => {
  const decision = decideReminder(local({ hour: 0, minute: 0 }), null);
  assert.equal(decision.localDate, '2024-03-15');
});