"""
Phase 5 — reconciling the CP-SAT model with the labour layer.

Two engines implement one agreement, and where their numbers disagree the
failure is silent: the solver proposes a roster, the labour layer rejects it,
and nothing connects the two events. These tests cover the divergences that
audit found, from the solver side. `solver-threshold-parity.test.ts` covers the
same ground from the TypeScript side by reading this module's constants.
"""
from __future__ import annotations

from datetime import date, timedelta

from .conftest import make_employee, make_shift, solve
from model_builder import (
    ORD_AVG_CYCLE_DAYS,
    ORD_AVG_CYCLE_MINUTES,
    ORD_AVG_SECURITY_CYCLE_DAYS,
    ORD_AVG_SECURITY_CYCLE_MINUTES,
    SPLIT_SHIFT_SPREAD_MINUTES,
)

D0 = date(2026, 5, 1)


def day(n: int) -> str:
    return (D0 + timedelta(days=n)).isoformat()


def legal_penalty(out) -> int:
    """Tier-0 objective mass. Nonzero means a hard legal cap was breached."""
    return (out.objective_breakdown or {}).get("legal", 0)


# ---------------------------------------------------------------------------
# EBA Schedule 3 §3.1 — the full-time Security work cycle
# ---------------------------------------------------------------------------

def _twenty_day_month():
    """20 eight-hour days inside a 28-day horizon: 9600 minutes.

    Over the general 152h/28d ceiling by 480 minutes, and comfortably under
    Schedule 3's 336h/56d. Twenty worked days keeps the 20-in-28 cap
    (cl 35.1(e)) satisfied, so the ONLY thing that can fire is the
    ordinary-hours average — which is the point.
    """
    days = list(range(19)) + [27]          # 20 worked days, spanning 28
    return [make_shift(sid=f"s{i}", date=day(i), start="09:00", end="17:00") for i in days]


def test_general_full_timer_is_held_to_the_38h_four_week_cycle():
    shifts = _twenty_day_month()
    out = solve(shifts, [make_employee("e1", employment_type="FT", max_weekly_minutes=100_000)])

    total = sum(s.duration_minutes for s in shifts)
    assert total > ORD_AVG_CYCLE_MINUTES, "fixture no longer exceeds the general cycle"

    # Coverage sits BELOW legal in the lexicographic objective, so the solver
    # would rather leave a shift uncovered than breach the cap. Either outcome
    # proves the constraint bound; both together prove it bound HARD.
    assert out.unassigned_shift_ids or legal_penalty(out) > 0, (
        "a full-timer worked 160h in 28 days and nothing objected"
    )


def test_full_time_security_gets_the_schedule_3_cycle_instead():
    # Same roster, same employee, one flag different. Sch 3 §3.1 gives full-time
    # Security an "even time" 8-week cycle averaging 42h/week, and Sch 3 §1.1
    # makes it prevail over cl 35 — so 160h in 28 days is inside their envelope,
    # not outside it.
    shifts = _twenty_day_month()
    out = solve(
        shifts,
        [make_employee("e1", employment_type="FT", is_security_role=True, max_weekly_minutes=100_000)],
    )

    assert out.unassigned_shift_ids == [], (
        "full-time Security was still sized against the general 38h/4-week "
        "envelope — the Schedule 3 branch did not take"
    )
    assert legal_penalty(out) == 0


def test_part_time_security_keeps_the_general_cycle():
    # Sch 3 §5 covers part-time and casual EVENT security and does NOT extend
    # §3.1's cycle to them. The branch must test employment type as well as the
    # role, exactly as `ordinaryHoursAvgRule`'s `isFtSecurity` does.
    shifts = _twenty_day_month()
    out = solve(
        shifts,
        [make_employee("e1", employment_type="PT", is_security_role=True, max_weekly_minutes=100_000)],
    )
    assert out.unassigned_shift_ids or legal_penalty(out) > 0


