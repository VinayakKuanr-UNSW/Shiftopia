# Architecture

| Item | Status |
|---|---|
| [adr/ADR-001-modular-frontend.md](adr/ADR-001-modular-frontend.md) | The modular "Atlassian-style" frontend ADR (domain modules, shared design-system, platform services). Status still says "Proposed" in the doc itself, but the module boundary it describes is the one the codebase actually follows today — treat it as adopted in practice. |
| [ddd-module-standards.md](ddd-module-standards.md) | **Living reference.** The canonical module-folder templates (Simple / Feature / Domain / Container / Specialized) that `src/modules/*` follows. Cited by name from other docs (e.g. the Reserve List investigation) — don't move or rename without updating those references. |
| [calendar-system.md](calendar-system.md) | **Living reference.** The one calendar engine (`core/ui/calendar/`) that replaced eight rival grids and four range pickers, and the single NSW public-holiday source that replaced three. Monday-start is baked into `core/lib/date/week.ts` with no options parameter — read this before adding any date UI. |
| [pay-cost-engine.md](pay-cost-engine.md) | **Living reference.** How a shift's cost is computed, and why the award rules exist twice — TypeScript for per-shift figures, a SQL port for aggregates (Bucket View fetches no raw shifts, so the footer cannot sum client-side). Documents the rate chain, what the port does and does not apply, and the parity test that holds the two in step. Read before touching anything that renders money. |
| [history/](history/README.md) | Superseded architecture reviews and the DDD migration changelog. Frozen — see that folder's README before trusting anything in it as current. |

For the **current** architecture (diagrams, data flow, module relationships), see [../rulebook/02-architecture.md](../rulebook/02-architecture.md) and the production-readiness findings in [../rulebook/17-production-audit.md](../rulebook/17-production-audit.md) — both postdate and supersede everything in `history/`.
