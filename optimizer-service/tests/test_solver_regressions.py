"""
Regression tests for every solver-side fix landed during the 2026-05 audit.

Each test is named for the bug it prevents from re-emerging. If any of
these fail, the corresponding architectural decision has regressed and
the AutoScheduler is silently producing wrong schedules again.

Don't relax these tests without updating the audit doc and explaining
why. They are the contract.
"""
from __future__ import annotations

import pytest

from .conftest import make_employee, make_shift, solve
from model_builder import (
    AvailabilitySlotInput,
    OptimizerConstraints,
    StrategyInput,
)


# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

def test_trivial_problem_solves(trivial_problem):
    shifts, employees = trivial_problem
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert len(out.unassigned_shift_ids) == 0


# ---------------------------------------------------------------------------
# Spread-of-Hours bug — the one that caused 0 assignments on multi-shift days
# ---------------------------------------------------------------------------

def test_two_shifts_same_day_one_employee_assigns_at_least_one():
    """Regression: spread-of-hours used absolute-since-1970 minutes against
    a [0..2880]-bounded variable, making `v=1` infeasible for any shift on
    a day with another shift in scope. The model returned status=OPTIMAL
    with zero assignments. After the fix (day-relative minutes) the solver
    must place at least one of the two shifts."""
    shifts = [
        make_shift("s1", "2026-05-15", "05:45", "10:00"),
        make_shift("s2", "2026-05-15", "10:30", "14:00"),
    ]
    employees = [make_employee("e1")]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    # Same employee, gap = 30m < 600m rest → solver must reject one of the
    # two; assigning both is a rest-gap violation.
    assert len(out.assignments) == 1


def test_overlapping_shifts_distribute_across_employees():
    """Regression: with 3 overlapping morning shifts and 3 employees, a
    correct solver covers all 3. The pre-fix solver returned 0/3 because
    of the spread bug above; this is the production reproducer from the
    user's screenshot."""
    shifts = [
        make_shift("s1", "2026-05-15", "05:45", "14:00"),
        make_shift("s2", "2026-05-15", "06:15", "14:00"),
        make_shift("s3", "2026-05-15", "06:30", "14:00"),
    ]
    employees = [make_employee(f"e{i}") for i in range(1, 4)]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 3
    # Each employee should get exactly one shift (no overlap allowed).
    by_emp = {a.employee_id for a in out.assignments}
    assert len(by_emp) == 3


# ---------------------------------------------------------------------------
# Coverage outranks softened constraints (penalty-tier proof)
# ---------------------------------------------------------------------------

def test_coverage_outranks_min_contract_slack():
    """Regression: pre-fix, min_contract_minutes slack at 1e6/min could
    accumulate higher than coverage's 1e7/shift, so the solver chose to
    leave shifts uncovered to satisfy contract-floor slack. Post-fix,
    coverage at 1e8/shift × priority must outrank Tier-1 slack always.

    Setup: an FT employee with a 2000m min-contract obligation but only a
    400m shift available. The solver MUST cover the shift even though
    1600m of min-contract slack is unavoidable. If coverage is correctly
    ranked, the solver assigns; if inverted, it leaves uncovered.
    """
    shifts = [make_shift("s1", "2026-05-15", "09:00", "15:40", duration_minutes=400)]
    employees = [
        make_employee("e1", employment_type="FT", min_contract_minutes=2000),
    ]
    out = solve(shifts, employees)
    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1, (
        "Coverage penalty must outrank min-contract slack. If this fails, "
        "the penalty tiers in _add_objective have inverted again."
    )


def test_coverage_outranks_workload_slack():
    """Same principle for HC-4 (workload) slack: coverage > Tier-0 per-shift.
    A single high-priority shift outweighs any plausible Tier-0 slack."""
    shifts = [make_shift("s1", priority=10)]
    employees = [make_employee("e1", min_contract_minutes=5000)]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1, (
        "Priority-10 coverage penalty must outrank workload slack."
    )


def test_strategy_sliders_change_assignment_choice():
    """Regression: confirm the strategy multipliers actually flow through
    to the objective. With two equally-eligible employees at different
    rates, raising cost_weight from 0 to 100 must shift the assignment
    toward the cheaper one.
    """
    shifts = [make_shift("s1")]
    cheap = make_employee("cheap", hourly_rate=20.0)
    expensive = make_employee("expensive", hourly_rate=40.0)

    cost_off = solve([shifts[0]], [cheap, expensive],
                     strategy=StrategyInput(cost_weight=0))
    cost_high = solve([shifts[0]], [cheap, expensive],
                      strategy=StrategyInput(cost_weight=100))
    # With cost_weight=100, solver MUST prefer the cheap employee.
    assert cost_high.assignments[0].employee_id == "cheap"
    # cost_off shouldn't crash and should still cover.
    assert len(cost_off.assignments) == 1


