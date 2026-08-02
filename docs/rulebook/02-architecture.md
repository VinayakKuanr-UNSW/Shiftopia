# Chapter 2 — Architecture (Phase 2)

**Confidence:** diagram *topology* (which components exist and talk to which) is **Verified** — each edge traces to a specific import, RPC call, or trigger found in Ch. 1. Internal *sequencing* within a box (exact step order inside e.g. the compliance engine or the optimizer pipeline) is **Strongly Inferred** pending the deeper Ch. 3/7/12 passes — treat step ordering as indicative, not a verified contract, until those chapters land.

## 1. Overall architecture

```mermaid
graph TB
    subgraph Client["React/TS SPA (957 files, 17 modules)"]
        UI[UI Modules]
        Router["Router — AppRouter.tsx<br/>AuthLayout → MobileAccessGuard → FeatureGate"]
        AuthHook["useAuth() — src/platform/auth/"]
    end

    subgraph Supabase["Supabase (Postgres 17)"]
        RLS["~433 RLS Policies"]
        Tables["~139 tables (public) + 7 (hr)"]
        RPCs["~336 functions incl. sm_* gateway RPCs"]
        Triggers["92 triggers → audit/notify/derive"]
        Cron["pg_cron: nightly_leave_accrual, dead_shift_cleanup"]
    end

    subgraph EdgeFn["Supabase Edge Functions"]
        AutoSwap[auto-approve-swaps]
        AutoBid[auto-assign-bids]
        AutoTS[auto-verify-timesheets]
        StateProc[shift-state-processor]
        PartMgr[partition-manager]
    end

    subgraph Optimizer["Optimizer microservice (FastAPI + OR-Tools CP-SAT)"]
        OptAPI[optimize endpoint]
    end

    UI --> Router --> AuthHook
    UI -- "direct reads (.from)" --> RLS
    UI -- "direct writes (.from), non-FSM tables" --> RLS
    UI -- "gated writes (.rpc), FSM tables" --> RPCs
    RLS --> Tables
    RPCs --> Tables
    RPCs --> Triggers
    Triggers --> Tables
    Cron --> RPCs
    EdgeFn -- "claim/decide/complete via sm_*_queue_* RPCs" --> RPCs
    UI -- "scheduling/auto-scheduler.controller.ts" --> OptAPI
    OptAPI -- "proposals validated by compliance/v8, committed via" --> RPCs
```

**Key architectural rule (Verified):** anything governed by a state machine (shifts, swaps, bids, timesheets) is **never** written directly via `.from(table).update()` from the client — always through an `sm_*` RPC gateway with optimistic concurrency (`p_expected_version`) and, for the marketplace, an idempotency key. Non-FSM tables (availability, broadcasts, settings, leave requests pre-approval) are written directly, protected by RLS alone.

## 2. Module relationships

```mermaid
graph LR
    core["core (app shell)"]
    auth --> core
    availability --> core
    availability --> reserve_list["reserve-list"]
    broadcasts --> core
    compliance --> core
    compliance --> rosters
    insights --> core
    insights --> rosters
    insights --> users
    leave --> core
    leave --> rosters
    payroll --> core
    payroll --> rosters
    payroll --> timesheets
    payroll --> leave
    planning --> rosters
    planning --> compliance
    planning --> availability
    planning --> payroll
    planning --> core
    reserve_list --> rosters
    reserve_list --> core
    rosters --> planning
    rosters --> reserve_list
    rosters --> templates
    rosters --> timesheets
    rosters --> users
    rosters --> settings
    rosters --> availability
    rosters --> compliance
    rosters --> payroll
    rosters --> core
    scheduling --> rosters
    scheduling --> core
    search --> core
    settings --> payroll
    settings --> core
    templates --> rosters
    templates --> users
    templates --> core
    timesheets --> rosters
    timesheets --> planning
    timesheets --> payroll
    timesheets --> core
    users --> core
    core -.->|"reverse: shell imports feature types/badges"| availability
    core -.-> broadcasts
    core -.-> planning
    core -.-> rosters2["rosters"]
    core -.-> settings
    core -.-> templates
    core -.-> timesheets
    core -.-> users
```

