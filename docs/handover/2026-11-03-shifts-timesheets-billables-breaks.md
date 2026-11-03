# Shifts column drops, the shifts / timesheets / billables split, and multi-break punching

**Status 2026-11-04: all migrations APPLIED to Supabase `srfozdlphoempdattvtx`; code UNCOMMITTED on `chore/shifts-drop-dead-columns`.**

Every fact below was checked against the live database on 2026-11-04, not taken from the
2026-11-03 handover this replaces. That handover described a schema that does not exist
(wrong column lists, a trigger that was never created, a verification script that cannot
run). Its text is not kept in the repo.

`handover.md` and `HANDOVER.md` are the **same file** on macOS (case-insensitive). The root
`HANDOVER.md` is the autoscheduler handover that the rulebook cites; it was overwritten on
2026-11-03 and has been restored from git. Put new handovers in `docs/handover/`.

## What changed

1. **Shifts column drops** (tiers 1–5). Columns removed, not added. `shifts` now has 58 columns.
2. **Three-table split.** Roster intent stays on `shifts`; attendance actuals move to `timesheets`;
   manager verification and pay inputs move to `billables`. Retired: `attendance_records`,
   `shift_payroll_records`, `gross_pay_records` (dropped CASCADE, no export taken, 0 timesheets
   existed), the `shift_attendance_status` enum, and auto clock-out.
3. **Multiple unpaid breaks and break punching.** `shifts.unpaid_breaks` (jsonb), the
   `timesheet_breaks` table, break RPCs, clock-out refusal while a break is open.
4. **2026-11-04 follow-ups** (this session): the database now creates the linked timesheet +
   billable pair; the manual-break lock-in is fixed; live function drift is repaired; the
   migration ledger matches the repo.

## Migrations — repo file = recorded version

All 18 files are named by the version Supabase recorded. The five marked *backfilled* ran ad hoc
on 2026-11-02 and were never recorded; their ledger rows were added on 2026-11-04 (version and
name only, `statements` NULL), with versions chosen so filename order reproduces the order they ran.

| Version | Name | |
|---|---|---|
| 20261102081346 | shifts_drop_dead_columns | tier 1: `locked_at, timesheet_id, offer_sent_at, …` (11 cols) |
| 20261102090000 | shifts_drop_template_group_and_eligibility | *backfilled* — tier 2 |
| 20261102093000 | shifts_tier3_track1_drops | *backfilled* |
| 20261102100000 | shifts_tier3_track2a_drops | *backfilled* |
| 20261102103000 | shifts_tier3_state_timezone_subgroup_drops | *backfilled* |
| 20261102111731 | shifts_tier4_demand_break_bidding_drops | |
| 20261102120000 | shifts_tier5_remun_bidding_time_overnight_drops | *backfilled* |
| 20261102141636 | timesheets_actuals_and_billables_split | the split; ~3,000 lines |
| 20261102144923 | timesheets_is_no_show_not_null | |
| 20261102145330 | shift_and_billable_event_clock_timestamp | |
| 20261103104637 | multi_unpaid_breaks_and_punch_concurrency | |
| 20261103214618 | shift_creates_timesheet_and_billable | 2026-11-04 |
| 20261103214719 | reconcile_live_function_drift | 2026-11-04 |
| 20261103220444 | paid_break_15_minute_increment | 2026-11-04 — CHECK on `shifts` + `template_shifts` |
| 20261103220652 | role_name_is_security_single_owner | 2026-11-04 — one SQL owner for "is Security" |
| 20261103223351 | close_anon_definers_and_invoker_views | 2026-11-04 — CI: views lost `security_invoker`; 9 definers anon-executable |
| 20261103223805 | gateway_and_kpi_runtime_errors | 2026-11-04 — CI: gateway + marketplace KPIs failed at run time |
| 20261103224126 | billables_drop_pay_columns | 2026-11-04 — CI: Team Leads could read pay through billables |

**Found by CI on PR #47 and fixed (all were live):**
- Publishing an open shift, unpublishing, accepting / rejecting / expiring an offer and dropping a
  shift all failed in `_apply_shift_op_write`: enum values that do not exist (`'unfilled'`,
  bidding `'open'`, swap `'PENDING'`) and two dropped columns still assigned (`offer_sent_at`,
  `confirmed_at`). `get_marketplace_kpis` read `sm.` for `spm.`. Confirmed with `plpgsql_check`
  (installed in a rolled-back transaction): no other PL/pgSQL function has an error, and all 76
  SQL functions re-validate.
- `v_shift_assignment_episodes` and `v_template_full` had lost `security_invoker` (CREATE OR
  REPLACE VIEW drops it); nine new SECURITY DEFINER functions were executable by anon.
- `billables` carried the retired payroll tables' pay columns under a `timesheet.view` policy, so
  Team Leads could read pay. The columns were never written; they are dropped.