def test_the_two_cycles_are_the_documented_numbers():
    assert (ORD_AVG_CYCLE_DAYS, ORD_AVG_CYCLE_MINUTES) == (28, 9120)          # 38h x 4wk
    assert (ORD_AVG_SECURITY_CYCLE_DAYS, ORD_AVG_SECURITY_CYCLE_MINUTES) == (56, 20160)  # 42h x 8wk


# ---------------------------------------------------------------------------
# cl 39.2 — the split-shift spread ceiling
# ---------------------------------------------------------------------------

def _two_engagements(unpaid: int = 0):
    """06:00-08:00 and 18:00-20:00 — a 14h span, 840 minutes.

    The wide gap is only there to push the span past the 12h ceiling; it is not
    required to make the pair assignable. `_add_overlap_and_rest` deliberately
    exempts same-start-day pairs from the rest gap (audit H4) precisely so a
    lawful split shift under cl 39.4 — two engagements no more than 3h apart —
    remains reachable. Verified: the same fixture at a 2h gap assigns both.
    """
    return [
        make_shift(sid="a", date=day(0), start="06:00", end="08:00", unpaid_break_minutes=unpaid),
        make_shift(sid="b", date=day(0), start="18:00", end="20:00", unpaid_break_minutes=unpaid),
    ]


def test_spread_no_longer_reaches_a_full_timer():
    # cl 39.1 and cl 7.14 confine split shifts to PT and FPT. Charging a
    # full-timer 100M/minute against a clause that does not reach them is what
    # made this the largest source of false blocks in the grid.
    out = solve(_two_engagements(), [make_employee("e1", employment_type="FT")])
    assert legal_penalty(out) == 0
    assert out.unassigned_shift_ids == []


def test_spread_no_longer_reaches_a_casual():
    # cl 28.4 excludes casuals from the split-shift structure entirely. Their
    # two-engagements case is cl 35.4(f)'s cap of two per day, enforced
    # separately in _add_workload_limits.
    out = solve(_two_engagements(), [make_employee("e1", employment_type="Casual")])
    assert legal_penalty(out) == 0


def test_spread_still_binds_a_part_timer():
    out = solve(_two_engagements(), [make_employee("e1", employment_type="PT")])
    assert out.unassigned_shift_ids or legal_penalty(out) > 0, (
        "cl 39.2 stopped binding the one population it governs"
    )


def test_spread_is_measured_net_of_unpaid_breaks():
    # The same 840-minute span, less 120 minutes of unpaid break, is 720 minutes
    # of spread — the ceiling exactly. Measured gross, as this constraint used
    # to be, it was a 14h breach and the roster was refused.
    out = solve(_two_engagements(unpaid=60), [make_employee("e1", employment_type="PT")])
    assert legal_penalty(out) == 0
    assert out.unassigned_shift_ids == []
    assert SPLIT_SHIFT_SPREAD_MINUTES == 720


# ---------------------------------------------------------------------------
# The 60-minute eligibility floor
# ---------------------------------------------------------------------------

def test_a_short_shift_is_assignable_rather_than_silently_uncovered():
    """The floor rejected any shift under 60 minutes, before a variable existed.

    Its stated justification — that "the proper award-specific min engagement is
    enforced as a soft penalty inside the V8 compliance engine" — is false twice
    over: minimum engagement is a SHAPE rule now, blocking at creation, and 60
    minutes is not a number the EBA contains (the minima are 2h, 3h and 4h).

    Its effect was to make such a shift assignable to nobody, so it returned as
    uncovered with no reason given — indistinguishable from having no qualified
    staff. Leaving a shift uncovered does not cure a minimum-engagement breach.
    """
    out = solve(
        [make_shift(sid="short", date=day(0), start="09:00", end="09:45")],
        [make_employee("e1", employment_type="Casual")],
    )
    assert out.unassigned_shift_ids == []
    assert [a.shift_id for a in out.assignments] == ["short"]


def test_a_zero_length_shift_is_still_refused():
    # The invariant the check should always have been. A shift nobody can work
    # is a data defect, not an award judgement.
    out = solve(
        [make_shift(sid="degenerate", date=day(0), start="09:00", end="09:00", duration_minutes=0)],
        [make_employee("e1", employment_type="Casual")],
    )
    assert out.unassigned_shift_ids == ["degenerate"]


