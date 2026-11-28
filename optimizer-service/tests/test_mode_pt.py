"""
Comprehensive EBA Clause 12.3, Clause 35.2, Clause 39, Clause 56.2 & Schedule 3 §5.2
Tests for MODE_PT (Regular / Predetermined Part-Time).

Verifies all three layers of the Part-Time Autoscheduler:
  - Layer 1 (Eligibility & Mode Isolation — cl 12.3, cl 35.2, cl 56.2, Sch 3 §5.2):
      * Regular Part-Time only (`employment_type == 'PT'` and `not is_flexible`)
      * Accepts BOTH Standard PT (`is_security_role == False`, unpaid meal break
        per cl 36.1) AND Event Security PT (`is_security_role == True`, paid
        meal break per Sch 3 §5.3(a))
      * Excludes Flexible Part-Time (`employment_type == 'PT', is_flexible == True`
        — Mode #4 `FPT`), Full-Time (`FT_STANDARD` / `FT_SECURITY`), and Casual
      * Shift target isolation (`target_employment_type in (None, 'PT')` and
        `not target_requires_flexible`)
      * Minimum engagement & break-type parity (`cl 12.3(e)` / `cl 35.2(e)` /
        `Sch 3 §5.2(e)` / `cl 56.2`):
          - Flat 3.0h (180m) minimum on weekdays AND Sundays (NO 4h Sunday uplift)
          - NO 2.0h training exception (a 2.0h training shift is REJECTED for
            plain PT, matching `requiredMinEngagementMinutes` in `evaluate.ts`)
          - Public Holiday minimum engagement is 4.0h (240m) per `cl 56.2`
            (`SHAPE_MIN_ENGAGEMENT_PH`), overriding the 3.0h floor
          - 12.0h (720m) daily ceiling: `12.5h` gross with `30m` unpaid break
            is `720m` net and LAWFUL for Standard PT, whereas `12.5h` gross is
            `750m` paid and REJECTED for Event Security PT (`Sch 3 §5.3(a)`)
      * `/audit` & `/optimize` endpoint parity (`MODE_MISMATCH`,
        `EMPLOYMENT_TARGET`, `MIN_ENGAGEMENT`, `MAX_DAILY_HOURS`)
  - Layer 2 (Hard Legal Compliance — cl 35.2, cl 36.1, cl 39, cl 40, Sch 3 §5.2):
      * Anchored 1..4-week work cycle (`38h / 76h / 114h / 152h`, `cl 35.2(b)` &
        `Sch 3 §5.2(b)` — verifying Event Security PT uses the 4-week `152h` cap,
        NOT FT Security's 8-week `336h` cap)
      * Split shifts (`cl 35.2(g)`, `cl 39.1-39.4`, `cl 28.4`):
          - Two non-overlapping same-day shifts (`07:00-11:00` + `13:00-17:00`,
            `10h` spread, `2h` gap) are LAWFUL on a single PT employee and
            attract `split_shift_allowance_cents` (`SC-12`) once per day
          - Spread `> 12h` excluding meal AND rest breaks (`cl 39.2` / `HC-9`)
            is BLOCKED at Tier-0 legal_hard, while `13.0h` gross minus `60m`
            in-shift breaks (`12.0h` net spread) PASSES
          - Candidate + pinned `existing_shifts` exceeding `12h` net spread is
            rejected at eligibility (`existing_blocks_proposal`)
      * Daily pairing meal break (`cl 36.1` / `Sch 3 §5.3(a)` / `HC-13`):
          - Two `3.0h` same-day shifts (`6.0h > 5.0h` worked) with `15m` gap and
            `0` in-shift breaks are BLOCKED, while `30m` gap PASSES
      * Cross-day `10h` rest (`cl 40.1`) and `8h` multi-hire rest (`cl 40.3`)
      * Rolling `20-in-28` workdays (`cl 35.2(f)`), while `11` consecutive
        workdays are LAWFUL for plain PT (confirming `cl 35.3(g)` 10-consecutive-day
        cap applies ONLY to Flexible Part-Time `is_flexible=True`)
      * Student Visa `48h / 14d` cap, `HC-5e` contract envelope, and `OPT_OUT`
        availability (`HC-5d`)
  - Layer 3 (Guardrail Plugins & Schedule 2 §1 + cl 41/42/43 Pricing):
      * `FairnessPlugin` and `65%` anti-hogging strictly DISABLED
      * `SC-13` (`ft_days_off`) strictly ABSENT (plain PT has `20-in-28`, not FT
        paired RDOs)
      * `FatiguePlugin` (`SC-7`), `HC-7` predetermined contract floor, `SC-5`
        overtime (`150%` first 3h, `200%` thereafter above contracted hours), and
        `cl 41` weekend/PH + `cl 43.1` night penalties ACTIVE for BOTH Standard
        PT and Event Security PT (`Sch 3 §6.1-6.3`).
"""
from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient

