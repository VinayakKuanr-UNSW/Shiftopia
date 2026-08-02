# EBA Pay Engine, Leave Management & Auto-Scheduler Integration — Deep Audit

**Date:** 2026-07-10 · **Reference:** ICC Sydney Enterprise Agreement 2025 (single source of truth)
**Validation state at time of audit:** `npx tsc --noEmit` = 0 errors; vitest payroll + leave + cost suites = 395/395 green (full repo suite ~1297 green per Phase 3 closeout).

---

## 1. Executive Summary

| Area | Verdict |
|---|---|
| **Pay engine (shift pricing)** | **COMPLIANT** post-remediation. Classification-first, effective-dated, casual/permanent-aware rate resolution verified end-to-end. Single award interpreter (`estimateDetailedShiftCost`) shared by payroll, timesheets, and roster costing. |
| **CPI / rate versioning** | **Architecture in place, deployment incomplete.** Effective-dated `RATE_SCHEDULE` + `applyCpiIncrease` (cl 25.1) with a machine-checked DB mirror — but the `eba_rate`/`eba_allowance` migration is **authored, not applied**, and there is **no admin UI**. |
| **Leave management (pay)** | **LARGELY COMPLIANT** with 3 material gaps: casual FDV leave unpaid (cl 46), flexible part-time locked out of leave entirely (cl 12.4(f)), FT-security higher entitlements not accrued (Sch 3 §8). |
| **Leave management (security)** | **ONE HIGH-severity RLS hole**: self-insert of a pre-approved leave request bypasses approval *and* balance deduction. |
| **Leave ↔ scheduler integration** | **DOES NOT EXIST.** Approved leave is invisible to the optimizer, the V8 compliance engine, manual assignment, bidding, and swaps. This is the single largest gap found. |

### Highest-risk issues (ranked)

1. **F1** — Approved leave does not block scheduling anywhere (optimizer / compliance / manual / bids / swaps).
2. **F2** — RLS lets an employee insert an already-`approved` leave request that is paid but never deducted or reviewed.
3. **F3** — Casual FDV leave (cl 46, paid for casuals) pays $0.
4. **F4** — Flexible part-time employees are seeded no balances → cannot request leave at all, and would under-accrue if they could.
5. **F7** — The entire leave DB layer (migration `20260710120000`) is not applied; the shipped UI/API would silently no-op in prod.

### Critical payroll risks
None open on the shift-pricing path — the casual-rate-sourcing critical (≈20% underpay + CPI bypass) was fixed in the Phase 3 remediation and is regression-tested. Residual payroll risk is concentrated in the **leave** paths (F3, F4, F5) and in **deployment drift** (F7, F12).

### Critical scheduling risks
An employee on approved annual leave remains fully assignable by every assignment surface, is never flagged by compliance, and — because "No Show" is time-gated on shift end — will be **marked a no-show** for any rostered shift during their leave. Payroll defends itself (see F1 impact), but the roster, attendance record, and notifications are all wrong.

---

## 2. Findings

Severity scale: **CRIT** (money/legal now) · **HIGH** (money/legal under common conditions) · **MED** · **LOW**.

---

### F1 — Approved leave is invisible to the entire scheduling stack — **HIGH**

**Description.** No scheduling surface consumes `leave_requests`. Verified by exhaustive search: the only readers of `leave_requests` in `src/` are the leave module itself and payroll (`leaveGrossPay.ts`, `grossPay.read.api.ts`).

Answering the audit's specific questions:

| Question | Answer today |
|---|---|
| Does approved leave make the employee unavailable? | **No.** Nothing writes availability blocks or feeds leave to any engine. |
| Can the auto-scheduler assign shifts during approved leave? | **Yes.** The solver payload (`auto-scheduler.controller.ts:571-617`, `roster-fetcher.ts`) sends `availability_slots`, `existing_shifts`, overrides — never leave. `optimizer-service/model_builder.py` has no leave input field (its `availability_overrides` HARD mechanism exists and is the natural carrier, but nothing populates it from leave). |
| Does leave override availability / templates / manual assignment? | **No** on all three. |
| Leave approved *after* shifts assigned? | Nothing happens. Shifts stay assigned; after shift end the attendance processor marks **No Show**. |
| Are managers warned when rostering someone on leave? | **No.** The V8 "availability" rule (`compliance/v8/rules/availability-rules.ts`) only detects shift-overlap (double-booking). |
| Can emergency/manual assignment bypass leave? | Everything bypasses it, because nothing checks it. |
| Bidding / trades during leave? | **Unblocked.** `trg_bid_lock_check` gates only TTS<4h; `sm_select_bid_winner` and the swap engines never consult leave. |
| Does the compliance engine detect it? | **No** — no leave rule exists in `v8/rules/`. |
| Does the optimizer exclude employees on leave? | **No.** |

**Root cause.** The leave module (2026-07-10) was built as a self-contained vertical (balances + requests + payroll synthesis) and was never wired into the four assignment surfaces. There is no shared "absence" primitive the engines already consume.

**Business impact.** Rostering people who legally cannot attend; phantom coverage that collapses on the day; false No-Shows contaminating attendance history and the fairness ledger; manager trust damage. Payroll is *defended* — `getPeriodGrossPay` drops a `scheduled_fallback` shift on a leave day in favour of leave pay — so double-payment does not occur, but that is the only layer that behaves.

**Files affected.** `src/modules/scheduling/data/roster-fetcher.ts`, `src/modules/scheduling/auto-scheduler.controller.ts`, `optimizer-service/model_builder.py` (input only — the `availability_overrides` HARD mechanism already enforces), `src/modules/compliance/v8/rules/` (+ orchestrator registration), `src/modules/rosters/bulk-assignment/*`, bid-winner RPC, swap approval path.

**Recommended fix (correct implementation).**
1. **DB (option A, preferred):** a trigger on `leave_requests` (status → `approved`) that materialises rows into `availability_slots`' sibling concept — or better, a dedicated `leave_blocks(employee_id, date, source_request_id)` view/table the engines read. A view avoids sync bugs: `CREATE VIEW employee_leave_days AS SELECT employee_id, d::date AS leave_date, id AS request_id FROM leave_requests, generate_series(start_date, end_date, '1 day') d WHERE status='approved'`.
2. **Solver:** `RosterFetcher.fetchLeave(employeeIds, window)` → map into each employee's `availability_overrides` as `(startISO, endISO, 'HARD')` — zero Python changes needed; the HARD override path already excludes the employee for those dates.
3. **Compliance V8:** new blocking rule `leave-conflict.ts` — candidate shift date ∈ leave days ⇒ `BLOCKING` for auto/bid/swap contexts, `WARNING` (overridable, logged) for direct manager assignment; register it in the orchestrator so bidding, swaps, and bulk assignment all inherit it. Policy recommendation: manual override allowed **only** with explicit confirm + audit event (mirrors the legal_hard » coverage precedence already locked for the solver).
4. **Approval-time sweep:** on approving leave, list the employee's assigned shifts in-range and prompt the manager to unassign/re-open them (batch `sm_apply_shift_op` unassign); at minimum emit a conflict notification.
5. **Attendance:** exclude leave days from the No-Show pass (`process_shift_timers` / status-dot gate) so an un-swept shift doesn't defame the employee.

---

### F2 — RLS allows self-inserted pre-approved leave (unpaid-guard + approval bypass) — **HIGH**

**Description.** `leave_requests_self_insert` is `WITH CHECK (employee_id = auth.uid())` — **status is unconstrained**. An employee can `INSERT ... status='approved'`. The balance-deduction trigger (`trg_leave_balance_deduction`) is `AFTER UPDATE` only, so the insert **also skips deduction**. Payroll's `APPROVED_LEAVE_STATUSES` then prices it.

**Root cause.** Migration `20260710120000_leave_module.sql` §5 policy omits a status predicate; §4 trigger omits `INSERT`.

