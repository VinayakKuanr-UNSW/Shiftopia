# Design Specs (forward-looking / partially implemented)

Unlike `investigations/` (which documents what *was* found/decided on a date), this folder holds designs that are meant to be living proposals until fully implemented — check the live schema/code before assuming a design here is what's actually running.

| Folder | Covers | Implementation status (as of last update) |
|---|---|---|
| [fairness/](fairness/) | Casual-only, opportunity-adjusted fairness: debt = billed hours − fair share of the casual shifts each person was eligible and available for; the solver's SC-4/10/11/11b. | **Built 2026-11-07** — DB engine live (migrations `20261107030325`, `20261107035312`); the old cohort `fairness_ledger` engine is retired. |
| [org-role-taxonomy/](org-role-taxonomy/) | HR org/role/remuneration hierarchy (`Organization → Department → Subdepartment → Role`, 8 standardized remuneration levels) + a proposed classification of all 85 live roles into forecasting buckets (`static` / `semi_dynamic` / `dynamic`). | The `hr` schema itself has been applied to prod as an additive/parallel schema (the app is not yet wired to it). The role-forecasting classification (`02-role-forecasting-classification.md`) is a **proposal awaiting approval** — as of its writing, every live role still had `forecasting_bucket = NULL`. Verify current DB state before treating either as decided. |
| [shift-trading/](shift-trading/) | Peer shift-trading FSM: S4 ⇄ S6 ⇄ S7, offer holds, expiry at the earliest start, manager review. | **Decided 2026-11-04, not implemented** — `01-trading-fsm.md` §9 lists the delta from live. |
