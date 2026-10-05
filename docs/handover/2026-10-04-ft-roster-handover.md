# Handover — Full-time roster on the Rosters page (2026-10-04)

Start the next session by reading this file, then `docs/modules/shift-removal-pathways.md`.
Production project: **srfozdlphoempdattvtx**. Branch: `feat/baseline-ft-schedule` (all work below
is **uncommitted**).

---

## 1. Decisions already made (do not re-open)

| # | Decision |
|---|---|
| D1 | Employees see shifts on **My Roster** only — same page for every employment type. |
| D2 | Full-time (FT) shifts live on the **Rosters page** in a new fixed group **Office**, sub-group **Administration**. The separate Office page is retired at the end. |
| D3 | FT shifts follow the **same state machine** with an FT branch: publish assigned → **Confirmed directly** (no offer); never bidding, trading, cancelling or unassigning. **(Applied.)** |
| D4 | Shift deletes are **permanent**; a shift whose start (Sydney) has passed is **never** deleted — except when a user is purged from the database. **(Applied.)** |
| D5 | **All auditing removed** until the feature set is frozen. `shift_events` is **kept** — KPI, Performance, scorecard and cancellation reports read it. **(Applied.)** |
| D6 | Deleting a whole section (sub-group/template/roster) that contains past shifts is refused. Users are deleted from the database only, with everything of theirs. **(Applied.)** |
| D7 | Leave approval: FT → delete future shifts; PT/Casual → unassign (Published → Bidding); started shifts kept and reported. **(Applied in app.)** |

FT rules key off `shifts.target_employment_type`, **not** the group: an FT shift in any group is protected.

---

## 2. State at handover

### Applied to production (via MCP `apply_migration`, each verified with a rollback probe)
| Migration | What it does |
|---|---|
| `20261004120000_shift_deletion_permanent_and_no_audit.sql` | D4–D6 and the FT row rules. `fn_prevent_locked_shift_modification` (BEFORE DELETE past-guard; bypass GUC `app.shift_purge='user'`), CHECK `shifts_no_soft_delete`, trigger `trg_full_time_shift_rules`, `_can_manage_shifts()`, `sm_delete_shift(id, user, reason, expected_version)`, per-item hard `sm_bulk_delete_shifts`, DB-only `delete_user_entirely`. Dropped: archive, leave/timesheet audit tables, cleanup cron, test harness. Probe 8/8. |
| `20261004140000_ft_publish_confirms_directly.sql` | D3 at publish. `sm_publish_shift` + `sm_bulk_publish_shifts`: FT assigned → S4 Confirmed; FT unassigned → refused (single) / skipped (bulk). Probe: single → S4, bulk 3/3 → S4, no offer sent. |
| `20261004160000_template_group_type_add_office.sql` | Phase 2, alone: `ALTER TYPE template_group_type ADD VALUE 'office'`. |
| `20261004170000_ft_shifts_created_on_rosters.sql` | Phase 3 / landmine 1. Dropped `enforce_ft_shifts_are_baseline_only` (it checked a label, not the shift). Added `trg_shift_ft_one_per_day` — an assigned FT shift is refused when the person already holds any live shift that date (cl 39.1); advisory-locked per person+day; named to fire AFTER the target resolver. Index `idx_shifts_employee_date`. Probe: before → "created by Baseline FT"; after → manual FT created in Office, 2nd same-day refused, move-onto-day refused, re-save OK. |
| `20261004160100_office_fixed_group.sql` | Phase 2. Allow-list, both seed triggers (rosters → 5 groups + Office/Administration; templates → Office), `add_roster_subgroup_range` ×2, `apply_template_to_date_range_v2` CASE, backfill (405 rosters, 1 template), FT shifts moved, empty CC/Administration sub-groups removed. Long bodies verified byte-identical to prod + the office branch (md5). Probe 18/18. |

### App (uncommitted, tsc clean, all tests pass)
- Leave pages redesigned (pastel bento cards, centred dialogs, Ledger | My Leaves toggle) — My Leave + Leave Approvals.
- Office card: compact face + ⋯ (Expand/Copy/Delete) + expand modal (`SharedShiftCard sectionLayout="columns"`: 3 equal panes + Variance full width).
- Audit UI removed; Delete User UI removed; publish no longer deletes started shifts; roster delete →
  `sm_delete_shift` with version; bulk delete reports per item; leave approval per D7; My Roster hides
  Swap/Drop on FT; Office hides Delete once a shift has started.
