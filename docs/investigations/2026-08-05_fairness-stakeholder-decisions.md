# Fairness Engine — Stakeholder Decision Record

**Date:** 2026-08-05
**Scope:** the nine open questions in §10 of `2026-08-04_fairness-fatigue-architecture-audit.md`
**Authority:** decided under delegation. Every one is reversible; §"How to overturn" says how.

---

## Why these were left open, and the principle used to close them

The audit deliberately did not answer these, because each one is a *policy* choice
wearing engineering clothes. The risk in deciding them is inventing policy and then
burying it in a constant, which is exactly how the system arrived at
`RECOVERY_UNITS_PER_HOUR = 1` and a 500¢ public-holiday coefficient — numbers nobody
chose, that nobody could justify, and that were nonetheless steering real rosters.

So the rule applied throughout:

> **Where the business has already stated a position, defer to it. Where it has not,
> pick the option that is defensible in a dispute, and say plainly that it is a default.**

That single rule decides six of the nine. The enterprise agreement already prices
undesirable days (cl 41), already defines sufficient rest (the 11-hour break), and
already establishes that fairness is a distributional preference rather than an
entitlement. Those are not our numbers to invent — they were bargained.

**The worst outcome is not a wrong answer. It is an accidental answer.** A threshold
that emerges from coefficient arithmetic cannot be explained to an employee, defended
to a regulator, or deliberately changed. Several decisions below are less about picking
the optimal value than about making the value *stated*.

---

## Q1 — Is fairness binding or advisory?

**Decision: fairness is ADVISORY (soft). Fatigue is BINDING (hard) above a stated
ceiling, and soft below it. Both tiers are declared, not emergent.**

Fairness is a distributional preference. No instrument requires that Sundays be spread
evenly, and making it hard creates infeasibility: three qualified staff and three Sunday
slots makes a hard fairness rule unsolvable. An unfilled shift is a worse outcome than
an uneven one.

Fatigue is different in kind. It is a work-health-and-safety matter, and the employer's
primary duty of care does not bend to a rostering convenience. Rostering someone into
established fatigue risk is a foreseeable hazard.

The important half of this decision is the second sentence. Audit F-07 found fatigue was
*accidentally* hard — not because anyone decided it should be, but because a
miscalibrated coefficient made it large enough to dominate. That is the worst of both
worlds: the binding threshold sits wherever the arithmetic happens to put it, and it
cannot be stated, audited, or intentionally moved. The remedy is not to shrink the
coefficient until it stops dominating by accident; it is to put a real ceiling in the
`legal_hard` tier and let the gradient below it be genuinely soft.

The solver's lexicographic tiering (`legal_hard » coverage » soft » guardrail » cost`)
already provides the mechanism.

---

## Q2 — Worked or rostered?

**Decision: WORKED. Rostered-but-not-yet-worked is surfaced as a forward projection and
never merged into the ledger.**

The ledger is an evidentiary record. If it counted future rosters, then a shift later
cancelled, swapped away, or reassigned would have to be un-counted — putting us straight
back into mutation-tracking, which is precisely the class of defect that F-02, F-06 and
F-20 all were. "Worked" is monotonic and reconstructable from shift history, which is
what makes the whole scheduled-recompute architecture possible.

The obvious objection is real: a purely backward-looking ledger will happily roster
someone a fourth consecutive Sunday, because the first three have not happened yet. That
gap is covered by a *different* mechanism — the solver's own within-run balance (SC-10)
spreads undesirable work inside the roster being built. Two mechanisms, cleanly split:
**the ledger is history; SC-10 is the run in progress.** Neither should be asked to do
the other's job.

---

## Q3 — What is the peer group?

**Decision: compare against the ELIGIBLE POOL for that kind of work, not the whole org
and not the department. Staged: keep org-wide for `total_hours` / `overtime_minutes`;
move the burden metrics to eligible-pool.**

Org-wide averaging across incomparable populations is not fairness. If Theatre staff work
nights and Convention staff do not, the org-wide night average is dragged down by people
who were never candidates — so every Theatre employee shows a large positive night debt,
every Convention employee a negative one, and the solver tries to hand night shifts to
people who cannot take them.

Per-department averaging fails differently: small departments give noisy averages, and it
entrenches "the night department" as a permanent identity, where the people who always
work nights never accrue relative debt because their peers also work nights.

