# Fairness Engine — Remediation Plan

**Date:** 2026-08-05
**Source:** the seven fairness audit documents (engine / manual-ops / autoscheduler /
marketplace / roles+premium / edge-cases / UI)
**Predecessor:** `2026-08-04_fairness-fatigue-architecture-audit.md` (25 findings, all closed)

---

## 0. Corrections to the source documents

Three of the seven docs describe a mechanism that was **deleted on 2026-08-04**. A plan
built on them would re-fix work already done, so these are corrected first.

| Doc | Claim | Actual |
| --- | --- | --- |
| `autoscheduler_fairness_audit.md` §4, §6 | `updateAfterCommit` is an *incremental writeback* that "adds their hours/weekends/nights to the running totals" | **Gone.** The client-side read-modify-write was the root cause of findings F-02/F-06/F-20 and was removed, not patched. `updateAfterCommit` is now four lines that delegate to the authoritative SQL recompute. There is exactly one write implementation. |
| `fairness_manual_operations_audit.md` — "The Staleness Core Concept" §1 | "The solver's own assignments trigger `updateAfterCommit` to *incrementally* reflect its own work" | Same. The solver triggers a **full** org recompute. |
| `fairness_engine_audit.md` §3 | "It is also triggered incrementally on shift commits" | Same. |

Everything else in the docs holds. In particular the central finding of
`fairness_manual_operations_audit.md` and `marketplace_fairness_audit.md` — that shift
mutation and ledger update are completely decoupled — is correct and is the backbone of
this plan.

### The one thing none of the docs say

**Every SQL object they describe is written but not applied to production.**

`get_fairness_debts_latest`, `recompute_fairness_ledger`,
`request_fairness_ledger_recompute`, `public_holidays`, `prune_fairness_ledger` and the
`nightly_fairness_recompute` cron job all live in seven migration files
(`20260804020000` … `20260805020000`) that are deliberately unapplied, pending review.

This matters more than staleness. On this branch the client-side write path has been
removed and the read path now calls `get_fairness_debts_latest`. Against today's
production schema **neither RPC exists**, so:

- `recomputeLedger` → `requestRecompute` → RPC missing → throws → swallowed by the
  `.catch()` at the publish site. The ledger is never written.
- `getLatestDebts` → RPC missing → the read resolves `unavailable`, and the solver
  proceeds with no longitudinal fairness at all.

So the accurate description of production-after-this-branch-deploys is not "fairness is
sometimes stale" — it is **"fairness is inert, and fails silently open."** That is a
deploy-ordering hazard, not a design flaw, but it dictates the sequencing below.

---

## Phase 0 — Deploy ordering (blocking, no new code)

1. Apply the seven migrations. `20260804020000` (read RPC) and `20260804040000`
   (recompute + cron) **must go together** — between them the ledger reports
   `unavailable`.
2. Confirm `pg_cron` is present in prod. Both `20260804040000` and `20260805010000`
   degrade to a `RAISE WARNING` if it is not, which would leave the recompute
   permanently unscheduled while every migration reports success.
3. Verify `get_advisors` immediately after apply — new functions auto-grant `EXECUTE`
   to `anon`, and `REVOKE FROM PUBLIC` alone does not close it. (Recurring gotcha in
   this repo.)

**Nothing below is worth building until fairness actually runs.**

---

## Phase 1 — Close the trigger gap

*Answers: `fairness_manual_operations_audit.md` (all 8 operations),
`marketplace_fairness_audit.md` (all 9 workflows), `fairness_ui_audit.md` §10.*

### Problem

There are exactly two triggers today: `usePublishRoster.onSuccess` and the autoscheduler
commit. Both are **client-side, fire-and-forget, `.catch(console.error)`**. Everything
else — manual assign, unassign, edit, delete, create, move, duplicate, bid award, manual
award after bidding, reserve-list accept, trade approval, swap approval — leaves the
ledger stale until a manager happens to publish or the nightly cron catches it.

The docs frame this as "intentionally permitted staleness". That framing is too
generous. The nightly cron bounds the drift at 24h, but the publish trigger is
load-bearing and lives in a browser tab: close it mid-request and the recompute simply
does not happen.

### Fix

Move the trigger from the call site to the data layer.

