# Chapter 5 — Business Rules Catalog (Phase 5)

**Confidence:** every rule below was already verified in an earlier chapter (cited in the **Source** column) — this chapter's job is consolidation and ID assignment, not new research. Where a chapter's confidence tag was Strongly/Weakly Inferred rather than Verified, that's preserved in the **Conf.** column rather than upgraded.

## ID scheme

| Prefix | Domain | Note |
|---|---|---|
| `SCH-` | Scheduling / shift lifecycle | The FSM gateway and its guards (Ch. 7 §1) |
| `ATT-` | Attendance & timesheets | Clock-in/out, review gate, breaks (Ch. 7 §2, Ch. 6 §8-10) |
| `MKT-` | Marketplace (bids, swaps, drops) | Ch. 7 §3, Ch. 6 §6-7 |
| `LEAVE-` | Leave | Ch. 7 §4, Ch. 6 §11 |
| `PAY-` | Payroll (gross pay) | Ch. 6 §12 |
| `COM-` | Compliance engine | Uses the system's own native `V8_*` rule IDs rather than inventing a parallel numbering — those constants **are** the implementation-level business rule IDs already in production use (rule_id column in `compliance_rejections`, shown in the UI). See Ch. 12 for the full table; not repeated here beyond an index. |
| `VIS-` | Visibility / access control (RBAC) | Ch. 8 |
| `ONB-` | Onboarding & offboarding | Ch. 6 §2 |

Each entry: **Trigger** (what invokes it) → **Condition** (the actual check) → **Failure behaviour** (what happens if the condition fails). Full Business-Reason/Exceptions/Examples prose is given only for rules complex or consequential enough to warrant it ("spotlight" rules) — the rest are deliberately compact table rows, since re-deriving all 14 template fields for ~60 rules already documented in full elsewhere would be pure duplication, not new information. Every row's **Source** column is the authoritative implementation-location reference.

---

## SCH — Scheduling / Shift Lifecycle

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| SCH-0001 | New shift starts Draft-unassigned | Shift row created | `lifecycle_status='Draft'`, no assignee | n/a (initial state) | Verified | Ch.7 §1.1 |
| SCH-0002 | Publish blocked inside 4h of start (unassigned) | `publish` op, shift unassigned | TTS ≥ 4h | Rejected: `PUBLISH_TOO_LATE` | Verified | Ch.7 §1.2 |
| SCH-0003 | Emergency-window direct confirm | `publish` op, shift assigned, TTS<4h | — | Skips the offer step, jumps straight to Confirmed, stamps `emergency_assigned_at/_by` | Verified | Ch.7 §1.2 |
| SCH-0004 | Unpublish has no time lock | `unpublish` op | Shift in S3/S4/S5/S9/S10 | Cancels any in-flight swap + reverts counter-shift; **no TTS guard**, unlike publish | Verified | Ch.7 §1.2 |
| SCH-0005 | Assign re-validates overlap at commit | `assign` op | `check_shift_overlap()` re-run server-side, not just at search time | Rejected: `CANDIDATE_OVERLAP` | Verified | Ch.7 §1.2 |
| SCH-0006 | Unassign is Draft-only | `unassign` op | Shift must be S2 | Illegal from any Published state — must `unpublish` first | Verified | Ch.7 §1.2 |
| SCH-0007 | Winner selection is atomic and exclusive | `select_winner` op | Shift S5/S6 | Winning bid → accepted, all other pending bids on that shift → rejected in the same transaction, shift jumps directly to Confirmed | Verified | Ch.7 §1.2 |
| SCH-0008 | Every gateway write is version-CAS'd | Any `sm_apply_shift_op` call | `p_expected_version` must match current row version | Silent no-match (0 rows updated) surfaced by the caller as a stale-data conflict | Verified | Ch.2 §4 |
| SCH-0009 | Idempotency-key replay protection | Any `sm_apply_shift_op` call with a repeat key | — | Returns the cached prior result instead of re-applying | Verified | Ch.2 §4 |
| SCH-0010 | Automatic offer expiry | Cron sweep, per-minute | Offer `Pending` past `offer_expires_at` or TTS<4h | Offer → Expired, shift reverts to Draft-assigned | Verified | Ch.7 §1.3 |
| SCH-0011 | Automatic bidding timeout | Cron sweep | Shift open-for-bidding, TTS<4h, no winner | Shift reverts directly to Draft-unassigned (no intermediate state) | Verified | Ch.7 §1.3 |
| SCH-0012 | Automatic shift auto-start | Cron sweep | Confirmed shift's scheduled start has passed | Lifecycle → InProgress | Verified | Ch.7 §1.3 |
| SCH-0013 | Automatic shift auto-complete | Cron sweep | InProgress shift's scheduled end has passed, employee not currently clocked in | Lifecycle → Completed | Verified | Ch.7 §1.3 |
| SCH-0014 | Locked (past) shifts cannot be modified | Any shift UPDATE | Shift's scheduled start is already in the past | Hard Postgres exception (`fn_prevent_locked_shift_modification`) | Verified (found via live-DB test during the `approve_trade` fix) | Ch.7 top callout |
| SCH-0015 | Roster structure is fixed at exactly 3 groups | Roster creation | — | `enforce_exactly_three_groups` trigger blocks any other count | Strongly Inferred | Ch.1 §4.6 |
| SCH-0016 | Canonical FSM state IDs are never renumbered | Any state retirement (e.g. S6/S7/S8) | — | Retired states become permanent "tombstones" in the legality matrix rather than being reassigned | Verified | Ch.7 §1.1 |

