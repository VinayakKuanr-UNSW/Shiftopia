# Casual opportunity-adjusted fairness

Decided and built 2026-11-07. Fairness applies to **casual work only**. Full-time and
part-time staff are rostered against their contracts, so contracted capacity plays no
part here.

## The question it answers

> Given the casual shifts that were actually worked, and who was eligible and available
> for each, how much of that work would each casual reasonably have received?

## The model

For each approved, billed casual shift *s*, let *H_s* be its billed hours in a metric and
*E_s* its **pool**: every casual who was eligible for it and available when it was
snapshotted, plus whoever actually worked it.

```
Expected_i = Σ_{s : i ∈ E_s}  H_s / |E_s|
Debt_i     = Actual_i − Expected_i          (positive = above their fair share)
Confidence = min(1, opportunities_i / 10)
```

| Metric | Hours counted |
|---|---|
| `total_hours` | all billed hours |
| `saturday_hours`, `sunday_hours` | billed minutes falling on that calendar day |
| `public_holiday_hours` | billed minutes falling on a gazetted holiday (org jurisdiction) |
| `night_hours` | billed minutes overlapping 22:00–06:00 |
| `overtime_hours` | billed time past the rostered end, shared only among pool members whose declared availability ran past the rostered end by at least that much |

An unpaid break comes proportionally out of every category. A metric with no opportunity
has no row and no debt. Debts sum to zero per metric: the model redistributes work, it
never invents it.

**Eligible** = an unexpired Casual contract covering the shift date in the same
organization, department, sub-department and role, which is the solver's rule.
**Available** = an in-scope availability slot that fully contains the shift (solver HC-5d),
with no approved leave that day. Availability is an opportunity signal, not a promise to
work.

## Where it lives

| Piece | Location |
|---|---|
| Snapshots | `fairness_opportunities`: one row per (casual shift, eligible casual), refreshed nightly while the shift is in the 7-day look-ahead, frozen from its date on |
| Ledger | `casual_fairness_ledger`: one current generation per org, each row stamped with `run_id` |
| Engine | `capture_fairness_opportunities`, `recompute_casual_fairness`, `fairness_category_minutes`, `run_casual_fairness_nightly` (pg_cron 16:00 UTC) |
| Client | `rosters/domain/fairness-ledger.ts`: category split (SQL mirror), pricing kernel (solver mirror), bid what-if |
| Solver | `model_builder.py`: SC-4, SC-10, SC-11 and SC-11b, casual-only (below) |
| Tests | `supabase/tests/casual_fairness_engine.sql` (CI: `tests/integration/flows/casual-fairness.int.test.ts`), `fairness-ledger.test.ts`, `fairness-scoring-parity.test.ts`, `test_solver_regressions.py` |

## Autoscheduler

| Term | Responsibility |
|---|---|
| SC-4 | Penalise each casual's assigned minutes in this run beyond their opportunity-adjusted share of the run's casual shifts |
| SC-10 | The same for undesirable time (Saturday ∪ Sunday ∪ PH ∪ night), penalising only the excess |
| SC-11 | Historical Saturday/Sunday/PH/night debt × the shift's hours in that category; ¢ per (debt-hour × shift-hour) = 200/400/1200/300 ÷ 8² (EBA cl 41 ratio 1:2:6) |
| SC-11b | Historical total and overtime debt × the shift's hours (2.0 and 3.0 ¢) |

The client sends `fairness_debts` = debt × confidence, for Casual employees only. The
solver ignores debts on anyone else.

## Decisions that differ from the first draft

1. **No backfill; cutover 2026-11-07.** Availability and eligibility were never
   snapshotted, so reconstructing them from today's settings would rewrite history.
2. **The worker is always in the pool.** A shift with no snapshot therefore contributes
   no debt either way, and no opportunity, so it adds no confidence. Missing data never
   manufactures unfairness.
3. **Only the work actually billed is distributed.** Unfilled or cancelled shifts create
   no expected hours.
4. **No `fairness_events`, `fairness_policies` or `fairness_calculation_runs` tables.**
   Billed work is read from `billables` at recompute time, the weights live with the
   solver (one place, pinned by a parity test), and the recompute is deterministic, so any
   past day can be reproduced with `recompute_casual_fairness(org, <date>)`.
5. **Snapshot timing:** a shift is re-snapshotted every night (03:00 Sydney) from 7 days
   out until its own date, so availability declared or leave approved late is reflected;
   from its date on it is frozen. A shift created on its own day after the nightly run is
   never snapshotted (worker-only pool, see 2).
6. **Overtime is time past the rostered end**, not billed net minus rostered net: a
   skipped unpaid break is not overtime, and the overtime pool is defined by availability
   past the end.
7. **SC-4 penalises only the excess** over a casual's in-run share, at ~1¢/min — about
   480¢ for a whole shift over share, on par with SC-11's 400¢ for a full 8h Sunday debt.
   A two-sided term pushed work toward casuals and drowned out the ledger.
8. **Bid preview pool = the bidders.** They are the candidates demonstrably eligible,
   available and willing.

## Tuning knobs

| Knob | Default | Where |
|---|---|---|
| Rolling window | 91 days | `recompute_casual_fairness(p_window_days)` |
| Full-confidence opportunities (τ) | 10 | `p_confidence_shifts` + `CONFIDENCE_SHIFTS` (TS) |
| Snapshot horizon | 7 days | `run_casual_fairness_nightly` |
| Snapshot retention | 182 days | `run_casual_fairness_nightly` |

## Known limits

- Skill and licence requirements are not part of eligibility (no shift uses them today).
  Availability exceptions are ignored (no rows exist).
