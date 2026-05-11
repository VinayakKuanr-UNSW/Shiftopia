"""
Schema-drift contract tests.

The optimizer service has THREE definitions of every input shape:
  1. Pydantic models in `ortools_runner.py` (HTTP-boundary validation)
  2. Dataclass models in `model_builder.py` (solver internals)
  3. TypeScript interfaces in `src/modules/scheduling/types.ts` (browser)

Without enforcement, adding a new field requires synchronized edits in
all three places. We've already lost time to drift — `availability_slots`
was added in three places this session, and a future field will be
forgotten.

This test pins (1) and (2) together by asserting their field names are
identical. The TS side is covered by a separate Vitest test that loads
the JSON snapshot exported below.

When this test fires:
  - if you added a field to the pydantic model, mirror it in the
    corresponding dataclass (and add a default).
  - if you added a field to the dataclass, mirror it in the pydantic
    model.
  - then run `python scripts/dump_schema.py` to regenerate the
    snapshot file consumed by the TS test.
"""
from __future__ import annotations

import dataclasses

import pytest
from pydantic import BaseModel

from model_builder import (
    AvailabilitySlotInput,
    EmployeeInput,
    ExistingShiftInput,
    OptimizerConstraints as OptimizerConstraintsDC,
    ShiftInput,
    SolverParameters as SolverParametersDC,
    StrategyInput as StrategyInputDC,
)
from ortools_runner import (
    AvailabilitySlotReq,
    ConstraintsReq,
    EmployeeReq,
    ExistingShiftReq,
    ShiftReq,
    SolverParamsReq,
    StrategyReq,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pydantic_fields(model: type[BaseModel]) -> set[str]:
    return set(model.model_fields.keys())


def _dataclass_fields(cls: type) -> set[str]:
    return {f.name for f in dataclasses.fields(cls)}


# ---------------------------------------------------------------------------
# Pairwise contract tests — pydantic ↔ dataclass
# ---------------------------------------------------------------------------

PAIRS: list[tuple[type[BaseModel], type, str]] = [
    (ShiftReq, ShiftInput, "Shift"),
    (EmployeeReq, EmployeeInput, "Employee"),
    (ExistingShiftReq, ExistingShiftInput, "ExistingShift"),
    (AvailabilitySlotReq, AvailabilitySlotInput, "AvailabilitySlot"),
    (ConstraintsReq, OptimizerConstraintsDC, "Constraints"),
    (StrategyReq, StrategyInputDC, "Strategy"),
    (SolverParamsReq, SolverParametersDC, "SolverParameters"),
]


@pytest.mark.parametrize("pydantic_cls,dataclass_cls,name", PAIRS)
def test_pydantic_dataclass_fields_match(pydantic_cls, dataclass_cls, name):
    """Every field on the pydantic boundary type must have a corresponding
    field on the dataclass solver type, and vice versa.

    Internal solver-only fields (e.g. `initial_fatigue_score` which the
    solver uses but the HTTP API doesn't expose) are listed in
    SOLVER_ONLY_FIELDS below. Adding to that list is a deliberate
    decision to widen the gap and should require code review.
    """
    pyd = _pydantic_fields(pydantic_cls)
    dc = _dataclass_fields(dataclass_cls)

    only_pyd = pyd - dc
    only_dc = dc - pyd - SOLVER_ONLY_FIELDS.get(name, set())

    assert not only_pyd, (
        f"[{name}] pydantic-only fields (need to add to dataclass): {sorted(only_pyd)}"
    )
    assert not only_dc, (
        f"[{name}] dataclass-only fields (need to add to pydantic OR list "
        f"in SOLVER_ONLY_FIELDS with explanation): {sorted(only_dc)}"
    )


# Fields that intentionally exist only on the solver-internal dataclass
# and are NOT exposed on the HTTP boundary. Each entry must have a
# justification.
SOLVER_ONLY_FIELDS: dict[str, set[str]] = {
    # `initial_fatigue_score` is computed by the TS controller from the
    # employee's recent shift history and stored on the EmployeeInput
    # dataclass for use by the SC-7 fatigue penalty. It IS sent over the
    # wire — it's just declared via the `**det` spread in the controller
    # (see auto-scheduler.controller.ts:441). Pydantic accepts unknown
    # extras silently, so the field reaches the dataclass through extra-
    # field forwarding rather than an explicit pydantic schema entry.
    # If we ever tighten pydantic to forbid extras, this must move into
    # the explicit schema.
    "Employee": {"initial_fatigue_score"},
    "ExistingShift": {"start_abs", "end_abs"},  # computed in shift_window()
}
