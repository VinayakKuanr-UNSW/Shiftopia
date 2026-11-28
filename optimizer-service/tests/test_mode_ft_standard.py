"""
Comprehensive EBA & Architecture Tests for MODE_FT_STANDARD.

Verifies all three layers of the Standard (Non-Security) Full-Time Autoscheduler:
  - Layer 1 (Eligibility & Mode Isolation):
      * Standard FT only (`employment_type == 'FT'` and `not is_security_role`)
      * Excludes Casual, PT, FPT, and FT Security (Schedule 3 §3.1)
      * Shift target isolation (`target_employment_type in (None, 'FT')`)
      * EBA cl 35.1(c) 7.6h (456 net min) minimum daily ordinary hours
      * EBA cl 35.1(d) 12.0h (720 net min) maximum daily ordinary hours
      * Approved leave (`unavailable_dates`), role/skill/license match,
        OPT_OUT availability & HC-5e contract envelope
      * `/audit` endpoint parity with `employee_eligible`
  - Layer 2 (Hard Legal Compliance & Net-Minute Parity):
      * EBA cl 35.1(a) & cl 12.2(b) 1/2/3/4-week anchored cycle caps
        (38h / 76h / 114h / 152h NET of unpaid meal breaks)
      * EBA cl 35.1(e) & cl 39.1 continuous work / strict 1 shift per day
        (candidate pairs + pinned `existing_shifts`)
      * EBA cl 35.1(e) rolling 20 working days in 28 (incl. overnight spill)
      * EBA cl 40.1 / cl 40.3 cross-day rest gap (10h standard, 8h multi-hire)
      * Migration Act condition 8105 student visa 48h/14d cap (net minutes)
  - Layer 3 (Guardrail Plugins & Cost):
      * FairnessPlugin strictly DISABLED (zero fairness/ledger terms, no 65%
        anti-hogging penalty against 38h contract fulfillment)
      * FatiguePlugin ACTIVE (SC-7 weekly circadian bands)
      * SC-13 Paired Consecutive Days Off (`cl 35.1(e)` ↔ `V8_FT_DAYS_OFF`)
        groups weekly days off into consecutive pairs above `cost`, while
        yielding cleanly to `coverage`
      * Net paid hours pricing (`cl 36.1` unpaid meal break excluded from
        `AssignmentProposal.cost`, `SC-1`, `HC-7`, and `SC-5` overtime)
"""
from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient

from model_builder import (
    ExistingShiftInput,
    FT_MIN_ORDINARY_DAY_MINUTES,
    MAX_DAILY_MINUTES,
    OptimizerConstraints,
    SCHEDULER_MODES,
    AvailabilitySlotInput,
    AvailabilityOverrideInput,
    net_shift_minutes,
    normalize_scheduler_mode,
)
from ortools_runner import app
from .conftest import make_employee, make_shift, solve


client = TestClient(app)


def ft_constraints(**overrides) -> OptimizerConstraints:
    base = dict(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
        scheduler_mode="FT_STANDARD",
    )
    base.update(overrides)
    return OptimizerConstraints(**base)


def make_ft_shift(
    sid: str,
    date: str,
    start: str = "09:00",
    end: str = "17:06",
    unpaid_break_minutes: int = 30,
    target_employment_type: str | None = "FT",
    **kwargs,
):
    """Default: 09:00–17:06 (486m gross - 30m unpaid = 456m net = 7.6h)."""
    return make_shift(
        sid=sid,
        date=date,
        start=start,
        end=end,
        unpaid_break_minutes=unpaid_break_minutes,
        target_employment_type=target_employment_type,
        **kwargs,
    )


