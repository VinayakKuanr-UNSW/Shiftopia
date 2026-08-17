# The Shared Calendar System

**Status:** implemented 2026-08-06 · gates green (type-check, 1822 vitest, build)
**Scope:** every calendar, date picker, month view, week axis and range picker in the application

---

## 1. Why this existed as a problem

There were **eight** calendar implementations and **four** date-range pickers. They
did not merely duplicate code — they disagreed:

| Disagreement | Evidence |
|---|---|
| Week start | `AvailabilityCalendar`, `RosterMonthView`, `RosterWeekView`, `CalendarView` started on **Sunday**; `ImprovedAvailabilityCalendar` did so *explicitly* (`weekStartsOn: 0`). The rest started on Monday. |
| Month padding | Four grids padded unconditionally to **42 cells**, so a 35-day month rendered a phantom sixth week. |
| Public holidays | **Three** rival sources — see §2. |
| Keyboard access | Every hand-rolled grid used `<div onClick>` cells. None was reachable by keyboard. |
| Range display | No range picker actually showed a range: `CustomDateRangePicker` was two independent single-date popovers, `templates/DateRangePicker` was two stacked calendars. |

The root cause is structural: `date-fns` defaults `weekStartsOn` to `0`, and
nothing in the codebase made the Australian convention un-forgettable. Every new
grid was a fresh chance to get it wrong, and roughly half did.

---

## 2. The three rival public-holiday sources (a correctness finding)

This surfaced during the audit and is the most consequential thing the refactor
fixed. It is not only a calendar concern.

| Source | Used by | Defect |
|---|---|---|
| `core/lib/holidays.ts` — `date-holidays` AU/NSW | Calendar primitive, payroll, leave | **Correct.** Unbounded years, includes NSW substitute days. |
| `core/lib/date.utils.ts#isPublicHoliday` — hard-coded 2026 list | **V8 compliance engine** (`v2-to-v8.ts`), shift-form minimum-engagement floor | Returned `false` for Good Friday, Easter, Anzac Day, King's Birthday and Labour Day in **every year except 2026**. Also omitted the NSW substitute days — Mon 27 Apr 2026 (Anzac) and Mon 28 Dec 2026 (Boxing Day) — which do attract public-holiday penalty rates. |
| `core/lib/anz-holidays.ts` — 2025–2027 dictionary | **Roster Planner grid** (`GroupModeView`, `RolesModeView`, `PeopleModeGrid`) | Contained **New Zealand** holidays — Waitangi Day, Matariki, NZ Labour Day — marked as public holidays on a Sydney roster. Expired entirely after 2027. |

**Resolution.** `holidays.ts` is now the only source. `date.utils.ts#isPublicHoliday`
re-exports it (deprecated, so existing call sites keep working);
`anz-holidays.ts` is deleted and its three live consumers repointed.

The compliance-side consequence is worth stating plainly: `is_public_holiday`
reaching the V8 engine was wrong for two 2026 dates and would have been wrong for
every moving holiday from 1 Jan 2027. That is now fixed as a side effect, but it
is a payroll-adjacent behaviour change and should be treated as one.

`holidays.ts` also gained a per-year memo, because `date-holidays#isHoliday`
recomputes a year's rule set on every call and a month grid asks 42 times per
render.

---

## 3. Architecture

```
src/modules/core/lib/date/week.ts        pure date math — Monday baked in, no options to forget
src/modules/core/lib/holidays.ts         the only NSW public-holiday source

src/modules/core/ui/primitives/calendar.tsx   the ENGINE (react-day-picker), two sizes
src/modules/core/ui/calendar/
  ├── index.ts             the public barrel — features import from here
  ├── DatePicker.tsx       pick one day
  ├── DateRangePicker.tsx  pick a span
  ├── MonthGrid.tsx        a month VIEW with domain content per cell
  └── WeekStrip.tsx        a Mon–Sun day axis for timeline views
```

### The key design decision

There are three *shapes* of calendar, not one, and collapsing them naively is why
previous attempts fragmented:

1. **Pickers** — 40px day buttons in a popover.
2. **Month views** — tall cells containing domain content (shift chips,
   availability state, a preview swatch).
