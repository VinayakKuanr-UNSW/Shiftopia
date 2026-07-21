# Reserve List — Codebase Audit & Implementation Plan

**Status:** Discovery only. No product code has been changed. This document is the deliverable requested before any implementation begins.
**Date:** 2026-07-21
**Scope:** Manager-only emergency staffing workflow that replaces marketplace actions (Drop/Swap/Bid) with a "Phone" action on shifts inside the TTS < 4h emergency window.

Findings below come from two sources, cross-checked against each other: (1) static reads of the frontend/migration source in this repo, and (2) live introspection of the production Supabase project (`Shiftopia`, `srfozdlphoempdattvtx`) — actual table schemas, RLS policies, and `pg_get_functiondef()` output for every relevant function. Where the two disagreed, the live DB wins, and the discrepancy is called out because it usually means "the code that reads this differently is stale."

---

## 1. Executive summary

The good news: this codebase already has almost every primitive Reserve List needs, and they're better than what a first pass would invent from scratch.

- **Version locking + row locking + FSM guard + audit trail already exist as one atomic RPC**: `sm_apply_shift_op(shift_id, expected_version, op, payload, idempotency_key)`. It takes `SELECT ... FOR UPDATE` on the shift row, so two managers cannot even race — the second transaction blocks until the first commits, then fails its version check deterministically. Reserve List's "Assignment rejected, refresh and search again" requirement falls out of this for free, **provided Reserve List routes its write through this function** (see §13 for the one gap that isn't free).
- **`'assign'` is already a legal FSM transition from the unassigned-draft state** (`S1`). No new FSM state is required.
- **A comprehensive, currently-live compliance engine already exists**: the TS `V8Engine` (14 rules — qualification expiry, leave conflict, no-overlap, student-visa, rest-gap, daily/weekly hour caps, etc.), exposed through one reusable call: `complianceService.validateShiftCompliance(...)`. This is what real shift assignment already runs before writing. Reserve List should call the same function, not build a second engine.
- **A composable "who is eligible" service already exists** (`EligibilityService.getEligibleEmployees()`), covering org/department/role/skill/license/contract scoping. It's ~70% of what Reserve List's live search needs; the rest (availability, overlap, leave, active/terminated status) is each individually a small, already-written, reusable function — just never composed together into one call.
- **The opt-in toggle has an obvious, zero-migration home**: `profiles.preferences` is a `jsonb` column that already defaults to `{"notifications": {"push": true, "email": true}}`. A `reserve_list.opt_in` key fits the existing convention exactly.
- **The one real gap, and it's a pre-existing one, not something Reserve List introduces**: the *current* manual "emergency assign a shift inside the 4h window" code path (`shiftsCommands.publishShift()` / `bulkPublishShifts()` in `shifts.commands.ts`) does **not** go through `sm_apply_shift_op`. It does a raw `supabase.from('shifts').update(...)` with no version check, no row lock, no FSM legality check, and no server-side re-validation of the employee's overlap/eligibility at write time. That is exactly the race condition the "Multi-Manager Protection" section of the brief is worried about, and today it is **not** protected. Reserve List must not copy this pattern; it should instead be the occasion to route this transition through the hardened gateway (§12, §20).

Everything else in this document is the supporting evidence and the resulting recommendations.

---

## 2. Current marketplace flow & TTS gating (existing architecture)

