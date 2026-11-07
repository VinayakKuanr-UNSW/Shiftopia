"""
Comprehensive EBA Schedule 3 & Schedule 2 §2 Tests for MODE_FT_SECURITY.

Verifies all three layers of the Full-Time Security Autoscheduler:
  - Layer 1 (Eligibility & Mode Isolation — Schedule 3 §1.1, §3.1, §3.2, §5):
      * Full-Time Security only (`employment_type == 'FT'`, `not is_flexible`,
        and `is_security_role == True`)
      * Excludes Standard FT (`is_security_role == False`), Part-Time Event
        Security (Sch 3 §5.2), Casual Event Security (Sch 3 §5.3), FPT, and
        general Casuals
      * Shift target isolation (`target_employment_type in (None, 'FT')` and
        `not target_requires_flexible`)
      * Paid meal break duration bounds (`Sch 3 §3.2(a)` + `cl 35.1(c)-(d)`):
        `456 <= paid_mins <= 720` where `paid_mins = duration_minutes` (no
        unpaid meal break subtraction — a 12.0h gross `06:00-18:00` shift is
        720 paid min and LAWFUL, whereas a 12.5h gross `06:00-18:30` shift is
        750 paid min and REJECTED even if `unpaid_break_minutes=30` was set)
      * `/audit` endpoint parity with `employee_eligible`
  - Layer 2 (Hard Legal Compliance — Schedule 3 §3.1(a)-(d) & General EBA):
      * Schedule 3 §3.1(a),(d) anchored 8-week (`56-day`) `336h` (`20,160`
        paid min = `42h/week` average: `38h` ordinary + `4h` reasonable
        additional) cycle cap:
          - `14 x 12h = 168h` (`10,080m`) in 4 weeks is LAWFUL in `FT_SECURITY`
            (contrasting with `FT_STANDARD`'s `152h` 4-week cap)
          - `29 x 12h = 348h` in an anchored 8-week cycle exceeds `336h` and
            leaves the 29th shift UNCOVERED rather than breaching Tier-0 legal
      * Strict 1 shift per calendar day (`cl 35.1(e)` / `cl 39.1` /
        `fn_shift_ft_one_per_day`) across candidate pairs & pinned `existing_shifts`
      * Schedule 3 §3.1(c) / `cl 40.1` 10h rest gap across rotating day (`06:00-18:00`)
        and night (`18:00-06:00`) 12h shifts, plus `8h` multi-hire rest (`cl 40.3`)
      * Rolling 20 working days in 28 (`cl 35.1(e)`), incl. overnight spill
      * Migration Act condition 8105 Student Visa `48h / 14d` cap in PAID minutes
  - Layer 3 (Guardrail Plugins & Schedule 3 §4.1(b) All-In Annualised Rate):
      * `FairnessPlugin` strictly DISABLED (zero `fairness`, `undesirable_balance`,
        or `longitudinal_fairness` terms; no 65% anti-hogging slack)
      * `SC-13` (`ft_days_off`, `cl 35.1(e)`) strictly DISABLED because Schedule 3
        §3.1(b) even-time roster prevails (`Sch 3 §1.1`)
      * `FatiguePlugin` (`SC-7`) ACTIVE across rotating 12h day/night rosters
      * Schedule 3 §4.1(b) & Schedule 2 §2 all-in annualised hourly rate
        (`$32.20`..`$39.48` EA_2025 / `$33.84`..`$41.49` EA_2026) absorbs
        Saturday/Sunday/Public Holiday (`cl 41`) and night (`cl 43`) loadings
        for Full-Time Security ONLY — while Part-Time & Casual Event Security
        (`Sch 3 §5.2-5.3`) retain `cl 41` and `cl 43` penalties.
"""
from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient

from model_builder import (
    ExistingShiftInput,
    OptimizerConstraints,
    ScheduleModelBuilder,
    _assignment_cost_cents_with_night,
    employee_eligible,
    net_shift_minutes,
    normalize_scheduler_mode,
)
from ortools_runner import app
from .conftest import make_employee, make_shift, solve


client = TestClient(app)


def sec_ft_constraints(**overrides) -> OptimizerConstraints:
    base = dict(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
        scheduler_mode="FT_SECURITY",
    )
    base.update(overrides)
    return OptimizerConstraints(**base)


