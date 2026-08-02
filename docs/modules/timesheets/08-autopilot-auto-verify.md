# 8 · AutoPilot (Auto-Verify) — Deep Dive

> **⛔ REMOVED 2026-07-25.** AutoPilot has been removed from the Timesheets
> module. The manager control, the adapter (`timesheetAutoPilot.api.ts`), and the
> per-row decision chip no longer exist in the module; the generic
> `core/autopilot/` framework remains only for Swaps/Bids. The autopilot DB
> objects (`timesheet_approval_rules` / `timesheet_decisions` / `timesheet_review_queue`,
> `sm_timesheet_auto_decide`/`_revert`, the enqueue trigger, the `auto-verify-timesheets`
> worker) still exist in prod but are **unused** and may be dropped separately.
> This document is retained as **historical reference** only.

AutoPilot for Timesheets is one instance of a **generic, uniform AutoPilot
framework** shared with Swap auto-approve and Bid auto-assign. All three share the
normalized types in [core/autopilot/types.ts](../../src/modules/core/autopilot/types.ts),
the `<AutoPilotControl>` UI, and the `<AutoPilotDecisionChip>` per-row chip; each
domain plugs in a thin **adapter**.

## 8.1 The one rule — "zero-variance clean punches"

`AUTO_APPROVE` **iff** ALL hold ([variance.ts](../../supabase/functions/auto-verify-timesheets/variance.ts)):

- timesheet status is not already approved/rejected/no_show (`alreadyFinal`);
- attendance is not `no_show` and not `auto_clock_out`;
- **no manual billable edit** exists;
- both scheduled instants and both actual instants are present;
- `|clock-in − scheduled-in| ≤ 7.5 min` **and** `|clock-out − scheduled-out| ≤ 7.5 min`.

Otherwise → `MANUAL_REVIEW`. **Never AUTO_REJECT** (rejection is a human
judgement). Overtime isn't separately evaluated — a late-out beyond +7.5 min
already fails the bound.

`PUNCH_TOLERANCE_MIN = 7.5` is **fixed in code**, not the DB `tolerance_minutes`
column (which is vestigial).

## 8.2 Policy — pure ON/OFF

- One row per org in `timesheet_approval_rules` (`enabled` = the whole switch;
  default `false`). Dept overrides beat org default.
- **No shadow mode** — the framework dropped it as obsolete (the real action
  re-evaluates at commit). `AutoPilotMode = 'OFF' | 'ON'`.
- The control writes only `enabled`; tolerance + window are server-fixed.
- `version` bumps on any change (`fn_bump_timesheet_policy_version`).

## 8.3 The fixed window — 18:00–06:00 Australia/Sydney

- **Enqueue any time:** `enqueue_timesheet_auto_verify` (trigger on `shifts`)
  queues a shift the moment it becomes reviewable **whenever AutoPilot is ON**,
  regardless of time of day.
- **Drain only overnight:** the worker returns early outside 18:00–06:00 Sydney
  (`isWithinAutopilotWindow`, DST-safe), and `is_timesheet_autopilot_active` +
  `sm_timesheet_auto_decide` re-guard the same window server-side.
- **Net effect:** daytime completions **wait** in the queue (managers get first
  crack during office hours); the bot sweeps the leftover clean ones that night.
  No separate backlog RPC needed (`sm_timesheet_enqueue_backlog` is superseded).

## 8.4 Pipeline (component view)

```
shift → terminal attendance state
  │  trg_enqueue_timesheet_auto_verify  (policy ON; any time)
  ▼
timesheet_review_queue (PENDING, idempotency_key)
  │  pg_cron (~1 min) → POST auto-verify-timesheets worker
  │  worker: window check → sm_timesheet_queue_claim (SKIP LOCKED)
  ▼
evaluateTimesheet() (variance.ts, pure, ±7.5m)
  │  AUTO_APPROVE | MANUAL_REVIEW
  ▼
sm_timesheet_auto_decide  → timesheet_decisions (bot log)
  │  AUTO_APPROVE → gated timesheets approve write
  │    (tagged AUTO_APPROVED via app.timesheet.autopilot GUC)
  │    + shifts.lifecycle_status = 'Completed'
  ▼
sm_timesheet_queue_complete (DONE | exp-backoff | DLQ)
```

