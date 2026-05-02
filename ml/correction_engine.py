"""
Correction Engine — Business Logic Layer

Applies context-sensitive multipliers to raw ML predictions.
Separated from the ML layer so corrections can be:
  - A/B tested independently
  - overridden per-event by managers
  - fed back into retraining as labeled adjustments

The engine loads correction factors from `labor_correction_factors` in Supabase
and applies them as simple multipliers to the raw predicted headcount.
"""

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')


class CorrectionEngine:
    """Loads and applies business correction multipliers."""

    def __init__(self):
        self.factors: dict[tuple[str, str], float] = {}
        try:
            supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            response = supabase.table('labor_correction_factors').select('*').execute()
            for row in response.data:
                key = (row['event_type'], row['role'])
                self.factors[key] = float(row['correction_factor'])
        except Exception:
            pass

    def apply(self, event_type: str, role: str, predicted: float) -> tuple[float, float]:
        """Apply correction factor to raw prediction.

        Returns:
            tuple[float, float]: (corrected_value, factor_used)
        """
        factor = self.factors.get((event_type, role), 1.0)
        return predicted * factor, factor

    def get_factor(self, event_type: str, role: str) -> float:
        """Get the correction factor for a given event type and role."""
        return self.factors.get((event_type, role), 1.0)

    def all_factors(self) -> dict[tuple[str, str], float]:
        """Return a copy of all loaded factors for inspection."""
        return dict(self.factors)
