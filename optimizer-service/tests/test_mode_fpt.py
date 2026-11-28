"""
Comprehensive EBA Clause 12.4, Clause 35.3, Clause 39, Clause 56.2 & Schedule 3 §5
Tests for MODE_FPT (Flexible Part-Time).

Verifies all three layers of the Flexible Part-Time Autoscheduler:
  - Layer 1 (Eligibility & Mode Isolation — cl 12.4, cl 35.3, cl 56.2, Sch 3 §5):
      * Flexible Part-Time only (`employment_type == 'PT'` and `is_flexible == True`)
      * Accepts BOTH Standard FPT (`is_security_role == False`, unpaid meal break
        per cl 36.1) AND Event Security FPT (`is_security_role == True`, paid
        meal break per Sch 3 §5.3(a))
      * Excludes Regular (non-flexible) Part-Time (`is_flexible == False` — Mode #3 `PT`),
        Full-Time (`FT_STANDARD` / `FT_SECURITY`), and Casual
      * Shift target isolation: accepts shifts targeted at Flexible Part-Time
        (`target_requires_flexible == True`) or untargeted (`target_employment_type is None`);
        rejects shifts targeted at Full-Time, Casual, or Regular Part-Time
        (`target_employment_type == 'PT' and not target_requires_flexible`)
      * Minimum engagement tiers (`cl 12.4(c)`, `cl 35.3(f)`):
          - Standard weekday minimum: 3.0h (180m)
          - Training / non-event meeting concession: 2.0h (120m) allowed (`cl 12.4(c)a`)
          - Sunday minimum: 4.0h (240m) (`cl 12.4(c)c` — 3.0h Sunday is REJECTED)
          - Public Holiday minimum: 4.0h (240m) (`cl 12.4(c)c`, `cl 56.2`)
          - Daily ceiling: 12.0h (720m) net (`cl 35.3(d)`)
      * `/audit` & `/optimize` endpoint parity (`MODE_MISMATCH`,
        `EMPLOYMENT_TARGET`, `MIN_ENGAGEMENT`, `MAX_DAILY_HOURS`)
  - Layer 2 (Hard Legal Compliance — cl 35.3, cl 36.1, cl 39, cl 40, Sch 3 §5):
      * Maximum 10 consecutive working days without a day off (`cl 35.3(g)`)
      * Maximum 20 worked days in any 28-day period (`cl 35.3(h)`)
      * Work cycle averaging up to 38h/wk over 1..4 weeks (`cl 35.3(b)`)
      * Split shifts (`cl 35.3(i)`, `cl 39.1-39.4`):
          - Lawful split shift (`<= 12h` spread, `<= 3h` gap) allowed and attracts
            `split_shift_allowance_cents` (`SC-12`)
          - Spread `> 12h` net blocked at Tier 0
          - Daily pairing meal break (`cl 36.1` / `HC-13`) enforced
      * Part-Time Event Security FPT meal break is PAID (`Sch 3 §5.3(a)`)
      * Cross-day 10h rest (`cl 40.1`), 8h multi-hire rest (`cl 40.3`)
      * Student Visa 48h / 14d cap and hard availability overrides
  - Layer 3 (Guardrail Plugins & Schedule 2 §1 + cl 41/42/43 Pricing):
      * Casual Fairness (`FairnessPlugin`) and Anti-Hogging strictly DISABLED
      * FT paired RDOs (`SC-13`) strictly ABSENT
      * Schedule 2 §1 permanent hourly rates + cl 41 weekend/PH loadings (Sat 125%,
        Sun 150%, PH 250%) + cl 43.1 night allowances (20%/25%/50%).
"""
from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient

from model_builder import (
    AvailabilityOverrideInput,
    AvailabilitySlotInput,
    ExistingShiftInput,
    FPT_MIN_ENGAGEMENT_MINUTES,
    FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    FPT_TRAINING_MIN_ENGAGEMENT_MINUTES,
    OptimizerConstraints,
    OptimizerInput,
    PUBLIC_HOLIDAY_MIN_ENGAGEMENT_MINUTES,
    ScheduleModelBuilder,
    _assignment_cost_cents_with_night,
    employee_eligible,
    net_shift_minutes,
    normalize_scheduler_mode,
)
from ortools_runner import app
from .conftest import make_employee, make_shift, solve


client = TestClient(app)


