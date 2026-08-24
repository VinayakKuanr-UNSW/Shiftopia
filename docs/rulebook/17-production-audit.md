# Chapter 17 — Production Audit

**Confidence:** the majority of this chapter consolidates findings already Verified in Ch. 1–2, 5–8, 12 (cited inline via **Source**); Performance/Scalability/Hardcoded Values are new this chapter, researched against both static code and the live Postgres project's advisors/`pg_cron` schedule/row counts — marked Verified where a live-DB query backs the claim.

## Current live scale (context for every "at what threshold does this bite" framing below)

1 organization, 75 `shifts`, 107 `profiles`, 219 `shift_events`, 30 `compliance_rejections`. **Nothing in this chapter is causing a problem today** — every finding below is an architectural landmine with a calculable activation threshold, not a current incident.

---

## 1. Dead code

| Item | Detail | Source |
|---|---|---|
| `src/modules/auth/ui/ProtectedRoute.tsx` | Role/feature guard HOC, confirmed unimported anywhere — superseded by `AuthLayout`+`FeatureGate` | Ch.1 §3, Ch.8 §2 |
| `src/modules/core/ui/layout/sidebar/NavigationLinks.tsx` | Near-duplicate nav component, exported from a barrel nothing imports | Ch.1 §3 |
| `src/modules/auth/contexts/AuthContext.tsx` | Duplicate `Role`/`AuthContext`, explicitly commented `// DEBUG VERSION`, unimported | Ch.1 §2.1, Ch.8 §2 |
| `src/platform/auth/access.policy.ts` | Dead permission spec that **disagrees** with the live one — easy to cite by mistake | Ch.8 §2 |
| `AuthProvider.hasAccess()` | Exposed on context, never called anywhere | Ch.8 §2 |
| `src/modules/timesheets/api/timesheets.write.api.ts` | Full in-memory mock state machine (including a phantom `LOCKED` status), no Supabase calls, not the prod write path | Ch.6/Ch.7 §2.1 |
| `create_profile_for_user()` RPC | Richer than the actually-wired `handle_new_user()` trigger; never called | Ch.6 §2 |
| `hr.employees` table | No FK to `auth.users`, read-only RLS, zero live callers | Ch.6 §2 |
| Large `sm_*`/`*_rpc` graveyard | Pre-gateway single-purpose RPCs superseded by `sm_apply_shift_op`; several explicitly raise `LEGACY_RPC_DISABLED_V3` so old callers fail loudly | Ch.1 §4.4 |
| `orchestrator/{batch,bidding,swapping,conflict-resolver}/` | Sophisticated global-optimization layer, zero callers outside its own package, not re-exported | Ch.12 §1.2 |
| `get_manager_scorecard`/`get_bidding_kpis`/`get_marketplace_kpis` panels | Fully built hooks+components, each self-labeled "not wired into any page" | Ch.6 §15 |
| `VirtualRosterGrid.tsx` | Hand-rolled scroll-windowing component ("1000+ shift cards"), never imported anywhere — `PeopleModeGrid.tsx` (the live grid) uses `@tanstack/react-virtual` instead | New, this chapter |
| `employee_leave_balances` table | Empty, RLS-locked service-role-only, still fully typed in generated TS — landmine for a future dev reaching for the wrong table | Ch.7 §4.6 |

---

## 2. Duplicate logic

| Item | Detail | Source |
|---|---|---|
| Four overlapping automatic shift-state sweep mechanisms | `process_shift_timers()`, `sm_run_state_processor()`, `sm_handle_auto_clock_out()`, and two edge functions — subtly different guards on the same transitions | Ch.7 §1.3 |
| Two competing client permission specs | `access.policy.ts` vs. `useAuth.hasPermission` — disagree on the Insights threshold | Ch.8 §2 |
| Two edit-count badges that can disagree | `timesheets.edit_count` (DB column) vs. History popover's independently-computed count | Ch.7 §2.4 |
| Six files locally redeclare the Sydney timezone constant | Instead of importing the one canonical export from `date.utils.ts` — three more name it `ICC_TIMEZONE` | New, this chapter |
| Payroll's 3-phase fetch is sequential when it could be parallel | `shiftInputs → leadInInputs → leaveInputs` awaited one after another despite no interdependency — a latency bug more than a duplication one, listed here for completeness | New, this chapter (see §9) |

---

## 3. Hardcoded values

**Genuinely risky — none found.** Searched the tracked repo for JWT/API-key-shaped strings, hardcoded org/dept UUIDs in application logic, and real hardcoded emails: zero hits. `.env*` correctly gitignored. This category came back clean — worth stating plainly rather than manufacturing a finding.

