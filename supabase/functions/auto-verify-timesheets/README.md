# auto-verify-timesheets

The Edge worker for **Timesheets AutoPilot** (auto-verify). Drains
`timesheet_review_queue`, computes a **zero-variance clean-punch** decision, and
hands it to `sm_timesheet_auto_decide`, which owns the commit.

Part of the uniform AutoPilot feature shared with `auto-approve-swaps`
(auto-approve) and, later, `auto-assign-bids` (auto-assign).

## Pipeline

```
shift → terminal attendance state
   │  (trg_enqueue_timesheet_auto_verify, gated to an ENABLED policy)
   ▼
timesheet_review_queue (PENDING)
   │  cron → POST this worker → sm_timesheet_queue_claim (SKIP LOCKED)
   ▼
evaluateTimesheet()  (variance.ts, pure)
   │  AUTO_APPROVE | MANUAL_REVIEW
   ▼
sm_timesheet_auto_decide  →  timesheet_decisions (bot log)
   │  AUTO_APPROVE → gated `timesheets` approve write (tagged AUTO_APPROVED
   │                 in the lifecycle audit via the app.timesheet.autopilot GUC)
   ▼
sm_timesheet_queue_complete (DONE | backoff/DLQ)
```

AutoPilot is a per-org **ON/OFF** switch — no shadow mode. When ON the bot acts;
when OFF nothing is queued. The lifecycle audit (`timesheet_audit_log`) records
bot + manual approvals + edits regardless, via a trigger on `timesheets`.

## Rule — zero-variance clean punches

`AUTO_APPROVE` only when: the shift is at a terminal attendance state, **both**
actual clock instants exist, there are **no** manual billable edits, and both
clock-in and clock-out land within `tolerance_minutes` of schedule (default ±5,
no material overtime). Everything else → `MANUAL_REVIEW`. Timesheets are **never**
auto-rejected. The rule is unit-tested in `__tests__/variance.test.ts`.

Because the rule compares absolute instants (`shifts.start_at/end_at` vs
`actual_start/actual_end`), it needs **no** timezone parsing.

## ⚠️ DEPLOYMENT STATUS — NOT DEPLOYED

Nothing is live. Bring-up order:

1. Apply `supabase/migrations/20260722100000_timesheet_auto_verify.sql`.
2. `supabase functions deploy auto-verify-timesheets` (verify_jwt = off; auth is
   `WORKER_SECRET` / service-role, checked in `isAuthorizedInvocation`).
3. `supabase secrets set WORKER_SECRET=<value>` (match the Vault secret the cron uses).
4. Schedule a ~1-minute `pg_cron` POST (apikey = anon + `X-Worker-Secret`, or a
   service-role bearer) — mirror the `auto-approve-swaps-tick` job.
5. Turn AutoPilot **ON** for a chosen org (`timesheet_approval_rules` row with
   `enabled=true`) from the Timesheets page control.

Observe via `timesheet_decisions` / `timesheet_audit_log`. Kill-switch =
`enabled=false`. Undo a committed auto-verification =
`sm_timesheet_auto_revert(decision_id, actor)`.

## Env

| var | purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | service client |
| `WORKER_SECRET` | shared invocation secret (`X-Worker-Secret`) |
| `TIMESHEET_WORKER_BATCH_SIZE` | claim batch size (default 10) |

## Tests

```
npx vitest run --config supabase/functions/auto-verify-timesheets/vitest.config.ts
```