def make_sec_ft_shift(
    sid: str,
    date: str,
    start: str = "06:00",
    end: str = "18:00",
    unpaid_break_minutes: int = 0,
    paid_break_minutes: int = 30,
    target_employment_type: str | None = "FT",
    **kwargs,
):
    """Canonical Sch 3 §3.1(a) / §3.2(a) 12.0h shift (720 paid min, 30m paid break)."""
    extra_fields = {"paid_break_minutes": paid_break_minutes}
    for k in (
        "target_requires_flexible",
        "is_saturday",
        "is_sunday",
        "is_public_holiday",
        "is_public_holiday_next_day",
    ):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    sh = make_shift(
        sid=sid,
        date=date,
        start=start,
        end=end,
        unpaid_break_minutes=unpaid_break_minutes,
        target_employment_type=target_employment_type,
        **kwargs,
    )
    for k, v in extra_fields.items():
        setattr(sh, k, v)
    return sh


def make_sec_ft_employee(
    eid: str = "sec_ft_1",
    hourly_rate: float = 33.84,  # EA_2026 Sch 2 §2 Level 3 FT Security annualised rate
    min_contract_minutes: int = 2520,  # Sch 3 §3.1(d): 42h/wk = 2520m
    max_weekly_minutes: int = 25_000,
    availability_mode: str = "OPT_OUT",
    **kwargs,
):
    extra_fields = {}
    for k in ("preferred_shift_ids", "fairness_debts", "is_flexible", "initial_effective_minutes"):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    emp = make_employee(
        eid=eid,
        employment_type="FT",
        is_security_role=True,
        hourly_rate=hourly_rate,
        min_contract_minutes=min_contract_minutes,
        max_weekly_minutes=max_weekly_minutes,
        availability_mode=availability_mode,
        **kwargs,
    )
    for k, v in extra_fields.items():
        setattr(emp, k, v)
    return emp


def date_offset(anchor: str, offset_days: int) -> str:
    d = datetime.date.fromisoformat(anchor) + datetime.timedelta(days=offset_days)
    return d.isoformat()


# ===========================================================================
# 1. Mode Normalization & Wire Parity (/optimize + /audit)
# ===========================================================================

def test_normalize_ft_security_mode_aliases():
    assert normalize_scheduler_mode("FT_SECURITY") == "FT_SECURITY"
    assert normalize_scheduler_mode("ft_security") == "FT_SECURITY"
    assert normalize_scheduler_mode("FT-SECURITY") == "FT_SECURITY"
    assert normalize_scheduler_mode(" ft-security ") == "FT_SECURITY"


def test_optimize_and_audit_endpoints_isolate_ft_security_over_wire():
    shift_payload = {
        "id": "sec-s1",
        "shift_date": "2026-07-06",
        "start_time": "06:00",
        "end_time": "18:00",
        "duration_minutes": 720,
        "unpaid_break_minutes": 0,
        "paid_break_minutes": 30,
        "target_employment_type": "FT",
        "role_id": "role-sec",
        "priority": 1,
    }
    sec_ft = {
        "id": "sec-ft",
        "name": "FT Security L3",
        "employment_type": "Full-Time",
        "is_security_role": True,
        "availability_mode": "OPT_OUT",
        "hourly_rate": 33.84,
        "min_contract_minutes": 720,
        "max_weekly_minutes": 2520,
        "contracted_role_ids": ["role-sec"],
    }
    std_ft = {
        **sec_ft,
        "id": "std-ft",
        "name": "Standard FT",
        "is_security_role": False,
    }
    pt_sec = {
        **sec_ft,
        "id": "pt-sec",
        "name": "PT Event Security (Sch 3 §5.2)",
        "employment_type": "Part-Time",
        "is_security_role": True,
    }
    cas_sec = {
        **sec_ft,
        "id": "cas-sec",
        "name": "Casual Event Security (Sch 3 §5.3)",
        "employment_type": "Casual",
        "is_security_role": True,
    }

    constraints_payload = {
        "min_rest_minutes": 600,
        "enforce_role_match": True,
        "enforce_skill_match": False,
        "allow_partial": True,
        "relax_constraints": False,
        "enforce_availability": True,
        "scheduler_mode": "FT_SECURITY",
    }

    audit_res = client.post("/audit", json={
        "shifts": [shift_payload],
        "employees": [sec_ft, std_ft, pt_sec, cas_sec],
        "constraints": constraints_payload,
        "target_shift_ids": ["sec-s1"],
    })
    assert audit_res.status_code == 200
    rows = {
        r["employee_id"]: r
        for r in audit_res.json()["rows"][0]["employees"]
    }
    assert rows["sec-ft"]["status"] == "PASS"
    assert "MODE_MISMATCH" in rows["std-ft"]["rejection_reasons"]
    assert "MODE_MISMATCH" in rows["pt-sec"]["rejection_reasons"]
    assert "MODE_MISMATCH" in rows["cas-sec"]["rejection_reasons"]

    opt_res = client.post("/optimize", json={
        "shifts": [shift_payload],
        "employees": [sec_ft, std_ft, pt_sec, cas_sec],
        "constraints": constraints_payload,
    })
    assert opt_res.status_code == 200
    body = opt_res.json()
    assert len(body["assignments"]) == 1
    assert body["assignments"][0]["employee_id"] == "sec-ft"
    # 12h * $33.84 = $406.08
    assert body["assignments"][0]["cost"] == pytest.approx(406.08)