## 8.5 Commit gateway — `sm_timesheet_auto_decide`

The worker **never writes `timesheets` directly**. The RPC owns the commit and
performs, in order: caller authZ → idempotency dedup → shift exists → **window**
re-check → **previously-reverted** check → **reviewable** check → **enabled**
check → insert `timesheet_decisions` → on `AUTO_APPROVE`: set GUC, flip
`status='approved'` (note "Auto-verified: clean punches within ±7.5m of roster"),
complete the shift, mark decision committed. Non-approve decisions log a
`BOT_REVIEW` audit row instead. Returns a discriminating `code`.

**Billable is left untouched on auto-approve** — the bot only flips status. The
system-wide resolver derives billable = actual punch snapped to 15 min (identical
to manual review); within ±7.5 min of a quarter-hour roster that equals the
scheduled shift anyway. Writing scheduled times would masquerade as a manager
override.

## 8.6 Revert (Undo)

`sm_timesheet_auto_revert(decision_id, actor)`: only a **committed AUTO_APPROVE**
can be reverted → `approved → submitted`, clears `approved_*`, stamps
`reverted_*`, and sets `app.timesheet.revert` so the audit logs `REVERTED` (not
`REOPENED`). A reverted shift is **never re-verified** (`PREVIOUSLY_REVERTED`),
so a manager's undo sticks.

## 8.7 Provenance & guards

- Auto-approved writes log `AUTO_APPROVED` (source `bot`); the same GUC excludes
  the write from `edit_count` and from the "manager adjusted" notification.
- Enqueue/decide are wrapped so an error can never block a shift write.
- Kill-switch = set `enabled=false` (nothing new is queued/committed).

## 8.8 Manager control UI

`<AutoPilotControl adapter={createTimesheetAutoPilotAdapter(...)} />` renders an
ON/OFF button + an "i" explainer built from `TIMESHEET_AUTOPILOT_COPY.howItWorks`:

1. Bot runs only 18:00–06:00 Sydney; office hours = you review.
2. A shift is picked up the moment it's reviewable; daytime ones swept that night.
3. Clean punches (±7.5 m, no manual edit) auto-approved; billable = actual snapped
   to 15 min.
4. Anything else is left for you and shows in that shift's History as "needs review".
5. Never auto-rejected; a decision you undo is never re-verified.

Per-row, `<AutoPilotDecisionChip>` shows the bot's decision; the History popover
shows `AUTO_APPROVED` / `BOT_REVIEW` / `REVERTED` events.

## 8.9 Deployment / bring-up (NOT DEPLOYED)

Per the [worker README](../../supabase/functions/auto-verify-timesheets/README.md#L64)
and project memory: **nothing is live.** Order to bring up:

1. Apply migrations `20260722100000_timesheet_auto_verify.sql` then
   `20260723130000_timesheet_autopilot_fixed_window.sql` (supersedes the
   configurable windowing in `20260723120000`).
2. `supabase functions deploy auto-verify-timesheets` (verify_jwt off; auth via
   `WORKER_SECRET`/service role).
3. `supabase secrets set WORKER_SECRET=…`.
4. Schedule a ~1-min `pg_cron` POST (mirror `auto-approve-swaps-tick`). **The cron
   job is NOT defined in any migration** — must be added at deploy time.
5. Turn AutoPilot ON for an org from the Timesheets control.

**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SECRET`,
`TIMESHEET_WORKER_BATCH_SIZE` (default 10).

## 8.10 Tests

Pure decision core unit-tested in
[`__tests__/variance.test.ts`](../../supabase/functions/auto-verify-timesheets/__tests__/variance.test.ts)
(run: `npx vitest run --config supabase/functions/auto-verify-timesheets/vitest.config.ts`).
