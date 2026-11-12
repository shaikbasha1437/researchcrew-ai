const test = require('node:test'); const assert = require('node:assert');
const http = require('node:http');
let mod; const load = async () => (mod = mod || await import('../server/server.mjs'));
function up(handler) { return new Promise((r) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); }); }
async function get(s, path, headers) { const p = s.address().port; const res = await fetch('http://127.0.0.1:' + p + path, { headers: headers || {} }); return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }; }
const upstream = (map) => async (url) => { const r = map[url]; if (!r) throw new Error('unexpected ' + url); return { ok: (r.status || 200) < 400, status: r.status || 200, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null }, arrayBuffer: async () => Buffer.from(r.body || '') }; };
const lookup = async (h) => [{ address: h === 'evil.example' || h === 'rebind.example' ? '10.0.0.5' : '93.184.216.34' }];
test('fetch helper: token, allowlist, private addresses, redirects, CORS and size', async () => {
  const { createHandler, isPrivateIp, hostAllowed } = await load();
  const fetchUp = upstream({ 'https://news.example/a': { headers: { 'content-type': 'text/html' }, body: '<title>N</title><script>x()</script><p>Hello world from news.</p>' }, 'https://news.example/redir': { status: 302, headers: { location: 'https://rebind.example/secret' } }, 'https://news.example/big': { headers: { 'content-type': 'text/plain', 'content-length': '9999999' }, body: 'x' }, 'https://news.example/bin': { headers: { 'content-type': 'application/octet-stream' }, body: 'x' } });
  const s = await up(createHandler({ token: 'tok123', allow: ['news.example', 'evil.example', 'rebind.example'], fetch: fetchUp, lookup }));
  try {
    const A = { authorization: 'Bearer tok123', origin: 'https://shaikbasha1437.github.io' };
    assert.strictEqual((await get(s, '/health')).status, 200);
    assert.strictEqual((await get(s, '/fetch?url=https://news.example/a')).status, 401);
    assert.strictEqual((await get(s, '/fetch?url=https://news.example/a', { authorization: 'Bearer wrong' })).status, 401);
    const ok = await get(s, '/fetch?url=' + encodeURIComponent('https://news.example/a'), A);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.match(ok.body.text, /Hello world/); assert.ok(!/x\(\)/.test(ok.body.text)); assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://shaikbasha1437.github.io');
    assert.strictEqual((await get(s, '/fetch?url=' + encodeURIComponent('https://other.example/'), A)).status, 403);
    assert.match((await get(s, '/fetch?url=' + encodeURIComponent('https://evil.example/'), A)).body.error, /private or local/);
    assert.match((await get(s, '/fetch?url=' + encodeURIComponent('https://news.example/redir'), A)).body.error, /private or local/);
    assert.strictEqual((await get(s, '/fetch?url=' + encodeURIComponent('https://news.example/big'), A)).status, 413);
    assert.strictEqual((await get(s, '/fetch?url=' + encodeURIComponent('https://news.example/bin'), A)).status, 415);
    assert.strictEqual((await get(s, '/fetch?url=' + encodeURIComponent('file:///etc/passwd'), A)).status, 400);
    assert.strictEqual((await get(s, '/fetch?url=x', { authorization: 'Bearer tok123', origin: 'https://attacker.example' })).status, 403);
    const pre = await fetch('http://127.0.0.1:' + s.address().port + '/fetch', { method: 'OPTIONS', headers: { origin: 'https://shaikbasha1437.github.io', 'access-control-request-private-network': 'true' } });
    assert.strictEqual(pre.status, 204); assert.strictEqual(pre.headers.get('access-control-allow-private-network'), 'true');
  } finally { s.close(); }
  assert.ok(isPrivateIp('127.0.0.1') && isPrivateIp('192.168.1.2') && isPrivateIp('::1') && isPrivateIp('::ffff:10.1.1.1') && !isPrivateIp('93.184.216.34'));
  assert.ok(hostAllowed('a.news.example', ['news.example']) && !hostAllowed('news.example.evil.com', ['news.example']));
});