# ===========================================================================
# 2. Layer 1 — Candidate Isolation & Paid Meal Break Bounds (Sch 3 §3.2(a))
# ===========================================================================

def test_layer1_excludes_non_ft_security_employees_and_non_ft_shifts():
    sec_ft = make_sec_ft_employee("sec_ft")
    std_ft = make_employee("std_ft", employment_type="FT", is_security_role=False, availability_mode="OPT_OUT")
    pt_sec = make_employee("pt_sec", employment_type="PT", is_security_role=True, availability_mode="OPT_OUT")
    fpt_sec = make_employee("fpt_sec", employment_type="PT", is_security_role=True, availability_mode="OPT_OUT")
    fpt_sec.is_flexible = True
    cas_sec = make_employee("cas_sec", employment_type="Casual", is_security_role=True, availability_mode="OPT_OUT")

    ft_shift = make_sec_ft_shift("s_ft", "2026-07-06", target_employment_type="FT")
    untagged_shift = make_sec_ft_shift("s_any", "2026-07-07", target_employment_type=None)
    cas_shift = make_sec_ft_shift("s_cas", "2026-07-08", target_employment_type="Casual")
    pt_shift = make_sec_ft_shift("s_pt", "2026-07-09", target_employment_type="PT")
    fpt_shift = make_sec_ft_shift(
        "s_fpt", "2026-07-10", target_employment_type="FT", target_requires_flexible=True
    )

    c = sec_ft_constraints()
    assert employee_eligible(sec_ft, ft_shift, c) is True
    assert employee_eligible(sec_ft, untagged_shift, c) is True
    assert employee_eligible(std_ft, ft_shift, c) is False
    assert employee_eligible(pt_sec, ft_shift, c) is False
    assert employee_eligible(fpt_sec, ft_shift, c) is False
    assert employee_eligible(cas_sec, ft_shift, c) is False

    assert employee_eligible(sec_ft, cas_shift, c) is False
    assert employee_eligible(sec_ft, pt_shift, c) is False
    assert employee_eligible(sec_ft, fpt_shift, c) is False


