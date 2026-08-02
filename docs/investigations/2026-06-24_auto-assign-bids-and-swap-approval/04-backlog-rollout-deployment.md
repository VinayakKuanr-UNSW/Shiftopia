# 04 — Master Engineering Backlog, Migration Strategy & Deployment Plan

**Status:** Authoritative delivery plan. Consolidates the two workstreams — **Auto-Assign Bids refactor** ([01-auto-assign-bids-refactor.md](01-auto-assign-bids-refactor.md)) and **Auto-Approve Swap Requests** ([02-auto-approve-swaps.md](02-auto-approve-swaps.md)) — into one sequenced execution plan, migration/cutover strategy, and deployment runbook.

**Binds to (do not contradict):**
- [00-contracts-and-conventions.md](00-contracts-and-conventions.md) — D1–D5, claim map §4, idempotency §5, decision enums §6, routes §7, expand/contract §8, P0/P1/P2 ranks.
- [01-auto-assign-bids-refactor.md](01-auto-assign-bids-refactor.md) — §0/§10 priority tags, §2 engine, §8 API, §9 rollback, the three binding-doc corrections (6-arg `get_shift_fsm_state`, uuid idempotency token, no `p_actor`).
- [02-auto-approve-swaps.md](02-auto-approve-swaps.md) — §6 swap-scoped backlog (Epic S), §7 deployment table. **This doc CONSOLIDATES and REFERENCES the swap slice; it does not re-author or rename it.**
- [migrations-draft/0001_assignment_audit_and_engine.sql](migrations-draft/0001_assignment_audit_and_engine.sql), [migrations-draft/0002_swap_auto_approve.sql](migrations-draft/0002_swap_auto_approve.sql) — the actual DDL/RPCs to be promoted.
- [audits/auto-assign-bids-audit-and-auto-approve-swaps-design.md](AUDIT.md) — §12 roadmap phases (Phase 0 → 3); the failure table this plan must close.

**Production reality (project memory, binding):** prod is LIVE (Supabase project `srfozdlphoempdattvtx`; planning backend deployed). Migrations were reconciled to a small committed baseline; the current authoritative gateway is [`20260623000100_shift_unassign_op.sql`](../../supabase/migrations/20260623000100_shift_unassign_op.sql). **`ALTER TYPE ADD VALUE` must be its own committed txn before any DML uses the value.** ESLint is broken repo-wide — the CI gates are **`tsc --noEmit` + vitest + `npm run build`** (+ pgTAP for SQL). `is_manager_or_above()` is BROKEN in prod — authz is cert-based (`app_access_certificates`, `user_id`, `access_level IN gamma/delta/epsilon/zeta`, `is_active=true`). Agents never write to `supabase/migrations/`; humans promote drafts.

> **One opinionated rule that orders everything below:** *No automated action (auto-assign commit, auto-approve commit) is trusted until the P0 safety layer that protects the **manual** path is already live in prod.* The transitional hardened `sm_select_bid_winner` (file A) and the always-on swap guards are the floor; the engines build on top.

---

## 1. Master Engineering Backlog

Hierarchy: **Epic → Feature → Story → Task → Acceptance Criteria (AC) → Complexity (S/M/L/XL) → Dependencies → Priority (P0/P1/P2)**. Complexity legend: **S** ≈ ≤1 dev-day, **M** ≈ 2–3, **L** ≈ 4–6, **XL** ≈ 7+. Discipline tags: FE / BE (edge+TS) / DB (SQL) / QA.

Cross-cutting naming is fixed by [00 §4](00-contracts-and-conventions.md). Assignment-* objects belong to E1–E4/E10; swap-* objects belong to E5–E7; shared infra (E8/E9) references both by name only.

---

### EPIC E1 — Harden the assignment write path (gateway-first SSoT) — **P0**

> Audit Phase 0 "stop the bleeding." This epic protects **production today**, before any engine or UI ships. It closes audit failure rows 1–6, 10, 14, 18, 19, 24, 25.

