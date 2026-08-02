# Architecture History (superseded)

Everything in this folder is a **past snapshot**, kept for changelog value. None of it should be read as describing the current state of the codebase — for that, use [../../rulebook/02-architecture.md](../../rulebook/02-architecture.md) and [../../rulebook/17-production-audit.md](../../rulebook/17-production-audit.md).

| File | What it was | Superseded by |
|---|---|---|
| [2026-02-16_architecture-overview.md](2026-02-16_architecture-overview.md) | Early, generic architecture summary (modules, tech stack, lifecycle diagrams) | `rulebook/02-architecture.md` |
| [2026-02-16_architecture-review-report.md](2026-02-16_architecture-review-report.md) | DDD architecture review + Phase 1–3 roadmap | Folded into the `ddd-migration/` log below, then `rulebook/` |
| [2026-04-21_architecture-refactor-review.md](2026-04-21_architecture-refactor-review.md) | Later verification pass of the same DDD refactor (routing, module structure) | `rulebook/02-architecture.md`, `rulebook/17-production-audit.md` |
| [ddd-migration/](ddd-migration/) | Phase-by-phase completion log of the DDD module migration (index.ts creation → ESLint/path-alias rules → boundary-violation fixes → design-system consolidation → types.ts dismantling) | N/A — this is a changelog, not a spec; phases 1–4 are marked complete in their own summaries, Phase 5 is a plan with no completion summary found (may still be open or may have been finished without a written summary — check `git log` / current `src/design-system` state if it matters) |

**Note on internal links:** these files sometimes reference doc paths from *when they were written* (e.g. `docs/reports/`, `docs/ddd-phase-N-summary.md`) that no longer exist after this reorg. That's intentional — they're a historical record of what was true and where things lived at the time, not live links. Don't "fix" them into pointing at current paths; that would misrepresent the history.
