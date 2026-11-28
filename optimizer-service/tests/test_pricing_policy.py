"""
The solver prices from the organization's rate card (Phase 4).

`ConstraintsReq.pricing_policy` carries the card's numeric loadings
(`pay_rate_card_loadings`); every field defaults to ICC Sydney EA 2025, so a
caller that sends none — an older frontend build mid-deploy — prices exactly
as before. The rule STRUCTURE (cl 41.4 non-cumulative maximum, cl 43
conclusion-day night rule, Security annualised all-in) stays in code.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from .conftest import make_employee, make_shift, solve
from model_builder import (
    ICC_PRICING,
    OptimizerConstraints,
    PricingPolicy,
    _assignment_cost_cents_with_night,
    employee_eligible,
)
from ortools_runner import ConstraintsReq, _explain_eligibility

# The tables the solver hardcoded before rate cards (cl 41 / cl 43).
OLD_PERMANENT = {'public_holiday': 2.50, 'sunday': 1.50, 'saturday': 1.25}
OLD_CASUAL = {'public_holiday': 2.75, 'sunday': 1.75, 'saturday': 1.50}
OLD_PERMANENT_NIGHT = {0: 0.20, 1: 0.20, 2: 0.20, 3: 0.20, 4: 0.25, 5: 0.50, 6: 0.50}
OLD_CASUAL_NIGHT = {0: 0.45, 1: 0.45, 2: 0.45, 3: 0.45, 4: 0.50, 5: 0.75, 6: 0.75}


def _constraints(**wire) -> OptimizerConstraints:
    req = ConstraintsReq(**wire)
    return OptimizerConstraints(**{
        k: v for k, v in req.model_dump().items() if k in OptimizerConstraints.__dataclass_fields__
    })


def test_icc_defaults_reproduce_the_previous_tables_exactly():
    for day, mult in OLD_PERMANENT.items():
        assert ICC_PRICING.penalty_multiplier(day, casual=False) == pytest.approx(mult)
    for day, mult in OLD_CASUAL.items():
        assert ICC_PRICING.penalty_multiplier(day, casual=True) == pytest.approx(mult)
    for wd in range(7):
        assert ICC_PRICING.night_fraction(wd, casual=False) == pytest.approx(OLD_PERMANENT_NIGHT[wd])
        assert ICC_PRICING.night_fraction(wd, casual=True) == pytest.approx(OLD_CASUAL_NIGHT[wd])
    assert ICC_PRICING.casual_multiplier == pytest.approx(1.25)
    assert ICC_PRICING.overtime_tier1_minutes == 180
    assert ICC_PRICING.overtime_tier1_surcharge == pytest.approx(0.5)
    assert ICC_PRICING.overtime_tier2_surcharge == pytest.approx(1.0)


SATURDAY = make_shift("sat", date="2027-07-10", start="09:00", end="16:00")


def test_the_cards_saturday_loading_prices_a_casual_saturday():
    # $40 loaded = $32 ordinary. ICC: 7h x 32 x 1.50 = $336; at 40%: x 1.65 = $369.60.
    assert _assignment_cost_cents_with_night(40.0, 'Casual', SATURDAY) == 33600
    custom = PricingPolicy(saturday_loading=0.40)
    assert _assignment_cost_cents_with_night(40.0, 'Casual', SATURDAY, policy=custom) == 36960


def test_the_cards_casual_loading_deloads_the_rate():
    # $39 at a 30% casual loading = $30 ordinary; Saturday x (1.30 + 0.25) = 7h x $46.50.
    custom = PricingPolicy(casual_loading=0.30)
    assert _assignment_cost_cents_with_night(39.0, 'Casual', SATURDAY, policy=custom) == 32550


def test_the_cards_night_loading_prices_a_night():
    night = make_shift("tue", date="2027-07-06", start="22:00", end="23:00")  # concludes Tuesday
    assert _assignment_cost_cents_with_night(30.0, 'FT', night) == 3600          # x 1.20
    custom = PricingPolicy(night_loading_mon_thu=0.30)
    assert _assignment_cost_cents_with_night(30.0, 'FT', night, policy=custom) == 3900


def test_the_wire_defaults_to_icc_and_carries_a_card():
    assert _constraints().pricing_policy == ICC_PRICING
    c = _constraints(pricing_policy={'saturday_loading': 0.4, 'overtime_first_hours': 2})
    assert c.pricing_policy.saturday_loading == pytest.approx(0.4)
    assert c.pricing_policy.overtime_tier1_minutes == 120
    assert c.pricing_policy.sunday_loading == pytest.approx(ICC_PRICING.sunday_loading)


@pytest.mark.parametrize('bad', [
    {'saturday_loading': -0.1},
    {'overtime_first_multiplier': 0.5},
    {'casual_loading': 'x'},
    {'ordinary_daily_cap_hours': 0},
    {'security_ordinary_cap_hours': 25},
    {'min_engagement_minutes': 900},
    {'min_engagement_sunday_minutes': -1},
])
def test_the_wire_refuses_an_impossible_card(bad):
    with pytest.raises(ValidationError):
        ConstraintsReq(pricing_policy=bad)


def test_overtime_tiers_follow_the_card():
    custom = PricingPolicy(overtime_first_multiplier=1.75, overtime_after_multiplier=2.25)
    assert custom.overtime_tier1_surcharge == pytest.approx(0.75)
    assert custom.overtime_tier2_surcharge == pytest.approx(1.25)


def test_the_reported_cost_is_the_priced_cost_not_flat_hours_times_rate():
    emp = make_employee("cas", employment_type="Casual", hourly_rate=40.0)
    out = solve([SATURDAY], [emp])
    assert [a.cost for a in out.assignments] == [336.0]   # was 7h x $40 = $280 flat
    custom = OptimizerConstraints(
        min_rest_minutes=600, enforce_role_match=False, enforce_skill_match=False,
        allow_partial=True, pricing_policy={'saturday_loading': 0.40},
    )
    out = solve([SATURDAY], [emp], constraints=custom)
    assert [a.cost for a in out.assignments] == [369.6]


def test_daily_cap_thresholds_follow_the_card_in_eligibility_audit_and_hc6():
    # A card with a 10h general cap and 8h security cap.
    policy = {'ordinary_daily_cap_hours': 10.0, 'security_ordinary_cap_hours': 8.0}
    c_ft = _constraints(scheduler_mode='FT_STANDARD', pricing_policy=policy)
    c_sec = _constraints(scheduler_mode='FT_SECURITY', pricing_policy=policy)

    emp_ft = make_employee("ft1", employment_type="FT")
    emp_sec = make_employee("sec1", employment_type="FT", is_security_role=True)

    s_11h = make_shift("s11", date="2027-07-06", start="07:00", end="18:30", unpaid_break_minutes=30, target_employment_type="FT")
    s_10h = make_shift("s10", date="2027-07-06", start="07:00", end="17:30", unpaid_break_minutes=30, target_employment_type="FT")
    s_9h_sec = make_shift("s9s", date="2027-07-06", start="07:00", end="16:00", target_employment_type="FT")
    s_8h_sec = make_shift("s8s", date="2027-07-06", start="07:00", end="15:00", target_employment_type="FT")

    # Under default 12h cap both 11h FT and 9h Security pass.
    assert employee_eligible(emp_ft, s_11h, _constraints(scheduler_mode='FT_STANDARD'))
    assert employee_eligible(emp_sec, s_9h_sec, _constraints(scheduler_mode='FT_SECURITY'))

    # Under custom 10h/8h caps: 11h FT and 9h Security are rejected by both eligibility & /audit.
    assert not employee_eligible(emp_ft, s_11h, c_ft)
    assert 'MAX_DAILY_HOURS' in _explain_eligibility(emp_ft, s_11h, c_ft)
    assert employee_eligible(emp_ft, s_10h, c_ft)
    assert not employee_eligible(emp_sec, s_9h_sec, c_sec)
    assert 'MAX_DAILY_HOURS' in _explain_eligibility(emp_sec, s_9h_sec, c_sec)
    assert employee_eligible(emp_sec, s_8h_sec, c_sec)

    # HC-6 cumulative daily cap: two 6h shifts (12h total) on one day violate a 10h cap,
    # so the solver leaves the second shift uncovered rather than breaching Tier-0 legal slack.
    s_am = make_shift("am", date="2027-07-06", start="06:00", end="12:00", target_employment_type="Casual")
    s_pm = make_shift("pm", date="2027-07-06", start="13:00", end="19:00", target_employment_type="Casual")
    cas = make_employee("cas1", employment_type="Casual")
    c_cas = OptimizerConstraints(
        min_rest_minutes=600, enforce_role_match=False, enforce_skill_match=False,
        allow_partial=True, scheduler_mode='CASUAL', pricing_policy=policy,
    )
    out = solve([s_am, s_pm], [cas], constraints=c_cas)
    assert len(out.assignments) == 1
    assert len(out.unassigned_shift_ids) == 1


def test_min_engagement_thresholds_follow_the_card_across_modes_and_audit():
    policy = {
        'min_engagement_minutes': 240,                # 4h standard (up from 3h)
        'min_engagement_sunday_minutes': 300,         # 5h Sunday (up from 4h)
        'min_engagement_public_holiday_minutes': 360, # 6h PH (up from 4h)
        'min_engagement_training_minutes': 90,        # 1.5h training (down from 2h)
    }
    pt = make_employee("pt1", employment_type="PT")
    fpt = make_employee("fpt1", employment_type="PT")
    fpt.is_flexible = True
    cas = make_employee("cas1", employment_type="Casual")

    s_3h_mon = make_shift("m3", date="2027-07-05", start="09:00", end="12:00")
    s_4h_sun = make_shift("su4", date="2027-07-11", start="09:00", end="13:00")
    s_4h_sun.is_sunday = True
    s_5h_ph = make_shift("ph5", date="2027-07-05", start="09:00", end="14:00")
    s_5h_ph.is_public_holiday = True
    s_90m_tr = make_shift("tr90", date="2027-07-05", start="09:00", end="10:30", is_training=True)

    c_pt  = _constraints(scheduler_mode='PT', pricing_policy=policy)
    c_fpt = _constraints(scheduler_mode='FPT', pricing_policy=policy)
    c_cas = _constraints(scheduler_mode='CASUAL', pricing_policy=policy)

    # 3h Monday: passes ICC 180m, rejected under card's 240m.
    assert employee_eligible(pt, s_3h_mon, _constraints(scheduler_mode='PT'))
    assert not employee_eligible(pt, s_3h_mon, c_pt)
    assert 'MIN_ENGAGEMENT' in _explain_eligibility(pt, s_3h_mon, c_pt)
    assert not employee_eligible(cas, s_3h_mon, c_cas)
    assert 'MIN_ENGAGEMENT' in _explain_eligibility(cas, s_3h_mon, c_cas)

    # 4h Sunday: rejected under card's 300m Sunday floor for FPT/Casual.
    assert not employee_eligible(fpt, s_4h_sun, c_fpt)
    assert 'MIN_ENGAGEMENT' in _explain_eligibility(fpt, s_4h_sun, c_fpt)
    assert not employee_eligible(cas, s_4h_sun, c_cas)

    # 5h Public Holiday: rejected under card's 360m PH floor across PT/FPT/Casual.
    assert not employee_eligible(pt, s_5h_ph, c_pt)
    assert not employee_eligible(fpt, s_5h_ph, c_fpt)
    assert not employee_eligible(cas, s_5h_ph, c_cas)

    # 90m Training: fails ICC 120m, passes under card's 90m training floor.
    assert not employee_eligible(fpt, s_90m_tr, _constraints(scheduler_mode='FPT'))
    assert employee_eligible(fpt, s_90m_tr, c_fpt)
    assert _explain_eligibility(fpt, s_90m_tr, c_fpt) == []
    assert employee_eligible(cas, s_90m_tr, c_cas)
