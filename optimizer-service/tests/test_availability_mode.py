"""
`availability_mode` — what an ABSENT availability slot means (HC-5d).

The two populations are opposites:

  OPT_IN  (casual)  availability is an OFFER. No slot => unavailable. The
                    pre-existing behaviour, and still the default.
  OPT_OUT (FT/PT)   availability is an EXCEPTION LEDGER. No slot => available.
                    These employees carry a contract floor HC-7 charges
                    100,000/minute against, so "no data" must not mean "cannot
                    work"; unavailability is stated positively instead, via
                    `unavailable_dates` or a HARD `availability_overrides`
                    entry.

This is a GUARD, not a feature. Once an ordinary-hours envelope is generated
into `availability_slots` for permanents, the slots do the constraining — but a
generator that stops running would otherwise take the whole permanent workforce
out of every roster. Production is already in that state without a generator:
all 17 FT carry seeded availability rules written in a single transaction, five
of them a 2-hour weekly window, leaving them eligible for nothing while still
owed 38h/week.
"""
from model_builder import (
    AvailabilitySlotInput,
    OptimizerConstraints,
    employee_eligible,
    normalize_availability_mode,
)

from .conftest import make_employee, make_shift, solve

DATE = "2026-05-15"


def _enforced() -> OptimizerConstraints:
    return OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
    )


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def test_normalize_accepts_the_wire_forms():
    for raw in ("OPT_OUT", "opt_out", "opt-out", "OptOut", "  out  "):
        assert normalize_availability_mode(raw) == "OPT_OUT"
    for raw in ("OPT_IN", "opt_in", "opt-in", "in"):
        assert normalize_availability_mode(raw) == "OPT_IN"


def test_normalize_falls_back_to_the_strict_reading():
    """Unknown/absent must never silently widen availability."""
    for raw in (None, "", "   ", "whatever", "OPTOUTT"):
        assert normalize_availability_mode(raw) == "OPT_IN"


def test_dataclass_normalizes_at_the_boundary():
    emp = make_employee(eid="e1", availability_mode="opt-out")
    assert emp.availability_mode == "OPT_OUT"


def test_default_is_opt_in():
    """Every existing caller and test predates this field."""
    assert make_employee(eid="e1").availability_mode == "OPT_IN"


# ---------------------------------------------------------------------------
# OPT_OUT — the guard
# ---------------------------------------------------------------------------

def test_opt_out_with_no_slots_is_schedulable_under_enforcement():
    """THE GUARD. Same input that leaves an OPT_IN employee unschedulable."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(eid="e1", availability_mode="OPT_OUT")
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "e1"


def test_opt_in_with_no_slots_stays_unschedulable():
    """The OPT_OUT branch must not have loosened casuals."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(eid="e1", availability_mode="OPT_IN")
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_opt_out_respects_a_declaration_on_the_SAME_date():
    """Silence means available; a declaration still constrains."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_mode="OPT_OUT",
        # Declared 09:00-12:00 only — the shift is not contained.
        availability_slots=[AvailabilitySlotInput(DATE, "09:00", "12:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_opt_out_allows_a_shift_contained_by_its_declaration():
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_mode="OPT_OUT",
        availability_slots=[AvailabilitySlotInput(DATE, "06:00", "18:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1


def test_opt_out_is_evaluated_PER_DATE_not_per_employee():
    """A partially-generated envelope must not block the ungenerated days.

    This is the difference between per-date and per-employee semantics, and the
    reason the branch is written per-date: a materializer that covers part of a
    horizon and stops would otherwise hard-block every day it did not reach.
    """
    covered = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    uncovered = make_shift(sid="s2", date="2026-05-22", start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_mode="OPT_OUT",
        # Envelope generated for the first date only.
        availability_slots=[AvailabilitySlotInput(DATE, "06:00", "18:00")],
    )
    out = solve([covered, uncovered], [emp], constraints=_enforced())
    assert {a.shift_id for a in out.assignments} == {"s1", "s2"}


def test_opt_out_slot_on_another_date_does_not_constrain_this_one():
    """The per-employee reading would block this; per-date does not."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_mode="OPT_OUT",
        availability_slots=[AvailabilitySlotInput("2026-05-16", "06:00", "18:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1


def test_opt_out_honours_a_narrow_declaration_among_several():
    """Any one covering slot on the date is enough; none is a block."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_mode="OPT_OUT",
        availability_slots=[
            AvailabilitySlotInput(DATE, "06:00", "08:00"),
            AvailabilitySlotInput(DATE, "08:00", "18:00"),   # covers
            AvailabilitySlotInput(DATE, "19:00", "22:00"),
        ],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1


# ---------------------------------------------------------------------------
# OPT_OUT does NOT weaken the positive unavailability channels
# ---------------------------------------------------------------------------

def test_opt_out_still_blocked_by_approved_leave():
    """`unavailable_dates` is checked before any of this and is unaffected.

    The whole fail-open rests on this: absence cannot express unavailability
    under OPT_OUT, so approved leave must keep blocking. If this ever regresses,
    the guard becomes a hole.
    """
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(eid="e1", availability_mode="OPT_OUT", unavailable_dates=[DATE])
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_opt_out_still_blocked_by_a_hard_override():
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="e1", availability_mode="OPT_OUT",
        availability_overrides=[("08:00", "18:00", "HARD")],
    )
    assert employee_eligible(emp, shift, _enforced()) is False


def test_opt_out_does_not_bypass_role_matching():
    """The mode governs availability only — other HC-5 filters stand."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00", role_id="role-B")
    emp = make_employee(eid="e1", availability_mode="OPT_OUT", contracted_role_ids=["role-A"])
    constraints = OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=True,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
    )
    assert employee_eligible(emp, shift, constraints) is False


# ---------------------------------------------------------------------------
# Mixed pools
# ---------------------------------------------------------------------------

def test_opt_out_permanent_wins_the_shift_a_slotless_casual_cannot_take():
    """The production shape: seeded/absent availability across a mixed pool.

    Before the mode existed both were ineligible and the shift went uncovered.
    """
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    ft = make_employee(eid="ft", employment_type="FT", availability_mode="OPT_OUT")
    casual = make_employee(eid="c", employment_type="Casual", availability_mode="OPT_IN")
    out = solve([shift], [ft, casual], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "ft"


def test_a_two_hour_weekly_window_no_longer_zeroes_a_full_timer():
    """The exact production case: 5 FT hold a 12:00-14:00 weekly rule.

    Under OPT_IN containment that FT is eligible for nothing while HC-7 still
    owes them 38h/week. As OPT_OUT the declaration binds only the day it names.
    """
    monday = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    tuesday = make_shift(sid="s2", date="2026-05-16", start="09:00", end="17:00")
    emp = make_employee(
        eid="ft",
        employment_type="FT",
        availability_mode="OPT_OUT",
        availability_slots=[AvailabilitySlotInput(DATE, "12:00", "14:00")],
    )
    out = solve([monday, tuesday], [emp], constraints=_enforced())
    # Monday's 09:00-17:00 is not inside the declared 12:00-14:00; Tuesday has
    # no declaration and so is open.
    assert {a.shift_id for a in out.assignments} == {"s2"}
