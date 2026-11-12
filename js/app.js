/* ResearchCrew AI app: question form, agent graph, timeline, plan approval and edits, notes, drafts with
   diffs, critic rounds, verified report, exports, history, your sources, library viewer and settings. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s); const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const RC = window.RC; const T = RC.text; const L = RC.library; const G = RC.guard; const C = RC.critic; const E = RC.engine; const A = RC.agents; const X = RC.exporter; const SRC = RC.sources;
  const LLM = window.AgentKit.llm; const SEARCH = window.AgentKit.search; const WEBLLM = window.RCWebLLM; const { ls } = window.RCStore; const RUNS = window.RCStore.runs; const SOURCESTORE = window.RCStore.sources;
  const esc = T.esc; const clone = (x) => JSON.parse(JSON.stringify(x));
  const LS = { settings: 'rc.settings', keys: 'rc.keys', theme: 'rc.theme', visited: 'rc.visited' };
  const PROVIDERS = Object.assign({}, LLM.PROVIDERS, { webllm: { label: 'In-browser (WebLLM, experimental)', defaultModel: WEBLLM.MODELS[0].id, models: WEBLLM.MODELS.map((m) => m.id), needsKey: false } });
  const AGENT_LABEL = { planner: 'Planner', researcher: 'Researchers', writer: 'Writer', critic: 'Critic' };
  const DEFAULTS = { mode: 'demo', provider: 'openai', models: {}, agentModels: { planner: '', researcher: '', writer: '', critic: '' }, baseUrl: '', remember: true, speed: 'normal', parallel: 3, useLibrary: false, webSearch: false, proxyUrl: '', proxyToken: '', audience: 'general', length: 'medium', depth: 'standard', rounds: 3, auto: false };
  let settings = Object.assign({}, DEFAULTS, ls.get(LS.settings, {})); settings.agentModels = Object.assign({}, DEFAULTS.agentModels, settings.agentModels || {});
  let keys = settings.remember ? ls.get(LS.keys, {}) : {};
  let userSources = []; let engine = null; let tab = 'timeline'; let viewDraft = null; let diffPair = null; let runs = []; let webllmOk = false;
  const SPEED = { slow: 1.8, normal: 1, fast: 0.12 };
  const BASE_DELAY = { planner: 900, researcher: 800, writer: 1100, critic: 900 };
  const saveSettings = () => { ls.set(LS.settings, settings); if (settings.remember) ls.set(LS.keys, keys); else ls.del(LS.keys); };

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" id="toast-undo">Undo</button>' : '');
    t.classList.add('show');
    if (undo) $('#toast-undo').onclick = () => { t.classList.remove('show'); undo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 8000 : 3800);
  }
  /* ---------------- modals: X, Cancel, Esc, backdrop, Back; discard prompt for unsaved edits ---------------- */
  let modal = null; let lastFocus = null;
  function openModal(title, html, o) {
    const op = o || {};
    if (modal) removeModal('replaced'); else lastFocus = document.activeElement;
    window.history.pushState({ rcModal: true }, '');
    $('#modal-host').innerHTML = '<div class="backdrop"><section class="modal ' + (op.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">' + esc(title) + '</h2><button type="button" data-close="x" aria-label="Close">×</button></div><div class="modal-body">' + html + '</div><div class="modal-footer">' + (op.extraFooter || '') + '<button type="button" data-close="cancel">' + esc(op.cancelLabel || (op.save ? 'Cancel' : 'Close')) + '</button>' + (op.save ? '<button type="button" id="modal-save" class="primary">' + esc(op.saveLabel || 'Save') + '</button>' : '') + '</div></section></div>';
    modal = { dirty: false, watch: !!op.dirty, onClose: op.onClose || null, name: op.name || '' };
    document.body.style.overflow = 'hidden';
    $('.backdrop').addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) closeModal(); });
    $$('[data-close]').forEach((b) => (b.onclick = () => closeModal()));
    $('.modal-body').addEventListener('input', () => { if (modal && modal.watch) modal.dirty = true; });
    if (op.save) $('#modal-save').onclick = () => op.save();
    if (op.onmount) op.onmount();
    setTimeout(() => { if (!modal) return; const first = $('.modal-body input:not([type=checkbox]):not([type=hidden]):not([type=file]):not([readonly]),.modal-body textarea,.modal-body select'); const el = op.focusFirst && first ? first : $('.modal [data-close=x]'); if (el) el.focus(); }, 0);
  }
  function removeModal(reason) { const m = modal; modal = null; $('#modal-host').innerHTML = ''; document.body.style.overflow = ''; if (reason !== 'replaced' && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); if (m && m.onClose) m.onClose(reason || 'cancel'); }
  function closeModal(force, reason) { if (!modal || modal.closing) return; if (!force && modal.dirty && !confirm('Discard unsaved changes?')) return; modal.dirty = false; modal.closing = true; modal.reason = reason; const m = modal; window.history.back(); setTimeout(() => { if (modal === m) removeModal(m.reason); }, 800); }
  addEventListener('popstate', () => { if (!modal) return; if (!modal.closing && modal.dirty && !confirm('Discard unsaved changes?')) { window.history.pushState({ rcModal: true }, ''); return; } removeModal(modal.reason); });
  addEventListener('keydown', (e) => {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { const els = $$('.modal button,.modal input,.modal select,.modal textarea,.modal a[href]').filter((x) => !x.disabled && x.offsetParent !== null); if (!els.length) return; const first = els[0]; const last = els[els.length - 1]; if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); } }
  });
  function download(name, data, type) { const blob = new Blob([data], { type: type || 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

  /* ---------------- sources in scope ---------------- */
  const LIB = Object.fromEntries(L.SOURCES.map((s) => [s.id, Object.assign({ fictional: true }, s)]));
  function liveSources() { return userSources.concat(settings.useLibrary ? L.SOURCES.map((s) => LIB[s.id]) : []); }
  function srcMapFor(run) {
    if (!run || run.mode !== 'llm') return LIB;
    const m = Object.assign({}, Object.fromEntries(liveSources().map((s) => [s.id, s])));
    for (const s of run.sourcesUsed || []) m[s.id] = s;
    if (engine && engine.run === run && engine.agents && engine.agents.sourcesById) Object.assign(m, engine.agents.sourcesById());
    return m;
  }
  function ignoreTextFor(run) { const t = run && run.plan && run.plan.topicName; return (run ? run.question : '') + ' ' + (t || ''); }

  /* ---------------- your AI ---------------- */
  function modelFor(agent) { const p = settings.provider; return (settings.agentModels[agent] || '').trim() || settings.models[p] || PROVIDERS[p].defaultModel; }
  function knownKeys() { return Object.values(keys).filter((k) => k && String(k).length >= 6); }
  async function callModel(agent, msg) {
    const p = settings.provider; const model = modelFor(agent);
    if (p === 'webllm') {
      if (!webllmOk) { if (!confirm('The in-browser model downloads about 1-2 GB once and needs WebGPU. Continue?')) { const e = new Error('Stopped: in-browser model download declined.'); e.stopped = true; throw e; } webllmOk = true; }
      const r = await WEBLLM.call(model, msg, () => {});
      return { text: r.text, usage: r.usage, cost: 0, model: r.model, ms: r.latencyMs };
    }
    const r = await LLM.call({ provider: p, model, key: keys[p] || '', baseUrl: p === 'compatible' ? settings.baseUrl : '' }, msg, { timeoutMs: 120000 });
    return { text: r.text, usage: r.usage, cost: r.cost, model: r.model || model, ms: r.latencyMs };
  }
  function tavily() { return keys.tavily ? SEARCH.createTavily(keys.tavily) : null; }
  function makeAgents(mode, run) {
    if (mode !== 'llm') return A.demoAgents({ library: L });
    let w = 0;
    return A.llmAgents({
      call: callModel, sources: liveSources, secrets: knownKeys, known: () => (run && run.sourcesUsed) || [],
      webSearch: settings.webSearch && keys.tavily ? async (query) => { const r = await tavily().search(query, { max: 5 }); return SRC.fromTavily(r, 'W').map((s) => Object.assign(s, { id: 'W' + (++w) })); } : null
    });
  }

  /* ---------------- run lifecycle ---------------- */
  let renderQueued = false; let persistTimer = null;
  function onChange(run) {
    if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }
    clearTimeout(persistTimer); persistTimer = setTimeout(() => persist(run), run.status === 'running' ? 900 : 150);
  }
  async function persist(run) {
    if (!run || !run.plan) return;
    if (run.mode === 'llm') { const m = srcMapFor(run); const ids = new Set(run.notes.map((n) => n.sourceId).concat((run.flags || []).map((f) => f.sourceId))); run.sourcesUsed = Array.from(ids).map((id) => m[id]).filter(Boolean).map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, type: s.type, quality: s.quality, date: s.date, url: s.url, text: s.text })); }
    await RUNS.put(run); const i = runs.findIndex((r) => r.id === run.id); if (i >= 0) runs[i] = clone(run); else runs.unshift(clone(run));
  }
  function delaysFor(mode) { if (mode === 'llm') return { planner: 0, researcher: 0, writer: 0, critic: 0 }; const k = SPEED[settings.speed] || 1; return Object.fromEntries(Object.entries(BASE_DELAY).map(([a, v]) => [a, Math.round(v * k)])); }
  function readForm() { return { question: $('#question').value.trim(), audience: $('#audience').value, length: $('#length').value, depth: $('#depth').value, maxRounds: +$('#rounds').value, autoApprove: $('#auto').checked }; }
  function startRun() {
    const f = readForm(); $('#q-err').textContent = '';
    if (!f.question) { $('#q-err').textContent = 'Type a research question, or pick one of the samples.'; $('#question').focus(); return; }
    if (engine && engine.busy && engine.run.status !== 'awaiting-approval') { toast('Stop the current run first.'); return; }
    if (settings.mode === 'llm') {
      const p = PROVIDERS[settings.provider];
      if (p.needsKey && !keys[settings.provider]) { toast('Add your ' + p.label + ' key in Settings first, or switch to the demo team.'); openSettings(); return; }
      if (!liveSources().length && !(settings.webSearch && keys.tavily)) { toast('Add a source first (URL, pasted text or file), include the demo library, or turn on web search.'); openSources(); return; }
    }
    if (engine && engine.busy) engine.stop();
    Object.assign(settings, { audience: f.audience, length: f.length, depth: f.depth, rounds: f.maxRounds, auto: f.autoApprove }); saveSettings();
    const input = Object.assign({}, f, { mode: settings.mode, parallel: settings.parallel, provider: settings.mode === 'llm' ? settings.provider : null, models: settings.mode === 'llm' ? Object.fromEntries(E.AGENTS.map((a) => [a, modelFor(a)])) : {} });
    const run = E.newRun(input);
    const agents = makeAgents(settings.mode, run);
    engine = E.createEngine({ agents, run, onChange, delays: delaysFor(settings.mode) }); engine.agents = agents;
    viewDraft = null; diffPair = null; tab = 'timeline';
    engine.start(); renderAll();
  }
  function attach(run) {
    const agents = makeAgents(run.mode, run);
    if (['running', 'awaiting-approval', 'paused'].includes(run.status)) run.status = run.plan && !run.plan.approved ? 'paused' : 'stopped';
    E.AGENTS.forEach((a) => { if (run.agent[a] === 'running') run.agent[a] = 'stopped'; });
    engine = E.createEngine({ agents, run, onChange, delays: delaysFor(run.mode) }); engine.agents = agents;
  }
  $('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); startRun(); });
  $('#pause-btn').onclick = () => engine && engine.pause();
  $('#step-btn').onclick = () => { if (!engine) return; if (engine.next() === 'approve') { toast('Approve the plan first.'); return; } engine.step(); };
  $('#resume-btn').onclick = () => { if (!engine) return; if (engine.next() === 'approve') { toast('Approve the plan to continue.'); return; } engine.resume(); };
  $('#stop-btn').onclick = () => { if (engine) { engine.stop(); toast('Stopped. Resume continues from the interrupted step.'); } };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal && engine && engine.run.status === 'running') { engine.stop(); toast('Stopped. Resume continues from the interrupted step.'); } });

  /* ---------------- rendering ---------------- */
  const fmtCost = (run, c) => (run.mode !== 'llm' ? '$0 (demo)' : c ? '$' + (c < 0.01 ? c.toFixed(4) : c.toFixed(3)) : '$0');
  const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms');
  const qpill = (s) => '<span class="pill q-' + esc((s && s.quality) || 'unknown') + '" title="Source quality">' + esc((s && s.quality) || 'unknown') + '</span>';
  function who(f) { if (/^researcher:/.test(f)) return 'Researcher ' + f.split(':')[1].replace(/^q/, ''); return { you: 'You', planner: 'Planner', researcher: 'Researchers', writer: 'Writer', critic: 'Critic', guard: 'Guard', team: 'Team' }[f] || f; }
  function renderStatus() {
    const p = PROVIDERS[settings.provider]; const n = liveSources().length;
    const pills = settings.mode === 'llm' ? ['<span class="pill ok">Your AI: ' + esc(p.label) + '</span>', '<span class="pill">' + esc(modelFor('writer')) + ' (writer)</span>', '<span class="pill">' + n + ' source' + (n === 1 ? '' : 's') + (settings.webSearch && keys.tavily ? ' + web search' : '') + '</span>', '<span class="pill">Key stays in this browser</span>'] : ['<span class="pill ok">Demo team: no key needed</span>', '<span class="pill">22 fictional sources, 3 topics</span>', '<span class="pill">Sources fenced as untrusted data</span>'];
    $('#status-row').innerHTML = pills.join('');
    $('#mode-demo').setAttribute('aria-pressed', String(settings.mode !== 'llm')); $('#mode-llm').setAttribute('aria-pressed', String(settings.mode === 'llm'));
    const lb = $('#live-box'); lb.hidden = settings.mode !== 'llm';
    if (settings.mode === 'llm') { lb.innerHTML = '<div><strong>Sources:</strong> ' + userSources.length + ' added' + (settings.useLibrary ? ' + demo library' : '') + ' · web search ' + (settings.webSearch ? (keys.tavily ? 'on (Tavily)' : 'on, but no Tavily key') : 'off') + '</div><div class="row"><button type="button" class="small-btn" id="lb-sources">Manage sources</button><button type="button" class="small-btn" id="lb-settings">Models &amp; keys</button></div>'; $('#lb-sources').onclick = openSources; $('#lb-settings').onclick = openSettings; }
  }
  function renderControls() {
    const r = engine && engine.run; const st = r ? r.status : 'idle';
    $('#run-btn').disabled = st === 'running';
    $('#run-btn').textContent = r ? '▶ New research' : '▶ Start research';
    $('#pause-btn').disabled = !(st === 'running' || st === 'awaiting-approval');
    const nx = r ? engine.next() : 'done'; const canGo = r && ['paused', 'stopped', 'error'].includes(st) && nx !== 'done' && nx !== 'approve';
    $('#step-btn').disabled = !canGo; $('#resume-btn').disabled = !canGo;
    $('#stop-btn').disabled = !(st === 'running' || st === 'paused' || st === 'awaiting-approval');
  }
  function renderGraph() {
    const r = engine && engine.run; const g = $('#graph');
    if (!r) { g.innerHTML = E.AGENTS.map((a) => '<div class="node" data-s="idle" data-agent="' + a + '"><h3>' + AGENT_LABEL[a] + ' <span class="pill">idle</span></h3><div class="stats">' + ({ planner: 'Splits the question into sub-questions.', researcher: 'Search in parallel, pull exact quotes.', writer: 'Drafts the report with [n] citations.', critic: 'Checks every claim; sends revisions.' }[a]) + '</div></div>').join(''); return; }
    const s = r.stats; const stat = (a) => { const x = s[a]; return x.calls ? x.calls + ' call' + (x.calls > 1 ? 's' : '') + ' · ' + (x.estimated ? '~' : '') + (x.input + x.output).toLocaleString() + ' tok · ' + fmtCost(r, x.cost) + ' · ' + fmtMs(x.ms) : 'no calls yet'; };
    const model = (a) => (r.mode === 'llm' ? '<div class="model" title="Model">' + esc((r.models || {})[a] || '') + '</div>' : '');
    const rs = Object.values(r.agent.researchers); const rState = rs.some((x) => x === 'running') ? 'running' : rs.length && rs.every((x) => x === 'done' || x === 'abstain') ? 'done' : rs.some((x) => x === 'error' || x === 'stopped') ? 'stopped' : rs.some((x) => x === 'queued') ? 'waiting' : 'idle';
    const lanes = r.plan ? r.plan.subqs.map((q) => { const st = r.agent.researchers[q.id] || 'idle'; const res = r.research[q.id]; return '<div class="lane" data-lane="' + esc(q.id) + '" data-s="' + st + '"><span class="dot" data-s="' + st + '" title="' + st + '"></span><span class="lq" title="' + esc(q.q) + '">' + esc(q.id.replace('q', '') + '. ' + q.q) + '</span><span class="muted">' + (res && res.status === 'done' ? (res.abstain ? 'none' : res.notes.length) : st === 'running' ? '…' : '') + '</span></div>'; }).join('') : '<div class="lane muted">waiting for the plan</div>';
    const crit = r.critiques[r.critiques.length - 1];
    const pill = (st) => '<span class="pill ' + (st === 'done' ? 'ok' : st === 'error' || st === 'stopped' ? 'bad' : st === 'waiting' ? 'warn' : '') + '">' + esc(st) + '</span>';
    const tot = E.AGENTS.reduce((a, k) => ({ tok: a.tok + s[k].input + s[k].output, cost: a.cost + s[k].cost, ms: a.ms + s[k].ms }), { tok: 0, cost: 0, ms: 0 });
    g.innerHTML = '<div class="node" data-agent="planner" data-s="' + r.agent.planner + '"><h3>Planner ' + pill(r.agent.planner) + '</h3><div class="stats">' + stat('planner') + '</div>' + model('planner') + (r.plan ? '<div class="small">' + r.plan.subqs.length + ' sub-questions' + (r.plan.approved ? ' · approved' : ' · awaiting approval') + '</div>' : '') + '</div>' +
      '<div class="node" data-agent="researcher" data-s="' + rState + '"><h3>Researchers ' + pill(rState) + ' <span class="muted small">×' + Math.min(r.parallel, r.plan ? r.plan.subqs.length : r.parallel) + ' parallel</span></h3><div class="lanes">' + lanes + '</div><div class="stats">' + stat('researcher') + '</div>' + model('researcher') + '</div>' +
      '<div class="node" data-agent="writer" data-s="' + r.agent.writer + '"><h3>Writer ' + pill(r.agent.writer) + '</h3><div class="small">' + r.drafts.length + ' draft' + (r.drafts.length === 1 ? '' : 's') + '</div><div class="stats">' + stat('writer') + '</div>' + model('writer') + '</div>' +
      '<div class="node" data-agent="critic" data-s="' + r.agent.critic + '"><h3>Critic ' + pill(r.agent.critic) + '</h3><div class="loop">Round ' + r.critiques.length + ' of max ' + r.maxRounds + (crit ? ' · ' + (crit.pass ? '✓ passed' : '✗ needs work') + ' ' + crit.average + '/5' : '') + '</div><div class="stats">' + stat('critic') + '</div>' + model('critic') + '</div>' +
      '<div class="totals"><span>Status: <strong id="run-status">' + esc(r.status) + '</strong>' + (r.step && r.status === 'running' ? ' (' + esc(r.step) + ')' : '') + '</span><span>Total: ' + (r.mode !== 'llm' ? '~' : '') + tot.tok.toLocaleString() + ' tokens</span><span>' + fmtCost(r, tot.cost) + (r.mode === 'llm' ? ' est.' : '') + '</span><span>Agent time ' + fmtMs(tot.ms) + '</span>' + (r.error ? '<span class="q-low" id="run-error">Error: ' + esc(r.error) + '</span>' : '') + '</div>';
  }
  function renderGate() {
    const r = engine && engine.run; const g = $('#gate');
    if (r && r.plan && !r.plan.approved && ['awaiting-approval', 'paused', 'stopped'].includes(r.status)) {
      g.innerHTML = '<div class="card" id="approve-card"><h3>The planner proposes ' + r.plan.subqs.length + ' sub-questions</h3><ol class="small" style="margin:0;padding-left:20px">' + r.plan.subqs.map((q) => '<li>' + esc(q.q) + '</li>').join('') + '</ol><div class="actions"><button type="button" class="primary" id="g-approve">✓ Approve &amp; research</button><button type="button" id="g-edit">✎ Edit plan</button></div></div>';
      $('#g-approve').onclick = () => engine.approve(); $('#g-edit').onclick = () => openPlanEditor();
    } else g.innerHTML = '';
  }
  function renderTabs() {
    const r = engine && engine.run;
    const counts = { timeline: r ? r.messages.length : 0, plan: r && r.plan ? r.plan.subqs.length : 0, notes: r ? Object.values(r.research).reduce((a, x) => a + (x.notes || []).length, 0) : 0, drafts: r ? r.drafts.length : 0, critique: r ? r.critiques.length : 0, report: 0 };
    const names = { timeline: 'Timeline', plan: 'Plan', notes: 'Notes', drafts: 'Drafts', critique: 'Critique', report: 'Report' };
    $$('#tabs [data-tab]').forEach((b) => { const t = b.dataset.tab; b.setAttribute('aria-selected', String(t === tab)); b.innerHTML = names[t] + (counts[t] ? '<span class="count-badge">' + counts[t] + '</span>' : ''); });
  }
  $$('#tabs [data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderAll(); }));
  function renderTimeline(r) {
    if (!r) return '<div class="empty">Messages between the agents appear here: the plan, each researcher\u2019s notes, drafts, critiques and revisions, with tokens, cost and time.</div>';
    return '<div class="msgs" id="msgs">' + r.messages.map((m) => '<div class="msg ' + esc(m.kind) + '" data-kind="' + esc(m.kind) + '"><div class="t">+' + (m.t / 1000).toFixed(1) + 's</div><div><div class="route">' + esc(who(m.from)) + ' → ' + esc(who(m.to)) + ' <span class="pill">' + esc(m.kind) + '</span></div><div class="body">' + esc(m.text) + '</div>' + (m.tokens ? '<div class="meta">' + (r.mode !== 'llm' ? '~' : '') + m.tokens.toLocaleString() + ' tokens · ' + fmtCost(r, m.cost) + '</div>' : '') + '</div></div>').join('') + '</div>';
  }
  function editable(r) { return r && r.status !== 'running'; }
  function renderPlan(r) {
    if (!r || !r.plan) return '<div class="empty">The planner\u2019s sub-questions and outline appear here. Unless auto-run is on, you approve or edit them before research starts.</div>';
    return '<div class="row" style="margin-bottom:10px"><span class="pill ' + (r.plan.approved ? 'ok' : 'warn') + '">' + (r.plan.approved ? 'Approved' : 'Awaiting approval') + '</span>' + (r.plan.edited ? '<span class="pill">edited by you</span>' : '') + '<span class="spacer"></span><button type="button" id="plan-edit" class="small-btn"' + (editable(r) ? '' : ' disabled') + '>✎ Edit plan</button>' + (!r.plan.approved ? '<button type="button" id="plan-approve" class="small-btn primary">✓ Approve</button>' : '') + '</div>' +
      (r.plan.reasoning ? '<div class="note-box">' + esc(r.plan.reasoning) + '</div>' : '') +
      r.plan.subqs.map((q) => '<div class="subq"><h3><span class="pill">' + esc(q.id) + '</span>' + esc(q.q) + '</h3>' + (q.keywords ? '<div class="kw">search: ' + esc(q.keywords) + '</div>' : '') + '</div>').join('') +
      '<h3 style="font-size:14px;margin:12px 0 4px">Report outline</h3><ol class="small">' + (r.plan.outline || []).map((o) => '<li>' + esc(o) + '</li>').join('') + '</ol>';
  }
  function renderNotes(r) {
    if (!r || !r.plan) return '<div class="empty">Each researcher\u2019s evidence notes (exact quotes with source IDs), flagged injections and abstentions appear here.</div>';
    const src = srcMapFor(r); const flagsAll = r.flags || [];
    return (flagsAll.length ? '<div class="warn-box" id="guard-box"><strong>Guard:</strong> ' + flagsAll.length + ' instruction-like sentence' + (flagsAll.length > 1 ? 's' : '') + ' found in the sources and ignored: ' + flagsAll.map((f) => '<div class="flagged"><strong>' + esc(f.sourceId) + '</strong> <s>' + esc(f.sentence) + '</s> <span class="small">(' + esc(f.rules.join(', ')) + ')</span></div>').join('') + '</div>' : '') +
      r.plan.subqs.map((q) => { const res = r.research[q.id]; const ns = res ? (res.notes || []) : []; const st = res ? res.status : 'not started';
        return '<div class="subq" data-subq="' + esc(q.id) + '"><h3><span class="pill">' + esc(q.id) + '</span>' + esc(q.q) + '<span class="spacer"></span>' + (res && res.status === 'done' ? '<button type="button" class="small-btn" data-edit-notes="' + esc(q.id) + '"' + (editable(r) ? '' : ' disabled') + '>✎ Edit notes</button>' : '<span class="pill">' + esc(st) + '</span>') + '</h3>' +
          (res && res.status === 'done' && res.abstain ? '<div class="abstain-box">Not enough evidence. ' + esc(res.reason || '') + '</div>' : '') +
          ns.map((n) => { const s = src[n.sourceId] || {}; return '<div class="note"><q>' + esc(n.quote) + '</q><div class="src"><strong>[' + (n.n || '?') + ']</strong> <button type="button" class="small-btn" data-view-src="' + esc(n.sourceId) + '" data-quote="' + esc(n.quote) + '">' + esc(n.sourceId) + '</button> ' + esc(s.publisher || '') + ' · ' + esc(s.date || 'undated') + ' ' + qpill(s) + (n.claim ? ' <span class="muted">' + esc(n.claim) + '</span>' : '') + '</div></div>'; }).join('') +
          ((res && res.flagged) || []).map((f) => '<div class="flagged">Flagged &amp; ignored in ' + esc(f.sourceId) + ': <s>' + esc(f.sentence) + '</s></div>').join('') + '</div>'; }).join('');
  }
  function renderDrafts(r) {
    if (!r || !r.drafts.length) return '<div class="empty">Every draft is kept here so you can compare rounds.</div>';
    const cur = viewDraft != null && r.drafts.find((d) => d.round === viewDraft) ? viewDraft : r.drafts[r.drafts.length - 1].round;
    const d = r.drafts.find((x) => x.round === cur);
    const opts = r.drafts.map((x) => '<option value="' + x.round + '">Draft ' + x.round + (x.edited ? ' (yours)' : '') + '</option>').join('');
    const pair = diffPair && r.drafts.find((x) => x.round === diffPair[0]) && r.drafts.find((x) => x.round === diffPair[1]) ? diffPair : r.drafts.length > 1 ? [r.drafts[r.drafts.length - 2].round, r.drafts[r.drafts.length - 1].round] : null;
    let diffHtml = '';
    if (pair) {
      const a = r.drafts.find((x) => x.round === pair[0]); const b = r.drafts.find((x) => x.round === pair[1]);
      const parts = X.diff(a.text, b.text); const st = X.diffStats(parts);
      diffHtml = '<h3 style="font-size:14px;margin:16px 0 6px">Compare drafts</h3><div class="row" style="margin-bottom:8px" data-pair="' + pair.join(',') + '"><label class="inline">From <select id="diff-a">' + opts + '</select></label><label class="inline">to <select id="diff-b">' + opts + '</select></label><span class="pill ok" id="diff-add">+' + st.added + ' words</span><span class="pill bad" id="diff-del">−' + st.removed + ' words</span></div><div class="diff" id="diff">' + parts.map((p) => (p.op === 'eq' ? esc(p.text) : p.op === 'add' ? '<ins>' + esc(p.text) + '</ins>' : '<del>' + esc(p.text) + '</del>')).join('') + '</div>';
    }
    return '<div class="draft-list">' + r.drafts.map((x) => '<button type="button" class="small-btn" data-draft="' + x.round + '" aria-pressed="' + (x.round === cur) + '">Draft ' + x.round + (x.edited ? ' ✎' : '') + '</button>').join('') + '<span class="spacer"></span><button type="button" class="small-btn" id="draft-edit"' + (editable(r) ? '' : ' disabled') + '>✎ Edit latest draft</button></div>' +
      '<div class="small muted" style="margin-bottom:6px">By ' + esc(d.by || 'writer') + ' · ' + T.wordCount(d.text) + ' words' + (d.changes && d.changes.length ? ' · ' + esc(d.changes.join(' ')) : '') + '</div><pre class="raw" id="draft-raw">' + esc(d.text) + '</pre>' + diffHtml;
  }
  const DIM = { support: 'Support', citations: 'Citations', coverage: 'Coverage', balance: 'Balance', sources: 'Source quality', fit: 'Length/fit' };
  function rubricHtml(c) { return '<div class="rubric">' + Object.entries(c.rubric).map(([k, v]) => '<span>' + esc(DIM[k] || k) + '</span><div class="bar"><i class="' + (v >= 4 ? '' : v >= 3 ? 'mid' : 'lowv') + '" style="width:' + (v * 20) + '%"></i></div><strong>' + v + '</strong>').join('') + '</div>'; }
  function renderCritique(r) {
    if (!r || !r.critiques.length) return '<div class="empty">The critic\u2019s scored rubric and revision requests appear here, one card per round (max ' + (r ? r.maxRounds : 3) + ').</div>';
    const last = r.critiques[r.critiques.length - 1];
    return r.critiques.slice().reverse().map((c) => '<div class="round" data-round="' + c.round + '" data-pass="' + c.pass + '"><h3>Round ' + c.round + ' · draft ' + c.draft + ' <span class="pill ' + (c.pass ? 'ok' : 'bad') + '">' + (c.pass ? 'PASS' : 'NEEDS WORK') + '</span><span class="pill">' + c.average + '/5</span><span class="pill">' + c.majors + ' major · ' + (c.issues.length - c.majors) + ' minor</span>' + (c.llm ? '<span class="pill">+ model review</span>' : '') + '</h3>' + rubricHtml(c) +
      '<div class="small muted">Citations: ' + c.check.verified + '/' + c.check.citations + ' verified · ' + c.check.mismatched + ' mismatched · ' + c.check.unsupported + ' unsupported</div>' + (c.note ? '<div class="small q-low">' + esc(c.note) + '</div>' : '') +
      (c.issues.length ? '<ul class="issues">' + c.issues.map((i) => '<li class="' + i.severity + '" data-type="' + esc(i.type) + '"><strong>' + esc(i.type) + '</strong>' + (i.by === 'model' ? ' <span class="pill">model</span>' : '') + ' · ' + esc(i.text) + (i.fix ? '<div class="fix">Fix: ' + esc(i.fix) + '</div>' : '') + '</li>').join('') + '</ul>' : '<p class="small">No issues found.</p>') +
      (c === last && !c.pass ? '<div class="row"><span class="small muted">' + (c.requests || []).length + ' revision request' + ((c.requests || []).length === 1 ? '' : 's') + ' for the writer' + (c.editedRequests ? ' (edited by you)' : '') + '</span><span class="spacer"></span><button type="button" class="small-btn" id="req-edit"' + (editable(r) ? '' : ' disabled') + '>✎ Edit revision requests</button></div>' : '') + '</div>').join('');
  }
  function cleanLine(l) { return l.replace(/\*\*|__|`/g, '').replace(/^\s*[-*>]\s+/, '').replace(/^\s*\d+\.\s+/, ''); }
  function reportBody(text, check) {
    const lines = String(text).split('\n'); let i = 0; const out = []; let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = []; } };
    for (const l of lines) {
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { flush(); const lv = Math.min(3, h[1].length); out.push('<h' + lv + '>' + esc(h[2]) + '</h' + lv + '>'); continue; }
      if (!l.trim()) { flush(); continue; }
      for (const s of T.sentences(cleanLine(l))) {
        const c = check.sentences[i++] || { cites: [], mismatched: [] };
        const byN = new Map(c.cites.map((x) => [x.n, x]));
        const h2 = esc(s.text).replace(/\[(\d+(?:\s*[,\u2013-]\s*\d+)*)\]/g, (m, g) => C.citesIn('[' + g + ']').map((n) => { const ci = byN.get(n) || { status: 'broken' }; return '<button type="button" class="cite ' + ci.status + '" data-cite="' + n + '" data-status="' + ci.status + '" title="' + (ci.status === 'verified' ? 'Verified: the quote is in the source' : ci.status === 'broken' ? 'Broken: no such note' : ci.status === 'injection' ? 'Quotes a planted instruction' : 'Quote not found in the source') + '">[' + n + ']</button>'; }).join(''));
        const cls = c.unsupported ? 'unsupported' : c.mismatched && c.mismatched.length ? 'mismatch' : '';
        para.push('<span class="sent ' + cls + '"' + (cls ? ' title="' + (cls === 'unsupported' ? 'Unsupported: no citation' : 'Mismatch: ' + esc(c.mismatched.join(', ')) + ' not in the cited quote') + '"' : '') + '>' + h2 + '</span>');
      }
    }
    flush(); return out.join('\n');
  }
  function renderReport(r) {
    const d = r && r.drafts[r.drafts.length - 1];
    if (!d) return '<div class="empty">The final report appears here with every citation checked: green [n] = the quote really is in the source; highlighted sentences have no support.</div>';
    const src = srcMapFor(r); const check = C.checkCitations(d.text, r.notes, src); const s = check.summary; const c = r.critiques.find((x) => x.draft === d.round);
    const cons = C.conflicts(r.notes, ignoreTextFor(r)); const byId = new Map(r.notes.map((n) => [n.id, n]));
    const abst = r.plan.subqs.filter((q) => r.research[q.id] && r.research[q.id].abstain);
    const bib = X.cited(r, d.text);
    return '<div class="checkbar" id="checkbar"><span class="pill ' + (s.verified === s.citations && s.citations ? 'ok' : 'bad') + '" id="cite-summary" data-verified="' + s.verified + '" data-total="' + s.citations + '">' + s.verified + '/' + s.citations + ' citations verified</span><span class="pill ' + (s.mismatched ? 'warn' : 'ok') + '">' + s.mismatched + ' mismatch' + (s.mismatched === 1 ? '' : 'es') + '</span><span class="pill ' + (s.unsupported ? 'warn' : 'ok') + '">' + s.unsupported + ' unsupported</span><span class="pill ' + (s.broken + s.quoteMissing ? 'bad' : 'ok') + '">' + (s.broken + s.quoteMissing) + ' broken</span><span class="pill">' + (c ? (c.pass ? 'Critic passed' : 'Critic: needs work') + ' · ' + c.average + '/5' : 'Not reviewed yet') + '</span><span class="pill">Draft ' + d.round + ' · ' + T.wordCount(d.text) + ' words</span></div>' +
      '<div class="legend">Click any [n] to see the exact quote in its source. <span class="sent unsupported">Highlighted</span> = claim without a citation; <span class="sent mismatch">wavy</span> = a number not in the cited quote.</div>' +
      '<div class="exports"><button type="button" class="small-btn" data-exp="md">⬇ Markdown</button><button type="button" class="small-btn" data-exp="html">⬇ HTML</button><button type="button" class="small-btn" data-exp="json">⬇ JSON (full run)</button><button type="button" class="small-btn" data-exp="bib">⬇ Bibliography</button><button type="button" class="small-btn" data-exp="bibtex">⬇ BibTeX</button><button type="button" class="small-btn" data-exp="copy">⧉ Copy Markdown</button></div>' +
      '<article class="md" id="report">' + reportBody(d.text, check) + '</article>' +
      (cons.length ? '<h2 style="font-size:16px">Conflicting sources</h2><div class="conflicts" id="conflicts">' + cons.map((k) => { const a = byId.get(k.a); const b = byId.get(k.b); const sa = src[a.sourceId] || {}; const sb = src[b.sourceId] || {}; return '<div class="conflict-head">' + esc((r.plan.subqs.find((q) => q.id === k.subq) || {}).q || '') + '</div><div class="side"><strong>[' + a.n + '] ' + esc(sa.publisher || a.sourceId) + '</strong> · ' + esc(sa.date || '') + ' ' + qpill(sa) + '<div>“' + esc(a.quote) + '”</div></div><div class="side"><strong>[' + b.n + '] ' + esc(sb.publisher || b.sourceId) + '</strong> · ' + esc(sb.date || '') + ' ' + qpill(sb) + '<div>“' + esc(b.quote) + '”</div></div>'; }).join('') + '</div>' : '') +
      (abst.length ? '<h2 style="font-size:16px">Not enough evidence</h2><ul class="small" id="abstentions">' + abst.map((q) => '<li>' + esc(q.q) + ': ' + esc(r.research[q.id].reason || '') + '</li>').join('') + '</ul>' : '') +
      ((r.flags || []).length ? '<h2 style="font-size:16px">Ignored instructions found in sources</h2><div id="inj-list">' + r.flags.map((f) => '<div class="flagged"><strong>' + esc(f.sourceId) + '</strong>: <s>' + esc(f.sentence) + '</s></div>').join('') + '</div>' : '') +
      '<h2 style="font-size:16px">References</h2><ol class="refs" id="refs">' + bib.map((n) => { const so = src[n.sourceId] || {}; return '<li value="' + n.n + '"><strong>' + esc(so.publisher || n.sourceId) + '</strong>, “' + esc(so.title || '') + '”, ' + esc(so.date || 'n.d.') + (so.url ? ', <span class="mono small">' + esc(so.url) + '</span>' : '') + ' ' + qpill(so) + '<blockquote>' + esc(n.quote) + '</blockquote></li>'; }).join('') + '</ol>';
  }
  function bindTab(r) {
    const p = $('#tabpanel');
    $$('[data-view-src]', p).forEach((b) => (b.onclick = () => openSource(srcMapFor(r)[b.dataset.viewSrc], b.dataset.quote)));
    $$('[data-edit-notes]', p).forEach((b) => (b.onclick = () => openNotesEditor(b.dataset.editNotes)));
    const pe = $('#plan-edit'); if (pe) pe.onclick = () => openPlanEditor();
    const pa = $('#plan-approve'); if (pa) pa.onclick = () => engine.approve();
    $$('[data-draft]', p).forEach((b) => (b.onclick = () => { viewDraft = +b.dataset.draft; renderAll(); }));
    const de = $('#draft-edit'); if (de) de.onclick = () => openDraftEditor();
    const pair = $('[data-pair]', p); if (pair) { const [a, b] = pair.dataset.pair.split(',').map(Number); $('#diff-a').value = a; $('#diff-b').value = b; const ch = () => { diffPair = [+$('#diff-a').value, +$('#diff-b').value]; renderAll(); }; $('#diff-a').onchange = ch; $('#diff-b').onchange = ch; }
    const re = $('#req-edit'); if (re) re.onclick = () => openRequestsEditor();
    $$('[data-cite]', p).forEach((b) => (b.onclick = () => openCite(r, +b.dataset.cite)));
    $$('[data-exp]', p).forEach((b) => (b.onclick = () => doExport(r, b.dataset.exp)));
  }
  function renderAll() {
    renderStatus(); renderControls(); renderGraph(); renderGate(); renderTabs();
    const r = engine && engine.run; const p = $('#tabpanel');
    const old = $('#msgs'); const atBottom = !old || old.scrollTop + old.clientHeight >= old.scrollHeight - 30; const oldTop = old ? old.scrollTop : 0;
    p.innerHTML = { timeline: renderTimeline, plan: renderPlan, notes: renderNotes, drafts: renderDrafts, critique: renderCritique, report: renderReport }[tab](r);
    const m = $('#msgs'); if (m) m.scrollTop = atBottom ? m.scrollHeight : oldTop;
    bindTab(r);
  }

  /* ---------------- citation + source viewers ---------------- */
  function highlight(text, quote, flags) {
    let h = esc(text);
    for (const f of flags || []) { const e = esc(f.sentence); if (e && h.indexOf(e) >= 0) h = h.replace(e, '<mark class="inj" title="Instruction-like text: flagged and ignored">' + e + '</mark>'); }
    if (quote) { const e = esc(quote); const i = h.indexOf(e); if (i >= 0) h = h.slice(0, i) + '<mark id="q-mark">' + e + '</mark>' + h.slice(i + e.length); }
    return h;
  }
  function openSource(s, quote, status) {
    if (!s) { toast('That source is not available any more.'); return; }
    const flags = G.scan(s.text).map((f) => ({ sentence: f.sentence }));
    const found = quote ? C.quoteInSource({ quote }, s) : null;
    openModal(s.title || s.id, '<div class="row small" style="margin-bottom:8px"><span class="pill">' + esc(s.id) + '</span>' + qpill(s) + '<span class="pill">' + esc(s.type || 'source') + '</span><span class="muted">' + esc(s.publisher || '') + ' · ' + esc(s.date || 'undated') + '</span></div>' + (s.url ? '<div class="small mono" style="margin-bottom:8px;overflow-wrap:anywhere">' + esc(s.url) + (s.fictional || /\.example\//.test(s.url) ? ' <span class="pill warn">fictional</span>' : '') + '</div>' : '') +
      (quote ? '<div class="' + (found ? 'note-box' : 'warn-box') + '" id="cite-status" data-found="' + !!found + '">' + (status ? esc(status) + ' ' : '') + (found ? '✓ This exact quote appears in the source (highlighted below).' : '✗ This quote does not appear verbatim in the source.') + '</div>' : '') +
      (flags.length ? '<div class="warn-box">' + flags.length + ' instruction-like sentence' + (flags.length > 1 ? 's' : '') + ' (struck through) were flagged and ignored by the agents.</div>' : '') +
      (s.why ? '<div class="small muted" style="margin-bottom:8px">Why this demo source exists: ' + esc(s.why) + '</div>' : '') +
      '<div class="src-text">' + highlight(s.text, quote, flags) + '</div>', { wide: true, name: 'source', onmount: () => { const m = $('#q-mark'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); } });
  }
  function openCite(r, n) {
    const note = r.notes.find((x) => x.n === n);
    if (!note) { openModal('Citation [' + n + ']', '<div class="warn-box" id="cite-status" data-found="false">✗ Broken citation: there is no research note [' + n + '].</div>', { name: 'cite' }); return; }
    openSource(srcMapFor(r)[note.sourceId], note.quote, 'Citation [' + n + '] → ' + note.sourceId + '.');
  }
  function openLibrary() {
    openModal('Demo library (fictional)', '<div class="note-box">22 made-up sources on 3 made-up topics. Every name, number and .example URL is invented. Some are planted on purpose: contradicting reports, an outdated study, low-quality blogs, and three sources with hidden instructions aimed at AI agents.</div>' + L.TOPICS.map((t) => '<div class="lib-topic"><h3>' + esc(t.name) + '</h3><div class="list">' + L.forTopic(t.id).map((s) => '<div class="item"><div class="grow"><strong>' + esc(s.id) + ' · ' + esc(s.title) + '</strong><div class="meta">' + esc(s.publisher) + ' · ' + esc(s.type) + ' · ' + esc(s.date) + ' · ' + esc(s.why) + '</div></div>' + qpill(s) + (G.scan(s.text).length ? '<span class="pill bad">injection</span>' : '') + '<button type="button" class="small-btn" data-lib="' + s.id + '">View</button></div>').join('') + '</div></div>').join(''), { wide: true, name: 'library', onmount: () => $$('[data-lib]').forEach((b) => (b.onclick = () => openSource(LIB[b.dataset.lib]))) });
  }

  /* ---------------- artifact editors ---------------- */
  function guardEdit() { if (!engine) return false; if (engine.run.status === 'running') { toast('Pause or stop the team before editing.'); return false; } return true; }
  function snapshotUndo(label) { const r = engine.run; const before = clone(r); return () => { for (const k of Object.keys(r)) delete r[k]; Object.assign(r, before); persist(r); renderAll(); toast(label + ' undone.'); }; }
  function openPlanEditor() {
    if (!guardEdit()) return; const r = engine.run; if (!r.plan) return;
    const draft = clone(r.plan.subqs);
    const rows = () => draft.map((q, i) => '<div class="edit-row"><div><input data-q="' + i + '" value="' + esc(q.q) + '" aria-label="Sub-question ' + (i + 1) + '" maxlength="240"><input class="kwin" data-kw="' + i + '" value="' + esc(q.keywords || '') + '" placeholder="search keywords (optional)" aria-label="Keywords for sub-question ' + (i + 1) + '"></div><button type="button" class="small-btn danger" data-rm="' + i + '" aria-label="Remove sub-question ' + (i + 1) + '">×</button></div>').join('');
    const collect = () => { $$('[data-q]').forEach((x) => { draft[+x.dataset.q].q = x.value; }); $$('[data-kw]').forEach((x) => { draft[+x.dataset.kw].keywords = x.value; }); };
    const mount = () => { $('#pe-rows').innerHTML = rows(); $$('[data-rm]').forEach((b) => (b.onclick = () => { collect(); draft.splice(+b.dataset.rm, 1); mount(); modal.dirty = true; })); };
    const save = (approve) => {
      collect(); const list = draft.map((q) => ({ id: q.id, q: q.q.trim(), keywords: (q.keywords || '').trim(), facet: q.facet })).filter((q) => q.q);
      if (!list.length) { $('#pe-err').textContent = 'Keep at least one sub-question (or Cancel).'; return; }
      if (list.length > 8) { $('#pe-err').textContent = 'At most 8 sub-questions.'; return; }
      const used = new Set(); list.forEach((q) => { if (!q.id || used.has(q.id)) { let k = 1; while (used.has('q' + k) || list.some((x) => x !== q && x.id === 'q' + k)) k++; q.id = 'q' + k; } used.add(q.id); });
      const undo = snapshotUndo('Plan edit');
      engine.editPlan(Object.assign({}, r.plan, { subqs: list, outline: ['Summary'].concat(list.map((q) => q.q)).concat(['Evidence gaps']) }));
      if (approve) engine.approve();
      modal.dirty = false; closeModal(true); toast('Plan saved' + (approve ? ' and approved' : '') + '.', undo);
    };
    openModal('Edit the plan', '<p class="small muted" style="margin-top:0">Changing a sub-question resets its research and all drafts. Unchanged sub-questions keep their notes.</p><div id="pe-rows"></div><button type="button" class="small-btn" id="pe-add">+ Add sub-question</button><div class="err" id="pe-err" role="alert"></div>', { dirty: true, focusFirst: true, name: 'plan', saveLabel: 'Save plan', extraFooter: r.plan.approved ? '' : '<button type="button" id="pe-approve">Save &amp; approve</button>', onmount: () => { mount(); $('#pe-add').onclick = () => { collect(); if (draft.length >= 8) { $('#pe-err').textContent = 'At most 8 sub-questions.'; return; } draft.push({ id: '', q: '', keywords: '' }); mount(); modal.dirty = true; const l = $$('[data-q]'); l[l.length - 1].focus(); }; const ap = $('#pe-approve'); if (ap) ap.onclick = () => save(true); }, save: () => save(false) });
  }
  function openNotesEditor(subqId) {
    if (!guardEdit()) return; const r = engine.run; const q = r.plan.subqs.find((x) => x.id === subqId); const res = r.research[subqId]; if (!q || !res) return;
    const src = srcMapFor(r); const notes = clone(res.notes || []);
    const scope = r.mode === 'llm' ? Object.values(src) : r.plan.topic ? L.forTopic(r.plan.topic) : L.SOURCES;
    openModal('Edit notes: ' + q.q, '<p class="small muted" style="margin-top:0">Untick a note to drop it. Add a quote by pasting it exactly as it appears in a source; it is checked before saving. Saving resets the drafts.</p>' + (notes.length ? notes.map((n, i) => '<label class="req-row"><input type="checkbox" data-keep="' + i + '" checked><span><q>' + esc(n.quote) + '</q> <span class="muted">(' + esc(n.sourceId) + ')</span></span></label>').join('') : '<p class="small">No notes yet.</p>') +
      '<div class="field" style="margin-top:10px"><label for="ne-src">Add a quote from</label><select id="ne-src"><option value="">(choose a source)</option>' + scope.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.id + ' · ' + (s.title || '')) + '</option>').join('') + '</select></div><div class="field"><label for="ne-quote">Exact quote</label><textarea id="ne-quote" rows="3"></textarea></div><div class="err" id="ne-err" role="alert"></div>',
      { dirty: true, wide: true, name: 'notes', saveLabel: 'Save notes', save: () => {
        const keep = notes.filter((n, i) => { const cb = $('[data-keep="' + i + '"]'); return !cb || cb.checked; });
        const sid = $('#ne-src').value; const qt = $('#ne-quote').value.trim();
        if (qt || sid) {
          if (!sid || !qt) { $('#ne-err').textContent = 'Pick a source and paste a quote, or leave both empty.'; return; }
          const s = src[sid] || LIB[sid]; if (!C.quoteInSource({ quote: qt }, s)) { $('#ne-err').textContent = 'That quote is not in ' + sid + ' word for word. Copy it exactly.'; return; }
          if (G.isInjection(qt)) { $('#ne-err').textContent = 'That sentence looks like an instruction planted in the source, so it cannot be used as evidence.'; return; }
          keep.push({ subq: subqId, sourceId: sid, quote: qt, score: 0.5, byYou: true });
        }
        const undo = snapshotUndo('Notes edit'); engine.editNotes(subqId, keep.map((n) => { const c = Object.assign({}, n); delete c.n; delete c.id; return c; }));
        modal.dirty = false; closeModal(true); toast('Notes saved (' + keep.length + '). Resume to rewrite the report.', undo);
      } });
  }
  function openDraftEditor() {
    if (!guardEdit()) return; const r = engine.run; const d = r.drafts[r.drafts.length - 1]; if (!d) return;
    openModal('Edit draft ' + d.round, '<p class="small muted" style="margin-top:0">Your edit becomes a new draft. The critic reviews it when you resume. Keep citations like [3] pointing at real notes.</p><textarea id="de-text" rows="18" class="mono" style="font-size:13px">' + esc(d.text) + '</textarea><div class="err" id="de-err" role="alert"></div>', { dirty: true, wide: true, focusFirst: true, name: 'draft', saveLabel: 'Save as new draft', save: () => {
      const t = $('#de-text').value; if (!t.trim()) { $('#de-err').textContent = 'The draft is empty (or Cancel).'; return; }
      if (t === d.text) { modal.dirty = false; closeModal(true); return; }
      const undo = snapshotUndo('Draft edit'); engine.editDraft(t); viewDraft = null; modal.dirty = false; closeModal(true); toast('Saved as draft ' + engine.run.drafts[engine.run.drafts.length - 1].round + '. Resume to have the critic review it.', undo);
    } });
  }
  function openRequestsEditor() {
    if (!guardEdit()) return; const r = engine.run; const c = r.critiques[r.critiques.length - 1]; if (!c) return; const reqs = clone(c.requests || c.issues);
    openModal('Edit revision requests (round ' + c.round + ')', '<p class="small muted" style="margin-top:0">Untick requests the writer should ignore, or add your own note. The writer works from this list on the next revision.</p>' + reqs.map((x, i) => '<label class="req-row"><input type="checkbox" data-req="' + i + '" checked><span><strong>' + esc(x.type) + '</strong> · ' + esc(x.text) + '</span></label>').join('') + '<div class="field" style="margin-top:8px"><label for="re-add">Add a request (optional)</label><textarea id="re-add" rows="2" maxlength="400" placeholder="e.g. Mention the sample size"></textarea></div>', { dirty: true, wide: true, name: 'requests', saveLabel: 'Save requests', save: () => {
      const keep = reqs.filter((x, i) => $('[data-req="' + i + '"]').checked); const add = $('#re-add').value.trim(); if (add) keep.push({ id: 'U' + Date.now(), type: 'note', severity: 'minor', text: add, fix: add, by: 'you' });
      const undo = snapshotUndo('Requests edit'); engine.editRequests(keep); modal.dirty = false; closeModal(true); toast('Saved ' + keep.length + ' request' + (keep.length === 1 ? '' : 's') + '.', undo);
    } });
  }

  /* ---------------- exports + share ---------------- */
  function doExport(r, kind) {
    const src = srcMapFor(r); const base = 'researchcrew-' + X.fileSafe(r.question);
    if (kind === 'md') { download(base + '.md', X.reportMd(r, src), 'text/markdown'); toast('Markdown report downloaded.'); }
    if (kind === 'html') { download(base + '.html', X.reportHtml(r, src), 'text/html'); toast('HTML report downloaded.'); }
    if (kind === 'json') { download(base + '-run.json', X.runJson(r, src), 'application/json'); toast('Full run downloaded (plan, notes, drafts, critiques). No keys.'); }
    if (kind === 'bib') { download(base + '-bibliography.md', '# Bibliography\n\n' + X.bibliographyMd(r, src) + '\n', 'text/markdown'); toast('Bibliography downloaded.'); }
    if (kind === 'bibtex') { download(base + '.bib', X.bibtex(r, src), 'application/x-bibtex'); toast('BibTeX downloaded.'); }
    if (kind === 'copy') { const t = X.reportMd(r, src); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error('no clipboard'))).then(() => toast('Report copied as Markdown.'), () => toast('Copy failed: use the Markdown download.')); }
  }
  $('#share-btn').onclick = () => {
    const f = readForm(); if (!f.question) { $('#q-err').textContent = 'Type a question to share.'; return; }
    const url = X.shareUrl(location.href, f);
    const show = () => openModal('Share link', '<p class="small">Copy this link. It holds the question and settings only, never keys or sources.</p><input id="share-url" readonly value="' + esc(url) + '">', { name: 'share' });
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Share link copied: question and settings only.'), show); else show();
  };

  /* ---------------- history ---------------- */
  async function loadRuns() { runs = await RUNS.all(); }
  function openHistory() {
    const body = () => (runs.length ? '<div class="row" style="margin-bottom:8px"><span class="small muted">' + runs.length + ' saved run' + (runs.length === 1 ? '' : 's') + ' in this browser</span><span class="spacer"></span><button type="button" class="small-btn danger" id="h-clear">Clear all</button></div><div class="list">' + runs.map((r) => { const c = r.critiques[r.critiques.length - 1]; return '<div class="item" data-run="' + esc(r.id) + '"><div class="grow"><strong>' + esc(r.question) + '</strong><div class="meta">' + esc(new Date(r.createdAt).toLocaleString()) + ' · ' + (r.mode === 'llm' ? 'your AI' : 'demo') + ' · ' + esc(r.status) + ' · ' + r.drafts.length + ' draft' + (r.drafts.length === 1 ? '' : 's') + (c ? ' · ' + (c.pass ? 'passed' : 'not passed') + ' ' + c.average + '/5' : '') + '</div></div><button type="button" class="small-btn" data-h="open">Open</button><button type="button" class="small-btn danger" data-h="del" aria-label="Delete run">Delete</button></div>'; }).join('') + '</div>' : '<div class="empty">No runs yet. Finished, paused and stopped runs are saved here automatically.</div>');
    const mount = () => {
      $('.modal-body').innerHTML = body();
      const cl = $('#h-clear'); if (cl) cl.onclick = async () => { const old = runs.slice(); runs = []; await RUNS.clear(); mount(); toast('Cleared ' + old.length + ' run' + (old.length === 1 ? '' : 's') + '.', async () => { for (const x of old) await RUNS.put(x); await loadRuns(); if (modal && modal.name === 'history') mount(); }); };
      $$('[data-run]').forEach((el) => { const id = el.dataset.run; $$('[data-h]', el).forEach((b) => (b.onclick = async () => {
        const r = runs.find((x) => x.id === id); if (!r) return;
        if (b.dataset.h === 'open') { if (engine && engine.run.status === 'running') { toast('Stop the current run first.'); return; } attach(clone(r)); viewDraft = null; diffPair = null; tab = r.drafts.length ? 'report' : 'timeline'; closeModal(true); $('#question').value = r.question; renderAll(); toast('Opened the run from ' + new Date(r.createdAt).toLocaleString() + '.'); }
        if (b.dataset.h === 'del') { runs = runs.filter((x) => x.id !== id); await RUNS.del(id); mount(); toast('Deleted the run \u201C' + r.question.slice(0, 40) + '\u201D.', async () => { await RUNS.put(r); await loadRuns(); if (modal && modal.name === 'history') mount(); }); }
      })); });
    };
    openModal('History', '', { wide: true, name: 'history', onmount: mount });
  }

  /* ---------------- your sources ---------------- */
  async function saveSource(s) { userSources.push(s); await SOURCESTORE.put(s); renderStatus(); }
  function openSources() {
    const list = () => (userSources.length ? '<div class="list" id="src-list">' + userSources.map((s) => { const f = G.scan(s.text).length; return '<div class="item" data-sid="' + esc(s.id) + '"><div class="grow"><strong>' + esc(s.id) + ' · ' + esc(s.title) + '</strong><div class="meta">' + esc(s.type) + ' · ' + s.text.length.toLocaleString() + ' chars' + (s.truncated ? ' (truncated)' : '') + (s.via ? ' · via ' + esc(s.via) : '') + '</div></div>' + (f ? '<span class="pill bad">' + f + ' flagged</span>' : '') + '<button type="button" class="small-btn" data-s="view">View</button><button type="button" class="small-btn danger" data-s="rm" aria-label="Remove source">Remove</button></div>'; }).join('') + '</div>' : '<div class="empty" id="src-empty">No sources yet.</div>');
    const html = '<div class="note-box">Used in <strong>Your AI</strong> mode. Source text is fenced as untrusted data in every prompt, and instruction-like sentences are flagged. Sources stay in this browser and are sent only to your model provider.</div>' +
      '<label class="inline" style="margin-bottom:6px"><input type="checkbox" id="src-lib"' + (settings.useLibrary ? ' checked' : '') + '> Include the fictional demo library (22 sources)</label><br><label class="inline" style="margin-bottom:10px;white-space:normal"><input type="checkbox" id="src-web"' + (settings.webSearch ? ' checked' : '') + '> Tavily web search for each sub-question' + (keys.tavily ? '' : ' <span class="muted">(add a Tavily key in Settings)</span>') + '</label>' +
      '<div class="field"><label for="src-url">Add a web page</label><div class="row" style="flex-wrap:nowrap"><input id="src-url" type="url" placeholder="https://…" inputmode="url"><button type="button" id="src-fetch">Fetch</button></div><div class="help">Most sites block reads from other pages (CORS). If it fails, paste the text below, use the optional local fetch helper, or Tavily Extract.</div></div>' +
      '<div class="field"><label for="src-title">Or paste text</label><input id="src-title" placeholder="Title (optional)" style="margin-bottom:6px"><textarea id="src-text" rows="4" placeholder="Paste an article, report or notes…"></textarea><div class="row" style="margin-top:6px"><button type="button" id="src-add">Add pasted text</button></div></div>' +
      '<div class="field"><label for="src-file">Or upload files (PDF, Markdown, text, HTML)</label><input id="src-file" type="file" accept=".pdf,.md,.markdown,.txt,.html,.htm,application/pdf,text/plain,text/markdown" multiple></div><div class="err" id="src-err" role="alert"></div><h3 style="font-size:14px;margin:10px 0 6px">Your sources</h3><div id="src-holder">' + list() + '</div>';
    const remount = () => { if (!$('#src-holder')) return; $('#src-holder').innerHTML = list(); bindList(); };
    const bindList = () => $$('[data-sid]').forEach((el) => { const id = el.dataset.sid; $$('[data-s]', el).forEach((b) => (b.onclick = async () => {
      const s = userSources.find((x) => x.id === id); if (!s) return;
      if (b.dataset.s === 'view') { openSource(s); return; }
      const i = userSources.indexOf(s); userSources.splice(i, 1); await SOURCESTORE.del(id); remount(); renderStatus();
      toast('Removed \u201C' + s.title.slice(0, 40) + '\u201D.', async () => { userSources.splice(Math.min(i, userSources.length), 0, s); await SOURCESTORE.put(s); if (modal && modal.name === 'sources') remount(); renderStatus(); });
    })); });
    openModal('Your sources', html, { wide: true, name: 'sources', onmount: () => {
      bindList();
      $('#src-lib').onchange = (e) => { settings.useLibrary = e.target.checked; saveSettings(); renderStatus(); };
      $('#src-web').onchange = (e) => { settings.webSearch = e.target.checked; saveSettings(); renderStatus(); if (e.target.checked && !keys.tavily) toast('Add a Tavily key in Settings to use web search.'); };
      const dirt = () => { if (modal) modal.dirty = !!($('#src-text').value.trim() || $('#src-url').value.trim()); };
      $('#src-text').oninput = dirt; $('#src-url').oninput = dirt;
      $('#src-fetch').onclick = async () => { const u = $('#src-url').value.trim(); $('#src-err').textContent = ''; if (!u) { $('#src-err').textContent = 'Enter a URL.'; return; } const btn = $('#src-fetch'); btn.disabled = true; btn.textContent = 'Fetching…'; try { const r = await SRC.fetchUrl(u, { proxy: settings.proxyUrl ? { url: settings.proxyUrl, token: settings.proxyToken } : null, tavily: tavily() }); const s = SRC.make({ kind: 'url', url: u, title: r.title, text: r.text, type: 'web page' }, userSources); s.via = r.via; await saveSource(s); $('#src-url').value = ''; dirt(); remount(); toast('Added ' + s.id + ' (' + r.via + ').'); } catch (e) { if ($('#src-err')) $('#src-err').textContent = e.message; } finally { if (document.contains(btn)) { btn.disabled = false; btn.textContent = 'Fetch'; } } };
      $('#src-add').onclick = async () => { const t = $('#src-text').value.trim(); $('#src-err').textContent = ''; if (t.length < 40) { $('#src-err').textContent = 'Paste at least a few sentences.'; return; } const s = SRC.make({ kind: 'paste', title: $('#src-title').value.trim() || t.slice(0, 60), text: t, type: 'pasted text' }, userSources); await saveSource(s); $('#src-text').value = ''; $('#src-title').value = ''; dirt(); remount(); toast('Added ' + s.id + '.'); };
      $('#src-file').onchange = async (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; $('#src-err').textContent = ''; const errs = []; for (const f of files) { try { const r = await SRC.readFile(f, document.baseURI); const s = SRC.make({ kind: 'file', title: r.title, text: r.text, type: r.type }, userSources); await saveSource(s); } catch (er) { errs.push(er.message); } } if (errs.length && $('#src-err')) $('#src-err').textContent = errs.join(' '); remount(); if (files.length > errs.length) toast('Added ' + (files.length - errs.length) + ' file' + (files.length - errs.length === 1 ? '' : 's') + '.'); };
    } });
  }

  /* ---------------- settings ---------------- */
  function openSettings() {
    const dk = Object.assign({}, keys); let cur = settings.provider;
    const provOpts = Object.entries(PROVIDERS).map(([id, x]) => '<option value="' + id + '"' + (id === cur ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('');
    const html = '<div class="field"><label for="st-provider">Provider</label><select id="st-provider">' + provOpts + '</select><div class="help" id="st-prov-help"></div></div>' +
      '<div class="field" id="st-key-wrap"><label for="st-key">API key</label><input id="st-key" type="password" autocomplete="off" spellcheck="false"><div class="help">Stored only in this browser and sent only to the provider. Never included in exports, history or share links.</div></div>' +
      '<div class="field" id="st-base-wrap"><label for="st-base">Base URL</label><input id="st-base" placeholder="http://localhost:11434/v1"><div class="row" style="margin-top:6px">' + LLM.PRESETS.map((x) => '<button type="button" class="small-btn" data-preset="' + x.id + '">' + esc(x.label) + '</button>').join('') + '</div><div class="err" id="st-base-err"></div></div>' +
      '<div class="field"><label for="st-model">Default model</label><input id="st-model" list="st-models"><datalist id="st-models"></datalist></div>' +
      '<fieldset class="field" style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-width:0"><legend class="small" style="font-weight:650">Model per agent (optional)</legend><div class="help" style="margin-top:0">e.g. a cheap model for the researchers and a stronger one for the writer and critic. Blank = default model.</div><div class="agent-models">' + E.AGENTS.map((a) => '<div class="field"><label for="st-m-' + a + '">' + AGENT_LABEL[a] + '</label><input id="st-m-' + a + '" list="st-models" value="' + esc(settings.agentModels[a] || '') + '" placeholder="default"></div>').join('') + '</div></fieldset>' +
      '<div class="row2"><div class="field"><label for="st-par">Parallel researchers</label><select id="st-par">' + [1, 2, 3, 4, 5, 6].map((n) => '<option' + (n === settings.parallel ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div><div class="field"><label for="st-tavily">Tavily key (web search)</label><input id="st-tavily" type="password" autocomplete="off" value="' + esc(dk.tavily || '') + '" placeholder="tvly-…"></div></div>' +
      '<div class="row2"><div class="field"><label for="st-proxy">Local fetch helper URL (optional)</label><input id="st-proxy" placeholder="http://127.0.0.1:8788" value="' + esc(settings.proxyUrl) + '"><div class="err" id="st-proxy-err"></div></div><div class="field"><label for="st-ptoken">Helper token</label><input id="st-ptoken" type="password" autocomplete="off" value="' + esc(settings.proxyToken) + '"></div></div>' +
      '<label class="inline"><input type="checkbox" id="st-remember"' + (settings.remember ? ' checked' : '') + '> Remember keys in this browser</label> <button type="button" class="small-btn danger" id="st-forget">Forget all keys</button>' +
      '<p class="small muted">Your browser may ask to allow this site to reach devices on your local network when you use Ollama, LM Studio or the fetch helper. Allow it for this site only.</p>';
    openModal('Settings', html, { dirty: true, wide: true, name: 'settings', onmount: () => {
      const sync = () => { const P = PROVIDERS[cur]; $('#st-key-wrap').hidden = !P.needsKey && cur !== 'compatible'; $('#st-key').value = dk[cur] || ''; $('#st-key').placeholder = P.keyHint || ''; $('#st-base-wrap').hidden = cur !== 'compatible'; $('#st-base').value = settings.baseUrl || LLM.PROVIDERS.compatible.baseUrl; $('#st-model').value = settings.models[cur] || P.defaultModel; $('#st-models').innerHTML = P.models.map((m) => '<option value="' + esc(m) + '">').join(''); $('#st-prov-help').innerHTML = cur === 'webllm' ? 'Runs a small model on your GPU (WebGPU). Large one-time download; weaker at following the citation rules.' : P.keyUrl ? '<a href="' + P.keyUrl + '" target="_blank" rel="noopener">Get a key</a>' + (P.pricingUrl ? ' · <a href="' + P.pricingUrl + '" target="_blank" rel="noopener">Pricing</a>' : '') : 'Any OpenAI-compatible server: Ollama, LM Studio, OpenRouter, vLLM…'; };
      sync();
      $('#st-key').oninput = () => { dk[cur] = $('#st-key').value.trim(); };
      $('#st-provider').onchange = () => { dk[cur] = $('#st-key').value.trim(); cur = $('#st-provider').value; sync(); };
      $$('[data-preset]').forEach((b) => (b.onclick = () => { const x = LLM.PRESETS.find((y) => y.id === b.dataset.preset); $('#st-base').value = x.baseUrl; $('#st-model').value = x.model; modal.dirty = true; }));
      $('#st-forget').onclick = () => { const old = Object.assign({}, keys); keys = {}; for (const k of Object.keys(dk)) delete dk[k]; ls.del(LS.keys); $('#st-key').value = ''; $('#st-tavily').value = ''; renderStatus(); toast('All keys forgotten.', () => { keys = old; saveSettings(); if (modal && modal.name === 'settings') { Object.assign(dk, old); $('#st-key').value = dk[cur] || ''; $('#st-tavily').value = dk.tavily || ''; } renderStatus(); }); };
    }, save: () => {
      dk[cur] = $('#st-key').value.trim(); dk.tavily = $('#st-tavily').value.trim();
      const base = $('#st-base').value.trim(); const proxy = $('#st-proxy').value.trim(); let bad = false;
      $('#st-base-err').textContent = ''; $('#st-proxy-err').textContent = '';
      if (cur === 'compatible' && base && !/^https?:\/\/\S+$/i.test(base)) { $('#st-base-err').textContent = 'Base URL must start with http:// or https://'; bad = true; }
      if (proxy && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(proxy)) { $('#st-proxy-err').textContent = 'The fetch helper runs on this computer only: use http://127.0.0.1:PORT'; bad = true; }
      if (bad) return;
      settings.provider = cur; if (cur === 'compatible') settings.baseUrl = base; settings.models[cur] = $('#st-model').value.trim() || PROVIDERS[cur].defaultModel;
      E.AGENTS.forEach((a) => { settings.agentModels[a] = $('#st-m-' + a).value.trim(); });
      settings.parallel = +$('#st-par').value; settings.proxyUrl = proxy.replace(/\/+$/, ''); settings.proxyToken = $('#st-ptoken').value.trim(); settings.remember = $('#st-remember').checked;
      keys = Object.fromEntries(Object.entries(dk).filter(([, v]) => v)); saveSettings(); modal.dirty = false; closeModal(true); renderAll(); toast('Settings saved.');
    } });
  }
  function openAbout() {
    openModal('About ResearchCrew AI', '<p><strong>Four agents, one report.</strong> The <em>planner</em> turns your question into sub-questions and an outline (you can edit or approve it). <em>Researchers</em> run in parallel, one per sub-question, and return evidence notes: exact quotes with source IDs, or \u201Cnot enough evidence\u201D. The <em>writer</em> drafts a report with [n] citations. The <em>critic</em> scores it and sends revision requests; the writer revises, for at most 3 rounds or until the critic passes it.</p>' +
      '<p><strong>Checks that always run, in both modes:</strong> every [n] must map to a note whose quote appears word for word in the source; numbers in a sentence must appear in the cited quote; claim-like sentences without a citation are flagged; contradictions between sources must be shown side by side; outdated and low-quality sources must be labelled or replaced; every sub-question needs a section.</p>' +
      '<p><strong>Prompt injection:</strong> source text is wrapped in <code>&lt;untrusted_source&gt;</code> fences, tags that try to break the fence are neutralised, instruction-like sentences are flagged and never used as evidence, and prompts are checked for your keys before anything is sent.</p>' +
      '<h3 style="font-size:15px">Honest notes</h3><ul class="small"><li>The <strong>demo team</strong> is deterministic code, not an AI: BM25 search over 22 fictional sources, an extractive writer whose first draft is deliberately naive, and a rule-based critic. Token counts in demo mode are estimates; cost is $0.</li><li><strong>Your AI</strong> mode was tested with mocked provider replies, not real keys. Real models may phrase things differently; the rule-based checks still run on whatever they write.</li><li>Fetching arbitrary URLs from a web page usually fails because of CORS. Paste the text, use Tavily Extract with your key, or run the optional fetch helper in the repo\u2019s <code>server/</code> folder.</li><li>The in-browser WebLLM option is experimental and untested here.</li><li>All demo people, places, companies, numbers and .example URLs are invented.</li></ul>', { wide: true, name: 'about' });
  }

  /* ---------------- boot ---------------- */
  function renderSamples() { $('#samples').innerHTML = L.TOPICS.map((t) => t.samples[0]).concat(['Is remote work good for productivity?']).map((q) => '<button type="button" class="chip">' + esc(q) + '</button>').join(''); $$('#samples .chip').forEach((b) => (b.onclick = () => { $('#question').value = b.textContent; $('#q-err').textContent = ''; $('#question').focus(); })); }
  $('#mode-demo').onclick = () => { settings.mode = 'demo'; saveSettings(); renderAll(); };
  $('#mode-llm').onclick = () => { settings.mode = 'llm'; saveSettings(); renderAll(); const P = PROVIDERS[settings.provider]; if (P.needsKey && !keys[settings.provider]) { toast('Add your ' + P.label + ' key in Settings to use your AI.'); openSettings(); } };
  $('#speed').onchange = () => { settings.speed = $('#speed').value; saveSettings(); };
  $('#nav-library').onclick = openLibrary; $('#nav-sources').onclick = openSources; $('#nav-history').onclick = openHistory; $('#nav-settings').onclick = openSettings; $('#nav-about').onclick = openAbout;
  $('#nav-theme').onclick = () => { const dark = !document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', dark); ls.set(LS.theme, dark ? 'dark' : 'light'); };
  function applyForm(s) { if (s.question != null) $('#question').value = s.question; if (s.audience) $('#audience').value = s.audience; if (s.length) $('#length').value = s.length; if (s.depth) $('#depth').value = s.depth; if (s.maxRounds) $('#rounds').value = String(s.maxRounds); if (s.autoApprove != null) $('#auto').checked = !!s.autoApprove; }
  async function boot() {
    renderSamples();
    applyForm({ audience: settings.audience, length: settings.length, depth: settings.depth, maxRounds: settings.rounds, autoApprove: settings.auto }); $('#speed').value = settings.speed;
    const shared = X.parseShare(location.hash);
    if (shared) { applyForm(shared); history.replaceState(null, '', location.pathname + location.search); setTimeout(() => toast('Loaded a shared question. Press Start research.'), 300); }
    renderAll();
    try { userSources = await SOURCESTORE.all(); userSources.sort((a, b) => (+a.id.slice(1)) - (+b.id.slice(1))); } catch (e) { userSources = []; }
    await loadRuns();
    renderAll();
    if (!ls.get(LS.visited, false)) { ls.set(LS.visited, true); if (!shared) setTimeout(() => toast('Welcome! Pick a sample question and press Start research. The demo needs no key.'), 600); }
    document.documentElement.dataset.ready = '1';
  }
  boot();
  window.ResearchCrewApp = { get engine() { return engine; }, get run() { return engine && engine.run; }, get settings() { return settings; }, get sources() { return userSources; }, get runs() { return runs; }, srcMapFor };
})();