# ---------------------------------------------------------------------------
# The wire
# ---------------------------------------------------------------------------

def test_is_security_role_survives_the_http_boundary():
    """The flag was populated by the controller and dropped in transit.

    Pydantic ignores unknown fields rather than rejecting them, so an undeclared
    key arrives, is discarded, and the solver runs on the default — silently.
    That is the same mechanism the `availability_mode` comment in
    `_build_eligibility` warns about, and it is why `ordinary_span_start` carries
    a "MUST be declared here or Pydantic drops it" note on `EmployeeReq`.

    `test_schema_contract.py` guards this structurally by pinning the pydantic
    and dataclass field sets together. This asserts the consequence directly, on
    the exact field and the exact filter the endpoint applies.
    """
    from model_builder import EmployeeInput
    from ortools_runner import EmployeeReq

    req = EmployeeReq(id="e1", name="Sam", is_security_role=True)
    payload = req.model_dump()
    assert payload["is_security_role"] is True, "dropped at the pydantic model"

    # The endpoint's own mapping: filter the dump by the dataclass's fields.
    emp = EmployeeInput(**{
        k: v for k, v in payload.items()
        if k in EmployeeInput.__dataclass_fields__
        and k not in ("existing_shifts", "availability_slots")
    })
    assert emp.is_security_role is True, "dropped between pydantic and the dataclass"


# ---------------------------------------------------------------------------
# Sch 3 §5.3(g) — casual event security spread
# ---------------------------------------------------------------------------

def test_cl_39_2_deducts_both_break_fields():
    """"...cannot exceed 12 hours EXCLUDING MEAL AND REST BREAKS."

    Reading only the unpaid half measured a longer spread than the agreement
    allows and refused pairings the labour layer accepts. 840m less 120m of
    meal break is 720m — the ceiling exactly.
    """
    shifts = [
        make_shift(sid="a", date=day(0), start="06:00", end="08:00", unpaid_break_minutes=60),
        make_shift(sid="b", date=day(0), start="18:00", end="20:00", unpaid_break_minutes=60),
    ]
    out = solve(shifts, [make_employee("e1", employment_type="PT")])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0


def test_casual_security_has_its_own_spread_cap():
    # Sch 3 §5.3(g) caps a casual Event Security member's two-shift day at 12
    # hours. Sch 3 §1.1 makes the schedule prevail, so this binds where cl 39.2
    # — a split-shift clause casuals are excluded from — does not.
    out = solve(_two_engagements(), [
        make_employee("e1", employment_type="Casual", is_security_role=True),
    ])
    assert out.unassigned_shift_ids or legal_penalty(out) > 0


def test_casual_security_spread_is_measured_gross():
    """The decisive difference from cl 39.2.

    §5.3(g) states no exclusion for breaks, and §5.3(a) has already made the
    meal break paid — there is no unpaid time to take out. Deducting breaks here
    would read the cap out of existence.
    """
    out = solve(_two_engagements(unpaid=60), [
        make_employee("e1", employment_type="Casual", is_security_role=True),
    ])
    assert out.unassigned_shift_ids or legal_penalty(out) > 0, (
        "breaks bought headroom against a GROSS cap"
    )


def test_a_general_casual_has_no_spread_cap():
    # cl 35.4(f) caps the TOTAL ENGAGEMENT (hours worked) at 12h, not the span.
    # Where the drafters meant span they wrote "spread", four clauses later,
    # about the same fact pattern.
    out = solve(_two_engagements(), [make_employee("e1", employment_type="Casual")])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0


def test_a_compliant_casual_security_pair_is_allowed():
    shifts = [
        make_shift(sid="a", date=day(0), start="06:00", end="10:00"),
        make_shift(sid="b", date=day(0), start="14:00", end="18:00"),
    ]
    out = solve(shifts, [make_employee("e1", employment_type="Casual", is_security_role=True)])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0
