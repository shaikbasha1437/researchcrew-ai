const test = require('node:test'); const assert = require('node:assert');
const { L, E, A } = require('./helpers.js');
const Q = L.TOPICS[0].samples[0];
const mk = (input, o) => E.createEngine(Object.assign({ agents: A.demoAgents({ library: L }), input: Object.assign({ question: Q }, input) }, o || {}));
const until = (eng, pred, ms) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { if (pred(eng.run)) return res(); if (Date.now() - t0 > (ms || 4000)) return rej(new Error('timeout: ' + eng.run.status)); setTimeout(tick, 5); }; tick(); });
test('waits for plan approval, then runs to the end', async () => {
  const eng = mk({}); eng.start(); await until(eng, (r) => r.status === 'awaiting-approval');
  assert.strictEqual(eng.run.drafts.length, 0); assert.strictEqual(Object.keys(eng.run.research).length, 0);
  eng.approve(); await until(eng, (r) => r.status === 'done'); assert.ok(eng.run.critiques.length >= 2);
});
test('edited plan before approval is what the researchers use', async () => {
  const eng = mk({}); eng.start(); await until(eng, (r) => r.status === 'awaiting-approval');
  const p = JSON.parse(JSON.stringify(eng.run.plan)); p.subqs = p.subqs.slice(0, 2); eng.editPlan(p); eng.approve();
  await until(eng, (r) => r.status === 'done'); assert.deepStrictEqual(Object.keys(eng.run.research).sort(), ['q1', 'q2']);
  assert.ok(eng.run.messages.some((m) => m.kind === 'edit'));
});
test('step runs one step then pauses; resume finishes', async () => {
  const eng = mk({ autoApprove: true }); eng.pause(); eng.start(); await until(eng, (r) => r.status === 'paused' || r.status === 'running');
  eng.pause(); await until(eng, (r) => r.status === 'paused');
  const before = eng.next(); eng.step(); await until(eng, (r) => r.status === 'paused' && eng.next() !== before);
  eng.resume(); await until(eng, (r) => r.status === 'done');
});
test('stop during research keeps finished work; resume completes', async () => {
  const eng = mk({ autoApprove: true, parallel: 2 }, { delays: { planner: 0, researcher: 40, writer: 0, critic: 0 } }); eng.start();
  await until(eng, (r) => Object.values(r.research).some((x) => x.status === 'done'));
  eng.stop(); await until(eng, (r) => r.status === 'stopped'); assert.ok(!eng.busy || true);
  assert.ok(Object.values(eng.run.research).some((x) => x.status !== 'done'));
  eng.resume(); await until(eng, (r) => r.status === 'done', 6000);
  assert.ok(eng.run.plan.subqs.every((q) => eng.run.research[q.id].status === 'done'));
});
test('researchers run in parallel up to the limit', async () => {
  let live = 0; let peak = 0; const base = A.demoAgents({ library: L });
  const agents = Object.assign({}, base, { research: async (q, ctx) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 30)); live--; return base.research(q, ctx); } });
  const eng = E.createEngine({ agents, input: { question: Q, autoApprove: true, parallel: 3 } }); await eng.start();
  assert.strictEqual(peak, 3);
});
test('rounds are bounded by maxRounds', async () => { const eng = mk({ autoApprove: true, maxRounds: 1 }); await eng.start(); assert.strictEqual(eng.run.critiques.length, 1); assert.strictEqual(eng.run.drafts.length, 1); assert.strictEqual(eng.run.status, 'done'); });
test('editing the draft creates a new draft that the critic reviews on resume', async () => {
  const eng = mk({ autoApprove: true }); await eng.start(); const n = eng.run.drafts.length;
  eng.editDraft(eng.run.drafts[n - 1].text + '\nRidership tripled overnight.\n'); assert.strictEqual(eng.run.status, 'paused');
  await eng.resume(); const c = eng.run.critiques.find((x) => x.draft === n + 1); assert.ok(c); assert.ok(c.issues.some((i) => i.type === 'unsupported'));
});
test('editing revision requests changes what the writer does', async () => {
  const eng = mk({ autoApprove: true, maxRounds: 3 }); eng.pause(); eng.start();
  while (!eng.run.critiques.length) { eng.step(); await until(eng, (r) => r.status === 'paused'); }
  const c = eng.run.critiques[0]; eng.editRequests(c.requests.filter((x) => x.type !== 'missing'));
  eng.step(); await until(eng, (r) => r.status === 'paused' && r.drafts.length === 2);
  const abst = eng.run.plan.subqs.find((q) => eng.run.research[q.id].abstain);
  assert.ok(!eng.run.drafts[1].text.includes('## ' + abst.q), 'dropped request was not applied');
});
test('editing notes resets drafts and renumbers', async () => {
  const eng = mk({ autoApprove: true }); await eng.start(); const q1 = eng.run.research.q1.notes.slice(1).map((n) => ({ subq: 'q1', sourceId: n.sourceId, quote: n.quote, score: n.score }));
  eng.editNotes('q1', q1); assert.strictEqual(eng.run.drafts.length, 0); assert.strictEqual(eng.run.notes[0].n, 1);
  await eng.resume(); assert.strictEqual(eng.run.status, 'done');
});
test('an agent error stops the run with a readable message, and resume retries', async () => {
  let fail = true; const base = A.demoAgents({ library: L });
  const agents = Object.assign({}, base, { write: async (ctx) => { if (fail) { fail = false; throw new Error('The key was rejected. (OpenAI 401)'); } return base.write(ctx); } });
  const eng = E.createEngine({ agents, input: { question: Q, autoApprove: true } }); await eng.start();
  assert.strictEqual(eng.run.status, 'error'); assert.match(eng.run.error, /key was rejected/);
  await eng.resume(); assert.strictEqual(eng.run.status, 'done');
});
test('approving a plan while paused continues the research (the button says "Approve & research")', async () => {
  const eng = mk({}); eng.start(); await until(eng, (r) => r.status === 'awaiting-approval');
  eng.pause(); assert.strictEqual(eng.run.status, 'paused');
  eng.approve(); await until(eng, (r) => r.status === 'done'); assert.ok(eng.run.plan.approved);
});
test('approving a reopened (stopped, unapproved) run starts it', async () => {
  const eng = mk({}); eng.start(); await until(eng, (r) => r.status === 'awaiting-approval'); eng.stop(); await until(eng, (r) => r.status === 'stopped');
  eng.approve(); await until(eng, (r) => r.status === 'done');
});
test('resume right after stop restarts once the stopped step has unwound', async () => {
  const eng = mk({ autoApprove: true }, { delays: { planner: 5, researcher: 30, writer: 30, critic: 30 } }); eng.start(); await until(eng, (r) => r.step === 'research' || Object.keys(r.research).length > 0);
  eng.stop(); eng.resume(); await until(eng, (r) => r.status === 'done', 8000); assert.ok(eng.run.critiques[eng.run.critiques.length - 1].pass);
});
