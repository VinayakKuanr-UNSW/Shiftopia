"""
HC-5d — availability is declared PER JOB, and matched per job.

Employment is a property of the contract, not the person, and one person can
hold several. Production carries an employee who is Full-Time in Building
Services · Security and Casual in Event Delivery · Set-up and Live Events ·
Front of House. Their Set-up declaration says nothing whatsoever about whether
they can work Security, and their Security contract says nothing about Set-up.

Before this, the solver read one flat slot list per employee and matched it
against every shift in the run, so the two jobs answered for each other:

  * under OPT_IN a Set-up slot made them ELIGIBLE for a Security shift they had
    never declared for — the solver would roster them, and the write would be
    the first thing to notice;
  * under OPT_OUT a narrowing declared for Set-up BLOCKED a Security shift on
    the same date, because a declaration present on a date binds that date and
    the branch could not tell which job the declaration was about.

The match cannot be done by filtering the fetch instead: one solve spans
sub-departments, so narrowing the slot read to a single job would un-declare
everyone else in the run. The scope has to travel with each slot and be matched
against the shift's own job at the point of use.

Both NULLs stay permissive, for different reasons — see `_slot_in_scope`.
"""
from dataclasses import replace

from model_builder import (
    AvailabilitySlotInput,
    OptimizerConstraints,
    _slot_in_scope,
    employee_eligible,
)

from .conftest import make_employee, make_shift

DATE = "2026-05-15"
SECURITY = "50000000-0000-0000-0000-000000000001"
SETUP = "50000000-0000-0000-0000-000000000002"


def _enforced() -> OptimizerConstraints:
    return OptimizerConstraints(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
    )


def _shift(sub_department_id, start="09:00", end="17:00"):
    return replace(
        make_shift(date=DATE, start=start, end=end),
        sub_department_id=sub_department_id,
    )


def _slot(sub_department_id, start="08:00", end="18:00"):
    return AvailabilitySlotInput(
        slot_date=DATE,
        start_time=start,
        end_time=end,
        sub_department_id=sub_department_id,
    )


# ---------------------------------------------------------------------------
# The scope predicate itself
# ---------------------------------------------------------------------------

def test_scope_matches_only_the_same_job():
    assert _slot_in_scope(_slot(SETUP), _shift(SETUP)) is True
    assert _slot_in_scope(_slot(SETUP), _shift(SECURITY)) is False


def test_a_slot_with_no_job_applies_to_every_job():
    # What every row carried before scoping, and what a department-wide
    # contract still produces.
    assert _slot_in_scope(_slot(None), _shift(SECURITY)) is True
    assert _slot_in_scope(_slot(None), _shift(SETUP)) is True


def test_a_shift_with_no_job_is_matched_by_every_slot():
    # There is no job to match against, and the alternative — matching nothing —
    # would make every employee ineligible for every shift and surface as an
    # infeasible model rather than as a missing field.
    assert _slot_in_scope(_slot(SETUP), _shift(None)) is True
    assert _slot_in_scope(_slot(None), _shift(None)) is True


# ---------------------------------------------------------------------------
# OPT_IN (casual) — a slot is what makes someone eligible at all
# ---------------------------------------------------------------------------

def test_optin_setup_declaration_does_not_make_them_eligible_for_security():
    emp = make_employee(
        employment_type="Casual",
        availability_mode="OPT_IN",
        has_availability_data=True,
        availability_slots=[_slot(SETUP)],
    )
    assert employee_eligible(emp, _shift(SECURITY), _enforced()) is False


def test_optin_setup_declaration_covers_a_setup_shift():
    emp = make_employee(
        employment_type="Casual",
        availability_mode="OPT_IN",
        has_availability_data=True,
        availability_slots=[_slot(SETUP)],
    )
    assert employee_eligible(emp, _shift(SETUP), _enforced()) is True


def test_optin_the_right_job_still_has_to_contain_the_shift():
    # Scope narrows; it never widens. A Set-up slot that stops at 15:00 does not
    # cover a 09:00–17:00 Set-up shift just because the job matches.
    emp = make_employee(
        employment_type="Casual",
        availability_mode="OPT_IN",
        has_availability_data=True,
        availability_slots=[_slot(SETUP, start="08:00", end="15:00")],
    )
    assert employee_eligible(emp, _shift(SETUP), _enforced()) is False


def test_optin_unscoped_slot_still_covers_everything():
    # The regression guard: every pre-scoping slot is NULL, so this is what the
    # entire existing production dataset does.
    emp = make_employee(
        employment_type="Casual",
        availability_mode="OPT_IN",
        has_availability_data=True,
        availability_slots=[_slot(None)],
    )
    assert employee_eligible(emp, _shift(SECURITY), _enforced()) is True
    assert employee_eligible(emp, _shift(None), _enforced()) is True


def test_optin_the_multi_contract_employee_end_to_end():
    # The production case: declared for Set-up only, eligible for Set-up only.
    emp = make_employee(
        employment_type="Casual",
        availability_mode="OPT_IN",
        has_availability_data=True,
        availability_slots=[_slot(SETUP)],
    )
    assert employee_eligible(emp, _shift(SETUP), _enforced()) is True
    assert employee_eligible(emp, _shift(SECURITY), _enforced()) is False


# ---------------------------------------------------------------------------
# OPT_OUT (FT/PT) — silence means available, so a declaration is a NARROWING
# ---------------------------------------------------------------------------

def test_optout_a_setup_narrowing_does_not_block_a_security_shift():
    # The inverse half of the same defect. Under OPT_OUT a declaration present
    # on a date binds that date; scoped, a Set-up narrowing leaves Security
    # untouched, which is correct because they never spoke about Security.
    emp = make_employee(
        employment_type="PT",
        availability_mode="OPT_OUT",
        has_availability_data=True,
        availability_slots=[_slot(SETUP, start="08:00", end="12:00")],
    )
    assert employee_eligible(emp, _shift(SECURITY), _enforced()) is True


def test_optout_a_setup_narrowing_does_block_a_setup_shift():
    emp = make_employee(
        employment_type="PT",
        availability_mode="OPT_OUT",
        has_availability_data=True,
        availability_slots=[_slot(SETUP, start="08:00", end="12:00")],
    )
    assert employee_eligible(emp, _shift(SETUP), _enforced()) is False


def test_optout_an_unscoped_narrowing_still_binds_every_job():
    emp = make_employee(
        employment_type="PT",
        availability_mode="OPT_OUT",
        has_availability_data=True,
        availability_slots=[_slot(None, start="08:00", end="12:00")],
    )
    assert employee_eligible(emp, _shift(SECURITY), _enforced()) is False
    assert employee_eligible(emp, _shift(SETUP), _enforced()) is False
