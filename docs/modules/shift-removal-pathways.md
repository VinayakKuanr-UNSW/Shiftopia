# Shift removal pathways — audit (2026-10-04)

> **Status: §4 IMPLEMENTED and applied to production 2026-10-04** —
> `supabase/migrations/20261004120000_shift_deletion_permanent_and_no_audit.sql`.
> Tables below describe the state BEFORE that migration. `shift_events` was
> kept (KPI / Performance data); all other auditing was removed.

Every way a shift can leave the roster today, verified against the **live production
database** (`pg_get_functiondef`, `pg_trigger`, `cron.job`) and the app code — not
against migration files, which have drifted.

Production at the time of writing: **25 shifts**, **0 soft-deleted**.

---

## 1. The headline problems

| # | Problem | Evidence |
|---|---|---|
| A | **Nothing in the database stops a past shift being deleted.** The "lock past shifts" trigger lets every DELETE straight through, and explicitly allows soft-deleting a past shift. | `fn_prevent_locked_shift_modification`: first line `IF TG_OP = 'DELETE' THEN RETURN OLD`; "EXCEPTION 3: Allow soft deletion". |
| B | **Single delete has been broken in production since 4 Aug.** `sm_delete_shift` archives first, and the archive reads `timesheet_review_queue`, dropped by `20260804010000_remove_autopilot_teardown`. Every call returns `{success:false}`. | `deleted_shifts`: last row 2026-08-03; **0 rows ever** via `sm_delete_shift`. |
| C | **Leave approval leaves full-time shifts in place** — because of B. The leave is approved and the balance deducted, but the shifts stay. | Reproduced 2026-10-04 on James Smith, 5–9 Oct. |
| D | **Bulk Delete has no authorisation or scope check.** `sm_bulk_delete_shifts` is `SECURITY DEFINER`, callable by any signed-in user, and soft-deletes **any shift IDs it is given** — any org, past or worked. | Function body: one `UPDATE … WHERE id = ANY(p_shift_ids)`. |
| E | **`admin_delete_shift_rpc` trusts a caller-supplied admin id.** Pass any admin's UUID as `p_admin_id` and it soft-deletes. Not called by the app. | Checks `profiles.system_role` of `p_admin_id`, not `auth.uid()`. |
| F | **Test harness functions are in production and callable by any user**, several of which `DELETE FROM shifts`. | `test_all_transitions`, `test_*_v3` (×5), `cleanup_test_shifts`. |
| G | **No database function knows about full-time.** Drop, unassign, cancel, trade, swap, bid-winner and publish all treat an FT shift exactly like a casual one. | None of them reads `target_employment_type`. |
| H | **Two "delete" semantics coexist.** Some paths hard-delete; others soft-delete (`deleted_at`). | See §2. |
| I | **Leave approval treats non-FT shifts differently from the roster.** Leave uses the gateway `unassign` (→ unassigned, *not* bidding); the roster's unassign uses `sm_unassign_shift` (→ **bidding** if Published). | `leave.api.ts` vs `sm_unassign_shift`. |
| J | **The dead-shift cleanup cron (every 10 min) silently does nothing since 4 Aug** — same stale `timesheet_review_queue` reference. Its runs report "succeeded". | `cleanup_dead_shifts_batch`. |

---

## 2. Every pathway

**Kind** — HARD = row deleted · SOFT = `deleted_at` set · BID = unassigned and pushed to
Bidding · CANCEL = `is_cancelled` · UNASSIGN = employee removed, shift stays.

**Past guard / FT guard** — what the BACKEND enforces today.

### Manager actions

| Pathway | UI entry | Backend | Kind | Past guard | FT guard |
|---|---|---|---|---|---|
| Delete one shift (roster) | Group mode card, Drill-down panel | gateway `sm_apply_shift_op` op `delete` | SOFT | ✗ (UI only) | ✗ |
| Delete one shift (Office) | Office card ⋯ → Delete | `sm_delete_shift` | HARD + archive — **broken (B)** | ✗ (UI only) | n/a |
| Bulk delete | Roster bulk toolbar, Drill-down bulk | `sm_bulk_delete_shifts` | SOFT — **unscoped (D)** | ✗ | ✗ |
| Publish roster → "dead" shifts | Planner publish dialog (`plan.deadIds`) | `sm_bulk_delete_shifts` | SOFT | ✗ | ✗ |
| Demand synthesizer redundancy purge | Shift synthesizer (`suggestedDeletions`) | `sm_bulk_delete_shifts` | SOFT | ✗ | ✗ |
| Unassign employee from shift | Roster: assign → nobody | `sm_unassign_shift` | **BID** if Published, else UNASSIGN | ✗ | ✗ — **FT goes to Bidding** |
| Bulk unassign | Roster | gateway op `unassign` | UNASSIGN | ✗ | ✗ |
| Cancel shift | Planner card → Cancel | `sm_manager_cancel` | CANCEL | ✗ | ✗ |
| Unpublish | Card / bulk | `sm_unpublish_shift` | → Draft (not a removal) | client only | — |
| Delete roster sub-group | Roster sub-group menu | `delete_roster_subgroup_v2` | HARD, all its shifts | ✗ | ✗ |
| Clear / undo a template application | Templates, roster | `sm_clear_template_application`, `undo_template_batch` | HARD | ✗ | ✗ |
| Delete template's shifts | Templates | `delete_template_shifts_cascade` | HARD | ✗ | ✗ |
| Delete template's shifts (client) | `shiftsCommands.deleteShiftsByTemplateId` | direct `DELETE` | HARD | ✗ | ✗ — no UI caller found |
| Bulk delete (repo layer) | `deleteShift.command` → `shiftsRepo.bulkDeleteShifts` | direct `DELETE … IN (ids)` | HARD | ✗ | ✗ — exported, no UI caller found |
| Delete a user | Users → Delete user | `delete_user_entirely` | UNASSIGN — **every** shift of theirs, past and worked included (loses who worked it) | ✗ | ✗ |
| Delete roster / department / org | — | FK `ON DELETE CASCADE` on `shifts.roster_id`, `department_id`, `organization_id` | HARD, every shift incl. worked | ✗ | ✗ |