**Impact.** Paid leave without approval and without balance consumption — direct wage-theft vector; also corrupts balances (used_hours never increments).

**Fix (DB, one migration).**
```sql
DROP POLICY leave_requests_self_insert ON leave_requests;
CREATE POLICY leave_requests_self_insert ON leave_requests FOR INSERT
  WITH CHECK (employee_id = auth.uid() AND status = 'pending');
-- and make the trigger INSERT-safe:
CREATE TRIGGER trg_leave_balance_deduction
  AFTER INSERT OR UPDATE ON leave_requests ...
-- (function already guards with OLD IS DISTINCT FROM; for INSERT treat OLD as NULL)
```
Also constrain `approved_by IS NULL` on insert. Frontend needs no change (`createLeaveRequest` already inserts `pending`).

---

### F3 — Casual FDV leave pays $0 (cl 46) — **HIGH**

**Description.** Cl 46 + NES Div 11: FDV leave is **paid for casuals** at their rostered hours. `buildLeaveInputs` (`leaveGrossPay.ts:250`) returns `[]` for casuals, and the award engine (`standard.ts:428`) returns `ZERO_RESULT` for any casual leave flag. The gap is documented in-code as KNOWN GAP. The leave module *does* grant casuals an FDV balance (seed §7 inserts `fdv` for **all** profiles; `paidForCasual: true` in `leave-policy.ts`) — so a casual can *request and be approved* for FDV leave that then pays nothing.

**Root cause.** FDV is routed through the personal-leave path, which correctly zeroes casuals for every *other* leave type; FDV is the one exception and needs rostered-hours pricing, which now exists (`fetchRosteredMinutes`).

**Impact.** Statutory underpayment for any casual taking FDV leave; NES breach (NES prevails per cl 4.2).

**Fix.** Introduce a distinct `isFdvLeave` flag end-to-end: `leaveTypeToFlags` maps `/family|domestic|violence|fdv/` → `{ isFdvLeave: true }`; `buildLeaveInputs` skips the casual early-return for FDV and uses `dailyMinutesOverrides` (rostered minutes) as the hours source — a casual with no rostered shifts in the range gets $0, which matches cl 46.6 ("paid for the hours the Team Member is rostered on the day"). Engine: price FDV as flat ordinary (casual: loaded rate, since their ordinary rate includes loading). **Payslip code must remain non-identifying** (present as `personal_leave`/`other_leave` — the existing comment already mandates this; keep the earnings `code` generic and only the internal flag distinct).

---

### F4 — Flexible part-time employees locked out of leave — **MED-HIGH**

**Description.** Two defects compound:
1. **Seed (§7)** inserts annual/personal balances only for `employment_type IN ('full_time','part_time')` — flexible part-time (a first-class EBA category, cl 12.4, entitled pro-rata per cl 12.4(f)) gets **no balance rows**. `createLeaveRequest`'s balance check then rejects every request ("Insufficient balance: 0h available").
2. **Accrual** for flex-PT (not excluded by the `NOT LIKE '%casual%'` filter) uses `COALESCE(contracted_weekly_hours, 38)` — flex-PT has *no guaranteed weekly hours* (cl 12.4(b)); accruing at 38h/wk over-accrues. Cl 44.3/45.3: accrual follows **ordinary hours actually worked**.

**Fix.** Seed all non-casual employment types; change the accrual basis for flex-PT (and ideally all types) to hours worked — e.g. nightly job sums the prior day's approved ordinary hours × (4/52·5 ≈ annual factor `0.0769` per hour worked for AL; `0.0385` for personal), or monthly reconciliation from timesheets. Interim: accrue flex-PT at trailing-12-week average hours.

---

### F5 — Full-time Security leave entitlements under-accrued (Sch 3 §8) — **MED**

**Description.** Schedule 3 §8.2/8.3: FT Security = **5 weeks (210h) annual leave** and **84h personal leave** per year. `accrue_leave_balances()` applies 4 weeks / 76h to everyone.

