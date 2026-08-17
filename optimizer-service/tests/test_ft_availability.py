"""
Tests for Full-Time (FT) Availability Removal and Contract Obligation Model.

FT employees are available by default across contractual ordinary hours.
Availability is not declared via availability slots.
Unavailability is managed strictly through Leave Management (unavailable_dates).
"""
from model_builder import (
    AvailabilitySlotInput,
    OptimizerConstraints,
    employee_eligible,
)
from ortools_runner import _explain_eligibility
from .conftest import make_employee, make_shift, solve

DATE = "2026-05-15"
DATE_NEXT = "2026-05-16"


def _enforced() -> OptimizerConstraints:
    return OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
    )


def test_ft_employee_with_zero_availability_slots_is_schedulable():
    """FT employees have implicit availability and require no availability slots."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="ft1",
        employment_type="FT",
        availability_mode="OPT_OUT",
        availability_slots=[],
        has_availability_data=False,
    )
    assert employee_eligible(emp, shift, _enforced()) is True

    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "ft1"


def test_ft_employee_on_approved_leave_is_excluded():
    """Approved leave (unavailable_dates) strictly excludes FT employees."""
    shift_on_leave = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    shift_working = make_shift(sid="s2", date=DATE_NEXT, start="09:00", end="17:00")

    emp = make_employee(
        eid="ft1",
        employment_type="FT",
        availability_mode="OPT_OUT",
        unavailable_dates=[DATE],
        availability_slots=[],
    )

    # Shift on leave date is ineligible
    assert employee_eligible(emp, shift_on_leave, _enforced()) is False

    # Shift on non-leave date is eligible
    assert employee_eligible(emp, shift_working, _enforced()) is True

    # Solver assigns only s2 to ft1
    out = solve([shift_on_leave, shift_working], [emp], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].shift_id == "s2"
    assert out.assignments[0].employee_id == "ft1"


def test_casual_employee_zero_slots_remains_unschedulable():
    """Casual employees retain OPT_IN availability — zero slots means unschedulable."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    emp = make_employee(
        eid="c1",
        employment_type="Casual",
        availability_mode="OPT_IN",
        availability_slots=[],
    )
    assert employee_eligible(emp, shift, _enforced()) is False

    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_casual_employee_with_matching_slot_is_schedulable():
    """Casual employee with declared matching slot is schedulable."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    slot = AvailabilitySlotInput(slot_date=DATE, start_time="08:00", end_time="18:00")
    emp = make_employee(
        eid="c1",
        employment_type="Casual",
        availability_mode="OPT_IN",
        availability_slots=[slot],
        has_availability_data=True,
    )
    assert employee_eligible(emp, shift, _enforced()) is True

    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "c1"


def test_ft_respects_contract_ordinary_span():
    """HC-5e: the contract envelope bounds an FT, who has no slots to bound them.

    Without this the FT model means "available 24/7 on all seven days" — the
    contract obligation the whole design rests on would be asserted in the UI and
    enforced nowhere.
    """
    inside = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    straddles_end = make_shift(sid="s2", date=DATE, start="14:00", end="20:00")
    outside = make_shift(sid="s3", date=DATE, start="20:00", end="23:00")

    emp = make_employee(
        eid="ft1",
        employment_type="FT",
        availability_mode="OPT_OUT",
        availability_slots=[],
        ordinary_span_start="06:00",
        ordinary_span_end="18:00",
    )

    assert employee_eligible(emp, inside, _enforced()) is True
    # Containment, not overlap — a shift half inside the span is not permitted.
    assert employee_eligible(emp, straddles_end, _enforced()) is False
    assert employee_eligible(emp, outside, _enforced()) is False

    out = solve([inside, straddles_end, outside], [emp], constraints=_enforced())
    assert [a.shift_id for a in out.assignments] == ["s1"]


def test_ft_respects_contract_ordinary_days():
    """The DAY half of the envelope, independent of the span."""
    # 2026-05-15 is a Friday (ISO 5); 2026-05-16 a Saturday (ISO 6).
    friday = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")
    saturday = make_shift(sid="s2", date=DATE_NEXT, start="09:00", end="17:00")

    emp = make_employee(
        eid="ft1",
        employment_type="FT",
        availability_mode="OPT_OUT",
        ordinary_span_start="06:00",
        ordinary_span_end="18:00",
        ordinary_days=[1, 2, 3, 4, 5],  # Mon-Fri
    )

    assert employee_eligible(emp, friday, _enforced()) is True
    assert employee_eligible(emp, saturday, _enforced()) is False


def test_envelope_is_unrestricted_unless_both_ends_are_set():
    """Every contract in production today. A half-configured span is NOT a bound
    with one open edge — it is no bound at all, matching `toEnvelope` in
    availability/domain/contract-basis.ts and the DB's own CHECK."""
    night = make_shift(sid="s1", date=DATE, start="22:00", end="06:00")

    for kwargs in (
        {},
        {"ordinary_span_start": "06:00"},
        {"ordinary_span_end": "18:00"},
    ):
        emp = make_employee(
            eid="ft1", employment_type="FT", availability_mode="OPT_OUT", **kwargs,
        )
        assert employee_eligible(emp, night, _enforced()) is True, kwargs