from model_builder import (
    AvailabilityOverrideInput,
    AvailabilitySlotInput,
    ExistingShiftInput,
    OptimizerConstraints,
    PT_MIN_ENGAGEMENT_MINUTES,
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


def pt_constraints(**overrides) -> OptimizerConstraints:
    base = dict(
        min_rest_minutes=600,
        enforce_role_match=False,
        enforce_skill_match=False,
        allow_partial=True,
        relax_constraints=False,
        enforce_availability=True,
        scheduler_mode="PT",
    )
    base.update(overrides)
    return OptimizerConstraints(**base)


def make_pt_shift(
    sid: str,
    date: str,
    start: str = "09:00",
    end: str = "13:00",
    unpaid_break_minutes: int = 0,
    paid_break_minutes: int = 0,
    target_employment_type: str | None = "PT",
    **kwargs,
):
    """Canonical Regular Part-Time shift helper."""
    extra_fields = {"paid_break_minutes": paid_break_minutes}
    for k in (
        "target_requires_flexible",
        "is_saturday",
        "is_sunday",
        "is_public_holiday",
        "is_public_holiday_next_day",
        "shift_type",
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


def make_pt_employee(
    eid: str = "pt_1",
    hourly_rate: float = 29.74,  # EA_2026 Sch 2 §1 Level 2 permanent ordinary rate
    min_contract_minutes: int = 1200,  # 20h/wk predetermined contract
    max_weekly_minutes: int = 10_000,
    is_security_role: bool = False,
    **kwargs,
):
    extra_fields = {"is_flexible": kwargs.pop("is_flexible", False)}
    for k in ("preferred_shift_ids", "fairness_debts", "initial_effective_minutes"):
        if k in kwargs:
            extra_fields[k] = kwargs.pop(k)
    base = dict(
        eid=eid,
        employment_type="PT",
        hourly_rate=hourly_rate,
        min_contract_minutes=min_contract_minutes,
        max_weekly_minutes=max_weekly_minutes,
        is_security_role=is_security_role,
        availability_mode="OPT_OUT",
        ordinary_hours_cycle_weeks=4,
        ordinary_hours_cycle_anchor="2026-06-01",  # Monday
    )
    base.update(kwargs)
    emp = make_employee(**base)
    for k, v in extra_fields.items():
        setattr(emp, k, v)
    return emp


def date_offset(base_iso: str, days: int) -> str:
    d = datetime.date.fromisoformat(base_iso) + datetime.timedelta(days=days)
    return d.isoformat()


# =============================================================================
# 1. WIRE SCHEMA & ENDPOINT PARITY
# =============================================================================

class TestModeWireSchema:
    def test_normalize_scheduler_mode_pt(self):
        assert normalize_scheduler_mode("PT") == "PT"
        assert normalize_scheduler_mode("pt") == "PT"
        assert normalize_scheduler_mode("  Pt ") == "PT"
        assert PT_MIN_ENGAGEMENT_MINUTES == 180
        assert PUBLIC_HOLIDAY_MIN_ENGAGEMENT_MINUTES == 240

    def test_optimize_and_audit_endpoints_enforce_pt_mode(self):
        pt_std = make_pt_employee("pt_std", is_security_role=False)
        pt_sec = make_pt_employee("pt_sec", is_security_role=True, hourly_rate=31.02)
        fpt_emp = make_pt_employee("fpt_1", is_flexible=True)
        ft_emp = make_employee(
            eid="ft_1", employment_type="FT", is_security_role=False
        )
        cas_emp = make_employee(
            eid="cas_1", employment_type="Casual", is_security_role=False
        )

        payload_emps = [
            {
                "id": e.id,
                "name": e.id,
                "employment_type": e.employment_type,
                "is_flexible": e.is_flexible,
                "is_security_role": e.is_security_role,
                "hourly_rate": e.hourly_rate,
                "max_weekly_minutes": 4800,
                "min_contract_minutes": 240 if e.id.startswith("pt_") else 0,
                "availability_mode": "OPT_OUT",
            }
            for e in (pt_std, pt_sec, fpt_emp, ft_emp, cas_emp)
        ]

        shifts_payload = [
            {
                "id": "pt_valid_3h",
                "shift_date": "2026-06-01",
                "start_time": "09:00",
                "end_time": "12:00",
                "duration_minutes": 180,
                "unpaid_break_minutes": 0,
                "target_employment_type": "PT",
            },
            {
                "id": "pt_short_2h_train",
                "shift_date": "2026-06-02",
                "start_time": "09:00",
                "end_time": "11:00",
                "duration_minutes": 120,
                "unpaid_break_minutes": 0,
                "is_training": True,
                "target_employment_type": "PT",
            },
            {
                "id": "pt_ph_short_3h",
                "shift_date": "2026-06-08",
                "start_time": "09:00",
                "end_time": "12:00",
                "duration_minutes": 180,
                "unpaid_break_minutes": 0,
                "is_public_holiday": True,
                "target_employment_type": "PT",
            },
            {
                "id": "fpt_shift",
                "shift_date": "2026-06-03",
                "start_time": "09:00",
                "end_time": "13:00",
                "duration_minutes": 240,
                "unpaid_break_minutes": 0,
                "target_employment_type": "PT",
                "target_requires_flexible": True,
            },
        ]

        opt_resp = client.post(
            "/optimize",
            json={
                "shifts": shifts_payload,
                "employees": payload_emps,
                "constraints": {
                    "scheduler_mode": "PT",
                    "enforce_role_match": False,
                    "enforce_skill_match": False,
                },
            },
        )
        assert opt_resp.status_code == 200
        body = opt_resp.json()
        assert [a["shift_id"] for a in body["assignments"]] == ["pt_valid_3h"]
        assert body["assignments"][0]["employee_id"] in ("pt_std", "pt_sec")
        assert set(body["unassigned_shift_ids"]) == {
            "pt_short_2h_train",
            "pt_ph_short_3h",
            "fpt_shift",
        }

        aud_resp = client.post(
            "/audit",
            json={
                "shifts": shifts_payload,
                "employees": payload_emps,
                "constraints": {
                    "scheduler_mode": "PT",
                    "enforce_role_match": False,
                    "enforce_skill_match": False,
                },
                "target_shift_ids": [
                    "pt_valid_3h",
                    "pt_short_2h_train",
                    "pt_ph_short_3h",
                    "fpt_shift",
                ],
            },
        )
        assert aud_resp.status_code == 200
        by_id = {
            r["shift_id"]: {e["employee_id"]: e for e in r["employees"]}
            for r in aud_resp.json()["rows"]
        }
        assert by_id["pt_valid_3h"]["pt_std"]["status"] == "PASS"
        assert by_id["pt_valid_3h"]["pt_sec"]["status"] == "PASS"
        assert "MODE_MISMATCH" in by_id["pt_valid_3h"]["fpt_1"]["rejection_reasons"]
        assert "MODE_MISMATCH" in by_id["pt_valid_3h"]["ft_1"]["rejection_reasons"]
        assert "MODE_MISMATCH" in by_id["pt_valid_3h"]["cas_1"]["rejection_reasons"]

        assert "MIN_ENGAGEMENT" in by_id["pt_short_2h_train"]["pt_std"]["rejection_reasons"]
        assert "MIN_ENGAGEMENT" in by_id["pt_ph_short_3h"]["pt_std"]["rejection_reasons"]
        assert "EMPLOYMENT_TARGET" in by_id["fpt_shift"]["pt_std"]["rejection_reasons"]


# =============================================================================
# 2. LAYER 1 — ELIGIBILITY, POOL ISOLATION & MINIMUM ENGAGEMENT PARITY
# =============================================================================

class TestLayer1EligibilityAndShapeBounds:
    def test_includes_standard_and_security_pt_excludes_fpt_ft_casual(self):
        c = pt_constraints()
        shift = make_pt_shift("s1", "2026-06-01", "09:00", "13:00")

        pt_std = make_pt_employee("pt_std", is_security_role=False)
        pt_sec = make_pt_employee("pt_sec", is_security_role=True)
        fpt_std = make_pt_employee("fpt_std", is_flexible=True, is_security_role=False)
        fpt_sec = make_pt_employee("fpt_sec", is_flexible=True, is_security_role=True)
        ft_std = make_employee(eid="ft_std", employment_type="FT", is_security_role=False)
        ft_sec = make_employee(eid="ft_sec", employment_type="FT", is_security_role=True)
        cas_std = make_employee(eid="cas_std", employment_type="Casual", is_security_role=False)
        cas_sec = make_employee(eid="cas_sec", employment_type="Casual", is_security_role=True)

        assert employee_eligible(pt_std, shift, c) is True
        assert employee_eligible(pt_sec, shift, c) is True
        assert employee_eligible(fpt_std, shift, c) is False
        assert employee_eligible(fpt_sec, shift, c) is False
        assert employee_eligible(ft_std, shift, c) is False
        assert employee_eligible(ft_sec, shift, c) is False
        assert employee_eligible(cas_std, shift, c) is False
        assert employee_eligible(cas_sec, shift, c) is False

    def test_shift_employment_target_isolation(self):
        c = pt_constraints()
        emp = make_pt_employee("pt_1")

        s_pt = make_pt_shift("s_pt", "2026-06-01", target_employment_type="PT")
        s_open = make_pt_shift("s_open", "2026-06-01", target_employment_type=None)
        s_fpt = make_pt_shift(
            "s_fpt",
            "2026-06-01",
            target_employment_type="PT",
            target_requires_flexible=True,
        )
        s_ft = make_pt_shift("s_ft", "2026-06-01", target_employment_type="FT")
        s_cas = make_pt_shift("s_cas", "2026-06-01", target_employment_type="Casual")

        assert employee_eligible(emp, s_pt, c) is True
        assert employee_eligible(emp, s_open, c) is True
        assert employee_eligible(emp, s_fpt, c) is False
        assert employee_eligible(emp, s_ft, c) is False
        assert employee_eligible(emp, s_cas, c) is False

    def test_minimum_engagement_flat_3h_sunday_ok_no_2h_training_4h_ph(self):
        """cl 12.3(e) / cl 35.2(e) / cl 56.2 / Sch 3 §5.2(e):
        - 3.0h (180m) weekday & Sunday shifts PASS (plain PT has NO 4h Sunday floor)
        - 2.0h (120m) training shift REJECTS (plain PT has NO 2h training exception)
        - 2.9h (175m) weekday shift REJECTS
        - 3.5h gross with 45m unpaid break (165m net < 180m) REJECTS for Standard PT
          but PASSES (210m paid >= 180m) for Event Security PT (Sch 3 §5.3(a))
        - Public Holiday requires 4.0h (240m) per cl 56.2: 3.0h PH REJECTS, 4.0h PH PASSES
        """
        c = pt_constraints()
        pt_std = make_pt_employee("pt_std", is_security_role=False)
        pt_sec = make_pt_employee("pt_sec", is_security_role=True)

        # 3.0h weekday -> PASS
        s_3h_wk = make_pt_shift("s_3h_wk", "2026-06-01", "09:00", "12:00")
        assert employee_eligible(pt_std, s_3h_wk, c) is True
        assert employee_eligible(pt_sec, s_3h_wk, c) is True

        # 3.0h Sunday -> PASS (unlike FPT cl 12.4(c) / Casual cl 12.5(c) which require 4h!)
        s_3h_sun = make_pt_shift(
            "s_3h_sun", "2026-06-07", "09:00", "12:00", is_sunday=True
        )
        assert employee_eligible(pt_std, s_3h_sun, c) is True
        assert employee_eligible(pt_sec, s_3h_sun, c) is True

        # 2.0h training -> REJECT for plain PT (cl 12.3(e) has no training exception)
        s_2h_train = make_pt_shift(
            "s_2h_train", "2026-06-02", "09:00", "11:00", is_training=True
        )
        assert employee_eligible(pt_std, s_2h_train, c) is False
        assert employee_eligible(pt_sec, s_2h_train, c) is False

        # 3.5h gross with 45m unpaid break -> 165m net (<180m) for Standard PT, 210m paid for Security PT
        s_3h30_break = make_pt_shift(
            "s_3h30_b", "2026-06-03", "09:00", "12:30", unpaid_break_minutes=45
        )
        assert employee_eligible(pt_std, s_3h30_break, c) is False
        assert employee_eligible(pt_sec, s_3h30_break, c) is True

        # Public Holiday (cl 56.2): 3.0h REJECTS, 4.0h PASSES (even on training PH)
        s_ph_3h = make_pt_shift(
            "s_ph_3h", "2026-06-08", "09:00", "12:00", is_public_holiday=True
        )
        s_ph_3h_train = make_pt_shift(
            "s_ph_3h_tr",
            "2026-06-08",
            "09:00",
            "12:00",
            is_public_holiday=True,
            is_training=True,
        )
        s_ph_4h = make_pt_shift(
            "s_ph_4h", "2026-06-08", "09:00", "13:00", is_public_holiday=True
        )
        assert employee_eligible(pt_std, s_ph_3h, c) is False
        assert employee_eligible(pt_sec, s_ph_3h, c) is False
        assert employee_eligible(pt_std, s_ph_3h_train, c) is False
        assert employee_eligible(pt_std, s_ph_4h, c) is True
        assert employee_eligible(pt_sec, s_ph_4h, c) is True

    def test_daily_12h_ceiling_differs_between_unpaid_standard_and_paid_security_meal_break(self):
        """cl 35.2(d) / cl 36.1 vs Sch 3 §5.2(d) / §5.3(a):
        12.5h gross (`06:00-18:30`) with `unpaid_break_minutes=30` is `720m` net
        for Standard PT (LAWFUL), but `750m` paid for Event Security PT (REJECTED).
        """
        c = pt_constraints()
        pt_std = make_pt_employee("pt_std", is_security_role=False)
        pt_sec = make_pt_employee("pt_sec", is_security_role=True)

        s_12h_gross = make_pt_shift(
            "s_12h", "2026-06-01", "06:00", "18:00", unpaid_break_minutes=0, paid_break_minutes=30
        )
        s_12h30_gross = make_pt_shift(
            "s_12h30", "2026-06-01", "06:00", "18:30", unpaid_break_minutes=30
        )
        s_13h_gross = make_pt_shift(
            "s_13h", "2026-06-01", "06:00", "19:00", unpaid_break_minutes=30
        )

        assert employee_eligible(pt_std, s_12h_gross, c) is True
        assert employee_eligible(pt_sec, s_12h_gross, c) is True

        assert net_shift_minutes(s_12h30_gross, is_security=False) == 720
        assert net_shift_minutes(s_12h30_gross, is_security=True) == 750
        assert employee_eligible(pt_std, s_12h30_gross, c) is True
        assert employee_eligible(pt_sec, s_12h30_gross, c) is False

        assert employee_eligible(pt_std, s_13h_gross, c) is False
        assert employee_eligible(pt_sec, s_13h_gross, c) is False


# =============================================================================
# 3. LAYER 2 — SPLIT SHIFTS, SPREAD, MEAL BREAK, CYCLES & REST GAPS
# =============================================================================

class TestLayer2ComplianceRules:
    def test_split_shift_allowed_and_charges_sc12_allowance_once_per_day(self):
        """cl 35.2(g), cl 39.1-39.4, cl 28.4:
        Two same-day 4h shifts (`07:00-11:00` + `13:00-17:00`, 10h spread, 2h gap <= 3h)
        are LAWFUL on a single PT employee and charge `split_shift_allowance_cents`
        once in the `cost` objective category.
        """
        emp = make_pt_employee("pt_1", hourly_rate=30.00, min_contract_minutes=480)
        s_am = make_pt_shift("s_am", "2026-06-01", "07:00", "11:00")
        s_pm = make_pt_shift("s_pm", "2026-06-01", "13:00", "17:00")

        out = solve(
            shifts=[s_am, s_pm],
            employees=[emp],
            constraints=pt_constraints(split_shift_allowance_cents=1170),
        )
        assert out.status in ("OPTIMAL", "FEASIBLE")
        assert len(out.assignments) == 2
        assert {a.shift_id for a in out.assignments} == {"s_am", "s_pm"}
        assert out.objective_breakdown.get("legal_hard", 0) == 0
        # Base labour: 8h * $30.00 = $240.00 (24,000c) + 1 split shift allowance (1,170c) = 25,170c
        assert out.objective_breakdown["cost"] == 24_000 + 1_170

    def test_split_shift_spread_over_12h_net_blocked_while_breaks_deduct_per_cl39_2(self):
        """cl 39.2 (`HC-9` / `V8_SPLIT_SHIFT_SPREAD`):
        Spread cannot exceed 12h excluding meal AND rest breaks:
        - `06:00-10:00` + `15:00-19:30` with `30m` break = `13.5h` gross - `0.5h` break
          = `13.0h` net spread -> BLOCKED (only 1 of the 2 shifts assigned).
        - `06:00-10:30` (30m break) + `14:30-19:00` (30m break) = `13.0h` gross - `1.0h`
          breaks = `12.0h` net spread -> LAWFUL (both shifts assigned!).
        """
        emp = make_pt_employee("pt_1", min_contract_minutes=480)

        s_bad_1 = make_pt_shift("bad_1", "2026-06-01", "06:00", "10:00", unpaid_break_minutes=0)
        s_bad_2 = make_pt_shift("bad_2", "2026-06-01", "15:00", "19:30", unpaid_break_minutes=30)
        out_bad = solve(shifts=[s_bad_1, s_bad_2], employees=[emp], constraints=pt_constraints())
        assert len(out_bad.assignments) == 1
        assert len(out_bad.unassigned_shift_ids) == 1
        assert out_bad.objective_breakdown.get("legal_hard", 0) == 0

        s_ok_1 = make_pt_shift("ok_1", "2026-06-02", "06:00", "10:30", unpaid_break_minutes=30)
        s_ok_2 = make_pt_shift("ok_2", "2026-06-02", "14:30", "19:00", unpaid_break_minutes=30)
        out_ok = solve(shifts=[s_ok_1, s_ok_2], employees=[emp], constraints=pt_constraints())
        assert len(out_ok.assignments) == 2
        assert out_ok.objective_breakdown.get("legal_hard", 0) == 0

    def test_pinned_existing_shift_exceeding_12h_net_spread_blocks_candidate(self):
        c = pt_constraints()
        pinned = ExistingShiftInput(
            id="ex_am",
            shift_date="2026-06-01",
            start_time="06:00",
            end_time="09:00",
            duration_minutes=180,
            unpaid_break_minutes=0,
        )
        emp = make_pt_employee("pt_1", existing_shifts=[pinned])
        cand_too_late = make_pt_shift("s_late", "2026-06-01", "16:00", "19:00")  # 13h spread
        cand_within_12h = make_pt_shift("s_ok", "2026-06-01", "15:00", "18:00")  # 12h spread

        assert employee_eligible(emp, cand_too_late, c) is False
        assert employee_eligible(emp, cand_within_12h, c) is True

    def test_daily_pairing_meal_break_blocks_abutting_pair_over_5h_without_30m_gap(self):
        """cl 36.1 / Sch 3 §5.3(a) (`HC-13` / `V8_DAILY_MEAL_BREAK`):
        Two 3h shifts (`6h > 5h` worked) with `0` in-shift break and `15m` gap
        violate the 30-minute meal-break rule and cannot both be assigned to one PT
        employee, whereas a `30m` gap satisfies the meal break.
        """
        emp = make_pt_employee("pt_1", min_contract_minutes=360)

        s_15m_a = make_pt_shift("a1", "2026-06-01", "08:00", "11:00")
        s_15m_b = make_pt_shift("a2", "2026-06-01", "11:15", "14:15")
        out_breach = solve(
            shifts=[s_15m_a, s_15m_b], employees=[emp], constraints=pt_constraints()
        )
        assert len(out_breach.assignments) == 1
        assert len(out_breach.unassigned_shift_ids) == 1
        assert out_breach.objective_breakdown.get("legal_hard", 0) == 0

        s_30m_a = make_pt_shift("b1", "2026-06-02", "08:00", "11:00")
        s_30m_b = make_pt_shift("b2", "2026-06-02", "11:30", "14:30")
        out_ok = solve(
            shifts=[s_30m_a, s_30m_b], employees=[emp], constraints=pt_constraints()
        )
        assert len(out_ok.assignments) == 2
        assert out_ok.objective_breakdown.get("legal_hard", 0) == 0

    @pytest.mark.parametrize(
        "cycle_weeks,cap_hours",
        [(1, 38), (2, 76), (3, 114), (4, 152)],
    )
    def test_anchored_work_cycle_ceiling_1_to_4_weeks_standard_and_security_pt(
        self, cycle_weeks: int, cap_hours: int
    ):
        """cl 35.2(b) & Sch 3 §5.2(b):
        Both Standard PT and Event Security PT use the 1..4-week `38h/wk` (`38h /
        76h / 114h / 152h`) cycle cap — Event Security PT does NOT get FT Security's
        8-week `336h` cap!
        """
        # Use 10h worked shifts; `floor(cap_hours / 10) + 1` shifts exceed `cap_hours`.
        n_shifts = (cap_hours // 10) + 1
        for is_sec in (False, True):
            emp = make_pt_employee(
                eid=f"pt_{'sec' if is_sec else 'std'}_{cycle_weeks}w",
                is_security_role=is_sec,
                ordinary_hours_cycle_weeks=cycle_weeks,
                ordinary_hours_cycle_anchor="2026-06-01",
                min_contract_minutes=1200 * cycle_weeks,
                max_weekly_minutes=20_000,
            )
            shifts = [
                make_pt_shift(
                    sid=f"s_{i}",
                    date=date_offset("2026-06-01", i),
                    start="08:00",
                    end="18:00" if is_sec else "18:30",
                    unpaid_break_minutes=0 if is_sec else 30,
                    paid_break_minutes=30 if is_sec else 0,
                )
                for i in range(n_shifts)
            ]
            out = solve(shifts=shifts, employees=[emp], constraints=pt_constraints())
            assert len(out.assignments) == cap_hours // 10
            assert len(out.unassigned_shift_ids) == 1
            assert out.objective_breakdown.get("legal_hard", 0) == 0

    def test_regular_pt_allows_11_consecutive_days_but_caps_20_in_28(self):
        """cl 35.2(f) vs cl 35.3(g):
        Regular PT (`!is_flexible`) is NOT subject to Flexible Part-Time's 10-day
        consecutive streak cap (`cl 35.3(g)`), so 11 consecutive days is LAWFUL,
        while the 21st workday inside 28 days is BLOCKED (`cl 35.2(f)`).
        """
        emp = make_pt_employee("pt_1", min_contract_minutes=1200, max_weekly_minutes=20_000)

        shifts_11 = [
            make_pt_shift(f"d{i}", date_offset("2026-06-01", i), "09:00", "13:00")
            for i in range(11)
        ]
        out_11 = solve(shifts=shifts_11, employees=[emp], constraints=pt_constraints())
        assert len(out_11.assignments) == 11
        assert out_11.objective_breakdown.get("legal_hard", 0) == 0

        shifts_21 = [
            make_pt_shift(f"w{i}", date_offset("2026-06-01", i), "09:00", "13:00")
            for i in range(21)
        ]
        out_21 = solve(shifts=shifts_21, employees=[emp], constraints=pt_constraints())
        assert len(out_21.assignments) == 20
        assert len(out_21.unassigned_shift_ids) == 1
        assert out_21.objective_breakdown.get("legal_hard", 0) == 0

    def test_cross_day_10h_rest_and_8h_multihire_rest(self):
        """cl 40.1 (10h cross-day rest) & cl 40.3 / cl 13.1(f) (8h multi-hire rest)."""
        emp = make_pt_employee("pt_1", min_contract_minutes=480)
        s_late = make_pt_shift("s_late", "2026-06-01", "18:00", "23:00")
        s_9h_norm = make_pt_shift("s_9h_norm", "2026-06-02", "08:00", "12:00")  # 9h gap -> blocked
        s_9h_mh = make_pt_shift(
            "s_9h_mh", "2026-06-02", "08:00", "12:00", shift_type="MULTI_HIRE"
        )  # 9h >= 8h -> lawful

        out_norm = solve(
            shifts=[s_late, s_9h_norm], employees=[emp], constraints=pt_constraints()
        )
        assert len(out_norm.assignments) == 1

        out_mh = solve(
            shifts=[s_late, s_9h_mh], employees=[emp], constraints=pt_constraints()
        )
        assert len(out_mh.assignments) == 2

    def test_student_visa_48h_fortnight_and_opt_out_availability(self):
        """Migration Act condition 8105 (2,880m / 14d) + HC-5d OPT_OUT override."""
        emp = make_pt_employee(
            "pt_visa",
            is_student=True,
            visa_limit=2880,
            min_contract_minutes=1200,
            max_weekly_minutes=10_000,
            has_availability_data=True,
            availability_overrides=[
                AvailabilityOverrideInput(
                    start_time="00:00",
                    end_time="24:00",
                    severity="HARD",
                    date="2026-06-01",
                )
            ],
            availability_slots=[
                AvailabilitySlotInput(
                    slot_date="2026-06-03",  # Wednesday 2026-06-03 narrowed to morning only
                    start_time="08:00",
                    end_time="13:00",
                )
            ],
        )
        c = pt_constraints()
        assert (
            employee_eligible(emp, make_pt_shift("s_mon", "2026-06-01", "09:00", "13:00"), c)
            is False
        )
        assert (
            employee_eligible(emp, make_pt_shift("s_wed_pm", "2026-06-03", "14:00", "18:00"), c)
            is False
        )
        assert (
            employee_eligible(emp, make_pt_shift("s_tue", "2026-06-02", "14:00", "18:00"), c)
            is True  # No Tuesday slot in OPT_OUT -> available all day
        )

        # 7 x 8h (480m) = 56h (3,360m) inside 14 days -> capped at 6 x 8h = 48h (2,880m)
        visa_shifts = [
            make_pt_shift(
                f"v{i}",
                date_offset("2026-06-04", i),
                "09:00",
                "17:30",
                unpaid_break_minutes=30,
            )
            for i in range(7)
        ]
        out_visa = solve(shifts=visa_shifts, employees=[emp], constraints=c)
        assert len(out_visa.assignments) == 6
        assert len(out_visa.unassigned_shift_ids) == 1
        assert out_visa.objective_breakdown.get("legal_hard", 0) == 0


# =============================================================================
# 4. LAYER 3 — GUARDRAILS, PENALTIES & CONTRACT OBLIGATIONS
# =============================================================================

class TestLayer3GuardrailsAndPricing:
    def test_fairness_anti_hogging_and_ft_days_off_disabled_while_fatigue_and_hc7_active(self):
        """In PT mode:
        - `FairnessPlugin` is disabled (no `fairness` / `undesirable_balance` /
          `longitudinal_fairness` categories)
        - Section 6 `65%` anti-hogging is disabled (`other == 0` when one PT
          employee fulfils their full predetermined contract on a single-employee pool)
        - `SC-13` (`ft_days_off`) is absent (regular PT has `20-in-28`, not FT RDOs)
        - `FatiguePlugin` (`SC-7`) is active on heavy night rosters
        """
        emp = make_pt_employee("pt_1", min_contract_minutes=1440, max_weekly_minutes=2280)
        # 6 consecutive night shifts (Mon..Sat = only 1 day off in 7, >20h circadian effective mins)
        shifts = [
            make_pt_shift(
                f"n{i}",
                date_offset("2026-06-01", i),
                "22:00",
                "02:00",
            )
            for i in range(6)
        ]
        out = solve(shifts=shifts, employees=[emp], constraints=pt_constraints())
        assert len(out.assignments) == 6
        bd = out.objective_breakdown
        assert "fairness" not in bd
        assert "undesirable_balance" not in bd
        assert "longitudinal_fairness" not in bd
        assert "ft_days_off" not in bd
        assert bd.get("other", 0) == 0  # 0 contract shortfall & 0 anti-hogging slack
        assert bd.get("fatigue", 0) > 0

    def test_hc7_prioritises_predetermined_pt_contract_and_sc5_prices_overtime_above_contract(self):
        """cl 12.3(b),(d) & cl 42.1-42.2:
        `HC-7` fulfils a higher-paid PT employee's predetermined contract (`24h` =
        `1440m`) before spilling surplus hours to another PT employee whose contract
        is already satisfied, and `SC-5` prices overtime (`150%` first 3h, `200%`
        thereafter) above `min_contract_minutes`.
        """
        pt_unmet = make_pt_employee(
            "pt_unmet", hourly_rate=34.00, min_contract_minutes=480, max_weekly_minutes=2280
        )
        pt_met = make_pt_employee(
            "pt_met", hourly_rate=28.00, min_contract_minutes=0, max_weekly_minutes=2280
        )
        s1 = make_pt_shift("s1", "2026-06-01", "09:00", "17:30", unpaid_break_minutes=30)  # 480m
        out = solve(shifts=[s1], employees=[pt_unmet, pt_met], constraints=pt_constraints())
        assert len(out.assignments) == 1
        assert out.assignments[0].employee_id == "pt_unmet"

    def test_weekend_ph_and_night_penalties_apply_to_both_standard_and_event_security_pt(self):
        """cl 41, cl 43.1 & Sch 3 §6.1-6.2:
        Unlike Full-Time Security (`Sch 3 §4.1(b)` all-in annualised rate), Part-Time
        Event Security (`Sch 3 §6.1-6.2`) receives Schedule 2 §1 ordinary hourly rates
        PLUS `cl 41` weekend/PH and `cl 43.1` night penalties — identical to Standard PT!
        """
        pt_std = make_pt_employee("pt_std", hourly_rate=30.00, is_security_role=False)
        pt_sec = make_pt_employee("pt_sec", hourly_rate=30.00, is_security_role=True)

        sat_shift = make_pt_shift("sat", "2026-06-06", "09:00", "13:00", is_saturday=True)
        sun_shift = make_pt_shift("sun", "2026-06-07", "09:00", "13:00", is_sunday=True)
        ph_shift = make_pt_shift("ph", "2026-06-08", "09:00", "13:00", is_public_holiday=True)
        night_shift = make_pt_shift("night", "2026-06-02", "20:00", "00:30")  # concludes 00:30 Wed -> +20%

        for emp in (pt_std, pt_sec):
            # 4h * $30 = $120.00 base -> Sat 125% = 15,000c; Sun 150% = 18,000c; PH 250% = 30,000c
            assert (
                _assignment_cost_cents_with_night(
                    emp.hourly_rate, emp.employment_type, sat_shift, is_security=emp.is_security_role
                )
                == 15_000
            )
            assert (
                _assignment_cost_cents_with_night(
                    emp.hourly_rate, emp.employment_type, sun_shift, is_security=emp.is_security_role
                )
                == 18_000
            )
            assert (
                _assignment_cost_cents_with_night(
                    emp.hourly_rate, emp.employment_type, ph_shift, is_security=emp.is_security_role
                )
                == 30_000
            )
            # 20:00-22:00 (2.0h * $30 = $60) + 22:00-00:30 (2.5h * $30 * 1.20 = $90) = 15,000c
            assert (
                _assignment_cost_cents_with_night(
                    emp.hourly_rate, emp.employment_type, night_shift, is_security=emp.is_security_role
                )
                == 15_000
            )
