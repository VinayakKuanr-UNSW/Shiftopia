#!/bin/sh
# Rebuild the 4-layer knowledge graph in the one order that is correct:
#   graphify update (AST) -> sql_layer -> merge -> docs_layer -> memory_layer -> merge(from AST) -> check
# Called in the background by .git/hooks/post-commit with --commit; safe to run
# by hand with no args. Exit status is check.py's, so a regression is visible.
set -e
cd "$(git rev-parse --show-toplevel)"
OUT=graphify-out
RESULT=$OUT/.last_check.txt

# Two quick commits would otherwise run two refreshes over the same files.
LOCK=$OUT/.refresh.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[graphify] refresh already running ($LOCK); skipping" >&2
  exit 0
fi
# Any failure before check.py leaves a FAILED result, never the previous run's PASS.
trap 'rc=$?; rmdir "$LOCK"; [ $rc -ne 0 ] && [ ! -f "$OUT/.check_done" ] && echo "FAILED: refresh.sh aborted (exit $rc) before check.py ran" > "$RESULT"; rm -f "$OUT/.check_done"' EXIT

# GUI git clients run hooks with a minimal PATH; graphify is a uv tool in ~/.local/bin.
PATH="$PATH:$HOME/.local/bin"
# merge_layers imports the graphify package, so use the interpreter graphify runs under.
GRAPHIFY=$(command -v graphify) || { echo "[graphify] graphify not on PATH" >&2; exit 1; }
PY=$(head -1 "$GRAPHIFY" | sed 's/^#!//')
"$PY" -c "import graphify" || { echo "[graphify] $PY cannot import graphify" >&2; exit 1; }

graphify update .
# Keep the pure AST graph: the final merge must start from it, or edges from the
# PREVIOUS docs/memory pass (folded in by the first merge) survive another run.
cp "$OUT/graph.json" "$OUT/.ast_graph.json"

# docs/memory resolve DB nodes from graph.json, so merge the SQL layer in first.
"$PY" scripts/graphify/sql_layer.py
"$PY" scripts/graphify/merge_layers.py
"$PY" scripts/graphify/docs_layer.py
"$PY" scripts/graphify/memory_layer.py
cp "$OUT/.ast_graph.json" "$OUT/graph.json"
"$PY" scripts/graphify/merge_layers.py

rc=0
"$PY" scripts/graphify/check.py > "$RESULT" 2>&1 || rc=$?
touch "$OUT/.check_done"
tail -1 "$RESULT"
exit $rc
