"""
Availability enforcement (policy 2026-07): for the Auto Scheduler, declared
availability is a HARD constraint and "unset = unavailable".

  - enforce_availability=True (the live auto-scheduler): an employee is eligible
    for a shift ONLY if it is fully contained in a declared slot; an employee with
    NO slots is unavailable for every shift, and a shift outside every slot is
    infeasible to assign.
  - enforce_availability=False (legacy default, tests/back-compat): an employee
    with no records is treated as universally available.
"""
from model_builder import AvailabilitySlotInput, OptimizerConstraints

from .conftest import make_employee, make_shift, solve


def _enforced() -> OptimizerConstraints:
    return OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
    )


def test_unset_availability_is_unavailable_when_enforced():
    """No availability records + enforce_availability=True → not schedulable."""
    shift = make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00")
    emp = make_employee(eid="e1")  # no availability_slots
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_covering_slot_allows_assignment_when_enforced():
    """A slot that fully contains the shift → schedulable."""
    shift = make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_slots=[AvailabilitySlotInput("2026-05-15", "08:00", "18:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 1
    assert out.assignments[0].employee_id == "e1"


def test_partial_slot_blocks_assignment_when_enforced():
    """A slot that does NOT fully contain the shift → infeasible (unassigned)."""
    shift = make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_slots=[AvailabilitySlotInput("2026-05-15", "09:00", "12:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_wrong_date_slot_blocks_assignment_when_enforced():
    """A slot on a different date does not cover the shift → unassigned."""
    shift = make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00")
    emp = make_employee(
        eid="e1",
        availability_slots=[AvailabilitySlotInput("2026-05-16", "08:00", "18:00")],
    )
    out = solve([shift], [emp], constraints=_enforced())
    assert len(out.assignments) == 0


def test_unset_availability_is_available_when_not_enforced():
    """Back-compat: default (enforce_availability=False) keeps "no records = available"."""
    shift = make_shift(sid="s1", date="2026-05-15", start="09:00", end="17:00")
    emp = make_employee(eid="e1")  # no slots, no has_availability_data
    out = solve([shift], [emp])  # default constraints
    assert len(out.assignments) == 1
