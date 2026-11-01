/* =========================================================
   Text processing shared by the page and the search worker.
   A line-by-line port of privrag's Python:
     index/sparse.py   tokenize(), BM25 constants
     retrieve/retriever.py   glossary_terms(), rrf()
     generate/answer.py      best_quote(), citation parsing,
                             clean_and_renumber(), confidence()
   so the browser ranks and scores exactly like the backend.
   ========================================================= */
(function (root) {
  'use strict';

  const STOP = new Set((
    'der die das den dem des ein eine einer eines einem einen und oder aber auch als an auf aus bei bis durch für gegen ' +
    'im in ist mit nach nicht noch nur ob so sowie über um unter von vor wie wird werden wurde zu zum zur sind sein ' +
    'hat haben kann können muss müssen soll sollen dass da es er sie wir ihr sich dieser diese dieses jeder jede ' +
    'the a an and or of to in on for by with is are be as at from that this it its which shall may must not'
  ).split(/\s+/));

  // exact legal references stay single tokens: "§ 25h", "Art. 5b", "AT 4.4.2", "2022/2554"
  const REF = /§{1,2}\s*\d+[a-z]{0,2}|\b(?:art\.?|artikel|article)\s*\d+[a-z]{0,2}|\b(?:at|bt|bto|btr)\s?\d+(?:\.\d+)+|\b\d{2,4}\/\d{2,5}\b/gi;
  const WORD = /[a-zäöüß0-9]+(?:-[a-zäöüß0-9]+)*/gi;
  const K1 = 1.2, B = 0.75;

  const norm = (t) => t.normalize('NFKC').toLowerCase().replace(/ /g, ' ');

  function lightStem(tok) {
    if (/^\d+$/.test(tok) || tok.length <= 4) return tok;
    for (const suf of ['ungen', 'en', 'er', 'es', 'e', 's', 'n']) {
      if (tok.endsWith(suf) && tok.length - suf.length >= 4) return tok.slice(0, -suf.length);
    }
    return tok;
  }

  function tokenize(text) {
    const t = norm(text);
    const toks = [];
    for (const m of t.matchAll(REF)) {
      toks.push(m[0].replace(/\s+/g, '').replace('§§', '§').replace('artikel', 'art')
        .replace('article', 'art').replace('art.', 'art'));
    }
    for (const m of t.matchAll(WORD)) {
      const w = m[0];
      const parts = w.includes('-') ? [w, ...w.split('-')] : [w];
      for (const p of parts) {
        if (p.length < 2 || STOP.has(p)) continue;
        toks.push(lightStem(p));
      }
    }
    return toks;
  }

  /* ── EN -> DE glossary (retriever.glossary_terms) ───────── */
  let GLOSS = [];
  function setGlossary(raw) {
    const items = Object.entries(raw).filter(([k]) => !k.startsWith('_'));
    items.sort((a, b) => b[0].length - a[0].length);
    GLOSS = items.map(([k, v]) => [new RegExp('(?<![\\p{L}\\p{N}_])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?:s|es|n|en|er|e)?(?![\\p{L}\\p{N}_])', 'iu'), v, k]);
  }
  function glossaryTerms(q) {
    const terms = [], hits = [];
    for (const [re, de, en] of GLOSS) {
      if (re.test(q)) {
        hits.push([en, de]);
        for (const t of de) if (!terms.includes(t)) terms.push(t);
      }
    }
    return { terms, hits };
  }

  /* ── fusion ──────────────────────────────────────────── */
  const RRF_K = 60;
  function rrf(lists, weights) {
    const s = new Map();
    lists.forEach((ranks, li) => {
      const w = weights ? weights[li] : 1;
      ranks.forEach((id, r) => s.set(id, (s.get(id) || 0) + w / (RRF_K + r + 1)));
    });
    return s;
  }

  /* ── answer post-processing (generate/answer.py) ─────── */
  const CITE = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g;
  const splitSentences = (text) => text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/);

  function bestQuote(chunkText, answer, maxLen = 280) {
    const a = new Set(tokenize(answer));
    let best = '', bestScore = -1;
    for (const sent of splitSentences(chunkText)) {
      if (sent.length < 20) continue;
      let sc = 0;
      for (const t of new Set(tokenize(sent))) if (a.has(t)) sc++;
      if (sc > bestScore) { best = sent; bestScore = sc; }
    }
    best = best || chunkText.slice(0, maxLen);
    return best.length <= maxLen ? best : best.slice(0, maxLen - 1) + '…';
  }

  function collapseCitationRuns(text, maxMarkers = 4) {
    return text.replace(/(?:\[\d+\]\s*){2,}/g, (m) => {
      const nums = [...new Set([...m.matchAll(/\[(\d+)\]/g)].map((x) => x[1]))].slice(0, maxMarkers);
      return nums.map((n) => `[${n}]`).join('') + (/\s$/.test(m) ? ' ' : '');
    });
  }

  /** -> { text, order (original source numbers in new order), invalid } */
  function cleanAndRenumber(text, nSources) {
    const order = [], invalid = [];
    let out = collapseCitationRuns(text).replace(CITE, (_, g) => {
      const nums = [];
      for (const n of g.split(/\s*[,;]\s*/)) {
        const k = parseInt(n, 10);
        if (k >= 1 && k <= nSources) {
          if (!order.includes(k)) order.push(k);
          nums.push(order.indexOf(k) + 1);
        } else if (!invalid.includes(k)) invalid.push(k);
      }
      return [...new Set(nums)].map((x) => `[${x}]`).join('');
    });
    out = out.replace(/[ \t]+([.,;])/g, '$1').trim();
    return { text: out, order, invalid };
  }

  function citationCoverage(answer) {
    const sents = splitSentences(answer).filter((s) => s.trim().length > 15);
    if (!sents.length) return 0;
    return sents.filter((s) => /\[\d+\]/.test(s)).length / sents.length;
  }

  /** 40% retrieval strength, 35% citation coverage, 25% source support (no reranker in the browser) */
  function confidence(chunks, citedOld, answer, minCitations = 2) {
    if (!citedOld.length) return { score: 0, strength: 0, coverage: 0, support: 0 };
    const cited = citedOld.map((i) => chunks[i - 1]).filter(Boolean);
    let strength = cited.reduce((s, c) => s + (c.dr != null) + (c.sr != null), 0) / (2 * cited.length);
    const topBonus = citedOld.filter((i) => i <= 3).length / citedOld.length;
    strength = 0.7 * strength + 0.3 * topBonus;
    const coverage = citationCoverage(answer);
    const support = Math.min(new Set(citedOld).size / Math.max(minCitations, 1), 1);
    const score = Math.max(0, Math.min(1, 0.40 * strength + 0.35 * coverage + 0.25 * support));
    return { score: Math.round(score * 1000) / 1000, strength, coverage, support };
  }
  const confidenceLabel = (s) => (s >= 0.75 ? 'high' : s >= 0.5 ? 'medium' : 'low');

  root.RagText = {
    tokenize, setGlossary, glossaryTerms, rrf, bestQuote, cleanAndRenumber, confidence,
    confidenceLabel, splitSentences, K1, B, RRF_K,
  };
})(typeof self !== 'undefined' ? self : window);
