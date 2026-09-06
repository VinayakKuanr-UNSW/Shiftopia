#!/usr/bin/env python3
"""Typed, budgeted retrieval over graphify's graph.

Why this exists: `graphify query` does undirected BFS. On a code graph with god
nodes (cn() has 283 edges, Button 169) a depth-2 hop from any node lands in the
UI primitives and spends the whole token budget on noise. Every question below
is answered by traversing ONLY the edge types that can carry the answer.

  ask.py impact  <table|fn>   who breaks if this DB object changes
  ask.py surface <path frag>  which DB objects a file/module touches
  ask.py owns    <table|fn>   which migrations define it (+ RLS/triggers)
  ask.py rules   <frag>       compliance/domain symbols matching a fragment
"""
from __future__ import annotations
import json, sys
from collections import defaultdict
from pathlib import Path

G = json.loads((Path(__file__).resolve().parents[2] / "graphify-out/graph.json").read_text())
N = {n["id"]: n for n in G["nodes"]}
E = G.get("links", G.get("edges", []))

OUT, IN = defaultdict(list), defaultdict(list)
for e in E:
    s, t, r = e.get("source"), e.get("target"), e.get("relation")
    OUT[s].append((t, r, e)); IN[t].append((s, r, e))

# Edge types that actually carry a data-dependency. Everything else (imports,
# contains, calls between UI components) is structural noise for these queries.
DEP = {"queries", "calls_rpc", "invokes_rpc_indirectly", "defines", "secures",
       "fires_on", "indexes", "alters", "creates"}

def find(frag: str, prefix: tuple[str, ...] = ()) -> list[str]:
    f = frag.lower()
    hits = [i for i, n in N.items()
            if (not prefix or i.startswith(prefix))
            and (f in n.get("label", "").lower() or f in i.lower())]
    return sorted(hits, key=lambda i: (len(N[i].get("label", "")), i))

def loc(i: str) -> str:
    n = N[i]; sf = n.get("source_file") or "?"; l = n.get("source_location") or ""
    return f"{sf}{'#' + l if l else ''}"

def cmd_impact(frag: str) -> None:
    seeds = find(frag, ("db_tbl_", "db_fn_"))
    if not seeds:
        print(f"no DB object matching '{frag}'"); return
    seed = seeds[0]
    print(f"IMPACT OF: {N[seed]['label']}  [{loc(seed)}]\n")
    code, sql, guards, migs = [], [], [], []
    for src, rel, e in IN[seed]:
        if rel not in DEP: continue
        row = (rel, N[src]["label"], e.get("source_location") or "")
        if src.startswith("mig_"): migs.append(row)
        elif src.startswith(("db_pol_", "db_trg_", "db_idx_")): guards.append(row)
        elif src.startswith("db_fn_"): sql.append(row)
        else: code.append((rel, N[src].get("source_file") or N[src]["label"], e.get("source_location") or ""))
    def show(title, rows, cap=14):
        if not rows: return
        print(f"{title} ({len(rows)})")
        for rel, who, l in sorted(set(rows))[:cap]:
            print(f"  {rel:<15} {who}{' #' + l if l else ''}")
        if len(set(rows)) > cap: print(f"  … +{len(set(rows))-cap} more")
        print()
    show("APPLICATION CODE", code)
    show("SQL FUNCTIONS", sql)
    show("RLS / TRIGGERS / INDEXES", guards)
    show("DEFINED-BY MIGRATIONS", migs, 8)

def cmd_surface(frag: str) -> None:
    hits = [i for i in N if frag.lower() in (N[i].get("source_file") or "").lower()
            and not i.startswith(("db_", "mig_"))]
    if not hits: print(f"no code node matching '{frag}'"); return
    touched = defaultdict(set)
    for i in hits:
        for t, r, e in OUT[i]:
            if t.startswith(("db_tbl_", "db_fn_")) and r in DEP:
                touched[r].add((N[t]["label"], N[i].get("source_file")))
    print(f"DB SURFACE OF: {frag}  ({len(hits)} code nodes)\n")
    if not touched: print("  (touches no DB object directly)")
    for r, s in sorted(touched.items()):
        print(f"{r} ({len(s)})")
        for lab, f in sorted(s)[:20]: print(f"  {lab:<38} <- {f}")
        print()

def cmd_owns(frag: str) -> None:
    for seed in find(frag, ("db_tbl_", "db_fn_"))[:3]:
        print(f"{N[seed]['label']}  [{loc(seed)}]")
        for src, rel, e in IN[seed]:
            if src.startswith("mig_") and rel in DEP:
                print(f"   {rel:<10} {N[src]['label']}")
        for src, rel, e in IN[seed]:
            if src.startswith(("db_pol_", "db_trg_")):
                print(f"   {rel:<10} {N[src]['label']}")
        print()