The principled answer is neither: **you are owed something only relative to the people who
could have taken it instead of you.** For each metric the peer group is those who were
qualified, contracted and available for that kind of shift in the window.
`EligibilityService.getEligibleEmployees()` already computes this.

Staged because the qualification gate only bites on the burden metrics. Everyone is
comparable on hours, so `total_hours` and `overtime_minutes` stay org-wide, which is both
cheaper and correct.

---

## Q4 — Do debts reset or age out?

**Decision: the 91-day rolling window is the ONLY decay mechanism. No manual reset, no
tenure reset. Leave and unavailability suppress accrual via the availability denominator.**

No manual reset button: whoever holds it can erase the evidence of unfair distribution,
which defeats the record's purpose. No tenure-based reset either — a new starter is
correctly handled by pro-rating, not by a special case.

Leave must suppress accrual, and this is not a nicety. An employee on approved leave was
not *available* to take the Sunday, so they cannot be owed one. Today they return from two
weeks off carrying a large negative debt and the solver over-schedules them to "catch up"
— a fairness engine producing a directly unfair result, compounding badly for parental and
long-service leave.

The fix is the availability denominator in Phase 3 of the remediation plan, and it
resolves leave, unavailability, new starters and the terminated-contract drag with one
change, because all four are the same defect: **the denominator is calendar time when it
should be availability time.**

Role and department transfers carry debt with the employee. Correct as-is — the burden was
borne by the person, not the position.

---

## Q5 — Is `denied_preferences` fair to count?  ✅ IMPLEMENTED

**Decision: NO, not as a count. Replaced with `denial_rate` — a smoothed share of the
employee's own bids, shrunk toward the org baseline.**

This was the sharpest of the nine, and the old design was straightforwardly exploitable.
The metric counted rejected bids, and the solver applies the resulting bonus *one-sidedly*
(only positive debt boosts the preference discount — `model_builder.py` SC-1). So the
dominant strategy was to bid on everything: more bids → more denials → bigger discount.
And once one employee worked that out, everyone had to bid defensively, at which point the
metric measured bidding volume and nothing else. **A metric that destroys its own signal
once understood is worse than no metric.**

A rate cannot be farmed by volume. But a raw rate over-reacts to a thin record — one bid,
one loss reads as 100% denied — so the estimate is shrunk toward the org-wide rate by five
virtual bids:

```
denial_rate = (denied + 5 × org_rate) / (submitted + 5)
```

The properties this buys, all pinned by tests:

- Two employees losing the same *share* score the same, whether they bid 6 times or 60.
- Someone who has never bid lands exactly on the org rate, so their debt is **zero** —
  not bidding is neither owed nor owing. (The old count gave them a negative debt.)
- Someone who bids often and loses often converges on their true rate and accrues real debt.

Alternatives rejected: dropping it entirely (loses genuine signal — an employee who keeps
losing the shifts they want *is* being treated unfairly); a hard cap on the count (still
rewards volume up to the cap); scarcity weighting (better in principle, but needs bid-pool
size per shift, which the recompute does not currently carry).

Withdrawn and expired bids still do not count as denials. Only explicit rejection does.

---

## Q6 — Should Saturday count as undesirable?  ✅ IMPLEMENTED

**Decision: YES, weighted — and the weights come from the EBA, not from us.
`weekend_shifts` is split into `saturday_shifts` and `sunday_shifts`, weighted 1 : 2,
with public holidays at 6.**

This is the decision the audit set up and could not make, and the answer turned out to be
already written down. Clause 41 prices the burden of each day:

| Day | cl 41 loading | Fairness weight |
| --- | --- | --- |
| Saturday | +25% | 200¢ (1×) |
| Sunday | +50% | 400¢ (2×) |
| Public holiday | +150% | 1200¢ (6×) |

The parties bargained these. Using them means every weighting question is answerable from
the agreement — *"why is a Sunday worth two Saturdays?"* → *"clause 41"* — and a
renegotiated EBA updates fairness by updating one table rather than reopening a debate.

Two consequences worth stating plainly:

1. **Public holidays were badly underweighted.** They sat at 500¢ against a 300¢ weekend —
   1.67× — where the agreement implies 6× a Saturday. The scarcest and most burdensome
   shift in the calendar was priced barely above an ordinary Saturday.
