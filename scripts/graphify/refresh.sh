#!/bin/sh
# Refresh the 4-layer knowledge graph in ONE ordered chain:
#
#   graphify code rebuild -> sql_layer -> docs_layer -> memory_layer -> merge_layers -> check
#
# ORDER IS LOAD-BEARING. supabase/migrations/ is in .graphifyignore (sql_layer
# owns it), so every graphify rebuild evicts the nodes sourced from it, and
# merge_layers is what puts them back. graphify's stock git hooks ran the
# rebuild in the BACKGROUND beside the synchronous layer scripts — a rebuild
# that finished after merge_layers left the graph without its database layer.
#
# Usage:
#   scripts/graphify/refresh.sh            full code rebuild (what `graphify update .` does), then layers
#   scripts/graphify/refresh.sh --changed  only files changed vs HEAD (working tree + untracked), then layers
#   scripts/graphify/refresh.sh --commit   only files changed by the last commit (post-commit hook)
#   scripts/graphify/refresh.sh --layers   layers + merge + check, no code rebuild
#
# Exit status: 0 when check.py passes, 1 otherwise.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
PY="$(cat graphify-out/.graphify_python 2>/dev/null || echo python3)"
MODE="${1:-full}"

case "$MODE" in
  full|--full) CHANGED="" ; REBUILD=full ;;
  --changed)   CHANGED="$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u )" ; REBUILD=incremental ;;
  --commit)    CHANGED="$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD)" ; REBUILD=incremental ;;
  --layers)    CHANGED="" ; REBUILD=none ;;
  *) echo "usage: $0 [--full|--changed|--commit|--layers]" >&2 ; exit 2 ;;
esac

status=0
started=$(date +%s)

if [ "$REBUILD" = incremental ] && [ -z "$CHANGED" ]; then
  echo "[graphify] no changed files — skipping the code rebuild"
  REBUILD=none
fi

if [ "$REBUILD" != none ]; then
  echo "[graphify] code rebuild ($REBUILD)"
  GRAPHIFY_CHANGED="$CHANGED" GRAPHIFY_MODE="$REBUILD" "$PY" - <<'PYEOF' || status=1
import os, sys
from pathlib import Path
from graphify.watch import _rebuild_code, _apply_resource_limits

_apply_resource_limits()
changed = None
if os.environ.get("GRAPHIFY_MODE") == "incremental":
    changed = [Path(p.strip()) for p in os.environ.get("GRAPHIFY_CHANGED", "").splitlines() if p.strip()]
    print(f"[graphify] {len(changed)} changed file(s)")
# block_on_lock: wait for a rebuild already in progress instead of skipping —
# the layers below must run against the finished graph.
ok = _rebuild_code(Path("."), changed_paths=changed, block_on_lock=True)
sys.exit(0 if ok else 1)
PYEOF
  [ $status -ne 0 ] && echo "[graphify] WARNING: code rebuild did not complete — layering onto the previous graph"
fi

for step in sql_layer docs_layer memory_layer merge_layers; do
  echo "[graphify] $step"
  if out=$("$PY" "scripts/graphify/$step.py" 2>&1); then
    printf '%s\n' "$out" | tail -2
  else
    status=1
    printf '%s\n' "$out" | tail -8
    echo "[graphify] WARNING: $step failed"
  fi
done

if "$PY" scripts/graphify/check.py > graphify-out/.last_check.txt 2>&1; then
  echo "[graphify] 4-layer graph refreshed + integrity OK ($(( $(date +%s) - started ))s)"
else
  status=1
  echo "[graphify] WARNING: graph integrity check FAILED:"
  grep -E "FAIL" graphify-out/.last_check.txt
fi
exit $status