**Spotlight — SCH-0007 / the `select_winner` and `approve_trade` "direct-to-confirmed" design**: both bidding-winner-selection and swap-approval intentionally skip any intermediate "won, not yet confirmed" state and land directly on Confirmed (S4) in one atomic write. This is a deliberate simplification (fewer states to reason about, no window where a "won" shift could be double-claimed) rather than an oversight — but it means a UI or integration expecting a distinct "pending confirmation after winning" state will not find one.

---

## ATT — Attendance & Timesheets

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| ATT-0001 | Clock-in requires geofence + time window | `check_in_shift` | Inside `[start-1h, start+12.5h]`, inside an allowed-location geofence | Rejected | Verified | Ch.7 §2.5 |
| ATT-0002 | Clock-in grace period | `check_in_shift` | Within 5 min of scheduled start → `checked_in`; after → `late` | n/a (classification, not a rejection) | Verified | Ch.7 §2.5 |
| ATT-0003 | Clock-out requires a prior clock-in | `sm_clock_out_shift` | `attendance_status IN (checked_in, late)`, `actual_end IS NULL` | Rejected | Verified | Ch.7 §2.5 |
| ATT-0004 | Auto clock-out at 12.5h | Cron (2 redundant implementations) | `now() >= GREATEST(actual_start, scheduled_start) + 12.5h`, no manual clock-out | `attendance_status='auto_clock_out'`; `actual_end` deliberately left NULL, not fabricated | Verified | Ch.7 §2.5 |
| ATT-0005 | Auto no-show marking | Cron sweep | Shift ended, employee never clocked in | `attendance_status='no_show'` | Verified | Ch.7 §2.3/§2.5 |
| ATT-0006 | Timesheet review gate | Any approve/reject/billable-time write | Shift must be attendance-terminal (no-show, auto-clocked-out, has a real `actual_end`, or unclocked past scheduled-end+12.5h) | Hard DB exception, not just a disabled button | Verified | Ch.7 §2.2 |
| ATT-0007 | Timesheet row materializes lazily | First manager edit/approve/reject/no-show mark for a shift | No prior timesheet row exists | Row is created at that moment, not on clock-in/out | Verified | Ch.7 §2.5 |
| ATT-0008 | AutoPilot auto-approves only "clean punches" | AutoPilot decide (if enabled) | Both actual start/end within ±7.5 min of scheduled, no manual edit already present, inside the 18:00–06:00 Sydney processing window | Anything outside tolerance → routed to manual review, never auto-rejected | Verified | Ch.7 §2.3 |
| ATT-0009 | Editing a finalized timesheet reopens it | Manager edits an approved/rejected/no_show entry's metrics | — | Status reverts to `submitted`, re-entering the approval gate (ATT-0006) | Verified | Ch.7 §2.4 |
| ATT-0010 | `payroll_exported` is a terminal lock | Any timesheet write attempt | `shifts.payroll_exported = true` | **All** edits blocked, including notes-only — "already paid out" | Verified (currently unreachable — see PAY-0005) | Ch.6 §12, Ch.7 §2.6 |
| ATT-0011 | Break time has no live tracking | — | — | `paid_break_minutes`/`unpaid_break_minutes` are manager-entered numbers only; no employee break-clock exists | Verified | Ch.6 §9 |
| ATT-0012 | Optimistic concurrency on every timesheet write | Any timesheet UPDATE | `version` column bumped unconditionally by trigger | Client CAS mismatch → "Changed by someone else," refresh | Verified | Ch.7 §2.4 |
| ATT-0013 | Approval cannot be self-granted-adjacent | Approve/reject action | — | *(No self-check found for timesheets — contrast with LEAVE-0003, which does have one. Documented as an asymmetry, not a confirmed rule.)* | Weakly Inferred | Ch.7 §4.6 (leave asymmetry note) |

