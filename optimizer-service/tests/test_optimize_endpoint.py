"""
HTTP-level tests for POST /optimize.

The solver itself is covered by ~200 tests that call ScheduleModelBuilder
directly. What those cannot see is the HTTP boundary: request validation,
the pydantic → dataclass mapping in the handler, and the response model the
browser's optimizer.client.ts reads. Before these tests, no test asserted a
200 from /optimize at all — the auth tests stop at the 400 an empty body
gets once the token is accepted.

These lock in:
  * a solvable request returns 200 with the assignment in the response model
  * an unfillable shift comes back in `unassigned_shift_ids`, not as an error
  * malformed or empty input is refused with HTTP 400

Run from optimizer-service/:
    python -m pytest tests/test_optimize_endpoint.py -v
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from ortools_runner import OptimizeRes, app


client = TestClient(app)


def _shift(sid="s1", date="2026-05-15", start="09:00", end="17:00",
           role_id="role-A", duration=480):
    return {
        "id": sid, "shift_date": date, "start_time": start, "end_time": end,
        "duration_minutes": duration, "role_id": role_id, "priority": 1,
        "level": 0, "is_training": False, "unpaid_break_minutes": 0,
    }


def _employee(eid="e1", contracted_role_ids=None):
    return {
        "id": eid, "name": f"E-{eid}", "employment_type": "FT",
        "hourly_rate": 25.65, "min_contract_minutes": 0,
        "max_weekly_minutes": 2400, "level": 0,
        "contracted_role_ids": contracted_role_ids or ["role-A"],
        "existing_shifts": [],
        "has_availability_data": False,
        "availability_slots": [],
    }


# ---------------------------------------------------------------------------

def test_optimize_assigns_the_only_eligible_employee():
    res = client.post("/optimize", json={
        "shifts": [_shift()],
        "employees": [_employee()],
    })
    assert res.status_code == 200, res.text

    body = res.json()
    # The whole body must satisfy the declared response model — this is the
    # shape optimizer.client.ts consumes.
    OptimizeRes.model_validate(body)

    assert body["status"] in ("OPTIMAL", "FEASIBLE")
    assert [(a["shift_id"], a["employee_id"]) for a in body["assignments"]] == [("s1", "e1")]
    assert body["assignments"][0]["cost"] > 0
    assert body["unassigned_shift_ids"] == []
    assert body["debug"]["coverage_rate"] == 1.0


def test_optimize_returns_unfillable_shift_as_unassigned_not_error():
    res = client.post("/optimize", json={
        "shifts": [_shift(role_id="role-A")],
        "employees": [_employee(contracted_role_ids=["role-B"])],
        "constraints": {"enforce_role_match": True, "allow_partial": True},
    })
    assert res.status_code == 200, res.text

    body = res.json()
    assert body["assignments"] == []
    assert body["unassigned_shift_ids"] == ["s1"]
    assert body["debug"]["eligible_pairs"] == 0


def test_optimize_rejects_shift_missing_required_fields():
    res = client.post("/optimize", json={
        "shifts": [{"id": "s1"}],
        "employees": [_employee()],
    })
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail.startswith("Validation Error")
    for field in ("shift_date", "start_time", "end_time", "duration_minutes"):
        assert field in detail


def test_optimize_rejects_empty_employee_list():
    res = client.post("/optimize", json={"shifts": [_shift()], "employees": []})
    assert res.status_code == 400
    assert res.json()["detail"] == "employees list is empty"


def test_optimize_rejects_more_than_5000_shifts():
    res = client.post("/optimize", json={
        "shifts": [_shift(sid=f"s{i}") for i in range(5001)],
        "employees": [_employee()],
    })
    assert res.status_code == 400
    assert res.json()["detail"] == "Max 5000 shifts per request"
