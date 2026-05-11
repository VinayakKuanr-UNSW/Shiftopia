"""
Dump field-name snapshots for the optimizer's HTTP boundary types.

Writes `optimizer-service/schema-snapshot.json` — a flat list of
{ type-name → [field-name, ...] } that downstream consumers (the TS
schema-contract Vitest, future codegen, etc.) compare against their
local types.

Run from `optimizer-service/`:
    python scripts/dump_schema.py

The script is intentionally trivial: pydantic already knows every field;
we just serialize the names. Re-run whenever pydantic models change and
commit the resulting snapshot.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Make sibling modules importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ortools_runner import (  # noqa: E402
    AvailabilitySlotReq,
    ConstraintsReq,
    EmployeeReq,
    ExistingShiftReq,
    ShiftReq,
    SolverParamsReq,
    StrategyReq,
)


SNAPSHOT_TYPES = {
    "Shift": ShiftReq,
    "Employee": EmployeeReq,
    "ExistingShift": ExistingShiftReq,
    "AvailabilitySlot": AvailabilitySlotReq,
    "Constraints": ConstraintsReq,
    "Strategy": StrategyReq,
    "SolverParams": SolverParamsReq,
}


def main():
    snapshot = {
        name: sorted(cls.model_fields.keys())
        for name, cls in SNAPSHOT_TYPES.items()
    }

    out = Path(__file__).resolve().parent.parent / "schema-snapshot.json"
    out.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {out}")
    for name, fields in snapshot.items():
        print(f"  {name:20s} {len(fields)} fields")


if __name__ == "__main__":
    main()
