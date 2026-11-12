const test = require('node:test'); const assert = require('node:assert');
const T = require('../js/text.js');
test('sentences keep abbreviations, decimals and a.m. together', () => {
  const s = T.sentences('Dr. Lee said 3.5 cycles. Docks are empty by 8 a.m. on weekdays. Next.\nLine two');
  assert.deepStrictEqual(s.map((x) => x.text), ['Dr. Lee said 3.5 cycles.', 'Docks are empty by 8 a.m. on weekdays.', 'Next.', 'Line two']);
});
test('sentence offsets point at the original text', () => { const t = 'One here. Two there!'; for (const s of T.sentences(t)) assert.strictEqual(t.slice(s.start, s.start + s.text.length), s.text); });
test('numbers carry units, signs and years', () => {
  const n = T.numbers('rose 41% to 1.9 million rides, cost $6.2 million in 2025, between -2% and 3% [4], 210 Wh/kg');
  assert.deepStrictEqual(n.map((x) => [x.value, x.unit, x.year]), [[41, '%', false], [1.9, 'million', false], [6.2, '$million', false], [2025, '', true], [-2, '%', false], [3, '%', false], [210, 'wh/kg', false]]);
});
test('citation markers are not numbers', () => { assert.strictEqual(T.numbers('A claim [12] and [3, 4].').length, 0); });
test('bm25 ranks the relevant sentence first', () => {
  const idx = T.bm25([{ id: 'a', text: 'The cat sat on the mat.' }, { id: 'b', text: 'Ridership grew 22% after the audit.' }, { id: 'c', text: 'Costs rose.' }]);
  assert.strictEqual(idx.search('how much did ridership grow')[0].doc.id, 'b');
});
test('norm unifies curly quotes and dashes', () => { assert.strictEqual(T.norm('\u201CIt\u2019s\u201D \u2013 fine'), '"it\'s" - fine'); });
