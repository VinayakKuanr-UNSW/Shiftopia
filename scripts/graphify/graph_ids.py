"""Node-ID lookups shared by the layer scripts.

graphify decides its own node IDs, and the scheme has changed between
versions: 0.7.x named a file node `src_modules_rosters_api_shifts_api_ts`,
0.9.55 names it `src_modules_rosters_api_shifts_api` (extension dropped). An
incremental rebuild keeps whatever IDs its cache already had; a full rebuild
(`graphify update .`) mints the current scheme. A layer that RECOMPUTES a file
node's ID by formula therefore binds to a node that may not exist — on
2026-10-10 a full rebuild cut `documents` edges 1,752 -> 494 and `warns_about`
578 -> 96, and sql_layer minted a duplicate "_ts" ghost file node for every
caller.

So the layers LOOK IDs UP: a file path resolves to the file node graphify
actually wrote, and only a file graphify has never seen falls back to
graphify's own current formula.

DB nodes are read from `.sql_layer.json`, not from graph.json: migrations are
in .graphifyignore (sql_layer owns them), so every graphify rebuild evicts the
nodes sourced from them until merge_layers puts them back.
"""
from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
GRAPH_PATH = ROOT / "graphify-out" / "graph.json"
SQL_LAYER_PATH = ROOT / "graphify-out" / ".sql_layer.json"

try:  # the layer scripts run under graphify's own interpreter
    from graphify.ids import make_id as _graphify_make_id
except Exception:  # pragma: no cover — plain python3 fallback
    _graphify_make_id = None

# Layer-owned node-ID prefixes (sql_layer: db_*, mig_*; memory_layer: mem_*).
LAYER_PREFIXES = ("db_", "mig_", "mem_")


def make_id(*parts: str) -> str:
    """graphify's canonical id for these parts."""
    if _graphify_make_id is not None:
        return _graphify_make_id(*parts)
    s = "_".join(p.strip("_.") for p in parts if p)
    return re.sub(r"[^a-z0-9_]", "_", s.lower()).strip("_")


def file_stem_id(rel: str) -> str:
    """graphify's CURRENT file-node id: the repo path with the extension dropped."""
    return make_id(PurePosixPath(rel).with_suffix("").as_posix())


def legacy_file_id(rel: str) -> str:
    """The pre-0.9 file-node id: the whole path, extension included."""
    return re.sub(r"[^a-z0-9_]", "_", rel.lower()).strip("_")


def load_graph_nodes(path: Path = GRAPH_PATH) -> dict[str, dict]:
    data = json.loads(path.read_text())
    return {n["id"]: n for n in data["nodes"]}


def load_sql_layer_nodes(path: Path = SQL_LAYER_PATH) -> dict[str, dict]:
    if not path.exists():
        return {}
    return {n["id"]: n for n in json.loads(path.read_text())["nodes"]}


def file_node_index(nodes: dict[str, dict]) -> dict[str, str]:
    """lower-cased source_file -> the id of that file's FILE node.

    graphify writes one file node per source (label = the file's basename) plus
    a node per symbol, all with the same source_file. Binding a path to "any
    node with that source_file" picked whichever symbol came last; this prefers
    the file node, in this order: graphify's file-node signature (labelled with
    the basename, at L1 — the id formula differs per extractor: a .ts file node
    drops the extension, a .md one keeps it), graphify's current id, the legacy
    id, any node labelled with the basename, then any node from the file.

    A migration has no graphify node (migrations are ignored); its file node is
    sql_layer's `mig_*` node, so `mig_` stays eligible while `db_*` objects and
    `mem_*` notes — which only share a source_file — are never a file's node.
    """
    by_source: dict[str, list[tuple[str, dict]]] = {}
    for i, n in nodes.items():
        sf = n.get("source_file")
        if sf and not i.startswith(("db_", "mem_")):
            by_source.setdefault(str(sf), []).append((i, n))
    out: dict[str, str] = {}
    for sf, members in by_source.items():
        ids = {i for i, _ in members}
        base = PurePosixPath(sf).name
        pick = next((i for i, n in members if is_file_node(n)), None)
        if pick is None:
            pick = next((c for c in (file_stem_id(sf), legacy_file_id(sf)) if c in ids), None)
        if pick is None:
            pick = next((i for i, n in members if n.get("label") == base), None)
        if pick is None:
            pick = sorted(ids)[0]
        out[sf.lower()] = pick
    return out


def is_file_node(n: dict) -> bool:
    """graphify's own file node: labelled with the file's basename, at line 1."""
    sf = n.get("source_file")
    return bool(sf) and n.get("label") == PurePosixPath(str(sf)).name and n.get("source_location") == "L1"


def resolve_file_id(index: dict[str, str], rel: str) -> str:
    """The id of `rel`'s file node — looked up, else graphify's current formula."""
    return index.get(rel.lower()) or file_stem_id(rel)


def db_label_index(nodes: dict[str, dict]) -> dict[str, str]:
    """lower-cased DB object name -> its db_fn_ / db_tbl_ node id."""
    out: dict[str, str] = {}
    for i, n in nodes.items():
        if i.startswith(("db_fn_", "db_tbl_")):
            out.setdefault(re.sub(r"\(\)$", "", n["label"]).lower(), i)
    return out
