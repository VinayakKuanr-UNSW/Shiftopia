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
)
from ortools_runner import ConstraintsReq

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


@pytest.mark.parametrize('bad', [{'saturday_loading': -0.1}, {'overtime_first_multiplier': 0.5}, {'casual_loading': 'x'}])
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
