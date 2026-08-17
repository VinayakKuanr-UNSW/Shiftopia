# Roster Planner — UI/UX & Accessibility Audit

**Date:** 2026-08-05
**Surface:** `/rosters` → `RostersPlannerPage` and everything it mounts
**Method:** source audit against the live code, not a heuristic walkthrough. Every
finding cites a file and line. Counts are from `grep` over
`src/modules/rosters/` (≈12,000 lines across the files below).

| File | Lines |
|---|---|
| `ui/modes/GroupModeView.tsx` | 2941 |
| `ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent.tsx` | 1620 |
| `pages/RostersPlannerPage.tsx` | 1500 |
| `ui/modes/PeopleModeGrid.tsx` | 1045 |
| `ui/modes/RolesModeView.tsx` | 756 |
| `ui/modes/EventsModeView.tsx` | 672 |
| `ui/components/RosterFunctionBar.tsx` | 638 |
| `ui/components/DrillDownPanel.tsx` | 613 |

**Headline numbers**

| Signal | Count |
|---|---|
| `onClick` handlers | 381 |
| `onKeyDown` / `onKeyPress` / `onKeyUp` handlers | **6** |
| `tabIndex` declarations | **5** |
| Clickable `<div>`s with no `role` or `tabIndex` | 27 |
| Native `title=""` used as the only tooltip | 27 |
| Font-size declarations ≤ 10px | **383** |
| `md:` breakpoints in the 2941-line main grid | **6** |
| `aria-live` regions in the whole module | 6 |

The ratio of 381 click handlers to 6 keyboard handlers is the single most
important number in this document. The Roster Planner is a mouse-only application.

**Severity model**

- **Critical** — blocks a user group from completing a core task, or is a
  Level A conformance failure on a primary flow.
- **High** — Level AA failure, or a usability defect that regularly causes error
  or abandonment.
- **Medium** — degrades efficiency or comprehension; conformance risk.
- **Low** — polish, consistency, or latent risk.

---

## CRITICAL

### C1 — Editing a shift is double-click-only; there is no keyboard path

