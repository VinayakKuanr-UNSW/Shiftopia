#!/usr/bin/env python3
"""Deterministic SQL + cross-layer extractor for graphify.

The AST extractor understands .ts/.tsx/.py but not .sql, so 173 migrations
(~272k words) were invisible to the graph. This adds them, plus the edges that
join the TypeScript layer to the database layer:

    ts_file --calls_rpc--> db_function     (supabase.rpc('name'))
    ts_file --queries-->   db_table        (supabase.from('table'))

Those two edge types are what make impact analysis a traversal instead of a
repo-wide grep: "change this migration -> which UI files break?"

No LLM involved. Run: python3 scripts/graphify/sql_layer.py
"""
from __future__ import annotations
import json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "graphify-out" / ".sql_layer.json"

def nid(*parts: str) -> str:
    s = "_".join(str(p) for p in parts if p)
    return re.sub(r"[^a-z0-9_]", "_", s.lower()).strip("_")

def file_node_id(rel: str) -> str:
    """Match the id the AST extractor assigns to a file node."""
    return re.sub(r"[^a-z0-9_]", "_", rel.lower()).strip("_")

def strip_sql_comments(t: str) -> str:
    t = re.sub(r"/\*.*?\*/", " ", t, flags=re.S)
    t = re.sub(r"--[^\n]*", " ", t)
    return t

Q = r'(?:"([a-zA-Z0-9_]+)"|([a-zA-Z0-9_]+))'          # quoted or bare ident
OBJ = rf'(?:{Q}\s*\.\s*)?{Q}'                          # [schema.]name

def obj_name(m: re.Match, i: int) -> tuple[str, str]:
    """Return (schema, name) from an OBJ match starting at group i."""
    schema = m.group(i) or m.group(i + 1) or "public"
    name = m.group(i + 2) or m.group(i + 3) or ""
    return schema, name

