# Migration Reconciliation — production vs `feat/autopilot-uniform-onoff`

**Date:** 2026-08-02
**Prod project:** `srfozdlphoempdattvtx` (Vercel project `shiftopia`)
**Scope:** read-only audit of the divergence between the production migration
ledger and this branch, plus the corrective actions taken. **No production
schema was changed by this document's analysis.** The one forward migration that
prod genuinely lacks (`swaps_autopilot_on_off`) is tracked separately (§6).

---

## 1. TL;DR

- **Production is *ahead* of `main`.** 10 migrations exist in prod that had **no
  committed source file** — they were applied directly via the Supabase MCP
  during the 2026-07-27/28 security & payroll audit.
- **Do NOT replay this branch's "unapplied" timesheet migrations onto prod.**
  Prod already contains every column/trigger/table they would add, and several
  of them `CREATE OR REPLACE` functions that prod has **since patched** — a
  replay would *silently roll back* three security/audit fixes (§4).
- **Timesheet AutoPilot is intentionally retired** (prod migration
  `p0_retire_timesheet_autopilot_matching_stated_intent`). Swap/bid AutoPilot is
  intentionally **kept**. This branch's timesheet-AutoPilot **frontend adapter**
  is already deleted; its dead **edge-function worker** is removed here.
- **Root cause of the noisy `supabase migration list` diff:** the branch's
  migration files were authored with *placeholder* timestamps (`…000100`,
  `…020000`, …) but Supabase assigned *real* timestamps when they were applied
  via MCP, so the same logical migration appears under two different versions.

## 2. How prod diverged (the 10 orphans)

Applied to prod, previously absent from git. Backfilled into `supabase/migrations/`
by this change (byte-for-byte from `supabase_migrations.schema_migrations`):

| Prod version | Name | Purpose |
|---|---|---|
| 20260710163425 | `pin_search_path_leave_functions` | pin `search_path` on 3 leave fns |
| 20260727023657 | `p0_fix_rpc_auth_bypass_and_grants` | fix anon bypass on `sm_bulk_assign_atomic`, `sm_finalize_planning_request`, `_apply_shift_op_write` |
| 20260727023739 | `p0_bind_clock_actions_to_caller_identity` | bind `sm_clock_in`/`sm_clock_out_shift` to caller identity |
| 20260727023802 | `p0_fix_pay_periods_and_labor_attendance_rls` | close always-true RLS on `pay_periods`, `actual_labor_attendance` |
| 20260727024158 | `p0_retire_timesheet_autopilot_matching_stated_intent` | disable TS-AutoPilot policy + `cron.unschedule('auto-verify-timesheets-tick')` |
| 20260727223312 | `p1_add_religious_cultural_and_gender_affirmation_leave` | new leave types + accrual resets |
| 20260727225942 | `p1_add_shift_first_aid_duty_flag` | `shifts.is_first_aid_duty` (cl 28.2 allowance) |
| 20260728023436 | `p2_medium_remediation_autopilot_gate_provenance_leave_rls` | JSON-primary autopilot gate + bot/manual provenance + leave RLS |
| 20260728024255 | `p2_low_seed_leave_balances_for_new_contracts` | trigger to seed leave balances on new contracts |
| 20260728024601 | `p2_low_revoke_excess_grants_payroll_tables` | revoke excess grants on eba_*/gross_pay tables |

**How it happened:** the documented team workflow applies security fixes to prod
via `apply_migration` (MCP) and commits the source later — sometimes on a
different branch, sometimes not at all. `feat/autopilot-uniform-onoff` was cut in
parallel and never received these files.

## 3. Why prod is a *superset* of this branch

Prod's current `public.timesheets` already has every column the branch's
"unapplied" timesheet migrations would add — `version`, `edit_count`,
`arrival_variance_reason`, `departure_variance_reason` — plus the triggers
(`trg_timesheet_edit_count`, `trg_timesheet_version_bump`, `trg_timesheet_provenance`),
the `UNIQUE(shift_id)` constraint, and all AutoPilot tables/functions (dormant —
policy disabled, cron unscheduled). All branch migrations are idempotent
(`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`), so a
replay would not *error* — it would silently overwrite newer objects.

## 4. Conflict matrix — the silent regressions a naive replay would cause

| Function | Authoritative version in prod | Branch migration that would overwrite it |
|---|---|---|
| `fn_timesheet_provenance` | `p2_medium` (bot-vs-manual audit) | `timesheet_auto_verify`, `…_fixed_window` |
| `is_timesheet_autopilot_active` | `p2_medium` (JSON-primary off-hours gate) | `…_windowing`, `…_fixed_window` |
| `sm_clock_out_shift` | `p0_bind_clock_actions` (P0 caller-identity) | `fix_clock_out_shift_event_conflict` |

**Key insight:** once the 10 orphans are backfilled with their *real* (later)
version timestamps, a fresh `supabase db reset` applies everything in timestamp
order, so these older branch bodies are re-overwritten by the later prod fixes and
the final schema reproduces prod. The regression risk exists **only** if the old
migrations are applied onto the *current* prod — which we will not do.

## 5. Actions taken in this change

1. **Backfilled the 10 orphan migrations** (§2) into `supabase/migrations/` with
   their exact prod version + name + SQL, each carrying a header noting it is
   already-applied-in-prod and must not be re-run. Git now reproduces prod.
2. **Removed the dead `supabase/functions/auto-verify-timesheets/` worker.**
   Timesheet AutoPilot is retired; the frontend adapter was already deleted and
   the cron that invoked this worker was unscheduled by `p0_retire…`.
3. **Left the branch's timesheet-AutoPilot schema migrations in place.** Their
   objects are dependencies of the later prod migrations (e.g. `p2_medium`
   references `timesheet_approval_rules`), and they self-correct by timestamp
   order (§4). They are inert dormant infrastructure that matches prod.

## 6. The one genuine forward change: `swaps_autopilot_on_off`

Swap AutoPilot is **not** retired. Prod runs it in shadow (`swap_approval_rules`,
`swap_decisions`, `sm_swap_auto_decide`, `shadow_mode` all present).
`20260723000000_swaps_autopilot_on_off.sql` removes the shadow branch and, as a
safety, disables any still-shadow-enabled policy so nothing silently goes live on
deploy. It touches only `sm_swap_auto_decide` (no overlap with any orphan → no
regression) and its runtime dependency `sm_apply_shift_op('approve_trade', …)` is
present in prod. This is the migration to apply to prod, paired with deploying the
`auto-approve-swaps` worker.

> **Bids note:** `sm_bid_auto_decide` does **not** exist in prod (bid AutoPilot
> infra is only partially deployed). `bid_auto_assign` is therefore a fuller
> install, not a de-shadow — treat separately, shadow-first, before any go-live.

## 7. Recommended full repair (follow-up, not done here)

`supabase migration list` still shows systemic version mismatches because the
branch files use placeholder timestamps while prod recorded real ones. To make
Git a clean source of truth for `db push`/`db reset`:

1. For each logically-applied-but-version-mismatched migration, either rename the
   local file to the prod version, or use `supabase migration repair --status
   applied <version>` to align the ledger.
2. Verify with `supabase db reset` on a scratch/branch database that the rebuilt
   schema matches prod (`supabase db diff`).
3. Adopt real (UTC-now) timestamps for all new migrations to prevent recurrence.
