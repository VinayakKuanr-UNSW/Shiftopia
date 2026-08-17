"""
Regression tests for employment_type wire-form normalization.

The solver compares `employment_type` against the canonical set {'FT','PT',
'Casual'}, but the TS controller sends LONG forms ('Full-Time'/'Part-Time'/
'Casual'). Before normalization, 'Full-Time' != 'FT' silently prevented the
FT/PT ordinary-hours 28-day/152h cap (and target-mix matching) from ever
attaching. These tests lock the single normalization boundary.
"""
from model_builder import (
    normalize_employment_type,
    employee_eligible,
    EmployeeInput,
    OptimizerConstraints,
    ShiftInput,
)


def test_normalize_all_wire_forms():
    assert normalize_employment_type('Full-Time') == 'FT'
    assert normalize_employment_type('full time') == 'FT'
    assert normalize_employment_type('FULL_TIME') == 'FT'
    assert normalize_employment_type('FT') == 'FT'
    assert normalize_employment_type('Part-Time') == 'PT'
    assert normalize_employment_type('Flexible Part-Time') == 'PT'
    assert normalize_employment_type('part_time') == 'PT'
    assert normalize_employment_type('PT') == 'PT'
    assert normalize_employment_type('Casual') == 'Casual'
    assert normalize_employment_type('CASUAL') == 'Casual'


def test_normalize_unknown_and_empty_default_to_casual():
    assert normalize_employment_type(None) == 'Casual'
    assert normalize_employment_type('') == 'Casual'
    assert normalize_employment_type('   ') == 'Casual'
    assert normalize_employment_type('contractor') == 'Casual'


def test_employee_input_post_init_normalizes():
    assert EmployeeInput(id='e', name='n', employment_type='Full-Time').employment_type == 'FT'
    assert EmployeeInput(id='e', name='n', employment_type='Part-Time').employment_type == 'PT'
    assert EmployeeInput(id='e', name='n', employment_type='Flexible Part-Time').employment_type == 'PT'
    assert EmployeeInput(id='e', name='n', employment_type='Casual').employment_type == 'Casual'
    # Default (no employment_type) → 'Casual'
    assert EmployeeInput(id='e', name='n').employment_type == 'Casual'


def _shift(**over):
    base = dict(
        id='s1',
        shift_date='2026-06-01',
        start_time='08:00',
        end_time='16:00',
        duration_minutes=480,
    )
    base.update(over)
    return ShiftInput(**base)


def test_shift_input_normalizes_target_employment_type():
    assert _shift(target_employment_type='Full-Time').target_employment_type == 'FT'
    assert _shift(target_employment_type='Part-Time').target_employment_type == 'PT'
    # None stays None — no target means no employment-mix penalty.
    assert _shift().target_employment_type is None


def test_ft_and_target_now_match_after_normalization():
    """The exact drift that used to break SC-1: 'Full-Time' employee vs
    'Full-Time' target shift now compare equal in canonical form."""
    emp = EmployeeInput(id='e', name='n', employment_type='Full-Time')
    shift = _shift(target_employment_type='Full-Time')
    assert emp.employment_type == shift.target_employment_type == 'FT'


# ---------------------------------------------------------------------------
# target_requires_flexible — the second axis of the employment target.
#
# 'Flexible Part-Time' normalizes to 'PT', so the token alone CANNOT express
# "flexible part-timers only". These lock the tuple semantics that SC-1 relies
# on, and the reason a fourth 'Flexible PT' token was rejected in favour of a
# companion boolean.
# ---------------------------------------------------------------------------