**Reading this:** `rosters` is the structural hub — 10 of the other 16 modules depend on it (shift/roster entities, eligibility, compliance-service, bulk-assignment engine). `core` has an unusual *bidirectional* relationship: every module depends on it for shell/primitives, but it also reaches back into 7 feature modules for global nav badges and its central type-re-export barrel. `search`, `users`, and `auth` are the shallowest ("leaf") modules — few or no dependents reach further into the graph through them.

## 3. Data flow (read vs. write path)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant C as React component
    participant H as Hook/service (module api/)
    participant SB as Supabase client
    participant PG as Postgres (RLS + RPCs)

    Note over U,PG: READ PATH (all modules)
    U->>C: navigate / interact
    C->>H: call query hook
    H->>SB: .from(table).select() or .rpc(getter)
    SB->>PG: authenticated request (JWT)
    PG->>PG: evaluate RLS policy for role/scope
    PG-->>SB: filtered rows
    SB-->>H: data
    H-->>C: render

    Note over U,PG: WRITE PATH — FSM-governed entity (shift/swap/bid/timesheet)
    U->>C: submit action (assign/publish/approve/etc.)
    C->>H: call command (e.g. sm_apply_shift_op)
    H->>SB: .rpc('sm_apply_shift_op', {op, expected_version, idempotency_key})
    SB->>PG: RPC call
    PG->>PG: fsm_op_is_legal() guard
    PG->>PG: row lock + version CAS
    PG->>PG: _apply_shift_op_write()
    PG->>PG: trigger: fn_capture_shift_event() → shift_events
    PG->>PG: trigger: fn_refresh_snapshots_on_event() → assignment_snapshots
    PG->>PG: trigger: notification dispatch (trg_shifts_notify etc.)
    PG-->>SB: new state + version
    SB-->>H: result
    H-->>C: update UI (optimistic-concurrency conflict surfaced as error if version stale)
```

## 4. API/RPC gateway pattern

```mermaid
graph TB
    Client[Frontend command] --> Gateway["sm_apply_shift_op(shift_id, op, expected_version, idempotency_key, payload)"]
    Gateway --> Legal{"fsm_op_is_legal(current_state, op)?"}
    Legal -- no --> Reject[Reject: illegal transition]
    Legal -- yes --> Lock["Row lock + version CAS<br/>(p_expected_version must match)"]
    Lock -- stale --> Conflict[Reject: 409 optimistic-concurrency conflict]
    Lock -- ok --> Write["_apply_shift_op_write()"]
    Write --> Ops{op}
    Ops -->|assign| Assign[set assigned_employee_id, state→Assigned]
    Ops -->|publish| Publish[state→Published, lock roster row]
    Ops -->|select_winner| SelectWinner["resolve bid/swap winner, assign"]
    Ops -->|approve_trade / reject_trade| TradeDecision[apply swap decision]
    Ops -->|unassign / delete| Unassign[clear assignment / soft-delete]
    Assign --> Event[trg_capture_shift_event]
    Publish --> Event
    SelectWinner --> Event
    TradeDecision --> Event
    Unassign --> Event
    Event --> Snapshot[assignment_snapshots refresh]
    Event --> Notify[notification triggers]