**Fix.** Add a security-role predicate to the accrual UPDATEs (role/classification join — the same `roles.name ILIKE '%security%'` convention the pay engine uses) with factors `×5` weeks and `84/365·h` daily; seed FT-security at 210/84. Note §8.2 says pro-rata "for part-time Team Members" — part-time *event* security stays at 4 weeks per §8.4, so gate strictly on **full-time + security**.

---

### F6 — Optimizer labour-cost signal diverges from the award engine — **MED**

**Description.** Three defects in the solver's cost model (ranking/objective only — never payroll):
1. `auto-scheduler.controller.ts:594`: `hourly_rate: e.remuneration_rate ?? (isFT ? 25.65 : isPT ? 25.65 : 32.06)` — hardcoded **2025 L1** rates; `remuneration_rate` is NULL in prod (per roster-stats audit), so effectively **every employee is costed at L1**, and the fallback will silently go stale on the first CPI increase (the exact failure mode Phase 2 eliminated for TS surfaces).
2. `model_builder.py::_assignment_cost_cents` applies PH ×2.5 and Sun ×1.5 but **no Saturday ×1.25**, and cannot distinguish the casual loaded rate from a permanent base.
3. OT is modelled as a single 50% surcharge tier (cl 42.2 is 150% first 3h then 200%) — already flagged in the availability/cost policy memo as the reason the solver loaded PT to 40h OT while casuals sat idle.

**Impact.** Cost tie-breaking ranks candidates on wrong relative prices; the locked policy "casuals absorb marginal hours instead of PT/FT overtime" cannot bind correctly. Classification differences (L1 vs L7 is a 33% spread) are invisible.

**Fix.** Client sends a **true classification-resolved rate**: resolve via `resolveRateSet(shiftDate).wageRates[level]` per employee (casual vs permanent column) at payload-build time — the TS schedule is already worker-safe/synchronous. Python: add Saturday ×1.25 (and align `is_saturday` plumbing with the existing `is_sunday`/`is_public_holiday` flags), and add the second OT tier. Cheap, contained, testable in `test_solver_regressions.py`.

---

### F7 — Leave DB layer not deployed; UI ships against missing tables — **MED (deployment gate)**

**Description.** Migration `20260710120000_leave_module.sql` is explicitly `AUTHORED, NOT APPLIED` — as is `20260709000000` (eba_rate/eba_allowance) and `20260709100000` (gross_pay_records). The Leave page, balance checks, approval flow, and the accrual cron all target `leave_balances` / new columns that don't exist in prod. `leave.api.ts` error paths return `[]`/log-only, so the UI will render empty rather than crash — a silent failure.

