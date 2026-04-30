import os
import pickle
import numpy as np
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor']

FEATURE_ORDER = [
    'event_type', 'expected_attendance', 'day_of_week', 'month',
    'function_type', 'room_count', 'total_sqm', 'room_capacity',
    'simultaneous_event_count', 'total_venue_attendance_same_time',
    'entry_peak_flag', 'exit_peak_flag', 'meal_window_flag',
    'time_slice_index'
]


class FeaturePipeline:
    def __init__(self):
        self.encoders = {}
        try:
            with open(os.path.join(MODELS_DIR, 'encoders.pkl'), 'rb') as f:
                self.encoders = pickle.load(f)
        except Exception:
            pass

    def transform(self, features: dict) -> np.ndarray:
        row = []
        for col in FEATURE_ORDER:
            val = features[col]
            if col in self.encoders:
                val = self.encoders[col].transform([str(val)])[0]
            elif isinstance(val, bool):
                val = int(val)
            row.append(val)
        return np.array([row])


def load_model(role: str):
    model_path = os.path.join(MODELS_DIR, f'{role}.pkl')
    with open(model_path, 'rb') as f:
        return pickle.load(f)


class CorrectionEngine:
    def __init__(self):
        self.factors = {}
        try:
            supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            response = supabase.table('labor_correction_factors').select('*').execute()
            for row in response.data:
                key = (row['event_type'], row['role'])
                self.factors[key] = row['correction_factor']
        except Exception:
            pass

    def apply(self, event_type: str, role: str, predicted: float) -> float:
        factor = self.factors.get((event_type, role), 1.0)
        return predicted * factor


def predict_demand(features: dict) -> dict:
    pipeline = FeaturePipeline()
    correction = CorrectionEngine()
    results = {}

    for role in ROLES:
        try:
            model = load_model(role)
            X = pipeline.transform(features)
            predicted = float(model.predict(X)[0])
            corrected = correction.apply(features['event_type'], role, predicted)
            results[role] = {
                'predicted': max(0, round(predicted)),
                'corrected': max(0, round(corrected))
            }
        except Exception:
            results[role] = {'predicted': 0, 'corrected': 0}

    return results