PATTERNS = {
    "create_table": re.compile(rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?{OBJ}', re.I),
    "alter_table":  re.compile(rf'\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?{OBJ}', re.I),
    "create_view":  re.compile(rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?{OBJ}', re.I),
    "create_fn":    re.compile(rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+{OBJ}\s*\(', re.I),
    "drop_fn":      re.compile(rf'\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?{OBJ}', re.I),
    "create_trg":   re.compile(rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+{Q}', re.I),
    "create_pol":   re.compile(rf'\bCREATE\s+POLICY\s+{Q}\s+ON\s+{OBJ}', re.I),
    "drop_pol":     re.compile(rf'\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?{Q}\s+ON\s+{OBJ}', re.I),
    "create_idx":   re.compile(rf'\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?{Q}\s+ON\s+(?:ONLY\s+)?{OBJ}', re.I),
    "enable_rls":   re.compile(rf'\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?{OBJ}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY', re.I),
}
TRG_ON = re.compile(rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+{Q}.*?\bON\s+{OBJ}', re.I | re.S)
# tables referenced inside a body (FROM / JOIN / INSERT INTO / UPDATE / DELETE FROM)
BODY_REF = re.compile(rf'\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+{OBJ}', re.I)
SQL_KEYWORDS = {"select","where","exists","values","set","only","lateral","unnest","generate_series",
                "jsonb_array_elements","json_array_elements","dual","new","old","public","pg_catalog"}

def line_of(text: str, pos: int) -> str:
    return f"L{text.count(chr(10), 0, pos) + 1}"

def main() -> int:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    tables: set[str] = set()
    functions: set[str] = set()

    def add_node(_id, label, source_file, loc=None, ntype="code", **extra):
        if _id and _id not in nodes:
            nodes[_id] = {"id": _id, "label": label, "file_type": ntype,
                          "source_file": source_file, "source_location": loc,
                          "source_url": None, "captured_at": None,
                          "author": None, "contributor": None, **extra}

    def add_edge(s, t, rel, conf="EXTRACTED", score=1.0, sf=None, loc=None):
        if s and t and s != t:
            edges.append({"source": s, "target": t, "relation": rel, "confidence": conf,
                          "confidence_score": score, "source_file": sf,
                          "source_location": loc, "weight": 1.0})

    def tbl_id(schema, name):
        if not name or name.lower() in SQL_KEYWORDS:
            return None
        schema = (schema or "public").lower()
        return nid("db_tbl", schema if schema != "public" else "", name)

    # ---------- migrations ----------
    mig_dir = ROOT / "supabase" / "migrations"
    mig_files = sorted(mig_dir.rglob("*.sql")) if mig_dir.exists() else []

    # PASS 1 - collect only DDL-declared objects, so body scans in PASS 2 can be
    # restricted to real tables instead of inventing nodes from CTEs/aliases.
    ddl_tables: set[str] = set()
    for f in mig_files:
        t1 = strip_sql_comments(f.read_text(encoding="utf-8", errors="ignore"))
        for kind in ("create_table", "alter_table", "create_view"):
            for m in PATTERNS[kind].finditer(t1):
                tid = tbl_id(*obj_name(m, 1))
                if tid:
                    ddl_tables.add(tid)
    for f in mig_files:
        rel = str(f.relative_to(ROOT))
        raw = f.read_text(encoding="utf-8", errors="ignore")
        text = strip_sql_comments(raw)
        stem = f.stem
        mid = nid("mig", stem)
        add_node(mid, stem, rel, "L1", ntype="document")

        def emit(kind, rel_name):
            for m in PATTERNS[kind].finditer(text):
                schema, name = obj_name(m, 1)
                tid = tbl_id(schema, name)
                if not tid:
                    continue
                add_node(tid, f"{schema}.{name}" if schema != "public" else name, rel, line_of(text, m.start()))
                tables.add(tid)
                add_edge(mid, tid, rel_name, sf=rel, loc=line_of(text, m.start()))

        emit("create_table", "creates")
        emit("alter_table", "alters")
        emit("create_view", "creates")
        emit("enable_rls", "secures")

        for m in PATTERNS["create_fn"].finditer(text):
            schema, name = obj_name(m, 1)
            if not name:
                continue
            fid = nid("db_fn", name)
            add_node(fid, f"{name}()", rel, line_of(text, m.start()))
            functions.add(fid)
            add_edge(mid, fid, "defines", sf=rel, loc=line_of(text, m.start()))
            # function body -> tables it touches
            tail = text[m.end(): m.end() + 12000]
            for bm in BODY_REF.finditer(tail):
                bs, bn = obj_name(bm, 1)
                btid = tbl_id(bs, bn)
                if btid in ddl_tables:          # never invent a table from a body scan
                    add_edge(fid, btid, "queries", "INFERRED", 0.85, rel, line_of(text, m.start()))

        for m in PATTERNS["create_pol"].finditer(text):
            pol = m.group(1) or m.group(2)
            schema, name = obj_name(m, 3)
            tid = tbl_id(schema, name)
            pid = nid("db_pol", name, pol)
            if pol and tid:
                add_node(pid, f"RLS: {pol}", rel, line_of(text, m.start()))
                add_edge(mid, pid, "defines", sf=rel, loc=line_of(text, m.start()))
                add_node(tid, name, rel, None); tables.add(tid)
                add_edge(pid, tid, "secures", sf=rel, loc=line_of(text, m.start()))

        for m in TRG_ON.finditer(text):
            trg = m.group(1) or m.group(2)
            schema, name = obj_name(m, 3)
            tid = tbl_id(schema, name)
            gid = nid("db_trg", trg)
            if trg and tid:
                add_node(gid, f"trigger {trg}", rel, line_of(text, m.start()))
                add_edge(mid, gid, "defines", sf=rel, loc=line_of(text, m.start()))
                add_node(tid, name, rel, None); tables.add(tid)
                add_edge(gid, tid, "fires_on", sf=rel, loc=line_of(text, m.start()))

        for m in PATTERNS["create_idx"].finditer(text):
            idx = m.group(1) or m.group(2)
            schema, name = obj_name(m, 3)
            tid = tbl_id(schema, name)
            if idx and tid:
                iid = nid("db_idx", idx)
                add_node(iid, f"index {idx}", rel, line_of(text, m.start()))
                add_edge(mid, iid, "defines", sf=rel, loc=line_of(text, m.start()))
                add_node(tid, name, rel, None); tables.add(tid)
                add_edge(iid, tid, "indexes", sf=rel, loc=line_of(text, m.start()))

    # ---------- cross-layer: TS/Python -> DB ----------
    RPC = re.compile(r"""\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]""")
    FROM = re.compile(r"""\.from\(\s*['"]([a-zA-Z0-9_]+)['"]""")
    code_roots = [ROOT / "src", ROOT / "supabase" / "functions", ROOT / "optimizer-service", ROOT / "scripts"]
    xrpc = xfrom = xref = xdoc = 0
    for croot in code_roots:
        if not croot.exists():
            continue
        for f in croot.rglob("*"):
            if f.suffix not in {".ts", ".tsx", ".py", ".js"} or ".venv" in f.parts or "node_modules" in f.parts:
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if ".rpc(" not in text and ".from(" not in text:
                continue
            rel = str(f.relative_to(ROOT))
            src_id = file_node_id(rel)
            add_node(src_id, rel, rel, "L1")  # path label: bare "index.ts" fuzzy-merges
            for m in RPC.finditer(text):
                fid = nid("db_fn", m.group(1))
                if fid in functions:
                    add_edge(src_id, fid, "calls_rpc", sf=rel, loc=line_of(text, m.start()))
                    xrpc += 1
            # Strip comments so a name that survives is genuinely in executable
            # code (e.g. `rpcName: 'sm_apply_shift_op'`) rather than a docblock.
            code_only = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
            code_only = re.sub(r"(?m)^\s*//[^\n]*", " ", code_only)
            code_only = re.sub(r"(?m)^\s*#[^\n]*", " ", code_only)
            for fname in set(re.findall(r"""['"]([a-z][a-z0-9_]{4,})['"]""", text)):
                fid = nid("db_fn", fname)
                if fid not in functions:
                    continue
                if f".rpc('{fname}'" in text or f'.rpc("{fname}"' in text:
                    continue                      # already an EXTRACTED calls_rpc
                if re.search(rf"""['"]{re.escape(fname)}['"]""", code_only):
                    add_edge(src_id, fid, "invokes_rpc_indirectly", "INFERRED", 0.85, rel, None)
                    xref += 1
                else:
                    add_edge(src_id, fid, "documents_rpc", "INFERRED", 0.60, rel, None)
                    xdoc += 1
            for m in FROM.finditer(text):
                tid = tbl_id("public", m.group(1))
                if tid in tables:
                    add_edge(src_id, tid, "queries", sf=rel, loc=line_of(text, m.start()))
                    xfrom += 1

    payload = {"nodes": list(nodes.values()), "edges": edges, "hyperedges": [],
               "input_tokens": 0, "output_tokens": 0}
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"migrations parsed : {len(mig_files)}")
    print(f"nodes             : {len(nodes):,}  (tables {len(tables)}, functions {len(functions)})")
    print(f"edges             : {len(edges):,}")
    print(f"cross-layer edges : {xrpc} calls_rpc, {xref} invokes_indirectly, {xdoc} documents_rpc, {xfrom} queries")
    print(f"written           : {OUT.relative_to(ROOT)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
