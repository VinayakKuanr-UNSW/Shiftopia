"""
Dated availability overrides.

`availability_overrides` used to be `(start_time, end_time, severity)`, and
every consumer resolved those times against `shift.shift_date` — so an entry
meant "this clock window on EVERY day of the horizon". That made the channel
unable to express the two things it is most obviously for: a dated one-off
exception, and leave that has been requested but not yet approved.

Nothing populated the field, so reshaping it broke no caller. What these pin:

  * a dated override bears ONLY on its own date;
  * an undated one keeps the every-day meaning, so the legacy tuple still works;
  * HARD blocks, SOFT/PREFERENCE only cost — coverage still outranks them;
  * overlap, not containment: an override says "not during this", so clipping
    any part of the shift counts.
"""
import pytest

from model_builder import (
    AvailabilityOverrideInput,
    OptimizerConstraints,
    _coerce_override,
    employee_eligible,
    override_blocks_shift,
)

from .conftest import make_employee, make_shift, solve

DATE = "2026-05-15"
NEXT = "2026-05-16"


def _relaxed() -> OptimizerConstraints:
    return OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
    )


# ---------------------------------------------------------------------------
# Coercion — the wire accepts three shapes
# ---------------------------------------------------------------------------

def test_coerces_the_legacy_three_tuple_with_no_date():
    ov = _coerce_override(("09:00", "17:00", "HARD"))
    assert (ov.start_time, ov.end_time, ov.severity, ov.date) == ("09:00", "17:00", "HARD", None)


def test_coerces_a_mapping_including_the_date():
    ov = _coerce_override({"start_time": "09:00", "end_time": "17:00",
                           "severity": "SOFT", "date": DATE})
    assert ov.date == DATE and ov.severity == "SOFT"


def test_coerces_a_four_tuple():
    ov = _coerce_override(("09:00", "17:00", "PREFERENCE", DATE))
    assert ov.date == DATE and ov.severity == "PREFERENCE"


def test_passes_the_dataclass_through_untouched():
    original = AvailabilityOverrideInput("09:00", "17:00", "HARD", DATE)
    assert _coerce_override(original) is original


def test_an_unrecognised_severity_degrades_to_SOFT_never_to_HARD():
    # A typo must not silently become a hard block on someone's roster.
    assert AvailabilityOverrideInput("09:00", "17:00", "hrad").severity == "SOFT"
    assert AvailabilityOverrideInput("09:00", "17:00", "").severity == "SOFT"


def test_severity_is_case_and_space_insensitive():
    assert AvailabilityOverrideInput("09:00", "17:00", "  hard ").severity == "HARD"


def test_the_employee_constructor_coerces_the_whole_list():
    emp = make_employee(availability_overrides=[("09:00", "17:00", "HARD")])
    assert isinstance(emp.availability_overrides[0], AvailabilityOverrideInput)


# ---------------------------------------------------------------------------
# Date scoping
# ---------------------------------------------------------------------------

def test_a_dated_override_bears_only_on_its_own_date():
    on_date = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    other_date = make_shift(sid="s2", date=NEXT, start="09:00", end="17:00")
    ov = AvailabilityOverrideInput("08:00", "18:00", "HARD", DATE)

    assert override_blocks_shift(ov, on_date) is True
    assert override_blocks_shift(ov, other_date) is False


def test_an_undated_override_still_means_every_day():
    """The legacy meaning, preserved — this is what a bare tuple produces."""
    ov = AvailabilityOverrideInput("08:00", "18:00", "HARD", None)
    for date in (DATE, NEXT, "2026-12-25"):
        assert override_blocks_shift(ov, make_shift(date=date, start="09:00", end="17:00"))


def test_a_hard_dated_override_makes_the_employee_ineligible_on_that_date_only():
    emp = make_employee(
        eid="e1",
        availability_overrides=[AvailabilityOverrideInput("08:00", "18:00", "HARD", DATE)],
    )
    assert employee_eligible(emp, make_shift(date=DATE, start="09:00", end="17:00"), _relaxed()) is False
    assert employee_eligible(emp, make_shift(date=NEXT, start="09:00", end="17:00"), _relaxed()) is True


# ---------------------------------------------------------------------------
# Overlap semantics
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("start,end,blocked", [
    ("09:00", "17:00", True),   # exactly the window
    ("10:00", "12:00", True),   # entirely inside
    ("06:00", "10:00", True),   # clips the front
    ("16:00", "20:00", True),   # clips the back
    ("06:00", "20:00", True),   # swallows it
    ("06:00", "09:00", False),  # ends exactly as it starts — no overlap
    ("17:00", "20:00", False),  # starts exactly as it ends
    ("06:00", "08:00", False),  # well before
])
def test_overlap_not_containment(start, end, blocked):
    ov = AvailabilityOverrideInput("09:00", "17:00", "HARD", DATE)
    shift = make_shift(date=DATE, start=start, end=end)
    assert override_blocks_shift(ov, shift) is blocked


def test_a_whole_day_window_catches_every_shift_on_that_date():
    # The shape `buildPendingLeaveOverrides` emits for a pending-leave day.
    ov = AvailabilityOverrideInput("00:00", "23:59", "SOFT", DATE)
    for start, end in (("05:30", "13:30"), ("09:00", "17:00"), ("18:00", "22:00")):
        assert override_blocks_shift(ov, make_shift(date=DATE, start=start, end=end))


def test_a_cross_midnight_window_is_anchored_to_its_own_date():
    ov = AvailabilityOverrideInput("22:00", "02:00", "HARD", DATE)
    assert override_blocks_shift(ov, make_shift(date=DATE, start="23:00", end="23:59"))
    assert override_blocks_shift(ov, make_shift(date=NEXT, start="00:30", end="01:30")) is False


# ---------------------------------------------------------------------------
# Severity: HARD blocks, SOFT/PREFERENCE only cost
# ---------------------------------------------------------------------------

def test_soft_and_preference_never_make_someone_ineligible():
    shift = make_shift(date=DATE, start="09:00", end="17:00")
    for severity in ("SOFT", "PREFERENCE"):
        emp = make_employee(
            eid="e1",
            availability_overrides=[AvailabilityOverrideInput("00:00", "23:59", severity, DATE)],
        )
        assert employee_eligible(emp, shift, _relaxed()) is True


def test_a_soft_override_still_yields_to_coverage():
    """Pending leave must not be able to leave a shift uncovered.

    This is the whole reason pending leave is SOFT rather than HARD: a request
    is not a decision, and hard-excluding it would let anyone take themselves
    off the roster simply by asking.
    """
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    only_candidate = make_employee(
        eid="e1",
        availability_overrides=[AvailabilityOverrideInput("00:00", "23:59", "SOFT", DATE)],
    )
    out = solve([shift], [only_candidate], constraints=_relaxed())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "e1"


def test_the_solver_prefers_the_candidate_without_a_soft_override():
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    on_pending_leave = make_employee(
        eid="pending",
        availability_overrides=[AvailabilityOverrideInput("00:00", "23:59", "SOFT", DATE)],
    )
    free = make_employee(eid="free")
    out = solve([shift], [on_pending_leave, free], constraints=_relaxed())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "free"


def test_a_soft_override_on_another_date_does_not_bias_this_one():
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    # Both are free on DATE; the override sits on NEXT and must not tip the pick.
    a = make_employee(
        eid="a",
        availability_overrides=[AvailabilityOverrideInput("00:00", "23:59", "SOFT", NEXT)],
    )
    b = make_employee(eid="b")
    out = solve([shift], [a, b], constraints=_relaxed())
    assert len(out.assignments) == 1
