/* ResearchCrew demo agents: deterministic, no key, no network. They really search the bundled fictional
   library (BM25 over sentences), extract exact quotes, write an extractive report and revise it from the
   critic's requests. The first draft is deliberately naive (one top note per section, a summary that cites
   only its first clause, no gap sections), which is the kind of draft a critic should catch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./guard.js'), require('./critic.js'), require('./library.js'));
  else (root.RC = root.RC || {}).demo = factory(root.RC.text, root.RC.guard, root.RC.critic, root.RC.library);
})(typeof self !== 'undefined' ? self : this, function (T, G, C, L) {
  'use strict';
  const COUNT = { quick: 3, standard: 5, deep: 6 };
  const NOTES_PER = { quick: 2, standard: 3, deep: 4 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthYear(d) { const m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : 'undated'; }
  function matchTopic(question) {
    const q = new Set(T.tokens(question)); let best = null; let bestScore = 0;
    for (const t of L.TOPICS) { const kw = new Set(T.tokens(t.keywords + ' ' + t.name)); let s = 0; kw.forEach((k) => { if (q.has(k)) s += /^(larkspur|quillfern|halden|nafe-s|pedal|four-day|4-day|e-bike|ebike|sodium)$/.test(k) ? 3 : 1; }); if (s > bestScore) { bestScore = s; best = t; } }
    return bestScore >= 3 ? best : null;
  }
  /* Planner: sub-questions + outline. */
  function plan(input) {
    const depth = input.depth || 'standard'; const n = COUNT[depth] || 5; const topic = matchTopic(input.question);
    let subqs;
    if (topic) {
      const q = new Set(T.tokens(input.question));
      const asked = topic.facets.filter((f) => T.tokens(f.keywords + ' ' + f.id).some((k) => q.has(k)));
      const order = asked.concat(topic.facets.filter((f) => !asked.includes(f)));
      subqs = order.slice(0, n).map((f, i) => ({ id: 'q' + (i + 1), facet: f.id, q: f.q, keywords: f.keywords }));
    } else {
      const core = T.tokens(input.question).slice(0, 6).join(' ') || 'the topic';
      const subject = String(input.question || '').replace(/[?.!]+$/, '').slice(0, 90);
      subqs = ['What is known about ' + subject + '?', 'What evidence supports it?', 'What evidence argues against it?', 'What are the costs or risks?', 'What remains uncertain?', 'Who is affected, and how?'].slice(0, n).map((q, i) => ({ id: 'q' + (i + 1), facet: 'generic', q, keywords: core }));
    }
    const outline = ['Summary'].concat(subqs.map((s) => s.q)).concat(['Evidence gaps']);
    return { topic: topic ? topic.id : null, topicName: topic ? topic.name : null, subqs, outline, approved: false,
      reasoning: topic ? 'Matched the demo shelf \u201C' + topic.name + '\u201D. Picked ' + subqs.length + ' sub-questions for a ' + depth + ' run' + (input.audience ? ' aimed at a ' + input.audience + ' reader' : '') + '.' : 'No demo shelf matched this question, so the plan uses generic sub-questions and searches the whole library. Expect \u201Cnot enough evidence\u201D answers.' };
  }
  function shelf(topicId) { return topicId ? L.forTopic(topicId) : L.SOURCES; }
  function chunks(sources) { const out = []; for (const s of sources) T.sentences(s.text).forEach((x, i) => out.push({ id: s.id + ':' + i, sourceId: s.id, text: x.text })); return out; }
  /* Researcher: one sub-question. Returns notes with exact quotes, flagged injections, or an abstention. */
  function research(subq, ctx) {
    const sources = ctx.sources || shelf(ctx.plan && ctx.plan.topic);
    const idx = T.bm25(chunks(sources)); const kw = new Set(T.tokens(subq.keywords || subq.q));
    const generic = subq.facet === 'generic';
    const hits = idx.search(subq.q + ' ' + (subq.keywords || ''), { limit: 20 });
    const notes = []; const flagged = []; const perSource = {}; const max = NOTES_PER[ctx.depth || 'standard'] || 3; const maxPer = ctx.depth === 'deep' ? 2 : 1;
    const considered = []; const others = ((ctx.plan && ctx.plan.subqs) || []).filter((o) => o.id !== subq.id);
    const otherBest = new Map(); for (const o of others) for (const r of idx.search(o.q + ' ' + (o.keywords || ''), { limit: 40 })) otherBest.set(r.doc.id, Math.max(otherBest.get(r.doc.id) || 0, r.score));
    for (const h of hits) {
      if ((otherBest.get(h.doc.id) || 0) > h.score) continue; // this sentence answers another sub-question better
      const facetHits = h.hits.filter((t) => kw.has(t));
      if (h.score < 1.0 || facetHits.length < (generic ? 2 : 1)) continue;
      considered.push(h.doc.id);
      const g = G.scan(h.doc.text);
      if (g.length) { flagged.push({ sourceId: h.doc.sourceId, sentence: h.doc.text, rules: g[0].rules }); continue; }
      if ((perSource[h.doc.sourceId] || 0) >= maxPer || notes.length >= max) continue;
      perSource[h.doc.sourceId] = (perSource[h.doc.sourceId] || 0) + 1;
      notes.push({ subq: subq.id, sourceId: h.doc.sourceId, quote: h.doc.text, score: Math.round(h.score * 100) / 100, matched: facetHits });
    }
    return { notes, flagged, abstain: notes.length === 0, reason: notes.length ? '' : 'None of the ' + sources.length + ' searched sources address this sub-question.', searched: sources.length, considered: considered.length };
  }
  /* ---------- Writer ---------- */
  function initialModel(ctx) {
    const notes = ctx.notes || []; const per = ctx.length === 'long' ? 2 : 1;
    const sections = (ctx.plan.subqs || []).map((q) => { const qn = notes.filter((n) => n.subq === q.id).sort((a, b) => b.score - a.score); return { subq: q.id, notes: qn.slice(0, per).map((n) => n.id), caveats: {}, conflict: [] }; });
    return { round: 1, summary: 'naive', gaps: false, sections };
  }
  function srcOf(ctx, note) { return (ctx.sourcesById || {})[note.sourceId] || {}; }
  function sentenceFor(ctx, note, cav) {
    const s = srcOf(ctx, note); const q = note.quote.replace(/[.!?]+["\u201D']?$/, '');
    const label = cav === 'older' ? 'Older context, ' : cav === 'low' ? 'Low-quality, unverified source, ' : '';
    return label + s.publisher + ' (' + monthYear(s.date) + '): ' + q + ' [' + note.n + '].';
  }
  const COMMON = new Set('trips riders output voluntary self-reported after about roughly injury most measured none net customer customers we our only adjusted prototype annual in the a an this that it'.split(' '));
  function clause(quote) { const q = quote.replace(/[.!?]+["\u201D']?$/, ''); const w = (q.split(/\s+/)[0] || '').toLowerCase(); return COMMON.has(w) ? q.charAt(0).toLowerCase() + q.slice(1) : q; }
  function render(model, ctx) {
    const byId = new Map((ctx.notes || []).map((n) => [n.id, n])); const subqs = ctx.plan.subqs || [];
    const title = String(ctx.question || 'Research report').replace(/\?$/, '');
    const out = ['# ' + title, ''];
    const lead = model.sections.map((s) => s.notes[0] && byId.get(s.notes[0])).filter(Boolean).slice(0, 3);
    out.push('## Summary', '');
    if (!lead.length) out.push('Not enough evidence: none of the searched sources address this question.');
    else if (model.summary === 'naive') out.push('In short: ' + lead.map((n) => clause(n.quote)).join('; ') + ' [' + lead[0].n + '].');
    else {
      out.push('In short: ' + lead.map((n) => clause(n.quote) + ' [' + n.n + ']').join('; ') + '.');
      const dis = model.sections.filter((s) => s.conflict.length).map((s) => subqs.find((q) => q.id === s.subq));
      if (dis.length) out.push('Sources disagree on ' + dis.map((q) => '\u201C' + q.q.replace(/\?$/, '') + '\u201D').join(' and ') + ', so both sides are shown below.');
    }
    out.push('');
    const gaps = [];
    for (const q of subqs) {
      const sec = model.sections.find((s) => s.subq === q.id); const ns = (sec ? sec.notes : []).map((id) => byId.get(id)).filter(Boolean);
      if (!ns.length) { gaps.push(q); if (!model.gaps) continue; out.push('## ' + q.q, '', 'Not enough evidence: none of the searched sources address this sub-question, so this report does not answer it.', ''); continue; }
      out.push('## ' + q.q, '');
      const lines = [];
      if (sec.conflict.length) {
        const [a, b] = sec.conflict.map((id) => byId.get(id));
        lines.push('Sources disagree on this point. ' + sentenceFor(ctx, a, sec.caveats[a.id]) + ' By contrast, ' + sentenceFor(ctx, b, sec.caveats[b.id]));
        ns.filter((n) => !sec.conflict.includes(n.id)).forEach((n) => lines.push(sentenceFor(ctx, n, sec.caveats[n.id])));
      } else ns.forEach((n) => lines.push(sentenceFor(ctx, n, sec.caveats[n.id])));
      out.push(lines.join(' '), '');
    }
    if (model.gaps && gaps.length) out.push('## Evidence gaps', '', 'Not enough evidence in the sources for: ' + gaps.map((q) => '\u201C' + q.q + '\u201D').join(', ') + '.', '');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function write(ctx) { const model = initialModel(ctx); return { model, text: render(model, ctx), changes: ['First draft: one top-ranked note per section, short summary.'] }; }
  /* Revise from the critic's requests (whatever is left after the user edits them). */
  function revise(prev, requests, ctx) {
    const model = JSON.parse(JSON.stringify(prev)); model.round = (prev.round || 1) + 1;
    const notes = ctx.notes || []; const byId = new Map(notes.map((n) => [n.id, n])); const src = ctx.sourcesById || {};
    const newest = Math.max.apply(null, notes.map((n) => Date.parse((src[n.sourceId] || {}).date)).filter((x) => !isNaN(x)).concat([0]));
    const good = (n) => (src[n.sourceId] || {}).quality !== 'low' && !C.outdated(src[n.sourceId], newest);
    const sec = (subq) => { let s = model.sections.find((x) => x.subq === subq); if (!s) { s = { subq, notes: [], caveats: {}, conflict: [] }; model.sections.push(s); } return s; };
    const secOfNote = (id) => model.sections.find((s) => s.notes.includes(id));
    const changes = [];
    const replaceOrLabel = (id, label, why) => {
      const n = byId.get(id); if (!n) return; const s = secOfNote(id) || sec(n.subq);
      const alt = notes.filter((m) => m.subq === n.subq && good(m) && !s.notes.includes(m.id)).sort((a, b) => b.score - a.score)[0];
      if (s.notes.some((x) => x !== id && byId.get(x) && good(byId.get(x)))) { s.notes = s.notes.filter((x) => x !== id); s.conflict = s.conflict.includes(id) ? [] : s.conflict; changes.push('Dropped [' + n.n + '] (' + why + '); the section already has stronger evidence.'); }
      else if (alt) { s.notes = s.notes.map((x) => (x === id ? alt.id : x)); s.conflict = s.conflict.map((x) => (x === id ? alt.id : x)); changes.push('Replaced [' + n.n + '] (' + why + ') with [' + alt.n + '].'); }
      else { s.caveats[id] = label; changes.push('Kept [' + n.n + '] but labelled it as ' + (label === 'older' ? 'older context' : 'low-quality, unverified') + ' (no better source).'); }
    };
    for (const r of requests || []) {
      if (r.type === 'mismatch' || r.type === 'unsupported') { if (/^In short:/.test(r.sentence || '') || r.section === 'Summary') { if (model.summary !== 'cited') changes.push('Summary now cites each figure to its own note.'); model.summary = 'cited'; } else { const ns = C.citesIn(r.sentence || ''); model.sections.forEach((s) => { s.notes = s.notes.filter((id) => !ns.includes((byId.get(id) || {}).n)); }); changes.push('Removed an unsupported sentence.'); } }
      else if (r.type === 'missing') { if (!model.gaps) changes.push('Added explicit \u201Cnot enough evidence\u201D sections for sub-questions with no sources.'); model.gaps = true; const s = sec(r.subq); if (!s.notes.length) { const best = notes.filter((m) => m.subq === r.subq && good(m)).sort((a, b) => b.score - a.score)[0]; if (best) s.notes.push(best.id); } }
      else if (r.type === 'conflict') { const s = sec(r.subq); const [a, b] = r.notes; const first = s.notes.includes(a) ? a : b; const other = first === a ? b : a; if (!s.notes.includes(other)) s.notes.push(other); s.conflict = [first, other]; changes.push('Shows [' + byId.get(first).n + '] and [' + byId.get(other).n + '] side by side as a disagreement.'); }
      else if (r.type === 'outdated') replaceOrLabel(r.note, 'older', 'outdated source');
      else if (r.type === 'low-quality') replaceOrLabel(r.note, 'low', 'low-quality source');
      else if (r.type === 'injection' || r.type === 'quote-missing') { model.sections.forEach((s) => { s.notes = s.notes.filter((x) => x !== r.note); s.conflict = s.conflict.filter((x) => x !== r.note); if (s.conflict.length < 2) s.conflict = []; }); changes.push('Dropped a citation that failed verification.'); }
      else if (r.type === 'one-sided' || r.type === 'bias') { const s = r.subq ? sec(r.subq) : null; const add = r.show || (s && notes.filter((m) => m.subq === s.subq && good(m) && !s.notes.includes(m.id))[0] || {}).id; if (s && add && !s.notes.includes(add)) { s.notes.push(add); changes.push('Added [' + byId.get(add).n + '] for a second source.'); } }
      else if (r.type === 'length' && r.words) { const band = C.LENGTH[ctx.length || 'medium']; if (r.words > band[1]) { model.sections.forEach((s) => { if (s.notes.length > 2 && !s.conflict.length) s.notes = s.notes.slice(0, 2); }); changes.push('Trimmed sections to two notes each.'); } else { model.sections.forEach((s) => { const more = notes.filter((m) => m.subq === s.subq && good(m) && !s.notes.includes(m.id))[0]; if (more) s.notes.push(more.id); }); changes.push('Added more detail from unused notes.'); } }
      else if (r.type === 'note') { changes.push('Noted your comment: ' + String(r.text).slice(0, 80)); }
    }
    return { model, text: render(model, ctx), changes: changes.length ? changes : ['No changes requested.'] };
  }
  return { plan, research, write, revise, render, matchTopic, chunks, monthYear, COUNT, NOTES_PER };
});
