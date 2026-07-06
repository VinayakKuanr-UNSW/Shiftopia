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
    EmployeeInput,
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