3. **Week views** — an hour-by-hour timeline, 24 rows × 7 columns.

Shapes 1 and 2 are the **same engine** at different scales. `react-day-picker`
renders a `<table>` whose rows and cells are styled with flex, so `surface` size
simply lets those cells stretch to their container. A 120px-tall cell with three
shift chips is legal.

Shape 3 is **not** a `react-day-picker` surface, and pretending otherwise would
have meant reimplementing a timeline inside a day picker. What it genuinely
shares is the *day axis* — which seven days, in what order, which is today, which
are holidays. That is `WeekStrip`, and `TimeGrid` now renders it.

### `MonthGrid` interaction model

Each day is a real `<button role="gridcell">` carrying the cell's accessible
name. That gives Enter/Space activation and, via `useDayRender`, the full
`react-day-picker` roving-tabindex and arrow/Home/End/PageUp/PageDown model.

`renderDay` content is therefore **presentational** — a `<button>` cannot legally
contain another focusable element.

When a surface genuinely needs several interactive targets per cell (My Roster's
shift chips), `renderOverlay` renders them as a **sibling** of the day button
inside the same cell:

- mouse behaviour is unchanged — chips stay individually clickable;
- the day button remains the single keyboard entry point, opening a day detail
  that lists the same items;
- the DOM stays valid.

The wrapper carries `role="presentation"` so the `row → gridcell` ownership chain
survives. (An unlabelled `div` between them severs it and screen readers drop the
cells from the table model — the same defect the Roster Planner audit logged as
H1.)

---

## 4. Components created

| Component | Purpose |
|---|---|
| `core/lib/date/week.ts` | `startOfWeekAU`, `endOfWeekAU`, `getWeekDays`, `getMonthGridDays`, `getMonthGridWeeks`, `getWeekdayIndexAU`, `isWeekend`, `WEEKDAY_LABELS`, `WEEK_STARTS_ON`, `AU_WEEK_OPTIONS`. No options parameter, so there is nothing to forget. |
| `core/ui/calendar/MonthGrid.tsx` | Month view with `renderDay` / `renderOverlay` / `dayLabel` / `dayModifiers` slots. |
| `core/ui/calendar/DatePicker.tsx` | Single-date popover. Supports a custom trigger, caption dropdowns, and modifier passthrough. |
| `core/ui/calendar/DateRangePicker.tsx` | One `mode="range"` grid, optional presets sidebar, responsive 1↔2 months. |
| `core/ui/calendar/WeekStrip.tsx` | Mon–Sun day axis for timeline views. |
| `core/ui/calendar/index.ts` | The barrel features import from. |

**Extended:** `core/ui/primitives/calendar.tsx` — added `size: 'popover' \| 'surface'`,
Mon/Tue/Wed weekday labels, holiday names in the accessible name (WCAG 1.4.1),
`focus-visible` rings, `motion-safe:` on the hover scale, and contrast fixes for
outside/disabled days (`text-muted-foreground/40 opacity-50` computed to ≈2.3:1
against the dark surface, failing 1.4.3).

---

## 5. Components deleted

| File | Was it live? |
|---|---|
| `availability/ui/calendar/AvailabilityCalendar.tsx` | dead (0 importers) — Sunday-start |
| `availability/ui/calendar/ImprovedAvailabilityCalendar.tsx` | dead — explicit `weekStartsOn: 0` |
| `rosters/ui/components/RosterCalendar.tsx` | dead |
| `rosters/ui/views/RosterMonthView.tsx` | dead (only `RosterCalendar` used it) — Sunday-start |
| `rosters/ui/views/RosterWeekView.tsx` | dead — Sunday-start |
| `rosters/ui/components/CalendarView.tsx` | dead — Sunday-start |
| `rosters/ui/components/CalendarRangePicker.tsx` | **live** → replaced by `DatePicker` |
| `core/ui/components/CustomDateRangePicker.tsx` | **live** → replaced by `DateRangePicker` |
| `core/ui/primitives/date-range-picker.tsx` | dead (0 importers) |
| `templates/ui/components/DateRangePicker.tsx` | dead (0 importers) |
| `core/lib/anz-holidays.ts` | **live** → replaced by `holidays.ts` |

