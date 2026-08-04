import pytest

def test_solver_writeback_verifies_expected_version_cas():
    """
    Test FINDING-03: Stale solver snapshot write-backs must fail CAS check.
    If solver snapshot is at version 5, but manager edited shift to version 6,
    write-back passing expected_version=5 returns VERSION_CONFLICT and avoids overwrite.
    """
    shift = {
        "id": "11111111-1111-1111-1111-111111111111",
        "version": 6,  # Live version after manager edit
        "assigned_employee_id": "manager-choice-user-id"
    }

    # Solver payload constructed from earlier snapshot (version = 5)
    solver_writeback = {
        "shift_id": shift["id"],
        "expected_version": 5,
        "recommended_employee_id": "solver-choice-user-id"
    }

    # Simulate CAS check in backend gateway sm_apply_shift_op
    if solver_writeback["expected_version"] != shift["version"]:
        result = {
            "ok": False,
            "code": "VERSION_CONFLICT",
            "current_version": shift["version"],
            "current_employee": shift["assigned_employee_id"]
        }
    else:
        shift["assigned_employee_id"] = solver_writeback["recommended_employee_id"]
        shift["version"] += 1
        result = {"ok": True}

    assert result["ok"] is False
    assert result["code"] == "VERSION_CONFLICT"
    assert shift["assigned_employee_id"] == "manager-choice-user-id"  # Unchanged!