**Spotlight — ATT-0004, the auto-clock-out anchor**: implemented independently in at least two places (a 5-minute cron and a broader safety-net sweep) and mirrored client-side for display — all three must stay in lockstep on the exact formula `GREATEST(clock-in, scheduled start) + 12.5h`. A prior version of this logic fabricated `actual_end` at the scheduled end time (defeating the whole point of the rule by making an incomplete shift look like a normal on-time departure); it was removed and a backfill migration retroactively corrected historical fabrications. This history is why `ATT-0006`'s reviewability check has to test `attendance_status IN ('no_show','auto_clock_out')` as a separate disjunct rather than relying on `actual_end IS NOT NULL` alone.

---

## MKT — Marketplace (Bids, Swaps, Drops)

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| MKT-0001 | Bidding requires an open shift | Bid submission | Shift is S5/S6 | Rejected at the RLS/state level | Verified | Ch.7 §3.4 |
| MKT-0002 | Bid withdrawal window | `withdraw_bid_rpc` | Caller owns the bid, still `pending`, shift not started | Rejected otherwise | Verified | Ch.7 §3.4 |
| MKT-0003 | Swap request preconditions | `sm_create_swap_request` | Caller is the shift's current assignee, TTS≥4h, at most one active swap per shift | Rejected | Verified | Ch.7 §3.4 |
| MKT-0004 | Swap acceptance requires a feasible compliance snapshot | `sm_accept_trade` | Chosen offer is `SUBMITTED`, compliance re-check `feasible=true` | Rejected: `COMPLIANCE_REQUIRED` | Verified | Ch.7 §3.4 |
| MKT-0005 | Manager swap approval | `approve_trade` gateway op | Swap is `MANAGER_PENDING`, `compliance_ok:true` in payload | **Was completely broken (`UNSUPPORTED_OP`) until fixed 2026-07-31** — see Ch.7's top callout | Verified, fixed & live-DB-tested | Ch.7 top callout |
| MKT-0006 | Giveaway = one-way reassignment | `swap_type='giveaway'` | — | `sm_approve_peer_swap` skips the counter-shift UPDATE branch entirely — the mechanism behind an employee "dropping" a shift onto a willing peer | Verified | Ch.6 §7 |
| MKT-0007 | Uniform 4-hour marketplace time lock | Bidding, direct offers, and swaps alike | TTS<4h | New actions blocked; existing pending items expire | Verified | Ch.7 §3.6 |
| MKT-0008 | AutoPilot compliance check is a fixed, narrower subset | Swap/Bid AutoPilot decide | overlap + 48h weekly cap + 11h rest + qualification only | Daily-hours, 20-in-28, streak, spread-of-hours, split-shift, meal-break, min-engagement, multi-hire, student-visa, leave-conflict are **not** checked on this path | Verified, documented gap | Ch.12 §1.2 |
| MKT-0009 | Bid AutoPilot fairness ordering | Bid AutoPilot decide | F3 fairness-debt-first FIFO among eligible bidders | First eligible bidder in that order wins, not first-to-bid | Verified | Ch.7 §3.5 |
| MKT-0010 | Losing bids are never cleaned up on timeout | Bidding-timeout sweep | Shift reverts to Draft with no winner | `shift_bids` rows left `pending` forever (asymmetry with swaps, where the equivalent gap was fixed) | Verified, open bug | Ch.7 §1.6 |

---

