# Module Documentation

Per-module/feature deep dives, each mirroring a directory under `src/modules/` (or, for the Python services, their own service directory). These exist because `rulebook/` Chapter 03 ("Module Documentation — per-module deep dive") hasn't been written yet — see `rulebook/README.md`'s chapter-status table. Once Ch.03 lands, it should absorb or supersede these.

| Module | Covers | Read order |
|---|---|---|
| **[timesheets/](timesheets/README.md)** | Timesheet review/approval, AutoPilot auto-verify, audit trail | `README.md` → `01`–`10` |
| **[people-mode/](people-mode/README.md)** | The People view of the Rosters Planner: fatigue (FTG), utilization (UTL), workload projections | `README.md` → `01`–`05` |
| **[autoscheduler/](autoscheduler/)** | The OR-Tools CP-SAT optimizer service: solver design, schema-drift contract tests, hardening | `01` → `02` |
| **[shift-synthesizer/](shift-synthesizer/)** | ML-driven labour-demand forecasting → automatic draft-shift generation | `01` → `02` → `03` |

Each folder has (or should have) its own `README.md`/index — check there first for that module's specifics, current-vs-historical caveats, and file-to-code cross-references.
