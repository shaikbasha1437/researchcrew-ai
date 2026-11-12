/* ResearchCrew exports: Markdown report, standalone HTML, JSON of the full run, bibliography (Markdown and
   BibTeX), share links (question + settings only), and a word-level diff between drafts. No keys, ever. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./critic.js'), require('./guard.js'));
  else (root.RC = root.RC || {}).exporter = factory(root.RC.text, root.RC.critic, root.RC.guard);
})(typeof self !== 'undefined' ? self : this, function (T, C, G) {
  'use strict';
  const esc = T.esc;
  function finalDraft(run) { return run.drafts[run.drafts.length - 1] || null; }
  function cited(run, text) { const ns = new Set(C.citesIn(text || '')); return run.notes.filter((n) => ns.has(n.n)); }
  function bibEntries(run, src, text) { return cited(run, text).map((n) => ({ n: n.n, note: n, source: src[n.sourceId] || { id: n.sourceId, title: n.sourceId } })); }
  function bibliographyMd(run, src, text) {
    const t = text != null ? text : (finalDraft(run) || {}).text;
    return bibEntries(run, src, t).map((e) => '[' + e.n + '] ' + (e.source.publisher ? e.source.publisher + '. ' : '') + '\u201C' + (e.source.title || e.source.id) + '.\u201D ' + (e.source.date || 'n.d.') + '. ' + (e.source.url || '(pasted text)') + '\n    > ' + e.note.quote).join('\n');
  }
  function bibtex(run, src, text) {
    const t = text != null ? text : (finalDraft(run) || {}).text; const seen = new Set(); const out = [];
    for (const e of bibEntries(run, src, t)) {
      if (seen.has(e.source.id)) continue; seen.add(e.source.id);
      const y = String(e.source.date || '').slice(0, 4) || 'n.d.'; const key = String(e.source.id).replace(/[^A-Za-z0-9]/g, '') + y;
      const f = (k, v) => (v ? '  ' + k + ' = {' + String(v).replace(/[{}]/g, '') + '},' : null);
      out.push(['@misc{' + key + ',', f('title', e.source.title), f('author', e.source.publisher), f('year', y), f('howpublished', e.source.url ? '\\url{' + e.source.url + '}' : null), f('note', (e.source.type || '') + (e.source.quality ? ', quality: ' + e.source.quality : '') + (e.source.fictional ? ', FICTIONAL demo source' : '')), '}'].filter(Boolean).join('\n'));
    }
    return out.join('\n\n') + (out.length ? '\n' : '');
  }
  function reportMd(run, src) {
    const d = finalDraft(run); if (!d) return '';
    const c = run.critiques[run.critiques.length - 1]; const chk = C.checkCitations(d.text, run.notes, src).summary;
    const head = '<!-- ResearchCrew AI report. Mode: ' + (run.mode === 'llm' ? 'your AI' : 'demo (fictional sources)') + '. Draft ' + d.round + ', critic ' + (c ? (c.pass ? 'passed' : 'did not pass') + ' (' + c.average + '/5)' : 'not run') + '. Citations verified: ' + chk.verified + '/' + chk.citations + '. -->\n\n';
    return head + d.text.trim() + '\n\n## References\n\n' + (bibliographyMd(run, src, d.text) || '(none)') + '\n';
  }
  function inline(s, run, src) {
    let h = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\[(\d+(?:\s*[,\u2013-]\s*\d+)*)\]/g, (m, g) => C.citesIn('[' + g + ']').map((n) => '<a href="#ref-' + n + '" class="cite">[' + n + ']</a>').join(''));
    return h;
  }
  function reportHtml(run, src) {
    const d = finalDraft(run); if (!d) return '';
    const lines = d.text.split('\n'); const body = []; let para = [];
    const flush = () => { if (para.length) { body.push('<p>' + inline(para.join(' '), run, src) + '</p>'); para = []; } };
    for (const l of lines) { const h = /^(#{1,6})\s+(.*)$/.exec(l); if (h) { flush(); const lv = Math.min(4, h[1].length); body.push('<h' + lv + '>' + esc(h[2]) + '</h' + lv + '>'); } else if (!l.trim()) flush(); else para.push(l.trim()); }
    flush();
    const refs = bibEntries(run, src, d.text).map((e) => '<li id="ref-' + e.n + '" value="' + e.n + '"><strong>' + esc(e.source.publisher || '') + '</strong>, \u201C' + esc(e.source.title || e.source.id) + '\u201D, ' + esc(e.source.date || 'n.d.') + (e.source.url ? ', <a href="' + esc(e.source.url) + '" rel="noopener noreferrer">' + esc(e.source.url) + '</a>' : '') + '<blockquote>' + esc(e.note.quote) + '</blockquote></li>').join('');
    const c = run.critiques[run.critiques.length - 1];
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(run.question) + '</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;color:#14213d}h1{line-height:1.2}a.cite{text-decoration:none;font-size:.8em;vertical-align:super;color:#2f6fdf}blockquote{margin:.3rem 0 .8rem;padding-left:.8rem;border-left:3px solid #dce2ea;color:#5c6878}.meta{color:#5c6878;font-size:.9em;border:1px solid #dce2ea;border-radius:8px;padding:.6rem .8rem}</style></head><body><p class="meta">ResearchCrew AI report \u00B7 ' + (run.mode === 'llm' ? 'your AI' : 'demo mode with FICTIONAL sources') + ' \u00B7 draft ' + d.round + ' \u00B7 critic ' + (c ? (c.pass ? 'passed' : 'did not pass') + ' (' + c.average + '/5)' : 'not run') + '</p>' + body.join('\n') + '<h2>References</h2><ol>' + refs + '</ol></body></html>';
  }
  /* Full run as JSON. Sources travel with their text so citations can be re-checked offline; keys never do. */
  function runJson(run, src) {
    const used = new Set(run.notes.map((n) => n.sourceId)); (run.flags || []).forEach((f) => used.add(f.sourceId));
    const sources = Array.from(used).map((id) => src[id]).filter(Boolean).map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, type: s.type, quality: s.quality, date: s.date, url: s.url, fictional: !!s.fictional || /\.example\//.test(s.url || ''), text: s.text }));
    const clean = JSON.parse(JSON.stringify(run, (k, v) => (k === 'model' && v && typeof v === 'object' && v.sections ? undefined : v)));
    delete clean.keys; delete clean.apiKey;
    const s = JSON.stringify({ app: 'ResearchCrew AI', kind: 'run', exportedAt: new Date().toISOString(), run: clean, sources }, null, 2);
    return G.redactKeys(s);
  }
  /* Share link: question and settings only, in the hash (never sent to a server). */
  const SHARE_KEYS = ['question', 'audience', 'length', 'depth', 'maxRounds', 'autoApprove'];
  function shareUrl(base, s) { const p = new URLSearchParams(); SHARE_KEYS.forEach((k) => { if (s[k] != null && s[k] !== '') p.set(k === 'question' ? 'q' : k, String(s[k])); }); return String(base).split('#')[0] + '#' + p.toString(); }
  function parseShare(hash) {
    const p = new URLSearchParams(String(hash || '').replace(/^#/, '')); if (!p.get('q')) return null;
    const pick = (k, allowed) => { const v = p.get(k); return allowed.includes(v) ? v : undefined; };
    return { question: p.get('q').slice(0, 600), audience: pick('audience', ['general', 'executive', 'technical', 'student']), length: pick('length', ['short', 'medium', 'long']), depth: pick('depth', ['quick', 'standard', 'deep']), maxRounds: [1, 2, 3].includes(+p.get('maxRounds')) ? +p.get('maxRounds') : undefined, autoApprove: p.get('autoApprove') === 'true' ? true : p.get('autoApprove') === 'false' ? false : undefined };
  }
  /* Word diff (LCS on tokens, line breaks kept). Returns [{op:'eq'|'add'|'del', text}] */
  function diff(a, b) {
    const ta = String(a || '').match(/\s+|[^\s]+/g) || []; const tb = String(b || '').match(/\s+|[^\s]+/g) || [];
    const n = ta.length; const m = tb.length;
    if (n * m > 4e6) return [{ op: 'del', text: a }, { op: 'add', text: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0; let j = 0; const push = (op, t) => { const l = out[out.length - 1]; if (l && l.op === op) l.text += t; else out.push({ op, text: t }); };
    while (i < n && j < m) { if (ta[i] === tb[j]) { push('eq', ta[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', ta[i]); i++; } else { push('add', tb[j]); j++; } }
    while (i < n) push('del', ta[i++]); while (j < m) push('add', tb[j++]);
    return out;
  }
  function diffStats(parts) { const w = (s) => (s.match(/[^\s]+/g) || []).length; return { added: parts.filter((p) => p.op === 'add').reduce((a, p) => a + w(p.text), 0), removed: parts.filter((p) => p.op === 'del').reduce((a, p) => a + w(p.text), 0) }; }
  function fileSafe(s) { return String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report'; }
  return { reportMd, reportHtml, runJson, bibliographyMd, bibtex, shareUrl, parseShare, diff, diffStats, fileSafe, finalDraft, cited };
});