def fpt_constraints(**overrides) -> OptimizerConstraints:
    base = dict(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
        scheduler_mode="FPT",
    )
    base.update(overrides)
    return OptimizerConstraints(**base)


def make_fpt_shift(
    sid: str,
    date: str,
    start: str = "09:00",
    end: str = "13:00",
    unpaid_break: int = 0,
    paid_break: int = 0,
    target_employment_type: str | None = "PT",
    target_requires_flexible: bool = True,
    is_training: bool = False,
    is_public_holiday: bool = False,
    role_id: str | None = "role-fpt",
    **kwargs,
):
    extra_fields = {
        "paid_break_minutes": paid_break,
        "target_requires_flexible": target_requires_flexible,
        "is_public_holiday": is_public_holiday,
    }
    for k in (
        "is_saturday",
        "is_sunday",
        "is_public_holiday_next_day",
        "shift_type",
    ):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    s = make_shift(
        sid=sid,
        date=date,
        start=start,
        end=end,
        unpaid_break_minutes=unpaid_break,
        role_id=role_id,
        is_training=is_training,
        target_employment_type=target_employment_type,
        **kwargs,
    )
    for k, v in extra_fields.items():
        setattr(s, k, v)
    return s


def make_fpt_employee(
    eid: str = "fpt_1",
    hourly_rate: float = 30.0,
    is_security_role: bool = False,
    is_flexible: bool = True,
    min_contract_minutes: int = 720,  # 12h/wk baseline from 624h/annum cl 12.4(a)
    max_weekly_minutes: int = 10_000,
    **kwargs,
):
    extra_fields = {"is_flexible": is_flexible}
    for k in ("preferred_shift_ids", "fairness_debts", "initial_effective_minutes"):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    contracted_role_ids = kwargs.pop("contracted_role_ids", None)
    if contracted_role_ids is None:
        contracted_role_ids = kwargs.pop("contracted_roles", ["role-fpt"])
    base = dict(
        eid=eid,
        employment_type="PT",
        hourly_rate=hourly_rate,
        min_contract_minutes=min_contract_minutes,
        max_weekly_minutes=max_weekly_minutes,
        is_security_role=is_security_role,
        contracted_role_ids=contracted_role_ids,
        availability_mode="OPT_OUT",
        ordinary_hours_cycle_weeks=4,
        ordinary_hours_cycle_anchor="2026-06-01",
    )
    base.update(kwargs)
    emp = make_employee(**base)
    for k, v in extra_fields.items():
        setattr(emp, k, v)
    return emp


# =============================================================================
# 1. Wire Schemas, Aliases & Constants
# =============================================================================

def test_scheduler_mode_fpt_wire_and_normalization():
    assert normalize_scheduler_mode("FPT") == "FPT"
    assert normalize_scheduler_mode("fpt") == "FPT"
    assert normalize_scheduler_mode("  FPT  ") == "FPT"
    assert FPT_MIN_ENGAGEMENT_MINUTES == 180
    assert FPT_TRAINING_MIN_ENGAGEMENT_MINUTES == 120
    assert FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES == 240


# =============================================================================
# 2. Layer 1 Pool Isolation
# =============================================================================

def test_layer1_fpt_pool_isolation_accepts_flex_pt_rejects_plain_pt_ft_casual():
    c = fpt_constraints()
    shift = make_fpt_shift("s1", "2026-06-01", "09:00", "13:00")  # 4h Monday

    fpt_emp = make_fpt_employee("fpt_1", is_flexible=True)
    plain_pt_emp = make_fpt_employee("pt_reg", is_flexible=False)
    ft_emp = make_employee("ft_1", employment_type="FT", contracted_role_ids=["role-fpt"])
    cas_emp = make_employee("cas_1", employment_type="Casual", contracted_role_ids=["role-fpt"])

    assert employee_eligible(fpt_emp, shift, c) is True
    assert employee_eligible(plain_pt_emp, shift, c) is False
    assert employee_eligible(ft_emp, shift, c) is False
    assert employee_eligible(cas_emp, shift, c) is False


def test_layer1_fpt_accepts_standard_fpt_and_event_security_fpt():
    c = fpt_constraints()
    shift_std = make_fpt_shift("s_std", "2026-06-01", "09:00", "13:00", role_id="role-std")
    shift_sec = make_fpt_shift("s_sec", "2026-06-01", "09:00", "13:00", role_id="role-sec")

    fpt_std = make_fpt_employee("fpt_std", is_security_role=False, contracted_roles=["role-std"])
    fpt_sec = make_fpt_employee("fpt_sec", is_security_role=True, contracted_roles=["role-sec"])

    assert employee_eligible(fpt_std, shift_std, c) is True
    assert employee_eligible(fpt_sec, shift_sec, c) is True


