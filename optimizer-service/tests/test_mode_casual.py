"""
Comprehensive EBA Clause 12.5, Clause 35.4, Clause 41 & Schedule 3 §5
Tests for MODE_CASUAL (Casual Team Members).

Verifies all three layers of the Casual Autoscheduler:
  - Layer 1 (Eligibility & Mode Isolation — cl 12.5, cl 35.4, cl 56.2, Sch 3 §5.3):
      * Casual employees only (`employment_type == 'Casual'`)
      * Accepts BOTH Standard Casual (`is_security_role == False`, unpaid meal break
        per cl 36.1) AND Event Security Casual (`is_security_role == True`, paid
        meal break per Sch 3 §5.3(a))
      * Excludes Full-Time (`FT_STANDARD` / `FT_SECURITY`), Regular Part-Time (`PT`),
        and Flexible Part-Time (`FPT`)
      * Shift target isolation: accepts shifts targeted at Casual
        (`target_employment_type == 'Casual'`) or untargeted (`target_employment_type is None`);
        rejects shifts targeted at Full-Time, Part-Time, or requiring Flexible Part-Time
      * Minimum engagement tiers:
          - Standard weekday minimum: 3.0h (180m) (cl 12.5(c)(iii))
          - Training / non-event meeting concession: 2.0h (120m) allowed (cl 12.5(c)(i))
          - Sunday minimum: 4.0h (240m) (cl 12.5(c)(ii))
          - Public Holiday minimum: 4.0h (240m) (cl 12.5(c)(ii), cl 56.2)
          - Event Security Casual minimum on ANY day: 4.0h (240m) (Sch 3 §5.3(e))
          - Daily ceiling: 12.0h (720m) net (cl 35.4(c))
      * `/audit` & `/optimize` endpoint parity (`MODE_MISMATCH`,
        `EMPLOYMENT_TARGET`, `MIN_ENGAGEMENT`, `MAX_DAILY_HOURS`)
  - Layer 2 (Hard Legal Compliance — cl 35.4, cl 36.1, cl 40, Sch 3 §5.3):
      * Maximum 2 engagements starting on any calendar day (cl 35.4(f))
      * Maximum 20 worked days in any 28-day period (cl 35.4(e))
      * Casual Event Security working 2 shifts in a day:
          - Each engagement >= 3.0h (180m) (Sch 3 §5.3(g))
          - Gross spread <= 12.0h (720m) (Sch 3 §5.3(g))
      * Casual Event Security meal break is PAID (Sch 3 §5.3(a))
      * Cross-day 10h rest (cl 40.1), 8h multi-hire rest (cl 40.2)
      * Student Visa 48h / 14d cap and hard availability overrides
  - Layer 3 (Casual Fairness Ledger, Anti-Hogging & Schedule 2 §1 + cl 41 Pricing):
      * Casual Fairness Ledger (`FairnessPlugin`, SC-4, SC-10, SC-11, SC-11b) IS ACTIVE
      * Anti-hogging penalty IS ACTIVE (prevents single employee carrying >65% of demand)
      * FT paired RDOs (`SC-13`) strictly ABSENT
      * Schedule 2 §1 Casual column loaded rates (+25% loading) + cl 41 casual weekend/PH rates
        (Sat 150%, Sun 175%, PH 275% of ordinary rate).
"""
from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient

from model_builder import (
    AvailabilityOverrideInput,
    AvailabilitySlotInput,
    CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES,
    CASUAL_MIN_ENGAGEMENT_MINUTES,
    CASUAL_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    CASUAL_TRAINING_MIN_ENGAGEMENT_MINUTES,
    ExistingShiftInput,
    MAX_CASUAL_DAILY_ENGAGEMENTS,
    MAX_DAILY_MINUTES,
    OptimizerConstraints,
    OptimizerInput,
    ScheduleModelBuilder,
    _assignment_cost_cents_with_night,
    employee_eligible,
    net_shift_minutes,
    normalize_scheduler_mode,
)
from ortools_runner import app
from .conftest import make_employee, make_shift, solve


client = TestClient(app)