def cmd_docs(frag: str) -> None:
    """Documentation SECTIONS that describe whatever matches frag."""
    hits = [i for i in N if frag.lower() in (N[i].get("label", "") + " " + (N[i].get("source_file") or "")).lower()
            and not str(N[i].get("source_file", "")).endswith(".md")]
    found = {}
    for i in hits:
        for src, rel, e in IN[i]:
            if rel == "documents":
                found.setdefault(src, set()).add(N[i]["label"])
    if not found:
        print(f"no documentation section describes '{frag}'"); return
    print(f"DOCUMENTED BY ({len(found)} sections)\n")
    for sec, what in sorted(found.items(), key=lambda kv: -len(kv[1]))[:14]:
        n = N[sec]
        print(f"* {n['label'][:64]}")
        print(f"    {n.get('source_file')}#{n.get('source_location')}")
        print(f"    covers: {', '.join(sorted(what)[:6])}")
        print()

def cmd_warnings(frag: str) -> None:
    """Institutional memory attached to whatever matches frag."""
    hits = [i for i in N if frag.lower() in (N[i].get("label", "") + " " + (N[i].get("source_file") or "")).lower()
            and not i.startswith("mem_")]
    seen = {}
    for i in hits:
        for src, rel, e in IN[i]:
            if rel == "warns_about":
                seen.setdefault(src, set()).add(N[i]["label"])
    if not seen:
        print(f"no recorded memory touches '{frag}'"); return
    print(f"RECORDED KNOWLEDGE TOUCHING '{frag}'\n")
    for m, targets in sorted(seen.items(), key=lambda kv: -len(kv[1])):
        n = N[m]
        print(f"* {n['label']}")
        if n.get("rationale"): print(f"    {n['rationale']}")
        print(f"    touches: {', '.join(sorted(targets)[:6])}")
        print(f"    file: {n.get('source_file')}")
        print()

def cmd_brief(frag: str) -> None:
    """Everything the graph knows about one entity, across all four layers.

    This is the default entry point: it answers "what am I touching?" in one
    hop instead of four, and stays inside ~600 tokens by capping each section.
    """
    seeds = find(frag, ("db_tbl_", "db_fn_")) or find(frag)
    if not seeds:
        print(f"nothing matching '{frag}'"); return
    s0 = seeds[0]; n = N[s0]
    print(f"{n['label']}   [{loc(s0)}]")
    print("=" * min(78, len(n['label']) + 24))

    defined = [N[u]['label'] for u, r, _ in IN[s0] if u.startswith('mig_') and r in DEP]
    if defined:
        print(f"\nDEFINED BY   {', '.join(sorted(set(defined))[:3])}")

    callers = sorted({(r, N[u].get('source_file') or N[u]['label'])
                      for u, r, _ in IN[s0] if r in ('calls_rpc', 'invokes_rpc_indirectly', 'queries')
                      and not u.startswith(('db_', 'mig_'))})
    if callers:
        print(f"\nCALLED FROM ({len(callers)})")
        for r, f in callers[:8]: print(f"  {r:<24} {f}")
        if len(callers) > 8: print(f"  … +{len(callers)-8} more  (ask.py impact {frag})")

    sqlfns = sorted({N[u]['label'] for u, r, _ in IN[s0] if u.startswith('db_fn_') and r in DEP})
    if sqlfns:
        print(f"\nSQL FUNCTIONS TOUCHING IT ({len(sqlfns)})")
        print("  " + ", ".join(sqlfns[:10]) + (f" … +{len(sqlfns)-10}" if len(sqlfns) > 10 else ""))

    guards = sorted({N[u]['label'] for u, r, _ in IN[s0] if u.startswith(('db_pol_', 'db_trg_'))})
    if guards:
        print(f"\nGUARDS ({len(guards)})")
        print("  " + ", ".join(guards[:8]) + (f" … +{len(guards)-8}" if len(guards) > 8 else ""))

    warns = [(N[u]['label'], N[u].get('rationale') or '') for u, r, _ in IN[s0] if r == 'warns_about']
    if warns:
        print(f"\n⚠ RECORDED KNOWLEDGE ({len(warns)})")
        for lab, why in sorted(set(warns))[:4]:
            print(f"  {lab}")
            if why: print(f"      {why[:132]}")

    docs = [(N[u]['label'], f"{N[u].get('source_file')}#{N[u].get('source_location')}")
            for u, r, _ in IN[s0] if r == 'documents']
    if docs:
        print(f"\nDOCUMENTED IN ({len(docs)})")
        for lab, where in sorted(set(docs))[:4]: print(f"  {lab[:52]:<54} {where}")

def cmd_rules(frag: str) -> None:
    for i in find(frag)[:25]:
        print(f"{N[i]['label']:<42} {loc(i)}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    {"impact": cmd_impact, "surface": cmd_surface, "owns": cmd_owns, "rules": cmd_rules, "warnings": cmd_warnings, "docs": cmd_docs, "brief": cmd_brief}[sys.argv[1]](sys.argv[2])