## LEAVE — Leave Requests

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| LEAVE-0001 | No overlapping active leave requests | Any leave submission | DB EXCLUDE constraint on `pending`/`approved` rows per employee | Postgres `23P01`, mapped to a friendly UX message | Verified | Ch.7 §4.2 |
| LEAVE-0002 | Approval deducts balance atomically | Manager approves | Same trigger fires the audit event and employee notification | — | Verified | Ch.7 §4.2 |
| LEAVE-0003 | Self-approval blocked | Manager approves | `req.employee_id !== approverId` required | Rejected (TOCTOU-safe CAS on `status='pending'`) | Verified | Ch.7 §4.2 |
| LEAVE-0004 | Approving leave never auto-unassigns shifts | Leave approval | Shift already assigned inside the leave window | Stays assigned until a manager explicitly clicks "Unassign N shifts" — a separate, deliberate action | Verified (corrects earlier assumption) | Ch.7 §4.3 |
| LEAVE-0005 | Casuals excluded from balance-tracked leave | Nightly accrual | `employment_type` contains "casual"/"contractual" | No `leave_balances` seed row except FDV, consistent with the 25%-loading-is-full-recompense EBA clause | Verified | Ch.7 §4.4 |
| LEAVE-0006 | Flexible PT accrual uses trailing worked-hours average | Nightly accrual, Flexi-PT employees | 12-week (84-day) average of actually-worked hours, falling back to contracted hours if no history | — | Verified | Ch.7 §4.4 |
| LEAVE-0007 | Full-Time Security gets richer leave caps | Nightly accrual, FT Security role | 210h annual / 84h personal, vs. 152h/76h general | — | Verified | Ch.7 §4.4 |
| LEAVE-0008 | Cross-reference: scheduling hard-blocks on approved leave | Any assignment attempt (manual, auto, swap) | See `V8_LEAVE_CONFLICT` | See Ch.12's COM index | Verified | Ch.7 §4.5, Ch.12 |

---

## PAY — Payroll (Gross Pay)

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| PAY-0001 | Gross-only scope | Every calculation | — | Explicitly excludes tax/super/STP by design; UI carries a persistent disclaimer | Verified | Ch.6 §12 |
| PAY-0002 | Default view is approved-only | Gross Pay page load | `timesheets.status ∈ {approved, locked, no_show}` | Anything else (draft/submitted/no timesheet row) is **silently excluded** from totals, not shown as $0 | Verified | Ch.6 §12 |
| PAY-0003 | Rates resolve from an embedded code array, not the DB | Any pay calculation | `resolveRateSet(shift_date)` against an in-code TS array | Updating `eba_rate`/`eba_allowance` DB rows alone does **not** change what anyone is priced at — DB is a mirror kept honest by a drift-guard test, not the live source | Verified, real gotcha | Ch.6 §12 |
| PAY-0004 | Effective-dated rates survive CPI increases | Rate resolution | Latest `effectiveFrom ≤ shift date` wins | Historical pay estimates aren't corrupted by a later award variation | Verified | Ch.6 §12, project memory |
| PAY-0005 | Pay-period locking & export are unwired | Manager opens Gross Pay page | — | Entire calculation is on-demand, read-only, client-side; `pay_periods`/`gross_pay_records`/CSV-export have zero callers anywhere in the app | Verified, significant gap | Ch.6 §12 |
| PAY-0006 | Terminated-employee pricing asymmetry | Final pay period for a terminated employee | Worked-shift adapter filters contracts to `Active` only; leave adapter has no such filter | Apprentice/trainee/SWS pricing context silently lost for a terminated employee's final worked shifts, but preserved for their leave in the same period | Verified, open gap | Ch.6 §12 |

---

## COM — Compliance Engine (index only — see Ch. 12 for the full table)

The compliance engine's 21 rule IDs (`V8_LEAVE_CONFLICT`, `V8_NO_OVERLAP`, `V8_MIN_ENGAGEMENT`, `V8_QUALIFICATIONS`, `V8_QUALIFICATION_EXPIRED`, `V8_MEAL_BREAK`, `V8_MEAL_BREAK_CEILING`, `V8_REST_PAUSE`, `V8_MAX_DAILY_HOURS`, `V8_SPREAD_OF_HOURS`, `V8_SPLIT_SHIFT`, `V8_MULTI_HIRE_ELIGIBILITY`, `V8_MAX_DAILY_ENGAGEMENTS`, `V8_MIN_REST_GAP`, `V8_20_IN_28`, `V8_STREAK_LIMIT`, `V8_STUDENT_VISA_LIMIT`, `V8_ORD_HOURS_AVG`, `V8_ORD_HOURS_PEAK`, `V8_ORD_HOURS_CONTRACTED`, `V8_AVAILABILITY_CONFLICT`) are business rules in every sense this catalog cares about — each already has a Name, Trigger, Condition/Threshold, Severity (= Failure Behaviour), Award citation (= Business Reason), and Implementation Location documented in full in **Ch. 12 §2**. Reproducing that table here would be pure duplication; treat Ch. 12 as this catalog's COM- section.

---

