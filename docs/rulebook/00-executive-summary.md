# Chapter 0 — Executive Summary

**Confidence: Strongly Inferred** (synthesized from Ch. 1/2/8 research; not yet cross-checked against every module's internal business rules — later chapters may sharpen or correct details here)

## What Shiftopia is

Shiftopia is a workforce-scheduling and labor-compliance platform for shift-based, EBA/award-governed workforces (the domain language — "sub-departments", venue "events", casual/trainee/SWS employment categories, ICC Sydney EA 2025 clause references — indicates it was built for a large events/venue operator with a unionized, multi-classification workforce). It covers the full loop from **forecasting labor demand → building and publishing rosters → letting employees self-serve (bid on open shifts, swap/trade assigned ones, request leave) → validating every change against award/EBA compliance rules → tracking attendance → converting worked time into payroll-ready gross pay → reporting on all of it.**

## Architecture in one paragraph

A React/TypeScript SPA (957 files, 17 feature modules under `src/modules/`) talks to a single Supabase Postgres project (~139 tables across `public` and a newer `hr` schema, ~336 unique functions, 92 triggers, ~433 RLS policies) directly from the client for reads, and through a small number of hardened RPC "gateways" for writes to anything state-machine-governed (shifts, swaps, bids, timesheets). A separate FastAPI/OR-Tools optimizer microservice handles auto-scheduling. Five Supabase Edge Functions run as background workers (`auto-approve-swaps`, `auto-assign-bids`, `auto-verify-timesheets`, `shift-state-processor`, `partition-manager`), driven by claim/complete job queues in Postgres, implementing an **"AutoPilot" pattern** repeated three times (Swaps, Bids, Timesheets — see Ch. 2 §7).

## What's structurally distinctive about this codebase

1. **A single unified compliance engine (`compliance/v8`) gates every shift mutation** — bidding, swapping, manual assignment, and auto-scheduling all funnel through the same rule set before a change is allowed, rather than each workflow re-implementing its own validation. This is the platform's core differentiator: the business rule is "no shift change bypasses compliance," enforced structurally, not just by convention.
2. **Everything mutable is event-sourced.** `shift_events`, `swap_audit_log`, `bid_audit_log`, `timesheet_audit_log`, `leave_request_events` are append-only (several are trigger-enforced immutable) and are the source of truth for KPIs, audit trails, and lifecycle timelines — not a bolt-on logging layer.
3. **A certificate-based, scope-bounded RBAC model** (`app_access_certificates`: 6 access levels `alpha`→`zeta` across two axes — personal vs. managerial — each scoped to an org/department/sub-department) has fully superseded an older flat `admin/manager/teamlead/member` role string, though the old string still exists as a display-only derived field and is still the *live* gate in exactly one module (Broadcasts) — see Ch. 8.
4. **Money-adjacent logic is unusually rigorous**: EBA pay rates, allowances, and trainee wage schedules are modeled as *effective-dated* rows specifically so a CPI increase or award variation doesn't corrupt historical pay estimates — not a flat rate table.
5. **The schema has visible archaeology**: a squashed October 2025 baseline followed by 60 hand-written incremental migrations, several of which exist purely to *restore* things a re-baselining pass accidentally dropped. This is a real operational risk pattern worth a new team's attention (see Ch. 1 §2.4, Ch. 8 §5) — it's how the payroll/compliance-snapshot RLS bug fixed during this rulebook's research (Ch. 8 §5) likely went undetected: the bug predates most of the deliberate hardening sprints and doesn't match the pattern (`USING(true)`) those sprints specifically searched for.

## Confirmed platform-wide gate mechanism

Every protected page is gated by exactly one mechanism: a `FeatureGate` component (`src/router/AppRouter.tsx`) checking `useAuth().hasPermission(featureString)` against a hard-coded access-level threshold table. A second, older permission spec (`access.policy.ts`) and a second route guard (`ProtectedRoute.tsx`) still exist in the codebase but are **dead code** — confirmed via exhaustive grep, not merely absent from a sample. See Ch. 8.

## Scale snapshot (as of 2026-07-30)

| Metric | Count |
|---|---|
| Frontend modules | 17 (`src/modules/*`) |
| Frontend files (`.ts`/`.tsx`) | 957 (~759K words) |
| Protected/public routes | 30 |
| DB migration files | 65 (1 baseline + 60 incremental + 5 parity scripts) |
| DB tables | ~139 (`public`) + 7 (`hr`) |
| DB views/materialized views | 17 |
| DB functions (unique) | ~336 |
| DB triggers | 92 |
| RLS policies | ~433 |
| Knowledge graph (`graphify-out/graph.json`) | 4,039 nodes / 12,057 edges |

## What this chapter does not yet cover

This is the skeleton pass (Phase 1 inventory + Phase 2 diagrams + Phase 8 RBAC — see `README.md` for full chapter status). It does not yet contain the full business-rule catalog (Phase 5), state machine specifications (Phase 7), KPI formulas (Phase 11), or the compliance rule-by-rule breakdown (Phase 12) that the original 17-phase spec calls for. Those require deeper per-module passes and are queued as next steps.