**Dependency removed:** `react-datepicker` — declared in `package.json`, imported
by nothing.

---

## 6. Files updated

**Migrated to `MonthGrid`**
- `availability/ui/panes/CalendarPane.tsx` — four-state model preserved as modifiers
- `rosters/ui/my-roster/MonthView.tsx` — mobile and desktop, `renderOverlay` for chips
- `rosters/ui/dialogs/RosterTemplatesDialog.tsx` — range preview, now one grid per month spanned

**Migrated to `DatePicker` / `DateRangePicker`**
- `rosters/ui/components/UnifiedRosterNavigator.tsx` (both variants)
- `core/ui/components/UnifiedModuleFunctionBar.tsx`
- `rosters/ui/components/RosterHeader.tsx`
- `timesheets/ui/components/TimesheetHeader.tsx`
- `rosters/pages/MyRosterPage.tsx`

**Migrated to `WeekStrip`**
- `rosters/ui/components/TimeGrid.tsx`

**Week math repointed to the AU helpers (17 files)**
`insights/hooks/useDateRange` · `payroll/ui/GrossPayPage` ·
`planning/bidding/.../EmployeeBids.page` · `planning/swapping/.../EmployeeSwaps.page` ·
`rosters/hooks/useMyRoster` · `rosters/hooks/useRosterView` · `rosters/pages/AttendancePage` ·
`rosters/pages/MyRosterPage` · `rosters/pages/RostersPlannerPage` · `rosters/state/useRosterStore` ·
`rosters/ui/dialogs/CentralAddSubGroupDialog` · `rosters/ui/dialogs/RosterTemplatesDialog` ·
`rosters/ui/modes/GroupModeView` · `rosters/ui/modes/RolesModeView` ·
`rosters/ui/my-roster/WeekView` · `timesheets/ui/TimesheetPage` ·
`core/ui/components/UnifiedModuleFunctionBar`

**Holiday source repointed**
`compliance/v8/adapters/v2-to-v8` · `rosters/.../ScheduleStep` ·
`rosters/ui/modes/{GroupModeView,RolesModeView,PeopleModeGrid}` ·
`rosters/ui/dialogs/.../useShiftFormOrchestrator` (all via the `date.utils` re-export)

---

## 7. Feature behaviour preserved

| Surface | Preserved |
|---|---|
| Availability | four-state model (locked > available > partial > unset), full-day coverage calculation, slot/shift pills, `+N more`, four-state legend, loading skeleton |
| My Roster | mobile compact grid + density dots + offer indicator + bottom drawer; desktop chips, per-day count, `+N more`, `ShiftDetailsDialog` |
| Templates | per-day `existing` / `new` / `past` status, dot markers, batch history + undo, publish gate |
| Roster navigator | day/3-day/week/month snapping, min/max bounds, both variants, and the implied-range shading (now a modifier, not a bespoke grid) |
| Timesheets / headers | trigger appearance and date-change callbacks unchanged |

---

## 8. Accessibility outcomes

Every calendar now inherits, identically:

- `role="grid"` with the month caption as the accessible name
- roving tabindex — exactly one day in the tab order
- arrow / Home / End / PageUp / PageDown navigation
- Enter and Space activation on a real `<button>`
- day names that carry state, not just colour — holiday name, availability state,
  shift count, locked-shift role/time/department
- visible `focus-visible` rings
- `motion-safe:` on decorative scale animation

Two specific fixes worth calling out:

- **My Roster desktop was keyboard-unreachable.** The cell was `<div onClick>` and
  the only path to a shift was clicking a chip. There is now a keyboard path to
  every day.
- **The availability pane's locked-shift detail was mouse-only** — it lived in a
  native `title`, which never appears on keyboard focus and never on touch. It is
  now in the accessible name.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Holiday behaviour changed for compliance.** Two extra 2026 NSW public holidays (27 Apr, 28 Dec) now reach `is_public_holiday` in the V8 engine and the shift-form minimum-engagement floor. | **High — verify before deploying** | Correct per NSW law and EBA cl 41, but it is a live pay-adjacent change. Confirm with the payroll owner and check whether any historical shift costing needs restating. |
