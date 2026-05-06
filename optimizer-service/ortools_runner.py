"""
OR-Tools FastAPI Optimization Service — v2 (Production)

Key improvements over v1:
  - Configurable solver time limit + worker threads
  - Full debug metrics in response (variables, constraints, coverage_rate, timing)
  - INFEASIBLE/UNKNOWN returns graceful response (not 500)
  - Request size guards (max 5000 shifts / 1000 employees)
  - Structured JSON logging

Start:
    pip install -r requirements.txt
    python ortools_runner.py

Or via Docker:
    docker compose up optimizer
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from model_builder import (
    ScheduleModelBuilder,
    OptimizerInput,
    ShiftInput,
    EmployeeInput,
    ExistingShiftInput,
    OptimizerConstraints,
    SolverParameters,
    StrategyInput,
)

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('ortools_runner')

# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class ShiftReq(BaseModel):
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    role_id: Optional[str] = None
    required_skill_ids: list[str] = Field(default_factory=list)
    required_license_ids: list[str] = Field(default_factory=list)
    priority: int = 1
    unpaid_break_minutes: int = 0
    target_employment_type: Optional[str] = None
    level: int = 0
    is_training: bool = False


class ExistingShiftReq(BaseModel):
    """A shift already committed to the employee. Pinned — the optimizer
    treats it as immutable when proposing new assignments."""
    id: str
    shift_date: str
    start_time: str
    end_time: str
    duration_minutes: int
    unpaid_break_minutes: int = 0


class EmployeeReq(BaseModel):
    id: str
    name: str
    role_id: Optional[str] = None
    employment_type: str = 'Casual'
    hourly_rate: float = 25.0
    max_weekly_minutes: int = 2400
    min_contract_minutes: int = 0
    skill_ids: list[str] = Field(default_factory=list)
    license_ids: list[str] = Field(default_factory=list)
    preferred_shift_ids: list[str] = Field(default_factory=list)
    unavailable_dates: list[str] = Field(default_factory=list)
    # Severity-based availability (dates or intervals)
    # [ (start_time, end_time, severity) ]
    availability_overrides: list[tuple[str, str, str]] = Field(default_factory=list)
    existing_shifts: list[ExistingShiftReq] = Field(default_factory=list)
    level: int = 0
    is_flexible: bool = False
    is_student: bool = False
    visa_limit: int = 2880
    contract_weekly_minutes: int = 2280


class ConstraintsReq(BaseModel):
    min_rest_minutes: int = 600
    enforce_role_match: bool = True
    enforce_skill_match: bool = True
    allow_partial: bool = True
    relax_constraints: bool = False


class StrategyReq(BaseModel):
    fatigue_weight: int = 50
    fairness_weight: int = 50
    cost_weight: int = 50
    coverage_weight: int = 100


class SolverParamsReq(BaseModel):
    max_time_seconds: float = 30.0
    num_workers: int = 8
    enable_greedy_hint: bool = True


class OptimizeReq(BaseModel):
    shifts: list[ShiftReq]
    employees: list[EmployeeReq]
    constraints: ConstraintsReq = Field(default_factory=ConstraintsReq)
    strategy: StrategyReq = Field(default_factory=StrategyReq)
    solver_params: SolverParamsReq = Field(default_factory=SolverParamsReq)


class DebugMetricsRes(BaseModel):
    raw_pairs: int
    eligible_pairs: int
    rest_eliminated_pairs: int
    final_variables: int
    num_constraints: int
    greedy_hint_applied: bool
    preprocess_ms: float
    solve_ms: float
    coverage_rate: float  # assignments / shifts


class AssignmentRes(BaseModel):
    shift_id: str
    employee_id: str
    employment_type: str
    cost: float


class OptimizeRes(BaseModel):
    status: str
    assignments: list[AssignmentRes]
    unassigned_shift_ids: list[str]
    objective_value: float
    best_objective_bound: float
    proven_optimal: bool
    debug: DebugMetricsRes


# =============================================================================
# APP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info('Superman OR-Tools optimizer service v2 started')
    yield
    logger.info('Superman OR-Tools optimizer service stopped')


app = FastAPI(
    title='Superman Workforce Optimizer v2',
    description=(
        'Production CP-SAT solver for shift assignment optimization.\n\n'
        'PROPOSALS ONLY — never writes to the database.\n'
        'TypeScript compliance engine validates every proposal before DB commit.'
    ),
    version='2.0.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # TODO: In production, replace '*' with specific frontend origins 
    # e.g. ['https://app.shiftopia.unsw.edu.au']
    allow_origins=['*'],
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)

# =============================================================================
# ROUTES
# =============================================================================

@app.get('/health')
def health_check():
    try:
        from ortools.sat.python import cp_model  # noqa: F401
        return {
            'status': 'ok',
            'engine': 'CP-SAT',
            'version': '2.0.0',
            'or_tools': 'available',
        }
    except ImportError:
        raise HTTPException(status_code=503, detail='OR-Tools not available')


@app.post('/optimize', response_model=OptimizeRes)
async def optimize(request: Request) -> OptimizeRes:
    """
    Run the CP-SAT optimizer and return proposed shift assignments.
    """
    try:
        raw_body = await request.json()
        logger.info("[optimize] Raw request body received")
        req = OptimizeReq(**raw_body)
    except Exception as e:
        logger.error("[optimize] Pydantic validation failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Validation Error: {e}")
    if not req.shifts:
        raise HTTPException(status_code=400, detail='shifts list is empty')
    if not req.employees:
        raise HTTPException(status_code=400, detail='employees list is empty')
    if len(req.shifts) > 5000:
        raise HTTPException(status_code=400, detail='Max 5000 shifts per request')
    if len(req.employees) > 1000:
        raise HTTPException(status_code=400, detail='Max 1000 employees per request')

    logger.info(
        '[optimize] %d shifts × %d employees | time_limit=%.1fs workers=%d hint=%s',
        len(req.shifts), len(req.employees),
        req.solver_params.max_time_seconds,
        req.solver_params.num_workers,
        req.solver_params.enable_greedy_hint,
    )

    try:
        def _build_employee(e: EmployeeReq) -> EmployeeInput:
            payload = e.model_dump()
            existing = [
                ExistingShiftInput(**{
                    k: v for k, v in es.items()
                    if k in ExistingShiftInput.__dataclass_fields__
                })
                for es in payload.pop('existing_shifts', []) or []
            ]
            return EmployeeInput(
                **{k: v for k, v in payload.items() if k in EmployeeInput.__dataclass_fields__ and k != 'existing_shifts'},
                existing_shifts=existing,
            )

        data = OptimizerInput(
            shifts=[ShiftInput(**{k: v for k, v in s.model_dump().items() if k in ShiftInput.__dataclass_fields__}) for s in req.shifts],
            employees=[_build_employee(e) for e in req.employees],
            constraints=OptimizerConstraints(**{k: v for k, v in req.constraints.model_dump().items() if k in OptimizerConstraints.__dataclass_fields__}),
            strategy=StrategyInput(**{k: v for k, v in req.strategy.model_dump().items() if k in StrategyInput.__dataclass_fields__}) if hasattr(req, 'strategy') else StrategyInput(),
            solver_params=SolverParameters(**{k: v for k, v in req.solver_params.model_dump().items() if k in SolverParameters.__dataclass_fields__}),
        )
        builder = ScheduleModelBuilder(data)
        output = builder.build_and_solve()
    except Exception as exc:
        logger.exception('[optimize] Unexpected error: %s', exc)
        raise HTTPException(status_code=500, detail=f'Solver error: {exc}')

    m = output.metrics
    coverage_rate = len(output.assignments) / max(len(req.shifts), 1)

    logger.info(
        '[optimize] status=%s assignments=%d unassigned=%d coverage=%.0f%% '
        'vars=%d constraints=%d pre=%.1fms solve=%.1fms obj=%.1f',
        output.status, len(output.assignments), len(output.unassigned_shift_ids),
        coverage_rate * 100,
        m.final_variables, m.num_constraints,
        m.preprocess_ms, m.solve_ms, output.objective_value,
    )

    return OptimizeRes(
        status=output.status,
        assignments=[
            AssignmentRes(shift_id=a.shift_id, employee_id=a.employee_id, employment_type=a.employment_type, cost=a.cost)
            for a in output.assignments
        ],
        unassigned_shift_ids=output.unassigned_shift_ids,
        objective_value=output.objective_value,
        best_objective_bound=output.best_objective_bound,
        proven_optimal=output.proven_optimal,
        debug=DebugMetricsRes(
            raw_pairs=m.raw_pairs,
            eligible_pairs=m.eligible_pairs,
            rest_eliminated_pairs=m.rest_eliminated_pairs,
            final_variables=m.final_variables,
            num_constraints=m.num_constraints,
            greedy_hint_applied=m.greedy_hint_applied,
            preprocess_ms=m.preprocess_ms,
            solve_ms=m.solve_ms,
            coverage_rate=round(coverage_rate, 3),
        ),
    )


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'ortools_runner:app',
        host='0.0.0.0',
        port=5005,
        reload=True,
        log_level='info',
    )