## VIS — Visibility / Access Control

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| VIS-0001 | Certificate model is canonical; legacy role is display-only | Any access decision | `app_access_certificates` (alpha-zeta) is authoritative | Legacy `Role` string only still gates in one module (Broadcasts) — see VIS-0006 | Verified | Ch.8 §1 |
| VIS-0002 | Route-level gate | Every protected route | `FeatureGate` → `useAuth().hasPermission(feature)` | Redirect to `/unauthorized` | Verified | Ch.8 §2 |
| VIS-0003 | Manager scope is certificate-bounded | Any manager action | Cert carries an explicit org/dept/sub-dept scope | A gamma manager cannot act cross-department by construction of their own cert's scope field, not a separate runtime check | Strongly Inferred | Ch.8 §6 |
| VIS-0004 | `is_manager_or_above()` gates manager-tier RLS | Many RLS policies | Cert `gamma/delta/epsilon/zeta` or legacy admin/manager | **Historically broken, fixed, but several docs still incorrectly say it's broken** — see the OPEN doc-correction finding | Verified | Ch.8 §4 |
| VIS-0005 | Payroll/compliance-snapshot read is self-or-manager | RLS SELECT on `shift_payroll_records`/`shift_compliance_snapshots` | Was a no-op correlated-subquery bug — **fixed 2026-07-30** | Any employee could previously read anyone's payroll/compliance data | Verified, fixed & prod-applied | Ch.8 §5 |
| VIS-0006 | Broadcasts gates on legacy role, not certificate | Broadcast manage actions | `user.role IN ('admin','manager')` (legacy string) OR per-group role | The one module that doesn't cleanly map onto the gamma/delta/epsilon ladder | Verified | Ch.8 §1 |
| VIS-0007 | `profiles` is a deliberate directory-style broad read | Any authenticated read of `profiles` | `USING(true)` | Any authenticated user can read any other employee's name/email/phone/DOB/emergency contact — intentional, not a bug | Verified | Ch.8 §6 |
| VIS-0008 | Compliance rejections require delta+ | RLS SELECT on `compliance_rejections` | `access_level IN (delta, epsilon, zeta)` — excludes gamma, unlike almost every other manager-gated table | Sub-delta users see an empty table (client route has no matching gate, so they can navigate there but see nothing) | Verified, inconsistency flagged | Ch.8 §5/§6 |

---

## ONB — Onboarding & Offboarding

| ID | Name | Trigger | Condition | Failure behaviour | Conf. | Source |
|---|---|---|---|---|---|---|
| ONB-0001 | Self-signup is the only entry point | New user | `supabase.auth.signUp` + `handle_new_user()` trigger | No admin "invite" flow exists at all | Verified | Ch.6 §2 |
| ONB-0002 | Contract alone grants default access | Admin inserts `hr.user_contracts` row | — | Employee is unblocked from `/pending-access` with a client-side `alpha` fallback, **not** an explicit certificate grant | Verified | Ch.6 §2 |
| ONB-0003 | Certificate grant is a separate, optional admin action | Admin inserts `app_access_certificates` row | Gated by `auth_can_manage_certificates()` (server) + Epsilon/Zeta-only (client, stricter) | Elevated access requires this explicit second step | Verified | Ch.6 §2 |
| ONB-0004 | No offboarding workflow exists | Employee termination | Schema supports `Terminated` status + `termination_date`, but no UI ever sets either | Only hard-delete (full account wipe) is available | Verified, significant gap | Ch.6 §2 |
| ONB-0005 | No onboarding notifications fire | Every step of ONB-0001–0003 | — | No `notification_type` value exists for account-created/contract-assigned/access-granted; employee's only signal is `/pending-access` disappearing | Verified | Ch.6 §2 |

---

## Cross-domain notes

- **The two live production bugs found while building this rulebook** (VIS-0005, MKT-0005) share a root-cause shape — both were correct pre-squash and silently dropped at the October 2025 baseline consolidation, never re-verified against the archive. See Ch. 7 §5 for the pattern; worth a dedicated audit pass across any other function whose current behavior can be diffed against `migrations_archive_pre_baseline_20260702/`.
- **Rules with a documented, deliberate scope exclusion are common** — casuals are excluded from ordinary-hours averaging (COM), from balance-tracked leave except FDV (LEAVE-0005), and are the *only* group `V8_MAX_DAILY_ENGAGEMENTS` applies to; Flexi-PT is the *only* group `V8_STREAK_LIMIT` applies to. A new engineer should not assume any single compliance/leave/payroll rule applies uniformly across all employment types without checking its scope column first.
- **"Built but unwired" is a recurring pattern across domains**, not a one-off: PAY-0005 (payroll persistence), the dormant compliance orchestrator subsystems (Ch.12 §1.2), and the AutoPilot machinery still fully installed after being product-level "removed" (ATT-0008's neighbor finding in Ch.7 §2.3) are three independent instances of fully-built, tested code with no live caller. Worth a dedicated Phase 17 (Production Audit) pass specifically hunting for more of this pattern.