**Files were extended after `apply_migration`.** Several files are much larger than what was
recorded (tier 4: 62 KB on disk, 1.7 KB recorded); the rest ran through `execute_sql`. So the
recorded `statements` are not the history. What was verified instead: the last definition of
each of the 63 functions these files create, in filename order, is byte-identical to live
(`md5(prosrc)`). Tables, triggers, policies and grants were **not** compared — that is CI's
`db-drift` job, which must pass on the PR before anyone trusts a rebuild.

Still on `shifts` despite the 11-03 handover saying otherwise: `template_id`, `timezone`,
`notes`, `required_skills`, `break_start`, `break_end`. `timezone` is load-bearing:
`check_in_shift`, `sm_clock_out_shift`, `process_shift_timers` and `is_shift_timesheet_reviewable` read it.

## Live data model

**`timesheets`** (13 cols) — attendance actuals only.
`shift_id` (unique), `employee_id`, `organization_id`, `clock_in`, `clock_out` (timestamptz),
`arrival_track` (`early_in | on_time | late_in | missing`), `departure_track`
(`early_out | on_time | late_out | missing`), `source` (`roster`, `mobile_gps`, `system_timer`,
`manager_override`), `worker_notes`.
`is_no_show` is a **generated** column: both tracks `missing`.

**`billables`** (31 cols) — manager verification and hours (no money since 20261103224126).
`shift_id` (unique), `timesheet_id` (unique, ON DELETE SET NULL), `employee_id`, `organization_id`.
`billable_start`, `billable_end`, `break_start`, `break_end` are **`time without time zone`**
(midnight crossing is resolved by `shift_minutes_after_start`, never by a stored flag).
`status` is `timesheet_status`, default `draft` (`draft | submitted | approved | rejected | no_show`).
`unpaid_break_minutes` nullable; `unpaid_break_is_manual` boolean default false;
`paid_break_minutes` not null default 0; `gross_length_minutes`, `net_length_minutes`,
`hours_source` are computed by `fn_billable_defaults_and_lengths` and stay NULL until the shift
has finished. Plus `version` (CAS), `edit_count`, `payroll_exported*`.

**`timesheet_breaks`** — one row per punched unpaid break.
`timesheet_id`, `shift_id`, `break_seq` (unique per timesheet), `break_start`, `break_end`,
`duration_minutes` (**generated**, rounded per break). `idx_unique_open_break` is a partial unique
index on `(timesheet_id) WHERE break_end IS NULL`: two open breaks are impossible.

## Row lifecycle (one place: `trg_sync_timesheets_on_shift_change`)

AFTER INSERT OR UPDATE OF `lifecycle_status, assigned_employee_id, is_cancelled, paid_break_minutes`.

- **Shift becomes live** (assigned, not Draft, not cancelled — on INSERT or UPDATE): create the
  timesheet (`source = 'roster'`, unpunched) and the billable (`draft`, linked, `paid_break_minutes`
  seeded from the shift, `unpaid_break_minutes` NULL). Idempotent; a surviving billable whose
  timesheet was deleted is relinked.
- **Shift stops being live**: delete the unpunched timesheet and the untouched draft billable. A
  billable with manager times is kept.
- **Reassigned**: `employee_id` follows on the unpunched timesheet and the draft billable.
- **Roster changes the paid break**: the draft billable follows only while it still equals the old
  scheduled value (a manager-set value is left alone).

"Live" rather than literally "on shift insert" because both `employee_id` columns are NOT NULL and a
Draft or unassigned shift has nobody to attribute attendance or pay to.

Consequences: a billable row existing means nothing about work done. Readers key on `clock_in`,
`status` or the review gate, never on existence. `updateTimesheetEntry` now refuses (returns
false) when there is no billable, instead of creating one.

## Attendance RPCs

- `check_in_shift(shift, lat, lon)` — assignee or `shift.edit`; window start −1h to start +12.5h;
  geofence (allowed locations, else venue within 100 m); tracks at ±7.5 min. Upserts the timesheet.
- `start_break_shift(shift, lat, lon)` / `end_break_shift(shift, lat, lon)` — assignee or
  `shift.edit`. **Location params are accepted and ignored** (no geofence on breaks). Refused before
  clock-in or after clock-out; a second open break returns an error, not an exception.
- `sm_clock_out_shift(shift, user, lat, lon)` — refuses while a break is open; geofenced; sets
  `departure_track`, `lifecycle_status = Completed`.
- `process_shift_timers()` — no auto clock-out. Marks `arrival_track = missing` at start, no-show at
  end (both tracks `missing`), `departure_track = missing` when clocked in past end.

## Unpaid break — the zero-fallback rule as implemented

In `fn_billable_defaults_and_lengths`, in order:

1. A billable break window (`break_start` + `break_end`) → manual; minutes = window length.
2. An explicit value (on INSERT, or a changed value on UPDATE) → manual.
3. Otherwise, while not manual: the sum of completed `timesheet_breaks`, or **NULL** if none.
   Never `shifts.unpaid_break_minutes`.

