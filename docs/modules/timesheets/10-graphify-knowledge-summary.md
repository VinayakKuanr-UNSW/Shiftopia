# 10 · Graphify Knowledge Summary

The findings in this folder were ingested into the project's persistent Graphify
knowledge graph so future sessions can query them.

## What was stored

A **Timesheets subgraph of 82 nodes + ~134 edges + 4 hyperedges** was **merged
into** the existing repo-wide graph at `graphify-out/graph.json` (which grew from
3,966 → 4,039 nodes and 11,923 → 12,057 edges). Existing knowledge was
**preserved** — the build used incremental `build_merge`, and 10 of the authored
nodes **deduplicated/fuzzy-matched** onto existing repo nodes (e.g. `shift-ui`,
`grossPay`, autopilot framework), wiring the new cluster into the wider graph.

Outputs:
- `graphify-out/graph.json` — the merged, queryable graph (GraphRAG-ready).
- `graphify-out/graph.html` — interactive visualization (regenerated).

## Node categories captured (Phase 19)

| Category | Examples |
|----------|----------|
| Module / screens / components | `Timesheets Module`, `TimesheetPage`, `TimesheetTable`, `TimesheetRow`, `TimesheetHistoryPopover`, `AutoPilotControl` |
| APIs / services | `getShiftsForTimesheet`, `updateTimesheetEntry`, `bulkUpdateTimesheetStatus`, `markShiftAsNoShow`, `createTimesheetAutoPilotAdapter`, `getTimesheetAuditTrail` |
| Domain logic | `resolveBillableSide`, `snapToQuarterHour`, `calculateNetMinutes`, `validateBillableEdit`, `isTimesheetReviewable` |
| Database tables | `timesheets`, `shifts`, `timesheet_approval_rules`, `timesheet_decisions`, `timesheet_audit_log`, `timesheet_review_queue` |
| DB functions/triggers/RPCs | `sm_timesheet_auto_decide`, `sm_timesheet_auto_revert`, `enforce_timesheet_review_gate`, `fn_timesheet_provenance`, `enqueue_timesheet_auto_verify`, `is_timesheet_autopilot_active` |
| Worker | `auto-verify-timesheets`, `evaluateTimesheet`, `isWithinAutopilotWindow` |
| Workflows | approval, billable-edit, no-show, auto-verify, revert |
| Business rules | review gate, 3-tier billable, completeness guard, concurrency, ±5m grace, ±7.5m tolerance, window, ON/OFF, no-show-zero, Sydney-TZ |
| Validations / calculations | edit-format validation, net minutes, clock variance, estimated pay, `total_hours` |
| Permissions / roles | `timesheet-edit`, page access, RLS model, Manager/Employee/Bot |
| Integrations / notifications | payroll gross-pay, Live Rules engine, attendance-metrics, cost estimator, notifications, generic AutoPilot framework |

## Relationship types captured

`contains`, `calls`, `uses`, `queries`, `updates`, `triggered_by`, `implements`,
`protects`, `controls`, `references`, `conceptually_related_to`,
`semantically_similar_to`. Plus 4 hyperedges for the coherent flows:
auto-verify pipeline, review gate (client+DB), shared billable resolver, and the
unbypassable provenance audit.

## How to query it later

```
/graphify query "how does timesheet approval reach payroll"
/graphify explain "sm_timesheet_auto_decide"
/graphify path "TimesheetRow" "timesheet_audit_log"
/graphify --update docs/timesheets      # re-ingest after doc edits
```

The Timesheets nodes cluster mainly in graph communities **92, 93, 87, 113, 114**,
with bridges into the rosters/payroll/auth communities via the deduplicated nodes.