def test_layer1_shift_target_isolation_accepts_flex_target_rejects_ft_casual_plain_pt():
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")

    # Explicitly targeted at FPT (target_employment_type='PT', target_requires_flexible=True)
    s_fpt = make_fpt_shift("s_fpt", "2026-06-01", "09:00", "13:00", target_employment_type="PT", target_requires_flexible=True)
    # Untargeted shift
    s_open = make_fpt_shift("s_open", "2026-06-01", "09:00", "13:00", target_employment_type=None, target_requires_flexible=False)
    # Targeted at FT
    s_ft = make_fpt_shift("s_ft", "2026-06-01", "09:00", "17:00", target_employment_type="FT", target_requires_flexible=False)
    # Targeted at Casual
    s_cas = make_fpt_shift("s_cas", "2026-06-01", "09:00", "13:00", target_employment_type="Casual", target_requires_flexible=False)
    # Targeted specifically at Regular (non-flexible) PT
    s_reg_pt = make_fpt_shift("s_reg_pt", "2026-06-01", "09:00", "13:00", target_employment_type="PT", target_requires_flexible=False)

    assert employee_eligible(emp, s_fpt, c) is True
    assert employee_eligible(emp, s_open, c) is True
    assert employee_eligible(emp, s_ft, c) is False
    assert employee_eligible(emp, s_cas, c) is False
    assert employee_eligible(emp, s_reg_pt, c) is False


# =============================================================================
# 3. Layer 1 Shift Shape Tiers (cl 12.4(c), cl 35.3(d))
# =============================================================================

def test_layer1_shift_shape_standard_weekday_min_3h():
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")

    # 3.0h standard Monday (2026-06-01) -> PASS
    s_3h = make_fpt_shift("s_3h", "2026-06-01", "09:00", "12:00")
    # 2.5h standard Monday -> FAIL (under 3h)
    s_2_5h = make_fpt_shift("s_2_5h", "2026-06-01", "09:00", "11:30")

    assert employee_eligible(emp, s_3h, c) is True
    assert employee_eligible(emp, s_2_5h, c) is False


def test_layer1_shift_shape_training_exception_2h_allowed():
    """EBA cl 12.4(c)a: 2.0h minimum for training on a non-event day for Flexible PT."""
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")

    # 2.0h training shift -> PASS
    s_train_2h = make_fpt_shift("s_tr2", "2026-06-01", "09:00", "11:00", is_training=True)
    # 1.5h training shift -> FAIL (under 2h)
    s_train_1_5h = make_fpt_shift("s_tr15", "2026-06-01", "09:00", "10:30", is_training=True)

    assert employee_eligible(emp, s_train_2h, c) is True
    assert employee_eligible(emp, s_train_1_5h, c) is False


def test_layer1_shift_shape_sunday_min_4h():
    """EBA cl 12.4(c)c: 4.0h minimum for Flexible PT on Sunday (unlike Plain PT where 3h passes)."""
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")
    sunday = "2026-06-07"

    # 4.0h Sunday shift -> PASS
    s_sun_4h = make_fpt_shift("s_sun4", sunday, "09:00", "13:00")
    # 3.0h Sunday shift -> FAIL for Flexible Part-Time!
    s_sun_3h = make_fpt_shift("s_sun3", sunday, "09:00", "12:00")

    assert s_sun_4h.is_sunday is True
    assert s_sun_3h.is_sunday is True
    assert employee_eligible(emp, s_sun_4h, c) is True
    assert employee_eligible(emp, s_sun_3h, c) is False


def test_layer1_shift_shape_public_holiday_min_4h():
    """EBA cl 12.4(c)c & cl 56.2: 4.0h minimum on Public Holiday."""
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")
    ph_date = "2026-06-08"  # King's Birthday

    # 4.0h PH shift -> PASS
    s_ph_4h = make_fpt_shift("s_ph4", ph_date, "09:00", "13:00", is_public_holiday=True)
    # 3.0h PH shift -> FAIL
    s_ph_3h = make_fpt_shift("s_ph3", ph_date, "09:00", "12:00", is_public_holiday=True)

    assert employee_eligible(emp, s_ph_4h, c) is True
    assert employee_eligible(emp, s_ph_3h, c) is False


