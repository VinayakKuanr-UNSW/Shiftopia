## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- Retrieve in tiers. Stop at the first tier that answers the question; never load a lower tier "for context".
    - T0 `graphify-out/wiki/index.md` (~5k tok) — community map, the entry point.
    - T1 one `graphify-out/wiki/<Community>.md` (~1k tok) — a single subsystem.
    - T2 `scripts/graphify/ask.py <mode> <arg>` (~0.3-0.9k tok) — a specific, cited answer.
    - T3 raw source — only for the exact files T2 named.
- Do NOT reflexively read `graphify-out/GRAPH_REPORT.md`: it is ~37k tokens (579 communities). Read it only when you genuinely need global god-node/cohesion statistics. Never read `graph.json` (~3.9M tokens) into context — query it with a script.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module questions use TYPED traversal, not generic BFS. `graphify query` is undirected and depth-2 from any node lands in the god nodes (`cn()` has 283 edges, `Button` 169), so it spends its whole budget on UI primitives. Use instead:
    - `python3 scripts/graphify/ask.py brief <entity>`     — START HERE. All four layers at once (~450 tok): definition, callers, guards, recorded landmines, doc sections
    - `python3 scripts/graphify/ask.py impact <table|fn>`  — who breaks if this DB object changes
    - `python3 scripts/graphify/ask.py surface <path frag>` — which DB objects a module touches
    - `python3 scripts/graphify/ask.py owns <table|fn>`     — which migrations define it (+ RLS/triggers)
    - `python3 scripts/graphify/ask.py warnings <frag>`     — recorded landmines attached to that entity
    - `python3 scripts/graphify/ask.py docs <frag>`         — the doc SECTIONS (file#line) that explain it
  `graphify path "A" "B"` and `graphify explain "X"` remain fine for single-node questions.
- The graph spans FOUR layers: TS/Python (AST), the SQL migrations (`sql_layer.py`), documentation sections bound to the entities they describe (`docs_layer.py`), and institutional memory (`memory_layer.py`). `graphify update .` refreshes only the first and wipes the DB nodes from `graph.json` — so ALWAYS refresh with `scripts/graphify/refresh.sh` (update → sql → merge → docs → memory → merge-from-pure-AST → check; docs/memory read DB nodes from the merged `graph.json`, and the final merge must start from the saved AST graph or the previous run's doc edges survive). Two identical refreshes must produce identical graphs — if they don't, something is order-dependent. `supabase/migrations*` is in `.graphifyignore` on purpose: newer graphify parses `.sql` into disconnected stubs that duplicate `sql_layer.py`. The layer scripts import `graphify`, so they need graphify's interpreter, not system `python3` (`refresh.sh` resolves it). The post-commit hook runs `refresh.sh` in the background; result in `graphify-out/.last_check.txt`.
- The semantic layer (`semantic_layer.py`, or `graphify extract docs --backend gemini`) is OPT-IN and deliberately NOT in the post-commit hook: it costs money and hits the Gemini free-tier 250k-input-tokens/minute cap unless run with `--max-concurrency 1`. Measured ROI on this repo was poor — $0.28 and ~9 min bought 13 genuinely-new-type edges plus 26 concept/rationale nodes, against 1,624 edges that `docs_layer.py` derives for free in 2.4s. graphify also DROPS the doc→code edges the model finds when extraction is scoped to `docs/` ("out-of-scope item(s) attributed to N file(s) not dispatched"), and those are the edges `docs_layer.py` already produces deterministically. Re-run it only when you specifically want concept/rationale nodes.
- `python3 scripts/graphify/check.py` asserts the graph is intact (all four layers present, no dangling edges, no dedup drift in provenance). The post-commit hook runs it; run it yourself if a query returns something surprising.
- NEVER rebuild with graphify's default label dedup. It merges nodes by normalised label + fuzzy match, which collapses every `index.ts`/`Props`/`handler` in a 1,100-file codebase into one node with wrong provenance. `merge_layers.py` uses exact-ID dedup only.
- After modifying code, run `scripts/graphify/refresh.sh` (not bare `graphify update .`, which leaves the graph without its DB layer).

### Graphify-first workflow
- Use the graph BEFORE broad grep/file reads whenever the task touches interconnected or unfamiliar code (bugs, features, refactors, shared components, DB changes). Skip it for trivial edits where the affected code is already known.
- Before changing shared code or a DB object, run `ask.py impact`/`brief` to map callers, consumers, guards and tests.
- The graph is a navigation aid, NOT proof. TS call/import edges are ~30-45% complete, so a missing edge never means "no dependency": finish negative findings with a targeted grep, and verify critical paths in source. Check `.last_check.txt` before trusting a negative result.
- Narrowest query first; reuse findings already in context; expand only on evidence.
- If graphify fails, say so and fall back to targeted source inspection. Never invent graph results or CLI flags (check `--help`).
- For substantial tasks, the final report covers: what the graph showed, what changed, impact, the checks actually run (with results), and remaining risk.
