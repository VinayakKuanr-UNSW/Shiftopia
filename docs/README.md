# Shiftopia Documentation

This is the documentation tree for **Superman_ULTIMATE / Shiftopia**, a workforce-management platform (rostering, bidding, swaps, timesheets, payroll, compliance) built on React + Supabase + a Python OR-Tools/ML services layer.

This tree is written to be **picked up cold by a new engineer or a new Claude Code session** with no prior context. If that's you, read in this order:

1. **[rulebook/README.md](rulebook/README.md)** — the canonical, cross-cutting business/architecture spec. Start here for "how does this platform actually work."
2. This file — the map of everything else.
3. Whichever folder below matches what you're touching.

---

## Folder map

| Folder | What's in it | Living or frozen? |
|---|---|---|
| **[rulebook/](rulebook/README.md)** | The canonical spec: architecture, business rules, workflows, state machines, RBAC, compliance engine, production audit. Confidence-tagged (Verified / Strongly Inferred / Weakly Inferred / Unknown) and cross-referenced to source. | **Living** — the primary source of truth. Update in place as the codebase changes. |
| **[modules/](modules/README.md)** | Deep-dive docs for individual features/modules (Timesheets, People Mode, Autoscheduler, Shift Synthesizer), each mirroring `src/modules/<name>/`. | **Living** for the module they cover, until rulebook Ch.03 (per-module deep dive) absorbs them. |
| **[investigations/](investigations/README.md)** | Dated, point-in-time audits, forensic reviews, and implementation plans. Each is a snapshot of what was found/decided on that date — not maintained afterward. | **Frozen at their date.** Check the rulebook or code for current status of anything found here. |
| **[architecture/](architecture/README.md)** | Architecture decision records + the one still-current module-structure standard, plus a `history/` subfolder of superseded architecture docs and the DDD migration log. | Mixed — see the folder's own README. |
| **[design/](design/README.md)** | Forward-looking design specs for features that are partially or not yet built (HR org/role schema, role-forecasting classification). | **Proposal/in-progress** — check live schema before trusting as "current." |
| **[operations/](operations/)** | Runbooks and checklists: incident response, release checklist, a migration's pre-flight integrity checks. | **Living reference.** |
| **[reference/](reference/)** | Stable, structured reference data: the V8 compliance rule catalog, shift FSM state/transition tables, shift-card UI scenario spec. | **Living reference**, generally CSV/tabular. |
| **[archive/](archive/README.md)** | Documents confirmed stale or superseded, kept only so the history isn't lost. **Do not use as a current reference** — each file's header says what replaced it. | **Frozen / deprecated.** |

## Naming conventions used throughout this tree

- **`00-`, `01-`, `02-`... prefixes** inside a folder mean "read in this order" — it's one coherent document set with a `README.md` index (see `rulebook/`, `modules/timesheets/`, `investigations/2026-06-24_.../`). The numbers are load-bearing: other documents in the same folder cross-reference each other by number (e.g. "per §3 of 01"). Don't renumber without also fixing those cross-references.
- **`YYYY-MM-DD_description`** (in `investigations/`) means "this is what was true/found on that date." It is not updated after the fact — if something it describes has since been fixed or has changed, that correction lives in the rulebook or the code, not by editing the old investigation.
- **`archive/`** entries are prefixed or suffixed to make the problem obvious at a glance (`-STALE`, `-UNVERIFIED`) and each has a one-line header explaining what superseded it.

## Known-current facts worth not re-deriving

These are called out because they're easy to get wrong from stale docs still present in this tree (`archive/` exists precisely because of this problem):

- The compliance engine is **`src/modules/compliance/v8/`**. A `v2` engine is referenced in `archive/compliance-v2-R07-rest-gap-STALE.md` and does not exist in the current codebase.
- All shift/swap/bid writes go through the **`sm_apply_shift_op`** gateway (version-CAS + FSM guard). A large `sm_*`/`*_rpc` "graveyard" of one-off RPCs predates this and is documented as stale in `archive/2026-02-16_rpc-usage-report-pre-gateway-STALE.md`.
- Reserve List, Bid AutoPilot, and Swap AutoPilot enforce only a **fixed 4-check compliance subset** (not the full 21-rule v8 engine) via a separate Edge Function — see `rulebook/12-compliance-engine.md` §1.2. The `investigations/2026-06-24_auto-assign-bids-and-swap-approval/` plan addresses part of this but its draft migrations are **not applied to prod**.
- For anything else, `rulebook/README.md`'s "Chapter status" and findings tables are the up-to-date rollup — check there before trusting a docs file elsewhere in this tree.

## Keeping this tree useful

- New audit/investigation → new dated file or folder under `investigations/`, plus a line in `investigations/README.md`.
- New or materially changed feature → a chapter in the relevant `modules/<name>/` set (or a new module folder, mirroring `src/modules/`).
- Something here turns out to be wrong or superseded → move it to `archive/` with a header explaining why, don't just delete it (unless it's truly worthless, like a misplaced unrelated file).
- Cross-cutting rule/workflow/architecture changes belong in `rulebook/`, since that's the one document set meant to stay authoritative platform-wide.
- If you regenerate the knowledge graph (`/graphify`), re-run it after a reorg like this one — `graphify-out/manifest.json` still indexes files by their pre-reorg paths.
