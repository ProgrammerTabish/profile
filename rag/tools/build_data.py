"""Build the browser data for the Private RAG Assistant demo (rag/index.html).

Input : db_data/ from ProgrammerTabish/private-rag-assistant (rag_db/rag_db_data.tar.gz)
        - chunks.jsonl            12,186 chunks of the 50 regulatory PDFs
        - qdrant/.../storage.sqlite   the real BGE-M3 dense vectors (1024-d)
Output: rag/data/meta.json        docs + chunk metadata (doc, section, pages)
        rag/data/texts.json       chunk texts, same order
        rag/data/vec96.bin        BGE-M3 vectors, PCA 1024->96, L2-normalised, int8
        rag/data/xyz.bin          3D UMAP layout of the vectors, int16 (for the 3D map)

Usage:  python build_data.py /path/to/db_data
Needs:  numpy, qdrant-client (to unpickle points), umap-learn
"""
import json, pickle, sqlite3, sys, re
from pathlib import Path
import numpy as np

DB = Path(sys.argv[1] if len(sys.argv) > 1 else "db_data")
OUT = Path(__file__).resolve().parent.parent / "data"
DIMS = 96

GROUPS = [  # (first doc number, label) - topic families used for colouring
    (1, "AML / KYC"), (13, "Sanctions"), (21, "Governance"), (24, "Data & whistleblowing"),
    (27, "DORA / ICT"), (36, "Securities"), (46, "Payments"),
]

def group_of(doc_id):
    n = int(doc_id[:2]); g = 0
    for i, (start, _) in enumerate(GROUPS):
        if n >= start: g = i
    return g

chunks = [json.loads(l) for l in open(DB / "chunks.jsonl", encoding="utf-8")]
order = {c["chunk_id"]: i for i, c in enumerate(chunks)}

docs, doc_idx, sections, sec_idx = [], {}, [], {}
rows, texts = [], []
for c in chunks:
    if c["doc_id"] not in doc_idx:
        doc_idx[c["doc_id"]] = len(docs)
        docs.append({"id": c["doc_id"], "file": c["file"], "title": c["title"], "reg": c["regulator"],
                     "type": c["doc_type"], "g": group_of(c["doc_id"])})
    s = c["section"] or ""
    if s not in sec_idx:
        sec_idx[s] = len(sections); sections.append(s)
    rows.append([doc_idx[c["doc_id"]], sec_idx[s], c["page_start"], c["page_end"]])
    texts.append(re.sub(r"[ \t ]+", " ", c["text"]).strip())

con = sqlite3.connect(DB / "qdrant/collection/spg_compliance/storage.sqlite")
V = np.zeros((len(chunks), 1024), np.float32)
for _, blob in con.execute("select id, point from points"):
    p = pickle.loads(blob)
    V[order[p.payload["chunk_id"]]] = p.vector["dense"]
V /= np.linalg.norm(V, axis=1, keepdims=True)
X = V - V.mean(0)
_, _, Wt = np.linalg.svd(X[::3], full_matrices=False)

P = X @ Wt[:DIMS].T
P /= np.linalg.norm(P, axis=1, keepdims=True)
scale = float(np.abs(P).max())
(np.round(P / scale * 127).astype(np.int8)).tofile(OUT / "vec96.bin")

import umap
Y = umap.UMAP(n_components=3, n_neighbors=30, min_dist=0.25, metric="cosine",
              random_state=7).fit_transform(X @ Wt[:50].T)
Y = (Y - Y.mean(0)) / np.abs(Y - Y.mean(0)).max()
(np.round(Y * 32000).astype(np.int16)).tofile(OUT / "xyz.bin")

dump = lambda obj, name: json.dump(obj, open(OUT / name, "w", encoding="utf-8"), ensure_ascii=False,
                                   separators=(",", ":"))
dump({"source": "ProgrammerTabish/private-rag-assistant rag_db (BGE-M3, 50 PDFs)", "dims": DIMS,
      "groups": [g for _, g in GROUPS], "docs": docs, "sections": sections, "chunks": rows}, "meta.json")
dump(texts, "texts.json")
print(len(chunks), "chunks,", len(docs), "docs ->", OUT)
