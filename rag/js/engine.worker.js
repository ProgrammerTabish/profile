/* =========================================================
   Search worker: the retrieval half of privrag, in the browser.

   Index   : the real 12,186 chunks (texts.json) -> BM25 sparse
             vectors, scored like Qdrant's sparse search with the
             IDF modifier (same tokenizer, k1=1.2, b=0.75).
   Dense   : the real BGE-M3 chunk vectors, PCA-compressed to 96
             dims (int8). The browser can't run BGE-M3 (2.2 GB) to
             embed a new question, so the query vector is built by
             pseudo-relevance feedback: the mean of the vectors of
             the top keyword hits. Cosine search then runs over all
             12,186 real vectors.
   Fusion  : weighted RRF (dense x2), top-8, max 4 chunks per doc
             - identical to retrieve/retriever.py.
   ========================================================= */
importScripts('textproc.js');
const T = self.RagText;

const CANDIDATE_K = 40, TOP_K = 8, MAX_PER_DOC = 4, DENSE_WEIGHT = 2;
let meta, texts, vec, dims, N;
let postings;            // Map token -> [chunk, weight, chunk, weight, ...]
let idf;                 // Map token -> idf
let chunkGroup;          // Int8Array

const post = (type, data) => self.postMessage({ type, ...data });

async function fetchWithProgress(url, label, weight, base) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body || !res.body.getReader) return res;
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  const expect = { 'texts.json': 11.2e6, 'vec96.bin': 1.17e6 }[url.split('/').pop()] || 1e6;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    post('progress', { label, pct: base + weight * Math.min(got / expect, 1) });
  }
  return new Response(new Blob(parts));
}

async function init({ base }) {
  const t0 = performance.now();
  post('progress', { label: 'Loading chunk metadata', pct: 0.02 });
  const [m, g] = await Promise.all([
    fetch(base + 'meta.json').then((r) => r.json()),
    fetch(base + 'glossary_en_de.json').then((r) => r.json()),
  ]);
  meta = m; T.setGlossary(g); dims = meta.dims; N = meta.chunks.length;
  chunkGroup = new Int8Array(N);
  meta.chunks.forEach((c, i) => (chunkGroup[i] = meta.docs[c[0]].g));

  const vr = await fetchWithProgress(base + 'vec96.bin', 'Loading BGE-M3 vectors', 0.12, 0.04);
  vec = new Int8Array(await vr.arrayBuffer());
  const tr = await fetchWithProgress(base + 'texts.json', 'Loading 12,186 chunk texts', 0.44, 0.16);
  texts = await tr.json();

  // BM25 document vectors, built once
  post('progress', { label: 'Building the BM25 index', pct: 0.62 });
  const toks = new Array(N); let total = 0;
  for (let i = 0; i < N; i++) {
    // what privrag indexes: chunk_embed_text() = "title | section\ntext"
    const [d, sec] = meta.chunks[i];
    const head = meta.docs[d].title + (meta.sections[sec] ? ' | ' + meta.sections[sec] : '');
    toks[i] = T.tokenize(head + '\n' + texts[i]); total += toks[i].length;
    if (i % 1500 === 0) post('progress', { label: 'Tokenizing chunks (§ / Art. / AT aware)', pct: 0.62 + 0.3 * (i / N) });
  }
  const avg = total / N;
  postings = new Map();
  for (let i = 0; i < N; i++) {
    const tf = new Map();
    for (const t of toks[i]) tf.set(t, (tf.get(t) || 0) + 1);
    const nrm = T.K1 * (1 - T.B + T.B * toks[i].length / Math.max(avg, 1));
    for (const [t, f] of tf) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push(i, f * (T.K1 + 1) / (f + nrm));
    }
  }
  idf = new Map();
  for (const [t, p] of postings) {
    const n = p.length / 2;
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));   // Qdrant Modifier.IDF
  }
  post('ready', { ms: Math.round(performance.now() - t0), vocab: postings.size, chunks: N, avgLen: Math.round(avg) });
}

function bm25(query, group) {
  const qt = [...new Set(T.tokenize(query))];
  const score = new Float32Array(N);
  const touched = [];
  for (const t of qt) {
    const p = postings.get(t); if (!p) continue;
    const w = idf.get(t);
    for (let j = 0; j < p.length; j += 2) {
      const i = p[j];
      if (group >= 0 && chunkGroup[i] !== group) continue;
      if (score[i] === 0) touched.push(i);
      score[i] += w * p[j + 1];
    }
  }
  touched.sort((a, b) => score[b] - score[a]);
  return { tokens: qt, hits: touched.slice(0, CANDIDATE_K).map((i) => ({ i, s: score[i] })),
           known: qt.filter((t) => postings.has(t)) };
}

