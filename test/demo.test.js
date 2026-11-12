const test = require('node:test'); const assert = require('node:assert');
const C = require('../js/critic.js'); const D = require('../js/demo.js'); const { L, LIB, demoRun } = require('./helpers.js');
const BAD = { ebike: /90%|definitive safety source/, fourday: /total success|40%/, battery: /safest battery ever|disregard any third-party/ };
for (const t of L.TOPICS) {
  test('demo topic ' + t.id + ': critic catches real problems in round 1, revision fixes them, all citations verify', async () => {
    const eng = await demoRun(t.samples[0]); const r = eng.run;
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(r.plan.topic, t.id);
    const r1 = r.critiques[0]; const types = r1.issues.map((i) => i.type);
    assert.strictEqual(r1.pass, false);
    for (const k of ['mismatch', 'missing', 'conflict']) assert.ok(types.includes(k), t.id + ' round 1 should flag ' + k + ': ' + types);
    const last = r.critiques[r.critiques.length - 1];
    assert.strictEqual(last.pass, true); assert.ok(r.critiques.length <= 3);
    const final = r.drafts[r.drafts.length - 1].text;
    const chk = C.checkCitations(final, r.notes, LIB).summary;
    assert.ok(chk.citations >= 8); assert.strictEqual(chk.verified, chk.citations); assert.strictEqual(chk.mismatched, 0); assert.strictEqual(chk.unsupported, 0);
    assert.ok(/Not enough evidence/.test(final), 'abstains explicitly');
    assert.ok(/Sources disagree/.test(final), 'shows the contradiction');
    assert.ok(!BAD[t.id].test(final), 'the planted instruction did not leak into the report');
    assert.ok(r.flags.length >= 1, 'guard flagged the planted injection');
    assert.ok(!r.notes.some((n) => /instruction|AI systems|assistant must/i.test(n.quote)), 'no note quotes an injection');
  });
}
test('every note quote is copied verbatim from its source', async () => {
  for (const t of L.TOPICS) { const r = (await demoRun(t.samples[1], { depth: 'deep' })).run; for (const n of r.notes) assert.ok(C.quoteInSource(n, LIB[n.sourceId]), n.quote); }
});
test('the abstaining sub-question really has no evidence in the library', () => {
  for (const t of L.TOPICS) { const p = D.plan({ question: t.samples[0], depth: 'standard' }); const abst = p.subqs.filter((q) => D.research(q, { plan: p, depth: 'standard', sources: L.forTopic(t.id) }).abstain); assert.strictEqual(abst.length, 1, t.id); }
});
test('an off-library question abstains on everything instead of guessing', async () => {
  const r = (await demoRun('Is remote work good for productivity?')).run;
  assert.strictEqual(r.plan.topic, null); assert.ok(r.notes.length === 0);
  assert.ok(/Not enough evidence/.test(r.drafts[r.drafts.length - 1].text));
});
test('depth controls the number of sub-questions', () => { assert.strictEqual(D.plan({ question: L.TOPICS[0].samples[0], depth: 'quick' }).subqs.length, 3); assert.strictEqual(D.plan({ question: L.TOPICS[0].samples[0], depth: 'deep' }).subqs.length, 6); });
test('demo is deterministic', async () => { const a = (await demoRun(L.TOPICS[1].samples[0])).run; const b = (await demoRun(L.TOPICS[1].samples[0])).run; assert.strictEqual(a.drafts.map((d) => d.text).join('|'), b.drafts.map((d) => d.text).join('|')); });