def test_layer1_paid_meal_break_duration_bounds_7_6h_to_12_0h():
    """Sch 3 §3.2(a): FT Security meal break (30m) is PAID, so ordinary/paid
    minutes equal gross duration. Contrast with FT_STANDARD where a 12.5h gross
    shift with 30m unpaid break nets 12.0h: in FT_SECURITY 12.5h gross = 750
    paid minutes > 720m and MUST be rejected."""
    sec_ft = make_sec_ft_employee("sec_ft", min_contract_minutes=0)
    c = sec_ft_constraints()

    # 7.6h gross (09:00-16:36 = 456m) -> 456 paid min -> PASS in FT_SECURITY!
    s_min_ok = make_sec_ft_shift("s_456", "2026-07-06", start="09:00", end="16:36")
    # 7.5h gross (09:00-16:30 = 450m) -> 450 paid min -> REJECT (< 456m)
    s_too_short = make_sec_ft_shift("s_450", "2026-07-07", start="09:00", end="16:30")
    # 12.0h gross (06:00-18:00 = 720m, 30m paid break) -> 720 paid min -> PASS
    s_max_ok = make_sec_ft_shift("s_720", "2026-07-08", start="06:00", end="18:00")
    # 12.5h gross (06:00-18:30 = 750m, even if unpaid_break_minutes=30 was passed) -> 750 paid min -> REJECT
    s_too_long = make_sec_ft_shift(
        "s_750", "2026-07-09", start="06:00", end="18:30", unpaid_break_minutes=30
    )

    assert net_shift_minutes(s_too_long, is_security=True) == 750
    assert employee_eligible(sec_ft, s_min_ok, c) is True
    assert employee_eligible(sec_ft, s_too_short, c) is False
    assert employee_eligible(sec_ft, s_max_ok, c) is True
    assert employee_eligible(sec_ft, s_too_long, c) is False

    # Audit endpoint surfaces exact reason codes
    audit_res = client.post("/audit", json={
        "shifts": [
            {
                "id": "s_450",
                "shift_date": "2026-07-07",
                "start_time": "09:00",
                "end_time": "16:30",
                "duration_minutes": 450,
                "unpaid_break_minutes": 0,
                "target_employment_type": "FT",
            },
            {
                "id": "s_750",
                "shift_date": "2026-07-09",
                "start_time": "06:00",
                "end_time": "18:30",
                "duration_minutes": 750,
                "unpaid_break_minutes": 30,
                "target_employment_type": "FT",
            },
        ],
        "employees": [{
            "id": "sec_ft",
            "name": "FT Security",
            "employment_type": "FT",
            "is_security_role": True,
            "availability_mode": "OPT_OUT",
            "hourly_rate": 33.84,
        }],
        "constraints": {"scheduler_mode": "FT_SECURITY"},
    })
    assert audit_res.status_code == 200
    rows_by_shift = {r["shift_id"]: r["employees"][0] for r in audit_res.json()["rows"]}
    assert "FT_MIN_DAILY_HOURS" in rows_by_shift["s_450"]["rejection_reasons"]
    assert "MAX_DAILY_HOURS" in rows_by_shift["s_750"]["rejection_reasons"]


# ===========================================================================
# 3. Layer 2 — Schedule 3 §3.1(a),(d) 8-Week 336h Cycle & EBA Hard Caps
# ===========================================================================

def test_layer2_four_weeks_of_168h_even_time_is_lawful_in_ft_security():
    """Sch 3 §3.1(a)-(d): 14 x 12h shifts over 28 days = 168h (10,080 paid min).
    FT_STANDARD caps 28 days at 152h (9,120m), whereas FT_SECURITY uses the
    8-week 336h (20,160m) cycle and assigns all 14 shifts cleanly."""
    anchor = "2024-01-01"
    cycle_start = "2026-06-29"  # exact 8-week boundary from 2024-01-01 (910 days = 16 * 56 + 14? Wait: compute exact!)
    # Compute exact 56-day boundary from 2024-01-01:
    # 2024-01-01 + 16 * 56 days = 2026-06-15
    cycle_start = date_offset(anchor, 16 * 56)

    emp = make_sec_ft_employee(
        "sec_ft",
        min_contract_minutes=10_080,  # 4w * 2520m = 10,080m (168h)
        max_weekly_minutes=10_080,
        ordinary_hours_cycle_anchor=anchor,
    )
    # Even-time pattern: 4 days on, 4 days off -> 14 shifts in 28 days (indices:
    # 0,1,2,3, 8,9,10,11, 16,17,18,19, 24,25 = 14 shifts x 12h = 168h)
    work_offsets = [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25]
    shifts = [
        make_sec_ft_shift(f"s_{d}", date_offset(cycle_start, d), start="06:00", end="18:00")
        for d in work_offsets
    ]

    out = solve(shifts, [emp], constraints=sec_ft_constraints())
    assert len(out.assignments) == 14
    assert len(out.unassigned_shift_ids) == 0


def test_layer2_eight_week_336h_cycle_cap_blocks_29th_12h_shift():
    """Sch 3 §3.1(a),(d): An anchored 56-day cycle is capped at 336h (20,160m)
    = 28 x 12h shifts. Seeding 14 x 12h existing shifts (168h) in weeks 1-4 and
    proposing 15 x 12h shifts (180h) in weeks 5-8 of the SAME 56-day cycle
    totals 348h — the solver MUST assign at most 14 (reaching 336h) and leave
    1 shift uncovered."""
    anchor = "2024-01-01"
    cycle_start = date_offset(anchor, 16 * 56)  # 2026-06-15 .. 2026-08-09 (days 0..55)

    pinned_offsets = [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25]  # 14 x 12h = 168h
    existing = [
        ExistingShiftInput(
            id=f"ex_{d}",
            shift_date=date_offset(cycle_start, d),
            start_time="06:00",
            end_time="18:00",
            duration_minutes=720,
            unpaid_break_minutes=0,
        )
        for d in pinned_offsets
    ]
    emp = make_sec_ft_employee(
        "sec_ft",
        min_contract_minutes=20_160,
        max_weekly_minutes=25_000,
        ordinary_hours_cycle_anchor=anchor,
        existing_shifts=existing,
    )

    # 15 non-consecutive candidate days in weeks 5-8 (days 28..55), well under 20-in-28:
    cand_offsets = [28, 29, 30, 31, 35, 36, 37, 38, 42, 43, 44, 45, 49, 50, 51]
    assert len(cand_offsets) == 15
    shifts = [
        make_sec_ft_shift(f"c_{d}", date_offset(cycle_start, d), start="06:00", end="18:00")
        for d in cand_offsets
    ]

    out = solve(shifts, [emp], constraints=sec_ft_constraints())
    assert len(out.assignments) == 14
    assert len(out.unassigned_shift_ids) == 1