| Item | Detail | Risk framing |
|---|---|---|
| `'Australia/Sydney'` hardcoded in 36 places / 24 files | `organizations` table has **no `timezone` column at all** — a code fix alone can't parameterize this without a schema change first. Every EBA calculation (weekly caps, rest gaps, spread-of-hours) is pinned to Sydney's DST calendar | Fine for today's single-org AU deployment; would silently compute wrong compliance math the moment a second org anywhere else (even Perth, no DST) is onboarded |
| `ICC_TIMEZONE` naming in 3 files | Betrays the platform was built around one specific venue (Sydney ICC), not just one timezone | Same as above |
| `.env.example` omits `VITE_OPTIMIZER_URL` | The variable itself is correctly used (`optimizer.client.ts` reads `import.meta.env.VITE_OPTIMIZER_URL`, falls back to `localhost:5005`) — the gap is purely in the onboarding checklist | A production deploy following `.env.example` would silently point the auto-scheduler at localhost |
| One `pg_cron` job embeds the anon key as a literal string | While the worker secret in the same job body correctly pulls from Vault | Low risk (anon key is designed public-safe/RLS-gated) — inconsistent practice, not a leak |
| `evaluate-compliance` Edge Function URL, optimizer client URL | Both confirmed properly environment-configurable, **not** hardcoded — included here only to correct an initial hypothesis before research | Non-finding |

---

## 4. Missing / stale documentation

| Item | Detail | Source |
|---|---|---|
| `HANDOVER.md` + `docs/investigations/2026-06-24_auto-assign-bids-and-swap-approval/*.md` | Still say `is_manager_or_above()` is "BROKEN in prod" — it was fixed, and a 2026-07-30 migration relies on it directly | Ch.8 §4 |
| `GrossPayPage.tsx` header comment | Claims the route is "intentionally NOT wired into the route table" — it is (`AppRouter.tsx:199`) | Ch.6 §12 |
| A leave-overlap-constraint migration header | Says "NOT YET APPLIED — pending sign-off" for a constraint that has been live and enforcing since the commit that shipped it | Ch.7 §4.6 |
| Two schema eras with thin cross-referencing | A squashed Oct-2025 baseline followed by 60 hand-written migrations, several existing purely to *restore* what the squash silently dropped — this pattern is the traceable root cause of both live bugs fixed this session | Ch.1 §5, Ch.7 §5 |

---

## 5. Inconsistent business rules

| Item | Detail | Source |
|---|---|---|
| `structural-rules.ts`'s overlap boundary | Uses `end_time <= start_time` for its cross-midnight heuristic (treating `start===end` as a full 24h shift), while the shared `shiftDurationMinutes` helper most other rules use is strict `<` (treating it as zero-length) | Ch.12 §2 |
| `employment-rules.ts` filename/content mismatch | Despite the name, implements Qualifications & Skills checks (`V8_QUALIFICATIONS`), not employment-type rules | Ch.12 §2 |
| `/compliance/rejections` gate mismatch | No client-side `FeatureGate`, while its RLS is delta+-only — excludes gamma, unlike almost every other manager-gated table in the schema | Ch.8 §5/§6 |
| Self-approval asymmetry | Leave approval explicitly blocks self-approval; leave rejection and timesheet approve/reject have no equivalent self-check found | Ch.7 §4.6, Ch.5 ATT-0013 |
| Terminated-employee pricing asymmetry | Payroll's worked-shift adapter filters contracts to `Active` only (losing apprentice/trainee/SWS context for a leaver's final shifts); the leave-pricing adapter has no such filter | Ch.6 §12 |

---

## 6. Conflicting implementations

| Item | Detail | Source |
|---|---|---|
| Client shift-FSM vs. DB shift-FSM | Two independently-maintained lineages, no automated parity test against the live DB function — currently reconciled by coincidence (both happen to agree on the reachable state set) | Ch.7 §1.4 |
| Legacy marketplace tables vs. unified `planning_requests` model | The unified model is real, working code with zero routed-UI callers; every live route hits the legacy tables directly | Ch.7 §3.1 |
| Full 21-rule compliance engine vs. fixed 4-check Edge Function subset | 3 of 6 real compliance-check entry points (Reserve List, both AutoPilot workers) use the narrower set — a documented, accepted v1 gap, not hidden, but a real enforcement inconsistency across paths | Ch.12 §1.2 |
| Coarse legacy RBAC policies vs. newer fine-grained RBAC policies, same tables | `has_permission()`/`user_has_delta_access()` (legacy) and `user_has_action_in_scope()` (newer, `rbac_permissions`-backed) both gate `shifts`/`rosters` writes simultaneously — functionally OR'd (fails safe), but doubles the policy-evaluation cost on every write and is a genuine second system nobody has consolidated | New, this chapter — see §9 |

