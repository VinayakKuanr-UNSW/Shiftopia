#!/usr/bin/env python3
"""Integrity check for the 4-layer graph. Exit 1 on regression.

The post-commit hook runs graphify's own rebuild in the BACKGROUND while the
layer scripts run synchronously, and that rebuild applies graphify's default
label+fuzzy dedup. Both are ways the graph can silently degrade between
commits: a layer can be dropped, or unrelated nodes merged so provenance goes
wrong. This asserts the properties that must hold.

Run: python3 scripts/graphify/check.py
"""
from __future__ import annotations
import json, sys
from collections import Counter
from pathlib import Path

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
truth = {"src_modules_rosters_api_shifts_api_ts",
         "supabase_functions_auto_assign_bids_index_ts"}
got = {e["source"] for e in E
       if e.get("target") == "db_fn_sm_apply_shift_op" and e.get("relation") == "calls_rpc"}
check(got == truth, f"sm_apply_shift_op callers exact ({len(got)} found)"
      + ("" if got == truth else f" -- drift: {got ^ truth}"))

# 4. no dangling endpoints
dangling = sum(1 for e in E if e["source"] not in N or e["target"] not in N)
check(dangling == 0, f"dangling edges {dangling}")

# 5. labels cover every community
lab = json.loads((ROOT / "graphify-out/.graphify_labels.json").read_text())
unnamed = sum(1 for v in lab.values() if str(v).startswith("Community "))
check(unnamed == 0, f"unnamed communities {unnamed}/{len(lab)}")

print("\n" + ("FAILED: " + "; ".join(fail) if fail else "all checks passed"))
sys.exit(1 if fail else 0)