- Publish dialog (`planPublishRoster`) has **Full-time · Confirmed directly** (`fullTimeIds`) and
  **Full-time · nobody on it** (`fullTimeUnassignedIds`, skipped).

### Data
- The user cleared the database except **James Smith** (`test1@test.com` / `test1`,
  id `3a606351-e93f-44b6-b700-078f108ef80a`, wholly FT): **25 shifts, 2–29 Oct, all Draft**, in
  *Office → Administration* (moved from *Convention Centre → Administration* in Phase 2),
  `creation_source='baseline_ft'`.
  - 22 future (deletable). 3 started (2–4 Oct) — cannot be deleted by any app path (D4).
  - Approved annual leave 5–9 Oct (balance 149.7h); the 5 shifts on those days still exist.
- He sees nothing on My Roster because they are Draft — My Roster loads only `Published/InProgress/Completed`
  (`src/modules/rosters/api/shifts.queries.ts:499, :602`). Publishing them from **Rosters → Office →
  Administration** now confirms them directly (Phase 1).
- Kurry Admin holds FT + Casual contracts → not "wholly FT" → excluded from the Office grid by design.

---

## 3. Landmines (verified)

1. *(Resolved by Phase 3 — 20261004170000.)* **`enforce_ft_shifts_are_baseline_only`** (trigger `trg_ft_shifts_are_baseline_only`, BEFORE INSERT OR
   UPDATE OF `target_employment_type, creation_source`) **raises** unless an FT row has
   `creation_source='baseline_ft'`. Creating FT shifts from the Rosters page fails until Phase 3 resolves it.
2. *(Resolved by Phase 2 — kept for the next group.)* **Roster groups are fixed and enforced in many places** (memory `roster-four-fixed-groups.md`):
   enum `template_group_type` (`ALTER TYPE … ADD VALUE` must be its **own** migration), trigger
   `enforce_exactly_three_groups` (allow-list), `protect_fixed_roster_groups`, `fn_seed_fixed_template_groups`,
   `apply_template_to_date_range_v2` CASE (an unknown group **raises** by design), ~15 client colour maps
   (each needs an `office` branch or cards fall back to purple). Adding **Office** touches all of them.
3. Started shifts cannot have schedule fields changed (`fn_prevent_locked_shift_modification`). A
   **single** publish of a started Draft still succeeds (pre-existing, all types); bulk skips `PAST`.
4. Offer / decline / reject / offer-expiry functions were **not** changed: FT shifts are no longer offered,
   and an FT unassign is refused by `trg_full_time_shift_rules` anyway.
5. **Never `supabase db push`** (history drift). Apply single migrations via MCP `apply_migration`; run
   `get_advisors` after; verify with a `DO … RAISE EXCEPTION 'ROLLBACK_PROBE …'` block.
6. Type-check is `npx tsc -p tsconfig.app.json --noEmit` (bare `tsc` compiles nothing). ESLint is broken.

---

## 4. Phased plan

### Phase 1 — FT branch of the state machine · ✅ DONE 2026-10-04
See §2. **Remaining check (manual):** publish James's shifts from Rosters, then sign in as James — they
must appear on My Roster as Confirmed, with no offer and no Swap/Drop.

### Phase 2 — "Office" fixed group with "Administration" sub-group · ✅ DONE 2026-10-04
- DB: migrations `20261004160000` + `20261004160100` (see §2). Every roster now has five groups and an
  Office → Administration sub-group; new rosters and templates seed them; "Add sub-group" and template apply
  accept `office`. James's 25 shifts are in Office → Administration.
- Client: `TemplateGroupType` + generated enum; canonical `projections/constants.ts` (cyan `#06b6d4`); ~35
  per-file maps; `dept-*-office` CSS (light + dark). `GroupModeView` and `getGroupsModeGrid` now read
  `ALL_GROUP_TYPES` / `GROUP_DISPLAY_NAMES` instead of literal lists — the old lists typed an unknown group as
  `convention_centre` and NAMED it "Theatre". Office page (`rosterTarget.ts`) now writes to `office`.
- Office is decided by the GROUP only (`resolveGroupVariant`, timesheet card): "office" is too common in role
  and department names ("Box Office") to infer from free text.
- Test: `src/modules/rosters/domain/__tests__/office-group.test.ts` — enum parity with `types.ts`, naming,
  theming, and a guard that any file handling The Cutaway also handles Office. Each assertion mutation-tested.
