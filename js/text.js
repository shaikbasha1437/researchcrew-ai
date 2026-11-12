/* ResearchCrew text utilities: normalising, sentence splitting, tokenising, number extraction and
   a small BM25 index (adapted from RepoGuide AI's retrieval). Pure functions, unit-tested in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.RC = root.RC || {}).text = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STOP = new Set(('a an the and or but if then than of to in on at for from by with without about into over under after before between during as is are was were be been being it its this that these those there their they them we our you your i he she his her not no nor so such can could should would will may might must do does did done has have had having which who whom whose what when where why how all any each both few more most other some own same very just also only per via vs versus up down out off again further once here s t').split(/\s+/));
  /* Normalise for quote matching: unify quotes/dashes/whitespace, lower-case. */
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201F\u2033]/g, '"').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  /* Split text into sentences, keeping the exact original substring of each. */
  function sentences(text) {
    const s = String(text || ''); const out = []; let st = 0;
    const push = (a, b) => { const raw = s.slice(a, b); const t = raw.trim(); if (t && /[a-z0-9]/i.test(t)) out.push({ text: t, start: a + raw.indexOf(t) }); };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\n') { push(st, i); st = i + 1; continue; }
      if (c !== '.' && c !== '!' && c !== '?') continue;
      let j = i; while (j + 1 < s.length && /[.!?"'\u201D\u2019)]/.test(s[j + 1])) j++;
      if (j + 1 < s.length && !/\s/.test(s[j + 1])) { i = j; continue; }
      const before = s.slice(st, i + 1);
      // Do not split after common abbreviations ("Dr.", "e.g.", "U.S.").
      if (c === '.' && /(?:^|[\s(])(?:Dr|Mr|Mrs|Ms|St|No|vs|approx|Inc|Ltd|Co|e\.g|i\.e|U\.S|a\.m|p\.m)\.$/i.test(before) && !/(?:a\.m|p\.m)\.$/i.test(before) || c === '.' && /(?:a\.m|p\.m)\.$/i.test(before) && j + 2 < s.length && /[a-z]/.test(s[j + 2])) { i = j; continue; }
      push(st, j + 1); st = j + 1; i = j;
    }
    push(st, s.length);
    return out;
  }
  function stem(w) { if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y'; if (w.length > 4 && /(sh|ch|x|ss|z)es$/.test(w)) return w.slice(0, -2); if (w.length > 4 && /(ss)$/.test(w)) return w; if (w.length > 3 && /s$/.test(w) && !/us$/.test(w)) return w.slice(0, -1); return w; }
  function tokens(s) { return (norm(s).match(/[a-z][a-z0-9'-]*|\d+(?:\.\d+)?/g) || []).map((w) => w.replace(/'s$/, '').replace(/^-+|-+$/g, '')).filter((w) => w && !STOP.has(w) && w.length > 1).map(stem); }
  /* Numbers with units, for claim-vs-quote checks and conflict detection. Years (1900-2099 with no unit) are kept separately. */
  function numbers(s) {
    const t = String(s || '').replace(/\[\d+(?:\s*[,\u2013-]\s*\d+)*\]/g, ' ');
    const out = []; const re = /(?<![\w.])(-(?=\d))?(\$)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|percent|per cent|million|billion|thousand|wh\/kg|kwh|mwh|gwh|tonnes|hours?|cycles?|days?|minutes?|weeks?|trips?|rides?|points?|applications?|roles?|stations?|cells?|crashes?)?/gi; let m;
    while ((m = re.exec(t))) {
      const raw = m[0].trim(); const v = (m[1] ? -1 : 1) * parseFloat(m[3].replace(/,/g, ''));
      if (isNaN(v)) continue;
      let unit = (m[4] || '').toLowerCase().replace(/^percent$|^per cent$/, '%').replace(/s$/, '');
      if (m[2]) unit = '$' + (unit && /million|billion|thousand/.test(unit) ? unit : '');
      const year = !unit && v >= 1900 && v <= 2099 && /^\d{4}$/.test(m[3]);
      out.push({ raw, value: v, unit, year, key: (m[2] ? '$' : '') + String(v) });
    }
    return out;
  }
  function wordCount(s) { return (String(s || '').replace(/\[\d+\]/g, '').match(/[A-Za-z0-9][A-Za-z0-9'%$.,-]*/g) || []).length; }
  function estTokens(s) { return Math.max(1, Math.ceil(String(s || '').length / 4)); }
  /* BM25 over arbitrary docs [{id, text, ...}]. */
  function bm25(docs, o) {
    const k1 = (o && o.k1) || 1.4; const b = (o && o.b) || 0.7;
    const toks = docs.map((d) => tokens(d.text)); const N = docs.length || 1; const df = new Map();
    toks.forEach((ts) => new Set(ts).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const avg = toks.reduce((a, t) => a + t.length, 0) / N || 1;
    function search(query, opts) {
      const q = Array.from(new Set(tokens(query))); const lim = (opts && opts.limit) || 10; const filter = opts && opts.filter;
      const res = [];
      docs.forEach((d, i) => {
        if (filter && !filter(d)) return;
        const ts = toks[i]; if (!ts.length) return; const tf = new Map(); ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
        let score = 0; const hits = [];
        for (const t of q) { const f = tf.get(t); if (!f) continue; hits.push(t); const n = df.get(t) || 0; const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5)); score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * ts.length / avg)); }
        if (score > 0) res.push({ doc: d, score, hits });
      });
      return res.sort((x, y) => y.score - x.score || String(x.doc.id).localeCompare(String(y.doc.id))).slice(0, lim);
    }
    return { search, size: docs.length };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function hash(s) { let h = 2166136261; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  return { STOP, norm, sentences, tokens, numbers, wordCount, estTokens, bm25, esc, hash };
});
