# 6 · Workflows, Sequence Diagrams & Flowcharts

## 6.1 Overall lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> NoTimesheet: shift published
    NoTimesheet --> draft: first manager edit / lazy insert
    NoTimesheet --> no_show: markShiftAsNoShow
    draft --> submitted: metric edit / employee submit
    submitted --> approved: manager approve (or bot AUTO_APPROVE)
    submitted --> rejected: manager reject (reason required)
    approved --> submitted: edit metrics (reopen) / auto-verify revert
    rejected --> submitted: edit metrics (reopen)
    no_show --> submitted: metrics edited (no-show overridden)
    approved --> [*]: consumed by payroll
    note right of approved
      Gate: shift must be terminal
      (clock-out / auto clock-out / no-show)
    end note
```

## 6.2 Manager approval workflow (step by step)

1. **Entry point:** manager opens `/timesheet`, selects scope + date.
2. `getShiftsForTimesheet` loads shifts + timesheet overlay; billable resolved.
3. Manager clicks **Approve** on a row.
4. **Guard:** status must be `submitted`/`draft`, not `no_show`; if
   `reviewLocked`, blocked with a tooltip.
5. If any warnings → **Approve-warnings modal**; `error` warnings require an
   override reason.
6. `handleSaveEntry` → `updateTimesheetEntry(id, {status:'approved', notes?}, {expectedVersion})`.
7. **DB path:** review-gate trigger validates terminal state; completeness guard
   ensures no `missing` side; version bump; `status='approved'`,
   `approved_at=now()`.
8. `shifts.lifecycle_status='Completed'`.
9. **Triggers:** provenance → `MANUALLY_APPROVED`; outcome-notification →
   `notify_user(timesheet_approved)`.
10. **Exit:** payroll can now price the shift (`approvedOnly`).

## 6.3 Sequence — employee submission → manager approval

```mermaid
sequenceDiagram
    autonumber
    participant EMP as Employee (clock elsewhere)
    participant SH as shifts
    participant MGR as Manager UI
    participant API as updateTimesheetEntry
    participant TS as timesheets
    participant TRG as DB triggers
    participant NOT as notify_user
    EMP->>SH: clock out (actual_end set)
    Note over SH: shift now reviewable
    MGR->>API: load grid (getShiftsForTimesheet)
    MGR->>API: approve(shiftId, expectedVersion)
    API->>TS: UPDATE status='approved' (.eq version)
    TS->>TRG: BEFORE gate + version bump
    TRG-->>API: ok (or check_violation / 0 rows→conflict)
    TS->>TRG: AFTER provenance + notification
    TRG->>NOT: notify_user(timesheet_approved)
    NOT-->>EMP: "Timesheet approved"
    API->>SH: lifecycle_status='Completed'
    API-->>MGR: true → toast
```

## 6.4 Sequence — billable edit with variance reason

```mermaid
sequenceDiagram
    autonumber
    participant MGR as Manager
    participant ROW as TimesheetRow
    participant VAL as validateBillableEdit
    participant API as updateTimesheetEntry
    participant TS as timesheets
    MGR->>ROW: edit adjusted start/end, save
    ROW->>VAL: validate (format/5min/order/break)
    VAL-->>ROW: ok + startChanged/endChanged + needArrival/needDeparture
    alt varies > ±5 min from roster
        ROW->>MGR: Variance-reason modal (fixed list)
        MGR-->>ROW: pick reason(s)
    end
    ROW->>API: save {changed sides, breaks, reasons, version}
    API->>TS: UPDATE (.eq version)
    TS->>TS: edit_count++ , version++ , EDITED audit
    Note over TS: bot GUC absent ⇒ counts as manager edit
    API-->>MGR: "Adjusted Values Saved" (+ adjusted notification to employee)
```

## 6.5 Sequence — AutoPilot auto-verify (async)

```mermaid
sequenceDiagram
    autonumber
    participant SH as shifts
    participant ENQ as enqueue trigger
    participant Q as timesheet_review_queue
    participant CRON as pg_cron (planned)
    participant WK as auto-verify worker
    participant EV as evaluateTimesheet
    participant RPC as sm_timesheet_auto_decide
    participant TS as timesheets
    SH->>ENQ: UPDATE → reviewable (policy ON)
    ENQ->>Q: INSERT PENDING (idempotency_key)
    CRON->>WK: POST (every ~1 min)
    WK->>WK: isWithinAutopilotWindow()? (18:00–06:00 Sydney)
    WK->>RPC: claim batch (SKIP LOCKED)
    loop each claimed shift
        WK->>EV: evaluate variance (±7.5m, no manual edit)
        EV-->>WK: AUTO_APPROVE | MANUAL_REVIEW
        WK->>RPC: sm_timesheet_auto_decide(payload)
        RPC->>TS: (AUTO_APPROVE) status='approved' via GUC-tagged write
        RPC-->>WK: COMMITTED | MANUAL_REVIEW | OUTSIDE_WINDOW | ...
        WK->>Q: complete DONE | RETRY
    end
```

## 6.6 Flowchart — the review gate + completeness guard

```mermaid
flowchart TD
    A[Manager action: approve / reject / edit] --> B{Shift reviewable?<br/>no_show OR clock-out OR auto clock-out}
    B -- No --> X[Blocked: tooltip + DB check_violation]
    B -- Yes --> C{Action}
    C -- Reject --> R[Require reason → status rejected]
    C -- Edit --> E{Changed side varies > ±5m?}
    E -- Yes --> ER[Require variance reason] --> S[Save changed sides]
    E -- No --> S
    C -- Approve --> P{Any billable side 'missing'?}
    P -- Yes --> PB[Refuse: enter adjusted time first]
    P -- No --> PA{Attendance warnings?}
    PA -- error --> PO[Require override reason] --> AP[status approved]
    PA -- none --> AP
    AP --> DONE[lifecycle Completed + notify + audit]
    S --> DONE2[version++ , edit_count++ , notify adjusted]
```

## 6.7 Flowchart — validation pipeline (client)

```mermaid
flowchart LR
    I[edited start/end/breaks] --> F[formatTimeStr]
    F --> P{parse HH:MM?}
    P -- no --> ERR1[Invalid format]
    P -- yes --> G{% 5 == 0?}
    G -- no --> ERR2[5-min increments]
    G -- yes --> O{end after start?}
    O -- no --> ERR3[end after start]
    O -- yes --> B{break in bounds?}
    B -- no --> ERR4[break bounds]
    B -- yes --> V[compute variance vs roster] --> OUT[payload + needArrival/needDeparture]
```

## 6.8 Data-flow — timesheet → payroll

```mermaid
flowchart LR
    TS[(timesheets · approved)] --> BR[billable-time.ts resolveBillableSide]
    SH[(shifts · actual)] --> BR
    BR --> GP[grossPay.read.api.ts approvedOnly]
    GP --> PAY[Gross Pay page / pay run]
```
