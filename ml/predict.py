import os
import pickle
import numpy as np
from dotenv import load_dotenv
from correction_engine import CorrectionEngine

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
ROLES = ['Usher', 'Security', 'Food Staff', 'Supervisor']

FEATURE_ORDER = [
    'event_type', 'expected_attendance', 'day_of_week', 'month',
    'function_type', 'room_count', 'total_sqm', 'room_capacity',
    'simultaneous_event_count', 'total_venue_attendance_same_time',
    'entry_peak_flag', 'exit_peak_flag', 'meal_window_flag',
    'time_slice_index'
]


class PredictionError(Exception):
    """Raised when model loading or prediction fails for a specific role."""

    def __init__(self, role: str, cause: Exception) -> None:
        super().__init__(f"Prediction failed for role '{role}': {cause}")
        self.role = role
        self.cause = cause


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


def _validate_features(features: dict) -> None:
    """Raise ValueError for integer fields whose out-of-range values would
    produce nonsense XGBoost predictions without any obvious error."""
    if features.get('expected_attendance', 0) < 0:
        raise ValueError("expected_attendance must be >= 0")
    if features.get('time_slice_index', 0) < 0:
        raise ValueError("time_slice_index must be >= 0")
    month = features.get('month')
    if month is not None and not (1 <= month <= 12):
        raise ValueError(f"month must be in 1..12, got {month}")
    dow = features.get('day_of_week')
    if dow is not None and not (0 <= dow <= 6):
        raise ValueError(f"day_of_week must be in 0..6, got {dow}")
    if features.get('room_count', 0) < 0:
        raise ValueError("room_count must be >= 0")
    if features.get('room_capacity', 0) < 0:
        raise ValueError("room_capacity must be >= 0")
    if features.get('total_sqm', 0) < 0:
        raise ValueError("total_sqm must be >= 0")
    if features.get('simultaneous_event_count', 0) < 0:
        raise ValueError("simultaneous_event_count must be >= 0")
    if features.get('total_venue_attendance_same_time', 0) < 0:
        raise ValueError("total_venue_attendance_same_time must be >= 0")


def load_model(role: str):
    model_path = os.path.join(MODELS_DIR, f'{role}.pkl')
    if not os.path.exists(model_path):
        raise PredictionError(
            role,
            FileNotFoundError(f"Model file not found: {model_path}")
        )
    try:
        with open(model_path, 'rb') as f:
            return pickle.load(f)
    except Exception as exc:
        raise PredictionError(role, exc) from exc


def predict_demand(features: dict) -> dict:
    _validate_features(features)
    pipeline = FeaturePipeline()
    correction = CorrectionEngine()
    results = {}

    for role in ROLES:
        try:
            model = load_model(role)
            X = pipeline.transform(features)
            predicted = float(model.predict(X)[0])
            corrected, factor = correction.apply(features['event_type'], role, predicted)
            results[role] = {
                'predicted': max(0, round(predicted)),
                'corrected': max(0, round(corrected)),
                'correction_factor': factor
            }
        except PredictionError:
            raise
        except Exception as exc:
            raise PredictionError(role, exc) from exc

    return results