def test_flexible_target_is_not_expressible_as_a_token():
    """Regression guard for the design decision. If someone later adds a
    'Flexible PT' alias mapping to its own token, this test fails and forces
    them to revisit SC-1 — which compares against the collapsed set."""
    assert normalize_employment_type('Flexible Part-Time') == 'PT'
    assert normalize_employment_type('flexible part time') == 'PT'
    # A flexible employee is indistinguishable from a plain part-timer by
    # employment_type alone; only `is_flexible` separates them.
    flexible = EmployeeInput(id='e', name='n', employment_type='Flexible Part-Time', is_flexible=True)
    plain = EmployeeInput(id='e2', name='n2', employment_type='Part-Time')
    assert flexible.employment_type == plain.employment_type == 'PT'
    assert flexible.is_flexible is True
    assert plain.is_flexible is False


def test_shift_input_keeps_flexible_requirement_for_pt_target():
    shift = _shift(target_employment_type='Part-Time', target_requires_flexible=True)
    assert shift.target_employment_type == 'PT'
    assert shift.target_requires_flexible is True

    # Long form normalizes the same way.
    shift = _shift(target_employment_type='Flexible Part-Time', target_requires_flexible=True)
    assert shift.target_employment_type == 'PT'
    assert shift.target_requires_flexible is True


def test_shift_input_clears_flexible_requirement_off_pt_target():
    """Mirrors shifts_target_flexible_requires_pt_check. An incoherent payload
    degrades to the plain target rather than penalizing every candidate."""
    for target in ('Full-Time', 'Casual'):
        shift = _shift(target_employment_type=target, target_requires_flexible=True)
        assert shift.target_requires_flexible is False

    # No target at all → nothing to qualify.
    assert _shift(target_requires_flexible=True).target_requires_flexible is False


def test_shift_input_defaults_flexible_requirement_false():
    assert _shift().target_requires_flexible is False
    assert _shift(target_employment_type='Part-Time').target_requires_flexible is False


# ---------------------------------------------------------------------------
# HC-5c — the employment target is a HARD eligibility criterion.
#
# It used to be soft (a 5000c SC-1 penalty), so the solver would place an
# off-target employee whenever coverage was worth more than $50. The column is
# now NOT NULL and enforced by V8_EMPLOYMENT_TARGET and by
# trg_shift_employment_target_2_enforce, so such a proposal would be rejected on
# write. Asserting on `employee_eligible` rather than the objective is
# deliberate: it is the single predicate feeding BOTH variable creation and
# compute_greedy_hint, so these also pin that the greedy fallback obeys the rule.
# ---------------------------------------------------------------------------

def _emp(**over):
    base = dict(id='e1', name='n', employment_type='Casual', contracted_role_ids=[])
    base.update(over)
    return EmployeeInput(**base)


_C = OptimizerConstraints(enforce_role_match=False, enforce_skill_match=False)


def test_off_target_employee_is_ineligible():
    casual = _emp(employment_type='Casual')
    assert employee_eligible(casual, _shift(target_employment_type='FT'), _C) is False
    assert employee_eligible(casual, _shift(target_employment_type='PT'), _C) is False


def test_on_target_employee_is_eligible():
    assert employee_eligible(
        _emp(employment_type='Full-Time'), _shift(target_employment_type='FT'), _C) is True
    assert employee_eligible(
        _emp(employment_type='Casual'), _shift(target_employment_type='Casual'), _C) is True


def test_flexible_requirement_separates_part_timers():
    plain = _emp(employment_type='Part-Time')
    flexi = _emp(employment_type='Flexible Part-Time', is_flexible=True)
    shift = _shift(target_employment_type='PT', target_requires_flexible=True)

    # Both normalize to 'PT'; only is_flexible tells them apart.
    assert plain.employment_type == flexi.employment_type == 'PT'
    assert employee_eligible(plain, shift, _C) is False
    assert employee_eligible(flexi, shift, _C) is True


def test_plain_pt_target_accepts_both_part_timers():
    shift = _shift(target_employment_type='PT')
    assert employee_eligible(_emp(employment_type='Part-Time'), shift, _C) is True
    assert employee_eligible(
        _emp(employment_type='Flexible Part-Time', is_flexible=True), shift, _C) is True
