# Design Specs (forward-looking / partially implemented)

Unlike `investigations/` (which documents what *was* found/decided on a date), this folder holds designs that are meant to be living proposals until fully implemented — check the live schema/code before assuming a design here is what's actually running.

| Folder | Covers | Implementation status (as of last update) |
|---|---|---|
| [org-role-taxonomy/](org-role-taxonomy/) | HR org/role/remuneration hierarchy (`Organization → Department → Subdepartment → Role`, 8 standardized remuneration levels) + a proposed classification of all 85 live roles into forecasting buckets (`static` / `semi_dynamic` / `dynamic`). | The `hr` schema itself has been applied to prod as an additive/parallel schema (the app is not yet wired to it). The role-forecasting classification (`02-role-forecasting-classification.md`) is a **proposal awaiting approval** — as of its writing, every live role still had `forecasting_bucket = NULL`. Verify current DB state before treating either as decided. |