```

This single gateway (`sm_apply_shift_op`) is the closest thing this platform has to a formal "shift API" — every legal shift-state transition, regardless of which frontend module initiated it (Rosters, Planning/Bidding, Planning/Swapping, Reserve List, Scheduling's auto-committer), funnels through it. This is why Ch. 1 found so few direct `.rpc()` call sites per module for shift mutation — they nearly all resolve to this one function with a different `op` argument.

## 5. Database relationships (core spine, not full ERD)

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ DEPARTMENTS : has
    DEPARTMENTS ||--o{ SUB_DEPARTMENTS : has
    ORGANIZATIONS ||--o{ PROFILES : "scopes via app_access_certificates"
    PROFILES ||--o{ APP_ACCESS_CERTIFICATES : "holds (alpha..zeta, personal/managerial)"
    PROFILES ||--o{ USER_CONTRACTS : "employment record (hr schema)"
    SHIFTS }o--|| ORGANIZATIONS : "belongs to"
    SHIFTS }o--o| PROFILES : "assigned_employee_id"
    SHIFTS ||--o{ SHIFT_EVENTS : "every transition appended"
    SHIFTS ||--o| SHIFT_COMPLIANCE_SNAPSHOTS : "1:1, synced by trigger"
    SHIFTS ||--o| SHIFT_PAYROLL_RECORDS : "1:1, synced by trigger"
    SHIFTS ||--o{ SHIFT_BIDS : "open-bid participation"
    SHIFTS ||--o{ SHIFT_SWAPS : "swap/trade in progress"
    SHIFT_SWAPS ||--o{ SWAP_OFFERS : "counter-offers"
    SHIFT_SWAPS ||--o{ SWAP_AUDIT_LOG : "append-only, trigger-enforced"
    SHIFT_BIDS ||--o{ BID_AUDIT_LOG : "append-only"
    SHIFTS ||--o| TIMESHEETS : "actuals vs. schedule"
    TIMESHEETS ||--o{ TIMESHEET_AUDIT_LOG : "append-only, edit provenance"
    TIMESHEETS ||--o| GROSS_PAY_RECORDS : "priced via EBA rate tables"
    PROFILES ||--o{ LEAVE_REQUESTS : requests
    LEAVE_REQUESTS ||--o{ LEAVE_REQUEST_EVENTS : "append-only audit"
    LEAVE_REQUESTS ||--o| LEAVE_BALANCES : "deducted on approval"
    SHIFT_EVENTS ||--o{ ASSIGNMENT_SNAPSHOTS : "projected KPI spine"
    ROSTERS ||--o{ ROSTER_GROUPS : "fixed 3-group structure"
    ROSTER_TEMPLATES ||--o{ TEMPLATE_SHIFTS : "via groups/subgroups"
```

## 6. Scheduling engine (auto-scheduler) — first pass

```mermaid
sequenceDiagram
    participant Mgr as Manager
    participant Ctrl as AutoSchedulerController (.run)
    participant Opt as Optimizer microservice (OR-Tools CP-SAT)
    participant Comp as compliance/v8 orchestrator
    participant Commit as AutoSchedulerController (.commit)
    participant DB as Postgres

    Mgr->>Ctrl: request auto-fill (unassigned shifts in view)
    Ctrl->>DB: fetch shifts, availability, leave_requests
    Ctrl->>Opt: OptimizeRequest (shifts, employees, constraints, strategy)
    alt optimizer succeeds
        Opt-->>Ctrl: AssignmentProposal[]
    else optimizer fails/unavailable
        Ctrl->>Ctrl: fall back to rosters/bulk-assignment greedy engine
    end
    Ctrl->>Comp: validate each proposal (V8 orchestrator)
    Comp-->>Ctrl: ValidatedProposal[] (pass/fail per shift, with rationale)
    Ctrl-->>Mgr: preview (PillarScores, ParetoAlternative, WhyThisPerson)
    Mgr->>Commit: approve/commit selected proposals
    Commit->>DB: concurrency re-check (shift not since modified/taken)
    Commit->>DB: rosters/bulk-assignment engine → sm_apply_shift_op(assign) per shift
    DB-->>Commit: results (some may now conflict if raced)
    Commit-->>Mgr: commit summary (assigned / skipped-due-to-race)
```

**Confidence: Strongly Inferred.** `auto-scheduler.controller.ts` is 1,479 lines; this diagram reflects the module inventory and DB-inventory findings (optimizer client, fallback to bulk-assignment, compliance validation, concurrency recheck at commit) but has not yet had a line-by-line read — a dedicated Ch. 3/7 pass on `scheduling` should confirm exact sequencing and error paths.

## 7. The AutoPilot pattern (Swaps, Bids, Timesheets)

Three independent features share one architecture, confirmed structurally identical across all three domains in Ch. 1 §4:

```mermaid
graph LR
    subgraph Config
        Rules["*_approval_rules<br/>(ON/OFF + policy JSON, versioned)"]
    end
    subgraph Runtime
        Event["Domain event<br/>(swap requested / bid window closes / timesheet submitted)"]
        Enqueue["trg_enqueue_*_auto_*<br/>writes to *_review_queue"]
        Worker["Edge Function worker<br/>(auto-approve-swaps / auto-assign-bids / auto-verify-timesheets)"]
        Claim["sm_*_queue_claim"]
        Decide["sm_*_auto_decide<br/>(applies domain rules, e.g. compliance check for swaps)"]
        Complete["sm_*_queue_complete"]
    end
    subgraph Trail
        Decisions["*_decisions (decision log)"]
        Audit["*_audit_log (append-only, trigger-enforced immutable)"]
    end

    Rules --> Event
    Event --> Enqueue --> Worker
    Worker --> Claim --> Decide --> Complete
    Decide --> Decisions
    Decide --> Audit
    Complete --> Notify["outcome notification to employee"]
```

Each subsystem is independently toggleable (per org/department, via its `*_approval_rules` row) — "AutoPilot" is a config flag, not a separate code path; when off, the same domain event instead routes to a manager for manual decision. See project memory `autopilot-uniform-feature` for the frontend control surface (not yet deployed to workers as of last check — verify current deployment status before relying on this).

## 8. Marketplace lifecycle (Bids & Swaps)

**Superseded by Ch. 7 §3 — corrected here, not just there, since the original version of this diagram described the wrong system.** This section originally generalized from `planning`'s `PlanningRequestStatus` type (`OPEN→MANAGER_PENDING→APPROVED/REJECTED/BLOCKED/CANCELLED/EXPIRED`), assuming the newer unified `planning_requests`/`planning_offers` model was live. Ch. 7's deep pass proved that model, while real and functional, **is never called from any routed UI** — every marketplace route and API call site hits the legacy `shift_bids`/`shift_swaps`/`swap_offers` tables directly. See Ch. 7 §3.1 for the evidence and §3.4 for the verified transition diagram and table (which also documents a manager-swap-approval bug found and fixed while tracing this lifecycle).

**Confidence: Verified** (superseding the prior Strongly-Inferred tag on this diagram).

## 9. Compliance engine — structural view

```mermaid
graph TB
    subgraph Callers
        Bidding[planning/bidding]
        Swapping[planning/swapping]
        Manual[rosters manual assign/publish]
        AutoSched[scheduling auto-scheduler]
        ReserveList[reserve-list emergency assign]
    end

    subgraph V8["compliance/v8"]
        Rules["rules/ — 15 files, 21 rule IDs<br/>(rest-pause, meal-break, student-visa,<br/>ordinary-hours-avg, min-engagement, ...)"]
        Orchestrator["runV8Orchestrator (orchestrator/index.ts)"]
        Dormant["orchestrator/{batch,bidding,swapping,conflict-resolver}<br/>— built, zero callers, NOT part of the live path"]
    end
    subgraph EdgeFixed["Edge Function evaluate-compliance — fixed 4-check subset only"]
        FixedCheck["overlap + 48h weekly + 11h rest + qualification"]
    end

    Bidding --> Orchestrator
    Swapping --> Orchestrator
    Manual --> Orchestrator
    AutoSched -.->|"commit validation only, via V8SwapEngine wrapper, bypasses Orchestrator"| Rules
    ReserveList --> FixedCheck
    Orchestrator --> Rules
    Rules --> Result["Full 15-rule result"]
    Result --> Bidding
    Result --> Swapping
    Result --> Manual
    Result -.->|"BLOCKING, automatic"| RejectionLog[compliance_rejections table]
    FixedCheck --> ReserveList
```

**Corrected from an earlier pass of this diagram — see Ch. 12 for full detail.** Reserve List and the two AutoPilot Edge Function workers (`auto-approve-swaps`, `auto-assign-bids`) do **not** run the full 15-rule engine — they call a separately-deployed Edge Function with a fixed 4-check subset (overlap, 48h weekly cap, 11h rest, qualification), a documented v1 gap per those workers' own READMEs. The autoscheduler's commit-time validation *does* run the full rule set, but via a different wrapper (`V8SwapEngine`) that bypasses `runV8Orchestrator` — so its BLOCKING results are never written to `compliance_rejections`, unlike manual assign and bid/swap accept. `adapters/` is organized by protocol version (v1/v2), not by caller — the real per-caller input builders live in `planning/unified/compliance/input-builder.ts`. The `orchestrator/{batch,bidding,swapping,conflict-resolver}` subfolders implement a sophisticated global-optimization layer with zero production callers today.

