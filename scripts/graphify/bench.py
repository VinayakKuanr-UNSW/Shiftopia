#!/usr/bin/env python3
"""Measure the retrieval workload we actually run.

`graphify benchmark` scores undirected BFS. That number moves the WRONG way as
the graph improves: adding the SQL and docs layers took it from 33.4x to 15.5x,
because every new edge gives BFS more hubs to flood through (the baseline
migration node alone now has 1,004 edges). Typed retrieval over the same graph
did not move at all.

This measures typed retrieval against the naive alternative a person or agent
would otherwise run -- reading every file that mentions the entity.

Run: python3 scripts/graphify/bench.py
"""
from __future__ import annotations
import subprocess, sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASK = ROOT / "scripts/graphify/ask.py"
PY = (ROOT / "graphify-out/.graphify_python").read_text().strip()

# (mode, arg, grep pattern for the naive baseline, extra corpus read naively)
CASES = [
    ("brief",    "sm_apply_shift_op",  r"sm_apply_shift_op",   True),
    ("impact",   "shifts",             r"\.from\(['\"]shifts['\"]\)", True),
    ("impact",   "user_contracts",     r"user_contracts",      True),
    ("surface",  "modules/compliance", r"",                    False),
    ("warnings", "save_template_full", r"save_template_full",  True),
    ("docs",     "sm_select_bid_winner", r"sm_select_bid_winner", True),
]
SEARCH_DIRS = ["src", "supabase/functions", "optimizer-service", "docs"]

def toks(b: int) -> int:
    return b // 4

def naive_cost(pattern: str, include_migrations: bool) -> tuple[int, int, int]:
    """Two baselines.

    targeted : grep -rl, then read only the files that matched. This is what a
               competent agent actually does, and it is the honest competitor.
    full     : the same, plus every migration -- what you are forced into when
               the answer spans the DB layer, because grep on a table name in
               2.6MB of SQL returns the whole baseline schema file anyway.
    """
    if not pattern:
        return 0, 0, 0
    try:
        out = subprocess.run(
            ["grep", "-rl", "-E", pattern, *[d for d in SEARCH_DIRS if (ROOT / d).exists()]],
            cwd=ROOT, capture_output=True, text=True, timeout=120).stdout.split()
    except Exception:
        out = []
    targeted = sum((ROOT / f).stat().st_size for f in out if (ROOT / f).exists())
    full = targeted
    if include_migrations:
        mig = ROOT / "supabase/migrations"
        full += sum(f.stat().st_size for f in mig.glob("*.sql"))
    return targeted, full, len(out)

print(f"{'query':<40}{'graph':>8}{'targeted':>11}{'x':>6}{'full':>12}{'x':>7}")
print("-" * 84)
ratios = []
for mode, arg, pat, migs in CASES:
    r = subprocess.run([PY, str(ASK), mode, arg], cwd=ROOT, capture_output=True, text=True)
    g = toks(len(r.stdout.encode()))
    tb, fb, _ = naive_cost(pat, migs)
    tt, ft = toks(tb), toks(fb)
    label = f"ask.py {mode} {arg}"[:39]
    if tt and g:
        ratios.append(tt / g)
        print(f"{label:<40}{g:>8,}{tt:>11,}{tt/g:>5.0f}x{ft:>12,}{ft/g:>6.0f}x")
    else:
        print(f"{label:<40}{g:>8,}{'n/a':>11}{'-':>6}{'n/a':>12}{'-':>7}")
print("-" * 84)
if ratios:
    import math
    gm = math.exp(sum(map(math.log, ratios)) / len(ratios))
    print(f"{'geometric mean vs targeted grep':<40}{'':>8}{'':>11}{gm:>5.0f}x")
print("\ntargeted = grep -rl, then read the matching files (the realistic competitor).")
print("full     = the same plus all migrations, which is what a DB-spanning")
print("           question actually forces, since grepping a table name in 2.6MB")
print("           of SQL returns the whole baseline schema anyway.")