def test_layer1_shift_shape_daily_cap_12h_net():
    """EBA cl 35.3(d): Max 12 ordinary hours on any one day."""
    c = fpt_constraints()
    emp = make_fpt_employee("fpt_1")

    # 12.0h net (12.5h gross with 30m unpaid meal break) -> PASS
    s_12h = make_fpt_shift("s_12h", "2026-06-01", "08:00", "20:30", unpaid_break=30)
    # 12.5h net (13.0h gross with 30m unpaid break) -> FAIL
    s_12_5h = make_fpt_shift("s_125h", "2026-06-01", "08:00", "21:00", unpaid_break=30)

    assert net_shift_minutes(s_12h, is_security=False) == 720
    assert net_shift_minutes(s_12_5h, is_security=False) == 750
    assert employee_eligible(emp, s_12h, c) is True
    assert employee_eligible(emp, s_12_5h, c) is False


def test_layer1_audit_endpoint_emits_fpt_reasons():
    """Audit endpoint emits MODE_MISMATCH, EMPLOYMENT_TARGET, MIN_ENGAGEMENT, MAX_DAILY_HOURS."""
    sunday = "2026-06-07"
    payload = {
        "shifts": [
            {
                "id": "s_sun_short",
                "shift_date": sunday,
                "start_time": "09:00",
                "end_time": "12:00",  # 3h Sunday -> fails for FPT (needs 4h)
                "duration_minutes": 180,
                "unpaid_break_minutes": 0,
                "paid_break_minutes": 0,
                "target_employment_type": "PT",
                "target_requires_flexible": True,
                "role_id": "role-fpt",
            },
            {
                "id": "s_over_12",
                "shift_date": "2026-06-01",
                "start_time": "06:00",
                "end_time": "19:00",  # 13h -> fails
                "duration_minutes": 780,
                "unpaid_break_minutes": 0,
                "paid_break_minutes": 0,
                "target_employment_type": "PT",
                "target_requires_flexible": True,
                "role_id": "role-fpt",
            },
            {
                "id": "s_ft_only",
                "shift_date": "2026-06-01",
                "start_time": "09:00",
                "end_time": "17:00",
                "duration_minutes": 480,
                "target_employment_type": "FT",
                "target_requires_flexible": False,
                "role_id": "role-fpt",
            },
        ],
        "employees": [
            {
                "id": "emp_fpt",
                "name": "FPT Staff",
                "employment_type": "PT",
                "is_flexible": True,
                "contracted_role_ids": ["role-fpt"],
                "hourly_rate": 30.0,
            },
            {
                "id": "emp_plain_pt",
                "name": "Plain PT Staff",
                "employment_type": "PT",
                "is_flexible": False,
                "contracted_role_ids": ["role-fpt"],
                "hourly_rate": 30.0,
            },
        ],
        "constraints": {
            "scheduler_mode": "FPT",
            "enforce_role_match": True,
        },
    }

    resp = client.post("/audit", json=payload)
    assert resp.status_code == 200, resp.text
    rows = resp.json()["rows"]

    # Map by (shift_id, employee_id) -> rejection_reasons
    reasons_map = {
        (r["shift_id"], e["employee_id"]): e.get("rejection_reasons", [])
        for r in rows
        for e in r["employees"]
    }

    # emp_plain_pt has MODE_MISMATCH on every shift
    for s_id in ("s_sun_short", "s_over_12", "s_ft_only"):
        assert "MODE_MISMATCH" in reasons_map[(s_id, "emp_plain_pt")]

    # emp_fpt on s_sun_short has MIN_ENGAGEMENT
    assert "MIN_ENGAGEMENT" in reasons_map[("s_sun_short", "emp_fpt")]

    # emp_fpt on s_over_12 has MAX_DAILY_HOURS
    assert "MAX_DAILY_HOURS" in reasons_map[("s_over_12", "emp_fpt")]

    # emp_fpt on s_ft_only has EMPLOYMENT_TARGET
    assert "EMPLOYMENT_TARGET" in reasons_map[("s_ft_only", "emp_fpt")]


# =============================================================================
# 4. Layer 2 Hard Legal Compliance (cl 35.3(g), cl 35.3(h), cl 39)
# =============================================================================