---

## 7. Technical debt

| Item | Detail | Source |
|---|---|---|
| The Oct-2025 schema-squash drift pattern | Both live bugs found and fixed this session (RLS gap, `approve_trade`) trace to the same root cause: something correct silently dropped at the squash boundary, never re-verified against the pre-squash archive | Ch.7 §5, Ch.8 §5 |
| Two leave types live in prod with zero migration trace | `religious_cultural`/`gender_affirmation` — full accrual logic and seed data applied directly to prod, never committed | Ch.6/Ch.7 §4.4 |
| An RLS performance fix was reintroduced (regressed) three times | `20260719000500` mechanically fixed the `auth_rls_initplan` anti-pattern (unwrapped `auth.uid()` calls) schema-wide — three *later* migrations reintroduced the identical unwrapped pattern, including one from the day before this rulebook's own research began, on the very tables this session's RLS fix touched | New, this chapter — see §9 |
| N+1 write patterns in several bulk operations | `duplicateTemplate` (fully serial, no `Promise.all`, nested loop), `bulkPublishShifts`, `useBulkUpdateShiftTimes` (explicit code comment: "no bulk RPC for this yet") | New, this chapter — see §9 |
| `shift_events` has no partitioning or archival strategy | Confirmed the `partition-manager` edge function has zero entry in the live `pg_cron` schedule (not just "the RPC it calls doesn't exist" — the function isn't even scheduled to try) | Ch.1 §4.4, confirmed live this chapter |

---

## 8. Security risks

| Item | Status | Source |
|---|---|---|
| `payroll_records_select`/`compliance_snapshots_select` RLS no-op | **FIXED 2026-07-30**, applied to prod | Ch.8 §5 |
| `_apply_shift_op_write` missing `approve_trade` branch | **FIXED 2026-07-31**, applied to prod, live-DB-tested | Ch.7 top |
| `profiles.system_role` dangling references in 5 functions | OPEN, low current blast radius (mostly dormant call sites) | Ch.8 §5 |
| `employee_leave_balances`/`shift_offers`/`roster_templates` always-true policies | OPEN, not caught by the 2026-07-19/20 hardening sweeps | Ch.8 §5 |
| `VITE_COMPLIANCE_BLOCKING_ENABLED` global kill switch | OPEN (by design) — can silently downgrade every BLOCKING compliance result to WARNING; worth knowing the current setting | Ch.12 §1.3 |
| Multi-org client-layer scope bug | **OPEN, new this chapter** — at least 13 pages read only `scope.org_ids[0]` and silently drop any additional org selection the UI otherwise allows the user to make. Same failure *shape* as the fixed RLS bug (a filter that looks like it's scoping correctly but isn't), just at the client layer instead of the DB layer — see §10 | New, this chapter — see §10 |

---

## 9. Performance risks (new this chapter — live-DB-verified where noted)

**N+1 / serial-round-trip patterns:**
- `duplicateTemplate` (`templates/state/useTemplates.ts`) — fully serial (no `Promise.all`) nested loop, one awaited insert per group then per subgroup. A 10-group × 5-subgroup template = 61 sequential round trips before batch shift inserts even start (~5-10s for one click).
- `bulkPublishShifts` — one `getShiftById` + one compliance Edge Function call per shift (parallelized via `Promise.allSettled`, but still N calls, each running the full engine regardless of an early blocking hit).
- `useBulkUpdateShiftTimes` — explicit code comment: "no bulk RPC for this yet," one RPC call per shift.
- By contrast, `bulk-action-engine.ts`'s chunked-at-20 `Promise.allSettled` pattern (used elsewhere) is the pattern the above three should have copied.

**Unpaginated computation over uncapped datasets:**
- **Grid page — the most severe finding in this category.** Fetches the full calendar year of shifts, silently truncated at an `INTERACTIVE_ROW_CAP = 8,000` limit borrowed from a different feature (the Rosters week planner) with only a `console.warn`, no UI indication. At ~22 shifts/day, an org with 30-40 active employees exceeds this cap before December — meaning the Grid's own EBA/weekly-hour compliance overlay **silently computes a wrong verdict** for the back half of the year, not just a slow page.
- Insights Performance tab renders every returned row (uncapped RPC call) into a plain unvirtualized 28-column table — 500 employees would mean 14,000 unwindowed DOM cells.
- `RejectionsPage.tsx` — `.limit(100)` with zero pagination control; once a time-window's rejection count exceeds 100, older ones become invisible with no on-screen indication.

**RLS/query-planner cost (live `get_advisors(performance)` data):**
- **102 `multiple_permissive_policies` warnings** — `shifts` alone has 7 overlapping permissive SELECT policies for role `authenticated`; `leave_requests` has 12; `swap_offers` has 12. Root cause: two parallel authorization systems (legacy `has_permission()` policies and newer RBAC `user_has_action_in_scope()` policies) coexist on the same tables for the same commands rather than having been consolidated (see §6).
- **8 `auth_rls_initplan` warnings**, and — significant — **this is a regression, not an unaddressed gap**: a 2026-07-19 migration mechanically fixed this exact anti-pattern schema-wide; three later migrations (including the RLS-fix migration from the day before this chapter's research) reintroduced the identical unwrapped `auth.uid()` pattern.
- **STABLE/VOLATILE inconsistency**: `has_permission()`, `is_admin()` (used in 13 policies), `user_has_delta_access()` (used in 11 policies) are all VOLATILE by omission, while sibling functions doing the same kind of check are correctly marked `STABLE` — blocking planner result-reuse specifically on the functions used most.
- 164 unused-index and 1 duplicate-index advisories — write-throughput cost with no offsetting read benefit.

**Payroll's unnecessary latency waterfall:** three independent data-fetch phases (`shiftInputs`/`leadInInputs`/`leaveInputs`) are awaited sequentially despite no interdependency — an easy parallelization win currently left on the table. (The per-phase queries themselves are correctly batched — this is a phase-ordering issue, not an N+1.)

**What's actually clean:** the Rosters planner's real shift-rendering grid (`PeopleModeGrid.tsx`) uses `@tanstack/react-virtual` unconditionally with no threshold guard — a positive finding worth stating, not just cataloging problems.

---

## 10. Scalability concerns (new this chapter — live-DB-verified where noted)

1. **`shift_events` has no partitioning or archival path, confirmed structurally dead.** Not partitioned in any migration; the RPC its intended partition-manager would call doesn't exist; and (new confirmation) the live `pg_cron` schedule has **no entry at all** for the partition-manager function — it was never scheduled, not just failing silently. An unbounded, append-only, every-lifecycle-transition event log with no retention mechanism.

2. **A second, client-layer instance of the "looks org-scoped but isn't" bug class.** `GlobalScopeFilter.tsx` is architecturally multi-org-ready (defaults to multi-select, selects all allowed orgs by default) — but at least 13 consumer pages (`WorkforceUtilizationView`, `RostersPlannerPage`, both Manager Bids/Swaps pages, `TemplatesPage`, and others) read only `scope.org_ids[0]`, silently dropping any additional selection. Not hypothetical: the instant a second organization exists and a user has cross-org access, ticking both org chips in the UI would silently render first-org-only data with no "showing Org A only" indication. Same failure shape as the RLS bug fixed this session (Ch. 8 §5), one layer up the stack.

3. **Hardcoded truncation limits with no user-visible warning**: the Grid page's inherited 8,000-row cap (§9) and `RejectionsPage`'s uncapped-window 100-row limit are both scalability findings as much as performance ones — data *completeness*, not just speed, silently degrades as the org grows.

---

## 11. Missing business rules / ambiguous logic

- **No formal "which organization does this data belong to" client-side contract** — see §10 finding 2. The DB has one (RLS), the client architecture assumes one (multi-select scope filter) but most consumers don't honor it.
- **`rbac_permissions` seed data — Unknown.** No `INSERT`/`COPY` for this table was found in any migration (active or archived); its `user_has_action_in_scope()`-driven `_rbac`-suffixed RLS policies are OR'd with coarser checks on the same tables, so an empty table fails safe rather than open — but whether it's actually populated in prod could not be determined by static analysis (Ch. 8 §4).
- **Current AutoPilot enablement state — Unknown without a live check.** Whether Swap/Bid/Timesheet AutoPilot are currently `enabled`/`shadow_mode` in prod determines whether several documented behaviors (Ch. 6 §6-7, §10) are actually live decision-makers today or dormant — worth a `SELECT * FROM swap_approval_rules` / `bid_approval_rules` / `timesheet_approval_rules` check before relying on any AutoPilot-related statement as current fact.
- **No distinct "Breaks" business rule** — confirmed absence, not an oversight in this rulebook; see Ch. 6 §9.

## 12. Suggested improvements / refactoring opportunities

1. Consolidate the two RBAC policy generations on `shifts`/`leave_requests`/`swap_offers` (§6, §9) — pick one (`user_has_action_in_scope()` + a seeded `rbac_permissions` looks like the intended long-term direction) and retire the other; halves the per-query policy evaluation cost on the busiest tables.
2. Add a CI check (or at minimum a lint rule) that fails a migration touching an RLS policy if it reintroduces an unwrapped `auth.uid()` call — the fix already exists once (`20260719000500`), it's been silently undone three times since.
3. Give `organizations` a `timezone` column and thread it through the compliance/scheduling calculations in place of the 36 hardcoded `'Australia/Sydney'` literals — required before any second-org onboarding, not urgent otherwise.
4. Either wire up or delete the four dormant subsystems found across this audit (payroll persistence/export, the compliance orchestrator's batch/bidding/swapping/conflict-resolver layer, the three orphaned Insights KPI panels, `partition-manager`) — each is real, working, tested code currently contributing zero production value while still carrying maintenance cost.
5. Fix the 13+ call sites reading `scope.org_ids[0]` before this becomes a second live multi-org bug, given the first one (RLS) was found and fixed reactively rather than proactively.

## 13. Production readiness assessment

**Verdict: production-ready for its current single-organization deployment, with a known and now-documented punch list — not ready to onboard a second organization without addressing §3/§10's timezone and scope-filter findings first.**

The core transactional path (shift lifecycle, marketplace, timesheets, leave, compliance gating) is well-architected: a single audited gateway for state changes, comprehensive event-sourcing, and a genuinely rigorous compliance engine with real EBA clause traceability. The two live bugs found and fixed this session were both real and both fixed same-day, which speaks to the codebase being amenable to this kind of audit, not resistant to it. The dormant-subsystem pattern (§1, §6, §12) suggests a team that builds thoroughly but doesn't always finish wiring — worth a deliberate "flip the switch or delete it" pass rather than more building.

## 14. Documentation coverage

| Metric | Value |
|---|---|
| Chapters complete (this session) | 8 of 17 (00, 01, 02, 05, 06, 07, 08, 12, 17 — 9 counting this one) |
| Chapters not started | 03, 04, 09, 10, 11, 13, 14, 15, 16 (see `README.md` for partial-credit notes — several of these have inventory-level material in Ch. 1/2 even though not formally written) |
| Live production bugs found & fixed | 2 (both same-day: RLS gap Ch.8 §5, gateway gap Ch.7 top) |
| Open findings logged (security/process/perf/scalability combined) | ~35, all cross-referenced in `README.md`'s findings tables |

## 15. Confidence score per completed chapter

| Chapter | Confidence |
|---|---|
| 00 Executive Summary | Strongly Inferred (synthesis of the rest) |
| 01 Codebase Discovery | Verified |
| 02 Architecture | Verified, with 2 corrections made in later chapters (marketplace model, compliance engine structure) |
| 05 Business Rules | Verified (consolidation of already-Verified material) |
| 06 Workflows | Verified for onboarding/payroll/breaks/reporting (fresh research); Strongly Inferred for scheduling/auto-scheduling (not re-traced line-by-line) |
| 07 State Machines | Verified, including one live-DB-tested fix |
| 08 RBAC Matrix | Verified for gate mechanisms and the fixed RLS bug; per-feature-area matrix cells individually graded V/SI/WI/U inline |
| 12 Compliance Engine | Verified |
| 17 Production Audit (this chapter) | Verified for items sourced from other Verified chapters; Verified with live-DB backing for the new Performance/Scalability/Hardcoded-Values research |

## 16. Final executive summary

Eight chapters into a seventeen-phase specification, Shiftopia's platform reveals itself as a well-engineered but incompletely-finished system: a rigorous, EBA-clause-traceable compliance engine sitting at the center of every shift mutation; a genuinely audited, event-sourced core transactional loop; and, running alongside that solid center, a consistent pattern of sophisticated subsystems built to completion and then never wired to a live caller (payroll persistence, the compliance orchestrator's optimization layer, three Insights KPI panels, event-log partitioning). Two real production bugs were found and fixed during this rulebook's research, both traceable to the same root cause — something correct silently lost at an October 2025 schema consolidation and never re-verified against its own history — which is this audit's single most actionable structural recommendation: diff current behavior against the pre-squash archive for anything else load-bearing, rather than trusting "it's in the baseline" as proof it still works. The platform is solid ground to build the remaining nine chapters on.