**Feature E1.F1 — Transitional hardened `sm_select_bid_winner`**
- **Story E1.F1.S1** — Promote the hardened `sm_select_bid_winner` wrapper from [0001 §8](migrations-draft/0001_assignment_audit_and_engine.sql) that delegates to `sm_apply_shift_op('select_winner')`.
  - **Tasks:** (a) human-promote the function body from draft 0001 into a real numbered migration; (b) confirm it calls the **6-arg** `get_shift_fsm_state` ([01 binding-correction #3](01-auto-assign-bids-refactor.md)); (c) confirm `fsm_op_is_legal(state,'select_winner') ⇒ S5/S6`; (d) keep original 3-arg signature so call sites are untouched; (e) preserve grants.
  - **AC:** rejects already-assigned/cancelled/deleted shift (`SHIFT_GONE`/`ILLEGAL_STATE`); rejects winner without a currently-`pending` bid (`WINNER_NOT_PENDING`, no withdrawn revival); rejects TTS<4h (`SHIFT_TIME_LOCKED`); returns the legacy `{success}` shape; QA cases 51–54 ([audit §11](AUDIT.md)) green.
  - **Complexity:** M. **Deps:** gateway `select_winner` (live). **Priority:** P0. **FE 0 / BE 0 / DB 3 / QA 2.**
- **Story E1.F1.S2** — Gateway-side `select_winner` parity patch (the documented diff in [01 §3.2/§3.3](01-auto-assign-bids-refactor.md)): add TTS≥4h + winner-pending guards to the gateway's own `select_winner` write branch so the protection holds even on direct gateway calls.
  - **AC:** gateway `select_winner` returns `WRITE_REJECTED/SHIFT_TIME_LOCKED` and `WRITE_REJECTED/WINNER_NOT_PENDING`; existing gateway tests still green; no regression to manual assign.
  - **Complexity:** M. **Deps:** E1.F1.S1 (same deploy window). **Priority:** P0. **FE 0 / BE 0 / DB 2 / QA 1.5.**

**Feature E1.F2 — Re-point live write callers at the gateway (kill the client decision loop's RPC dependency)**
- **Story E1.F2.S1** — `bidding.api.ts:updateBidStatus` stops calling `sm_select_bid_winner` directly; routes through the existing `selectBidWinnerViaGateway` → `applyShiftOp('select_winner')` ([01 §1.5](01-auto-assign-bids-refactor.md), [bidding.api.ts:339](../../src/modules/planning/bidding/api/bidding.api.ts#L339)).
  - **AC:** manual winner-select goes through CAS+FSM; `tsc` clean; vitest for `bidding.api` green; conflict envelope mapped to UX.
  - **Complexity:** M. **Deps:** E1.F1. **Priority:** P0. **FE 1 / BE 1 / DB 0 / QA 1.**
- **Story E1.F2.S2** — Manual `handleAssign` in `OpenBidsView/index.tsx` re-pointed at `selectBidWinnerViaGateway` with `expectedVersion` optimistic guard; conflict → re-read + re-open compliance panel ([01 §3.7](01-auto-assign-bids-refactor.md), [index.tsx:774](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L774)).
  - **AC:** two-writer race resolves by CAS (audit §4 rows 1/2/19); no double-assign in a 2-tab manual test; `build` green.
  - **Complexity:** M. **Deps:** E1.F2.S1. **Priority:** P0. **FE 2 / BE 0 / DB 0 / QA 1.**

**Definition of Done (E1):** `tsc` clean; vitest green incl. QA 51–54; `build` green; pgTAP for `sm_select_bid_winner` + gateway `select_winner` guards green; a `shift_events` row emitted on each commit; manual two-writer race demonstrably one-winner.

---

### EPIC E2 — Server-side Auto-Assign engine (Edge fn `auto-assign-bids` + run model) — **P1**

> Audit Phase 1 (R3) + Phase 2 (R2). Decision D2: MERGE `runBidSelection` brain with live server-side data, commit via gateway. Closes audit rows 9, 11, 15, 16, 21, 23, 27, 28, 29, 31.

**Feature E2.F1 — Run lifecycle RPCs + audit tables (DB foundation)**
- **Story E2.F1.S1** — Promote `assignment_runs` / `assignment_decisions` / `assignment_events` + `sm_assignment_run_start` / `sm_assignment_run_finish` + `aa_user_manages_org` from [0001](migrations-draft/0001_assignment_audit_and_engine.sql).
  - **Tasks:** author numbered migration; text+CHECK status/outcome enums (NOT native — avoids `ALTER TYPE ADD VALUE`, [01 §6](01-auto-assign-bids-refactor.md)); partial indexes; RLS read-only via `aa_user_manages_org`; `UNIQUE(run_id,shift_id)`.
  - **AC:** tables expand-safe; manager-only RLS verified; `run_start` PENDING→RUNNING with cert authz (NULL caller = service role allowed); `run_finish` terminal-status guarded; rollback script restores clean state.
  - **Complexity:** L. **Deps:** E1 (gateway path stable). **Priority:** P1. **FE 0 / BE 1 / DB 4 / QA 2.**

**Feature E2.F2 — Edge Function `auto-assign-bids` (the merged engine)**
- **Story E2.F2.S1** — Scaffold `supabase/functions/auto-assign-bids/{index.ts,engine.ts}`: authn (manager JWT) + authz (`aa_user_manages_org`/cert), service-role snapshot client, CORS, `run_start`/`run_finish` bracketing ([01 §2.4](01-auto-assign-bids-refactor.md)).
  - **AC:** 403 for non-manager scope; run row opened/closed; never leaves a run `RUNNING` on throw (D5 fail-closed → `ABORTED`).
  - **Complexity:** L. **Deps:** E2.F1. **Priority:** P1. **FE 0 / BE 4 / DB 0 / QA 2.**
- **Story E2.F2.S2** — `loadSnapshot`: one consistent service-role read of open shifts (S5/S6), pending bids (FCFS), bidder existing shifts (org-scoped, −30d/+14d), employee context (visa via `bool_or`, not `.maybeSingle()` — fixes audit S3/row 12), F3 debts ([01 §2.3](01-auto-assign-bids-refactor.md)).
  - **AC:** RLS-blind full schedules (fixes row 31); org filter on existing-shift query (row 26); visa aggregation never throws on >1 license.
  - **Complexity:** L. **Deps:** E2.F2.S1. **Priority:** P1. **FE 0 / BE 4 / DB 1 / QA 2.**
- **Story E2.F2.S3** — `buildBiddingInput` populating **real** `required_qualifications` (licenses+skills) and `role_id` on candidate AND existing shifts (R4/R5, fixes audit row 6 — the P0 qual/role bug, now structurally closed server-side) ([01 §3.4/§3.5](01-auto-assign-bids-refactor.md)).
  - **AC:** unqualified bidder yields a `BLOCKING` hit and is excluded; role-mismatch excluded; parity with the manual bucket-D path.
  - **Complexity:** M. **Deps:** E2.F2.S2. **Priority:** **P0** (safety-critical even though it lives in the P1 engine — see §6 sequencing note). **FE 0 / BE 2 / DB 0 / QA 2.**
- **Story E2.F2.S4** — Host `runBidSelection` unchanged; `commitWinnerWithRetry` per-shift gateway commit with bounded CAS retry, deterministic `shift_id ASC` lock order, outcome mapping to [00 §6](00-contracts-and-conventions.md) enum, `uuid_generate_v5` idem token in `extensions` schema ([01 §2.4/§5](01-auto-assign-bids-refactor.md)).
  - **AC:** `VERSION_CONFLICT` → re-read/re-decide/skip-if-filled; `SHIFT_TIME_LOCKED`→`SKIPPED_LOCKED`; `WINNER_NOT_PENDING`→`SKIPPED_NO_ELIGIBLE`; replay returns `IDEMPOTENT_REPLAY` (no double-commit); never throws (records `ERROR`).
  - **Complexity:** L. **Deps:** E2.F2.S3. **Priority:** P1. **FE 0 / BE 5 / DB 0 / QA 3.**
- **Story E2.F2.S5** — Dry-run path: persist decisions `committed=false`, never touch `shifts`, return preview ([01 §8.1](01-auto-assign-bids-refactor.md)).
  - **AC:** dry-run mutates zero shift rows; preview lists winner+runners-up+reason+f3_debt; `summary` matches decisions.
  - **Complexity:** M. **Deps:** E2.F2.S4. **Priority:** P1. **FE 0 / BE 2 / DB 0 / QA 1.5.**

**Feature E2.F3 — Client cutover (delete the decision loop)**
- **Story E2.F3.S1** — Delete `handleAutoAssign` decision loop (~196 lines) in `OpenBidsView/index.tsx`; replace with thin `functions.invoke('auto-assign-bids')` POST + `lastRunId` state ([01 §1.4](01-auto-assign-bids-refactor.md), [index.tsx:794](../../src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx#L794)).
  - **AC:** button JSX + `onAutoAssignReady` contract unchanged; toast renders run summary; cache invalidation on success; `tsc`/`build` green; no remaining client `sm_select_bid_winner` import.
  - **Complexity:** M. **Deps:** E2.F2.S4. **Priority:** P1. **FE 3 / BE 0 / DB 0 / QA 1.5.**

**Feature E2.F4 — Run cursor / resumability (scale)** — **P2**
- **Story E2.F4.S1** — `assignment_runs.cursor` advance per decision; re-invoke resumes after `last_shift_id`; optional `pg_cron` drain ([01 §2.5](01-auto-assign-bids-refactor.md)).
  - **AC:** crash mid-run resumes with zero double-commit (idem layer 1 gateway + layer 2 `UNIQUE(run_id,shift_id)`); >30k pairs handled.
  - **Complexity:** L. **Deps:** E2.F2.S4. **Priority:** P2. **FE 0 / BE 3 / DB 1 / QA 2.**

**Definition of Done (E2):** `tsc` clean; vitest green incl. engine unit + commit-retry tests; `build` green (edge fn deploys); pgTAP for `sm_assignment_run_*` green; every commit emits `shift_events` + `assignment_events`; dry-run + committed run both emit `assignment_decisions`; run dashboard live (E8).

---

### EPIC E3 — Assignment audit & rollback — **P1**

> Audit R5 / U5. Closes rows 24, 32; gives auto-assign the undo it lacks.

**Feature E3.F1 — Decision audit completeness**
- **Story E3.F1.S1** — `writeDecision` records winner, ordered runners-up, reason, `rule_hits` (V8Hit[] + F3/win-penalty trace), `composite_score`, outcome enum, engine/policy version, `version_before/after`, `idempotency_key` ([01 §3.9/§7.2](01-auto-assign-bids-refactor.md)).
  - **AC:** every decided shift has exactly one decision row; "why did X win?" answerable; `composite_score BETWEEN 0..100`; version monotone CHECK holds.
  - **Complexity:** M. **Deps:** E2.F2.S4. **Priority:** P1. **FE 0 / BE 2 / DB 0 / QA 1.5.**

**Feature E3.F2 — Run rollback**
- **Story E3.F2.S1** — Promote `sm_assignment_run_rollback` ([0001 §7](migrations-draft/0001_assignment_audit_and_engine.sql)); revert S4→S5 only for shifts this run assigned, unchanged (`version=version_after`), TTS≥4h, not traded; audit-preserving ([01 §9](01-auto-assign-bids-refactor.md)).
  - **AC:** partial-safe (skips `EDITED_SINCE`/`TRADED_SINCE`/`TTS_LOCKED`/`GONE`/`STATE_*`); decisions never deleted; `assignment_events('RUN_ROLLED_BACK')` + per-shift `SHIFT_ROLLBACK` emitted; CAS-guarded so concurrent change loses.
  - **Complexity:** L. **Deps:** E2.F1, E3.F1.S1. **Priority:** P1. **FE 0 / BE 1 / DB 4 / QA 2.5.**
- **Story E3.F2.S2** — `POST …/run/{run_id}/rollback` endpoint + `GET …/run/{run_id}` viewer endpoint ([01 §8.2/§8.3](01-auto-assign-bids-refactor.md)).
  - **AC:** rollback returns `{reverted[],skipped[]}`; GET returns run + decisions; cert-authorized.
  - **Complexity:** M. **Deps:** E3.F2.S1. **Priority:** P1. **FE 0 / BE 2 / DB 0 / QA 1.**

**Definition of Done (E3):** pgTAP for rollback skip-reasons + audit preservation green; vitest for endpoints green; rollback emits audit rows; no decision-row deletion under any path.

---

### EPIC E4 — Fairness engine (auto-assign) — **P2**

> Audit R2 fairness; [01 §4](01-auto-assign-bids-refactor.md). Deterministic, recorded.

**Feature E4.F1 — Composite scoring + F3 + anti-gaming**
- **Story E4.F1.S1** — Wire scorer weights (.40/.30/.20/.10), F3 `denied_preferences` boost (bounded, recorded; explicit `f3_degraded` on ledger error — fixes audit F4), static bulk-bidder penalty, dynamic win penalty + hard `max_wins_per_employee` cap, deterministic tie-breaks ([01 §4.1–§4.6](01-auto-assign-bids-refactor.md)).
  - **AC:** identical input ⇒ identical output (bid_id total order); F3 ledger failure degrades explicitly not silently; win-cap enforced; every component recorded in `rule_hits`.
  - **Complexity:** L. **Deps:** E2.F2.S4. **Priority:** P2. **FE 0 / BE 3 / DB 0 / QA 2.5.**

**Definition of Done (E4):** vitest covers each anti-gaming vector (audit §4.6 table); determinism property test green; `composite_score` + boosts persisted; `tsc`/`build` green.

---

### EPIC E5 — Swap auto-approve policy + queue + worker — **P0/P1**

> **CONSOLIDATES [02 §6 Feature S1/S2/S3](02-auto-approve-swaps.md) — do not re-author.** Audit Phase 3. Shadow-first (D3).

**Feature E5.F1 — Policy & schema foundation** *(maps [02] Feature S1)* — **P0**
- **Story E5.F1.S1** *(= [02] S1.1)* — Promote `0002`: `swap_approval_rules`, `swap_decisions`, `swap_audit_log`, `swap_review_queue` + `review_flag`/`auto_decision_id` columns + `swap_auto_decision_kind`/`swap_queue_status` enums (minted fresh, no `ADD VALUE`) + immutability/version triggers + RLS ([0002](migrations-draft/0002_swap_auto_approve.sql)).
  - **AC:** expand-safe; org-admin-only RLS on rules; `swap_audit_log` rejects UPDATE/DELETE; partial-unique pins one org-default + one per (org,dept); rollback restores clean.
  - **Complexity:** L. **Deps:** gateway `approve_trade`/`reject_trade` (live). **Priority:** P0. **FE 0 / BE 1 / DB 3 / QA 1.**

**Feature E5.F2 — Enqueue + queue worker** *(maps [02] Feature S2)* — **P0/P1**
- **Story E5.F2.S1** *(= [02] S2.1)* — `trg_enqueue_swap_auto_decision` transactional outbox on `MANAGER_PENDING` → `swap_review_queue` (idempotency key per [00 §5](00-contracts-and-conventions.md), `ON CONFLICT DO NOTHING`).
  - **AC:** exactly one queue row per version-tuple per pending transition; missing policy ⇒ `policy_version=0` fail-closed; `ENQUEUED` audit row.
  - **Complexity:** M. **Deps:** E5.F1.S1. **Priority:** P0. **FE 0 / BE 0.5 / DB 1.5 / QA 1.**
- **Story E5.F2.S2** *(= [02] S2.2)* — Edge fn `auto-approve-swaps`: claim (`FOR UPDATE SKIP LOCKED`), load swap+shifts+rosters, run guards→solver→eligibility, call `sm_swap_auto_decide`, backoff + DLQ→MANUAL ([02 §1.2](02-auto-approve-swaps.md)).
  - **AC:** at-least-once with idempotent commit; crash mid-run = no partial; DLQ→MANUAL after `max_attempts`; p95 < 2s/swap; lease reclaim works.
  - **Complexity:** XL. **Deps:** E5.F1.S1, E5.F2.S1, E5.F3 (engine). **Priority:** P1. **FE 0 / BE 6 / DB 1 / QA 3.**

**Feature E5.F3 — Eligibility engine** *(maps [02] Feature S3)* — **P0**
- **Story E5.F3.S1** *(= [02] S3.1)* — `evaluateEligibility` pure module: §3 rules (role/cert/location/pay+delta/duration/fatigue-delegated/OT/overlap/coverage/availability/confidence), always-on forcing ([02 §3](02-auto-approve-swaps.md)).
  - **AC:** each rule honours its mode; always-on unconfigurable; payroll delta in output; deterministic; cert check closes audit F-5/R4.
  - **Complexity:** L. **Deps:** none (pure). **Priority:** P0. **FE 0 / BE 4 / DB 0 / QA 3.**
- **Story E5.F3.S2** *(= [02] S3.2)* — Decision matrix resolver (reject>review>approve) + pre-gates P1–P3 + post-gates G1–G3 ([02 §2](02-auto-approve-swaps.md)).
  - **AC:** every matrix row covered (QA 13–20); fail-closed on throw; kill-switch/shadow short-circuit correct.
  - **Complexity:** M. **Deps:** E5.F3.S1. **Priority:** P0. **FE 0 / BE 2 / DB 0 / QA 2.**

**Feature E5.F4 — Terminal commit RPC**
- **Story E5.F4.S1** — Promote `sm_swap_auto_decide` ([0002 §6](migrations-draft/0002_swap_auto_approve.sql)): upsert-on-key, kill-switch/shadow respect, gateway dispatch, audit↔op atomic, fail-closed.
  - **AC:** idempotent replay no-ops; `SHADOW` writes decision+`SHADOW_SUPPRESSED`, no shift change; `AUTO_APPROVE`→`approve_trade` CAS; `GATEWAY_REFUSED` not marked committed (re-queue path).
  - **Complexity:** L. **Deps:** E5.F1.S1. **Priority:** P1. **FE 0 / BE 0.5 / DB 3 / QA 2.**

**Definition of Done (E5):** `tsc` clean; vitest green incl. QA 1–24; `build` green (edge fn deploys); pgTAP for `sm_swap_auto_decide` + enqueue trigger green; every decision emits `swap_decisions` + `swap_audit_log`; idempotency dup test = single commit; metrics dashboard live (E8).

---

### EPIC E6 — Swap audit & revert — **P1**

> CONSOLIDATES [02 §6 Feature S5](02-auto-approve-swaps.md).

**Feature E6.F1 — Revert + notifications parity** *(maps [02] S5.2)*
- **Story E6.F1.S1** — Promote `sm_swap_auto_revert` ([0002 §7](migrations-draft/0002_swap_auto_approve.sql)); inverse reassignment via `sm_approve_peer_swap`, time-lock guarded; notifications via existing `trg_swap_outcome_notification`.
  - **AC:** only a committed `AUTO_APPROVE` revertible; restores prior assignment; `ALREADY_REVERTED` idempotent; fully audited (`REVERTED`); both parties + manager notified per terminal decision.
  - **Complexity:** L. **Deps:** E5.F1.S1, E5.F4.S1. **Priority:** P1. **FE 1.5 / BE 2 / DB 1 / QA 1.5.**

**Definition of Done (E6):** pgTAP for revert guards green; QA 32 green; `REVERTED` audit row emitted; notifications fire to both parties + manager.

---

### EPIC E7 — Abuse prevention (swaps) — **P1**

> CONSOLIDATES [02 §6 Feature S4](02-auto-approve-swaps.md) / [02 §4](02-auto-approve-swaps.md).

**Feature E7.F1 — Rate limit + pairwise frequency + cycle detection**
- **Story E7.F1.S1** *(= [02] S4.1)* — Post-gates G2/G3: swap-farming rate limit, mutual-favoritism pairwise count, compliance-avoidance, approval-manipulation, circular-swap cycle detection (`WITH RECURSIVE`) over `swap_decisions` ([02 §4.1–§4.5](02-auto-approve-swaps.md)).
  - **AC:** thresholds enforced as downgrades-to-review; ≥3-cycle → `AUTO_REJECT` `CIRCULAR_SWAP`; queries use the `swap_decisions (created_at, decision)` indexes; sampled detectors fire as expected.
  - **Complexity:** L. **Deps:** E5.F2.S2, E5.F3.S2. **Priority:** P1. **FE 0 / BE 3 / DB 1 / QA 2.**

**Definition of Done (E7):** vitest covers each detector with positive+negative cases; index plans confirmed (no seq-scan on the abuse queries); downgrades recorded in audit.

---

### EPIC E8 — Observability / metrics / alerting — **P1**

> Gate metrics for both rollouts ([02 §7](02-auto-approve-swaps.md) gate table, [01 §8](01-auto-assign-bids-refactor.md)). Shared infra.

**Feature E8.F1 — Metrics surface**
- **Story E8.F1.S1** — Read-only metric views/RPCs over `assignment_runs/decisions` + `swap_decisions/audit_log/review_queue`: auto-assign per-outcome counts, conflict/error rates, latency; swap shadow-vs-human agreement %, would-be-approve-that-human-rejected count, DLQ rate, p95 decision latency, revert rate, committed `AUTO_APPROVE` volume.
  - **AC:** each [02 §7](02-auto-approve-swaps.md) gate metric is queryable; shadow-agreement computable by joining shadow decisions to subsequent manual outcomes; cert-scoped RLS.
  - **Complexity:** L. **Deps:** E2.F1, E5.F1.S1. **Priority:** P1. **FE 0 / BE 1 / DB 3 / QA 1.5.**
- **Story E8.F1.S2** — Dashboards + alerting: auto-assign run failure alert, swap DLQ-rate alert (>1%), latency-breach alert (p95>2s), "committed AUTO_APPROVE that a manager later reverted" alert (always-on escape canary).
  - **AC:** dashboards live in dev+staging+prod; alerts route to on-call; kill-switch link embedded in the alert.
  - **Complexity:** M. **Deps:** E8.F1.S1. **Priority:** P1. **FE 2 / BE 1 / DB 0 / QA 1.**

**Definition of Done (E8):** every promote-gate metric in §5 has a live panel; alerts test-fired once; metric RLS verified.

---

### EPIC E9 — Admin UI (policy config, run viewer, review queue, rollback) — **P1**

**Feature E9.F1 — Swap policy admin** *(maps [02] S1.2)*
- **Story E9.F1.S1** — Policy editor (`PUT /rest/v1/swap_approval_rules`): kill-switch, shadow toggle, per-rule mode editor, confidence/rate fields, org-default + per-dept override ([02 §6 S1.2](02-auto-approve-swaps.md)).
  - **AC:** version bumps on save; non-admin blocked by RLS; always-on rules shown read-only.
  - **Complexity:** L. **Deps:** E5.F1.S1. **Priority:** P1. **FE 4 / BE 1 / DB 0 / QA 1.5.**

**Feature E9.F2 — Auto-assign run viewer + undo**
- **Story E9.F2.S1** — Run history + decision drill-down (`GET …/run/{id}`) + one-click "Undo run" (`…/rollback`) + dry-run preview UI ([01 §8](01-auto-assign-bids-refactor.md)).
  - **AC:** manager sees per-shift winner/runners-up/reason; undo button disabled when not rollbackable; preview before commit.
  - **Complexity:** L. **Deps:** E2.F2.S5, E3.F2.S2. **Priority:** P1. **FE 4 / BE 0.5 / DB 0 / QA 1.5.**

**Feature E9.F3 — Swap decision/review surface** *(maps [02] S5.1)*
- **Story E9.F3.S1** — Decision/audit read UI on `ManagerSwaps.page.tsx` + `review_flag` badge ([02 §6 S5.1](02-auto-approve-swaps.md), [ManagerSwaps.page.tsx](../../src/modules/planning/swapping/ui/pages/ManagerSwaps.page.tsx)).
  - **AC:** manager sees decision/reason/rule-hits/payroll-delta; review-flagged swaps highlighted; revert action surfaced for committed approvals.
  - **Complexity:** L. **Deps:** E5.F4.S1, E6.F1.S1. **Priority:** P1. **FE 3 / BE 0.5 / DB 0 / QA 1.**

**Definition of Done (E9):** `tsc`/`build` green; RLS denies non-admin policy writes; run-viewer + review-queue render real audit data; undo/revert wired to the RPCs.

---

### EPIC E10 — Migration & cutover — **P0/P1**

> The expand→backfill→contract sequence (§3). Owns promotion of both drafts onto a live prod DB.

**Feature E10.F1 — Expand-phase promotion**
- **Story E10.F1.S1** — Promote `0001` (assignment) + `0002` (swap) drafts into numbered `supabase/migrations/` files, additive-only, staging-first then prod ([00 §8](00-contracts-and-conventions.md), §3 below).
  - **AC:** zero destructive statements; `mcp__supabase list_migrations` clean; advisors show no new RLS/security warnings; baseline `sm_select_bid_winner` definition preserved for rollback.
  - **Complexity:** L. **Deps:** E1, E2.F1, E5.F1.S1. **Priority:** P0 (the `sm_select_bid_winner` hardening) / P1 (audit tables). **FE 0 / BE 0 / DB 4 / QA 2.**

**Feature E10.F2 — Contract-phase cleanup**
- **Story E10.F2.S1** — After all callers use `sm_apply_shift_op` directly (E1.F2 + E2.F3 shipped and soaked), drop the deprecated thin `sm_select_bid_winner` in a separate later deploy ([00 §4](00-contracts-and-conventions.md) deprecate→drop).
  - **AC:** grep shows zero callers of `sm_select_bid_winner`; drop is its own migration; rollback re-creates the hardened wrapper.
  - **Complexity:** M. **Deps:** E1.F2, E2.F3, soak window. **Priority:** P1. **FE 0 / BE 0 / DB 2 / QA 1.**

**Definition of Done (E10):** expand migrations applied to prod with green advisors; contract migration gated on zero-caller proof; per-step rollback rehearsed in staging.

---

## 2. Effort Estimates

Dev-days, rolled up by epic and by discipline. (S=1, M=2.5, L=5, XL=8 reference; the per-story FE/BE/DB/QA numbers above are summed here.)

### 2.1 By epic × discipline

| Epic | FE | BE (edge+TS) | DB (SQL) | QA | **Total** | Priority |
|---|---:|---:|---:|---:|---:|---|
| E1 Harden write path | 3 | 2 | 7 | 6.5 | **18.5** | P0 |
| E2 Auto-assign engine | 3 | 24 | 7 | 14 | **48** | P1 (incl. 1 P0 story) |
| E3 Assignment audit & rollback | 0 | 5 | 8 | 5 | **18** | P1 |
| E4 Fairness engine | 0 | 3 | 0 | 2.5 | **5.5** | P2 |
| E5 Swap policy+queue+worker | 0 | 14 | 11.5 | 12 | **37.5** | P0/P1 |
| E6 Swap audit & revert | 1.5 | 2 | 1 | 1.5 | **6** | P1 |
| E7 Abuse prevention | 0 | 3 | 1 | 2 | **6** | P1 |
| E8 Observability | 2 | 2 | 6 | 2.5 | **12.5** | P1 |
| E9 Admin UI | 11 | 2.5 | 0 | 4 | **17.5** | P1 |
| E10 Migration & cutover | 0 | 0 | 6 | 3 | **9** | P0/P1 |
| **TOTAL** | **20.5** | **57.5** | **47.5** | **53** | **178.5** | |

> Cross-check: doc [02 §6](02-auto-approve-swaps.md) totals the swap slice at ~FE 13.5 / BE 23.5 / DB 13 / QA 17.5 = **67.5** dev-days, scoped across E5+E6+E7+the swap parts of E8/E9. This plan's E5+E6+E7 = 49.5 plus swap-attributable shares of E8 (~6) and E9 (~12.5) ≈ **68** — consistent with [02], no contradiction.

### 2.2 By discipline (totals)

| Discipline | Dev-days |
|---|---:|
| Frontend | 20.5 |
| Backend (edge + TS) | 57.5 |
| Database (SQL) | 47.5 |
| QA | 53 |
| **Total** | **178.5** |

### 2.3 Critical path

The longest dependency chain (cannot be parallelized away):

```
E1.F1 (hardened RPC, DB) ─► E1.F2 (re-point callers)
      └─► E2.F1 (run RPCs/tables) ─► E2.F2.S1→S2→S3→S4 (edge engine + commit)
            └─► E2.F3 (client cutover) ─► E3.F2 (rollback) ─► E10.F2 (drop thin RPC)
                  └─► [swap leg runs in parallel after E1] E5.F1 ─► E5.F2.S1 ─► E5.F3 ─► E5.F2.S2 ─► E5.F4 ─► (shadow soak) ─► E7 ─► GA
```

- **Bottleneck:** the Edge engine chain **E2.F2.S1→S2→S3→S4** (≈17 BE dev-days serial, single-owner) is the longest single-discipline serial run; it gates client cutover, rollback, and the contract-phase drop.
- **Swap worker E5.F2.S2 (XL, 6 BE-days)** is the swap-leg bottleneck and depends on the eligibility engine E5.F3 landing first.
- **Calendar:** with the assumed team — **2 BE, 1 FE, 1 DB-leaning BE, 1 QA** — BE is the binding constraint at 57.5 BE-days across 2.x BE engineers. The two legs (assign / swap) parallelize after E1, so:

| Sprint (2 wk) | Focus | Exit |
|---|---|---|
| S1 | E1 (P0 harden) + E10.F1 expand-promote + E5.F1/E5.F3 start | P0 floor live in prod; swap schema + eligibility engine in dev |
| S2 | E2.F1/F2 (assign engine) + E5.F2/F4 (swap worker+RPC) | Assign dry-run works; swap shadow-mode wired |
| S3 | E2.F3 cutover + E3 rollback + E5 shadow soak begins + E8 metrics | Auto-assign GA-ready; swap shadow running, dashboards live |
| S4 | E4 fairness + E7 abuse + E9 admin UI + E6 revert | Swap per-dept canary; auto-assign fairness on |
| S5 | Swap org GA + E10.F2 contract drop + hardening | Both features GA; deprecated RPC dropped |

**Realistic calendar: ~5 two-week sprints (≈10 weeks)** for the 5-person team to land everything through org GA, with the swap org-GA gate (2-week shadow + 1-week canary minimum, [02 §7](02-auto-approve-swaps.md)) being the long pole that pushes full GA into S5. P0 prod protection lands end of **S1**.

---

## 3. Migration Strategy (expand → backfill → contract, on a LIVE prod DB)

Principle: **additive first, never destructive in the same deploy** ([00 §8](00-contracts-and-conventions.md)). Both drafts are already authored expand-safe. The thin `sm_select_bid_winner` is the only existing object touched, and it is **hardened in place (CREATE OR REPLACE)**, not dropped, until the contract phase.

### 3.1 Why this ordering is safe

- New tables/RPCs/enums are pure additions — no live reader/writer depends on them until the edge functions ship.
- `swap_auto_decision_kind` / `swap_queue_status` are **minted fresh** (`CREATE TYPE`, no `ALTER TYPE ADD VALUE`), so they are safe inside the migration txn (the `ADD VALUE`-in-its-own-txn rule does not apply). Assignment status/outcome are **text+CHECK**, deliberately avoiding native enums so future values never need `ALTER TYPE` at all ([01 §6](01-auto-assign-bids-refactor.md)).
- `shift_swaps.review_flag` / `auto_decision_id` are nullable/defaulted additive columns — existing rows and the `trg_enqueue_swap_auto_decision` trigger tolerate them immediately.
- The hardened `sm_select_bid_winner` keeps the **3-arg signature and `{success}` return shape**, so the live manual-assign path (`updateBidStatus`) keeps working with zero client change — it just becomes safe (delegates to the gateway). This is how the hardened RPC is introduced "without breaking the live manual-assign path": replace the body, keep the contract.
- Shadow columns: none needed for assignment (audit tables are net-new). For swaps, the `swap_decisions.committed` flag is itself the shadow mechanism — a shadow decision is a real recorded row with `committed=false`, so no schema-level shadow column is required; `shadow_mode=true` is the runtime switch.

### 3.2 Numbered deploy order

Each step is one committed migration (or edge deploy), staging-first, with its own rollback. Filenames are illustrative (`<ts>` = next available timestamp; humans assign real numbers).

| # | Artifact | Phase | What it does | Per-step rollback |
|---|---|---|---|---|
| **M1** | `<ts>_harden_sm_select_bid_winner.sql` (from [0001 §0,§8](migrations-draft/0001_assignment_audit_and_engine.sql)) | EXPAND (P0) | `aa_user_manages_org` helper + hardened transitional `sm_select_bid_winner` (FOUND/FSM/winner-pending/TTS, delegates to gateway). **Protects prod immediately.** | `CREATE OR REPLACE` the baseline `sm_select_bid_winner` body from [`20251015000000_baseline_schema.sql`](../../supabase/migrations/20251015000000_baseline_schema.sql); never leave it missing. |
| **M2** | `<ts>_gateway_select_winner_guards.sql` (the documented [01 §3.2/§3.3](01-auto-assign-bids-refactor.md) diff) | EXPAND (P0) | Add TTS≥4h + winner-pending guards to the gateway `select_winner` write branch. | `CREATE OR REPLACE` the gateway from [`20260623000100_shift_unassign_op.sql`](../../supabase/migrations/20260623000100_shift_unassign_op.sql) (current authoritative body). |
| **M3** | `<ts>_assignment_audit_and_engine.sql` (rest of [0001](migrations-draft/0001_assignment_audit_and_engine.sql)) | EXPAND (P1) | `assignment_runs/decisions/events` + `sm_assignment_run_start/finish/rollback` + RLS. | Drop the three RPCs, three policies, three tables (commented ROLLBACK block in [0001](migrations-draft/0001_assignment_audit_and_engine.sql)); leave M1/M2 in place. |
| **M4** | `<ts>_swap_auto_approve.sql` ([0002](migrations-draft/0002_swap_auto_approve.sql)) | EXPAND (P0/P1) | 4 swap tables + 2 enums + `review_flag`/`auto_decision_id` cols + enqueue/version/immutability triggers + `sm_swap_auto_decide`/`sm_swap_auto_revert` + RLS. **Trigger fires but is inert** until a policy row exists with `enabled=true` (default `enabled=false` ⇒ `KILLSWITCH_OFF`). | Full commented ROLLBACK block at the bottom of [0002](migrations-draft/0002_swap_auto_approve.sql) (drop triggers→fns→policies→cols→tables→types, in order). |
| **M5** | edge deploy `auto-assign-bids` | EXPAND (P1) | Deploy the merged engine (dry-run capable). No DB change. | Undeploy the function; the UI button falls back to disabled (E2.F3 is gated behind this). |
| **M6** | edge deploy `auto-approve-swaps` | EXPAND (P1) | Deploy the swap worker + `pg_cron` tick. Worker is a **no-op in shadow** until policy flips. | Undeploy; pause the cron; queue rows accumulate harmlessly (claimed on redeploy). |
| **M7** | **BACKFILL** `<ts>_seed_swap_policies.sql` (data) | BACKFILL | Insert one `swap_approval_rules` org-default per org with `enabled=true, shadow_mode=true` (shadow-on, act-off). No assignment backfill needed (audit tables are write-forward only). | `DELETE FROM swap_approval_rules WHERE shadow_mode=true AND created_at=<deploy>`; reverts to no-policy = fail-closed. |
| **M8** | **CONTRACT** `<ts>_drop_thin_sm_select_bid_winner.sql` | CONTRACT (P1, LATER) | After E1.F2 + E2.F3 are live and soaked and grep proves zero callers, **drop** the deprecated thin RPC ([00 §4](00-contracts-and-conventions.md)). | Re-create the hardened wrapper from M1 (kept in source control). Only run the drop once zero-caller is proven. |

### 3.3 Backfill steps (detail)

- **Assignment:** none. `assignment_runs/decisions/events` are forward-only; historical auto-assigns are not reconstructable and are out of scope.
- **Swaps:** the only backfill is **M7 policy seeding** — every org gets a default rule row in `enabled=true, shadow_mode=true`. Without a row, the enqueue trigger resolves `policy_version=0` and `sm_swap_auto_decide` returns `DISABLED` (fail-closed) — which is *also* safe, so M7 is what *turns shadow logging on*, not what turns approvals on. Per-dept override rows are created later via the admin UI (E9.F1), not backfilled.

### 3.4 Introducing the hardened RPC without breaking manual-assign

The risk is that `updateBidStatus`/`approveSwap`/bridge callers branch on the old `{success}` shape. Mitigation, in order:
1. **M1 preserves the exact 3-arg signature and `{success:boolean,...}` return** ([0001 §8](migrations-draft/0001_assignment_audit_and_engine.sql)) — callers need no change to keep working.
2. The new guards return `{success:false, error:'…'}` instead of silently succeeding on a bad state — callers already handle `success:false`, so the worst case is a *correct rejection* a caller previously didn't get.
3. Staging soak: run the full bidding vitest suite + a manual two-tab assign race against staging before prod.
4. Only after M1 is soaked do we re-point callers at the gateway directly (E1.F2) — and only after *those* soak does M8 drop the wrapper.

### 3.5 Global per-deploy rollback rule

Every step above is reversible by its own listed inverse, and no step depends on a *later* step's object, so partial rollback (e.g. undeploy M5/M6, keep M1–M4) is always valid. The one ordering constraint: **never run M8 (contract drop) while any caller of `sm_select_bid_winner` remains** — enforced by a grep gate in the deploy checklist.

---

## 4. Feature Flags & Config

All switches are **data, not code redeploys**, so they can be flipped live by the right role without a deploy.

| Flag / switch | Lives in | Default | Scope | Who flips it | Effect when off |
|---|---|---|---|---|---|
| **Auto-assign enabled** | UI gate = manager cert (`app_access_certificates`); engine = presence of the deployed `auto-assign-bids` function | function deployed but button cert-gated | per-manager / org | platform (deploy) + cert admin | button hidden / call 403s |
| **Auto-assign `dry_run`** | request body `{dry_run}` ([00 §7](00-contracts-and-conventions.md)) | caller-chosen; UI default = preview first | per-invocation | any authorized manager | no shift mutation; decisions `committed=false` |
| **Auto-assign `max_wins_per_employee`** | request body `options` → `assignment_runs.options` | 3 | per-run | manager | win-cap loosens/tightens |
| **Auto-assign `accept_warnings`** | request body `options` | false | per-run | manager | warnings block (default-safe) |
| **Swap `enabled` (master kill-switch)** | `swap_approval_rules.enabled` | **false** | org + per-dept | org-admin cert (RLS) | `sm_swap_auto_decide` → `DISABLED`; swap stays MANAGER_PENDING for a human |
| **Swap `shadow_mode`** | `swap_approval_rules.shadow_mode` | **true** | org + per-dept | org-admin cert | decide+log only; `SHADOW_SUPPRESSED`; no shift change |
| **Swap `auto_approve_warnings`** | `swap_approval_rules.auto_approve_warnings` | false | org + per-dept | org-admin cert | solver WARNING → MANUAL_REVIEW |
| **Swap `confidence_min`** | `swap_approval_rules.confidence_min` | 1.0 | org + per-dept | org-admin cert | post-gate G1 downgrade threshold |
| **Swap `max_auto_per_employee_per_week`** | `swap_approval_rules.max_auto_per_employee_per_week` | 3 | org + per-dept | org-admin cert | abuse rate-limit (post-gate G2) |
| **Per-rule mode/params** | `swap_approval_rules.rules` jsonb | per [02 §3.12](02-auto-approve-swaps.md) defaults | org + per-dept | org-admin cert | rule routes per mode; always-on rules ignore this |
| **Per-dept enable** | a `swap_approval_rules` row with `department_id` set | (none until created) | dept overrides org | org-admin cert | dept inherits org default |
| **Swap worker cron** | `pg_cron` schedule for `auto-approve-swaps` | enabled post-M6 | global | platform/on-call | queue drains on next manual `POST` ([00 §7](00-contracts-and-conventions.md)) |

**Always-on (NOT flags — cannot be disabled by anyone):** compliance (solver blocking), fatigue, schedule overlap, 4h time-lock, certification ([02 §3.12](02-auto-approve-swaps.md)). The admin UI shows these read-only.

**Precedence:** dept row beats org-default (resolved `ORDER BY department_id NULLS LAST` in both the enqueue trigger and `sm_swap_auto_decide`). A missing policy row = fail-closed (no auto action). The fastest kill is `UPDATE swap_approval_rules SET enabled=false` (org or dept) — instant, no deploy.

---

## 5. Deployment Plan

### 5.1 Environment ladder + gate metrics

| Env | What runs here | Gate to promote |
|---|---|---|
| **dev** (local Supabase + `supabase functions serve`) | apply M1–M7 to a local stack; unit + integration vitest; pgTAP | `tsc` clean, full vitest green, `build` green, pgTAP green |
| **staging / Supabase branch** ([`mcp__supabase create_branch`](00-contracts-and-conventions.md)) | full migration replay M1→M7 on a prod-shaped clone; edge fns deployed; `get_advisors` security/perf scan; load test (5k swaps, 800×12 bids) | advisors clean; QA matrix 1–54 green; p95 latency in SLA; two-writer race demonstrably one-winner; rollback rehearsed |
| **prod** (`srfozdlphoempdattvtx`) | staged rollout below | per-stage gates |

### 5.2 Auto-Assign staged rollout (dry-run → one dept → org)

| Stage | Config | Promote gate | Abort/rollback criteria |
|---|---|---|---|
| **A0 — Dry-run preview** | engine deployed; UI defaults to `dry_run:true` | managers run previews; decision rows look correct; zero shift mutations confirmed | any dry-run mutates a shift row (must be impossible) ⇒ pull function |
| **A1 — One dept, committed** | one low-risk dept; managers run live with undo available | ≥1 week; conflict-retry rate < 2%; zero unqualified/locked assignments (E2.F2.S3 guarantees); rollback used successfully at least once in a drill | any unqualified/cancelled/locked assignment escapes; conflict storm; `ABORTED` runs > 1% ⇒ disable button (cert) + investigate |
| **A2 — Org GA** | all depts | A1 clean 1 week; run-viewer + undo in prod; on-call runbook signed off | same as A1 at org scale ⇒ cert-gate the button org-wide |

### 5.3 Auto-Approve staged rollout (shadow → canary → GA) — per [02 §7](02-auto-approve-swaps.md)

| Stage | Config | Promote gate (metrics) | Abort/rollback criteria |
|---|---|---|---|
| **0 — Shadow (org-wide)** | `enabled=true, shadow_mode=true` everywhere (M7) | ≥2 weeks; **shadow-vs-human agreement ≥95%**; **0** would-be-approvals a manager later rejected; idempotency 0 double-commits; p95 < 2s; DLQ < 1% | agreement < 95%, any unsafe would-be-approve, double-commit, or DLQ > 1% ⇒ stay in shadow, fix |
| **1 — Per-dept canary** | `shadow_mode=false` for ONE low-risk dept | ≥1 week live; **revert rate < 1%**; **0** compliance/cert/fatigue/time-lock escapes; no coverage-floor breach; abuse detectors firing (sampled) | any always-on escape, revert spike, or coverage breach ⇒ `enabled=false` for that dept (instant) |
| **2 — Org GA** | `shadow_mode=false` org-wide | canary clean 1 week; kill-switch drill done; manager review-queue load down vs baseline | same as canary at org scale ⇒ org `enabled=false` |

### 5.4 Runbook — "an auto action went wrong in prod"

**Detection (E8 alerts):** committed `AUTO_APPROVE` later reverted; auto-assign `ABORTED`/conflict spike; DLQ-rate or latency breach; on-call page.

**Immediate (≤2 min), no deploy:**
1. **Swaps:** `UPDATE public.swap_approval_rules SET enabled=false WHERE organization_id=:org` (and/or `department_id=:dept`). Instant kill-switch; in-flight queue items return `DISABLED` and stay MANAGER_PENDING for humans.
2. **Auto-assign:** revoke/disable the triggering manager cert or pull the `auto-assign-bids` function deploy (button 403s). Re-enable `shadow_mode=true` for swaps to keep observability without action.

**Contain (≤30 min):**
3. **Swaps:** for each bad committed approval, call `sm_swap_auto_revert(decision_id, actor)` (time-lock permitting) — restores prior assignment, fully audited.
4. **Auto-assign:** `POST …/run/{run_id}/rollback` — partial-safe S4→S5 unwind of that run's assignments (skips edited/traded/locked).

**Diagnose:** read `swap_audit_log` / `assignment_events` (immutable forensic trail) — every decision has guard/eligibility/solver inputs + reason + engine/policy version. Reproduce in staging with the recorded inputs.

**Recover:** fix engine/policy; re-deploy edge fn (versioned `engine_version`); re-enter shadow → canary for swaps; re-run dry-run → one-dept for assign. **Do not** GA again without the regressed gate metric back inside threshold.

**Post-incident:** the `engine_version`/`policy_version` stamping makes "what logic made this call?" answerable; record the failing case as a new vitest fixture before re-promoting.

---

## 6. Risk Register & P0/P1/P2 Sequencing

### 6.1 Risk register

| ID | Risk | Likelihood | Impact | Mitigation (epic/story) | Owner |
|---|---|---|---|---|---|
| RK1 | Double-assign / overwrite via lock-free TOCTOU (audit C1/C2) | High (ordinary concurrent use) | Critical | E1.F1+E1.F2 gateway CAS+FSM; E2 commit-retry | DB+BE |
| RK2 | Unqualified/uncertified auto-assign (`quals:[]`, audit B5/F5) | High | Critical (legal) | E2.F2.S3 real quals/role (treated P0) | BE |
| RK3 | Assign inside 4h lock (audit B7/row 5) | Med | High | E1.F1+M2 TTS guards both paths | DB |
| RK4 | Withdrawn-bid revival (audit row 4) | Med | High | E1.F1 winner-pending guard | DB |
| RK5 | Silent bad swap auto-approval | Med | Critical | E5 shadow-first; always-on rules; D5 fail-closed; E8 escape-canary alert | BE+DB |
| RK6 | `ALTER TYPE ADD VALUE` in-txn deadlock on prod | Low | High | drafts mint fresh enums / use text+CHECK (no ADD VALUE) | DB |
| RK7 | Hardened RPC breaks live manual-assign callers | Low | High | M1 preserves signature+shape; staging soak (§3.4) | DB+QA |
| RK8 | Edge engine timeout on large scope (800×12) | Med | Med | E2.F4 run cursor / resumability; staging load test | BE |
| RK9 | Abuse: collusive swap rings / laundering cycles | Med | Med | E7 rate-limit + pairwise + cycle detection | BE |
| RK10 | Drift between eval and commit (swap or assign) | Med | Med | version-CAS in gateway; idempotency-key recompute on drift | BE+DB |
| RK11 | Contract-drop M8 run with a live caller remaining | Low | High | grep zero-caller gate in deploy checklist (E10.F2) | DB |
| RK12 | Metric/alert gap hides a slow escape | Low | High | E8 dashboards as a *promote gate*, not an afterthought | BE+QA |

### 6.2 Ordered execution plan (mapped to audit §12 phases)

**P0 = correctness/safety that MUST land before ANY automated action is trusted.** Nothing in P1 ships to prod-act until the P0 floor is live.

- **Sprint 1 — P0 floor (audit Phase 0 "stop the bleeding"):** E1 (hardened RPC + gateway guards + re-point manual callers), M1+M2 to prod, E10.F1 expand-promote of schema. *Also start, in parallel and not yet acting:* E5.F1 (swap schema) + E5.F3 (eligibility engine, pure). **Exit:** prod manual + auto write path is double-assign-proof, qual-enforcing (via the still-manual path), lock-enforcing; swap schema in dev.
- **Sprint 2 — P1 engines (audit Phase 1 server-side + Phase 3 shadow wiring):** E2.F1/F2 (auto-assign edge engine incl. the P0 qual/role story E2.F2.S3), M3+M5; E5.F2/F4 (swap worker + commit RPC), M4+M6; E2.F2.S3 must be green before any committed auto-assign. **Exit:** auto-assign dry-run correct; swap shadow-mode wired (still acting = false).
- **Sprint 3 — P1 cutover + audit + shadow soak (audit Phase 1 R5 + Phase 3):** E2.F3 (delete client loop), E3 (assignment audit + rollback), E8 metrics, M7 seed shadow policies → **swap 2-week shadow soak begins**. **Exit:** auto-assign GA-ready with undo; swap shadow data flowing; dashboards live.
- **Sprint 4 — P2 + P1 polish (audit Phase 2 converge + abuse):** E4 (fairness), E7 (abuse), E9 (admin UI), E6 (revert); swap **per-dept canary** once shadow gate (≥95% agreement) passes; auto-assign org GA. **Exit:** auto-assign org GA; swap canary live.
- **Sprint 5 — GA + contract cleanup:** swap **org GA** (after canary gate); E10.F2 M8 drop deprecated `sm_select_bid_winner` (zero-caller proven); E2.F4 run cursor for scale. **Exit:** both features GA; SSoT fully converged; deprecated RPC gone.

**Phase mapping:** Sprint 1 = audit Phase 0; Sprint 2–3 = audit Phase 1 (server-side + audit) + Phase 3 shadow start; Sprint 4 = audit Phase 2 (converge engines) + Phase 3 canary; Sprint 5 = audit Phase 3 GA + contract.

---

## 7. Definition of Done (per epic)

A single, uniform bar — an epic is Done only when **all** of the following hold for its scope:

| Gate | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 | E10 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `tsc --noEmit` 0 errors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| vitest green (incl. named QA cases) | ✓ (51–54) | ✓ (engine+retry) | ✓ (rollback) | ✓ (anti-gaming+determinism) | ✓ (1–24,35–50) | ✓ (32) | ✓ (abuse pos/neg) | ✓ (metric calc) | ✓ (RLS deny) | ✓ |
| `npm run build` green (+ edge deploy) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| pgTAP green | ✓ (RPC+gateway guards) | ✓ (run RPCs) | ✓ (rollback skip-reasons) | n/a | ✓ (decide+enqueue) | ✓ (revert guards) | ✓ (index plans) | ✓ (metric views) | n/a | ✓ (migration replay) |
| Audit row emitted | `shift_events` | `assignment_decisions`+`events` | `RUN_ROLLED_BACK` | `rule_hits` trace | `swap_decisions`+`audit_log` | `REVERTED` | downgrade recorded | n/a | reads audit | n/a |
| Metric dashboard live | n/a | run outcomes | rollback rate | fairness dist. | shadow-agreement/DLQ/latency | revert rate | abuse-fire rate | **all panels** | surfaces metrics | n/a |
| `get_advisors` clean (security/perf) | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | n/a | ✓ |
| Per-step rollback rehearsed in staging | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | n/a | n/a | n/a | ✓ |

**Global release gate (before any prod-act promotion):** the relevant stage's metric gate in §5 is inside threshold, the on-call runbook (§5.4) is signed off, and the kill-switch has been drilled once in staging.

---

## Appendix — Consolidated object/owner map (no renames; from [00 §4](00-contracts-and-conventions.md))

| Object | Type | Owner doc | Epic | Migration |
|---|---|---|---|---|
| `sm_select_bid_winner` (hardened, then dropped) | RPC | 01 | E1 / E10 | M1 / M8 |
| gateway `select_winner` guards | RPC patch | 01 | E1 | M2 |
| `assignment_runs/decisions/events` | tables | 01 | E2/E3 | M3 |
| `sm_assignment_run_start/finish/rollback` | RPC | 01 | E2/E3 | M3 |
| `aa_user_manages_org` | RPC | 01 | E1/E2 | M1 |
| `auto-assign-bids` | edge fn | 01 | E2 | M5 |
| `swap_approval_rules/decisions/audit_log/review_queue` | tables | 02 | E5 | M4 |
| `swap_auto_decision_kind` / `swap_queue_status` | enums | 02 | E5 | M4 |
| `enqueue_swap_auto_decision` + `trg_*` | trigger | 02 | E5 | M4 |
| `sm_swap_auto_decide` | RPC | 02 | E5 | M4 |
| `sm_swap_auto_revert` | RPC | 02 | E6 | M4 |
| `auto-approve-swaps` | edge fn | 02 | E5 | M6 |
| swap policy seed | data | 02 | E5 | M7 (backfill) |

*Single opinionated plan. Consistent with 00/01/02; no table/RPC/route renamed. Drafts referenced by name only — no code or SQL modified by this document.*