function dense(seed, group) {
  // pseudo-relevance feedback query vector from the top keyword hits
  const q = new Float32Array(dims);
  seed.forEach((i, r) => {
    const w = 1 / (r + 1), off = i * dims;
    for (let d = 0; d < dims; d++) q[d] += w * vec[off + d];
  });
  let n = 0; for (let d = 0; d < dims; d++) n += q[d] * q[d];
  n = Math.sqrt(n) || 1; for (let d = 0; d < dims; d++) q[d] /= n;
  const sc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (group >= 0 && chunkGroup[i] !== group) { sc[i] = -9; continue; }
    let s = 0; const off = i * dims;
    for (let d = 0; d < dims; d++) s += q[d] * vec[off + d];
    sc[i] = s / 127;
  }
  const idx = Array.from({ length: N }, (_, i) => i).filter((i) => sc[i] > -9);
  idx.sort((a, b) => sc[b] - sc[a]);
  return idx.slice(0, CANDIDATE_K).map((i) => ({ i, s: sc[i] }));
}

const chunkInfo = (i) => {
  const [d, s, p0, p1] = meta.chunks[i];
  const doc = meta.docs[d];
  return { i, doc: doc.id, file: doc.file, title: doc.title, reg: doc.reg, g: doc.g,
           section: meta.sections[s] || null, p0, p1,
           pages: p0 === p1 ? `p. ${p0}` : `pp. ${p0}-${p1}` };
};

function query({ id, q, de, group }) {
  const t0 = performance.now();
  const tm = {};
  let t = performance.now();
  const sq = bm25(q, group);
  const sde = de ? bm25(de, group) : null;
  tm.sparse = performance.now() - t;

  t = performance.now();
  // two dense queries like privrag (question + German rewrite), each seeded from its keyword list
  const seed = sq.hits.slice(0, 5).map((h) => h.i);
  const seedDe = sde ? sde.hits.slice(0, 5).map((h) => h.i) : [];
  const dq = seed.length ? dense(seed, group) : [];
  const dde = seedDe.length ? dense(seedDe, group) : [];
  tm.dense = performance.now() - t;

  t = performance.now();
  const lists = { sparse_q: sq.hits.map((h) => h.i) };
  if (sde) lists.sparse_de = sde.hits.map((h) => h.i);
  if (dq.length) lists.dense_q = dq.map((h) => h.i);
  if (dde.length) lists.dense_de = dde.map((h) => h.i);
  const names = Object.keys(lists);
  const fused = T.rrf(names.map((n) => lists[n]), names.map((n) => (n.startsWith('dense') ? DENSE_WEIGHT : 1)));
  const dIds = (lists.dense_q && lists.dense_q.length) ? lists.dense_q : (lists.dense_de || []);
  const dRank = new Map(dIds.map((c, r) => [c, r + 1]));
  const sIds = lists.sparse_q.length ? lists.sparse_q : (lists.sparse_de || []);
  const sRank = new Map(sIds.map((c, r) => [c, r + 1]));
  const sdeRank = new Map((lists.sparse_de || []).map((c, r) => [c, r + 1]));
  const ranked = [...fused.keys()].sort((a, b) => fused.get(b) - fused.get(a));

  const out = [], perDoc = new Map();
  for (const c of ranked) {
    if (out.length >= TOP_K) break;
    const d = meta.chunks[c][0];
    if ((perDoc.get(d) || 0) >= MAX_PER_DOC) continue;
    perDoc.set(d, (perDoc.get(d) || 0) + 1); out.push(c);
  }
  if (out.length < TOP_K) {
    for (const c of ranked) { if (out.length >= TOP_K) break; if (!out.includes(c)) out.push(c); }
    out.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  }
  tm.fusion = performance.now() - t;

  const top = out.map((c) => ({ ...chunkInfo(c), text: texts[c], rrf: fused.get(c),
    dr: dRank.get(c) ?? null, sr: sRank.get(c) ?? null, sdr: sdeRank.get(c) ?? null,
    bm: (sq.hits.find((h) => h.i === c) || {}).s || null }));
  const bestSparse = Math.max(sq.hits[0]?.s || 0, sde?.hits[0]?.s || 0);

  post('result', {
    id, top, lists, seed, seedDe, tm, total: performance.now() - t0, bestSparse,
    qTokens: sq.tokens, qKnown: sq.known, deTokens: sde ? sde.tokens : [],
    fusedCount: fused.size, idf: Object.fromEntries([...sq.tokens, ...(sde ? sde.tokens : [])]
      .map((tk) => [tk, idf.get(tk) || 0])),
  });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') await init(m);
    else if (m.type === 'query') query(m);
    else if (m.type === 'chunk') post('chunk', { id: m.id, chunk: { ...chunkInfo(m.i), text: texts ? texts[m.i] : '' } });
  } catch (err) {
    post('error', { id: m.id, message: String(err && err.message || err) });
  }
};