# ---------------------------------------------------------------------------
# Defensive eligibility (Fix #5)
# ---------------------------------------------------------------------------

def test_missing_level_does_not_filter_out_pool():
    """Regression: emp.level=None or shift.level=None used to compare as
    `None < 0` and silently filter every employee. Defensive defaults
    treat missing values as 0 to keep the pool intact."""
    shifts = [make_shift("s1", level=0)]
    e = make_employee("e1")
    e.level = None  # type: ignore[assignment]
    out = solve(shifts, [e])
    assert len(out.assignments) == 1


def test_short_shift_under_180m_still_assignable():
    """Regression: pre-fix, the eligibility filter rejected any shift
    under 180m as 'min engagement' violation. 1-2h training/briefing
    blocks are real and should be schedulable. The post-fix sanity floor
    is 60m."""
    shifts = [make_shift("s1", duration_minutes=90, start="09:00", end="10:30")]
    employees = [make_employee("e1")]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# Availability hard filter (Phase-1 #1 / HC-5d)
# ---------------------------------------------------------------------------

def test_no_availability_records_treated_as_universally_available():
    """Policy: an employee with `has_availability_data=False` (no records
    on file at all) is universally available — treated as 'not yet
    onboarded'. The shift should be assigned."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [make_employee("e1", has_availability_data=False)]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


def test_declared_availability_covering_shift_allows_assignment():
    """An employee with `has_availability_data=True` and a slot fully
    covering the shift can be assigned."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [
        make_employee(
            "e1",
            has_availability_data=True,
            availability_slots=[
                AvailabilitySlotInput(
                    slot_date="2026-05-15", start_time="08:00", end_time="18:00",
                ),
            ],
        ),
    ]
    out = solve(shifts, employees)
    assert len(out.assignments) == 1


def test_declared_availability_not_covering_shift_blocks_assignment():
    """An employee with declared availability that doesn't cover the
    shift must be hard-rejected; the shift goes uncovered if no other
    candidate is available."""
    shifts = [make_shift("s1", "2026-05-15", "09:00", "17:00")]
    employees = [
        make_employee(
            "e1",
            has_availability_data=True,
            availability_slots=[
                AvailabilitySlotInput(
                    slot_date="2026-05-15", start_time="18:00", end_time="22:00",
                ),
            ],
        ),
    ]
    out = solve(shifts, employees)
    # Solver must NOT place the candidate; shift goes uncovered.
    assert len(out.assignments) == 0
    assert "s1" in out.unassigned_shift_ids


# ---------------------------------------------------------------------------
# Relaxed-violations branch (Fix #3)
# ---------------------------------------------------------------------------

def test_relax_constraints_does_not_raise():
    """Regression: pre-fix, `_add_objective` referenced an undefined
    `self._relaxed_violations` attribute. Toggling Relax Blockers raised
    AttributeError and the run failed end-to-end. The dead branch was
    removed; we now assert the path runs cleanly."""
    shifts = [make_shift("s1")]
    employees = [make_employee("e1")]
    constraints = OptimizerConstraints(
        min_rest_minutes=600, relax_constraints=True,
        enforce_role_match=False, enforce_skill_match=False,
        allow_partial=True,
    )
    out = solve(shifts, employees, constraints=constraints)
    assert out.status in ("OPTIMAL", "FEASIBLE")


# ---------------------------------------------------------------------------
# C1 — Interval-variable refactor (Phase 1)
# ---------------------------------------------------------------------------

def test_interval_vars_drop_constraint_count():
    """The interval-variable refactor cuts constraint count by ~6× vs the
    legacy pairwise approach. We don't want to regress to pairwise and
    silently double the build time again. Threshold is generous to allow
    for new constraint families (workload, spread, etc.)."""
    # 20 overlapping shifts × 10 employees = 200 candidate pairs.
    shifts = [
        make_shift(f"s{i}", "2026-05-15", f"{6 + i:02d}:00", f"{14 + i:02d}:00")
        for i in range(20)
    ]
    employees = [make_employee(f"e{i}") for i in range(10)]
    out = solve(shifts, employees, max_time_seconds=10)
    # Pairwise would emit ~10 employees × C(20,2)=190 pairs × 2 (HC-2 + HC-3)
    # = 3 800 constraints just for overlap+rest. AddNoOverlap emits
    # ~10 (one per employee) + workload/spread/objective overhead.
    # Empirically: ~1 700 with the new model. Set the regression bar at
    # 2 500 — well above current, well below pairwise.
    assert out.metrics.num_constraints < 2500, (
        f"Constraint count {out.metrics.num_constraints} suggests we've "
        f"regressed to pairwise overlap/rest constraints."
    )
    assert out.status in ("OPTIMAL", "FEASIBLE")