### Leave

| Pathway | Backend | Kind | Notes |
|---|---|---|---|
| Approve leave — FT shifts in range | `sm_delete_shift` per shift | HARD + archive — **broken (B, C)** | Worked shifts skipped (reported). |
| Approve leave — PT / Casual shifts | gateway op `unassign` | UNASSIGN (not bidding) | Inconsistent with roster unassign (I). |
| Revoke approved leave | — | none | Removed shifts are **not** restored. |

### Employee actions

| Pathway | UI entry | Backend | Kind | Past guard | FT guard |
|---|---|---|---|---|---|
| Drop / cancel my shift | My Roster → Drop | `sm_employee_drop_shift` | **BID** | ✗ (S3/S4 only) | ✗ — **FT can drop to Bidding** |
| Request trade | My Roster → Trade | `sm_request_trade`, `sm_create_swap_request` | trade | ✗ | ✗ |
| Accept trade / swap | Swaps | `sm_accept_trade` | reassign | ✗ | ✗ |
| Decline / reject / ignore offer | Offers | `sm_decline_offer`, `sm_reject_offer`, offer-expiry cron | → Draft | — | ✗ |

### System

| Pathway | Schedule | Backend | Kind |
|---|---|---|---|
| Dead-shift cleanup | `*/10 * * * *` | `cleanup_dead_shifts_batch` | HARD + archive — **broken since 4 Aug (J)** |
| Offer expiry | `*/5 * * * *` | `fn_process_offer_expirations` | → Draft |
| Shift timers / state processor | every 1 / 15 min | `process_shift_timers`, `sm_run_state_processor` | state moves (bidding timeout, trade expiry) |
| Test harness | manual | `test_*`, `cleanup_test_shifts` | HARD — **callable by any user (F)** |

---

## 3. "Audit" and "Archive" — what each actually is

| Thing | What it is | Removable? |
|---|---|---|
| **Archive** — `deleted_shifts` + `_archive_shift_before_delete` | Copy of a shift at deletion. Nothing in the app reads it. | **Yes.** Nothing reads it. |
| **Shift History UI** — `ShiftHistoryTimeline` (card History toggle, Drill-down) + `get_shift_event_timeline` | The audit view over `shift_events`. | **Yes**, UI + read RPC. |
| **`shift_events` capture** (`fn_capture_shift_event`, gateway envelopes) | The event ledger. **9 metric functions read it**: `get_marketplace_kpis`, `get_manager_scorecard`, `get_employee_metrics` (×2), `get_performance_trends`, `get_cancellation_reason_breakdown`, `get_employee_event_timeline`, `get_shift_lifecycle`, `sm_refresh_shift_snapshots`. | **No — not without breaking Performance, KPIs and Insights.** It is metrics data that the audit UI happened to sit on. |
| Leave history — `leave_request_events`, `LeaveTimeline` (review dialog) | Leave audit trail. | Yes (UI); confirm. |
| Timesheet audit — `timesheet_audit_log`, `timesheetAudit.api.ts` | Timesheet adjustments trail. | Confirm — payroll-adjacent. |

---

## 4. Proposed enforcement (pending decisions in §5)

Rules are enforced **once, in the database**, so no pathway — UI, RPC, cascade, cron or
direct API — can bypass them; the UI mirrors them to hide actions that would fail.

1. **Past shifts are never deleted.** `BEFORE DELETE` trigger on `shifts`: refuse when the
   shift's start (Sydney) ≤ `now()`. Fires for every pathway, including FK cascades,
   template/sub-group deletes and crons. Replaces the `RETURN OLD` in
   `fn_prevent_locked_shift_modification`.
2. **All deletes are hard.** Every SOFT writer above becomes a real `DELETE`; no new rows
   get `deleted_at`. (The column stays until its readers are removed.)
3. **No archive.** `sm_delete_shift` stops calling `_archive_shift_before_delete`; the
   function and `deleted_shifts` are dropped.
4. **FT never enters bidding, trading or cancellation.** `BEFORE UPDATE` trigger: refuse
   any write that puts a `target_employment_type = 'FT'` shift on bidding, into a trade, or
   cancelled. Drop, unassign→bidding, publish-unassigned→bidding, trade/swap request and
   manager cancel all fail for FT, whichever path they come from.
5. **Deletes are authorised and scoped** (fixes D, E): delete RPCs check `auth.uid()` holds
   `shift.delete` (or equivalent) over the shift's department.
6. **Test harness removed from production** (F).
