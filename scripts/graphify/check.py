#!/usr/bin/env python3
"""Integrity check for the 4-layer graph. Exit 1 on regression.

The graph is rebuilt by graphify and then re-layered (scripts/graphify/refresh.sh),
and three things have silently degraded it before: a layer dropped (the stock
hooks raced graphify's background rebuild against the layer scripts), unrelated
nodes merged by label so provenance went wrong, and a graphify id-scheme change
that left layers binding to ghost nodes (graph_ids.py). This asserts the
properties that must hold.

Run: scripts/graphify/refresh.sh (which runs this last), or
     $(cat graphify-out/.graphify_python) scripts/graphify/check.py
"""
from __future__ import annotations
import json, sys
from collections import Counter
from pathlib import Path

from graph_ids import file_node_index, is_file_node

ROOT = Path(__file__).resolve().parents[2]
G = json.loads((ROOT / "graphify-out/graph.json").read_text())
N = {n["id"]: n for n in G["nodes"]}
E = G.get("links", G.get("edges", []))
rel = Counter(e.get("relation") for e in E)
fail: list[str] = []

def check(ok: bool, msg: str) -> None:
    print(("  PASS  " if ok else "  FAIL  ") + msg)
    if not ok:
        fail.append(msg)

print(f"graph: {len(N):,} nodes, {len(E):,} edges\n")

# 1. every layer still present
for r, floor in (("queries", 1000), ("calls_rpc", 30), ("documents", 800), ("warns_about", 300)):
    check(rel.get(r, 0) >= floor, f"{r:<12} {rel.get(r,0):>5} edges (floor {floor})")

# 2. layer node populations
db = sum(1 for i in N if i.startswith(("db_", "mig_")))
mem = sum(1 for i in N if i.startswith("mem_"))
check(db >= 1400, f"db/sql nodes {db}")
check(mem >= 100, f"memory nodes {mem}")

# 3. provenance regression: label dedup must not invent callers.
#    Ground truth verified by grep on 2026-09-06; re-verified 2026-10-05 after
#    the leave rewrite, which moved leave.api.ts onto sm_unassign_shift /
#    sm_delete_shift (it no longer calls sm_apply_shift_op).
#    Resolved by PATH: graphify's file-node id scheme changed in 0.9 (the
#    extension is no longer part of it), so hard-coded ids pin a version.
truth_paths = ["src/modules/rosters/api/shifts.api.ts",
               "supabase/functions/auto-assign-bids/index.ts"]
_idx = file_node_index(N)
truth = {_idx.get(p.lower(), p) for p in truth_paths}
got = {e["source"] for e in E
       if e.get("target") == "db_fn_sm_apply_shift_op" and e.get("relation") == "calls_rpc"}
check(got == truth, f"sm_apply_shift_op callers exact ({len(got)} found)"
      + ("" if got == truth else f" -- drift: {got ^ truth}"))

# 3b. one node per file: a layer that recomputes a file id by formula mints a
#     ghost twin (labelled with the full path) next to graphify's real file
#     node (labelled with the basename). See graph_ids.py.
by_src: dict[str, set[str]] = {}
for i, n in N.items():
    sf = str(n.get("source_file") or "")
    if sf and not i.startswith(("db_", "mig_", "mem_")) and (is_file_node(n) or n.get("label") == sf):
        by_src.setdefault(sf, set()).add(i)
twins = [sf for sf, ids in by_src.items() if len(ids) > 1]
check(not twins, f"duplicate file nodes {len(twins)}" + (f" -- e.g. {twins[:3]}" if twins else ""))

# 4. no dangling endpoints
dangling = sum(1 for e in E if e["source"] not in N or e["target"] not in N)
check(dangling == 0, f"dangling edges {dangling}")

# 5. labels cover every community
lab = json.loads((ROOT / "graphify-out/.graphify_labels.json").read_text())
unnamed = sum(1 for v in lab.values() if str(v).startswith("Community "))
check(unnamed == 0, f"unnamed communities {unnamed}/{len(lab)}")

print("\n" + ("FAILED: " + "; ".join(fail) if fail else "all checks passed"))
sys.exit(1 if fail else 0)