- New `fairness_ledger_dirty (organization_id, marked_at)` queue table.
- `AFTER INSERT/UPDATE/DELETE` triggers on `shifts` (guarded to the columns fairness
  actually reads: `assigned_employee_id`, `shift_date`, `start_time`, `end_time`,
  `unpaid_break_minutes`, `lifecycle_status`) and on `shift_bids` (`status`).
- A `pg_cron` job every ~15 min drains the queue, recomputing only orgs that are dirty.
- Delete the fire-and-forget publish trigger, or demote it to a non-load-bearing eager
  nudge.

### Why this shape

The same reasoning that closed F-02/F-06/F-20: **a rule that every caller must remember
will eventually be forgotten.** Enumerating the 17 mutation paths in the two docs and
adding a recompute call to each one leaves the 18th path — added next quarter — broken,
silently, exactly as the current two-trigger design broke the other fifteen. Hanging the
trigger off the table makes the trigger set complete by construction.

It also collapses the entire "Operations Breakdown" and "Workflow Breakdown" sections of
two audit docs into a single answer: *every* operation marks the org dirty, and the
ledger is at most one drain-interval behind.

**Cost:** recompute is a full-org rebuild, so a 15-min cadence on a large org is real
load. Measure before choosing the interval; a per-employee incremental recompute is
possible but reintroduces exactly the divergence class we just removed. Prefer the
coarse, correct version first.

---

## Phase 2 — Measure what happened, not what was planned

*Answers: `fairness_edge_cases_audit.md` #3, #4, #5, #6.*

The ledger reads `shifts.start_time` / `end_time` — the **schedule**. Consequences the
doc correctly identifies:

- **No-show accrues full fairness debt.** The employee is credited with burden they did
  not bear, and the solver then steers work *away* from them as a result. This is the
  engine producing a directly perverse outcome.
- Late clock-in and early clock-out have no effect.

`shifts` already carries `actual_start` / `actual_end`, and the TS layer already has
`isShiftAttendanceFinished` (the shared Time/Live/Payroll Rules predicate). So:

- When the shift is in a terminal attendance state, use actuals.
- Otherwise use the schedule.
- A no-show in a terminal state contributes **zero** worked minutes and does not count
  toward weekend / night / PH burden.

Must land in the SQL recompute **and** its TS twin, with the parity fixture extended.

> **Stakeholder question:** is fairness about *burden borne* or *opportunity allocated*?
> This plan assumes burden borne, because a no-show earning fairness credit is
> indefensible. But an argument exists for opportunity: an employee repeatedly rostered
> onto weekends has borne the scheduling imposition even if one shift fell through.

---

## Phase 3 — Fix the denominator (highest leverage, highest risk)

*Answers: `fairness_edge_cases_audit.md` #1, #2, #11, #12 — all four are one bug.*

### Problem

Debt is `rolling_value − team_average` over a fixed 91 calendar days. Anyone who was not
*available* for all 91 days is measured against a denominator that assumes they were:

| Case | Doc's verdict | Consequence |
| --- | --- | --- |
| On leave (#2) | debt becomes negative | Returns from two weeks' leave to a large negative debt; the solver **aggressively over-schedules them to "catch up"**. Compounds badly for parental / long-service leave. |
| Unavailable (#1) | debt becomes negative | Same mechanism. |
| New employee (#11) | massive negative debt | Every available shift funnels to the new starter — the worst possible onboarding load. |
| Terminated but contract left `Active` (#12) | zero-hour drag | Sits in the cohort for 13 weeks pulling the team average down, making *everyone else* look overworked. |

Every one of these is the same defect: **the denominator is calendar time; it should be
availability time.**

### Fix

Compute per-employee *available days* in the window = window days − approved-leave days
(`leave_requests` where `status = 'approved'`, joined on the date range) − days outside
the contract's active span. Compare **rate per available day** against the cohort's mean
rate, not raw counts against a raw mean.

This resolves all four cases at once and makes the ledger behave correctly for part-year
staff without any special-casing.

### Risk

**This changes every number in the ledger.** It must land *before* Phase 6 makes those
numbers visible to managers, or the dashboard ships with figures that are about to move.
Needs the parity harness extended with explicit leave / new-starter / partial-contract
fixtures, and a before/after diff on a production snapshot to size the shift.

Also note #12 has a non-engineering half: HR must actually set contracts to
`Terminated`. Consider a data-quality alert for contracts whose `end_date` has passed
while `status = 'Active'`.

---

## Phase 4 — Contract-type correctness

*Answers: `fairness_edge_cases_audit.md` #7, #8, #9, #10.*

**Casuals are the live bug.** The doc identifies the `COALESCE(uc.contracted_weekly_hours, 38)`
fallback, but understates it: `hr.user_contracts.contracted_weekly_hours` has a **column
default of 38**, so most casuals have a literal 38 stored and the `COALESCE` never even
fires. Changing the fallback would not help. Casuals are being held to a full-time
ordinary-hours threshold and therefore accrue essentially **no** overtime debt, ever.

`hr.user_contracts.employment_status` (`Full-Time` / `Part-Time` / `Casual` /
`Flexible Part-Time`) is the correct discriminator and is already populated. Select the
overtime treatment from it, consistent with the existing EBA finding that casual loading
absorbs overtime (cl 42.2) — most likely: **exclude casuals from `overtime_minutes`
entirely** rather than invent a threshold for them.

**Student visa (#7)** currently works only by accident — because someone happened to set
24h. If a visa-limit field exists it should be read explicitly; if not, this should be
recorded as an unmodelled risk rather than left looking deliberate.

---

## Phase 5 — Dimensions the ledger does not track

*Answers: `fairness_roles_premium_shifts_audit.md`, `fairness_engine_audit.md` §6, §7.*

**Sunday vs Saturday** is the substantive gap. The ledger collapses both into
`weekend_shifts` and counts them identically — yet the solver already receives
`is_sunday` as a distinct flag (fixed in F-01), and the EBA prices Sunday well above
Saturday. Fairness therefore does not reflect how the business actually values the
burden. Recommend splitting into `saturday_shifts` / `sunday_shifts`, or weighting
Sunday within the existing metric.

**Split / extended / emergent / urgent** — recommend *explicitly declining* to track
split, extended and urgent: they fold into `total_hours` and adding metrics dilutes the
signal. **Emergent / short-notice is different** and worth a metric: being called in at
short notice is precisely the kind of unevenly-distributed burden a fairness ledger
exists to spread, and it is currently invisible.

**Department and role scoping** — leave org-wide (the current F-14 decision is sound and
deliberate). The roles doc notes the real second-order effect: a scarce-qualification
employee accrues heavy debt from coverage-forced assignments, and the solver then steers
their *non-scarce* work away. That is arguably correct behaviour, but it should be a
conscious stakeholder decision rather than an emergent one.

---

## Phase 6 — Make it visible

*Answers: `fairness_ui_audit.md` in full.*

The UI doc's core finding is right and is the largest **product** gap in the set: fairness
drives real assignment decisions and is essentially invisible. Three components surface
it, all piecemeal, none global.

1. **Fairness Ledger Dashboard (manager).** Grid of employees × 6 metrics with debt,
   team average, last-recomputed timestamp and a staleness badge, plus a *Recompute now*
   button. The RPC (`request_fairness_ledger_recompute`) and its authorisation already
   exist in the unapplied migrations — this is a UI build, not a backend one.
2. **Render the run status that already exists.** `auto-scheduler.controller.ts` computes
   a `FairnessLedgerRunStatus` (`ok` / `stale` / `unavailable`) and returns it in the
   result — and **no component reads it**. A solver run that silently ignored fairness
   because the ledger was unavailable currently looks identical to one that applied it.
   This is the cheapest high-value item in the plan.
3. **Reconcile the two representations.** `BidLedgerImpact` shows counts (`2 → 3`),
   the AutoScheduler shows penalty points (`45000`), and a manager cannot translate
   between them. Since `shiftFairnessPenaltyCents` is now the single shared kernel, the
   bidding UI can show both — `+1 weekend → +180 pts` — making the surfaces literally
   the same number.
4. **Fix the caching path.** `BidLedgerImpact` reads via a raw Supabase call outside
   TanStack Query, so a recompute cannot invalidate it. Move it behind a query key.
5. **Employee self-view.** The self-read RLS policy already exists (`20260804060000`).
   Gated on the stakeholder decision below.

> **Stakeholder question:** should employees see their own fairness standing? It is a
> significant trust win and the mechanism is built — but it also exposes relative
> comparison against colleagues, and invites disputes about a number that is currently
> an internal heuristic.

---

## Phase 7 — Retire the rival definition

`fairness_engine_audit.md` §2 lists `compliance/v8/orchestrator/bidding/scorer.ts` as a
fairness participant. It implements a *separate* bid-volume-equity notion of fairness,
and its only entry point `runBidSelection` has **no callers** — it is reachable solely
via a barrel re-export.

Either wire the orchestrator and make its fairness term read the F1 ledger, or delete the
rival definition. Leaving a second, unwired, differently-shaped definition of "fairness"
in the tree is how the five competing definitions catalogued in the 2026-08-04 audit
accumulated in the first place.

---

## Sequencing

```
Phase 0  apply migrations ─────────── blocking, everything depends on it
   │
Phase 1  DB-side dirty queue ──────── independent, ship early (biggest correctness win)
   │
Phase 2  actuals over schedule ─┐
Phase 3  availability denominator ├── all three touch the recompute + TS twin;
Phase 4  contract types ────────┘     batch them into one parity-test cycle
   │
Phase 5  Sunday split / emergent ──── schema change, do after 2-4 settle
   │
Phase 6  dashboard + visibility ───── MUST follow Phase 3 (numbers change)
   │
Phase 7  retire scorer.ts ─────────── independent, any time
```

**Hard ordering constraints:**
- Phase 0 before everything.
- Phase 3 before Phase 6 — do not show managers numbers that are about to move.
- Phases 2–5 each change the SQL recompute *and* `domain/fairness-ledger.ts`. The
  existing parity suite (`fairnessLedger.sqlParity.test.ts`,
  `supabase/tests/fairness_ledger_parity.sql`) is the safety net and **must be extended
  in the same change**, never after.

## Effort and risk

| Phase | Size | Risk | Notes |
| --- | --- | --- | --- |
| 0 | hours | low | Review + apply. Verify `pg_cron` and `get_advisors`. |
| 1 | ~2 days | medium | Trigger load on `shifts` is the thing to measure. |
| 2 | ~1 day | low | Semantics already exist in TS. |
| 3 | ~3 days | **high** | Changes every number. Needs a prod-snapshot diff. |
| 4 | ~1 day | medium | Touches EBA overtime semantics — cross-check the pay engine. |
| 5 | ~2 days | medium | Schema change + backfill. |
| 6 | ~4 days | low | Mostly UI; item 2 is a few hours. |
| 7 | ~half day | low | Deletion, or a small wiring change. |

## Decisions needed before Phase 2/3/5 can be finalised

1. Burden borne (actuals) or opportunity allocated (schedule)? — gates Phase 2.
2. Should leave and unavailability be fairness-neutral? — gates Phase 3. *(This plan
   assumes yes; the current behaviour is almost certainly not intended.)*
3. Should casuals accrue overtime fairness debt at all? — gates Phase 4.
4. ~~Is Sunday a heavier fairness burden than Saturday?~~ — **DECIDED**: yes, 2×, from
   EBA cl 41. Implemented; see the decision record. Phase 5 is reduced to the
   short-notice metric.
5. Should short-notice/emergent assignment be a tracked burden? — gates Phase 5.
6. Should employees see their own standing? — gates Phase 6 item 5.

The nine questions in §10 of the 2026-08-04 audit are now **all closed** — see
[2026-08-05_fairness-stakeholder-decisions.md](2026-08-05_fairness-stakeholder-decisions.md).
Four landed as code (Q5, Q6, Q8, Q9); the rest are staged into the phases above:

| Question | Lands in |
| --- | --- |
| Q1 declared soft/hard tiering | Phase 1-adjacent (solver tiers) |
| Q2 worked, not rostered | no change — confirms current behaviour |
| Q3 eligible-pool peer group | Phase 5 (needs qualifications in the recompute) |
| Q4 availability denominator | **Phase 3** |
| Q7 recorded fatigue override on emergency | Reserve List module |

Note that Q6 landing early changes Phase 5's scope: the Saturday/Sunday split is done,
so Phase 5 is now only the short-notice/emergent metric.
