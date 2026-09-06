#!/usr/bin/env python3
"""Attach institutional memory to the code/DB entities it warns about.

MEMORY.md (~2.9k tokens) is injected into EVERY session, and it indexes 111
memory files (~70k words) that are never loaded unless someone guesses the right
one. That knowledge is the most expensive kind in the repo -- it records WHY a
decision was made, which migration is actually applied, and where the landmines
are -- and none of it was reachable by graph traversal.

This makes each memory a node and links it three ways:
  memory --relates_to--> memory     (the [[wikilinks]] already in the files)
  memory --warns_about-> db_fn/tbl  (SQL identifiers named in the text)
  memory --warns_about-> code file  (repo paths named in the text)

Effect: an agent traversing to sm_apply_shift_op or to shifts.commands.ts picks
up the recorded landmine for free, instead of re-deriving it or missing it.
No LLM. Run: python3 scripts/graphify/memory_layer.py
"""
from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEM = Path.home() / ".claude/projects/-Users-vinayakkuanr-Documents-Superman-ULTIMATE/memory"
GRAPH = json.loads((ROOT / "graphify-out/graph.json").read_text())
N = {n["id"]: n for n in GRAPH["nodes"]}

# label -> id for DB objects, and known repo file paths
db_by_label = {}
for i, n in N.items():
    if i.startswith(("db_fn_", "db_tbl_")):
        db_by_label.setdefault(re.sub(r"\(\)$", "", n["label"]).lower(), i)
paths = {(n.get("source_file") or "").lower(): i for i, n in N.items() if n.get("source_file")}

def nid(s: str) -> str:
    return "mem_" + re.sub(r"[^a-z0-9_]", "_", s.lower()).strip("_")

nodes, edges = [], []
WIKI = re.compile(r"\[\[([^\]]+)\]\]")
PATH = re.compile(r"\b((?:src|supabase|optimizer-service|scripts|docs)/[\w./-]+\.\w+)")
IDENT = re.compile(r"`([a-z][a-z0-9_]{4,})`")

files = sorted(p for p in MEM.glob("*.md") if p.name != "MEMORY.md")
for f in files:
    text = f.read_text(encoding="utf-8", errors="ignore")
    name = f.stem
    mid = nid(name)
    desc = ""
    m = re.search(r"^description:\s*(.+)$", text, re.M)
    if m:
        desc = m.group(1).strip()[:160]
    nodes.append({"id": mid, "label": name, "file_type": "rationale",
                  "source_file": str(f), "source_location": "L1",
                  "source_url": None, "captured_at": None, "author": None,
                  "contributor": None, "rationale": desc})
    seen = set()
    for w in WIKI.findall(text):
        t = nid(w.strip())
        if t != mid and (t, "relates_to") not in seen:
            seen.add((t, "relates_to"))
            edges.append({"source": mid, "target": t, "relation": "relates_to",
                          "confidence": "EXTRACTED", "confidence_score": 1.0,
                          "source_file": str(f), "source_location": None, "weight": 1.0})
    for p in set(PATH.findall(text)):
        tid = paths.get(p.lower())
        if tid:
            edges.append({"source": mid, "target": tid, "relation": "warns_about",
                          "confidence": "EXTRACTED", "confidence_score": 1.0,
                          "source_file": str(f), "source_location": None, "weight": 1.0})
    for ident in set(IDENT.findall(text)):
        tid = db_by_label.get(ident.lower())
        if tid:
            edges.append({"source": mid, "target": tid, "relation": "warns_about",
                          "confidence": "EXTRACTED", "confidence_score": 1.0,
                          "source_file": str(f), "source_location": None, "weight": 1.0})

known = {n["id"] for n in nodes} | set(N)
edges = [e for e in edges if e["target"] in known]
out = {"nodes": nodes, "edges": edges, "hyperedges": [], "input_tokens": 0, "output_tokens": 0}
(ROOT / "graphify-out/.memory_layer.json").write_text(json.dumps(out, indent=1))
w = sum(1 for e in edges if e["relation"] == "warns_about")
print(f"memories      : {len(nodes)}")
print(f"memory<->memory: {len(edges)-w}")
print(f"warns_about   : {w}  (memory -> real code/DB nodes)")