def test_envelope_handles_a_span_crossing_midnight():
    """An 18:00–02:00 span must contain a 22:00–01:00 shift."""
    emp = make_employee(
        eid="ft1", employment_type="FT", availability_mode="OPT_OUT",
        ordinary_span_start="18:00", ordinary_span_end="02:00",
    )
    assert employee_eligible(
        emp, make_shift(sid="s1", date=DATE, start="22:00", end="01:00"), _enforced(),
    ) is True
    # …and must still exclude a morning shift.
    assert employee_eligible(
        emp, make_shift(sid="s2", date=DATE, start="09:00", end="17:00"), _enforced(),
    ) is False


def test_envelope_binds_casuals_too():
    """The envelope answers what the CONTRACT permits, so it is not FT-only: a
    declaration cannot widen a contract."""
    slot = AvailabilitySlotInput(slot_date=DATE, start_time="06:00", end_time="23:00")
    emp = make_employee(
        eid="c1", employment_type="Casual", availability_mode="OPT_IN",
        availability_slots=[slot], has_availability_data=True,
        ordinary_span_start="06:00", ordinary_span_end="18:00",
    )
    # Declared available until 23:00, but the contract stops at 18:00.
    assert employee_eligible(
        emp, make_shift(sid="s1", date=DATE, start="19:00", end="22:00"), _enforced(),
    ) is False
    assert employee_eligible(
        emp, make_shift(sid="s2", date=DATE, start="09:00", end="17:00"), _enforced(),
    ) is True


def test_audit_explains_an_envelope_exclusion_distinctly():
    """The audit must name the envelope, not blame a declaration the employee
    does not have and could not widen."""
    shift = make_shift(sid="s1", date=DATE, start="20:00", end="23:00")
    emp = make_employee(
        eid="ft1", employment_type="FT", availability_mode="OPT_OUT",
        ordinary_span_start="06:00", ordinary_span_end="18:00",
    )
    reasons = _explain_eligibility(emp, shift, _enforced())
    assert "OUTSIDE_CONTRACT_ORDINARY_HOURS" in reasons
    assert "OUTSIDE_DECLARED_AVAILABILITY" not in reasons


def test_audit_explain_eligibility_ft_vs_casual():
    """_explain_eligibility does not flag OUTSIDE_DECLARED_AVAILABILITY for FT."""
    shift = make_shift(sid="s1", date=DATE, start="09:00", end="17:00")

    ft_emp = make_employee(
        eid="ft1",
        employment_type="FT",
        availability_mode="OPT_OUT",
        availability_slots=[],
    )
    reasons_ft = _explain_eligibility(ft_emp, shift, _enforced())
    assert "OUTSIDE_DECLARED_AVAILABILITY" not in reasons_ft

    casual_emp = make_employee(
        eid="c1",
        employment_type="Casual",
        availability_mode="OPT_IN",
        availability_slots=[],
    )
    reasons_casual = _explain_eligibility(casual_emp, shift, _enforced())
    assert "OUTSIDE_DECLARED_AVAILABILITY" in reasons_casual
