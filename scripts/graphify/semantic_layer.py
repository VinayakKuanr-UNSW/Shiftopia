#!/usr/bin/env python3
"""Semantic extraction over docs/ via Gemini.

The other three layers are structural: AST for code, regex for SQL, identifier
matching for docs and memory. They capture WHAT exists and what references
what. They cannot capture WHY -- the rationale, trade-offs and design intent
that only exist as prose in docs/ and the EBA rulebook.

Scoped deliberately to docs/. Code is already covered by AST and SQL by
sql_layer.py; paying a model to re-derive import edges it can read for free
would be waste. Docs are the one corpus whose value is genuinely semantic.

Reads GEMINI_API_KEY from .env.graphify (gitignored). graphify caches results
per file, so re-runs only pay for what changed.

Run: python3 scripts/graphify/semantic_layer.py [--deep] [--limit N]
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Load the key from the gitignored env file rather than argv, so it never
# lands in shell history or a process listing.
envf = ROOT / ".env.graphify"
if envf.exists():
    for line in envf.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
if not os.environ.get("GEMINI_API_KEY"):
    sys.exit("GEMINI_API_KEY not set (expected in .env.graphify)")

from graphify.llm import extract_corpus_parallel  # noqa: E402

docs = sorted(p for p in (ROOT / "docs").rglob("*.md"))
docs += sorted(ROOT.glob("*.md"))
if "--limit" in sys.argv:
    docs = docs[: int(sys.argv[sys.argv.index("--limit") + 1])]

words = sum(len(p.read_text(encoding="utf-8", errors="ignore").split()) for p in docs)
print(f"corpus: {len(docs)} docs, ~{words:,} words", flush=True)

done = {"n": 0}


def progress(*_a, **_k):
    done["n"] += 1
    print(f"  chunk {done['n']} done", flush=True)


t0 = time.time()
res = extract_corpus_parallel(
    docs,
    backend="gemini",
    model=os.environ.get("GRAPHIFY_GEMINI_MODEL", "gemini-3-flash-preview"),
    root=ROOT,
    on_chunk_done=progress,
    token_budget=60_000,
    max_concurrency=4,
    deep_mode="--deep" in sys.argv,
    cache_root=ROOT,
)

out = {
    "nodes": res.get("nodes", []),
    "edges": res.get("edges", []),
    "hyperedges": res.get("hyperedges", []),
    "input_tokens": res.get("input_tokens", 0),
    "output_tokens": res.get("output_tokens", 0),
}
(ROOT / "graphify-out/.semantic_layer.json").write_text(json.dumps(out, indent=1))

print(f"\nelapsed {time.time() - t0:.0f}s")
print(f"nodes {len(out['nodes']):,}  edges {len(out['edges']):,}  hyperedges {len(out['hyperedges'])}")
print("relations:", Counter(e.get("relation") for e in out["edges"]).most_common(10))
print("confidence:", Counter(e.get("confidence") for e in out["edges"]).most_common())
print(f"tokens: {out['input_tokens']:,} in / {out['output_tokens']:,} out")