def test_layer2_rotating_day_to_night_respects_10h_rest_gap():
    """Sch 3 §3.1(c) / cl 40.1: Day shift 06:00-18:00 followed by night shift
    18:00-06:00 the next day has 24h rest (lawful), whereas night shift
    18:00-06:00 on Day 1 (ending 06:00 Day 2) followed by day shift 14:00-22:00
    on Day 2 has only 8h rest (< 10h) and MUST NOT both go to the same officer."""
    emp = make_sec_ft_employee("sec_ft", min_contract_minutes=0)
    s_night = make_sec_ft_shift("s_night", "2026-07-06", start="18:00", end="06:00")
    # 14:00-22:00 on 2026-07-07 = 480 paid min (8.0h), gap from 06:00 is 8h (480m < 600m)
    s_day_tight = make_sec_ft_shift("s_day", "2026-07-07", start="14:00", end="22:00")

    out = solve([s_night, s_day_tight], [emp], constraints=sec_ft_constraints())
    assert len(out.assignments) == 1
    assert len(out.unassigned_shift_ids) == 1


def test_layer2_strict_one_shift_per_day_including_pinned_existing():
    """fn_shift_ft_one_per_day / cl 35.1(e) / cl 39.1: FT Security cannot hold
    two shifts starting on the same calendar day even if untagged (`None`)."""
    ex = ExistingShiftInput(
        id="ex_1",
        shift_date="2026-07-06",
        start_time="06:00",
        end_time="14:00",
        duration_minutes=480,
    )
    emp_with_ex = make_sec_ft_employee("sec_ex", min_contract_minutes=0, existing_shifts=[ex])
    s_same_day = make_sec_ft_shift(
        "s_same", "2026-07-06", start="15:00", end="23:00", target_employment_type=None
    )
    out_ex = solve([s_same_day], [emp_with_ex], constraints=sec_ft_constraints())
    assert len(out_ex.assignments) == 0
    assert out_ex.unassigned_shift_ids == ["s_same"]

    # Two candidate shifts on the same day with 1 employee -> at most 1 assigned
    emp = make_sec_ft_employee("sec_1", min_contract_minutes=0)
    s_am = make_sec_ft_shift("s_am", "2026-07-07", start="06:00", end="14:00", target_employment_type=None)
    s_pm = make_sec_ft_shift("s_pm", "2026-07-07", start="15:00", end="23:00", target_employment_type=None)
    out_two = solve([s_am, s_pm], [emp], constraints=sec_ft_constraints())
    assert len(out_two.assignments) == 1
    assert len(out_two.unassigned_shift_ids) == 1


def test_layer2_student_visa_48h_cap_uses_paid_security_minutes():
    """Condition 8105: 48h (2,880m) per 14 days. For FT Security, a 12.0h shift
    counts as full 720 paid min (30m meal break is paid), so 4 x 12h = 2,880m
    (48.0h) fits, while a 5th 12h shift (3,600m) is blocked."""
    student_sec = make_sec_ft_employee(
        "sec_stu",
        min_contract_minutes=0,
        is_student=True,
        visa_limit=2880,
    )
    shifts = [
        make_sec_ft_shift(f"s_{i}", date_offset("2026-07-06", i * 2), start="06:00", end="18:00")
        for i in range(5)
    ]
    out = solve(shifts, [student_sec], constraints=sec_ft_constraints())
    assert len(out.assignments) == 4
    assert len(out.unassigned_shift_ids) == 1


# ===========================================================================
# 4. Layer 3 — Plugins & Schedule 3 §4.1(b) All-In Annualised Rate Pricing
# ===========================================================================

