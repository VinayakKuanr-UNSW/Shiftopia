"""FastAPI service: predicts per-role headcount demand for ICC Sydney events using XGBoost models."""

import logging
import os
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from supabase import create_client

from predict import PredictionError, predict_demand

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

logger = logging.getLogger(__name__)

app = FastAPI(title="ICC Predictive Labour Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(PredictionError)
async def prediction_error_handler(_request, exc: PredictionError):
    return JSONResponse(
        status_code=502,
        content={
            "detail": str(exc),
            "role": exc.role,
            "cause": str(exc.cause),
        },
    )


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError):
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc)},
    )


class PredictRequest(BaseModel):
    event_type: Literal[
        'Concert', 'Conference', 'Corporate', 'Exhibition',
        'Festival', 'Gala Dinner', 'Sporting Event', 'Trade Show'
    ]
    expected_attendance: int
    day_of_week: int
    month: int
    function_type: Literal[
        'Breakout', 'Ceremony', 'Dinner', 'Meeting',
        'Performance', 'Reception', 'Workshop'
    ]
    room_count: int
    total_sqm: int
    room_capacity: int
    simultaneous_event_count: int
    total_venue_attendance_same_time: int
    entry_peak_flag: bool
    exit_peak_flag: bool
    meal_window_flag: bool
    time_slice_index: int
    event_id: Optional[str] = None
    synthesis_run_id: Optional[str] = None
    scenario_id: Optional[str] = None
    model_version: Optional[str] = 'v1.0'

    @field_validator('expected_attendance')
    @classmethod
    def expected_attendance_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("expected_attendance must be >= 0")
        return v

    @field_validator('day_of_week')
    @classmethod
    def day_of_week_range(cls, v: int) -> int:
        if not (0 <= v <= 6):
            raise ValueError(f"day_of_week must be in 0..6, got {v}")
        return v

    @field_validator('month')
    @classmethod
    def month_range(cls, v: int) -> int:
        if not (1 <= v <= 12):
            raise ValueError(f"month must be in 1..12, got {v}")
        return v

    @field_validator('room_count', 'room_capacity', 'total_sqm')
    @classmethod
    def spatial_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("room_count, room_capacity, and total_sqm must be >= 0")
        return v

    @field_validator('simultaneous_event_count', 'total_venue_attendance_same_time')
    @classmethod
    def concurrent_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError(
                "simultaneous_event_count and total_venue_attendance_same_time must be >= 0"
            )
        return v

    @field_validator('time_slice_index')
    @classmethod
    def time_slice_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("time_slice_index must be >= 0")
        return v


@app.post("/predict/demand")
def predict(req: PredictRequest):
    features = req.model_dump(
        exclude={'event_id', 'synthesis_run_id', 'scenario_id', 'model_version'}
    )

    results = predict_demand(features)

    # Persist forecasts only when the caller is committing a synthesis run.
    # Preview-time calls (no synthesis_run_id) intentionally skip the write so
    # demand_forecasts never accumulates untagged rows that rollback cannot
    # reach. Commit-time wiring lives in src/modules/rosters/state/useShiftSynthesis.ts.
    if req.event_id and req.synthesis_run_id:
        supabase = create_client(
            os.getenv('VITE_SUPABASE_URL'),
            os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY'),
        )
        feature_payload = {k: v for k, v in features.items()}

        for role, counts in results.items():
            row = {
                'event_id': req.event_id,
                'role': role,
                'time_slot': features['time_slice_index'],
                'predicted_count': counts['predicted'],
                'corrected_count': counts['corrected'],
                'correction_factor': counts.get('correction_factor', 1.0),
                'source': 'ML',
                'model_version': req.model_version,
                'version': 1,
                'synthesis_run_id': req.synthesis_run_id,
                'scenario_id': req.scenario_id,
                'feature_payload': feature_payload,
            }
            try:
                supabase.table('demand_forecasts').upsert(
                    row,
                    on_conflict='event_id,role,time_slot,version,scenario_id',
                ).execute()
            except Exception as exc:
                logger.error("Failed to upsert demand_forecasts for role %s: %s", role, exc)
                raise HTTPException(
                    status_code=500,
                    detail=f"DB write failed for role '{role}': {exc}",
                ) from exc

    return results


@app.get("/health")
def health():
    return {"status": "ok"}
