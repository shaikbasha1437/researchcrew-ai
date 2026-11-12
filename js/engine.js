/* ResearchCrew orchestrator: runs Planner -> parallel Researchers -> Writer <-> Critic as discrete steps.
   Between steps it honours pause / step / stop, waits for plan approval, and lets you edit any artifact
   (plan, notes, draft, revision requests) and resume. Agents are pluggable: demo (deterministic) or your AI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./guard.js'));
  else (root.RC = root.RC || {}).engine = factory(root.RC.text, root.RC.guard);
})(typeof self !== 'undefined' ? self : this, function (T, G) {
  'use strict';
  const AGENTS = ['planner', 'researcher', 'writer', 'critic'];
  function stopErr() { const e = new Error('Stopped by you.'); e.stopped = true; return e; }
  function sleep(ms, signal) { return new Promise((res, rej) => { if (signal && signal.aborted) return rej(stopErr()); if (!ms) return res(); const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(stopErr()); }, { once: true }); }); }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function newRun(input) {
    return {
      id: input.id || uid(), app: 'ResearchCrew AI', version: 1, createdAt: new Date().toISOString(), finishedAt: null,
      question: String(input.question || '').trim(), audience: input.audience || 'general', length: input.length || 'medium', depth: input.depth || 'standard',
      mode: input.mode || 'demo', maxRounds: Math.max(1, Math.min(3, +input.maxRounds || 3)), autoApprove: !!input.autoApprove, parallel: Math.max(1, Math.min(6, +input.parallel || 3)),
      models: input.models || {}, provider: input.provider || null,
      status: 'idle', plan: null, research: {}, notes: [], flags: [], drafts: [], critiques: [], messages: [],
      stats: Object.fromEntries(AGENTS.map((a) => [a, { calls: 0, input: 0, output: 0, cost: 0, ms: 0, estimated: input.mode !== 'llm' }])),
      agent: { planner: 'idle', writer: 'idle', critic: 'idle', researchers: {} }, error: null, sourceIds: input.sourceIds || []
    };
  }
  function createEngine(o) {
    const agents = o.agents; const onChange = o.onChange || (() => {}); const delays = o.delays || { planner: 0, researcher: 0, writer: 0, critic: 0 };
    const run = o.run || newRun(o.input || {});
    let ctl = null; let paused = false; let stepMode = false; let stopped = false; let looping = null; let wake = null;
    const emit = () => { try { onChange(run); } catch (e) { /* UI errors must not kill the run */ } };
    const t0 = Date.now();
    function msg(from, to, kind, text, extra) { run.messages.push(Object.assign({ t: Date.now() - t0, at: new Date().toISOString(), from, to, kind, text: String(text) }, extra || {})); }
    function account(agent, r, inText, outText) {
      const s = run.stats[agent]; s.calls++;
      const u = r && r.usage; s.input += u ? u.input : T.estTokens(inText); s.output += u ? u.output : T.estTokens(outText);
      s.cost += (r && r.cost) || 0; s.ms += (r && r.ms) || 0; if (u) s.estimated = false;
      return { tokens: (u ? u.input + u.output : T.estTokens(inText) + T.estTokens(outText)), cost: (r && r.cost) || 0 };
    }
    async function timed(agent, fn) { const a = Date.now(); const r = await fn(); r.ms = r.ms || Date.now() - a; return r; }
    function next() {
      if (!run.plan) return 'plan';
      if (!run.plan.approved) return 'approve';
      if (run.plan.subqs.some((q) => !run.research[q.id] || run.research[q.id].status !== 'done')) return 'research';
      if (!run.drafts.length) return 'write';
      const last = run.drafts[run.drafts.length - 1]; const crit = run.critiques.find((c) => c.draft === last.round);
      if (!crit) return 'critique';
      if (crit.pass || run.critiques.length >= run.maxRounds) return 'done';
      return 'revise';
    }
    function numberNotes() {
      const all = []; for (const q of run.plan.subqs) for (const n of (run.research[q.id] || {}).notes || []) all.push(n);
      all.forEach((n, i) => { n.n = i + 1; n.id = 'N' + (i + 1); });
      run.notes = all;
    }
    function ctxBase() { return { run, question: run.question, audience: run.audience, length: run.length, depth: run.depth, plan: run.plan, notes: run.notes, research: run.research, signal: ctl.signal }; }
    async function doPlan() {
      run.agent.planner = 'running'; msg('you', 'planner', 'question', run.question + ' (' + run.audience + ', ' + run.length + ', ' + run.depth + ')'); emit();
      await sleep(delays.planner, ctl.signal);
      const r = await timed('planner', () => agents.plan(ctxBase()));
      const plan = r.output; plan.approved = run.autoApprove; run.plan = plan; run.agent.planner = 'done';
      const acc = account('planner', r, run.question, JSON.stringify(plan));
      msg('planner', 'researcher', 'plan', plan.subqs.length + ' sub-questions: ' + plan.subqs.map((q) => q.q).join(' | '), acc);
      if (plan.reasoning) msg('planner', 'you', 'note', plan.reasoning);
      if (!run.autoApprove) msg('planner', 'you', 'approval', 'Waiting for you to approve or edit the plan.');
    }
    async function doResearch() {
      const todo = run.plan.subqs.filter((q) => !run.research[q.id] || run.research[q.id].status !== 'done');
      todo.forEach((q) => { run.research[q.id] = { status: 'queued', notes: [], flagged: [] }; run.agent.researchers[q.id] = 'queued'; });
      if (agents.prepare) { const g = await agents.prepare(ctxBase()); run.flags = g.flags || []; if (g.flags && g.flags.length) msg('guard', 'researcher', 'guard', g.flags.length + ' instruction-like sentence' + (g.flags.length > 1 ? 's' : '') + ' found in ' + Array.from(new Set(g.flags.map((f) => f.sourceId))).join(', ') + '. Fenced as data and ignored.'); if (g.message) msg('guard', 'researcher', 'note', g.message); }
      emit();
      let i = 0; const queue = todo.slice(); const lanes = [];
      const worker = async () => {
        while (queue.length) {
          const q = queue.shift(); const k = i++;
          run.research[q.id].status = 'running'; run.agent.researchers[q.id] = 'running'; emit();
          await sleep(delays.researcher ? delays.researcher + (k % 3) * delays.researcher * 0.5 : 0, ctl.signal);
          const r = await timed('researcher', () => agents.research(q, ctxBase()));
          const out = r.output; const acc = account('researcher', r, q.q, JSON.stringify(out.notes || []));
          run.research[q.id] = { status: 'done', notes: out.notes || [], flagged: out.flagged || [], abstain: !!out.abstain, reason: out.reason || '', rejected: out.rejected || 0, ms: r.ms, model: r.model };
          run.agent.researchers[q.id] = out.abstain ? 'abstain' : 'done';
          msg('researcher:' + q.id, 'writer', out.abstain ? 'abstain' : 'notes', out.abstain ? 'Not enough evidence for \u201C' + q.q + '\u201D. ' + (out.reason || '') : (out.notes.length + ' note' + (out.notes.length > 1 ? 's' : '') + ' with exact quotes for \u201C' + q.q + '\u201D from ' + Array.from(new Set(out.notes.map((n) => n.sourceId))).join(', ') + '.') + ((out.flagged || []).length ? ' Ignored ' + out.flagged.length + ' flagged sentence' + (out.flagged.length > 1 ? 's' : '') + ' (' + out.flagged.map((f) => f.sourceId).join(', ') + ').' : '') + (out.rejected ? ' Dropped ' + out.rejected + ' quote' + (out.rejected > 1 ? 's' : '') + ' not found verbatim in the source.' : ''), acc);
          emit();
        }
      };
      for (let w = 0; w < Math.min(run.parallel, todo.length); w++) lanes.push(worker());
      try { await Promise.all(lanes); } catch (e) { for (const q of todo) if (run.research[q.id].status !== 'done') { run.research[q.id].status = 'pending'; run.agent.researchers[q.id] = e.stopped ? 'stopped' : 'error'; } throw e; }
      numberNotes();
    }
    async function doWrite() {
      run.agent.writer = 'running'; emit(); await sleep(delays.writer, ctl.signal);
      const r = await timed('writer', () => agents.write(ctxBase()));
      run.drafts.push({ round: 1, text: r.output.text, model: r.output.model || null, changes: r.output.changes || [], at: new Date().toISOString(), by: r.model || 'demo writer' });
      run.agent.writer = 'done'; const acc = account('writer', r, JSON.stringify(run.notes), r.output.text);
      msg('writer', 'critic', 'draft', 'Draft 1 (' + T.wordCount(r.output.text) + ' words).', acc);
    }
    async function doCritique() {
      const d = run.drafts[run.drafts.length - 1];
      run.agent.critic = 'running'; emit(); await sleep(delays.critic, ctl.signal);
      const r = await timed('critic', () => agents.critique(d, ctxBase()));
      const c = Object.assign({ draft: d.round, round: run.critiques.length + 1, at: new Date().toISOString(), by: r.model || 'rule checks' }, r.output);
      c.requests = c.issues.map((x) => Object.assign({}, x));
      run.critiques.push(c); run.agent.critic = 'done';
      const acc = account('critic', r, d.text, JSON.stringify(c.issues));
      const last = run.critiques.length >= run.maxRounds;
      msg('critic', c.pass ? 'you' : last ? 'you' : 'writer', c.pass ? 'pass' : 'review', (c.pass ? 'Passed' : 'Needs work') + ': rubric ' + c.average + '/5, ' + c.majors + ' major issue' + (c.majors === 1 ? '' : 's') + ', ' + (c.issues.length - c.majors) + ' minor. ' + (c.pass ? '' : last ? 'Stopping: reached the ' + run.maxRounds + '-round limit.' : c.issues.length + ' revision request' + (c.issues.length === 1 ? '' : 's') + ' sent to the writer.'), acc);
      run.agent.writer = c.pass || last ? 'done' : 'waiting';
    }
    async function doRevise() {
      const d = run.drafts[run.drafts.length - 1]; const c = run.critiques.find((x) => x.draft === d.round);
      run.agent.writer = 'running'; emit(); await sleep(delays.writer, ctl.signal);
      const r = await timed('writer', () => agents.revise(d, c.requests || c.issues, ctxBase()));
      const nd = { round: d.round + 1, text: r.output.text, model: r.output.model || null, changes: r.output.changes || [], at: new Date().toISOString(), by: r.model || 'demo writer', from: d.round };
      run.drafts.push(nd); run.agent.writer = 'done';
      const acc = account('writer', r, d.text + JSON.stringify(c.requests), r.output.text);
      msg('writer', 'critic', 'draft', 'Draft ' + nd.round + ': ' + (nd.changes || []).slice(0, 4).join(' '), acc);
    }
    const STEPS = { plan: doPlan, research: doResearch, write: doWrite, critique: doCritique, revise: doRevise };
    async function loop() {
      while (true) {
        if (stopped) return;
        if (paused) { run.status = 'paused'; emit(); await new Promise((r) => (wake = r)); wake = null; continue; }
        const s = next();
        if (s === 'done') { run.status = 'done'; run.finishedAt = new Date().toISOString(); const c = run.critiques[run.critiques.length - 1]; msg('team', 'you', 'done', c && c.pass ? 'Report ready: the critic passed draft ' + c.draft + ' in round ' + c.round + '.' : 'Report ready after ' + run.critiques.length + ' round' + (run.critiques.length === 1 ? '' : 's') + '; the critic did not pass it, so open issues are listed.'); emit(); return; }
        if (s === 'approve') { run.status = 'awaiting-approval'; emit(); await new Promise((r) => (wake = r)); wake = null; continue; }
        run.status = 'running'; run.step = s; ctl = new AbortController(); emit();
        try { await STEPS[s](); }
        catch (e) {
          AGENTS.forEach((a) => { if (run.agent[a] === 'running') run.agent[a] = e.stopped ? 'stopped' : 'error'; });
          if (e.stopped) { run.status = 'stopped'; msg('you', 'team', 'stop', 'Stopped during ' + s + '. Resume to continue from this step.'); emit(); return; }
          run.status = 'error'; run.error = e.message || String(e); msg('team', 'you', 'error', s + ' failed: ' + run.error); emit(); return;
        }
        run.step = null; emit();
        if (stepMode) { stepMode = false; paused = true; }
      }
    }
    function kick() { if (looping) looping.then(() => { if (!['running', 'done'].includes(run.status)) start(); }); else start(); return looping; }
    function start() { if (looping) return looping; stopped = false; run.error = null; looping = loop().finally(() => { looping = null; }); return looping; }
    const api = {
      run, next, start,
      pause() { if (run.status === 'running' || run.status === 'awaiting-approval') { paused = true; if (run.status !== 'running') { run.status = 'paused'; emit(); } msg('you', 'team', 'pause', 'Pause requested; the team stops after the current step.'); emit(); } },
      resume() { paused = false; stepMode = false; if (run.status === 'stopped' || run.status === 'error' || run.status === 'done') { return kick(); } if (wake) wake(); else kick(); return looping; },
      step() { paused = false; stepMode = true; if (run.status === 'awaiting-approval') return looping; if (wake) wake(); else kick(); return looping; },
      stop() { stopped = true; paused = false; if (ctl) ctl.abort(); if (wake) { wake(); } if (run.status !== 'running') { run.status = 'stopped'; emit(); } },
      approve(plan) { if (plan) run.plan = plan; run.plan.approved = true; msg('you', 'planner', 'approve', 'Plan approved' + (plan && plan.edited ? ' with your edits' : '') + ': ' + run.plan.subqs.length + ' sub-questions.'); paused = false; stepMode = false; if (wake) wake(); else if (run.status !== 'running') { kick(); } emit(); },
      /* Edits: each one drops whatever depended on the edited artifact. */
      editPlan(plan) { const old = new Map((run.plan ? run.plan.subqs : []).map((q) => [q.id, q.q])); run.plan = Object.assign({}, plan, { approved: plan.approved !== false && !!(run.plan && run.plan.approved), edited: true }); for (const k of Object.keys(run.research)) { const q = plan.subqs.find((x) => x.id === k); if (!q || q.q !== old.get(k)) delete run.research[k]; } run.agent.researchers = {}; for (const q of plan.subqs) run.agent.researchers[q.id] = run.research[q.id] ? (run.research[q.id].abstain ? 'abstain' : 'done') : 'idle'; run.drafts = []; run.critiques = []; if (plan.subqs.every((q) => run.research[q.id])) numberNotes(); msg('you', 'planner', 'edit', 'Edited the plan (' + plan.subqs.length + ' sub-questions). Research for changed questions and all drafts were reset.'); if (run.status === 'done') run.status = 'paused'; emit(); },
      editNotes(subqId, notes) { run.research[subqId] = Object.assign({}, run.research[subqId], { notes, abstain: !notes.length, status: 'done', edited: true }); numberNotes(); run.drafts = []; run.critiques = []; run.agent.writer = 'idle'; run.agent.critic = 'idle'; msg('you', 'researcher:' + subqId, 'edit', 'Edited the notes (' + notes.length + ' left). Drafts were reset so the writer uses them.'); if (run.status === 'done') run.status = 'paused'; emit(); },
      editDraft(text) { const d = run.drafts[run.drafts.length - 1]; const nd = { round: (d ? d.round : 0) + 1, text, changes: ['Edited by you.'], at: new Date().toISOString(), by: 'you', edited: true, from: d && d.round }; run.drafts.push(nd); msg('you', 'critic', 'edit', 'Edited the draft (now draft ' + nd.round + '). The critic reviews it next.'); if (run.status === 'done') run.status = 'paused'; emit(); },
      editRequests(requests) { const c = run.critiques[run.critiques.length - 1]; if (!c) return; c.requests = requests; c.editedRequests = true; msg('you', 'writer', 'edit', 'Edited the revision requests (' + requests.length + ').'); if (run.status === 'done' && !c.pass && requests.length) { run.maxRounds = Math.min(3, Math.max(run.maxRounds, run.critiques.length + 1)); run.status = 'paused'; } emit(); },
      get busy() { return !!looping; }
    };
    return api;
  }
  return { createEngine, newRun, AGENTS, sleep };
});