- Also fixed on the way: `seed_standard_roster_groups` never seeded The Cutaway (3 rosters lacked it);
  template editor / subgroup cards had no Cutaway colour.
- **Not verified in the browser** (needs a manager login): Office/Administration in each roster mode.

### Phase 3 — Bring the Office page's FT behaviour into Rosters · ✅ DONE 2026-10-04
Done:
- **Landmine 1** — migration `20261004170000` (see §2). FT shifts can be created from Rosters.
- **Add Shift form**: FT is offered — and the form starts as FT — when the shift is in the Office group
  (`targetEmploymentTypeOptions(…, { allowFullTime })`, `initialTargetEmploymentType`,
  `FULL_TIME_GROUP_TYPE` in `core/model/employment.types.ts`). Elsewhere PT/Casual only.
- **Cycle checks** — already in the form: `fetchV8EmployeeContext` supplies the DECLARED cycle (weeks + anchor
  from the contract) and the form loads ±35 days of shifts; V8 `ordinary-hours-avg` blocks at the ceiling and
  compliance must pass to save. Same modal the Office page used, so no protection is lost.
- **One shift per day (cl 39.1)** — DB trigger + form pre-check (`FT_ONE_SHIFT_PER_DAY` in
  `compliance/prevalidation.ts`), shown before Save.
- **FT never left unassigned** — save gate refuses to empty an FT shift's employee (the edit save is not atomic:
  the field edit is written before the unassign op, so a DB refusal would half-save).
- **Copy to…** on an assigned FT shift in Group mode (⋯ menu). The flow was lifted out of `OfficePage` into
  `office/ui/components/CopyShiftFlow.tsx` — both pages render it. Refuses (with a reason) when the employee
  has no ledger in the team's FT world, since the cycle ceiling then cannot be checked.
- **Delete** in Group mode: FT shifts state the cycle consequence (as Office did); started shifts show
  "Delete (Started)" disabled (D4).
- Fixed on the way: Group-mode **Clone failed for every shift** (sent no `target_employment_type`, mandatory
  since August); a "Validation Failed" toast printed `[object Object]`.
- Tests: `core/model/__tests__/ftShiftCreation.test.ts` (replaces `ftShiftsAreBaselineOnly`),
  `office/ui/__tests__/CopyShiftFlow.test.tsx`. All mutation-tested.

Finished the same day (design calls made):
- **Leave cards** → **People mode** (a row per person, as the Office grid was): approved leave shows a leave
  card and closes the day to rostering, for every employment type; a shift still rostered on a leave day is
  flagged. `rosters/hooks/useApprovedLeaveDays.ts`, `rosters/ui/components/LeaveDayCard.tsx` (moved from Office).
- **Card** → the roster keeps its own card face (it names the employee; the Office face could omit the name
  because every Office row WAS one employee). The Office card's **Expand** view moved to
  `rosters/ui/dialogs/ShiftExpandDialog.tsx`, offered from the ⋯ menu on FT shifts in Group and People mode.
- Clone fixed in **all four** roster modes (People, Roles, Events had the same missing-target bug as Group).

### Phase 4 — Retire the Office page · ✅ DONE 2026-10-04
- `/office` **redirects to `/rosters`**; sidebar entry, mobile-allowlist entry and `nav.office` strings removed.
- Deleted: `OfficePage`, `OfficeWeekGrid`, `OfficeShiftCard`, `OfficeLedger`, `FindingList` and their tests.
- Kept (Rosters uses them): `office/{domain,api,hooks}`, `office/ui/components/{CopyShiftFlow,CopyShiftDialog}`.
- Tests that pinned shared code moved next to it: `rosters/ui/components/__tests__/navigatorViews.test.tsx`,
  `rosters/ui/dialogs/EnhancedAddShiftModal/__tests__/callerContract.test.ts`.
- Docs: `docs/modules/full-time-rostering.md` (indexed in `docs/modules/README.md`).

### Phase 5 — Verify end to end · ✅ DONE 2026-10-04 (database, as the real roles)
Rolled-back probes in production, run as `authenticated` with the manager's (Kurry Admin, epsilon) and James's
JWT — so RLS and the definer RPCs behave exactly as for the app. Every assertion passed:
- Manager: publish James's FT shift → **Published / confirmed / S4**; create an FT shift as the Rosters form
  sends it (`creation_source='manual'`) → lands in **Office / Administration**; a second that day → refused
  (cl 39.1); unassign through the gateway → refused (FT); delete a started shift → `SHIFT_STARTED`; delete a
  future FT shift (the leave-approval path, D7) → deleted.
