const test = require('node:test'); const assert = require('node:assert');
const C = require('../js/critic.js');
const src = { S1: { id: 'S1', text: 'Trips rose 41% in 2025. The city spent $6 million.', date: '2026-01-01', quality: 'high', publisher: 'City' }, S2: { id: 'S2', text: 'An audit found trips rose 22% in 2025.', date: '2026-02-01', quality: 'high', publisher: 'Auditor' }, S3: { id: 'S3', text: 'Old study: trips would reach 600,000.', date: '2020-01-01', quality: 'medium', publisher: 'Old' }, S4: { id: 'S4', text: 'Everybody loves it, trips doubled!', date: '2026-01-01', quality: 'low', publisher: 'Blog' } };
const notes = [{ n: 1, id: 'N1', subq: 'q1', sourceId: 'S1', quote: 'Trips rose 41% in 2025.' }, { n: 2, id: 'N2', subq: 'q1', sourceId: 'S2', quote: 'An audit found trips rose 22% in 2025.' }, { n: 3, id: 'N3', subq: 'q2', sourceId: 'S1', quote: 'The city spent $7 million.' }, { n: 4, id: 'N4', subq: 'q1', sourceId: 'S3', quote: 'Old study: trips would reach 600,000.' }, { n: 5, id: 'N5', subq: 'q1', sourceId: 'S4', quote: 'Everybody loves it, trips doubled!' }];
test('checkCitations classifies verified, broken, quote-missing, mismatch and unsupported', () => {
  const r = C.checkCitations('# T\n\nTrips rose 41% [1]. Spending was $7 million [3]. Trips rose 22% [1]. Bad cite [9]. Ridership doubled overall.', notes, src);
  const s = r.sentences;
  assert.strictEqual(s[0].cites[0].status, 'verified'); assert.deepStrictEqual(s[0].mismatched, []);
  assert.strictEqual(s[1].cites[0].status, 'quote-missing');
  assert.deepStrictEqual(s[2].mismatched, ['22%']);
  assert.strictEqual(s[3].cites[0].status, 'broken');
  assert.strictEqual(s[4].unsupported, true);
  assert.strictEqual(r.summary.verified, 2);
});
test('abstention and meta sentences are not unsupported claims', () => { const r = C.checkCitations('Not enough evidence: none of the searched sources address this. Sources disagree on this point.', [], {}); assert.strictEqual(r.summary.unsupported, 0); });
test('conflicts: same sub-question, different sources, different numbers with the same unit', () => {
  const c = C.conflicts(notes); assert.ok(c.some((x) => x.a === 'N1' && x.b === 'N2' && x.unit === '%'));
  assert.ok(!c.some((x) => x.subq === 'q2'));
});
test('review: hidden contradiction, outdated and low-quality sources, missing sub-question, one-sided', () => {
  const plan = { subqs: [{ id: 'q1', q: 'How did trips change?' }, { id: 'q2', q: 'What did it cost?' }, { id: 'q3', q: 'What about health?' }] };
  const text = '# R\n\n## How did trips change?\n\nTrips rose 41% in 2025 [1]. Old study: trips would reach 600,000 [4]. Everybody loves it [5].\n\n## What did it cost?\n\nNo data here.\n';
  const r = C.review(text, { plan, notes, sources: src, research: { q3: { abstain: true } }, length: 'short' });
  const types = r.issues.map((i) => i.type);
  for (const t of ['conflict', 'outdated', 'low-quality', 'missing']) assert.ok(types.includes(t), t + ' in ' + types);
  assert.strictEqual(r.pass, false); assert.ok(r.rubric.balance < 5 && r.rubric.sources < 5 && r.rubric.coverage < 5);
});
test('review passes a clean, balanced, labelled draft', () => {
  const plan = { subqs: [{ id: 'q1', q: 'How did trips change?' }] };
  const n2 = notes.filter((n) => n.n <= 2);
  const text = '# R\n\n## Summary\n\nSources disagree on growth.\n\n## How did trips change?\n\nSources disagree on this point. City: Trips rose 41% in 2025 [1]. By contrast, Auditor: An audit found trips rose 22% in 2025 [2]. ' + 'More context follows here in plain words without new claims. '.repeat(14);
  const r = C.review(text, { plan, notes: n2, sources: src, research: {}, length: 'short' });
  assert.deepStrictEqual(r.issues.filter((i) => i.severity === 'major'), []); assert.strictEqual(r.pass, true);
});
