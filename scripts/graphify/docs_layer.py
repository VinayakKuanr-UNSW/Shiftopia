#!/usr/bin/env python3
"""Bind documentation sections to the code and DB objects they describe.

graphify already turns every markdown heading into a node with a line number,
but those nodes arrive inert: of 2,079 .md nodes, 1,380 had degree 1 -- linked
only to their own file -- and just 60 edges reached code at all. That is 16% of
the graph carrying no traversable information.

Docs here are dense with real identifiers (`sm_select_bid_winner` appears 59
times, `sm_apply_shift_op` 40). This walks each doc, tracks which heading owns
each line, and emits

    doc_section --documents--> db_function | db_table | code file

so retrieval lands on the ~200-word section that explains an entity rather than
the 10k-word file that contains it. Deterministic, no LLM.

Run: python3 scripts/graphify/docs_layer.py
"""
from __future__ import annotations
import json, re
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GRAPH = json.loads((ROOT / "graphify-out/graph.json").read_text())
N = {n["id"]: n for n in GRAPH["nodes"]}

# targets we can bind to
db_by_label: dict[str, str] = {}
for i, n in N.items():
    if i.startswith(("db_fn_", "db_tbl_")):
        db_by_label.setdefault(re.sub(r"\(\)$", "", n["label"]).lower(), i)
paths = {(n.get("source_file") or "").lower(): i for i, n in N.items()
         if n.get("source_file") and not str(n.get("source_file")).endswith(".md")}

# heading nodes per doc, ordered by line, so a mention can be attributed to a section
sections: dict[str, list[tuple[int, str]]] = defaultdict(list)
for i, n in N.items():
    sf = n.get("source_file") or ""
    loc = n.get("source_location") or ""
    if sf.endswith(".md") and re.fullmatch(r"L\d+", loc):
        sections[sf].append((int(loc[1:]), i))
for sf in sections:
    sections[sf].sort()

def owning_section(sf: str, line: int) -> str | None:
    arr = sections.get(sf)
    if not arr:
        return None
    k = bisect_right(arr, (line, "￿")) - 1
    return arr[k][1] if k >= 0 else arr[0][1]

IDENT = re.compile(r"`([a-z_][a-z0-9_]{4,})`")
PATH = re.compile(r"\b((?:src|supabase|optimizer-service|scripts)/[\w./-]+\.\w+)")
# words that are real table names but also ordinary English -- require the
# backtick AND a known DDL object, which IDENT already guarantees.
edges: list[dict] = []
seen: set[tuple[str, str, str]] = set()

targets = [ROOT / "docs"]
files = [f for d in targets if d.exists() for f in d.rglob("*.md")]
files += [f for f in ROOT.glob("*.md")]

bound_files = 0
for f in files:
    try:
        rel = str(f.relative_to(ROOT))
        text = f.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if rel not in sections:
        continue
    hit = False
    for lineno, line in enumerate(text.splitlines(), 1):
        for ident in IDENT.findall(line):
            tid = db_by_label.get(ident.lower())
            if not tid:
                continue
            sec = owning_section(rel, lineno)
            if not sec:
                continue
            key = (sec, tid, "documents")
            if key in seen:
                continue
            seen.add(key); hit = True
            edges.append({"source": sec, "target": tid, "relation": "documents",
                          "confidence": "EXTRACTED", "confidence_score": 1.0,
                          "source_file": rel, "source_location": f"L{lineno}", "weight": 1.0})
        for p in PATH.findall(line):
            tid = paths.get(p.lower())
            if not tid:
                continue
            sec = owning_section(rel, lineno)
            if not sec:
                continue
            key = (sec, tid, "documents")
            if key in seen:
                continue
            seen.add(key); hit = True
            edges.append({"source": sec, "target": tid, "relation": "documents",
                          "confidence": "EXTRACTED", "confidence_score": 1.0,
                          "source_file": rel, "source_location": f"L{lineno}", "weight": 1.0})
    bound_files += hit

known = set(N)
edges = [e for e in edges if e["source"] in known and e["target"] in known]
out = {"nodes": [], "edges": edges, "hyperedges": [], "input_tokens": 0, "output_tokens": 0}
(ROOT / "graphify-out/.docs_layer.json").write_text(json.dumps(out, indent=1))
kinds = defaultdict(int)
for e in edges:
    t = e["target"]
    kinds["db_function" if t.startswith("db_fn_") else "db_table" if t.startswith("db_tbl_") else "code file"] += 1
print(f"docs scanned  : {len(files)} ({bound_files} bound at least one entity)")
print(f"documents edges: {len(edges):,}  " + ", ".join(f"{v} -> {k}" for k, v in sorted(kinds.items())))
print(f"distinct sections: {len({e['source'] for e in edges}):,}")
