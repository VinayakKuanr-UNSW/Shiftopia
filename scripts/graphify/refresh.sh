#!/bin/sh
# Rebuild the 4-layer knowledge graph in the one order that is correct:
#   graphify update (AST) -> sql_layer -> merge -> docs_layer -> memory_layer -> merge -> check
# Merge must run last or a late AST rebuild drops the DB layer. Called by .git/hooks/post-commit with
# --commit; safe to run by hand with no args.
set -e
cd "$(git rev-parse --show-toplevel)"

# merge_layers imports the graphify package, so use the interpreter graphify runs under.
PY=$(head -1 "$(command -v graphify)" | sed 's/^#!//')

graphify update .
# docs/memory resolve DB nodes from graph.json, which `graphify update` just
# rewrote without them — merge the SQL layer in first, then merge again.
"$PY" scripts/graphify/sql_layer.py
"$PY" scripts/graphify/merge_layers.py
for s in docs_layer memory_layer merge_layers; do
  "$PY" "scripts/graphify/$s.py"
done

"$PY" scripts/graphify/check.py > graphify-out/.last_check.txt 2>&1 || true
tail -1 graphify-out/.last_check.txt