Net minutes deduct `COALESCE(unpaid_break_minutes, 0)`. A Security role (EBA Sch 3) has paid
meals: deducted break is 0. "Is Security" has one owner per side, kept in step:
`isSecurityRoleName` (`src/modules/compliance/security-role.ts`) and `public.role_name_is_security`
— name contains "security", except names starting "executive assistant" (user, 2026-11-04).
All ten former SQL copies call the helper.
`fn_sync_billables_on_timesheet_breaks` re-runs this on every break punch for non-manual,
non-exported billables.

The Timesheets editor always sends the break it displayed. `updateTimesheetEntry` writes
`unpaid_break_minutes` + `unpaid_break_is_manual` **only when the value differs** from the
billable's (`?? 0`). Before 2026-11-04 any save froze the break as manual.

## Function drift repaired 2026-11-04

Found by hashing live bodies against the repo:

- `preview_template_application` was **broken live** (referenced `template_subgroups.template_group_id`,
  which does not exist) and had **lost its authorization guard** (`sm_require_template_apply`) — a
  SECURITY DEFINER function any authenticated user could call. Restored from the repo.
- `sm_apply_shift_op` had lost half its audit diff (shift date, breaks, sub-department, display
  order). The repo copy still diffed the dropped `remuneration_level` and would have failed after a
  rebuild. Restored without that block.
- Four functions in `20261103104637` differed only by comments added after they ran; the file now
  matches what ran.

Lesson, again: edit a live function from `pg_get_functiondef`, never from an older file.

## Verification

Run on 2026-11-04 after the apply (see the PR for output):

```bash
npm run verify                                   # tsc + vitest + vite build
cd optimizer-service && python3 -m pytest tests/ # 231 passed
cd ml && python3 -m pytest                       # 60 passed
```

SQL suites run against Supabase and roll themselves back (they end with `RAISE EXCEPTION 'PASSED …'`):

- `supabase/tests/shift_creates_timesheet_and_billable.sql` — the pair's whole lifecycle.
- `supabase/tests/timesheets_billables_split.sql` — tracks, punches, lengths, export lock, cleanup.
  Column counts are 58 / 13 / 40.

Double-open-break check that actually runs (rolls back):

```sql
DO $$
DECLARE v_ts uuid; v_shift uuid;
BEGIN
  SELECT t.id, t.shift_id INTO v_ts, v_shift FROM public.timesheets t LIMIT 1;
  IF v_ts IS NULL THEN RAISE EXCEPTION 'SKIPPED: no timesheet row'; END IF;
  INSERT INTO public.timesheet_breaks (timesheet_id, shift_id, break_seq, break_start)
  VALUES (v_ts, v_shift, 900, clock_timestamp());
  BEGIN
    INSERT INTO public.timesheet_breaks (timesheet_id, shift_id, break_seq, break_start)
    VALUES (v_ts, v_shift, 901, clock_timestamp());
    RAISE EXCEPTION 'FAILED: two open breaks accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE EXCEPTION 'PASSED (rolled back): second open break refused';
END $$;
```

## Reviewed 2026-11-04

- **Shape engine ↔ DB parity** (`evaluateShiftShape` vs `shift_break_window_breach`): same
  containment formula across midnight, ordering with work between breaks, 30–60 min per window,
  15-minute increments, total = unpaid minutes. The app is stricter in two places (non-security must
  deduct the full window; paid rest pause in 15-minute steps — now also a DB CHECK).
- **Shift form**: the compliance-invalidation effect watched only the unpaid total, so moving a break
  without changing its length kept a stale "compliance has run" and let the save through. Fixed;
  pinned by `complianceInvalidatesOnBreakMove.test.ts`.
- **Attendance page / `useClockInOut`**: response schemas match the RPCs; break buttons only while
  clocked in; clock-out disabled with an open break; realtime works (`timesheet_breaks` is in
  `supabase_realtime`). `normalizeShiftRow` keys attendance on `clock_in` and `arrival_track`, so a
  pre-created unpunched timesheet reads as not checked in.
- **anon**: holds table SELECT on these tables like every other table here; RLS refuses it
  (`permission denied` on the policy helper). Same as the project's convention — not a hole.

## Open

- **Decided 2026-11-04 (kept):** each unpaid break window must be 30–60 min (DB and app agree), so
  a second short unpaid break (e.g. 15 min) cannot be rostered. It matches cl 36.1's single meal
  break; change both `shift_break_window_breach` and `evaluateShiftShape` together if the business
  later wants extra short unpaid breaks.
- The five backfilled ledger rows have no `statements`; their files are the only record.
- CI `db-drift` has not yet compared tables, triggers, policies and grants.

## Ground rules for this branch

- Never commit or push to `main`; no commit or push without the user's say-so; never `npm run ship`.
- Do not touch the user's untracked files: `docs/rulebook/attendance-rules.md`,
  `src/modules/rosters/domain/__tests__/attendance-rules.fixtures.json`,
  `src/modules/rosters/domain/__tests__/attendance-rules.fixtures.test.ts`.
- Confirm with the user before any write to Supabase.