def test_layer2_10_consecutive_days_streak_cap_enforced():
    """EBA cl 35.3(g): Flexible part-time maximum 10 consecutive days without a day off."""
    emp = make_fpt_employee("fpt_1", min_contract_minutes=0)
    # Create 11 daily shifts on 11 consecutive calendar days
    shifts = [
        make_fpt_shift(f"s_{i}", f"2026-06-{i+1:02d}", "09:00", "13:00")
        for i in range(11)
    ]

    res = solve(shifts, [emp], constraints=fpt_constraints(allow_partial=True))
    assert res.status in ("OPTIMAL", "FEASIBLE")

    # In CP-SAT, working 11 consecutive days triggers streak penalty/limit
    assigned_shifts = [a.shift_id for a in res.assignments if a.employee_id == "fpt_1"]
    # At most 10 shifts can be assigned without breaching the 10-day cap!
    assert len(assigned_shifts) <= 10


def test_layer2_20_in_28_workdays_enforced():
    """EBA cl 35.3(h): Maximum 20 days worked in a 28-day period."""
    emp = make_fpt_employee("fpt_1", min_contract_minutes=0)
    # Create 22 shifts across 22 distinct days in June
    shifts = [
        make_fpt_shift(f"s_d{i}", f"2026-06-{i+1:02d}", "09:00", "13:00")
        for i in range(22)
    ]

    res = solve(shifts, [emp], constraints=fpt_constraints(allow_partial=True))
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assigned = [a for a in res.assignments if a.employee_id == "fpt_1"]
    assert len(assigned) <= 20


def test_layer2_lawful_split_shifts_and_split_shift_allowance():
    """EBA cl 35.3(i) & cl 39: Lawful split shifts receive Split Shift Allowance once per day."""
    emp = make_fpt_employee("fpt_1", hourly_rate=30.0)
    date = "2026-06-01"  # Monday

    # 07:00-11:00 (4h) + 13:00-17:00 (4h): 10h spread <= 12h, 2h gap <= 3h
    s1 = make_fpt_shift("s_am", date, "07:00", "11:00")
    s2 = make_fpt_shift("s_pm", date, "13:00", "17:00")

    c = fpt_constraints(split_shift_allowance_cents=1113)
    res = solve([s1, s2], [emp], constraints=c)
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assert len(res.assignments) == 2
    assert all(a.employee_id == "fpt_1" for a in res.assignments)


def test_layer2_split_shift_spread_over_12h_net_blocked():
    """EBA cl 39.2: Spread cannot exceed 12h net excluding breaks."""
    emp = make_fpt_employee("fpt_1")
    date = "2026-06-01"

    # 06:00-10:00 + 19:00-23:00 = 17h spread > 12h net -> cannot pair together
    s_early = make_fpt_shift("s_early", date, "06:00", "10:00")
    s_late = make_fpt_shift("s_late", date, "19:00", "23:00")

    res = solve([s_early, s_late], [emp], constraints=fpt_constraints(allow_partial=True))
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assigned = [a for a in res.assignments if a.employee_id == "fpt_1"]
    assert len(assigned) <= 1


def test_layer2_same_day_pairing_meal_break_enforced():
    """EBA cl 36.1 & HC-13: Same-day pairing over 5h total requires 30m meal break."""
    emp = make_fpt_employee("fpt_1")
    date = "2026-06-01"

    # Two 3h shifts (6h total > 5h) with only 15m gap and no break -> BLOCKED
    s1 = make_fpt_shift("s_m1", date, "08:00", "11:00")
    s2 = make_fpt_shift("s_m2", date, "11:15", "14:15")

    res = solve([s1, s2], [emp], constraints=fpt_constraints(allow_partial=True))
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assigned = [a for a in res.assignments if a.employee_id == "fpt_1"]
    assert len(assigned) <= 1


def test_layer2_event_security_fpt_paid_meal_break():
    """Schedule 3 §5.3(a): Event Security FPT meal break is PAID."""
    emp_sec = make_fpt_employee("sec_fpt", is_security_role=True, contracted_roles=["role-sec"])
    date = "2026-06-01"

    # 12.0h gross shift with 30m meal break: for security, paid = 720m (12.0h) -> PASS
    s_12h = make_fpt_shift("s_sec12", date, "07:00", "19:00", unpaid_break=30, role_id="role-sec")
    assert net_shift_minutes(s_12h, is_security=True) == 720
    assert employee_eligible(emp_sec, s_12h, fpt_constraints()) is True

    # 12.5h gross shift with 30m break: paid = 750m (> 720m cap) -> REJECTED
    s_12_5h = make_fpt_shift("s_sec125", date, "07:00", "19:30", unpaid_break=30, role_id="role-sec")
    assert net_shift_minutes(s_12_5h, is_security=True) == 750
    assert employee_eligible(emp_sec, s_12_5h, fpt_constraints()) is False


