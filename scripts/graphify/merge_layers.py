#!/usr/bin/env python3
"""Merge the deterministic SQL layer into the code graph and re-cluster.

Uses EXACT-ID dedup only. graphify's default build() dedups by normalised label
plus fuzzy Jaro-Winkler, which on a 1,100-file TS codebase merges unrelated
entities that share a label (every index.ts, Props, handler) and produces wrong
provenance — it reported a phantom caller for sm_apply_shift_op. IDs from the
AST extractor and from sql_layer.py are already canonical and path-scoped, so
label matching can only lose information here.
"""
import json
from pathlib import Path
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections
from graphify.export import to_json

ROOT = Path(__file__).resolve().parents[2]
code = json.loads((ROOT / "graphify-out/graph.json").read_text())
sql = json.loads((ROOT / "graphify-out/.sql_layer.json").read_text())
docf = ROOT / "graphify-out/.docs_layer.json"
docs = json.loads(docf.read_text()) if docf.exists() else {"nodes": [], "edges": []}
memf = ROOT / "graphify-out/.memory_layer.json"
mem = json.loads(memf.read_text()) if memf.exists() else {"nodes": [], "edges": []}

nodes, seen = [], set()
for n in code["nodes"] + sql["nodes"] + mem["nodes"] + docs["nodes"]:
    if n["id"] not in seen:
        seen.add(n["id"]); nodes.append(n)
edges = [e for e in code.get("links", code.get("edges", [])) + sql["edges"] + mem["edges"] + docs["edges"]
         if e["source"] in seen and e["target"] in seen]

ext = {"nodes": nodes, "edges": edges,
       "hyperedges": code.get("graph", {}).get("hyperedges", []),
       "input_tokens": 0, "output_tokens": 0}
G = build_from_json(ext)
comms = cluster(G)


def derive_labels(comms, nodes_by_id):
    """Name every community from its own contents.

    Hand-written labels rot: Louvain reassigns community IDs on every re-cluster,
    and the post-commit hook re-clusters on every commit. After one rebuild the
    saved names were pointing at the wrong communities entirely -- "Roster
    Subgroup Dialogs" had become the solver regression tests. Derived names
    cannot drift, because they are recomputed from membership each time.
    """
    from collections import Counter
    out = {}
    for cid, members in comms.items():
        dirs, labs = Counter(), Counter()
        for m in members:
            n = nodes_by_id.get(m)
            if not n:
                continue
            sf = (n.get("source_file") or "").replace("\\", "/")
            if m.startswith(("db_tbl_", "db_fn_", "db_pol_", "db_trg_", "db_idx_", "mig_")):
                dirs["database"] += 1
            elif sf:
                parts = [x for x in sf.split("/") if x]
                dirs["/".join(parts[:3] if parts[0] in ("src", "docs") else parts[:2])] += 1
            lab = (n.get("label") or "").strip()
            if lab and not lab.startswith("#") and len(lab) < 42 and not lab.endswith((".ts", ".tsx", ".md", ".py", ".sql")):
                labs[lab] += 1
        if not dirs:
            out[cid] = f"Community {cid}"
            continue
        where = dirs.most_common(1)[0][0]
        where = where.replace("src/modules/", "").replace("supabase/", "").replace("docs/", "docs: ")
        top = [l for l, _ in labs.most_common(3)]
        out[cid] = (f"{where} — " + ", ".join(top[:2])) if top else where
    return out

to_json(G, comms, str(ROOT / "graphify-out/graph.json"), force=True)
nodes_by_id = {n["id"]: n for n in nodes}
labels = derive_labels(comms, nodes_by_id)
(ROOT / "graphify-out/.graphify_labels.json").write_text(
    json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False))
(ROOT / "graphify-out/.graphify_analysis.json").write_text(json.dumps({
    "communities": {str(k): v for k, v in comms.items()},
    "cohesion": {str(k): v for k, v in score_all(G, comms).items()},
    "gods": god_nodes(G), "surprises": surprising_connections(G, comms), "questions": []}))
print(f"graph: {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges, {len(comms)} communities")
