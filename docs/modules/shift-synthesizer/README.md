# Shift Synthesizer — Documentation

Covers the pipeline that bridges ML-driven labour-demand predictions with roster execution: it translates event-driven forecasts into actionable, unfilled draft shifts ready for assignment.

| # | Doc | Covers |
|---|---|---|
| 01 | [Architecture & Integration](01-architecture-and-integration.md) | How VenueOps events → ML service → demand tensors → synthesized draft shifts fit together. |
| 02 | [Operating Guide](02-operating-guide.md) | Step-by-step: environment prerequisites, running the ML service via Docker Compose, triggering a synthesis run. |
| 03 | [ML Service Setup](03-ml-service-setup.md) | The FastAPI service itself (`ml-service/` or equivalent): one XGBoost regressor per role, Python/dependency pins, correction-factor tuning from post-event actuals. |

**Naming note:** the source docs used both "Synthesiser" and "Synthesizer" (British/American spelling) — this folder standardizes on "Synthesizer." If you find "Synthesiser" elsewhere in the codebase (file names, comments), it refers to the same feature.