**Issue.** The only way to open a shift for editing in Group Mode is
`onDoubleClick` on a non-interactive `<div>`
([GroupModeView.tsx:2605-2624](src/modules/rosters/ui/modes/GroupModeView.tsx#L2605-L2624)).
The wrapper has no `tabIndex`, no `role`, and no key handler. `SmartShiftCard`'s
own `onClick` fires only in bulk mode.

**Why it's a problem.** Editing a shift is *the* core task of this page. A
keyboard-only user, a switch user, or a screen-reader user cannot perform it at
all — not slowly, not awkwardly: not at all. Double-click is also undiscoverable
for sighted mouse users; nothing on the card signals it.

**Severity:** Critical
**Guideline:** WCAG 2.2 **2.1.1 Keyboard (A)**; **4.1.2 Name, Role, Value (A)**;
NN/g #6 *Recognition rather than recall*.

**Fix.** Make the card a real button and treat double-click as an accelerator, not
the mechanism.

```tsx
// GroupModeView.tsx — shift card wrapper
<div
  key={shift.id}
  role="button"
  tabIndex={isLocked ? -1 : 0}
  aria-label={`${shift.role ?? 'Shift'}, ${shift.startTime}–${shift.endTime}, ${
    shift.employeeName ?? 'unassigned'
  }. Press Enter to edit.`}
  aria-disabled={isLocked || undefined}
  className="h-full relative group/card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
  onDoubleClick={openEditor}          // keep as accelerator
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); }
  }}
>
```

Longer term the card should be a `<button>`; the blocker is the nested menu
trigger, which needs hoisting out first to avoid nested interactive content.

---

### C2 — Drag-and-drop has no keyboard or single-pointer alternative

**Issue.** Shift moves and employee assignment are `react-dnd` pointer drags
([GroupModeView.tsx:154](src/modules/rosters/ui/modes/GroupModeView.tsx#L154),
[UnfilledShiftsPanel.tsx:70](src/modules/rosters/ui/modes/UnfilledShiftsPanel.tsx#L70)).
"DnD Mode" is a whole product mode with its own toolbar toggle and status badge,
and there is no non-drag equivalent for reassigning a shift to another day or
dropping an employee onto a shift.

**Why it's a problem.** WCAG 2.2 added **2.5.7 Dragging Movements** at **AA**
precisely for this: any function achieved by dragging must also be achievable
with a single pointer without dragging. This affects far more than screen-reader
users — it affects tremor, RSI, trackpad-only, and touch users.

**Severity:** Critical
**Guideline:** WCAG 2.2 **2.5.7 Dragging Movements (AA)**; **2.1.1 Keyboard (A)**.

**Fix.** Every drag target already has a non-drag twin in the data layer — the
gateway RPCs. Surface them:

1. Add **"Move to…"** to the existing per-card `DropdownMenu`
   ([GroupModeView.tsx:2500-2590](src/modules/rosters/ui/modes/GroupModeView.tsx#L2500-L2590))
   opening a date/group/sub-group picker that calls the same `sm_move_shift`.
2. Add **"Assign employee…"** to the same menu for the employee-drop flow.
3. Optional: cut/paste keyboard model — `Ctrl+X` on a focused card, `Ctrl+V` on a
   focused cell.

Item 1 alone closes the AA failure and is a small change, since the command path
already exists.

---

### C3 — The shift wizard claims `aria-modal` but implements none of the contract

**Issue.** [ShiftWizardModal.tsx:127-132](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/ShiftWizardModal.tsx#L127-L132)
declares `role="dialog" aria-modal="true"` on a hand-rolled overlay. There is no
focus trap, no initial focus, and no focus restoration on close. The only
keyboard handling is a global `window` Escape listener (line 107).

**Why it's a problem.** `aria-modal="true"` instructs assistive tech to treat
everything outside the dialog as inert. The DOM is *not* inert — the background
grid is still fully tabbable. So AT hides content that the user's focus can still
reach: the user tabs "out" of a dialog that the screen reader insists is modal,
and lands somewhere it will not read. That is worse than declaring nothing.

On close, focus falls back to `<body>` — the user is returned to the top of a
2900-line grid with no idea where they were.

The deviation from Radix is deliberate and well-documented (nested portalled
dropdowns break under Radix's `inert`), so the fix must preserve that.

**Severity:** Critical
**Guideline:** WCAG **2.4.3 Focus Order (A)**, **2.1.2 No Keyboard Trap (A)**,
**4.1.2 (A)**; WAI-ARIA APG *Dialog (Modal)* pattern.

**Fix.** Keep the custom overlay; add the three missing behaviours.

```tsx
const dialogRef = React.useRef<HTMLDivElement>(null);
const restoreFocusRef = React.useRef<HTMLElement | null>(null);

React.useEffect(() => {
  restoreFocusRef.current = document.activeElement as HTMLElement;
  // initial focus: first tabbable, else the container
  const first = dialogRef.current?.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  (first ?? dialogRef.current)?.focus();
  return () => restoreFocusRef.current?.focus();
}, []);

// Trap Tab inside the dialog
const onKeyDownTrap = (e: React.KeyboardEvent) => {
  if (e.key !== 'Tab') return;
  const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!nodes?.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
};

<div ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDownTrap} role="dialog" aria-modal="true" …>
```

Also scope the Escape listener to the dialog node instead of `window` — see M3.

---

### C4 — 27 interactive `<div>`s with no role, tab stop, or key handler

**Issue.** Across the module, 27 elements carry `onClick` on a bare `<div>`.
Representative: the drill-down summary cell
([GroupModeView.tsx:1175](src/modules/rosters/ui/modes/GroupModeView.tsx#L1175))
and the "+N more" expander in `GroupCellShiftList`.

**Why it's a problem.** These are invisible to keyboard and screen-reader users
and are announced as plain text. The drill-down cell is the default rendering
mode ("Bucket View"), so this is the *primary* interaction on a default-configured
page, not an edge case.

**Severity:** Critical (because it includes the default-mode primary action)
**Guideline:** WCAG **2.1.1 (A)**, **4.1.2 (A)**.

**Fix.** Convert to `<button type="button">` where layout permits; where a `div`
must remain for grid geometry, add the full trio — `role="button"`, `tabIndex={0}`,
and an Enter/Space handler. An ESLint rule (`jsx-a11y/no-static-element-interactions`,
`jsx-a11y/click-events-have-key-events`) should gate regressions, though note the
repo's linter is currently broken — see the *Tooling* note at the end.

---

## HIGH

### H1 — The ARIA table structure is malformed

**Issue.** [GroupModeView.tsx:913](src/modules/rosters/ui/modes/GroupModeView.tsx#L913)
opens `role="table"`. The header `role="row"` is a direct child, but the body rows
are rendered by `VirtualizedSubGroupBody`, which wraps them in a plain `<div>`
([GroupModeView.tsx:669-690](src/modules/rosters/ui/modes/GroupModeView.tsx#L669-L690)).
There is no `role="rowgroup"`, and no `aria-rowcount`/`aria-colcount`.

**Why it's a problem.** In ARIA, `table` must own `row` or `rowgroup`. A generic
`div` between them severs the ownership chain, so screen readers either drop the
body rows from the table model or expose a table with one row. Table navigation
commands then don't work — and a roster grid is exactly where a user most needs
"read this column" / "read this row".

Additionally, since cells are interactive (add, drill down, edit), the correct
role is **`grid`**, not `table`.

**Severity:** High
**Guideline:** WAI-ARIA 1.2 *required owned elements*; WCAG **1.3.1 Info and
Relationships (A)**.

**Fix.**

```tsx
<div role="grid" aria-rowcount={totalRows} aria-colcount={dates.length + 1}
     aria-label={`Roster grid, ${format(dates[0],'d MMM')} to ${format(dates.at(-1)!,'d MMM')}`}>
  <div role="rowgroup">
    <div role="row" aria-rowindex={1}> …column headers… </div>
  </div>
  <div role="rowgroup">          {/* was a bare <div> */}
    {subGroups.map((sg, i) => (
      <div role="row" aria-rowindex={i + 2} key={sg.id}>…</div>
    ))}
  </div>
</div>
```

Cells also need `role="gridcell"` (currently `role="cell"`, which is the `table`
variant) once the container becomes a `grid`.

---

### H2 — The Add Shift button is invisible when focused

**Issue.** The per-cell add button is hover-revealed:
`opacity-0 scale-75 group-hover:opacity-100`
([GroupModeView.tsx:1231-1245](src/modules/rosters/ui/modes/GroupModeView.tsx#L1231-L1245)).
It is a real `<button>`, so it *is* in the tab order — but at `opacity-0`.

**Why it's a problem.** A keyboard user tabs into a fully transparent control.
Focus lands on something they cannot see, in a grid with potentially hundreds of
such buttons. This is worse than the control being hidden outright, because the
tab order silently balloons.

**Severity:** High
**Guideline:** WCAG **2.4.7 Focus Visible (AA)**; WCAG 2.2 **2.4.11 Focus Not
Obscured (Minimum) (AA)**.

**Fix.** One line — reveal on focus as well as hover:

```diff
- "w-9 h-9 opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 …"
+ "w-9 h-9 opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 " +
+ "focus-visible:opacity-100 focus-visible:scale-100 focus-visible:ring-2 focus-visible:ring-primary …"
```

Consider also `sr-only` text: the button currently has an icon only.

---

### H3 — 27 native `title` tooltips carry information available no other way

**Issue.** `title=""` is used 27 times as the sole label for icon-only controls
and status affordances — e.g. the day-cell states in `PlanRosterPeriodDialog`, the
compliance chips, the grid header indicators.

**Why it's a problem.** Native `title`: never appears on keyboard focus in most
browsers; never appears on touch at all; has inconsistent screen-reader support;
cannot be styled; and has a ~1s delay that fails users with motor impairments.
Where it is the *only* channel, the information is simply unavailable to
keyboard, touch, and many AT users.

**Severity:** High
**Guideline:** WCAG **1.3.1 (A)**, **4.1.2 (A)**; WAI-ARIA APG *Tooltip*;
NN/g #1 *Visibility of system status*.

**Fix.** The codebase already has a proper `Tooltip` primitive
(`@/modules/core/ui/primitives/tooltip`), used correctly in `RosterFunctionBar`'s
`IconButton`. Route the other 27 through it, and add `aria-label` to every
icon-only control so the accessible name survives independently of the tooltip.

---

### H4 — Text contrast fails at the low end of the opacity scale

**Issue.** Text colours are pervasively set with opacity modifiers. Counts:
`text-white/40` ×49, `text-muted-foreground/30` ×25, `text-white/50` ×19, plus
`opacity-30`/`opacity-40` applied to text containers ×~50.

`text-white/40` on the app's dark surface (`#0a0c10`-family) computes to roughly
**2.3:1**. `text-muted-foreground/30` is lower still. AA requires 4.5:1 for body
text and 3:1 for large text.

**Why it's a problem.** These are not decorative — they carry dates, counts,
sub-group names, and the "past date" state. The pattern also compounds: several
sites apply `opacity-50` to a container whose text is already `/60`.

**Severity:** High
**Guideline:** WCAG **1.4.3 Contrast (Minimum) (AA)**.

**Fix.** Introduce two semantic tokens and ban raw opacity on text:

```css
/* both verified ≥ 4.5:1 on --background in light and dark */
--text-subtle:  /* … */;
--text-disabled:/* … */;   /* only for genuinely inert content */
```

Then `text-white/40` → `text-subtle`. Disabled/past content may use the 3:1
"incidental" allowance only where it is truly non-informational — the "past date"
styling currently fails that test because the date number is still the only way
to identify the column.

---

### H5 — Mode switching is discoverable only through icon tooltips

**Issue.** The page has at least four interaction modes — Bucket View (default),
DnD Mode, Bulk Selection, and the mode selector (Group/People/Roles/Events). DnD
and Bulk are toggled by unlabelled icon buttons in `RosterFunctionBar`
([lines 520-566](src/modules/rosters/ui/components/RosterFunctionBar.tsx#L520-L566)),
and they change what clicking, dragging, and hovering *do* across the entire grid.
Only DnD Mode surfaces persistent state (a floating badge at
[GroupModeView.tsx:2660](src/modules/rosters/ui/modes/GroupModeView.tsx#L2660)).

**Why it's a problem.** Modes that silently redefine direct manipulation are the
classic mode-error trap. A user in Bulk mode who clicks a card selects it instead
of opening it, with no persistent explanation. The tooltips are the only place
the mode's existence is stated.

**Severity:** High
**Guideline:** NN/g **#1 Visibility of system status**, **#6 Recognition rather
than recall**, **#3 User control and freedom**.

**Fix.** Give every non-default mode the same treatment DnD already gets: a
persistent, dismissible status bar naming the mode, what it changes, and how to
exit ("Bulk selection — click cards to select. Esc to exit."). Add visible text
labels to the toggles at ≥`lg` where there is room.

---

### H6 — Sub-group rows span the entire visible range regardless of actual coverage

**Issue.** `GroupModeView` merges sub-groups across every roster in range —
one row per sub-group *name*, first id wins
([GroupModeView.tsx:1976-1990](src/modules/rosters/ui/modes/GroupModeView.tsx#L1976-L1990)).
A sub-group that exists on three days renders as a full-width row across a 31-day
month; the other 28 cells are empty and indistinguishable from "exists, no shifts".

Verified in prod: the underlying data is correctly bounded — every sub-group
occupies one contiguous date range. This is purely a presentation defect.

**Why it's a problem.** The user cannot tell which days a sub-group covers, so
"is this sub-group set up for next week?" is unanswerable from the grid. It also
misleads about the cost of `delete_roster_subgroup_v2`, which is range-scoped.

**Severity:** High
**Guideline:** NN/g **#1 Visibility of system status**; WCAG **1.3.1 (A)**
(relationships conveyed only by emptiness).

**Fix.** Distinguish "not present on this day" from "present but empty" — a
hatched or dotted cell background for the former, plus a row-level badge showing
coverage (`"Riggers · 3 of 31 days"`). Deeper fix: make the row model date-aware.

---

### H7 — Destructive and irreversible actions rely on toast-only feedback

**Issue.** Delete, publish, unpublish, and move all report through transient
toasts. Only delete has a confirm dialog; template apply has an Undo affordance
([ApplyTemplateDialog HistoryItem](src/modules/rosters/ui/dialogs/ApplyTemplateDialog.tsx#L55-L125)),
but Plan Period — which can create a month of rosters and auto-publish them — has
none.

**Why it's a problem.** A toast is gone in seconds and leaves no record. Publishing
a roster notifies employees; there is no undo and no confirmation summarising
scope ("this will publish 217 shifts to 43 people").

**Severity:** High
**Guideline:** NN/g **#5 Error prevention**, **#3 User control and freedom**,
**#1 Visibility of system status**.

**Fix.** Add a scope-summarising confirm step to publish and to Plan Period, in
the shape the `PublishRosterButton` plan/preview already uses. Give Plan Period
the same batch-undo that template apply has — it writes `roster_template_batches`
rows internally, so the data is already there.

---

## MEDIUM

### M1 — 383 font-size declarations at or below 10px

`text-[10px]` ×258, `text-[9px]` ×111, `text-[8px]` ×14. Used for dates, counts,
badges, legends, and sub-group names — not just decoration.

**Why:** at 9px, uppercase + `tracking-widest` (the dominant pattern here) drops
below comfortable legibility for most users and well below it for low-vision
users. WCAG has no minimum font size, but **1.4.4 Resize Text (AA)** and
**1.4.12 Text Spacing (AA)** both become fragile: several of these live in
fixed-height containers that will clip at 200% zoom.

**Severity:** Medium · **Fix:** establish a type scale with a 12px floor for any
text conveying information; reserve ≤10px for non-informational ornament. Verify
at 200% zoom.

### M2 — No `<main>` landmark; sparse landmark structure

Across the module: 3 `<nav>`, 2 `<section>`, zero `<main>`, zero `<aside>`,
zero `<header>`/`<footer>`. The `<h1>` does exist — supplied by the shared
`PersonalPageHeader` ([line 55](src/modules/core/ui/components/PersonalPageHeader.tsx#L55)).

**Why:** landmark navigation is the primary way screen-reader users skip the
toolbar to reach the grid. Without it, every visit means tabbing past the entire
function bar.

**Severity:** Medium · **Guideline:** WCAG **1.3.1 (A)**, **2.4.1 Bypass Blocks (A)**
**Fix:** wrap the grid region in `<main>`, the toolbar in `<header>`, the
drill-down/unfilled panels in `<aside>`, and give the grid an `aria-label`.

### M3 — The wizard's Escape handler is bound to `window`

[ShiftWizardModal.tsx:107-113](src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/ShiftWizardModal.tsx#L107-L113)
registers on `window` for the modal's whole lifetime. When the nested Radix
`CancelConfirmDialog` is open on top, one Escape press is handled by both: Radix
closes the confirm, and the window listener re-runs `handleCancel`.

**Severity:** Medium · **Guideline:** WAI-ARIA APG *Dialog*
**Fix:** bind to the dialog node, and skip when a descendant dialog is open.

### M4 — Icon-only controls at 32px

`h-8 w-8` ×40 in the toolbar. This passes WCAG 2.2 **2.5.8 Target Size (Minimum)
(AA)** at 24px, but sits well under the 44px comfortable target, and these
controls are packed with 2px gaps in a single row.

**Severity:** Medium · **Guideline:** 2.5.8 (AA) pass / **2.5.5 (AAA)** fail;
Material Design 48dp guidance
**Fix:** 40px minimum with 8px gaps at `lg` and below.

### M5 — The 768–1024px tablet band gets an unadapted desktop grid

`/rosters` is behind `MobileAccessGuard`, which shows a desktop-only screen below
**768px** ([use-mobile.tsx:3](src/modules/core/hooks/use-mobile.tsx#L3)) — a
deliberate product decision, not an oversight. But 768–1024px passes the guard,
and `GroupModeView` contains **6** `md:` breakpoints in 2941 lines. Tablets get
the full desktop layout, including hover-only affordances (H2) that have no
hover on touch.

**Severity:** Medium · **Guideline:** WCAG **1.4.10 Reflow (AA)**
**Fix:** either raise the guard to 1024px (honest, cheap) or give the grid a
tablet layout with permanently visible add buttons. The `[@media(hover:none)]`
escape hatches already present at
[GroupModeView.tsx:1239](src/modules/rosters/ui/modes/GroupModeView.tsx#L1239)
show the problem was noticed but only patched locally.

### M6 — Terminology drifts across the page

Same or adjacent concepts appear as: "Inject Sequence" (apply a template),
"Plan Roster Period", "Bucket View", "DnD Mode", "Snap" (capture a template),
"Emergency" vs "Urgent". "Inject Sequence" in particular is unlikely to map to
any user's mental model of "apply a template".

**Severity:** Medium · **Guideline:** NN/g **#2 Match between system and the real
world**, **#4 Consistency and standards**
**Fix:** a terminology table in the design system; rename the button to
"Apply Template" to match its own dialog title.

### M7 — Grid state is not announced

Loading, filter results, and post-action row counts have no live region — the
module's 6 `aria-live` instances are all inside the shift modal's header and
stepper. A screen-reader user filtering the grid gets no confirmation that
anything changed.

**Severity:** Medium · **Guideline:** WCAG **4.1.3 Status Messages (AA)**
**Fix:** one polite live region near the grid announcing
`"Showing 42 shifts across 7 days"` on filter/date change.

### M8 — Empty states are structural, not instructional

`visualGroups` always renders the four venue groups even with no data
([GroupModeView.tsx:1825](src/modules/rosters/ui/modes/GroupModeView.tsx#L1825)) —
good for layout stability, but a brand-new department shows four empty accordions
with no explanation and no next step.

**Severity:** Medium · **Guideline:** NN/g **#10 Help and documentation**
**Fix:** when a range has zero shifts, overlay a first-run panel: "No shifts in
this range — apply a template, or click any cell to add one."

---

## LOW

- **L1 — Arbitrary Tailwind values instead of tokens.** `rounded-[2rem]`,
  `rounded-[32px]`, `rounded-[1.5rem]`, `text-[9px]` and hard-coded hex surfaces
  (`bg-[#0a0a0c]`, `bg-[#0c0512]`, `bg-[#1c2333]`) appear throughout. The hex
  surfaces bypass the theme system entirely, which the project treats as a
  first-class concern. *Fix:* promote to design tokens.
- **L2 — Focus-visible styling is inconsistent.** Some controls use the primitive
  `Button` (which has a ring); hand-rolled controls mostly have none.
- **L3 — `aria-hidden` outnumbers `aria-label` 53:37.** Worth an audit that none
  hides an element that is the sole accessible name of a control.
- **L4 — Animation is unconditional.** `animate-[slideUpFade]` per card
  ([GroupModeView.tsx:1188](src/modules/rosters/ui/modes/GroupModeView.tsx#L1188))
  with a staggered `animationDelay` and no `prefers-reduced-motion` guard.
  *Guideline:* WCAG **2.3.3 Animation from Interactions (AAA)** — not required at
  AA, but cheap: wrap in `motion-safe:`.

---

## Apply Template vs Bulk Seeding

### What each one actually does

**Apply Template** — `ApplyTemplateDialog` → `apply_template_to_date_range_v2`.
Choose a template and a date range; its shifts are written across that range.
Creates the day containers it needs. Records a `roster_template_batches` row and
exposes **per-batch Undo** in the dialog's history panel.

**Plan Roster Period** — `PlanRosterPeriodDialog` → `create_planning_period`.
Choose a date range from presets; **optionally** choose a template. Creates a
`planning_periods` row, creates the daily rosters, and — if a template was chosen
— calls `apply_template_to_date_range_v2` internally
([baseline_schema.sql:5088-5100](supabase/migrations/20251015000000_baseline_schema.sql#L5088-L5100)).
Can also auto-publish.

### The overlap is not partial — one calls the other

With a template selected, Plan Period *is* Apply Template, plus:

1. a `planning_periods` record, and
2. an optional auto-publish.

### Is the distinction meaningful to a user? No — and the evidence is unambiguous

**The artifact Plan Period uniquely creates is invisible.** `planning_periods` is
read in exactly one place in the entire application: `PlanRosterPeriodDialog`
itself, to warn you that you already made one
([PlanRosterPeriodDialog.tsx:197](src/modules/rosters/ui/dialogs/PlanRosterPeriodDialog.tsx#L197)).
It is never listed, never navigated to, never edited, never deleted, and never
shown on the roster. Prod holds **5 planning periods against 193 rosters**, 99 of
which are linked to one. So the only user-observable consequence of the feature's
distinguishing artifact is that it can block you from repeating the action.

**The two paths differ in reversibility — the wrong way round.** Apply Template
has Undo. Plan Period, which is the *bigger, more destructive* action (a month of
rosters, optionally auto-published to staff), has none — despite writing the same
`roster_template_batches` rows internally. A user's safest choice is the
narrower-sounding button.

**Both dialogs already do the same job.** Both have a date-range picker, both
have a template picker, both preview a calendar. A user comparing them sees two
buttons that seed shifts from a template over a range, differing mainly in which
presets they offer.

### Recommendation: merge into one, keep the presets, drop the invisible entity

**Do not keep them separate.** The distinction is an implementation artifact.

1. **Merge into a single "Schedule from Template" action** with:
   - a range control offering both Apply Template's free start/end dates *and*
     Plan Period's presets (This Week / This Month / Next Month / Custom);
   - the template picker, with "No template — create empty days" retained as an
     option, which is Plan Period's genuinely distinct no-template case;
   - the auto-publish toggle, **off by default**, behind a confirm that states
     scope;
   - Apply Template's batch **history + Undo**, which becomes available to the
     whole flow.
2. **Retire `planning_periods` from the UI.** Either surface it as a real,
   first-class object (a named period you can open, edit, and delete) or stop
   creating it. Do not keep an invisible entity whose only behaviour is to
   generate a duplicate warning. Given no screen consumes it, retiring is the
   cheaper call; keep the table and stop writing to it from the merged flow if
   you want to preserve history.
3. **Rename "Inject Sequence" → "Apply Template"** regardless of whether the merge
   happens. It is the single highest-value word change on the page.

If the merge is too large for now, the **minimum** intervention is: rename
"Inject Sequence"; give Plan Period the same Undo; and change Plan Period's
description to state the one thing it does that Apply Template does not
(*"…and can publish the whole range to staff"*), so the choice is at least
legible.

---

### IMPLEMENTED — 2026-08-05

The merge shipped, and **Snap was folded in with it**. **Not applied to prod, not
committed.**

**New:** `ui/dialogs/RosterTemplatesDialog.tsx` — one dialog, one toolbar button
("Templates"), two tabs.
**Deleted:** `ApplyTemplateDialog.tsx`, `PlanRosterPeriodDialog.tsx`,
`SnapFromRosterDialog.tsx`, `useCreatePlanningPeriod`, `usePlanningPeriods`.
**New migration:** `20260805160000_sm_ensure_rosters_for_range.sql`.

Three buttons became one because all three were the same relationship pointing in
different directions:

| Was | Direction | Now |
|---|---|---|
| Apply Template ("Inject Sequence") | template → roster | **Apply to roster** tab |
| Plan Roster Period | template → roster (+ empty days) | same tab, "No template" option |
| Snap (camera icon) | roster → template | **Capture from roster** tab |

| Carried over from | What |
|---|---|
| Apply Template | free start/end dates, template history, **per-batch Undo** |
| Plan Period | range presets, the no-template case, optional publish |
| Snap | capture-as-template, live shift count, auto-naming, "Open in Templates" |

**The date range is now shared by both tabs**, which is the substantive win rather
than just a consolidation: Apply had free start/end dates, Plan Period had presets,
and Snap had a third date picker of its own — three controls for one concept, none
of which agreed. Pick "This Month" once, then either fill it or capture it. Snap in
particular gains the presets it never had, so "capture this month" is one click
instead of typing two dates.

Decisions taken while building:

- **`planning_periods` is no longer written.** The table and
  `shiftsQueries.getPlanningPeriods` stay so the 99 rosters already carrying a
  `planning_period_id` keep their reference; nothing creates new ones. The two
  jobs `create_planning_period` actually did are now explicit and separately
  testable — `sm_ensure_rosters_for_range` makes the days,
  `apply_template_to_date_range_v2` seeds the shifts.
- **Sub-department scope deliberately differs by direction.** Applying a template:
  one sub-department, because a template belongs to one and fanning it across the
  whole scope would copy work into teams it was never written for. Preparing empty
  days: every sub-department in scope, which is what Plan Period did and is safe
  for empty containers. Capturing: exactly one — you cannot capture "a bit of
  several teams" into one template. The Capture tab **explains** that requirement
  rather than just disabling itself, since it is the one place the two directions
  legitimately disagree and a greyed-out button would look like a bug.
- **Publish is off by default and double-gated** — a switch, then an explicit
  "I understand — publish" acknowledgement naming the date range. It closes H7
  for this flow: previously the auto-publish path had neither confirmation nor
  undo.
- **Past days are skipped, not refused.** Picking "This Month" on the 20th means
  the rest of the month. The count is surfaced in the dialog *and* in the toast,
  so the flow never silently does less than asked.
- **The new dialog does not repeat the sins this audit found.** Built on the
  Radix `Dialog` primitive (focus trap, restore and Escape come free — cf. C3);
  presets and the template list are real `radiogroup`s; every icon is
  `aria-hidden` with a text label beside it; day cells carry an `sr-only`
  sentence rather than a bare number; the outcome line is `role="status"`;
  tooltips use the primitive, not `title` (H3); no informational text below 11px
  (M1); explicit `focus-visible` rings (L2).

**Verification:** 6 new SQL assertions (T23–T28) covering creation, idempotency,
past-day skipping, multi-sub-department fan-out, RBAC denial and range
validation — 29 total in `supabase/tests/implicit_roster_activation.sql`, green
on PG17. `tsc` clean · 1781 vitest pass · build succeeds.

Also cleaned up in passing: `RosterFunctionBar` no longer walks the whole scope
tree to derive a sub-department name — that lookup existed solely to seed Snap's
default template name, and the merged dialog gets it from `useSubDepartments`.

**Not done:** "Inject Sequence" and "Snap" are both gone with their dialogs, so
those renames are moot — M6's terminology point is partly closed by deletion. The
remaining audit items — C1–C4, H1, H2, H4, H6 — are untouched.

## Verified non-issues

Checked and cleared, so they don't get re-investigated:

- **Toasts announce correctly.** The toaster is built on Radix
  (`@radix-ui/react-toast`), which supplies the live region. No 4.1.3 failure here.
- **The page has an `<h1>`.** Supplied by shared `PersonalPageHeader`, not by the
  page file — a `grep` of `RostersPlannerPage.tsx` alone misleadingly shows none.
- **The `PERF 29q · 785ms` overlay is dev-only** — gated on `import.meta.env.DEV`
  ([DevPerfOverlay.tsx:337](src/modules/core/ui/components/DevPerfOverlay.tsx#L337)).
  Not shipped to users.
- **Mobile exclusion is deliberate**, not an oversight — `MobileAccessGuard` with
  an explanatory screen. The gap is the tablet band (M5), not phones.
- **Sub-group date ranges are written correctly** — verified in prod, every
  sub-group occupies one contiguous range. H6 is presentation-only.

## Tooling note

`jsx-a11y` rules would catch C1, C4, H2, and prevent regressions — but ESLint is
currently broken repo-wide (the project's gates are type-check + vitest + build).
Restoring lint is a prerequisite for holding any of these fixes in place.

---

## Suggested order

| # | Work | Severity | Effort |
|---|---|---|---|
| 1 | Keyboard access to shift editing (C1) + interactive divs (C4) | Critical | M |
| 2 | Focus trap / initial focus / restore in the wizard (C3) | Critical | S |
| 3 | "Move to…" + "Assign employee…" menu items (C2) | Critical | M |
| 4 | Focus-visible on the hover-revealed add button (H2) | High | XS |
| 5 | `role="grid"` + `rowgroup` + `gridcell` (H1) | High | S |
| 6 | Contrast tokens, retire opacity-on-text (H4) | High | M |
| 7 | Replace `title` with the Tooltip primitive (H3) | High | M |
| 8 | Merge Apply Template / Plan Period; rename "Inject Sequence" | High | M |
| 9 | Confirm + undo for publish and Plan Period (H7) | High | M |
| 10 | Mode status bars (H5), landmarks (M2), live region (M7) | High/Med | S |

Items 2 and 4 are hours, not days, and together close two of the four Criticals
and one High.
