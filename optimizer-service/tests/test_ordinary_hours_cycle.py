"""
ICC EBA cl 35.x(a) — the ordinary-hours ceiling is a DECLARED cycle.

cl 35.1(a) (FT), 35.2(b) (PT), 35.3(b) (FPT) and 35.4(a) (CASUAL) all state one
ladder — 38h in 1 week, 76h in 2, 114h in 3, OR 152h in 4 — and cl 12.2(b)
supplies the other half: the engagement runs "over a work cycle of up to four (4)
weeks". The rungs are joined by "or", so the employer declares one and 35.x(a)
prices it. The solver used to hardcode the four-week rung for everyone and apply
it as a ROLLING 28-day window, which is a different rule in two ways at once.

`test_schedule3_and_spread.py` covers the Schedule 3 branch; this file covers the
declared cycle, the anchoring, and the population.
"""
from __future__ import annotations

from datetime import date, timedelta

from .conftest import make_employee, make_shift, solve

# Opens a four-week cycle against the shared 2024-01-01 Monday anchor.
CYCLE_START = date(2026, 5, 18)


def day(n: int, base: date = CYCLE_START) -> str:
    return (base + timedelta(days=n)).isoformat()


def legal_penalty(out) -> int:
    """Tier-0 objective mass. Nonzero means a hard legal cap was breached."""
    return (out.objective_breakdown or {}).get("legal", 0)


def bound(out) -> bool:
    """The cap bound if the solver dropped work or paid the Tier-0 penalty."""
    return bool(out.unassigned_shift_ids) or legal_penalty(out) > 0


def eight_hour_days(day_offsets, base: date = CYCLE_START):
    return [
        make_shift(sid=f"s{i}", date=day(i, base), start="09:00", end="17:00")
        for i in day_offsets
    ]


# ---------------------------------------------------------------------------
# The population — cl 35.4(a) caps casuals in the same words as 35.1(a)
# ---------------------------------------------------------------------------

def test_a_casual_is_held_to_the_ordinary_hours_cycle():
    """
    The regression that matters most commercially.

    Every layer used to exempt casuals from this cap — the solver gated it on
    `employment_type in ('FT','PT')`. cl 35.4(a) says otherwise in the same words
    it uses for full-timers, and production is overwhelmingly casual, so this was
    the population where an unenforced ceiling actually costs money: hours past
    it are overtime under cl 42.1 at 150% then 200%, casual loading absorbed
    (cl 42.2).
    """
    shifts = eight_hour_days(list(range(19)) + [27])   # 20 × 8h = 160h > 152h
    out = solve(shifts, [make_employee("e1", employment_type="Casual",
                                       max_weekly_minutes=100_000)])
    assert bound(out), "a casual worked 160h in one four-week cycle and nothing objected"


def test_a_casual_inside_the_ceiling_is_left_alone():
    """The cap must bind, not simply reject casual work outright."""
    shifts = eight_hour_days(list(range(18)))          # 18 × 8h = 144h < 152h
    out = solve(shifts, [make_employee("e1", employment_type="Casual",
                                       max_weekly_minutes=100_000)])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0


# ---------------------------------------------------------------------------
# The declared length — cl 35.x(a) is a disjunction, not four caps
# ---------------------------------------------------------------------------

def test_a_declared_two_week_cycle_binds_at_76h():
    """
    80h in the declared fortnight. Lawful for someone on the four-week rung and
    a breach for someone on the two-week one — which is exactly the distinction
    the system could not previously express, because the cycle lived nowhere.
    """
    shifts = eight_hour_days(list(range(10)))          # 10 × 8h = 80h > 76h
    out = solve(shifts, [make_employee("e1", employment_type="FT",
                                       max_weekly_minutes=100_000,
                                       ordinary_hours_cycle_weeks=2)])
    assert bound(out), "a declared two-week cycle did not bind at 76h"


def test_the_same_roster_passes_on_a_four_week_cycle():
    """Same 80h, same employee, one declared field different."""
    shifts = eight_hour_days(list(range(10)))
    out = solve(shifts, [make_employee("e1", employment_type="FT",
                                       max_weekly_minutes=100_000,
                                       ordinary_hours_cycle_weeks=4)])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0


# ---------------------------------------------------------------------------
# The shape — anchored, not rolling
# ---------------------------------------------------------------------------

def test_a_block_straddling_two_cycles_is_not_a_breach():
    """
    THE BEHAVIOUR CHANGE, pinned deliberately.

    The identical 20-worked-day block moved two weeks earlier starts 11 days into
    cycle 30 and splits 136h/24h across two cycles — under the 152h ceiling both
    times. A rolling 28-day window sums it to 160h and rejects the roster; the
    cycle the Agreement actually caps does not.

    This is not a hole. Density is governed by cl 35.1(e)'s 20-in-28, which is
    enforced separately and for every employment type; this fixture deliberately
    works exactly 20 days so that cap stays satisfied and only the ordinary-hours
    rule can speak.
    """
    earlier = CYCLE_START - timedelta(days=17)         # 2026-05-01, mid-cycle
    shifts = eight_hour_days(list(range(19)) + [27], base=earlier)
    out = solve(shifts, [make_employee("e1", employment_type="FT",
                                       max_weekly_minutes=100_000)])
    assert out.unassigned_shift_ids == []
    assert legal_penalty(out) == 0


def test_the_anchor_moves_the_boundary():
    """
    Same roster, same cycle length, different declared anchor.

    Proves the anchor is genuinely load-bearing rather than decorative: shifting
    it by two weeks re-cuts the same 80h fortnight across a boundary, and the
    breach disappears.
    """
    shifts = eight_hour_days(list(range(10)))          # 80h from 2026-05-18

    on_boundary = solve(shifts, [make_employee(
        "e1", employment_type="FT", max_weekly_minutes=100_000,
        ordinary_hours_cycle_weeks=2, ordinary_hours_cycle_anchor="2024-01-01")])
    assert bound(on_boundary)

    # 2024-01-08 is a Monday one week later, which puts 2026-05-18 mid-cycle.
    straddling = solve(shifts, [make_employee(
        "e1", employment_type="FT", max_weekly_minutes=100_000,
        ordinary_hours_cycle_weeks=2, ordinary_hours_cycle_anchor="2024-01-08")])
    assert straddling.unassigned_shift_ids == []
    assert legal_penalty(straddling) == 0
