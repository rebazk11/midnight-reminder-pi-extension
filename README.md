# Midnight Reminder — Pi Extension

A small Pi extension that reminds the user during late-night hours. It runs
inside an active Pi session only; it never wakes a sleeping computer and never
runs while Pi is closed.

## Purpose

While the interactive Pi TUI is open and the machine is awake, the extension
detects that local time has entered the late-night window and shows a visible,
non-blocking reminder such as:

> It is after midnight. Consider saving your work and getting some sleep.

The user remains free to continue working. The reminder is informational; it
makes no extra model calls, blocks no tools, and never terminates Pi.

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Uses the local time zone of the machine running Pi. |
| AC-2 | Late-night hours are **00:00 inclusive to 06:00 exclusive**. |
| AC-3 | Displays a visible message and lets the user continue. |
| AC-4 | While the interactive TUI is open and the computer is awake, the reminder appears within one minute after midnight **without requiring another user prompt**. |
| AC-5 | If Pi starts between 00:00 and 06:00, the reminder is shown on startup. |
| AC-6 | If execution resumes after a pause inside the window, the reminder is shown on the next check. |
| AC-7 | Shows **at most one automatic reminder per local calendar date within the current extension session**. Repeated prompts and timer checks do not produce duplicates. |
| AC-8 | A fresh session or extension reload may remind again. Persistence across restarts is optional. Separate Pi processes maintain separate state. |
| AC-9 | `/bedtime-test` previews the message **without changing the automatic reminder state**. |
| AC-10 | The timer stops when the extension session shuts down. Reloading must not accumulate active timers or use an old session context. |
| AC-11 | Makes no extra model calls, does not block tools, and does not terminate Pi. |
| AC-12 | In noninteractive operation, both the notification and timer creation are skipped. |

## Local-Time Policy

- The machine's **local time zone** is authoritative.
- Late night is `00:00` inclusive up to, but not including, `06:00`
  (`05:59:59` is late night; `06:00:00` is not).
- The decision is based on explicit local date/time fields
  (`year`, `month`, `day`, `hour`, `minute`, …), **never** on a UTC/ISO date.
  A UTC date key would be wrong for non-UTC time zones around midnight.
- **One automatic reminder per local calendar date per extension session.**
  The policy stores the local calendar date of the last automatic reminder and
  compares it with the current local date. A new local date may remind again.
- A fresh session or extension reload may remind again; state does not need to
  survive a restart. Separate Pi processes keep separate state.

### Decision table

| Supplied local time/state | Expected result |
|---|---|
| 23:59, no prior reminder | No reminder |
| 00:00, no reminder for this date | Remind |
| 00:01, already reminded today | No duplicate |
| 05:59, no reminder today | Remind |
| 06:00 or noon | No reminder |
| Midnight on the next local date | Remind again |

## `/bedtime-test`

`/bedtime-test` is a manual preview command. It displays the reminder message
on demand, in any mode where UI is available, and **does not** record a
reminder for the current date or otherwise change automatic state. Running the
preview does not prevent, and is not counted as, the automatic reminder.

## Architecture: Pure Policy vs. Pi Runtime

The design separates the time decision from the Pi integration so the decision
can be tested without clocks, timers, or a running Pi.

**Pure time policy (no Pi APIs, no timers, no I/O).**

- Receives a supplied local date/time and the date already reminded.
- Decides whether to notify.
- Derives the local calendar date from local fields.
- Implements the `00:00`–`06:00` window and the once-per-local-date rule.

**Pi runtime integration (owns all side effects).**

- Registers the `/bedtime-test` command.
- Starts an immediate check on interactive session startup, then a periodic
  check **every 30 seconds** (comfortably within the one-minute requirement).
- Reads the actual local time on every check, so a delayed callback never
  assumes the computer stayed awake.
- Updates the last-reminded date in the same synchronous decision path that
  delivers the notification, preventing duplicates.
- Clears the timer on session shutdown; cleanup is idempotent and does not
  reuse a stale session context after a reload.
- Targets the normal interactive Pi TUI. Automatic notifications and timers
  are not created in noninteractive operation.

## Target Mode and Non-Goals

The extension targets the **interactive Pi TUI**. In noninteractive operation
it creates no timer and shows no automatic notification.

Non-goals:

- Does not wake a sleeping computer.
- Does not run while Pi is closed.
- Does not persist reminder state across restarts (optional and not required).
- Does not require an MCP server.
- Does not make extra model calls, block tools, or terminate Pi.
- Does not implement configurable quiet hours, snooze, or other optional
  take-home features.

## Running the Tests

```sh
npm test
```

Runs the policy and runtime suites with the Node built-in test runner. All
tests use a simulated clock and a controllable timer; none wait for real time.

## Trying the Extension in Pi

Load only the extension entry point, then use the manual preview command:

```sh
pi --extension ./src/reminder.ts
```

Inside the session:

```text
/bedtime-test
```

`/bedtime-test` shows the reminder on demand and never changes automatic
reminder state.

## Testing Expectations

- Tests use **simulated time**: a supplied or injected clock and a controllable
  timer, never the real clock. Do not change the system clock and do not wait
  until midnight.
- The pure policy is tested directly with explicit local date/time components
  covering the decision table above and the boundaries (`05:59:59`, `06:00:00`,
  date rollover, DST changes, duplicate checks).
- Runtime behavior is tested with a fake notification function so the number
  of deliveries can be counted.
- Required runtime checks include:
  - automatic delivery while idle,
  - crossing midnight within one simulated minute,
  - repeated checks producing no duplicate on the same local date,
  - manual preview not changing automatic state,
  - timer cleanup on shutdown/reload with no old timer firing,
  - startup inside the window, and
  - noninteractive startup creating no timer.
- Tests live outside extension discovery; load only the extension entry point
  while developing, for example `pi --extension ./src/reminder.ts`.
