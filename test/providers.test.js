const test = require('node:test'); const assert = require('node:assert');
const LLM = require('../js/llm.js'); const S = require('../js/search.js');
const msg = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], json: true };
test('Anthropic requests carry the direct-browser-access header and the key only in x-api-key', () => {
  const r = LLM.buildRequest({ provider: 'anthropic', key: 'sk-ant-fake', model: 'claude-haiku-4-5' }, msg);
  assert.strictEqual(r.init.headers['anthropic-dangerous-direct-browser-access'], 'true'); assert.strictEqual(r.init.headers['x-api-key'], 'sk-ant-fake'); assert.ok(!r.init.body.includes('sk-ant-fake'));
});
test('Gemini puts the key in x-goog-api-key, not the URL', () => { const r = LLM.buildRequest({ provider: 'gemini', key: 'AIzaFAKE', model: 'gemini-2.5-flash' }, msg); assert.ok(!r.url.includes('AIzaFAKE')); assert.strictEqual(r.init.headers['x-goog-api-key'], 'AIzaFAKE'); });
test('OpenAI-compatible uses the base URL and OpenRouter headers', () => { const r = LLM.buildRequest({ provider: 'compatible', key: 'k', baseUrl: 'https://openrouter.ai/api/v1/', model: 'openai/gpt-5-mini' }, msg); assert.strictEqual(r.url, 'https://openrouter.ai/api/v1/chat/completions'); assert.match(r.init.headers['HTTP-Referer'], /researchcrew-ai/); });
for (const [provider, status, body] of [['openai', 401, { error: { message: 'Incorrect API key provided' } }], ['anthropic', 401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }], ['gemini', 400, { error: { message: 'API key not valid. Please pass a valid API key.' } }], ['compatible', 401, { error: { message: 'No auth credentials found' } }]]) {
  test(provider + ' bad key gives a readable error', async () => {
    const fetch = async () => ({ ok: false, status, text: async () => JSON.stringify(body) });
    await assert.rejects(LLM.call({ provider, key: 'bad-key-123', model: LLM.PROVIDERS[provider].defaultModel, baseUrl: provider === 'compatible' ? 'https://openrouter.ai/api/v1' : '' }, msg, { fetch }), /key was rejected/);
  });
}
test('a CORS-less OpenAI failure explains itself', async () => { await assert.rejects(LLM.call({ provider: 'openai', key: 'bad' }, msg, { fetch: async () => { throw new TypeError('Failed to fetch'); } }), /CORS header/); });
test('Tavily search request and bad key error', async () => {
  const r = S.buildSearch('tvly-fake', 'q', { max: 5 }); assert.strictEqual(r.init.headers.authorization, 'Bearer tvly-fake'); assert.ok(!r.init.body.includes('tvly-fake'));
  const c = S.createTavily('tvly-fake', { fetch: async () => ({ ok: false, status: 401, text: async () => '{"detail":{"error":"Unauthorized"}}' }) });
  await assert.rejects(c.search('x'), /Tavily rejected the key/);
});