def make_ft_employee(
    eid: str = "ft1",
    min_contract_minutes: int = 2280,
    max_weekly_minutes: int = 10_000,
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
        is_security_role=False,
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
# 1. Mode Normalization & Wire Schema Parity
# ===========================================================================

def test_normalize_scheduler_mode_variants():
    assert normalize_scheduler_mode(None) is None
    assert normalize_scheduler_mode("") is None
    assert normalize_scheduler_mode("ALL") is None
    assert normalize_scheduler_mode("all") is None
    assert normalize_scheduler_mode("ft_standard") == "FT_STANDARD"
    assert normalize_scheduler_mode("FT-STANDARD") == "FT_STANDARD"
    for mode in SCHEDULER_MODES:
        assert normalize_scheduler_mode(mode) == mode
    with pytest.raises(ValueError, match="Invalid scheduler_mode"):
        normalize_scheduler_mode("UNKNOWN_MODE")


def test_optimize_and_audit_endpoints_accept_ft_standard_over_wire():
    shift_payload = {
        "id": "s1",
        "shift_date": "2026-06-01",
        "start_time": "09:00",
        "end_time": "17:06",
        "duration_minutes": 486,
        "unpaid_break_minutes": 30,
        "target_employment_type": "FT",
        "role_id": "role-a",
        "priority": 1,
    }
    ft_emp = {
        "id": "ft1",
        "name": "Standard FT",
        "employment_type": "Full-Time",
        "is_security_role": False,
        "availability_mode": "OPT_OUT",
        "hourly_rate": 30.0,
        "min_contract_minutes": 456,
        "max_weekly_minutes": 2280,
        "contracted_role_ids": ["role-a"],
    }
    sec_ft_emp = {
        **ft_emp,
        "id": "sec1",
        "name": "Security FT",
        "is_security_role": True,
    }
    casual_emp = {
        **ft_emp,
        "id": "cas1",
        "name": "Casual",
        "employment_type": "Casual",
    }

    audit_res = client.post("/audit", json={
        "shifts": [shift_payload],
        "employees": [ft_emp, sec_ft_emp, casual_emp],
        "constraints": {
            "min_rest_minutes": 600,
            "enforce_role_match": True,
            "enforce_skill_match": False,
            "allow_partial": True,
            "relax_constraints": False,
            "enforce_availability": True,
            "scheduler_mode": "FT_STANDARD",
        },
        "target_shift_ids": ["s1"],
    })
    assert audit_res.status_code == 200
    emps_by_id = {
        row["employee_id"]: row
        for row in audit_res.json()["rows"][0]["employees"]
    }
    assert emps_by_id["ft1"]["status"] == "PASS"
    assert "MODE_MISMATCH" in emps_by_id["sec1"]["rejection_reasons"]
    assert "MODE_MISMATCH" in emps_by_id["cas1"]["rejection_reasons"]

    opt_res = client.post("/optimize", json={
        "shifts": [shift_payload],
        "employees": [ft_emp, sec_ft_emp, casual_emp],
        "constraints": {
            "min_rest_minutes": 600,
            "enforce_role_match": True,
            "enforce_skill_match": False,
            "allow_partial": True,
            "relax_constraints": False,
            "enforce_availability": True,
            "scheduler_mode": "FT_STANDARD",
        },
    })
    assert opt_res.status_code == 200
    body = opt_res.json()
    assert len(body["assignments"]) == 1
    assert body["assignments"][0]["employee_id"] == "ft1"
    # Paid on 456 net minutes (7.6h * $30 = $228.00), NOT 486 gross minutes ($243.00)
    assert body["assignments"][0]["cost"] == pytest.approx(228.0)


# ===========================================================================
# 2. Layer 1 — Eligibility & Mode Isolation
# ===========================================================================

def test_mode_isolation_excludes_non_standard_ft_employees_and_off_target_shifts():
    s_ft = make_ft_shift("s_ft", "2026-06-01")
    s_pt = make_ft_shift("s_pt", "2026-06-02", target_employment_type="PT")
    s_cas = make_ft_shift("s_cas", "2026-06-03", target_employment_type="Casual")

    ft_std = make_ft_employee("ft_std")
    ft_sec = make_employee("ft_sec", employment_type="FT", is_security_role=True, availability_mode="OPT_OUT")
    pt_emp = make_employee("pt_emp", employment_type="PT", availability_mode="OPT_OUT")
    fpt_emp = make_employee("fpt_emp", employment_type="PT", availability_mode="OPT_OUT")
    fpt_emp.is_flexible = True
    cas_emp = make_employee("cas_emp", employment_type="Casual")

    out = solve(
        [s_ft, s_pt, s_cas],
        [ft_std, ft_sec, pt_emp, fpt_emp, cas_emp],
        constraints=ft_constraints(),
    )
    assert [a.shift_id for a in out.assignments] == ["s_ft"]
    assert out.assignments[0].employee_id == "ft_std"
    assert sorted(out.unassigned_shift_ids) == ["s_cas", "s_pt"]


def test_eba_cl_35_1_c_minimum_7_6h_net_floor_and_cl_35_1_d_12h_net_ceiling():
    """EBA cl 35.1(c): FT minimum daily ordinary hours is 7.6h (456 net min).
    EBA cl 35.1(d): FT maximum daily ordinary hours is 12.0h (720 net min).
    Unpaid meal breaks (cl 36.1) do not count toward worked hours."""
    assert FT_MIN_ORDINARY_DAY_MINUTES == 456
    assert MAX_DAILY_MINUTES == 720

    # 8h gross (09:00-17:00) with 30m unpaid break = 450m net (7.5h) -> REJECTED (< 456m)
    s_too_short = make_ft_shift("s_short", "2026-06-01", "09:00", "17:00", unpaid_break_minutes=30)
    assert net_shift_minutes(s_too_short) == 450

    # 8.1h gross (09:00-17:06) with 30m unpaid break = 456m net (7.6h) -> ACCEPTED
    s_exact_min = make_ft_shift("s_min", "2026-06-02", "09:00", "17:06", unpaid_break_minutes=30)
    assert net_shift_minutes(s_exact_min) == 456

    # 12.5h gross (06:00-18:30) with 30m unpaid break = 720m net (12.0h) -> ACCEPTED
    s_exact_max = make_ft_shift("s_max", "2026-06-03", "06:00", "18:30", unpaid_break_minutes=30)
    assert net_shift_minutes(s_exact_max) == 720

    # 12h 31m gross (06:00-18:31) with 30m unpaid break = 721m net -> REJECTED (> 720m)
    s_too_long = make_ft_shift("s_long", "2026-06-04", "06:00", "18:31", unpaid_break_minutes=30)
    assert net_shift_minutes(s_too_long) == 721

    out = solve(
        [s_too_short, s_exact_min, s_exact_max, s_too_long],
        [make_ft_employee("ft1")],
        constraints=ft_constraints(),
    )
    assigned_ids = sorted(a.shift_id for a in out.assignments)
    assert assigned_ids == ["s_max", "s_min"]
    assert sorted(out.unassigned_shift_ids) == ["s_long", "s_short"]


def test_audit_reports_ft_min_and_max_daily_hours_reasons():
    base_emp = {
        "id": "ft1", "name": "FT", "employment_type": "FT",
        "is_security_role": False, "availability_mode": "OPT_OUT",
        "hourly_rate": 30.0,
    }
    res = client.post("/audit", json={
        "shifts": [
            {
                "id": "short", "shift_date": "2026-06-01",
                "start_time": "09:00", "end_time": "17:00",
                "duration_minutes": 480, "unpaid_break_minutes": 30,
                "target_employment_type": "FT",
            },
            {
                "id": "long", "shift_date": "2026-06-02",
                "start_time": "06:00", "end_time": "18:31",
                "duration_minutes": 751, "unpaid_break_minutes": 30,
                "target_employment_type": "FT",
            },
        ],
        "employees": [base_emp],
        "constraints": {"scheduler_mode": "FT_STANDARD"},
    }).json()
    by_shift = {r["shift_id"]: r["employees"][0]["rejection_reasons"] for r in res["rows"]}
    assert "FT_MIN_DAILY_HOURS" in by_shift["short"]
    assert "MAX_DAILY_HOURS" in by_shift["long"]


def test_leave_envelope_and_opt_out_availability_respected_in_ft_standard():
    s_leave = make_ft_shift("s_leave", "2026-06-01", "09:00", "17:06")
    s_outside_env = make_ft_shift("s_env", "2026-06-02", "14:00", "22:06")
    s_narrowed_slot = make_ft_shift("s_slot", "2026-06-03", "09:00", "17:06")
    s_hard_ov = make_ft_shift("s_ov", "2026-06-04", "09:00", "17:06")
    s_valid = make_ft_shift("s_ok", "2026-06-05", "09:00", "17:06")

    ft = make_ft_employee(
        "ft1",
        unavailable_dates=["2026-06-01"],
        ordinary_span_start="06:00",
        ordinary_span_end="19:00",
        ordinary_days=[1, 2, 3, 4, 5],
        availability_slots=[
            AvailabilitySlotInput(slot_date="2026-06-03", start_time="10:00", end_time="18:00"),
        ],
        availability_overrides=[
            AvailabilityOverrideInput(
                date="2026-06-04", start_time="08:00", end_time="12:00", severity="HARD",
            ),
        ],
    )
    out = solve(
        [s_leave, s_outside_env, s_narrowed_slot, s_hard_ov, s_valid],
        [ft],
        constraints=ft_constraints(),
    )
    assert [a.shift_id for a in out.assignments] == ["s_ok"]


# ===========================================================================
# 3. Layer 2 — Legal Compliance & Net-Minute Parity
# ===========================================================================

def test_four_week_152h_cycle_cap_measured_net_of_unpaid_breaks():
    """EBA cl 35.1(a): 152h over an anchored 4-week cycle.
    20 shifts × (486m gross - 30m unpaid = 456m net) = 9,120m net (152.0h) -> ALL 20 PASS!
    (Gross would have been 9,720m = 162h and falsely blocked the 19th & 20th shifts.)
    Adding a 21st shift pushes net hours to 9,576m > 9,120m -> 21st shift REFUSED."""
    anchor = "2026-06-01"  # Monday
    # 5 days/week (Mon-Fri) × 4 weeks = 20 shifts = 9,120 net min (152.0h)
    shifts_20 = []
    for wk in range(4):
        for d in range(5):
            dt = date_offset(anchor, wk * 7 + d)
            shifts_20.append(make_ft_shift(f"s_{wk}_{d}", dt))

    ft = make_ft_employee(
        "ft1",
        min_contract_minutes=9120,
        max_weekly_minutes=100_000,
        ordinary_hours_cycle_weeks=4,
        ordinary_hours_cycle_anchor=anchor,
    )
    out20 = solve(shifts_20, [ft], constraints=ft_constraints())
    assert len(out20.assignments) == 20
    assert out20.unassigned_shift_ids == []
    assert (out20.objective_breakdown or {}).get("legal_hard", 0) == 0

    # Add a 21st shift on the first Saturday (still <= 20-in-28 if 20 shifts, here 21 shifts -> both 152h & 20-in-28 bind)
    # Test pure hours cap with 19 × 8h net (480m net = 510m gross - 30m break) = 9,120m + 20th shift -> blocked!
    shifts_8h = []
    idx = 0
    for wk in range(4):
        for d in range(5):
            dt = date_offset(anchor, wk * 7 + d)
            shifts_8h.append(
                make_ft_shift(f"h8_{idx}", dt, "09:00", "17:30", unpaid_break_minutes=30)
            )
            idx += 1
    out_8h = solve(shifts_8h, [ft], constraints=ft_constraints())
    # 19 × 480m = 9,120m (152.0h) assigned; 20th shift (9,600m > 9,120m) left unassigned!
    assert len(out_8h.assignments) == 19
    assert len(out_8h.unassigned_shift_ids) == 1
    assert (out_8h.objective_breakdown or {}).get("legal_hard", 0) == 0


@pytest.mark.parametrize("cycle_weeks,max_8h_shifts", [
    (1, 4),   # 4 × 8h = 32h <= 38h; 5 × 8h = 40h > 38h
    (2, 9),   # 9 × 8h = 72h <= 76h; 10 × 8h = 80h > 76h
    (3, 14),  # 14 × 8h = 112h <= 114h; 15 × 8h = 120h > 114h
])
def test_declared_1_2_3_week_anchored_cycles_enforced_in_ft_standard(cycle_weeks, max_8h_shifts):
    """EBA cl 35.1(a) & cl 12.2(b): declared work cycles of 1, 2, or 3 weeks
    cap ordinary hours at 38h × cycle_weeks (2280 / 4560 / 6840 net minutes)."""
    anchor = "2026-06-01"
    shifts = []
    for wk in range(cycle_weeks):
        for d in range(5):
            dt = date_offset(anchor, wk * 7 + d)
            shifts.append(
                make_ft_shift(f"s_{wk}_{d}", dt, "09:00", "17:30", unpaid_break_minutes=30)
            )
    ft = make_ft_employee(
        "ft1",
        min_contract_minutes=2280 * cycle_weeks,
        max_weekly_minutes=100_000,
        ordinary_hours_cycle_weeks=cycle_weeks,
        ordinary_hours_cycle_anchor=anchor,
    )
    out = solve(shifts, [ft], constraints=ft_constraints())
    assert len(out.assignments) == max_8h_shifts
    assert len(out.unassigned_shift_ids) == (5 * cycle_weeks) - max_8h_shifts


def test_strict_one_shift_per_day_even_when_untargeted_or_pinned():
    """EBA cl 35.1(e) continuous work & cl 39.1 no split shifts:
    FT_STANDARD never assigns 2 shifts on the same calendar day, even if
    target_employment_type is None or an existing shift occupies that day."""
    # Day 1: two non-overlapping 7.6h shifts (06:00-14:06 and 14:30-22:36 -> total >12h anyway,
    # so test against a pinned short existing shift on Day 2 where total hours < 12h!)
    ex = ExistingShiftInput(
        id="ex_short",
        shift_date="2026-06-02",
        start_time="06:00",
        end_time="09:00",
        duration_minutes=180,
        unpaid_break_minutes=0,
    )
    s_day2 = make_ft_shift(
        "s_day2", "2026-06-02", "10:00", "18:06",
        unpaid_break_minutes=30, target_employment_type=None,
    )
    ft = make_ft_employee("ft1", existing_shifts=[ex])
    out = solve([s_day2], [ft], constraints=ft_constraints())
    assert out.assignments == []
    assert out.unassigned_shift_ids == ["s_day2"]


def test_rolling_20_workdays_in_28_enforced_across_cycle_boundary():
    """EBA cl 35.1(e): max 20 working days in any rolling 28-day period, even
    when the 28 days straddle two anchored 4-week cycles so neither cycle
    exceeds 152h on its own."""
    # Anchor = 2026-06-01; place 21 shifts of 7.6h across 2026-06-15 .. 2026-07-12
    # (14 days in cycle 0 + 14 days in cycle 1 -> <= 11 shifts per cycle = 83.6h << 152h!)
    start = "2026-06-15"
    shifts = [
        make_ft_shift(f"d{i}", date_offset(start, i))
        for i in range(21)
    ]
    ft = make_ft_employee(
        "ft1",
        min_contract_minutes=0,
        max_weekly_minutes=100_000,
        ordinary_hours_cycle_weeks=4,
        ordinary_hours_cycle_anchor="2026-06-01",
    )
    out = solve(shifts, [ft], constraints=ft_constraints())
    assert len(out.assignments) == 20
    assert len(out.unassigned_shift_ids) == 1
    assert (out.objective_breakdown or {}).get("legal_hard", 0) == 0


def test_cross_day_10h_rest_gap_enforced_and_8h_multi_hire_allowed():
    """EBA cl 40.1: minimum 10h (600m) break between consecutive days' shifts.
    EBA cl 40.3: 8h (480m) break when MULTI_HIRE."""
    # Day 1 ends 22:30; Day 2 starts 07:30 -> 9h (540m) gap < 600m -> only 1 assigned
    s1 = make_ft_shift("s1", "2026-06-01", "14:24", "22:30", unpaid_break_minutes=30)
    s2_9h = make_ft_shift("s2", "2026-06-02", "07:30", "15:36", unpaid_break_minutes=30)
    ft = make_ft_employee("ft1", min_contract_minutes=0)

    out_breach = solve([s1, s2_9h], [ft], constraints=ft_constraints())
    assert len(out_breach.assignments) == 1

    # Day 2 starts 08:30 -> 10.0h (600m) gap -> both assigned
    s2_10h = make_ft_shift("s2_ok", "2026-06-02", "08:30", "16:36", unpaid_break_minutes=30)
    out_ok = solve([s1, s2_10h], [ft], constraints=ft_constraints())
    assert len(out_ok.assignments) == 2


def test_student_visa_48h_fortnight_measured_on_net_minutes():
    """Migration Act condition 8105: max 48h (2,880m) per rolling 14 days,
    measured on NET worked minutes (matching V8_STUDENT_VISA_LIMIT)."""
    # 7 shifts × (510m gross - 30m unpaid = 480m net = 8.0h) in 14 days:
    # 6 × 480m = 2,880m (48.0h) allowed; 7th shift blocked!
    shifts = [
        make_ft_shift(f"v{i}", date_offset("2026-06-01", i * 2), "09:00", "17:30", unpaid_break_minutes=30)
        for i in range(7)
    ]
    ft_visa = make_ft_employee("ft_visa", is_student=True, visa_limit=2880, min_contract_minutes=0)
    out = solve(shifts, [ft_visa], constraints=ft_constraints())
    assert len(out.assignments) == 6
    assert len(out.unassigned_shift_ids) == 1


# ===========================================================================
# 4. Layer 3 — Plugins (Paired RDOs, Zero Fairness, Fatigue Active, Net Cost)
# ===========================================================================

def test_paired_consecutive_days_off_preferred_over_fragmented_days_off():
    """EBA cl 35.1(e) / SC-13 (`V8_FT_DAYS_OFF`):
    Suppose over a 14-day fortnight there are 14 shifts (1 per day) and 2 FT
    employees (`ft_a` at $30/hr, `ft_b` at $30/hr) who each take 5 shifts (or
    1 FT employee choosing 10 of 14 days while a second FT covers 4 days, where
    weekend shifts carry Saturday 125% / Sunday 150% loadings).
    Even when giving `ft_a` fragmented single days off (e.g. Sun + Wed) would
    save small cost differences, SC-13 in the `guardrail` tier outranks `cost`
    and groups `ft_a`'s days off into >= 2 consecutive 2-day pairs!"""
    start = "2026-06-01"  # Monday .. Sunday x 2 weeks (14 days)
    # 10 shifts on specific days? Better: 14 shifts (1 per day), ft_a has
    # max_weekly_minutes=4560 (10 shifts × 456m) and ft_b has max_weekly_minutes=1824 (4 shifts).
    # Give ft_a a slightly cheaper rate on Saturday & Sunday? No, hourly_rate is per employee:
    # make ft_a cheaper ($28/hr) than ft_b ($35/hr). Because weekend multipliers are 1.25x / 1.50x,
    # pure `cost` minimization wants cheaper `ft_a` to work ALL Saturdays AND Sundays (highest
    # multipliers!) and take isolated weekday Tuesdays/Thursdays off!
    # Wait: if ft_a works Sat+Sun and takes Tue+Wed off, Tue+Wed IS a consecutive pair of days off!
    # Let's test a case where pure `cost` would force ISOLATED single days off:
    # Give ft_a a PREFERENCE discount (`preferred_shift_ids` = -$5/shift in `cost` tier!) on
    # Mon, Wed, Fri, Sun of both weeks so every alternate day is cheaper in `cost`!
    shifts = [
        make_ft_shift(f"d{i}", date_offset(start, i))
        for i in range(14)
    ]
    alternating_ids = [f"d{i}" for i in range(14) if i % 2 == 0]  # d0, d2, d4, d6, d8, d10, d12

    ft_a = make_ft_employee(
        "ft_a",
        hourly_rate=30.0,
        min_contract_minutes=4560,  # 10 shifts (76h)
        max_weekly_minutes=4560,    # cap at 10 shifts so ft_a gets 4 days off in 14 days
        preferred_shift_ids=alternating_ids,
    )
    ft_b = make_ft_employee(
        "ft_b",
        hourly_rate=30.0,
        min_contract_minutes=1824,  # 4 shifts
        max_weekly_minutes=4560,
    )

    out = solve(shifts, [ft_a, ft_b], constraints=ft_constraints())
    assert len(out.assignments) == 14
    assert (out.objective_breakdown or {}).get("ft_days_off", 0) == 0

    # Verify ft_a has >= 2 disjoint pairs of consecutive days off (matching V8_FT_DAYS_OFF)
    ft_a_days = {
        int(a.shift_id[1:]) for a in out.assignments if a.employee_id == "ft_a"
    }
    assert len(ft_a_days) == 10
    pairs_found = 0
    run = 0
    for i in range(14):
        if i in ft_a_days:
            pairs_found += run // 2
            run = 0
        else:
            run += 1
    pairs_found += run // 2
    assert pairs_found >= 2, f"Expected >=2 consecutive off-day pairs for ft_a, got days={sorted(ft_a_days)}"


def test_paired_days_off_yields_to_coverage_when_unavoidable():
    """Lexicographic order: `coverage` » `soft` » `guardrail` (`ft_days_off`).
    If 6 days in a 7-day week must be covered by the sole FT employee, coverage
    wins (all 6 shifts assigned) rather than dropping a shift to create a pair."""
    shifts = [make_ft_shift(f"d{i}", date_offset("2026-06-01", i)) for i in range(6)]
    ft = make_ft_employee("ft_solo", min_contract_minutes=2280, max_weekly_minutes=4560)
    out = solve(shifts, [ft], constraints=ft_constraints())
    assert len(out.assignments) == 6
    assert out.unassigned_shift_ids == []


def test_fairness_plugin_and_anti_hogging_completely_disabled_in_ft_standard():
    """In FT_STANDARD:
      1. Zero fairness / undesirable_balance / longitudinal_fairness terms in breakdown.
      2. Employee fairness_debts are completely ignored.
      3. Anti-hogging 65% cap is disabled so 1 FT employee fulfilling 5 shifts
         (100% of a 38h demand pool) incurs 0 `other` (soft) penalty."""
    shifts = [make_ft_shift(f"d{i}", date_offset("2026-06-01", i)) for i in range(5)]
    ft = make_ft_employee(
        "ft1",
        min_contract_minutes=2280,
        max_weekly_minutes=2280,
        fairness_debts={
            "total_hours": 50.0,
            "sunday_hours": 20.0,
            "night_hours": 20.0,
            "overtime_hours": 10.0,
        },
    )
    out = solve(shifts, [ft], constraints=ft_constraints())
    assert len(out.assignments) == 5
    bd = out.objective_breakdown or {}
    assert "fairness" not in bd
    assert "undesirable_balance" not in bd
    assert "longitudinal_fairness" not in bd
    # 5 × 456m = 2,280m matches min_contract_minutes=2280 & max_weekly_minutes=2280 with NO hog_slack!
    assert bd.get("other", 0) == 0


def test_fatigue_plugin_active_and_balances_circadian_load_in_ft_standard():
    """FatiguePlugin (SC-7) remains active in FT_STANDARD: heavy overnight
    shifts (22:00-06:06, ~666 circadian effective mins each) are shared between
    two FT employees rather than pushing one past the 1200/1800 weekly thresholds."""
    week_dates = [date_offset("2026-06-01", i) for i in range(4)]
    night_shifts = [
        make_ft_shift(f"n{i}", d, "22:00", "06:06", unpaid_break_minutes=30)
        for i, d in enumerate(week_dates)
    ]
    # Even if ft1 is slightly cheaper ($29 vs $30), guardrail (fatigue) beats cost
    # because 4 nights on ft1 (~2,664 eff mins > 1800 critical) vs 2+2 (~1,332 each).
    ft1 = make_ft_employee("ft1", hourly_rate=29.0, min_contract_minutes=912, max_weekly_minutes=2280)
    ft2 = make_ft_employee("ft2", hourly_rate=30.0, min_contract_minutes=912, max_weekly_minutes=2280)

    out = solve(night_shifts, [ft1, ft2], constraints=ft_constraints())
    assert len(out.assignments) == 4
    counts = {
        eid: sum(1 for a in out.assignments if a.employee_id == eid)
        for eid in ("ft1", "ft2")
    }
    assert counts == {"ft1": 2, "ft2": 2}
    assert out.pillars["fatigue"]["critical"] == 0
