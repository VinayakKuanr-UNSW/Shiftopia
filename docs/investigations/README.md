# Investigations

A chronological trail of point-in-time audits, forensic reviews, and implementation plans. **Each entry describes what was true/found/decided on its date — it is not updated afterward.** If something here describes a bug or gap, check `rulebook/README.md`'s findings tables (or the code) for its current status before assuming it's still open.

| Date | Doc | What it found/decided | Status as of last check |
|---|---|---|---|
| 2026-04-29 | [production-hardening-pass.md](2026-04-29_production-hardening-pass.md) | Test-suite/CI/observability/RLS hardening pass: 35→0 failing tests, CI added, Sentry wired, 11→0 Supabase security ERRORs, `auth_rls_initplan` 73→0. | The `auth_rls_initplan` fix has since been **reintroduced 3 times** per `rulebook/17-production-audit.md` — don't assume this pass's counts still hold. |
| 2026-06-24 | [auto-assign-bids-and-swap-approval/](2026-06-24_auto-assign-bids-and-swap-approval/README.md) | Multi-doc audit → implementation plan → draft migrations for merging two divergent Auto-Assign engines and adding an event-driven Auto-Approve-Swaps worker, all routed through the `sm_apply_shift_op` gateway. | **Draft migrations are not applied to prod.** `rulebook/12-compliance-engine.md` §1.2 confirms the underlying gap (fixed 4-check compliance subset on these paths) is still open. |
| 2026-07-09 | [pay-engine-eba-phase3-closeout.md](2026-07-09_pay-engine-eba-phase3-closeout.md) | Close-out record for EBA cost-estimator remediation phases 1–3. | Completed record — see `rulebook/05-business-rules.md` for current PAY- rule IDs. |
| 2026-07-10 | [eba-pay-leave-scheduler-audit.md](2026-07-10_eba-pay-leave-scheduler-audit.md) | Deep audit: pay engine compliant; leave↔scheduler integration didn't exist at the time. | Since fixed per project memory (leave → solver via `unavailable_dates` + `V8_LEAVE_CONFLICT`) — treat this doc as the "before" state only. |
| 2026-07-21 | [reserve-list-audit-and-implementation-plan.md](2026-07-21_reserve-list-audit-and-implementation-plan.md) | Discovery-only plan for a not-yet-built Reserve List feature; found the emergency-publish path bypasses the mutation gateway (unprotected race). | Most recent audit in this folder — check current Reserve List code/rulebook before assuming it's still all unbuilt. |
| 2026-07-28 | [timesheet-min-engagement-billable-floor-plan.md](2026-07-28_timesheet-min-engagement-billable-floor-plan.md) | EBA min-engagement billable-floor plan. | Marked IMPLEMENTED in the doc itself (2026-07-28) — verify it's been committed if that matters for your task. |

## Subfolder

- **[2026-06-24_auto-assign-bids-and-swap-approval/](2026-06-24_auto-assign-bids-and-swap-approval/README.md)** — the only multi-document investigation here (audit → binding contracts → two feature plans → test strategy → rollout backlog → draft SQL). Has its own `README.md` index; read `AUDIT.md` first, then `00`–`04` in order.

## Adding a new investigation

Single-doc audit → `YYYY-MM-DD_short-description.md` directly in this folder, plus a row in the table above. Multi-doc (audit + plan + drafts) → its own `YYYY-MM-DD_short-description/` subfolder with its own `README.md` index, following the pattern of `2026-06-24_auto-assign-bids-and-swap-approval/`.