**Structural rule confirmed (Verified, via Ch. 1 §2.4/2.9/2.11/2.12/2.10):** every caller module goes through the same `v8/orchestrator` + `v8/rules` — there is no second, independently-implemented compliance path. This is the platform's single most important architectural invariant; Ch. 12 (Compliance Engine deep dive) will document each rule in `rules/` individually.

## 10. Notification flow

```mermaid
graph LR
    subgraph Sources["Domain events (trigger-fired)"]
        Shift[shifts UPDATE]
        Bid[shift_bids / offers UPDATE]
        Swap[shift_swaps / swap_requests UPDATE]
        TS[timesheets UPDATE]
        Leave[leave_requests UPDATE]
        Broadcast[broadcasts INSERT]
    end
    subgraph TriggerFns["Trigger functions"]
        T1[trg_shift_notifications / trg_emergency_assignment_notification_fn / trg_employee_drop_notification / trg_offer_expired_notification_fn / trg_bidding_expired_notification_fn]
        T2[trg_bid_outcome_notification]
        T3[trg_swap_outcome_notification_fn / trg_shift_swap_outcome_notification / trg_swap_expired_notification_fn]
        T4[trg_timesheet_decision / trg_timesheet_outcome_notification]
        T5[trg_leave_request_outcome_notification]
        T6[trg_fan_out_broadcast → trg_broadcast_to_notifications]
    end
    Shift --> T1
    Bid --> T2
    Swap --> T3
    TS --> T4
    Leave --> T5
    Broadcast --> T6
    T1 --> notify_user["notify_user() — writes to notifications table"]
    T2 --> notify_user
    T3 --> notify_user
    T4 --> notify_user
    T5 --> notify_user
    T6 --> notify_user
    notify_user --> Realtime["notifications table (realtime-enabled)"]
    Realtime --> Client["core/pages/MyNotificationsPage.tsx + AppSidebar badge"]
```

All notification delivery is **database-trigger-driven, not application-code-driven** — the frontend never calls a "send notification" function directly; it only ever reacts to writes on domain tables, and Postgres triggers decide what (if anything) gets notified. This means notification rules (Ch. 13) live entirely in SQL, not in `src/`.

## 11. Authentication flow

```mermaid
sequenceDiagram
    participant U as User
    participant SB as Supabase Auth
    participant AC as AuthContext (auth module)
    participant AS as auth.service.ts (platform/auth)
    participant PG as Postgres

    U->>SB: sign in (email/password)
    SB-->>AC: session + JWT
    AC->>AS: fetch effective permissions
    AS->>PG: resolve_user_permissions() RPC
    PG-->>AS: active certificates, contract, scope tree
    AS->>AS: getEffectiveLevel() — active cert → superuser fallback → contract level → 'alpha'
    AS-->>AC: User { highestAccessLevel, role (derived, display-only), ... }
    Note over AC: role = zeta/epsilon→admin, delta/gamma→manager, beta→teamlead, else member
    U->>Router: navigate to protected route
    Router->>Router: AuthLayout (authenticated? active contract?)
    Router->>Router: FeatureGate(feature) → useAuth().hasPermission(feature)
    Router-->>U: render page OR redirect /unauthorized
```

Full role/permission model, the two dead-code parallel systems, and the per-feature-area permission matrix are Ch. 8.

## 12. What's not yet diagrammed accurately

Attendance lifecycle (clock-in/out → auto clock-out → timesheet generation), the shift FSM's full transition table, the timesheet review-gate lifecycle, and the leave↔shift conflict-resolution flow are now traced end-to-end with source citations in **Ch. 7 (State Machines)** — §1 (shift FSM), §2.5 (clock-in/out mechanics), §4.3 (leave/shift conflicts). Treat Ch. 7 as authoritative over any inference in this chapter where the two differ; this chapter (§6, scheduling engine; §9, compliance engine structure) is still a first pass pending a dedicated Ch. 3/12 module deep-dive.
