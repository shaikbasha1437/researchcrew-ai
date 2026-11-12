/* ResearchCrew checks shared by the demo critic and the live critic:
   - checkCitations: every [n] must map to a note whose quote really appears in its source, and every
     number in the sentence must appear in a cited quote. Claim-like sentences without a citation are unsupported.
   - conflicts: notes on the same sub-question from different sources that report different numbers for the same thing.
   - review: the critic's rule-based rubric and revision requests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./guard.js'));
  else (root.RC = root.RC || {}).critic = factory(root.RC.text, root.RC.guard);
})(typeof self !== 'undefined' ? self : this, function (T, G) {
  'use strict';
  const CITE_RE = /\[(\d+(?:\s*[,\u2013-]\s*\d+)*)\]/g;
  const META_RE = /not enough evidence|none of the (?:available |searched )?sources|no source (?:in|covers|addresses)|sources disagree|the sources (?:do not|don't)|this (?:report|brief|summary) (?:is|draws|uses|covers)|treat (?:it|this|them) with caution|could not find|insufficient evidence/i;
  const CLAIM_RE = /\b(increased?|decreased?|rose|fell|grew|dropped|reduced|cut|improved|worsened|caused|proves?|proved|success(?:ful)?|failed|safest|always|never|eliminated|doubled|tripled|halved|confirms?|shows?|leads? to|resulted in|higher|lower|more than|less than|obsolete|twice|became|best|worst|guarantee[sd]?)\b/i;
  function citesIn(s) { const out = []; let m; CITE_RE.lastIndex = 0; while ((m = CITE_RE.exec(s))) { for (const part of m[1].split(/\s*,\s*/)) { const r = part.split(/\s*[\u2013-]\s*/).map(Number); if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 20) { for (let i = r[0]; i <= r[1]; i++) out.push(i); } else out.push(r[0]); } } return Array.from(new Set(out)); }
  function stripMd(s) { return String(s).replace(/\*\*|__|`/g, '').replace(/^\s*[-*>]\s+/, '').replace(/^\s*\d+\.\s+/, ''); }
  function quoteInSource(note, src) { return !!(src && note && note.quote && T.norm(src.text).indexOf(T.norm(note.quote)) >= 0); }
  /* Parse a markdown draft into blocks: headings and sentences, with section tracking. */
  function parse(text) {
    const lines = String(text || '').split('\n'); const blocks = []; let section = null; let para = 0;
    lines.forEach((line, li) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { section = { level: h[1].length, title: h[2].trim(), line: li }; blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim(), line: li }); return; }
      if (!line.trim()) { para++; return; }
      for (const s of T.sentences(stripMd(line))) blocks.push({ kind: 'sentence', text: s.text, line: li, para, section: section && section.title });
    });
    return blocks;
  }
  function checkCitations(text, notes, sourcesById) {
    const byN = new Map((notes || []).map((n) => [n.n, n]));
    const res = []; const sum = { sentences: 0, citations: 0, verified: 0, broken: 0, quoteMissing: 0, mismatched: 0, unsupported: 0, injected: 0 };
    for (const b of parse(text)) {
      if (b.kind !== 'sentence') continue;
      sum.sentences++;
      const ns = citesIn(b.text); const cites = []; const quotes = [];
      for (const n of ns) {
        const note = byN.get(n); sum.citations++;
        if (!note) { cites.push({ n, status: 'broken' }); sum.broken++; continue; }
        const src = sourcesById[note.sourceId];
        if (!quoteInSource(note, src)) { cites.push({ n, status: 'quote-missing', noteId: note.id }); sum.quoteMissing++; continue; }
        if (G.isInjection(note.quote)) { cites.push({ n, status: 'injection', noteId: note.id }); sum.injected++; continue; }
        cites.push({ n, status: 'verified', noteId: note.id }); sum.verified++; quotes.push(note.quote);
      }
      const nums = T.numbers(b.text).filter((x) => !x.year);
      let mismatched = [];
      if (ns.length) {
        const have = new Set(); quotes.forEach((q) => T.numbers(q).forEach((x) => { have.add(String(x.value)); }));
        mismatched = nums.filter((x) => !have.has(String(x.value))).map((x) => x.raw);
        if (mismatched.length) sum.mismatched++;
      }
      const meta = META_RE.test(b.text);
      const unsupported = !ns.length && !meta && (nums.length > 0 || CLAIM_RE.test(b.text));
      if (unsupported) sum.unsupported++;
      res.push({ text: b.text, line: b.line, section: b.section, cites, mismatched, unsupported, meta });
    }
    return { sentences: res, summary: sum };
  }
  /* Conflicts: same sub-question, different sources, at least two shared distinctive words and a number with
     the same unit that one reports and the other does not. */
  function conflicts(notes, ignoreText) {
    const ignore = new Set(T.tokens(ignoreText || ''));
    const out = []; const list = notes || [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      if (a.subq !== b.subq || a.sourceId === b.sourceId) continue;
      const ta = new Set(T.tokens(a.quote).filter((t) => !ignore.has(t) && !/^\d/.test(t))); const shared = T.tokens(b.quote).filter((t) => ta.has(t) && !/^\d/.test(t));
      if (new Set(shared).size < 1) continue;
      const na = T.numbers(a.quote).filter((x) => !x.year && x.unit); const nb = T.numbers(b.quote).filter((x) => !x.year && x.unit);
      const units = new Set(na.map((x) => x.unit).filter((u) => nb.some((y) => y.unit === u)));
      for (const u of units) {
        const va = na.filter((x) => x.unit === u).map((x) => x.value); const vb = nb.filter((x) => x.unit === u).map((x) => x.value);
        if (va.some((v) => !vb.includes(v)) || vb.some((v) => !va.includes(v))) { out.push({ subq: a.subq, a: a.id, b: b.id, unit: u, aValues: va, bValues: vb, shared: Array.from(new Set(shared)).slice(0, 5) }); break; }
      }
    }
    return out;
  }
  const UNIT_SHOW = { 'wh/kg': 'Wh/kg', kwh: 'kWh', mwh: 'MWh', gwh: 'GWh' };
  function fmtVals(vs, u) { const num = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v)); const pl = (unit, v) => (UNIT_SHOW[unit] || (unit && Math.abs(v) !== 1 && !/million|billion|thousand/.test(unit) ? unit + 's' : unit)); return vs.map((v) => (u.charAt(0) === '$' ? '$' + num(v) + (u.length > 1 ? ' ' + u.slice(1) : '') : num(v) + (u === '%' ? '%' : u ? ' ' + pl(u, v) : ''))).join(', '); }
  const LENGTH = { short: [100, 380], medium: [220, 700], long: [380, 1300] };
  const YEAR_MS = 365.25 * 864e5;
  function outdated(src, newestMs) { const t = Date.parse(src && src.date); return !isNaN(t) && newestMs - t > 3 * YEAR_MS; }
  function sameHeading(a, b) { const x = T.tokens(a); const y = new Set(T.tokens(b)); if (!x.length || !y.size) return false; const hit = x.filter((t) => y.has(t)).length; return hit / Math.max(x.length, y.size) >= 0.6; }
  /* The rule-based critic. ctx = { plan, notes, sources (by id), research: {subqId:{abstain}}, length } */
  function review(text, ctx) {
    const notes = ctx.notes || []; const src = ctx.sources || {}; const plan = ctx.plan || { subqs: [] };
    const check = checkCitations(text, notes, src); const issues = []; let k = 0;
    const add = (type, severity, msg, fix, extra) => issues.push(Object.assign({ id: 'I' + (++k), type, severity, text: msg, fix }, extra || {}));
    const byId = new Map(notes.map((n) => [n.id, n])); const noteByN = new Map(notes.map((n) => [n.n, n]));
    for (const s of check.sentences) {
      const short = s.text.length > 110 ? s.text.slice(0, 107) + '\u2026' : s.text;
      for (const c of s.cites) {
        if (c.status === 'broken') add('broken', 'major', 'Citation [' + c.n + '] does not match any research note.', 'Remove [' + c.n + '] or cite a real note.', { sentence: s.text, n: c.n, section: s.section });
        if (c.status === 'quote-missing') add('quote-missing', 'major', 'Citation [' + c.n + ']: the quoted text is not in the source.', 'Drop note [' + c.n + '] or replace it with an exact quote.', { sentence: s.text, n: c.n, note: c.noteId, section: s.section });
        if (c.status === 'injection') add('injection', 'major', 'Citation [' + c.n + '] quotes an instruction planted in a source.', 'Remove it; instructions inside sources are data, not evidence.', { sentence: s.text, n: c.n, note: c.noteId, section: s.section });
      }
      if (s.mismatched.length) add('mismatch', 'major', 'Citation mismatch: ' + s.mismatched.join(', ') + ' in \u201C' + short + '\u201D does not appear in the cited quote' + (s.cites.length > 1 ? 's' : '') + '.', 'Cite the note each number comes from, or remove the number.', { sentence: s.text, numbers: s.mismatched, section: s.section, cites: s.cites.map((c) => c.n) });
      if (s.unsupported) add('unsupported', 'major', 'Unsupported claim: \u201C' + short + '\u201D has no citation.', 'Add a citation to a note that supports it, or remove the claim.', { sentence: s.text, section: s.section });
    }
    // Coverage: every sub-question needs a section; abstentions must be explicit.
    const heads = parse(text).filter((b) => b.kind === 'heading').map((b) => b.text);
    for (const q of plan.subqs || []) {
      const has = heads.some((h) => sameHeading(h, q.q));
      const r = (ctx.research || {})[q.id] || {};
      if (!has) add('missing', 'major', 'Missing sub-question: \u201C' + q.q + '\u201D is not addressed' + (r.abstain ? ' (the researcher found no evidence, so the report should say so)' : '') + '.', r.abstain ? 'Add a section that says there is not enough evidence.' : 'Add a section answering it from the notes.', { subq: q.id });
    }
    // Source checks on what is actually cited.
    const citedNotes = new Map(); // noteId -> sentences
    for (const s of check.sentences) for (const c of s.cites) if (c.noteId) { const l = citedNotes.get(c.noteId) || []; l.push(s); citedNotes.set(c.noteId, l); }
    const newest = Math.max.apply(null, notes.map((n) => Date.parse((src[n.sourceId] || {}).date)).filter((x) => !isNaN(x)).concat([0]));
    for (const [nid, sents] of citedNotes) {
      const n = byId.get(nid); const s = src[n.sourceId] || {};
      if (outdated(s, newest)) {
        const newer = notes.some((m) => m.subq === n.subq && m.id !== n.id && !outdated(src[m.sourceId], newest) && (src[m.sourceId] || {}).quality !== 'low');
        const labelled = sents.every((x) => /\b(older|outdated|earlier|dated|pre-launch|before (?:launch|the pilot))\b/i.test(x.text));
        if (newer && !labelled) add('outdated', 'major', 'Outdated source: [' + n.n + '] is from ' + String(s.date).slice(0, 4) + ' (' + s.publisher + '); newer evidence on the same question exists.', 'Use the newer source, or label this one as older context.', { note: nid, n: n.n, subq: n.subq });
      }
      if (s.quality === 'low') {
        const labelled = sents.every((x) => /low-quality|unverified|anecdotal|with caution/i.test(x.text));
        if (!labelled) add('low-quality', sents.some((x) => x.cites.length === 1) ? 'major' : 'minor', 'Low-quality source: [' + n.n + '] comes from ' + s.publisher + ' (' + (s.type || 'unknown') + ').', 'Replace it with a stronger source, or flag it as unverified.', { note: nid, n: n.n, subq: n.subq });
      }
    }
    // Balance: conflicts must be shown side by side; sections should not rest on one source when more exist.
    const cons = conflicts(notes, ctx.ignoreText);
    const citedIds = new Set(citedNotes.keys());
    for (const c of cons) {
      const sa = src[byId.get(c.a).sourceId] || {}; const sb = src[byId.get(c.b).sourceId] || {};
      if (outdated(sa, newest) || outdated(sb, newest) || sa.quality === 'low' || sb.quality === 'low') continue; // superseded or weak: shown in the conflicts panel, not demanded
      const ca = citedIds.has(c.a); const cb = citedIds.has(c.b);
      if (ca !== cb) { const shown = byId.get(ca ? c.a : c.b); const hidden = byId.get(ca ? c.b : c.a); add('conflict', 'major', 'Contradiction left out: ' + (src[hidden.sourceId] || {}).publisher + ' [' + hidden.n + '] reports ' + fmtVals(c[ca ? 'bValues' : 'aValues'], c.unit) + ' where the draft only gives ' + (src[shown.sourceId] || {}).publisher + ' [' + shown.n + '] (' + fmtVals(c[ca ? 'aValues' : 'bValues'], c.unit) + ').', 'Present both sources side by side and say they disagree.', { subq: c.subq, notes: [c.a, c.b], show: hidden.id }); }
    }
    const conflictNotes = new Set(cons.flatMap((c) => [c.a, c.b]));
    for (const q of plan.subqs || []) {
      const qn = notes.filter((n) => n.subq === q.id && (src[n.sourceId] || {}).quality !== 'low' && !outdated(src[n.sourceId], newest));
      const avail = new Set(qn.map((n) => n.sourceId));
      const used = new Set(Array.from(citedIds).map((id) => byId.get(id)).filter((n) => n && n.subq === q.id).map((n) => n.sourceId));
      const pending = issues.some((i) => i.type === 'conflict' && i.subq === q.id);
      if (used.size === 1 && avail.size >= 2 && !pending) { const extra = qn.find((n) => !used.has(n.sourceId) && !conflictNotes.has(n.id)) || qn.find((n) => !used.has(n.sourceId)); add('one-sided', 'minor', 'One-sided: \u201C' + q.q + '\u201D rests on one source while ' + avail.size + ' sources have relevant notes.', 'Add evidence from another source' + (extra ? ' (e.g. [' + extra.n + '])' : '') + '.', { subq: q.id, show: extra && extra.id }); }
    }
    const perSource = new Map(); let totalCites = 0; for (const [nid, sents] of citedNotes) { const sid = byId.get(nid).sourceId; perSource.set(sid, (perSource.get(sid) || 0) + sents.length); totalCites += sents.length; }
    if (totalCites >= 5 && perSource.size >= 1 && new Set(notes.map((n) => n.sourceId)).size >= 3) { const [topSid, topN] = Array.from(perSource).sort((a, b) => b[1] - a[1])[0]; if (topN / totalCites > 0.6) add('bias', 'minor', 'Bias risk: ' + Math.round(100 * topN / totalCites) + '% of citations come from ' + (src[topSid] || {}).publisher + '.', 'Draw on more of the available sources.', { source: topSid }); }
    const words = T.wordCount(text); const band = LENGTH[ctx.length || 'medium'] || LENGTH.medium;
    if (words < band[0] || words > band[1]) add('length', 'minor', 'Length: ' + words + ' words, outside the ' + band[0] + '\u2013' + band[1] + ' target for a ' + (ctx.length || 'medium') + ' report.', words < band[0] ? 'Add detail from unused notes.' : 'Tighten the report.', { words });
    const dims = { support: ['unsupported'], citations: ['broken', 'quote-missing', 'mismatch'], coverage: ['missing'], balance: ['conflict', 'one-sided', 'bias'], sources: ['outdated', 'low-quality', 'injection'], fit: ['length'] };
    const rubric = {};
    for (const [d, types] of Object.entries(dims)) { const mine = issues.filter((i) => types.includes(i.type)); rubric[d] = Math.max(1, 5 - 2 * mine.filter((i) => i.severity === 'major').length - mine.filter((i) => i.severity === 'minor').length); }
    const avg = Object.values(rubric).reduce((a, b) => a + b, 0) / Object.keys(rubric).length;
    const majors = issues.filter((i) => i.severity === 'major').length;
    return { issues, rubric, average: Math.round(avg * 10) / 10, majors, pass: majors === 0 && avg >= 4, check: check.summary, conflicts: cons, words };
  }
  return { citesIn, parse, checkCitations, conflicts, review, quoteInSource, outdated, sameHeading, LENGTH, META_RE, CLAIM_RE };
});
