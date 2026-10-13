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

from graph_ids import LAYER_PREFIXES, is_file_node, make_id

ROOT = Path(__file__).resolve().parents[2]
code = json.loads((ROOT / "graphify-out/graph.json").read_text())
sql = json.loads((ROOT / "graphify-out/.sql_layer.json").read_text())
semf = ROOT / "graphify-out/semantic/graphify-out/graph.json"
if semf.exists():
    _s = json.loads(semf.read_text())
    sem = {"nodes": _s.get("nodes", []), "edges": _s.get("links", _s.get("edges", []))}
else:
    sem = {"nodes": [], "edges": []}
docf = ROOT / "graphify-out/.docs_layer.json"
docs = json.loads(docf.read_text()) if docf.exists() else {"nodes": [], "edges": []}
memf = ROOT / "graphify-out/.memory_layer.json"
mem = json.loads(memf.read_text()) if memf.exists() else {"nodes": [], "edges": []}

# graph.json is graphify's rebuild of the PREVIOUS merged graph, so it still
# carries last run's layer output. Strip it before adding this run's, or stale
# layer nodes/edges (a deleted memory, a renamed table, a ghost file node a
# layer minted under an old id scheme) survive every rebuild.
# Relations only the layers write. `defines` is shared — graphify emits it for
# some languages — so it is only stripped when a layer node is its source.
LAYER_RELATIONS = {"calls_rpc", "documents_rpc", "fires_on", "indexes",
                   "invokes_rpc_indirectly", "queries", "secures", "documents",
                   "warns_about", "relates_to"}

def _is_layer_node(n: dict) -> bool:
    i, sf = n["id"], str(n.get("source_file") or "")
    if i.startswith(LAYER_PREFIXES):
        return True
    # sql_layer labels the file nodes it mints with the full path; graphify
    # labels its own with the basename.
    return "/" in sf and n.get("label") == sf

code_nodes = [n for n in code["nodes"] if not _is_layer_node(n)]
code_edges = [e for e in code.get("links", code.get("edges", []))
              if e.get("relation") not in LAYER_RELATIONS
              and not (e.get("relation") == "defines" and str(e.get("source", "")).startswith(LAYER_PREFIXES))
              # both ends on layer nodes: only a previous merge could have made it
              and not (str(e.get("source", "")).startswith(LAYER_PREFIXES)
                       and str(e.get("target", "")).startswith(LAYER_PREFIXES))]

# graphify's SQL extractor parses supabase/tests, seed, audits and scripts
# (migrations are ignored). Only migrations DEFINE database objects, so every
# table or function it mints from those files — a per-file node like
# `supabase_tests_x_public_leave_requests`, or a sourceless name stub — is a
# REFERENCE to a real object. Point it at sql_layer's canonical node, so test
# and seed SQL joins the real table instead of standing beside a copy of it.
sql_ids = {n["id"] for n in sql["nodes"]}
source_of = {n["id"]: str(n.get("source_file") or "") for n in code_nodes}
from_sql = {e["target"] for e in code_edges if source_of.get(e["source"], "").endswith(".sql")}

def _db_node_for(label: str):
    name = label.strip().strip('"').lower()
    name = name[:-2] if name.endswith("()") else name
    schema, _, obj = name.rpartition(".")
    for kind in ("db_tbl", "db_fn"):
        cand = make_id(kind, "" if schema in ("", "public") else schema, obj)
        if cand in sql_ids:
            return cand
    return None

alias = {}
for n in code_nodes:
    sf = source_of.get(n["id"], "")
    from_sql_file = sf.endswith(".sql") and not is_file_node(n)
    sourceless_ref = not sf and n["id"] in from_sql
    if from_sql_file or sourceless_ref:
        target = _db_node_for(n.get("label") or "")
        if target:
            alias[n["id"]] = target
code_nodes = [n for n in code_nodes if n["id"] not in alias]

def _realias(e: dict) -> dict:
    s, t = alias.get(e["source"], e["source"]), alias.get(e["target"], e["target"])
    rel = e.get("relation")
    # "this test file contains public.x" is really "it references the table".
    if rel == "contains" and t != e["target"]:
        rel = "references"
    return {**e, "source": s, "target": t, "relation": rel}

# An edge with BOTH ends aliased describes the file's local copy of an object
# (a test that redefines a function) — the canonical layer already describes
# the real one, and the graph keeps one edge per node pair, so letting the copy
# through would overwrite sql_layer's edge for that pair.
code_edges = [_realias(e) for e in code_edges
              if not (e["source"] in alias and e["target"] in alias)
              and alias.get(e["source"], e["source"]) != alias.get(e["target"], e["target"])]

nodes, seen = [], set()
for n in code_nodes + sql["nodes"] + mem["nodes"] + docs["nodes"] + sem["nodes"]:
    if n["id"] not in seen:
        seen.add(n["id"]); nodes.append(n)
edges = [e for e in code_edges + sql["edges"] + mem["edges"] + docs["edges"] + sem["edges"]
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
            # No member has a file: external references (a library type such
            # as pydantic's BaseModel) — name them by what they are.
            top = [l for l, _ in labs.most_common(2)]
            out[cid] = ("external — " + ", ".join(top)) if top else f"Community {cid}"
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
