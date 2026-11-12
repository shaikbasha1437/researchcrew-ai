const test = require('node:test'); const assert = require('node:assert');
const X = require('../js/export.js'); const C = require('../js/critic.js'); const { L, LIB, demoRun } = require('./helpers.js');
test('Markdown, HTML, JSON and bibliography exports are complete and contain no keys', async () => {
  const r = (await demoRun(L.TOPICS[2].samples[0])).run; r.apiKey = 'sk-should-not-leak-123456789012';
  const md = X.reportMd(r, LIB); assert.match(md, /## References/); assert.match(md, /Citations verified: (\d+)\/\1/);
  const html = X.reportHtml(r, LIB); assert.match(html, /<ol>/); assert.ok(!/<script/i.test(html));
  const j = JSON.parse(X.runJson(r, LIB)); assert.strictEqual(j.kind, 'run'); assert.ok(j.run.plan && j.run.notes.length && j.run.drafts.length >= 2 && j.run.critiques.length >= 2);
  assert.ok(!JSON.stringify(j).includes('sk-should-not-leak')); assert.ok(j.sources.every((s) => s.fictional));
  const used = new Set(j.run.notes.map((n) => n.sourceId)); for (const n of j.run.notes) assert.ok(C.quoteInSource(n, j.sources.find((s) => s.id === n.sourceId)));
  assert.ok(used.size >= 4);
  const bib = X.bibliographyMd(r, LIB); const cited = X.cited(r, r.drafts[r.drafts.length - 1].text); assert.strictEqual(bib.split('\n[').length, cited.length);
  assert.match(X.bibtex(r, LIB), /@misc\{C\d2026,/);
});
test('HTML export escapes source text', () => {
  const run = { question: '<b>q</b>', mode: 'demo', drafts: [{ round: 1, text: '# <img src=x onerror=alert(1)>\n\nHi [1].' }], critiques: [], notes: [{ n: 1, id: 'N1', sourceId: 'Z', quote: '<script>x</script>' }] };
  const h = X.reportHtml(run, { Z: { id: 'Z', title: '<i>t</i>', text: '<script>x</script>' } }); assert.ok(!/<img|<script>x/.test(h));
});
test('share links carry the question and settings only', () => {
  const u = X.shareUrl('https://x.example/app/', { question: 'Q?', depth: 'deep', length: 'short', key: 'sk-x', sources: ['S1'] });
  assert.ok(!/sk-x|S1/.test(u)); assert.deepStrictEqual(X.parseShare(u.split('#')[1]), { question: 'Q?', audience: undefined, length: 'short', depth: 'deep', maxRounds: undefined, autoApprove: undefined });
  assert.strictEqual(X.parseShare('#depth=deep'), null); assert.strictEqual(X.parseShare('#q=x&depth=evil').depth, undefined);
});
test('word diff between drafts', () => { const d = X.diff('a b c', 'a c d'); assert.deepStrictEqual(X.diffStats(d), { added: 1, removed: 1 }); assert.strictEqual(d.filter((p) => p.op !== 'del').map((p) => p.text).join(''), 'a c d'); });
