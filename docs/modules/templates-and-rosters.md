# Templates and rosters

How a template turns into roster sub-groups and shifts, and what the Roster Planner does with them. The rules below are enforced by the database (migration `20261017111129_template_roster_subgroup_integrity`); the UI only explains them.

## The one rule: a sub-group is its name

A template and a roster share no ids. Applying a template walks its groups and sub-groups and, on each day of each roster:

- maps the template group to a roster group by name (`Convention Centre` → `convention_centre`, …, `Office` → `office`);
- reuses the roster sub-group **with the same name in that group**, or creates it;
- adds the template's shifts for that weekday into it (`day_of_week` NULL means every day).

Because the name is the link, it is a key: trimmed, and unique case-insensitively within its group, on rosters and templates alike (unique index on `(group, lower(name))`). "AM Base" and "am base" are the same sub-group, so applying either lands in one row.

## Office has one sub-group: Administration

Every roster and every template has Office → Administration, and nothing else:

- new rosters and new templates are seeded with it; existing ones were backfilled;
- triggers on `roster_subgroups` and `template_subgroups` refuse any other name in Office and refuse deleting Administration directly (deleting a whole roster or template still works);
- the Planner shows no Rename / Clone / Delete for it, the "Add subgroup" dialog does not offer Office, and the template editor shows it as **Fixed**.

Templates still cannot hold full-time shifts (`enforce_no_ft_template_shifts`), so Office's Administration in a template holds part-time and casual shifts only.

## Applying a second template adds on top

Nothing is replaced. Applying template B over days that already have template A:

| B's sub-group | Result |
|---|---|
| Same name as one of A's (any case) | B's shifts go into the same row, next to A's |
| A new name | A new row appears in that group |

The only duplicate check is per template shift and day: re-applying the **same** template skips what is already there. A **different** template with an identical shift adds a second copy. So before writing, the Templates dialog asks the database what is already on those days (`preview_template_application`) and, if anything is, shows a confirmation listing the templates already applied, any hand-added shifts, how many of the new shifts duplicate existing ones (same sub-group, times and role), and that nothing is replaced. On empty days it applies straight away.

`p_force_stack` on `apply_template_to_date_range_v2` does **not** control stacking. It only allows creating shifts that have already started (always `false` from the UI). The name is historical.

**Undo** (Templates dialog → Recent applications) removes one application's shifts that have not started, and any sub-groups that leaves empty. Other templates' shifts and hand-added shifts are not touched. A confirmation shows the dry run first, and asks for a tick when assigned or published shifts would go.

## What each Planner view shows

Rows are the union of every sub-group on any day in view, so a sub-group that exists on only some days shows empty cells on the others.

| View | Rows come from | Notes |
|---|---|---|
| Group → Bucket View (default) | Roster structure + the per-day summary, keyed by (group, sub-group) | Sub-groups sorted A–Z within each group |
| Group → DnD | Roster structure + shifts | Row label lists the source templates ("A, B (+ manual)"). Each shift stays in its own group; until 2026-10-17 a sub-group name present in two groups put both groups' shifts under the first. |
| Roles | Shifts, by role | A cell's bucket summary is the first shift's sub-group, so with several sources feeding one role it is approximate |
| Day | Timeline | Shifts from every template side by side |

## Deleting, renaming and cloning a roster sub-group

From the sub-group's ⋯ menu in Group mode. Each acts on **one group of one sub-department's roster**, across the days in view, **from today on**:

| | Delete | Rename | Clone |
|---|---|---|---|
| Days before today | untouched (history) | keep the old name | not copied |
| Shifts that have started or been worked | kept; the sub-group stays on that day | renamed with their day's row | not copied |
| Other groups' same-named sub-groups | untouched | untouched | untouched |
| Needs | `roster.edit` + `shift.delete` | `roster.edit` | `roster.edit` + `shift.create` |
| Confirmation | dry-run counts; a tick when assigned or published shifts would go | dry-run review step; refused if the new name is already used on any day | dry-run review step; refused if the new name is taken |

The menu is disabled, with the reason shown, unless exactly one department and one sub-department are selected in the scope filter. With several, the grid merges their rows, and acting on one would quietly change one team and not the others.

Deleted shifts are deleted for good, and assigned staff are not notified. The confirmation says so.

## Capture (roster → template)

`capture_roster_as_template` reuses the new template's five seeded groups and makes one template sub-group per sub-group **name** across the range (it used to make one per roster day). It leaves out full-time shifts and reports how many.

## Where it lives

- Database: `supabase/migrations/20261017111129_template_roster_subgroup_integrity.sql`
- Client API (all with `dryRun`): `src/modules/rosters/api/rosterSubgroups.api.ts`
- Confirmation copy: `src/modules/rosters/ui/dialogs/rosterChangeCopy.ts`; dialog: `ImpactConfirmDialog.tsx`
- Shared rules (Office, name comparison): `src/modules/rosters/domain/subgroupRules.ts`
- HTTP tests: `tests/integration/flows/template-roster-subgroups.int.test.ts`