- James: the My Roster query returns the shift as **Published / confirmed / office**; dropping it → refused;
  `check_in_shift` → checked in; `sm_clock_out_shift` → clocked out; the Timesheets query reads it as
  **Completed** with both clock times.
- Production verified unchanged afterwards (25 FT Drafts in Office, no stray events).
- NOT done: a visual pass in the browser (needs a manager login). Probe artefact worth knowing: several RPCs in
  ONE transaction collide on `uniq_shift_event (shift_id, employee_id, event_type, event_time=now())` — not a
  production bug (each app action is its own transaction).

## 5. Still open (not in the phases)
- **Shifts on approved leave (found 2026-10-04, after Phase 5).** James's 5–9 Oct shifts survived his leave
  approval (approved 3 Oct 21:06 UTC — `sm_delete_shift` was still broken; fixed 22:01 UTC) and the 5 Oct one was
  then published: publish ran no leave check and the DB had none. Fixed by `20261004180000_no_shift_on_approved_leave`
  (guard trigger + bulk-publish skip) and an "On approved leave" group in the publish dialog. The 5 conflicting
  shifts were **deleted** on the user's instruction (D7).
- **Consistency pass (2026-10-04).** Every shift audited (0 violations) and three guards added in
  `20261004190000_shift_consistency_guards`: placement (`trg_shift_placement` — also fixes cross-day drags, which
  failed in People mode and drifted in Group mode), assignee ⇔ status CHECK, no overlapping shifts (checked at
  commit). Full list and remaining gaps: `docs/modules/shift-integrity.md`.
- **`roster_groups` / `roster_subgroups` RLS is `ALL … USING (true)` for `authenticated`** — any signed-in
  user can rename or delete any group/sub-group in any org (shifts' NOT NULL FK stops it only where shifts
  exist). Found in Phase 2, not changed.
- `protect_fixed_roster_groups` is attached to **no trigger** — fixed group names are not actually protected.
- Template "Set-up full-time baseline" (draft) has a non-standard group **Baseline** (5 template shifts);
  applying it raises by design. Remove with the Office page in Phase 4.
- **James's data:** decide whether to keep his 25 shifts for testing or clear the 22 future ones. The 3
  started ones (2–4 Oct) can only go through a deliberate database override of D4 — ask the user first.
- James's 5 shifts under approved leave (5–9 Oct) remain; deleting them from the UI is the D7 test case.
- **James's test data is over the cycle ceiling**: 25 shifts × 8.1h in 4 weeks (six to seven days a week,
  incl. Sun 4 Oct) ≈ 200h against 152h. The Add Shift form will now BLOCK further FT shifts for him in that
  cycle — expected, not a bug.
- `shifts.deleted_at` is forced empty but still read by many queries — remove in a cleanup pass.
- Delete permission is org-wide (same as every manager write), not department-scoped.
- ~~Review the two rebuilt `leave.api.ts` functions~~ — reviewed 2026-10-04 against prod: columns, leave-type
  values and RLS all match.
- **`sm_create_shift` and `sm_publish_shift` have no authorisation check** (SECURITY DEFINER; only
  `sm_delete_shift` calls `_can_manage_shifts()`), and `profiles` is readable by every authenticated user
  (`profiles_select_all USING (true)`). Pre-existing; found in Phase 5.
- Commit the branch (nothing from this session is committed). `graphify update .` refuses to overwrite the
  4-layer graph — let the post-commit hook rebuild it.

## 6. Key files
- DB: `supabase/migrations/20261004120000_shift_deletion_permanent_and_no_audit.sql`,
  `supabase/migrations/20261004140000_ft_publish_confirms_directly.sql`
- Removal map: `docs/modules/shift-removal-pathways.md`
- My Roster query: `src/modules/rosters/api/shifts.queries.ts`
- Publish: `src/modules/rosters/api/shifts.commands.ts` (`publishShift`, `bulkPublishShifts`),
  `src/modules/rosters/domain/bulk-action-engine.ts`, `src/modules/rosters/ui/components/PublishRosterButton.tsx`
- Office (to migrate): `src/modules/office/**`
- Leave: `src/modules/leave/**`
