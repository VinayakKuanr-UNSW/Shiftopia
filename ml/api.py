import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client
from predict import predict_demand

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = FastAPI(title="ICC Predictive Labour Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    event_type: str
    expected_attendance: int
    day_of_week: int
    month: int
    function_type: str
    room_count: int
    total_sqm: int
    room_capacity: int
    simultaneous_event_count: int
    total_venue_attendance_same_time: int
    entry_peak_flag: bool
    exit_peak_flag: bool
    meal_window_flag: bool
    time_slice_index: int
    event_id: str = None


@app.post("/predict/demand")
def predict(req: PredictRequest):
    features = req.model_dump()
    event_id = features.pop('event_id', None)
    results = predict_demand(features)

    if event_id:
        try:
            supabase = create_client(
                os.getenv('VITE_SUPABASE_URL'),
                os.getenv('VITE_SUPABASE_ANON_KEY')
            )
            for role, counts in results.items():
                supabase.table('predicted_labor_demand').insert({
                    'event_id': event_id,
                    'role': role,
                    'time_slot': features['time_slice_index'],
                    'predicted_count': counts['predicted'],
                    'corrected_count': counts['corrected'],
                    'model_version': 'v1.0'
                }).execute()
        except Exception:
            pass

    return results


@app.get("/health")
def health():
    return {"status": "ok"}
