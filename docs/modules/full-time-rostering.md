# Full-time rostering (since 2026-10-04)

Full-time (FT) shifts are rostered on the **Rosters page**, in the fixed group **Office**,
sub-group **Administration**. Employees see them on **My Roster** like any other shift. The
separate Office page is gone; `/office` redirects to `/rosters`.

History and the decisions behind this: `docs/handover/2026-10-04-ft-roster-handover.md`.
What can remove a shift: `docs/modules/shift-removal-pathways.md`.

## The rules, and where each is enforced

FT rules key off `shifts.target_employment_type = 'FT'`, **not** the group: an FT shift in any
group is protected. The database enforces; the UI mirrors so actions that would fail are not
offered.

| Rule | Database | UI |
|---|---|---|
| Publish an assigned FT shift → **Confirmed** (S4) directly; no offer | `sm_publish_shift`, `sm_bulk_publish_shifts` | Publish dialog: "Full-time · Confirmed directly" |
| An unassigned FT shift is never published (never bidding) | same (refused / skipped) | Publish dialog: "Full-time · nobody on it" |
| Never bidding, trading, cancelled or unassigned | `trg_full_time_shift_rules` | Add Shift save gate refuses to empty the employee; My Roster hides Swap/Drop |
| **One shift per FT person per day** (cl 39.1) | `trg_shift_ft_one_per_day` | Add Shift form: `FT_ONE_SHIFT_PER_DAY` before Save |
| Cycle ceiling (cl 35.1(a), 38/76/114/152 over the declared cycle) | — | Add Shift form: V8 `ordinary-hours-avg` with the employee's declared cycle; blocks the save |
| **No assigned shift on an approved-leave day** — not created, assigned, moved onto or published (all employment types) | `trg_shift_not_on_approved_leave`; `sm_bulk_publish_shifts` skips them | Add Shift form: `V8_LEAVE_CONFLICT`; publish dialog: "On approved leave" (skipped) |
| A started shift is never deleted (D4) | `fn_prevent_locked_shift_modification` | Menus show "Delete (Started)" disabled |
| Templates hold no FT shifts | `trg_no_ft_template_shifts` | Template editor defaults to Casual |

BEFORE triggers on `shifts` fire in **name order**. `trg_full_time_shift_rules` runs before
`trg_shift_employment_target_1_resolve`, so a template-applied row is not yet FT there; any new
per-row FT rule must sort after the resolver (as `trg_shift_ft_one_per_day` does).

## The Office group

- Fifth fixed group: enum value `office`, colour cyan (`#06b6d4`), seeded on every roster with an
  Administration sub-group (`seed_standard_roster_groups`) and on every template
  (`fn_seed_fixed_template_groups`).
- Client: `ALL_GROUP_TYPES` / `GROUP_DISPLAY_NAMES` / `GROUP_COLORS` in
  `src/modules/rosters/domain/projections/constants.ts`. `office-group.test.ts` fails if a file
  that handles The Cutaway does not also handle Office.
- The Add Shift form offers FT — and starts as FT — only when the shift is in the Office group
  (`targetEmploymentTypeOptions`, `initialTargetEmploymentType`, `FULL_TIME_GROUP_TYPE` in
  `src/modules/core/model/employment.types.ts`).

## Rosters page features for FT shifts

| Feature | Where | Code |
|---|---|---|
| Copy to… a range (leave, existing shifts, writable rosters, cycle ceiling checked for the range) | Group mode ⋯ menu | `src/modules/office/ui/components/CopyShiftFlow.tsx` |
| Expand: Scheduled · Actual · Payroll · Variance; "Not priced" instead of a default rate | Group and People mode ⋯ menu | `src/modules/rosters/ui/dialogs/ShiftExpandDialog.tsx` |
| Delete states the hours removed from the cycle | Group mode delete dialog | `GroupModeView.tsx` |
| Leave card on approved-leave days; day closed to rostering (all employment types) | People mode | `useApprovedLeaveDays.ts`, `LeaveDayCard.tsx` |

## Leave

Approving leave (`approveLeaveRequest`, D7): FT shifts in the range are **deleted**; PT/Casual
shifts are **unassigned** (Published → Bidding); shifts that have started are kept and reported.

## The `office` module

No page. It holds what Rosters uses: the cycle ledger (`computeProposal` in
`api/office.commands.ts`), the Copy-to flow and dialog (`ui/components`), the leave loader
(`api/office.loaders.ts`), the hooks behind them, and the pure domain (`domain/*`).
