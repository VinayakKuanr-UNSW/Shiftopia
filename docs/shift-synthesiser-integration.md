# Shift Synthesiser — Integration Documentation

## Overview

The Shift Synthesiser bridges ML-driven labour demand predictions with roster execution.
It automatically translates event-driven predictive labour forecasts into actionable,
unbound (unfilled) draft shifts ready for assignment.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  VenueOps Events │────▶│  ML Service   │────▶│  Demand Tensors      │
│  (Supabase)      │     │  (FastAPI:8000)│     │  per role/timeslot   │
└─────────────────┘     └──────────────┘     └──────────┬──────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  Shift Synthesiser   │
                                              │  Orchestrator (TS)   │
                                              │  • bin-packing       │
                                              │  • compliance check  │
                                              │  • insert as Draft   │
                                              └──────────┬──────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  synthesis_runs      │
                                              │  (audit + rollback)  │
                                              └─────────────────────┘
```

## Services

### ML Service (Python FastAPI)
- **Location**: `ml/`
- **Port**: 8000 (Docker: `ml` service)
- **Endpoint**: `POST /predict/demand`
- **Models**: Pre-trained XGBoost `.pkl` files in `ml/models/`
- **Env**: `VITE_ML_URL=http://localhost:8000`

### TypeScript Services
All under `src/modules/rosters/services/`:

| File | Purpose |
|------|---------|
| `mlClient.service.ts` | HTTP client for ML service; role→ML class resolution |
| `demandTensorBuilder.service.ts` | Builds per-role demand tensors from ML predictions |
| `shiftSynthesiser.service.ts` | Core bin-packing: tensors → shift skeletons |
| `shiftSynthesiser.scan.ts` | Gap-fill scan logic |
| `shiftSynthesiser.orchestrator.ts` | End-to-end: predict → synthesize → compliance → insert |

### API Queries
Under `src/modules/rosters/api/`:

| File | Purpose |
|------|---------|
| `synthesisRuns.queries.ts` | CRUD for synthesis_runs audit table |
| `venueopsEvents.queries.ts` | Fetch VenueOps events for a date |
| `roleMlClass.queries.ts` | DB-backed role→ML class mapping |

## Database Tables

### New Tables (Phase 2a)
| Table | Purpose | RLS |
|-------|---------|-----|
| `venueops_event_types` | Event type lookup | SELECT: authenticated |
| `venueops_function_types` | Function type lookup | SELECT: authenticated |
| `venueops_rooms` | Venue rooms | SELECT: authenticated |
| `venueops_series` | Event series | SELECT: authenticated |
| `venueops_events` | Main events table | SELECT: authenticated |
| `venueops_functions` | Event functions | SELECT: authenticated |
| `venueops_booked_spaces` | Booked spaces | SELECT: authenticated |
| `venueops_tasks` | Event tasks | SELECT: authenticated |
| `venueops_ml_features` | Pre-computed ML features | SELECT: authenticated |
| `predicted_labor_demand` | ML predictions per role/slot | SELECT/INSERT: authenticated |
| `labor_correction_factors` | Manual correction multipliers | SELECT/UPDATE: authenticated |
| `actual_labor_attendance` | Actual vs predicted tracking | SELECT/INSERT: authenticated |
| `synthesis_runs` | Audit log per generation | Scoped: `user_has_action_in_scope('shift.create', ...)` |
| `cancellation_history` | Shift cancellation tracking | Scoped via shifts FK: `user_has_action_in_scope('shift.edit', ...)` |
| `role_ml_class_map` | Role→ML class mapping (DB-backed) | SELECT: any auth; write: scoped via roles |

### Modified Tables
| Table | Change |
|-------|--------|
| `shifts` | Added `synthesis_run_id uuid` FK → `synthesis_runs(id) ON DELETE SET NULL` |

## Role Mapping

The ML model recognizes 4 role classes: `Usher`, `Security`, `Food Staff`, `Supervisor`.

Internal roles are mapped to these classes via `role_ml_class_map` table:
- **Initial seed**: 59 roles auto-mapped using regex heuristic (source=`auto_regex`)
- **Manual overrides**: Ops can INSERT/UPDATE rows with source=`manual`
- **Unmapped roles**: 26 roles have no ML class — they're skipped by the synthesiser
- **Zero Usher roles**: No current role maps to Usher — ops can add manually

### Mapping Management
```sql
-- View current mapping
SELECT r.name, m.ml_class, m.source FROM role_ml_class_map m JOIN roles r ON r.id = m.role_id;

-- Add a manual mapping
INSERT INTO role_ml_class_map (role_id, ml_class, source) VALUES ('<uuid>', 'Usher', 'manual');

-- Change a mapping
UPDATE role_ml_class_map SET ml_class = 'Security', source = 'manual' WHERE role_id = '<uuid>';
```

## UI

### Labor Demand Forecasting Page
- **Route**: `/labor-demand`
- **Component**: `src/modules/rosters/pages/LaborDemandForecastingPage.tsx`
- **Sidebar**: Under Rostering section, gated by `rosters` permission

### Data Flow
1. Select date + org scope
2. View existing shifts coverage
3. Click "Generate Shift Preview" → calls ML service → builds demand tensors
4. Chart shows Required vs Existing vs Residual vs Injection
5. Click "Confirm & Inject" → ConfirmGenerationModal with options
6. Orchestrator creates Draft shifts with `synthesis_run_id`
7. Toast with "Undo" → rollback deletes unassigned shifts from that run

## Compliance Integration

The synthesiser orchestrator runs parent's Compliance Engine v2 (`evaluateCompliance()`)
in skeleton mode (`employee_id: 'skeleton'`). Only structural rules fire:
- R01: Overlap check
- R02: Minimum shift length
- R08: Meal break compliance

Employee-centric checks (skills, licenses, availability) are correctly skipped
for unassigned draft shifts.

## Docker

```yaml
# Added to docker-compose.yml
ml:
  build: ./ml
  ports: ["8000:8000"]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/docs"]
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_ML_URL` | `http://localhost:8000` | ML service base URL |