def test_layer3_fairness_and_sc13_ft_days_off_disabled_while_fatigue_active():
    """In FT_SECURITY:
      - FairnessPlugin is disabled (zero fairness / undesirable / longitudinal terms)
      - SC-13 paired RDOs (`ft_days_off`) is disabled (Sch 3 §3.1(b) even-time prevails)
      - FatiguePlugin (`fatigue`) is ACTIVE on 12h night shifts."""
    emp = make_sec_ft_employee(
        "sec_ft",
        min_contract_minutes=0,
        fairness_debts={"total_hours": 50.0, "night_hours": 25.0, "sunday_hours": 20.0},
    )
    # 3 consecutive 12h night shifts (18:00-06:00) in one ISO week -> triggers Amber/Critical fatigue
    shifts = [
        make_sec_ft_shift(f"n_{i}", date_offset("2026-07-06", i), start="18:00", end="06:00")
        for i in range(3)
    ]

    from model_builder import OptimizerInput
    inp = OptimizerInput(
        shifts=shifts,
        employees=[emp],
        constraints=sec_ft_constraints(),
    )
    builder = ScheduleModelBuilder(inp)
    out = builder.build_and_solve()

    assert len(out.assignments) == 3
    assert len(builder._term_categories["fairness"]) == 0
    assert len(builder._term_categories["undesirable_balance"]) == 0
    assert len(builder._term_categories["longitudinal_fairness"]) == 0
    assert len(builder._term_categories["ft_days_off"]) == 0
    assert len(builder._term_categories["fatigue"]) > 0


def test_layer3_schedule3_annualised_rate_absorbs_weekend_ph_and_night_loadings():
    """Sch 3 §4.1(b) & Sch 2 §2: Full-Time Security annualised hourly rate
    ($33.84 Level 3 EA_2026) is ALL-IN on rostered hours — Saturday, Sunday,
    Public Holiday, and Night shifts MUST all cost flat `hours * annualised_rate`
    with ZERO cl 41 / cl 43 multipliers.
    By contrast, Part-Time Event Security (Sch 3 §5.2) and Casual Event Security
    (Sch 3 §5.3) are NOT annualised and MUST still receive cl 41 / cl 43 loadings."""
    annualised_l3 = 33.84  # EA_2026 Sch 2 §2 Security Level 3 FT annualised rate

    mon_day = make_sec_ft_shift("mon", "2026-07-06", start="06:00", end="18:00")
    sat_day = make_sec_ft_shift("sat", "2026-07-11", start="06:00", end="18:00", is_saturday=True)
    sun_day = make_sec_ft_shift("sun", "2026-07-12", start="06:00", end="18:00", is_sunday=True)
    ph_day = make_sec_ft_shift("ph", "2026-07-13", start="06:00", end="18:00", is_public_holiday=True)
    wed_night = make_sec_ft_shift("night", "2026-07-08", start="18:00", end="06:00")

    expected_cents = int(round(12.0 * annualised_l3 * 100))  # 40,608 cents ($406.08)
    for sh in (mon_day, sat_day, sun_day, ph_day, wed_night):
        assert _assignment_cost_cents_with_night(
            annualised_l3, "FT", sh, is_security=True
        ) == expected_cents, f"Expected flat annualised cost on {sh.id}"

    # Verify PT Event Security (Sch 3 §5.2) and Casual Event Security (Sch 3 §5.3)
    # still receive cl 41 Sunday/Saturday and cl 43 night loadings!
    pt_base_l2 = 28.08
    pt_mon_cents = _assignment_cost_cents_with_night(pt_base_l2, "PT", mon_day, is_security=True)
    pt_sun_cents = _assignment_cost_cents_with_night(pt_base_l2, "PT", sun_day, is_security=True)
    pt_night_cents = _assignment_cost_cents_with_night(pt_base_l2, "PT", wed_night, is_security=True)
    assert pt_sun_cents == int(round(pt_mon_cents * 1.50))
    assert pt_night_cents > pt_mon_cents

    cas_base_l2 = 35.10  # $28.08 * 1.25 casual rate
    cas_mon_cents = _assignment_cost_cents_with_night(cas_base_l2, "Casual", mon_day, is_security=True)
    cas_sun_cents = _assignment_cost_cents_with_night(cas_base_l2, "Casual", sun_day, is_security=True)
    assert cas_sun_cents > cas_mon_cents