**Fix.** Apply the three migrations **in order** via `mcp apply_migration` (per the project's hard-learned rule: `db push` unsafe, migration file ≠ applied). Pre-apply F2's policy/trigger fix so the hole never ships. Post-apply: verify seeds against prod `profiles.employment_type` values (confirm the actual enum spellings before trusting the `IN` list — same class of drift as the Python `employment_type` bug found in the grid audit).

---

### F8 — FDV anniversary reset requires the cron to run exactly on the anniversary — **LOW**

**Description.** The FDV reset fires only when `EXTRACT(month/day FROM start_date) = CURRENT_DATE` — one missed 2 AM run (outage, pg_cron pause) skips the reset for a whole year. Feb-29 anniversaries never match in non-leap years.

**Fix.** Store `last_reset_on` (or reuse `as_of_date`) and reset when `CURRENT_DATE >= this_year_anniversary AND last_reset < this_year_anniversary`.

---

### F9 — Per-occasion caps unenforced for compassionate / carer pricing — **LOW**

**Description.** Compassionate (2 days/occasion, cl 48) maps to the carer flag and prices every eligible day in the range; `paidDayCapFor` caps only parental/jury/supporting-carer. A 5-day "compassionate" request would pay 5 days. Mitigated by manager approval seeing the dates, but the engine should enforce.

**Fix.** Add `COMPASSIONATE_CAP_DAYS = 2` keyed off a distinct compassionate flag (currently folded into carer — split the regex `/compassionate|bereavement/` out before the carer match).

---

### F10 — Unmodelled EBA leave mechanics — **LOW (catalogue)**

Not implemented anywhere (request-level features, no pay-correctness risk today because they simply can't be requested):
- Annual leave at **half pay** (cl 44.9) and **cashing out** (cl 44.10, ≥4-week floor, separate written agreement each time).
- **Excessive accrual** direction (cl 44.11, >8 weeks; direction floor 6 weeks).
- LSL half-pay / cash-out (cl 49.4/49.5).
- **Editing** an approved request (change dates) — today only cancel-if-pending (employee) or status flip (manager). Revocation *does* restore balance via the trigger, so cancel-and-recreate is a workable manual path.
- Leave **accrual during** annual/personal leave (paid leave counts as service) — the current daily accrual is calendar-based so this happens to be correct; unpaid leave should *pause* accrual (cl 57.3) and currently does not (calendar accrual keeps running unless the contract is ended). Add an unpaid-leave exclusion window to the accrual function.

---

### F11 — Taxonomy bridge between leave module and payroll is regex-based — **LOW**

**Description.** The leave module writes canonical codes (`annual`, `personal`, `carer`, `compassionate`, `parental`, `long_service`, `jury_duty`, `fdv`, `supporting_carer`, `community_service`, `unpaid`); payroll's `leaveTypeToFlags` maps free text by regex. Verified: **every canonical code maps correctly** today (incl. `community_service`/`unpaid` → null → unpaid; `fdv` → personal-path; `supporting_carer` matched before the broader carer/parental families). It is nonetheless a silent-drift risk when a new code is added.

**Fix.** Add an exhaustive mapping test: for each `LeaveTypeCode` in `leave.types.ts`, assert `leaveTypeToFlags(code)` equals an explicit expectation table. One new enum value without a mapping then fails CI instead of silently not paying.

---

### F12 — TS ↔ DB rate-schedule dual-source (accepted, guarded) — **LOW**

`RATE_SCHEDULE` (embedded, worker-safe) mirrors `eba_rate`/`eba_allowance` (durable). The drift guard is real: `scripts/gen-eba-rate-schedule.mjs` + `rate-schedule-sync.test.ts` assert exact equality (8 tests, green). Residual risk: the DB side isn't applied (F7), and the cl 25.3 floor (≥ Award + 2%) is documented as **not auto-enforced** — keep it a manual checklist item on every new rate row, or add the Award rate as a column and a CHECK.

---

## 3. Verified-correct (no action)

For completeness, the audit *confirmed* the following against the EBA — all regression-tested:

- **Rate precedence** (`grossPay.read.api.ts:239-255`, `standard.ts:185-199`): explicit per-shift `remuneration_rate` override → classification (`LEVEL_N`/`TRAINEE`) resolved against the **effective-dated** schedule with casual/permanent column selection → contract `remuneration_level` when the shift lacks an embed → `hourly_rate_min` only when a rem-level embed has no level number → `defaultRate` last. The historic `hourly_rate_min`-first bug (≈20% casual underpay + CPI bypass) is fixed and covered by `read-adapter.test.ts` (27 tests).
- **Casual loaded-rate semantics**: supplied rates treated as loaded, `/1.25` de-load for the base (`standard.ts:258`); night-shift casual rates (cl 43.2) include loading and are de-stacked correctly; Sat/Sun/PH casual rates inclusive (cl 41).
- **Single interpreter**: payroll (`computeShiftGrossPay`), timesheet estimated pay, and roster cost projections all call `estimateDetailedShiftCost`. Only the Python solver has a (deliberately simplified) local cost — see F6.
- **Annual-leave loading** (cl 44.7): greater-of(ordinary×1.175, as-worked penalties + night) — the safe reading, one-line change if ever re-read (`standard.ts:427-437`).
- **PH inside leave** (cl 44.8 + 56.4): excluded from leave days, paid as `public_holiday` at ordinary rate, roster-aware ("would ordinarily be rostered", incl. weekend PHs), deduped across overlapping requests.
- **Statutory day caps anchored at leave start**: parental 50 working days (cl 51), jury 10 (cl 53), supporting carer 5 (cl 52) — cannot re-open per pay period.
- **Leave excluded from weekly-OT accumulation and rest-gap anchoring** (`aggregatePeriodGrossPay.ts:160,229`).
- **Leave/shift collision rule**: worked (actual/adjusted) shift beats leave; rostered-but-unworked (`scheduled_fallback`) yields to leave — prevents both double-pay and fabricated attendance.
- **Leave rate source**: contract `custom_hourly_rate` override, else classification → effective-dated permanent rate (leave is non-casual, F3 excepted); no resolvable contract ⇒ skip, never guess.
- **Higher duties** (cl 29) resolved via the same effective-dated table, greater-of substantive vs nominated level.
- **CPI machinery** (cl 25.1/25.2): `applyCpiIncrease` is pure, data-only, rounds per-value; `resolveRateSet` is lexicographic and allocation-free; historical shifts re-price at their own dates.

---

## 4. Architecture Improvements

### 4.1 Rate management & CPI versioning (extends Phase 2)
- **Now:** append-only `RATE_SCHEDULE` (TS) mirrored by `eba_rate`/`eba_allowance` (DB), sync-tested. Keep.
- **Target:** DB is the single author; `npm run gen:eba-rates` regenerates the TS embed at build time (invert today's direction: SQL → TS generated file committed, sync test retained as a tripwire).
- **Admin UI** (new, small): a "Rate Versions" page listing `RateSet`s; actions: *New CPI increase* (input: ABS March-quarter Sydney CPI %, effective date, label → server computes via the same `applyCpiIncrease` math and inserts DB rows), *per-classification override* before publishing, *preview impact* (re-price last closed period against the draft set, show Δ per classification — `getPeriodGrossPay` with an injected schedule already supports this since `resolveRateSet` takes a `schedule` param), *publish* (insert rows → regenerate embed on next deploy). Guard: cl 25.3 floor check field (Award rate + 2%) required before publish.
- **Historical reproduction:** already guaranteed by effective-dating; add a snapshot column (`rate_set_label`) onto `gross_pay_records` at pay-run finalisation so an exported run is self-describing even if rates are later corrected.

### 4.2 Remuneration management
- Make `user_contracts.remuneration_level` **mandatory-at-activation** (DB CHECK or activation trigger) — today a shift with no rem-level embed *and* no contract level silently prices at `defaultRate` (32.06 = L1 casual; conservative-high for permanents but still wrong for costing).
- Surface a **provenance flag** in the payroll UI when `defaultRate` was used (the provenance plumbing exists — extend `GrossPayInputProvenance` with `rateSource: 'override'|'classification'|'contract'|'rate_min'|'default'`).
- Retire the `24.1` sentinel in `standard.ts:191` (legacy default-rate marker) once prod data confirms no live 24.1 rates: it silently reroutes a *legitimate* $24.10 override to classification.

### 4.3 Leave management
- Apply F2 fix before deployment; F4 seed/accrual corrections; F5 security factors; F8 anniversary robustness.
- Move accrual from calendar-based to **worked-ordinary-hours-based** (cl 44.3/45.3) fed by approved timesheets — one nightly job, idempotent, replayable.
- Add `leave_requests` audit events into the existing `shift_events`-style envelope (approvals are pay-affecting decisions and currently leave no audit trail).

### 4.4 Auto-scheduler / compliance integration (F1 design)
- **One primitive:** `employee_leave_days` view (approved requests × generate_series). Consumers:
  1. `RosterFetcher` → solver `availability_overrides` (HARD) — no Python change.
  2. V8 rule `leave-conflict` (BLOCKING for auto/bid/swap; WARNING+confirm+audit for direct manager assignment).
  3. Approval-time sweep dialog: conflicting assigned shifts listed → batch unassign via `sm_apply_shift_op`.
  4. No-Show pass exclusion.
  5. Roster grid: leave badge on employee-day cells (read the same view).
- Precedence policy (consistent with the locked solver tiering): **approved leave behaves like `legal_hard`** — it wins over coverage; only an explicit, audited manager override may pierce it, and *emergency assignment must not silently pierce it*.

### 4.5 Award interpretation / payroll consistency
- Keep the single-interpreter invariant; F6 brings the solver's *ranking* model closer without duplicating the interpreter (rates from the schedule, coarse penalties in Python). Document explicitly that solver cost is an ordinal signal, payroll is the cardinal truth.

---

## 5. Implementation Plan

### Phase 1 — Critical correctness & safety (do before applying migrations)
| # | Task | Prio | Complexity | Depends | Touches |
|---|---|---|---|---|---|
| 1.1 | F2: constrain self-insert RLS to `status='pending'`; trigger `AFTER INSERT OR UPDATE` | P0 | S | — | leave migration (amend in place — not yet applied) |
| 1.2 | F4a: seed balances for all non-casual employment types (verify prod enum spellings first) | P0 | S | — | leave migration §7 |
| 1.3 | F7: apply migrations 20260709000000 / 20260709100000 / 20260710120000 via MCP, forward-verify | P0 | S | 1.1, 1.2 | prod DB |
| 1.4 | F3: casual FDV pay — `isFdvLeave` flag, rostered-hours pricing, generic payslip code | P0 | M | — | leaveGrossPay.ts, computeShiftGrossPay.ts, standard.ts, gross-pay.types.ts |
| 1.5 | F11: exhaustive LeaveTypeCode→flags mapping test | P1 | S | — | new test |
| **Tests** | leave-gross-pay: casual FDV rostered/unrostered; RLS: pgTAP or SQL harness insert-approved must fail | | | | |

### Phase 2 — Rate versioning & CPI management
| # | Task | Prio | Complexity | Depends |
|---|---|---|---|---|
| 2.1 | Invert generator direction (DB→TS embed), keep sync test | P1 | M | 1.3 |
| 2.2 | Admin "Rate Versions" page: list / new-CPI / override / preview-impact / publish | P1 | L | 2.1 |
| 2.3 | cl 25.3 floor field + publish guard | P2 | S | 2.2 |
| 2.4 | `rate_set_label` snapshot on `gross_pay_records` finalisation | P2 | S | 1.3 |
| 2.5 | F6: solver rates from `resolveRateSet` + Saturday/OT-tier in `model_builder.py` | P1 | M | — |
| **Tests** | schedule with 2 sets: shift on eve/day of effective date; preview Δ math; solver regression (Sat penalty, L7 vs L1 ranking) | | | |

### Phase 3 — Leave ↔ scheduler integration (F1)
| # | Task | Prio | Complexity | Depends |
|---|---|---|---|---|
| 3.1 | `employee_leave_days` view + RLS | P0 | S | 1.3 |
| 3.2 | RosterFetcher → HARD `availability_overrides` from leave | P0 | M | 3.1 |
| 3.3 | V8 `leave-conflict` rule + orchestrator registration (bid/swap/bulk inherit) | P0 | M | 3.1 |
| 3.4 | Approval-time conflict sweep (list + batch unassign + notify) | P1 | M | 3.1 |
| 3.5 | No-Show pass excludes leave days | P1 | S | 3.1 |
| 3.6 | Accrual: security factors (F5), flex-PT hours-worked basis (F4b), unpaid-leave pause (F10), FDV anniversary robustness (F8) | P1 | M | 1.3 |
| **Tests** | solver: employee on leave never proposed; V8: bid/swap/manual each blocked/warned; approve-after-assign sweep; no-show suppression | | | |

### Phase 4 — Frontend & admin UX
| # | Task | Prio | Complexity |
|---|---|---|---|
| 4.1 | Roster grid leave badges + assignment-dialog warning | P1 | M |
| 4.2 | Payroll provenance: `rateSource` chip; default-rate usage alert | P2 | S |
| 4.3 | Leave: compassionate cap (F9), edit-approved-request flow (cancel+recreate wrapper), half-pay/cash-out request stubs (F10) | P2 | M-L |
| 4.4 | Leave audit events surfaced in the existing audit timeline | P2 | S |

### Phase 5 — Regression & validation
Run the full suite (below) + `tsc` + build; re-price one closed prod period before/after each phase and diff `getPeriodGrossPay` output (should be byte-identical except intended changes); EXPLAIN-check the new view under RLS.

---

## 6. Regression Test Suite (scenario catalogue)

**Rate resolution**
1. Casual L3, no override → Schedule 2 casual column ($34.04), ordinary = /1.25.
2. Permanent L3 → $27.23; explicit `remuneration_rate` beats classification; `custom_hourly_rate` beats classification on leave days.
3. No rem-level embed but active contract level → contract fallback used.
4. Nothing resolvable → `defaultRate` + provenance flag (never silent).
5. Rate = exactly 24.10 with classification present → document current sentinel behaviour (and the intended post-cleanup behaviour).

**Remuneration inheritance** — contract→shift→timesheet→payroll produce one identical rate for the same person/date across `GrossPayPage`, timesheet estimate, and roster projection.

**CPI / effective dates**
6. Two-set schedule: 30 Jun shift at old rate, 1 Jul at new; leave day spanning the boundary uses each day's own set.
7. `applyCpiIncrease` rounding: every value r2; re-run historical period after adding a future set → unchanged output.
8. Sync test: DB seed == RATE_SCHEDULE[0] (exists — keep mandatory).

**Leave approval workflow**
9. Insert `approved` directly → RLS reject. 10. Approve pending → balance −h, used +h; revoke → restored. 11. Approve own request → reject. 12. Insufficient balance → create rejected. 13. Carer draws personal balance. 14. Cancel pending by self OK; cancel approved by self rejected.

**Scheduler × leave**
15. Solver window overlapping approved leave → employee excluded those days, assignable outside range. 16. Manual assign on leave day → V8 warning + audit on override. 17. Bid placed during leave window → blocked. 18. Swap into leave window → blocked for the incoming side only. 19. Leave approved after assignment → sweep lists exactly the overlapping shifts; unassign batch succeeds; no No-Show generated. 20. Emergency assign on leave day → blocked (policy) with explicit override path only.

**Payroll × leave**
21. FT annual week incl. one PH → 4 annual-leave days (greater-of loading) + 1 `public_holiday` day, zero balance hit for the PH. 22. Roster-aware: 7-day-roster member takes leave over a rostered Saturday → leave follows roster days/hours. 23. Casual FDV with 2 rostered days in range → paid those hours at loaded rate, payslip code non-identifying; casual annual → $0. 24. Parental 12-month range across 3 pay periods → exactly 50 paid days total, all in the earliest periods. 25. Leave day + worked shift same date → worked wins; + rostered-unworked shift → leave wins. 26. Overlapping requests spanning one PH → PH paid once.

**Historical payroll after CPI**
27. Close period P at set A; add set B (effective inside P+1); recompute P → identical; compute P+1 → new rates; export snapshot labels match.

**Accrual**
28. FT 38h → 152/76h per year ±rounding over 365 daily runs; missed-cron catch-up (3-day gap) accrues 3 days. 29. Flex-PT accrues on worked hours, not 38h. 30. FT security accrues 210/84. 31. Unpaid-leave window pauses accrual. 32. FDV resets on anniversary even when cron skipped the exact day; Feb-29 anniversary.

---

## 7. Cross-system consistency verdict

`Contract → remuneration level → roster → assignment → attendance → leave → timesheet → payroll → export`:
consistent from **contract through payroll through export** (single interpreter, one billable-minutes rule shared with the timesheet reader, exports derive from `PeriodGrossPay`). The two breaks are **assignment/attendance ↔ leave** (F1 — no flow at all) and the **solver's cost mirror** (F6 — stale hardcoded rates). Everything else that was inconsistent in earlier audits (casual rate sourcing, CPI bypass, night-allowance stacking, security engine) is fixed and test-locked.