| Roster Planner grid stops marking NZ holidays. | Medium | Correct, but visible: three dates a year vanish from the grid's amber marking. |
| `MonthGrid` renders 28/35/42 cells, not always 42. | Medium | Container heights that assumed six rows may shift. `fixedWeeks` restores the old behaviour where a stable height matters. |
| Overlay chips need `pointer-events-auto`. | Low | The wrapper is `pointer-events-none` so it doesn't blanket the day button; children must opt in. Documented in `MonthGrid`. |
| `useDayRender`'s `isButton` is false without `onDayClick`, which silently kills focus movement. | Low | `MonthGrid` always supplies `onDayClick`; asserted by the roving-tabindex test. |
| A future contributor imports `startOfWeek` from `date-fns` again. | Medium | Only a lint rule can hold this, and ESLint is broken repo-wide (see below). The `*AU` naming and the `week.ts` header are the interim guard. |

---

## 10. Backward compatibility

- `core/ui/primitives/calendar.tsx` keeps its path and export, so its eleven
  existing importers are unaffected. `size` defaults to `popover` — existing usage
  renders as before.
- `date.utils.ts#isPublicHoliday` still exports, now as a deprecated re-export.
  No call site had to change to keep compiling.
- `UnifiedRosterNavigator`'s exported utilities (`computeRange`, `navigateDate`,
  `formatRangeLabel`) and its props are unchanged.
- `CalendarPane`, `MonthView` and `RosterTemplatesDialog` keep their prop
  signatures exactly.
- **Breaking for callers:** `CustomDateRangePicker`, `CalendarRangePicker`,
  `templates/DateRangePicker` and `anz-holidays` are gone. All call sites were
  migrated in this change; none remain.

---

## 11. Edge cases under test

Covered by `core/lib/date/__tests__/week.test.ts` (12),
`core/lib/__tests__/holidays.test.ts` (10),
`core/ui/calendar/__tests__/MonthGrid.test.tsx` (19),
`availability/ui/panes/__tests__/CalendarPane.test.tsx` (9):

- Monday start from all seven days of the week; **Sunday resolves to the END of
  its week**, not the start — the exact bug the Sunday-defaulting call sites had
- month and year boundary crossing (Thu 31 Dec 2026 → week Mon 28 Dec – Sun 3 Jan)
- 28-, 35- and 42-cell months; every day of the month present exactly once
- moving holidays beyond 2026 (Good Friday 2027/2028, King's Birthday 2027,
  Labour Day 2027, Australia Day 2029)
- NSW substitute days present; NZ holidays absent
- ISO-string holiday lookups parsed on local date parts, not UTC
- roving tabindex is exactly one cell; arrow keys move focus; Enter and Space
  activate
- holiday and feature state present in the accessible name
- overlay content is never nested inside the day button
- availability state precedence — locked beats a full-day availability slot

### Not yet covered — worth adding

- **DST.** Sydney transitions on the first Sunday in April and October. The week
  helpers are local-field operations so they should be immune, but the app has a
  `compliance/v8/__tests__/dst.test.ts` precedent and the calendar has none.
- **Non-Sydney browser timezones.** The repo already runs timezone-parameterised
  suites (UTC / Sydney / Singapore / New York); the calendar tests do not.
- **`DateRangePicker` interaction** — two-click range selection, preset
  application, the auto-close on a complete range.
- **`WeekStrip`** rendering and the `TimeGrid` integration.
- **Reduced motion** — that `motion-safe:` actually suppresses the scale.

---

## 12. Tooling note

`jsx-a11y/no-static-element-interactions` and
`jsx-a11y/click-events-have-key-events` would have caught the `<div onClick>`
cells and will prevent them returning. **ESLint is broken repo-wide** — the gates
are type-check + vitest + build. Restoring lint is a prerequisite for holding
these fixes in place; until then the tests in §11 are the only guard.

The type-check gate must be `npx tsc -p tsconfig.app.json --noEmit`. The bare
root `tsc --noEmit` compiles nothing.
