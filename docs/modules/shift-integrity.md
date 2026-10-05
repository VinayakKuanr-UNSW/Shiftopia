# Shift integrity — what the database guarantees (2026-10-04)

Every rule below is enforced in the database, so it holds for every path: the app, an RPC, a
cron job, a direct write. The UI mirrors some of them so an action that would fail is not
offered. Audited against production (`pg_constraint`, `pg_trigger`, function bodies), not
against migration files.

**State at writing: 20 shifts, 0 violations of every rule below.**

## Placement — where a shift lives

| Guarantee | How |
|---|---|
| A shift sits in **its team's roster for its date** | `trg_shift_placement` — re-points `roster_id` when the date (or team) changes; refuses a date with no roster (`NO_ROSTER_FOR_DATE`) |
| Its sub-group is **on that roster** | same — keeps an explicitly chosen sub-group on that roster, else finds (or creates) the same group + sub-group name there |
| `group_type`, `sub_group_name`, `shift_group_id` **are the sub-group's** | same — the labels the planner groups by are always derived from the structural link |
| Its organisation is its roster's; `organization_id` is never null | same (`ROSTER_SCOPE_MISMATCH`), plus `NOT NULL` |
| One roster per team per day | unique index `uk_rosters_date_dept_subdept` |
| Every roster has the five fixed groups | `seed_standard_roster_groups`, allow-list `enforce_exactly_three_groups` |
| Nothing references a shift that is gone | every `shift_id`-style column (25) has a foreign key |

`trg_shift_placement` is why a cross-day drag works in both Group and People mode: before it,
`sm_move_shift` changed the date but never the roster (and a date-only move nulled the sub-group
and failed).

## People and time

| Guarantee | How |
|---|---|
| `assigned_employee_id` is set **exactly** when `assignment_status = 'assigned'` | CHECK `shifts_assignee_matches_status` (and `compute_shift_fields` derives the status) |
| One person never holds **two overlapping** live shifts | `trg_shift_no_overlap` — a constraint trigger checked **at commit**, so a swap's mid-step is not judged (`SHIFT_OVERLAP`) |
| No assigned shift is created on, assigned to, moved onto or **published** on an **approved-leave** day | `trg_shift_not_on_approved_leave` (`ON_APPROVED_LEAVE`); `sm_bulk_publish_shifts` skips them |
| The assignee's contract matches the shift's target employment type | `trg_shift_employment_target_2_enforce` |
| A started shift's schedule cannot change, and it is never deleted | `tr_lock_past_shifts` (`fn_prevent_locked_shift_modification`) |
| No soft deletes | CHECK `shifts_no_soft_delete` |

## Full-time

| Guarantee | How |
|---|---|
| Publish assigned → Confirmed directly; unassigned never published | `sm_publish_shift`, `sm_bulk_publish_shifts` |
| Never bidding, trading, cancelled or unassigned | `trg_full_time_shift_rules` |
| One shift per FT person per day (cl 39.1) | `trg_shift_ft_one_per_day` |
| Templates hold no FT shifts | `trg_no_ft_template_shifts` (on `template_shifts`) |

## Shape and state

- Shape (net > 0, ≤ 12h, FT ≥ 7.6h, min engagement, PT min engagement, meal break, rest pause,
  start ≠ end): `shifts_shape_*` CHECKs; day-typed rules: `trg_shift_shape_3_day_typed`.
- State: `validate_shift_state_invariants` (outcome null when unassigned; InProgress/Completed
  require assigned; Published + unassigned must be bidding); `valid_assignment_outcome`;
  `chk_bidding_requires_unassigned`; enums for lifecycle, assignment, trading, bidding.
- Target employment type mandatory and from a fixed set: `fn_shift_inherit_template_row`,
  `shifts_target_employment_type_check`, `shifts_target_flexible_requires_pt_check`.

## Known gaps (not enforced)

| Gap | Why not (yet) |
|---|---|
| `is_on_bidding` vs `bidding_status` can disagree | three writers set only one of the two (`assign_shift_employee`, `push_shift_to_bidding_on_cancel`, `sm_expire_offer_now`) — fix the writers first |
| Duplicate template instances under concurrent applies | a unique `(roster_id, template_instance_id)` would also block dragging a templated shift onto a day that has its own copy |
| `sm_create_shift` / `sm_publish_shift` have no authorisation check | SECURITY DEFINER; only `sm_delete_shift` checks `_can_manage_shifts()` |
| `roster_groups` / `roster_subgroups` writable by any signed-in user | RLS `ALL USING (true)` |
| `sm_update_shift` (both overloads) fails on every call | references a dropped column `remuneration_level_id`; no caller in the app |
| `shifts.deleted_at` still exists (always null) | readers to remove in a cleanup pass |

Migrations: `20261004120000` (deletes, FT rules), `20261004140000` (FT publish),
`20261004170000` (FT one-per-day), `20261004180000` (approved leave), `20261004190000`
(placement, assignee/status, overlap).
