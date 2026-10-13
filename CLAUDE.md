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
- The graph spans FOUR layers: TS/Python/test-SQL (graphify AST), the SQL migrations (`sql_layer.py`), documentation sections bound to the entities they describe (`docs_layer.py`), and institutional memory (`memory_layer.py`). Refresh them with ONE ordered chain: `scripts/graphify/refresh.sh` (`--changed` = only files changed vs HEAD, ~12s; no flag = full rebuild, ~25s; `--layers` = layers only). Both git hooks (post-commit, post-checkout) call it in the background; the result lands in `graphify-out/.last_check.txt`.
- `supabase/migrations/` is in `.graphifyignore` on purpose: `sql_layer.py` owns it (one node per DB object), while graphify's tree-sitter-sql parser would mint one node per object PER MIGRATION FILE. So `graphify update .` on its own PRUNES the whole DB layer until the layers re-run — always use `refresh.sh`. Other `.sql` (supabase/tests, seed, audits, scripts) IS parsed, and `merge_layers.py` points its table/function references at the canonical `db_*` nodes.
- Layer scripts must LOOK UP node ids via `scripts/graphify/graph_ids.py`, never recompute them: graphify 0.9 changed its file-node id scheme (a `.ts` file node is now `src_…_shifts_api`, not `…_shifts_api_ts`), and recomputed ids silently bind to nothing. Don't re-run `graphify hook install` — it restores the stock hooks, whose background rebuild races the layer scripts.
- The semantic layer (`semantic_layer.py`, or `graphify extract docs --backend gemini`) is OPT-IN and deliberately NOT in the post-commit hook: it costs money and hits the Gemini free-tier 250k-input-tokens/minute cap unless run with `--max-concurrency 1`. Measured ROI on this repo was poor — $0.28 and ~9 min bought 13 genuinely-new-type edges plus 26 concept/rationale nodes, against 1,624 edges that `docs_layer.py` derives for free in 2.4s. graphify also DROPS the doc→code edges the model finds when extraction is scoped to `docs/` ("out-of-scope item(s) attributed to N file(s) not dispatched"), and those are the edges `docs_layer.py` already produces deterministically. Re-run it only when you specifically want concept/rationale nodes.
- `python3 scripts/graphify/check.py` asserts the graph is intact (all four layers present, no dangling edges, no dedup drift in provenance). The post-commit hook runs it; run it yourself if a query returns something surprising.
- NEVER rebuild with graphify's default label dedup. It merges nodes by normalised label + fuzzy match, which collapses every `index.ts`/`Props`/`handler` in a 1,100-file codebase into one node with wrong provenance. `merge_layers.py` uses exact-ID dedup only.
- After modifying code, run `scripts/graphify/refresh.sh --changed` to keep the graph current (no API cost).
