/* AgentKit web search: Tavily Search and Extract, called straight from the browser with the user's key.
   Tavily allows cross-origin calls (Access-Control-Allow-Origin: *). Brave Search does not answer CORS
   preflights, so it can't be called from a web page and is not offered here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AgentKit = root.AgentKit || {}).search = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE = 'https://api.tavily.com';
  function buildSearch(key, query, opts) {
    const o = opts || {};
    const body = { query: String(query).slice(0, 400), search_depth: o.depth || 'basic', max_results: Math.min(20, o.max || 8), topic: o.topic || 'general', include_answer: false, include_raw_content: false };
    if (o.timeRange) body.time_range = o.timeRange;
    if (o.includeDomains && o.includeDomains.length) body.include_domains = o.includeDomains;
    if (o.topic === 'news' || o.dates) body.include_published_date = true;
    return { url: BASE + '/search', init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) } };
  }
  function buildExtract(key, urls) {
    return { url: BASE + '/extract', init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ urls: urls.slice(0, 5), extract_depth: 'basic' }) } };
  }
  function isoDate(s) { const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  function parseSearch(j) { return ((j && j.results) || []).map((r) => ({ title: String(r.title || ''), url: String(r.url || ''), content: String(r.content || ''), date: r.published_date ? isoDate(r.published_date) : '', score: Number(r.score) || 0 })); }
  function parseExtract(j) { return { results: ((j && j.results) || []).map((r) => ({ title: r.url, url: String(r.url || ''), content: String(r.raw_content || '').slice(0, 6000), date: '' })), failed: ((j && j.failed_results) || []).map((f) => (f && f.url) || String(f)) }; }
  async function send(req, deps) {
    const d = deps || {}; const f = d.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    let res;
    try { res = await f(req.url, req.init); } catch (e) { throw new Error('Could not reach api.tavily.com (offline or blocked).'); }
    const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const msg = (j && j.detail && (j.detail.error || (Array.isArray(j.detail) && j.detail[0] && j.detail[0].msg))) || txt.slice(0, 160);
      const hint = res.status === 401 ? 'Tavily rejected the key. ' : res.status === 429 ? 'Tavily rate limit reached. ' : res.status === 432 || res.status === 433 ? 'Tavily plan or credit limit reached. ' : '';
      throw Object.assign(new Error(hint + '(Tavily ' + res.status + (msg ? ': ' + msg : '') + ')'), { status: res.status });
    }
    return j || {};
  }
  function createTavily(key, deps) {
    if (!key) return null;
    return {
      label: 'Tavily',
      search: async (query, opts) => parseSearch(await send(buildSearch(key, query, opts), deps)),
      extract: async (urls) => parseExtract(await send(buildExtract(key, urls), deps))
    };
  }
  return { BASE, buildSearch, buildExtract, parseSearch, parseExtract, createTavily };
});