**TTS/urgency computation** — `src/modules/rosters/domain/bidding-urgency.ts`
- `EMERGENT_WINDOW_MS = 4h` (`computeShiftUrgency()` → `'normal' | 'urgent' | 'emergent'`; ≤4h = `'emergent'`, ≤24h = `'urgent'`).
- Resolves shift start via `parseZonedDateTime(shiftDate, startTime, SYDNEY_TZ)`, not raw `Date` parsing — timezone-safe by design (consistent with the project's Sydney-time conventions).
- `isOnBidding(biddingStatus)` — any status other than `not_on_bidding`/`bidding_closed_no_winner`.

**Employee-facing gating** — `src/modules/rosters/domain/shift-locking.utils.ts` → `isShiftLocked(shift, context)`
- Context `'my_roster'` (employee): locked when TTS < 4h.
- Context `'roster_management'` (manager): locked only once the shift has actually started — managers are **not** blocked by the 4h window today, which is why "manager manually edits" already works inside the emergent window.
- Consumed in `ShiftDetailsDialog.tsx` (employee "My Roster" view) — Swap/Drop buttons (lines ~260–291) render only when `!isLockedFromActions`, with a visible "Emergent State: Lockout Active (<4h)" badge otherwise.

**Card-level marketplace indicator** (the part of the spec's "Shift Card") — a Gavel icon signals bidding-open state (`S5`), rendered in `SmartShiftCard.tsx`, `ShiftCardCompact.tsx`, and documented in `ShiftCardLegend.tsx`. There is no separate "Bid" button on the compact card — bidding participation happens inside a detail view; the card itself just shows status. **This Gavel icon is the "Marketplace action" the spec says the Phone icon should replace** when the shift is unassigned and emergent.

**Server-side enforcement of the 4h boundary** (two mechanisms found — reconcile before building on either):
1. Edge Function `supabase/functions/shift-state-processor/index.ts` — `FOUR_H_MS` constant; auto-reverts `S3→S2` (offer expiry) and `S5→S1` (bidding expiry) once TTS ≤ 4h.
2. DB function `process_shift_timers()` (`SECURITY DEFINER`, confirmed live) — same job description at the SQL level.
   *Open question flagged in §23: confirm whether the Edge Function calls this DB function, or whether these are two independent implementations of the same rule (a drift risk either way).*

**What currently happens for a manager on an emergent shift today** (this is the workflow Reserve List is meant to formalize):
- **Unassigned + TTS<4h**: `publishShift()` (`shifts.commands.ts:565-569`) **throws**, telling the manager: *"This shift starts within 4 hours... Assign an employee to emergency-publish it instead."* This is literally the seam Reserve List plugs into — replace this dead end with the Reserve List entry point.
- **Assigned + TTS<4h** (manager assigned someone, now needs to publish): `publishShift()` (`shifts.commands.ts:575-598`) and `bulkPublishShifts()` (`:784-803`) both bypass the normal offer flow (`S3`) and jump straight to Confirmed (`S4`) via a **direct client-side `supabase.from('shifts').update(...)`**, stamping `emergency_assigned_at` so a DB trigger (`fn_capture_shift_event`) emits an `EMERGENCY_ASSIGNED` audit event and the existing "Emergency Assigned" KPI picks it up. **This direct-update path has none of `sm_apply_shift_op`'s protections** (see §12 for why this matters).

**Manager manual edit path today** — `DrillDownPanel.tsx` icon row (Edit2/Undo2/Send/Trash2/History/Lock; `title`-attribute tooltips; `h-8 w-8 rounded-lg hover:bg-white/10` icon-button convention — this is the pattern the new Phone icon should visually match) → `openShiftForm()` → `ShiftWizardModal` → `useShiftFormOrchestrator` → `shiftsCommands.updateShift()` → `sm_apply_shift_op(..., 'edit', { assigned_employee_id, ... })`. This *is* routed through the hardened gateway — it's specifically the emergency-publish shortcut that isn't.

---

## 3. Compliance engine — what's real, what's a stale parallel path

There are **three** compliance-shaped things in this codebase. Only one of them is what live assignment actually uses.

**① The real one — TS `V8Engine`** (`src/modules/compliance/v8/engine.ts`), reached through:
```
complianceService.validateShiftCompliance(employeeId, shiftDate, startTime, endTime, netMinutes, excludeShiftId?)
```
— `src/modules/rosters/services/compliance.service.ts:140-162`, which calls the Supabase Edge Function `evaluate-compliance` (service-role, server-side).
14 rules run in order, including **BLOCKING**: `leave-conflict`, `no-overlap`, `qualification` (expiry-aware), `student-visa` (48h/fortnight — this *is* the visa-restriction check the spec asks for); plus `min-engagement`, `meal-break`, `daily-hours`, `spread-of-hours`, `split-shift`, `max-daily-engagements`, `rest-gap`, `max-workday-limits`, `ordinary-hours-avg`, and an advisory `availability-match`. Returns `{ status: 'passed'|'violated'|'warned'|'unavailable', violations[], warnings[], weeklyHours, ... }`, and `'unavailable'` is treated as **not** valid (fail-safe, never a silent pass). This is exactly the "Run Compliance → pass/fail + reasons" primitive the spec calls for, and it's what `shiftsCommands.updateShift()` already runs before any real assignment write. **Reserve List's "Run Compliance" step should call this function, unmodified, once per candidate.**

**② A DB-level structural check — `check_shift_compliance(p_roster_shift_id, p_employee_id)`** (`SECURITY DEFINER`, live, confirmed via `pg_get_functiondef`). Checks role match (via a `user_contracts` table — confirmed to exist in `public`, so this function is *not* broken, just narrow), missing/expired licenses (`shift_licenses`/`employee_licenses`), missing/expired skills (`shift_skills`/`employee_skills`). It does **not** check overlap, leave, fatigue, EBA/hour caps, or visa status. It writes into `shift_compliance_snapshots` (646 rows — 1:1 with `shifts`, kept in sync by trigger `_sync_compliance_snapshot`). This looks like an older or parallel initiative for a "compliance badge on the shift row" feature, independent of the live assignment path.

**③ A stale/shallow candidate-eligibility RPC — `get_eligible_employees_for_shift(p_shift_id)`**. Its own source comment admits it: `has_required_skills` is **hardcoded `true`** ("Check 'employee_skills' table if needed later"), and `has_availability` is actually just `NOT check_shift_overlap(...)` — it doesn't consult `availability_slots` at all despite the name. This function should **not** be treated as an eligibility primitive to build on.

**Recommendation:** Reserve List's compliance step is ①, full stop. Do not call ② or ③ for eligibility/compliance purposes — ② can optionally still be consulted for the license/skill "badge" data already on `shift_compliance_snapshots` if the UI wants a quick pre-computed hint, but the authoritative pass/fail must come from `complianceService.validateShiftCompliance()`.

---

## 4. Existing employee eligibility/filtering logic — inventory

Per-subsystem inventory (full detail gathered via codebase search, cross-referenced against the compliance findings above):

| Filter | Owning code | Composable today? |
|---|---|---|
| Org/dept/sub-dept/role/skill(Active)/license(Active, not expired) scoping | `EligibilityService.getEligibleEmployees()` — `src/modules/rosters/services/eligibility.service.ts:71` | **Yes** — already a standalone async service, already reused by `shifts.queries.ts` and `autoschedule.api.ts` |
| Declared availability vs. unset-availability policy ("no availability on file ⇒ NOT available") | `evaluateShiftAvailabilityFromSlots()` — `src/modules/rosters/domain/availability-check.ts:105` (pure fn) + `getResolvedAvailabilities()` — `src/modules/rosters/api/availability.api.ts:85` (queries `availability_slots`+`availability_rules`) | **Yes** — two complementary, already-composable layers |
| No overlapping shifts | Two implementations: DB `check_shift_overlap(employee_id, shift_date, start_time, end_time, exclude_shift_id)` (confirmed live, checks `shifts.assigned_employee_id` + `lifecycle_status <> 'Cancelled'` via `OVERLAPS`), **and** V8's `noOverlapRule` (TS, same job) | Yes, but **duplicated** — pick one (recommend the V8 rule, since it's already part of the standard compliance run) |
| Approved leave conflict | V8 `leaveConflictRule` (BLOCKING) | Yes, inside the V8 orchestrator |
| Visa restriction | V8 `studentVisaRule` (BLOCKING, `contract_type === 'STUDENT_VISA'`) | Yes, inside the V8 orchestrator |
| Fatigue / hour caps / EBA | V8 `rest-gap`, `max-workday-limits`, `ordinary-hours-avg`, `daily-hours`, `spread-of-hours` | Yes, inside the V8 orchestrator |
| Current hours (display) | `workload.ts` — `computeUtilizationPct()`, `computePeakFatigue()` | **Display-only**, confirmed not a hard filter anywhere — fine for the panel's "Current Hours" field, but must not be treated as a blocking rule beyond what V8 already enforces |
| Active / suspended / terminated / archived employee status | **Not found enforced anywhere in the eligibility layer.** `profiles.is_active` (bool), `profiles.status` (text, default `'Active'`), `profiles.termination_date` (date) all exist as columns but nothing currently filters scheduling candidates on them. | **Gap — must be added**, not duplicated (nothing to reuse) |
| Venue/room permission | Not found as a distinct concept for *staff* scheduling (the `venueops_*` tables are ICC room-booking/demand-ML data, a different domain). Department/sub-department scoping in `EligibilityService` is the closest existing proxy. | Treat dept/sub-dept scope as the venue-permission check |
| Full reference implementation (Python, autoscheduler) | `optimizer-service/model_builder.py` → `employee_eligible()` (unavailable_dates, role/skill/license, overlap+rest-gap, min-engagement, availability full-containment) | Correct and complete, but **Python-only** — not directly callable from the TS admin UI; useful as a logic reference, not a dependency |

**Bottom line recommendation (matches what the eligibility-focused sub-agent independently concluded):** build one new composition function, e.g. `getReserveListCandidates(shiftId)`, that:
1. Starts from `EligibilityService.getEligibleEmployees()` for the structural scope,
2. Adds the missing active/not-terminated/not-suspended filter (new, small, no duplication since nothing else does this today),
3. Filters by the new `reserve_list.opt_in` flag,
4. Excludes anyone already assigned/overlapping via the existing overlap check,
5. Runs `complianceService.validateShiftCompliance()` per remaining candidate for the pass/fail + reasons shown in the panel.

This is composition of five already-correct pieces, not a sixth reimplementation.

---

## 5. Version locking, FSM, and the assignment write path — full detail

**`shifts.version`** — `integer NOT NULL DEFAULT 1`, incremented by trigger `trg_increment_shift_version` on every `UPDATE`.

**`sm_apply_shift_op(p_shift_id uuid, p_expected_version int, p_op text, p_payload jsonb, p_idempotency_key uuid) RETURNS jsonb`** — `SECURITY DEFINER`, confirmed live via `pg_get_functiondef`. What it actually does, in order:
1. **Auth gate**: caller must be `is_admin()` OR hold an active `app_access_certificates` row with `access_level IN ('gamma','delta','epsilon','zeta')`. Anyone else → `{ok:false, code:'FORBIDDEN'}`. **This function is manager-only by construction** — Reserve List gets its "employees cannot invoke" requirement for free just by calling it.
2. `SELECT * FROM shifts WHERE id = ... FOR UPDATE` — a real Postgres row lock, not just an optimistic check. A second concurrent call for the same shift **blocks** here until the first transaction commits or rolls back.
3. Idempotency replay check against `shift_events.metadata->>'idem'`.
4. **Version CAS**: `IF v_cur.version <> p_expected_version` → `{ok:false, code:'VERSION_CONFLICT', current_version, current_state, last_modified_by, updated_at, server_row}`. This is precisely the "stale version → assignment rejected, here's the current state, go refresh" contract the spec asks for.
5. **FSM legality**: `fsm_op_is_legal(current_state, p_op)` → `{ok:false, code:'ILLEGAL_TRANSITION', ...}` if not legal.
6. Delegates the actual field writes to `_apply_shift_op_write(...)`.
7. Writes one `shift_events` audit row (with `from_state`/`to_state`/`from_version`/`to_version`/actor/domain) — this is the shift audit trail (see project memory on the Shift Audit System).
8. Returns `{ok:true, code:'APPLIED', version, state}` on success.

**`fsm_op_is_legal(state, op)`** (confirmed live):
```
'assign'  → legal from S1, S2, S3, S4, S5, S6, S7, S8   -- includes S1 = Draft+Unassigned, the target case
'unassign'→ legal from S2 only (a published+assigned shift must be unpublished first)
'publish' → legal from S1, S2
```
**No new FSM state is needed.** `'assign'` is already legal from the exact state an unassigned emergent shift is in (`S1`, since the bidding-expiry cron already bounces it back to Draft once TTS≤4h).

**`_apply_shift_op_write`, `op = 'assign'` branch** (confirmed live): sets `assigned_employee_id`, `assigned_at`, `assignment_status='assigned'`; if the shift is already `Published`, also sets `assignment_outcome='confirmed'`, `confirmed_at`, closes bidding. **It does not currently re-check overlap, leave, or compliance before writing** — it trusts the caller. This matters for §13.

**`get_shift_fsm_state(...)`** — the authoritative, pure-SQL state derivation from the 6 status columns. Per existing project memory, the client's "slim" `shift-fsm.ts` used by shift cards is a known-incomplete JS re-implementation (ignores `bidding_status`, lacks `S8`). Reserve List's own "is this card eligible for the Phone icon" check should **not** add a third divergent copy of this logic — derive it from the raw columns/urgency directly, or better, from a query that mirrors `get_shift_fsm_state`.

**Multi-writer protection today, concretely:**
- ✅ Row lock + version CAS + idempotency key inside `sm_apply_shift_op` — solves "two managers assign *different* people to *the same* shift" completely, deterministically, with zero new code, **as long as the call goes through this function**.
- ❌ `sm_bulk_assign` (used by drag-and-drop bulk assign) bypasses the gateway entirely — direct `UPDATE` with only a lost-update guard (`assigned_employee_id IS NULL OR = target`), no FSM check, no audit event via the gateway. **Do not model Reserve List's write on this function** — it's an existing anti-pattern, not a template.
- ❌ The current emergency-publish direct-update in `shifts.commands.ts` (§2) — same problem, and it's the closest existing analog to what Reserve List needs to do. **Do not copy it.**

---

## 6. Concurrency handling — the gap that isn't automatically closed

Read the "Sarah" example in the spec carefully: Manager A opens Reserve List, sees Sarah, meanwhile Manager B assigns Sarah to a *different* shift, then Manager A presses Assign.

Version-CAS on *this* shift's `version` column does **not** catch that scenario by itself — Sarah's assignment happened on a *different* shift row, so this shift's version is unchanged. What actually needs to happen is a **re-check of Sarah's overlap/eligibility at the moment of commit**, not just a version check on the target shift. Today, `_apply_shift_op_write`'s `'assign'` branch does **not** do this re-check (§5) — and this is a real, pre-existing gap in the current codebase, not something specific to Reserve List.

**Recommendation:** extend the gateway's `assign` handling (or add a dedicated op, e.g. `reserve_assign`) so that, inside the same locked transaction, it re-runs `check_shift_overlap(employee_id, ...)` (or equivalent) for the target employee against their *current* shift set before writing, and returns a distinct code (e.g. `CANDIDATE_NO_LONGER_ELIGIBLE`) if it fails. This closes the Sarah scenario properly and, as a side effect, hardens the existing plain `'assign'` op for every other caller too (bid-winner selection, manual edit) — a genuine improvement, not scope creep specific to this feature.

The **"compliance executed twice simultaneously" / "Department A vs Department B"** failure modes reduce to the same row-lock + version-CAS mechanism once Reserve List's write goes through `sm_apply_shift_op` — there's nothing extra to invent there.

---

## 7. FSM recommendation

**No new FSM state.** Reserve List is a manager-only workflow that ends in the existing `assign` transition (§5), landing the shift in `S2` (Draft+Assigned) if still Draft, or immediately in `S4` (Confirmed) if the emergency-publish-on-assign behavior (§2, §12) is folded into the same call. The distinct "Emergency Assigned" signal already exists and should be reused as-is: the `emergency_assigned_at`/`emergency_assigned_by` columns + `EMERGENCY_ASSIGNED` audit event + existing KPI (`emergency_assigned` in `WorkforceTab.tsx`/`PerformanceTab.tsx`) — **do not** confuse this with the *different* `assignment_outcome = 'emergency_assigned'` enum value, which is used for trade-related states (`S7`/`S12`/`S14`), a separate scenario. Reserve List assignments should stamp `emergency_assigned_at`/`by` while keeping `assignment_outcome = 'confirmed'`, exactly matching the current manual emergency-publish code.

`assignment_source` (free-text column, no enum constraint) can be set to a new value, e.g. `'reserve_list'`, purely for reporting/audit differentiation from `'manual'`/`'direct'` — no migration required, it's just a string.

---

## 8. Employee opt-in & availability/preferences architecture

**Availability UI**: `src/modules/availability/pages/AvailabilityPage.tsx`, backed by `availability_rules` (employee-authored) → materialized by a DB trigger into `availability_slots` (read-only from the client, 9,846 rows live). The existing toggle pattern for this page uses `Switch` from `src/modules/core/ui/primitives/switch.tsx` (used for the rule's "repeat" toggle) — **this is the component to reuse** for the new "Reserve List" toggle the spec mocks up.

**Employee preferences**: no dedicated preferences table exists. `profiles.preferences jsonb` already exists and already defaults to `{"notifications": {"push": true, "email": true}}` — a nested-key convention is already established. **Recommendation: `profiles.preferences.reserve_list.opt_in: boolean`, default `false`.** No new table, no migration beyond a default-value backfill (trivial at 107 profile rows). This also naturally sits next to the notification-preference keys already there, which is relevant since a Reserve List opt-in is conceptually "are you willing to receive this kind of alert."

---

## 9. Notifications — investigation only (per the brief, do not build)

**What exists**: `notifications` table (2,497 rows live) + `notify_user(p_profile_id, p_type, p_title, p_message, p_entity_id, p_entity_type, p_link, p_dedup_key)` — `SECURITY DEFINER`, 10-second dedup throttle per `(profile_id, type, entity_id)`. Currently invoked from DB triggers for swap/leave outcomes. **It is a single-recipient function, but nothing stops calling it once per candidate/selected employee** — that's the natural mechanism for "selected Reserve List employee gets notified," later.

**Realtime**: `useRealtimeInvalidate(channelName, tables[], onChange, enabled)` (`src/platform/supabase/hooks/useRealtimeInvalidate.ts`) is the established pattern — identical usage for leaves/swaps/bids, channel naming `${feature}-rt-${userId}`, subscribed tables added to the `supabase_realtime` publication via migration. `notifications` is already in that publication.

**What does *not* exist**: any actual push/SMS delivery channel. `profiles.preferences.notifications.push` reads as a **future-facing** flag — there is no provider wired up to honor it today. Anything described as "push notification to selected reserve-list employees" is in-app-notification-row-only until a push provider is integrated; that integration is out of scope for this feature and should be called out as a dependency if the product ever wants real push.

**A related system exists but is the wrong fit**: `broadcast_groups`/`broadcasts`/`broadcast_notifications` (group messaging, read receipts, acknowledgements — the "megaphone" feature). Its semantics (group broadcast with ack tracking) don't match "you personally were offered/assigned an emergency shift." **Recommendation: when this is eventually built, use `notify_user()`, not the broadcast system.**

---

## 10. Refresh behaviour recommendation

The spec is explicit that the candidate pool must never be cached and must support Refresh at any time. Given:
- The search spans many employees' availability/leave/shift/compliance state at once (not a single row a realtime subscription can cleanly represent), and
- The spec explicitly wants a manual Refresh button regardless,

**Recommendation:** manual Refresh as the primary mechanism (a plain `getReserveListCandidates(shiftId)` re-fetch, no caching layer in front of it — literally never call it through react-query's cache, always `staleTime: 0` / direct fetch). Optionally layer the existing `useRealtimeInvalidate` pattern on top, scoped to the relevant department's `shifts`/`leave_requests`/`availability_slots` changes while the panel is open, to show a **"New activity — refresh?"** banner rather than silently refetching mid-read (auto-refetch while a manager is scanning names would be disorienting and works against the deliberate "search → review → select" flow). This reuses the exact hook already proven for bids/swaps/leaves instead of inventing a new realtime pattern.

---

## 11. Security considerations

- **Authorization**: reuse `sm_apply_shift_op`'s existing manager-only gate (`is_admin()` OR active cert with `access_level IN ('gamma','delta','epsilon','zeta')`) for the assign step. Do not build a parallel authorization check — every other manager-only mutation in this codebase already goes through this exact gate (and `is_manager_or_above()`, which independently reimplements the same check for RLS `USING` clauses, confirmed live and **not** currently broken — a prior project memory calling it "BROKEN in prod" is now stale and should be corrected).
- **RLS gap to be aware of, not to extend**: `shifts` has direct-UPDATE RLS policies (`shifts_update_access`, `shifts_update_rbac`) that allow authenticated clients to write to the table directly, bypassing the gateway entirely — this is what the current emergency-publish shortcut relies on (§2). Reserve List should route 100% of its writes through `sm_apply_shift_op` and should **not** add a second direct-update code path that leans on this RLS surface.
- **New SECURITY DEFINER functions**: if any new RPC is added (e.g., a server-side eligibility composer), it **must** explicitly `REVOKE EXECUTE FROM anon, PUBLIC` after creation — Supabase auto-grants `EXECUTE` to `anon` on new functions by default, which this codebase has already been bitten by once (see `20260721001221_fix_rls_recursion_helpers_hardened.sql` and the corresponding project memory). Put this in the migration checklist explicitly.
- **Stale/hidden candidates**: solved by never trusting a client-held candidate list at write time — the compliance re-check (§3) and the proposed overlap re-check (§6) both run fresh, server-side, at the moment of assignment, not at the moment of search.
- **planning_requests as an optional audit trail**: the `planning_requests`/`planning_offers` tables (confirmed live) already implement almost exactly this "manager initiates → compliance snapshot stored at selection time → manager decides" shape for BID/SWAP. Their `type` column has a `CHECK (type IN ('BID','SWAP'))` constraint and RLS policies keyed off `initiated_by`/`manager_id`/`target_employee_id`/`is_manager_or_above()` (type-agnostic). **Optional, not required for MVP**: extending the `type` check constraint to include a new value (e.g. `'RESERVE'`) would give Reserve List a ready-made, RLS-safe audit record of "who was searched for and offered this shift" with zero new RLS policy work. This is a nice-to-have for auditability, not a dependency for the core assign flow.

---

## 12. Recommended architecture — end-to-end flow

```
Shift Card (SmartShiftCard.tsx / ShiftCardCompact.tsx)
  urgency === 'emergent' (computeShiftUrgency, existing)
  AND assignment_status === 'unassigned'  (or manager just unassigned)
        │
        ▼  [Phone icon replaces the Gavel/marketplace indicator]
ReserveListPanel (new component, styled like DrillDownPanel's icon-button/panel conventions)
        │
        ▼  on open AND on every "Refresh" press — never cached
getReserveListCandidates(shiftId)   [new composition, §4]
  = EligibilityService.getEligibleEmployees(scope)
    ∩ active/not-terminated/not-suspended (new, small filter)
    ∩ profiles.preferences.reserve_list.opt_in = true (new)
    ∩ !check_shift_overlap / V8 no-overlap
        │
        ▼  per remaining candidate, on demand ("Run Compliance" or automatically per row)
complianceService.validateShiftCompliance(employeeId, shiftDate, startTime, endTime, netMinutes)
  [existing, unmodified — same call real assignment already makes]
        │
        ▼  manager clicks Assign on a passed candidate
sm_apply_shift_op(shiftId, expectedVersion, 'assign', { employee_id, assignment_source: 'reserve_list' }, idempotencyKey)
  [existing gateway — row lock + version CAS + FSM guard + audit event, all for free]
  + (recommended extension, §6) server-side re-check of overlap/compliance for THIS employee
    before commit, inside the same transaction
        │
        ├── ok:true  → same emergency-confirm behavior the manual path already has
        │              (assignment_outcome='confirmed', emergency_assigned_at/by stamped,
        │              landing directly in S4 — fold the current direct-update logic from
        │              shifts.commands.ts into this same gateway call instead of a second
        │              unprotected client-side UPDATE)
        │
        └── ok:false, code:'VERSION_CONFLICT' or 'CANDIDATE_NO_LONGER_ELIGIBLE'
                     → surface reason, force a fresh getReserveListCandidates() call,
                       manager must re-search (exactly the spec's required behavior)
```

This reuses five existing, already-correct subsystems (`EligibilityService`, availability-check, V8 compliance engine, `sm_apply_shift_op`, `useRealtimeInvalidate`) and adds exactly two genuinely new things: the eligibility-composition function and the overlap-recheck extension to the gateway. Nothing else needs to be invented.

---

## 13. Database impact

| Change | Type | Notes |
|---|---|---|
| `profiles.preferences.reserve_list.opt_in` | Convention on existing `jsonb` column | No schema migration required; app-level default `false` |
| `getReserveListCandidates`-equivalent | New TS service (composition) OR new SQL `SECURITY DEFINER` RPC | Recommend TS composition over a new SQL RPC — avoids adding a *third* partial eligibility function alongside the two stale ones in §3 |
| Overlap re-check inside `assign` | Extend `_apply_shift_op_write`'s `'assign'` branch, or add new op `reserve_assign` | Must run inside the same locked transaction as the write; must `REVOKE EXECUTE FROM anon, PUBLIC` if it's a new function |
| `assignment_source = 'reserve_list'` | Value convention on existing free-text column | No migration |
| `emergency_assigned_at`/`by` on assign | Fold into the gateway write instead of the current direct-UPDATE shortcut | Migration to `_apply_shift_op_write`, not a schema change |
| `notification_type` enum | None needed | `'shift_assigned'` or `'general'` already cover the eventual notify-employee case |
| `planning_requests.type` CHECK | Optional | Only if the team wants Reserve List modeled as an auditable request/offer, per §11 |
| New FSM states/enum values | **None** | Confirmed unnecessary (§5, §7) |

No changes needed to `availability_slots`, `availability_rules`, `shift_licenses`/`employee_licenses`, `shift_skills`/`employee_skills`, or the compliance V8 rule set — all consumed as-is.

---

## 14. API / frontend / backend impact

**New frontend module** (per this repo's DDD module standards in `docs/ddd-module-standards.md`): recommend a `src/modules/reserve-list/` module rather than growing `src/modules/rosters/` further, containing:
- `api/reserveList.service.ts` — `getReserveListCandidates(shiftId)`, `assignFromReserveList(shiftId, employeeId, expectedVersion)` (thin wrapper over `sm_apply_shift_op`)
- `ui/ReserveListPanel.tsx` — candidate list, per-row compliance status/current-hours/warnings, Assign/Refresh/Run Compliance buttons, styled per `DrillDownPanel.tsx` conventions
- Availability page: add the `Switch`-based "Reserve List" opt-in toggle to `AvailabilityPage.tsx`

**Existing frontend files to modify** (not duplicate):
- `SmartShiftCard.tsx` / `ShiftCardCompact.tsx` — swap the Gavel/marketplace indicator for a Phone icon when `urgency === 'emergent' && unassigned`, matching the existing icon-button styling already used for the Gavel/history icons in the same files
- `shifts.commands.ts` — fold the direct-UPDATE emergency-publish branches (§2, lines ~575-598 and ~784-803) into the hardened gateway call once that extension lands (§6), rather than adding a third unprotected write path next to them

**Backend**: no new Edge Function required — `evaluate-compliance` and `sm_apply_shift_op` are reused as-is; the only backend work is the SQL migration extending `_apply_shift_op_write`'s `assign` handling (§6, §13).

---

## 15. Components to reuse vs. build new (summary table)

| Reuse as-is | Extend | Build new |
|---|---|---|
| `sm_apply_shift_op` (gateway, locking, FSM guard, audit) | `_apply_shift_op_write` `'assign'` branch (overlap re-check + emergency stamp) | `getReserveListCandidates()` composition function |
| `complianceService.validateShiftCompliance()` / V8 engine | `AvailabilityPage.tsx` (add opt-in toggle) | `ReserveListPanel.tsx` |
| `EligibilityService.getEligibleEmployees()` | `SmartShiftCard.tsx`/`ShiftCardCompact.tsx` (swap icon on emergent+unassigned) | Active/terminated/suspended filter (small, genuinely missing today) |
| `evaluateShiftAvailabilityFromSlots()` / `getResolvedAvailabilities()` | `shifts.commands.ts` (retire the two direct-UPDATE shortcuts once the gateway extension lands) | — |
| `check_shift_overlap` / V8 `noOverlapRule` | | |
| `useRealtimeInvalidate` (optional "new activity" nudge) | | |
| `notify_user()` (future, when notifications are actually built) | | |
| `profiles.preferences` jsonb convention | | |
| `computeShiftUrgency` / `isShiftLocked` | | |

**Do not build on**: `get_eligible_employees_for_shift` (stale stub, §3), `check_shift_compliance` (too narrow, §3), `sm_bulk_assign` (bypasses FSM, §5) — these exist, but reusing them would import their gaps into a feature explicitly meant to be safer than the status quo.

---

## 16. Refactoring recommended *before* implementation

1. **Close the direct-UPDATE bypass** in `shifts.commands.ts`'s emergency-publish paths (§2, §12) by moving that logic into `_apply_shift_op_write`. This should happen first — Reserve List's assignment step needs this hardened path to exist anyway, and fixing it in isolation first (with its own tests) de-risks the feature build that depends on it.
2. **Add the missing active/suspended/terminated filter** somewhere reusable (not Reserve-List-specific) — e.g. a small exported predicate in or near `EligibilityService`, since this gap will affect any future scheduling-eligibility consumer, not just Reserve List.
3. **Pick one overlap-check implementation** (recommend the V8 `noOverlapRule`, since it's already inside the standard compliance run) and stop maintaining the SQL `check_shift_overlap` version in parallel for this purpose — or explicitly document why both exist (DB-level `check_shift_overlap` may still be needed as a fast pre-filter before the heavier V8 run; if so, say so in code comments, since right now nothing explains the duplication).
4. **Reconcile the two TTS-expiry mechanisms** (Edge Function vs. `process_shift_timers()` DB function, §2) — confirm whether one calls the other or whether there are genuinely two independent cron paths for the same rule.

None of these are hard blockers for starting frontend work (the Phone icon, the panel shell, the opt-in toggle can all be built against the *current* `sm_apply_shift_op` `'assign'` op immediately) — but #1 should land before the Assign button in the new panel is wired to a real write, or the feature inherits the exact race condition it exists to prevent.

---

## 17. Risks and edge cases

- **The Sarah race (§6)** — not closed by version-CAS alone; needs the overlap re-check extension.
- **Client-side TTS is advisory only** — `computeShiftUrgency()` runs client-side for UI gating; the server independently re-derives TTS at write time in `_apply_shift_op_write`'s publish branch and in `sm_select_bid_winner`. These currently use **three different time sources** across the codebase (`scheduled_start` timestamptz column, `start_at` derived column, and raw `shift_date + start_time` string reconstruction) — worth standardizing on one (recommend `start_at`, consistent with the project's existing Sydney-timezone conventions) before adding a fourth TTS computation for the Phone-icon visibility check.
- **Client FSM drift** — the "slim" `shift-fsm.ts` used by shift cards is already known (project memory) to diverge from the authoritative `get_shift_fsm_state()` SQL function (ignores `bidding_status`, missing `S8`). Deriving "is this card eligible for Reserve List" from the slim client FSM risks a fourth divergent copy of FSM logic; prefer deriving it from raw status columns + urgency directly.
- **`sm_bulk_assign` exists as a live anti-pattern** — any future temptation to reuse it for a "bulk reserve-list assign" feature should be resisted; it has no FSM guard.
- **Compliance run cost** — running `evaluate-compliance` per-candidate for every search could be slow if the eligible pool is large; at current scale (107 profiles total, one org) this is very unlikely to matter, but if the panel is left open and re-searched frequently, consider capping how many candidates get an automatic compliance run vs. on-demand per row (the spec's own "Run Compliance Button" suggests on-demand is the intended UX anyway).
- **Notification-preference flags on `profiles.preferences`** (`push`/`email`) currently have no delivery mechanism behind them (§9) — don't let the opt-in toggle's presence imply push notifications work; they don't yet.

---

## 18. Step-by-step implementation phases (proposed, for a future planning pass — not started)

1. **Hardening pass** (§16 item 1): move emergency-assign-and-publish into `_apply_shift_op_write`, add the overlap/compliance re-check to the `assign` branch, migrate `shifts.commands.ts` to call the hardened path. Ship and verify independently of Reserve List UI.
2. **Eligibility composition**: build `getReserveListCandidates(shiftId)` from existing pieces (§4, §12); add the active/terminated/suspended filter as a small reusable addition.
3. **Opt-in toggle**: add the `Switch` to `AvailabilityPage.tsx`, wire to `profiles.preferences.reserve_list.opt_in`.
4. **Panel UI**: `ReserveListPanel.tsx` — list, per-candidate compliance/hours/warnings, Assign/Refresh/Run Compliance actions; wire Assign to the hardened gateway call from phase 1.
5. **Card integration**: Phone icon on `SmartShiftCard.tsx`/`ShiftCardCompact.tsx`, gated on `urgency === 'emergent' && unassigned`.
6. **(Optional, later)** realtime "new activity" nudge via `useRealtimeInvalidate`; `notify_user()` call on successful assignment; `planning_requests` audit trail if the team wants it.

---

## 19. Open questions for product/engineering decision

1. Should the overlap/compliance re-check live inside `sm_apply_shift_op`'s existing `'assign'` op (hardening it for every caller) or a new dedicated `'reserve_assign'` op (narrower blast radius, but yet another op to maintain)? Recommendation: extend the existing op — the current lack of a re-check is a latent bug for `'assign'` generally, not a Reserve-List-specific requirement.
2. Reconcile `shift-state-processor` Edge Function vs. `process_shift_timers()` DB function (§2, §16) — needs an engineer with context on which one is actually scheduled/live to confirm.
3. Is a `planning_requests`-based audit trail (§11) wanted for Reserve List (who was searched, who was offered, when), or is the `shift_events` audit row from `sm_apply_shift_op` sufficient?
4. Real push/SMS delivery for the eventual "notify selected employee" step is out of scope here — confirm whether that's a near-term follow-up or genuinely deferred.