2. **Total magnitude is unchanged.** Saturday 200 and Sunday 400 average to the 300 the
   single `weekend_shifts` metric used, so the fairness term keeps its scale relative to
   cost and coverage. What changed is the *ratio*, not the volume.

Night stays on its own scale (300¢) and is deliberately not folded into the ratio: it is
the cl 41.4 shift allowance, which *competes with* rather than adds to the day loading on
the pay side. As a fairness dimension the burden is circadian, not calendar — an equal
night debt costs the same whatever day it falls on.

**Architectural note:** the ledger stores *counts* and applies weights at read time. That
separation is deliberate — it keeps the table observational, so re-weighting a dimension
never requires rewriting history.

---

## Q7 — Should fatigue gate emergency assignment?

**Decision: YES — and emergency is the MOST important place for it, not the least.
Implemented as a recorded override, not a block.**

The instinct is that emergencies need speed and should not be gated. That is backwards.
Emergency assignment is short-notice (no chance to rest first), usually fills a gap left by
someone who called in sick (so the pool is already stretched), and disproportionately goes
to whoever says yes most — which is to say, the already-loaded. The duty of care has no
emergency exemption.

But a hard block is wrong too: sometimes the shift genuinely must be filled. So:

- Below `RISK_MAX`: no friction.
- Above `RISK_MAX`: still offerable, but flagged, and requiring an explicit manager
  acknowledgement **recorded in `shift_events`**.

The recording is the substance of the decision. The point is not to prevent the
assignment; it is to make the decision *attributable*. **An unrecorded override is
indistinguishable from no check at all.** This also matches the existing audited-gateway
pattern (`sm_apply_shift_op`), so it needs no new machinery.

Closes F-25, where Reserve List documents a fatigue check it does not perform — on the
highest-risk assignment path in the system.

---

## Q8 — What is the fatigue recovery rate?  ✅ IMPLEMENTED

**Decision: DERIVE it from the minimum rest break instead of asserting it.
`RECOVERY_UNITS_PER_HOUR = FATIGUE_BANDS.OK_MAX / MINIMUM_REST_BREAK_HOURS` ≈ 1.82.**

The old value was a bare `1` with no cited basis — the worst kind of constant, because it
decides who counts as rested and therefore who is assignable, while looking like an
implementation detail nobody need justify.

We cannot invent a validated physiological constant, and pretending to would be worse than
the status quo. What we *can* do is anchor to a rest period the business has already
committed to: the agreement requires an 11-hour break between shifts, which is a bargained
statement that 11 hours is sufficient recovery. So a full break should return an employee
from the top of the OK band to baseline: 20 / 11 ≈ 1.82 units per hour.

**The old value under-credited rest by roughly 45%**, so employees read as more fatigued
than the agreement assumes after a compliant break. That is not the conservative,
safe-direction error it appears to be — it suppressed their availability and concentrated
work onto whoever the model happened to consider rested.

Known consequence, stated rather than buried: at the corrected rate, a single 8-hour night
shift now fully clears within about 14 hours of rest. Whether that is right depends on
whether elapsed clock time is a good proxy for recovery in a night worker who sleeps during
the day — it probably is not. **Recovery remains linear, and real recovery is not**; the
early hours of a rest period restore more than the later ones. A linear model anchored at a
defensible endpoint beats a linear model anchored at nothing, but this is now the weakest
assumption in the fatigue stack and should be revisited against real absence and incident
data.

The derivation is pinned by a test, so replacing it with a literal fails the build.

---

## Q9 — Is fairness auditable to employees?  ✅ IMPLEMENTED (SQL half)

**Decision: YES. This is a requirement, not a feature — and it was nearly free.**

If fairness influences who gets shifts, and it does, then under an enterprise agreement a
disputed roster decision must be explicable. *"The algorithm decided"* is not a defence.

Reproducibility needs four things, and three were already built:

| Requirement | Status |
| --- | --- |
| The generation behind a decision must survive | ✅ `prune_fairness_ledger` keeps 182 days and never prunes the newest generation |
| The decision must name the generation it used | ✅ **now** — every recompute stamps `updated_by_run` |
| The employee must be able to read their own row | ✅ self-read RLS (`20260804060000`) |
| The computation must be deterministic | ✅ pure functions, SQL↔TS parity-tested |

