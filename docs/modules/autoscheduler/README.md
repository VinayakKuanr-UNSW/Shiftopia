# Autoscheduler — Documentation

Covers the OR-Tools CP-SAT optimizer service (`optimizer-service/`) that backs Shiftopia's auto-scheduling feature: constraint solving over shifts/employees/demand, its API contract with the TypeScript frontend, and the hardening work done to make it production-shippable.

| # | Doc | Covers |
|---|---|---|
| 01 | [Forensic Audit & Hardening](01-forensic-audit-and-hardening.md) | End-to-end engineering audit: constraint-count/latency fixes, schema-drift tests, god-class split, JWT auth, rate limiting, CORS, OpenTelemetry, health/ready probes, load testing. Phase 3 (production hardening) is complete; Phase 4 (k8s migration, advanced solver features) is deferred. |
| 02 | [Schema Contracts](02-schema-contracts.md) | Why the service has three independent input-shape definitions (Pydantic, dataclass, TS interface) and the drift-prevention contract test suite that keeps them in sync. |

**Related:** for the broader autoscheduler *scope and behavior* (what it schedules, single-mode solve, weekly decomposition, fairness), see the rulebook's workflow/architecture chapters — this folder is specifically about the service's engineering/operational state, not its scheduling semantics.