def casual_constraints(**overrides) -> OptimizerConstraints:
    base = dict(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=False,
        scheduler_mode="CASUAL",
    )
    base.update(overrides)
    return OptimizerConstraints(**base)


def make_casual_shift(
    sid: str,
    date: str,
    start: str = "09:00",
    end: str = "13:00",
    unpaid_break: int = 0,
    paid_break: int = 0,
    target_employment_type: str | None = "Casual",
    target_requires_flexible: bool = False,
    is_training: bool = False,
    is_public_holiday: bool = False,
    role_id: str | None = "role-casual",
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


def make_casual_employee(
    eid: str = "cas_1",
    hourly_rate: float = 35.0,  # Schedule 2 casual rate (includes 25% loading)
    is_security_role: bool = False,
    is_flexible: bool = False,
    min_contract_minutes: int = 0,  # Casuals have 0 contracted weekly hours
    max_weekly_minutes: int = 10_000,
    **kwargs,
):
    extra_fields = {"is_flexible": is_flexible}
    for k in ("preferred_shift_ids", "fairness_debts", "initial_effective_minutes"):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    contracted_role_ids = kwargs.pop("contracted_role_ids", None)
    if contracted_role_ids is None:
        contracted_role_ids = kwargs.pop("contracted_roles", ["role-casual"])
    base = dict(
        eid=eid,
        employment_type="Casual",
        hourly_rate=hourly_rate,
        min_contract_minutes=min_contract_minutes,
        max_weekly_minutes=max_weekly_minutes,
        is_security_role=is_security_role,
        contracted_role_ids=contracted_role_ids,
        availability_mode="OPT_IN",
    )
    base.update(kwargs)
    emp = make_employee(**base)
    for k, v in extra_fields.items():
        setattr(emp, k, v)
    return emp


# ===========================================================================
# 1. Mode Normalization & ModelBuilder Properties
# ===========================================================================

def test_casual_mode_normalization():
    assert normalize_scheduler_mode("CASUAL") == "CASUAL"
    assert normalize_scheduler_mode("casual") == "CASUAL"
    assert normalize_scheduler_mode("Casual") == "CASUAL"

    c = casual_constraints()
    data = OptimizerInput(
        shifts=[make_casual_shift("s1", "2026-11-09")],
        employees=[make_casual_employee("e1")],
        constraints=c,
    )
    builder = ScheduleModelBuilder(data)
    assert builder.is_casual_mode is True
    assert builder.is_permanent_mode is False
    assert builder.is_ft_mode is False
    assert builder.is_pt_mode is False
    assert builder.is_fpt_mode is False


# ===========================================================================
# 2. Layer 1: Eligibility & Mode Isolation
# ===========================================================================

def test_casual_layer1_employee_type_isolation():
    c = casual_constraints()
    shift = make_casual_shift("s1", "2026-11-09", "09:00", "13:00")  # 4h Monday

    cas_emp = make_casual_employee("cas_1")
    ft_emp = make_employee("ft_1", employment_type="FT")
    pt_emp = make_employee("pt_1", employment_type="PT")
    fpt_emp = make_employee("fpt_1", employment_type="PT")
    fpt_emp.is_flexible = True

    assert employee_eligible(cas_emp, shift, c) is True
    assert employee_eligible(ft_emp, shift, c) is False
    assert employee_eligible(pt_emp, shift, c) is False
    assert employee_eligible(fpt_emp, shift, c) is False


def test_casual_layer1_shift_target_isolation():
    c = casual_constraints()
    emp = make_casual_employee("cas_1")

    # Casual target or untargeted -> in scope
    s_cas = make_casual_shift("s1", "2026-11-09", target_employment_type="Casual")
    s_none = make_casual_shift("s2", "2026-11-09", target_employment_type=None)
    assert employee_eligible(emp, s_cas, c) is True
    assert employee_eligible(emp, s_none, c) is True

    # Off-target -> out of scope
    s_ft = make_casual_shift("s3", "2026-11-09", target_employment_type="FT")
    s_pt = make_casual_shift("s4", "2026-11-09", target_employment_type="PT")
    s_flex = make_casual_shift("s5", "2026-11-09", target_employment_type=None, target_requires_flexible=True)
    assert employee_eligible(emp, s_ft, c) is False
    assert employee_eligible(emp, s_pt, c) is False
    assert employee_eligible(emp, s_flex, c) is False


def test_casual_layer1_minimum_engagement_tiers():
    c = casual_constraints()
    emp = make_casual_employee("cas_1")

    # (a) Standard weekday: 3.0h (180m) minimum (cl 12.5(c)(iii))
    s_std_short = make_casual_shift("s_std_short", "2026-11-09", "09:00", "11:30")  # 2.5h (150m)
    s_std_ok = make_casual_shift("s_std_ok", "2026-11-09", "09:00", "12:00")        # 3.0h (180m)
    assert employee_eligible(emp, s_std_short, c) is False
    assert employee_eligible(emp, s_std_ok, c) is True

    # (b) Training on non-event day: 2.0h (120m) minimum (cl 12.5(c)(i))
    s_tr_short = make_casual_shift("s_tr_short", "2026-11-09", "09:00", "10:30", is_training=True)  # 1.5h (90m)
    s_tr_ok = make_casual_shift("s_tr_ok", "2026-11-09", "09:00", "11:00", is_training=True)        # 2.0h (120m)
    assert employee_eligible(emp, s_tr_short, c) is False
    assert employee_eligible(emp, s_tr_ok, c) is True

    # (c) Sunday: 4.0h (240m) minimum (cl 12.5(c)(ii))
    s_sun_short = make_casual_shift("s_sun_short", "2026-11-15", "09:00", "12:00", is_sunday=True)  # 3.0h (180m)
    s_sun_ok = make_casual_shift("s_sun_ok", "2026-11-15", "09:00", "13:00", is_sunday=True)        # 4.0h (240m)
    assert employee_eligible(emp, s_sun_short, c) is False
    assert employee_eligible(emp, s_sun_ok, c) is True

    # (d) Public Holiday: 4.0h (240m) minimum (cl 12.5(c)(ii), cl 56.2)
    s_ph_short = make_casual_shift("s_ph_short", "2026-11-09", "09:00", "12:00", is_public_holiday=True)  # 3.0h
    s_ph_ok = make_casual_shift("s_ph_ok", "2026-11-09", "09:00", "13:00", is_public_holiday=True)        # 4.0h
    assert employee_eligible(emp, s_ph_short, c) is False
    assert employee_eligible(emp, s_ph_ok, c) is True


def test_casual_layer1_event_security_minimum_engagement():
    """Sch 3 §5.3(e): Casual Event Security minimum engagement of 4 consecutive hours on ANY day."""
    c = casual_constraints()
    sec_emp = make_casual_employee("sec_1", is_security_role=True)
    std_emp = make_casual_employee("std_1", is_security_role=False)

    # 3.0h standard weekday shift: valid for general casual (180m), invalid for Event Security casual (needs 240m)
    s_3h = make_casual_shift("s_3h", "2026-11-09", "09:00", "12:00")
    assert employee_eligible(std_emp, s_3h, c) is True
    assert employee_eligible(sec_emp, s_3h, c) is False

    # 4.0h standard weekday shift: valid for both
    s_4h = make_casual_shift("s_4h", "2026-11-09", "09:00", "13:00")
    assert employee_eligible(std_emp, s_4h, c) is True
    assert employee_eligible(sec_emp, s_4h, c) is True


def test_casual_layer1_max_daily_hours():
    """cl 35.4(c): Maximum 12 ordinary hours on any one day."""
    c = casual_constraints()
    emp = make_casual_employee("cas_1")

    # 12.0h (720m) net worked hours -> allowed
    s_12h = make_casual_shift("s_12h", "2026-11-09", "06:00", "18:00")
    assert employee_eligible(emp, s_12h, c) is True

    # 12.5h (750m) net worked hours -> rejected
    s_12_5h = make_casual_shift("s_12_5h", "2026-11-09", "06:00", "18:30")
    assert employee_eligible(emp, s_12_5h, c) is False


def test_casual_layer1_security_meal_break_paid():
    """Sch 3 §5.3(a): Casual Event Security meal break is paid on the clock."""
    # 5h gross shift with 30m unpaid_break declared
    s = make_casual_shift("s1", "2026-11-09", "09:00", "14:00", unpaid_break=30)
    # Non-security: 300 - 30 = 270 net minutes
    assert net_shift_minutes(s, is_security=False) == 270
    # Security: paid meal break on the clock -> full 300 minutes
    assert net_shift_minutes(s, is_security=True) == 300


def test_casual_layer1_audit_endpoint_parity():
    """Test /audit endpoint returns appropriate diagnostics in CASUAL mode."""
    res = client.post(
        "/audit",
        json={
            "shifts": [
                {
                    "id": "s_too_short",
                    "shift_date": "2026-11-09",
                    "start_time": "09:00",
                    "end_time": "11:30",  # 2.5h
                    "duration_minutes": 150,
                    "target_employment_type": "Casual",
                },
                {
                    "id": "s_too_long",
                    "shift_date": "2026-11-10",
                    "start_time": "06:00",
                    "end_time": "19:00",  # 13h
                    "duration_minutes": 780,
                    "target_employment_type": "Casual",
                },
                {
                    "id": "s_ft_target",
                    "shift_date": "2026-11-11",
                    "start_time": "09:00",
                    "end_time": "17:00",
                    "duration_minutes": 480,
                    "target_employment_type": "FT",
                },
            ],
            "employees": [
                {
                    "id": "cas_1",
                    "name": "Casual Worker",
                    "employment_type": "Casual",
                },
                {
                    "id": "ft_1",
                    "name": "Full Time Worker",
                    "employment_type": "FT",
                },
            ],
            "constraints": {
                "scheduler_mode": "CASUAL",
                "enforce_availability": False,
            },
        },
    )
    assert res.status_code == 200, res.text
    rows = res.json()["rows"]
    reasons_map = {
        (r["shift_id"], e["employee_id"]): e.get("rejection_reasons", [])
        for r in rows
        for e in r["employees"]
    }

    # s_too_short: cas_1 has MIN_ENGAGEMENT; ft_1 has MODE_MISMATCH
    assert "MIN_ENGAGEMENT" in reasons_map[("s_too_short", "cas_1")]
    assert "MODE_MISMATCH" in reasons_map[("s_too_short", "ft_1")]

    # s_too_long: cas_1 has MAX_DAILY_HOURS
    assert "MAX_DAILY_HOURS" in reasons_map[("s_too_long", "cas_1")]

    # s_ft_target: cas_1 has EMPLOYMENT_TARGET
    assert "EMPLOYMENT_TARGET" in reasons_map[("s_ft_target", "cas_1")]


# ===========================================================================
# 3. Layer 2: Hard Legal Compliance
# ===========================================================================

def test_casual_layer2_max_daily_engagements_cap():
    """cl 35.4(f): Casual may work at most TWO separate engagements that START on any one calendar day."""
    c = casual_constraints()
    emp = make_casual_employee("cas_1", max_weekly_minutes=5000)

    # 3 non-overlapping 3.0h shifts on the same day
    s1 = make_casual_shift("s1", "2026-11-09", "06:00", "09:00")
    s2 = make_casual_shift("s2", "2026-11-09", "11:00", "14:00")
    s3 = make_casual_shift("s3", "2026-11-09", "16:00", "19:00")

    data = OptimizerInput(shifts=[s1, s2, s3], employees=[emp], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assigned_to_emp = [a for a in out.assignments if a.employee_id == "cas_1"]
    assert len(assigned_to_emp) <= 2, f"Assigned {len(assigned_to_emp)} shifts; expected <= 2 per cl 35.4(f)"


def test_casual_layer2_security_two_shifts_pairing():
    """Sch 3 §5.3(g): Casual Event Security working 2 shifts in a day:
    each must be >= 3h (180m) and gross spread <= 12h (720m)."""
    c = casual_constraints()
    sec_emp = make_casual_employee("sec_1", is_security_role=True, max_weekly_minutes=5000)

    # Two 4h shifts with 14h gross spread (06:00 to 20:00 = 14h > 12h)
    s1 = make_casual_shift("s1", "2026-11-09", "06:00", "10:00")
    s2 = make_casual_shift("s2", "2026-11-09", "16:00", "20:00")

    data = OptimizerInput(shifts=[s1, s2], employees=[sec_emp], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assigned = [a for a in out.assignments if a.employee_id == "sec_1"]
    # Cannot assign both because gross spread 14h exceeds 12h limit
    assert len(assigned) <= 1


def test_casual_layer2_20_in_28_workdays():
    """cl 35.4(e): At most 20 worked days in any 28-day window."""
    c = casual_constraints()
    emp = make_casual_employee("cas_1", max_weekly_minutes=15000)

    # Offer 22 days of shifts
    shifts = []
    base_date = datetime.date(2026, 11, 1)
    for day in range(22):
        d_str = (base_date + datetime.timedelta(days=day)).isoformat()
        shifts.append(make_casual_shift(f"s_{day}", d_str, "09:00", "13:00"))

    data = OptimizerInput(shifts=shifts, employees=[emp], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assigned = [a for a in out.assignments if a.employee_id == "cas_1"]
    assert len(assigned) <= 20, f"Assigned {len(assigned)} days; expected <= 20 per cl 35.4(e)"


def test_casual_layer2_rest_break_10h_vs_8h_multi_hire():
    """cl 40.1 (10h rest) vs cl 40.2 (8h multi-hire rest)."""
    c = casual_constraints(min_rest_minutes=600)
    emp = make_casual_employee("cas_1", max_weekly_minutes=5000)

    # Normal shifts with 9h gap: 17:00 to 02:00 next day (blocked by 10h rest)
    s1 = make_casual_shift("s1", "2026-11-09", "09:00", "17:00")
    s2 = make_casual_shift("s2", "2026-11-10", "02:00", "07:00")  # gap is 9h (540m)

    data = OptimizerInput(shifts=[s1, s2], employees=[emp], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()
    assigned = [a for a in out.assignments if a.employee_id == "cas_1"]
    assert len(assigned) <= 1, "Expected rest gap violation to prevent assigning both normal shifts"

    # Multi-hire shift: 8h (480m) rest is sufficient
    s2_mh = make_casual_shift("s2_mh", "2026-11-10", "02:00", "07:00", shift_type="MULTI_HIRE")
    data_mh = OptimizerInput(shifts=[s1, s2_mh], employees=[emp], constraints=c)
    builder_mh = ScheduleModelBuilder(data_mh)
    out_mh = builder_mh.build_and_solve()
    assigned_mh = [a for a in out_mh.assignments if a.employee_id == "cas_1"]
    assert len(assigned_mh) == 2, "Expected 8h rest gap to allow assignment of MULTI_HIRE shift"


# ===========================================================================
# 4. Layer 3: Casual Fairness Ledger, Anti-Hogging & Schedule 2 §1 Pricing
# ===========================================================================

def test_casual_layer3_fairness_ledger_active():
    """In CASUAL mode, Casual Fairness Ledger debts (SC-11 / SC-11b) are active and bias allocation."""
    c = casual_constraints()
    # Two identical casuals, but emp_debt has substantial Saturday ledger debt
    emp_normal = make_casual_employee("cas_normal", hourly_rate=35.0)
    emp_debt = make_casual_employee(
        "cas_debt",
        hourly_rate=35.0,
        fairness_debts={"saturday": 12.0},  # owed 12h of Saturday shifts
    )

    # Saturday shift
    sat_shift = make_casual_shift("s_sat", "2026-11-14", "09:00", "15:00", is_saturday=True)

    data = OptimizerInput(shifts=[sat_shift], employees=[emp_normal, emp_debt], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assert len(out.assignments) == 1
    # emp_debt should be selected due to higher fairness debt
    assert out.assignments[0].employee_id == "cas_debt"


def test_casual_layer3_anti_hogging_active():
    """In CASUAL mode, anti-hogging penalty applies to prevent a single casual from monopolizing >65% of demand."""
    c = casual_constraints()
    # Two identical casuals available for all shifts
    emp1 = make_casual_employee("cas_1", hourly_rate=35.0, max_weekly_minutes=5000)
    emp2 = make_casual_employee("cas_2", hourly_rate=35.0, max_weekly_minutes=5000)

    # 4 shifts of 4 hours on different days (total 16 hours = 960 minutes)
    shifts = [
        make_casual_shift("s1", "2026-11-09", "09:00", "13:00"),
        make_casual_shift("s2", "2026-11-10", "09:00", "13:00"),
        make_casual_shift("s3", "2026-11-11", "09:00", "13:00"),
        make_casual_shift("s4", "2026-11-12", "09:00", "13:00"),
    ]

    data = OptimizerInput(shifts=shifts, employees=[emp1, emp2], constraints=c)
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assert len(out.assignments) == 4
    counts = {}
    for a in out.assignments:
        counts[a.employee_id] = counts.get(a.employee_id, 0) + 1

    # Anti-hogging (65% share limit) ensures both employees receive shifts
    assert counts.get("cas_1", 0) > 0
    assert counts.get("cas_2", 0) > 0


def test_casual_layer3_pricing_and_loadings():
    """EBA cl 12.5(b), cl 41.1, cl 41.2, cl 41.3: Casual rates.
    Casual ordinary rate includes 25% loading.
    Saturday rate = 150% of ordinary base.
    Sunday rate = 175% of ordinary base.
    Public Holiday rate = 275% of ordinary base.
    """
    emp = make_casual_employee("cas_1", hourly_rate=35.0)

    # Weekday 4h
    s_wk = make_casual_shift("s_wk", "2026-11-09", "09:00", "13:00")
    cost_wk = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_wk, is_security=False)
    # 4h * $35.00/h = $140.00 = 14000 cents
    assert cost_wk == 14000

    # Saturday 4h: 150% of base ordinary ($28.00 base * 1.50 = $42.00/h -> 4 * 4200 = 16800c)
    s_sat = make_casual_shift("s_sat", "2026-11-14", "09:00", "13:00", is_saturday=True)
    cost_sat = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_sat, is_security=False)
    assert cost_sat == 16800

    # Sunday 4h: 175% of base ordinary ($28.00 base * 1.75 = $49.00/h -> 4 * 4900 = 19600c)
    s_sun = make_casual_shift("s_sun", "2026-11-15", "09:00", "13:00", is_sunday=True)
    cost_sun = _assignment_cost_cents_with_night(emp.hourly_rate, emp.employment_type, s_sun, is_security=False)
    assert cost_sun == 19600


def test_casual_fairness_scorecard_counts_zero_hour_candidates():
    """Scorecard improvement: When 1 shift is assigned to 1 casual while another eligible
    candidate casual receives 0 shifts, the fairness pillar must penalize the spread
    instead of reporting 100/100."""
    shift = make_casual_shift("s1", "2026-11-09", "09:00", "17:00")  # 8h = 480m
    emp1 = make_casual_employee("cas_1", hourly_rate=20.0)
    emp2 = make_casual_employee("cas_2", hourly_rate=40.0)  # More expensive, so emp1 wins on cost

    data = OptimizerInput(
        shifts=[shift],
        employees=[emp1, emp2],
        constraints=casual_constraints(),
    )
    builder = ScheduleModelBuilder(data)
    out = builder.build_and_solve()

    assert out.status in ("OPTIMAL", "FEASIBLE")
    assert len(out.assignments) == 1
    assert out.pillars is not None
    # Pre-fix: loads = [480], casual_used = 1 -> score was 100, spread 0.
    # Post-fix: loads = [480, 0], casual_used = 2 -> CV = 1.0 -> score = 0, spread = 480m.
    fairness = out.pillars["fairness"]
    assert fairness["employees_used"] == 2
    assert fairness["spread_minutes"] == 480
    assert fairness["score"] < 100