`fairness_ledger.updated_by_run` has existed since the baseline schema and had only ever
been written as `NULL` — a column built for exactly this purpose and never filled in. It
now carries a per-run uuid, verified to differ across generations and to re-stamp when a
generation is recomputed.

The remaining half is UI (Phase 6 of the remediation plan): an employee-facing view of
their own standing. Whether to *show* it is the one genuinely open sub-question, since it
exposes relative comparison against colleagues — but the system can now answer the question
either way, which it could not before.

---

## What was implemented, and what was staged

Four decisions landed as code because they are **schema-shaped**, and the seven fairness
migrations are still unapplied. That window matters: changing the metric set now costs one
edited function; after `20260804040000` reaches production it costs a rename plus a
backfill of every historical generation. Deciding these later would have been the same
decision at ten times the price.

| | Decision | Landed as |
| --- | --- | --- |
| Q5 | denial rate replaces denial count | `fairness-ledger.ts`, `model_builder.py` SC-1, `conflict-resolver/scorer.ts`, migration `20260805030000` |
| Q6 | Saturday/Sunday split, EBA cl 41 weights | same, plus `BidLedgerImpact.tsx` |
| Q8 | derived recovery rate | `projections/utils/fatigue.ts` |
| Q9 | run-id stamping | migration `20260805030000` |

Staged into the remediation plan, because each needs work the plan already sequences:

- **Q1** — declared tiering: needs the fatigue ceiling moved into `legal_hard`.
- **Q2** — no code change; confirms current behaviour is correct.
- **Q3** — eligible-pool peer group: needs qualification data inside the SQL recompute.
- **Q4** — availability denominator: Phase 3, the plan's highest-risk change.
- **Q7** — recorded fatigue override: Reserve List module.

### A bug found on the way

`conflict-resolver/scorer.ts` read `debts.denied_preferences` through an untyped map, so
the metric rename would **not** have been a compile error — it would have silently read
`undefined` forever. Its normalisation (`/5`, sized for a denial count) would also have
divided a ±0.3 rate debt down to ~0.06 and quietly zeroed the term: the metric still read,
still plausible, measuring nothing. Both fixed, with the threshold now a named constant.

This is the same failure shape as F-09 and F-13 in the original audit, which is worth
noting: **untyped boundaries are where fairness logic goes to die quietly.**

---

## Verification

- `npm run verify` — **PASS** (type-check 0 errors · 1739 vitest across 119 files · build ✓)
- `pytest` — **113 passed**
- SQL↔TS parity on PostgreSQL 15: all **14 rows** match exactly on value, team average and
  debt, including 4-decimal denial rates computed independently in Postgres numeric and
  JavaScript floats. Fixture bid counts were chosen so no intermediate lands on a rounding
  boundary — otherwise the test would measure rounding mode rather than parity.
- Negative control: perturbing one expected denial rate **fails** the harness, confirming
  it is not vacuous.
- All eight migrations apply cleanly in order against a throwaway container. Verified after
  the full sequence: zero-shift employees still enter the cohort (F-05), a Sunday shift
  registers as `sunday_shifts` and not `saturday_shifts` (Q6), a public holiday still
  resolves through `organizations.jurisdiction` with no explicit argument (F-21), and each
  recompute generation carries a distinct run id (Q9).
- Container removed.

**No migration has been applied to production.** The hold from 2026-08-04 stands.

---

## How to overturn any of these

Each decision is one edit plus a failing test that names it:

| Decision | Change | Test that will fail |
| --- | --- | --- |
| Q6 weights | `DEFAULT_COEFFICIENTS` + SC-11 coefficients | `weights Saturday : Sunday : public holiday as 1 : 2 : 6, per EBA cl 41` |
| Q5 prior strength | `DENIAL_RATE_PRIOR_STRENGTH` + `v_prior_k` | `shrinks a thin record toward the org rate` |
| Q5 → revert to counts | restore the count metric | the whole `smoothedDenialRate` block |
| Q8 recovery rate | `MINIMUM_REST_BREAK_HOURS` or the derivation | `a full minimum rest break clears the OK band` |
| Q9 run stamping | drop `v_run_id` | parity harness run-id assertions |

The TS and SQL coefficient tables are duplicated by necessity (different runtimes) and
pinned together by the parity fixture. **Change one, change the other** — the fixture is
what stops a fallback run silently producing a different roster from a solver run.