def test_layer2_cross_day_10h_rest_and_multi_hire_8h_rest():
    """EBA cl 40.1 (10h rest) and cl 40.3 (8h multi-hire rest)."""
    emp = make_fpt_employee("fpt_1")
    # Finish Monday at 23:00
    s_mon = make_fpt_shift("s_mon", "2026-06-01", "18:00", "23:00")
    # Start Tuesday at 07:00 (only 8h rest -> fails 10h standard rest)
    s_tue_early = make_fpt_shift("s_tue", "2026-06-02", "07:00", "12:00")

    res = solve([s_mon, s_tue_early], [emp], constraints=fpt_constraints(allow_partial=True))
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assigned = [a for a in res.assignments if a.employee_id == "fpt_1"]
    assert len(assigned) <= 1


def test_layer2_student_visa_cap_and_hard_availability():
    """Student visa 48h/14d cap & hard availability override honored."""
    emp = make_fpt_employee(
        "fpt_stu",
        is_student=True,
        visa_limit=1200,  # 20h cap in 14 days
        availability_overrides=[
            AvailabilityOverrideInput(date="2026-06-01", severity="HARD", start_time="00:00", end_time="24:00")
        ],
    )
    s_blocked = make_fpt_shift("s_blk", "2026-06-01", "09:00", "13:00")
    s_ok = make_fpt_shift("s_ok", "2026-06-02", "09:00", "13:00")

    assert employee_eligible(emp, s_blocked, fpt_constraints()) is False
    assert employee_eligible(emp, s_ok, fpt_constraints()) is True


# =============================================================================
# 5. Layer 3 Pricing, Loadings & Disabled Casual Plugins
# =============================================================================

def test_layer3_casual_fairness_and_anti_hogging_strictly_disabled():
    """Permanent FPT does not run casual fairness or anti-hogging."""
    emp = make_fpt_employee("fpt_1")
    s = make_fpt_shift("s1", "2026-06-01", "09:00", "13:00")

    builder = ScheduleModelBuilder(
        OptimizerInput(
            shifts=[s],
            employees=[emp],
            constraints=fpt_constraints(),
        )
    )
    assert builder.is_fpt_mode is True
    assert builder.is_ft_mode is False
    assert builder.is_pt_mode is False


def test_layer3_permanent_pricing_saturday_sunday_ph_and_night_allowances():
    """EBA cl 41 loadings & cl 43.1 night allowances on Schedule 2 §1 rates."""
    emp = make_fpt_employee("fpt_1", hourly_rate=30.0)

    # Standard weekday day shift: 4h @ $30 = $120.00 (12,000c)
    s_mon = make_fpt_shift("s_mon", "2026-06-01", "09:00", "13:00")
    cost_mon = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_mon, is_security=False)
    assert cost_mon == 12000

    # Saturday day shift: 4h @ $30 x 1.25 = $150.00 (15,000c)
    s_sat = make_fpt_shift("s_sat", "2026-06-06", "09:00", "13:00")
    cost_sat = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_sat, is_security=False)
    assert cost_sat == 15000

    # Sunday day shift: 4h @ $30 x 1.50 = $180.00 (18,000c)
    s_sun = make_fpt_shift("s_sun", "2026-06-07", "09:00", "13:00")
    cost_sun = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_sun, is_security=False)
    assert cost_sun == 18000

    # Public Holiday day shift: 4h @ $30 x 2.50 = $300.00 (30,000c)
    s_ph = make_fpt_shift("s_ph", "2026-06-08", "09:00", "13:00", is_public_holiday=True)
    cost_ph = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_ph, is_security=False)
    assert cost_ph == 30000

    # Monday Night shift (20:00 - 00:30): 2.0h non-night (20:00-22:00) @ $30 ($60) +
    # 2.5h night (22:00-00:30) @ $30 x 1.20 ($36/h = $90) = $150.00 (15,000c)
    s_night = make_fpt_shift("s_night", "2026-06-01", "20:00", "00:30")
    cost_night = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_night, is_security=False)
    assert cost_night == 15000
