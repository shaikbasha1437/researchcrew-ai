/* ResearchCrew user sources (your-AI mode): URLs, pasted text, PDF / Markdown / text files, and Tavily web
   results. A web page cannot read most other sites (CORS), so fetching a URL tries, in order: a direct read,
   your self-hosted fetch helper (server/), Tavily Extract with your key; otherwise it asks you to paste the text. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.RC = root.RC || {}).sources = factory(root.RC.text);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const MAX_CHARS = 60000;
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  /* HTML to readable text without executing anything. Uses DOMParser in the browser, regex in Node. */
  function htmlToText(html) {
    const s = String(html || '');
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(s, 'text/html');
      doc.querySelectorAll('script,style,noscript,template,svg,nav,footer,header,aside,form,iframe').forEach((n) => n.remove());
      const title = (doc.querySelector('title') || {}).textContent || '';
      const blocks = Array.from(doc.body ? doc.body.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,td,pre') : []).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
      const text = blocks.length ? blocks.join('\n') : (doc.body ? doc.body.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
      // Hidden-comment instructions are a common injection trick: keep comments so the guard can flag them.
      const comments = (s.match(/<!--[\s\S]*?-->/g) || []).map((c) => c.replace(/^<!--|-->$/g, '').trim()).filter((c) => c.length > 8);
      return { title: title.trim(), text: (text + (comments.length ? '\n' + comments.join('\n') : '')).trim() };
    }
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1] || '';
    const comments = (s.match(/<!--[\s\S]*?-->/g) || []).map((c) => c.replace(/^<!--|-->$/g, '').trim()).filter((c) => c.length > 8);
    const text = s.replace(/<(script|style|noscript|template|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/(p|div|li|h\d|tr|blockquote|pre)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { title: title.trim(), text: (text + (comments.length ? '\n' + comments.join('\n') : '')).trim() };
  }
  function make(o, list) {
    const n = (list || []).reduce((m, s) => Math.max(m, +(String(s.id).replace(/^S/, '')) || 0), 0) + 1;
    return { id: 'S' + n, kind: o.kind, title: String(o.title || o.url || 'Untitled').slice(0, 200), publisher: o.publisher || hostOf(o.url) || (o.kind === 'file' ? 'Uploaded file' : 'Pasted text'), type: o.type || o.kind, quality: o.quality || 'unknown', date: o.date || '', url: o.url || '', text: String(o.text || '').slice(0, MAX_CHARS), truncated: String(o.text || '').length > MAX_CHARS, addedAt: new Date().toISOString() };
  }
  function looksHtml(t, ct) { return /html/i.test(ct || '') || /^\s*<(!doctype|html|head|body)/i.test(t); }
  /* deps: { fetch, proxy: {url, token}, tavily: client|null } */
  async function fetchUrl(url, deps) {
    const d = deps || {}; const f = d.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http(s):// address.');
    const tried = [];
    try {
      const res = await f(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const t = await res.text(); const ct = res.headers && res.headers.get ? res.headers.get('content-type') : '';
      const out = looksHtml(t, ct) ? htmlToText(t) : { title: '', text: t };
      if (out.text.length < 40) throw new Error('almost no text');
      return { title: out.title || url, text: out.text, via: 'direct' };
    } catch (e) { tried.push('direct read (' + (/Failed to fetch|NetworkError|Load failed|CORS/i.test(e.message) ? 'blocked by CORS' : e.message) + ')'); }
    if (d.proxy && d.proxy.url) {
      try {
        const res = await f(String(d.proxy.url).replace(/\/+$/, '') + '/fetch?url=' + encodeURIComponent(url), { headers: { authorization: 'Bearer ' + (d.proxy.token || '') } });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
        return { title: j.title || url, text: String(j.text || ''), via: 'fetch helper' };
      } catch (e) { tried.push('fetch helper (' + (/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'not reachable: is it running, and did you allow local network access?' : e.message) + ')'); }
    }
    if (d.tavily) {
      try { const r = await d.tavily.extract([url]); const hit = r.results[0]; if (hit && hit.content) return { title: url, text: hit.content, via: 'Tavily Extract' }; throw new Error('no content'); } catch (e) { tried.push('Tavily Extract (' + e.message + ')'); }
    }
    throw new Error('Could not read ' + hostOf(url) + ': ' + tried.join('; ') + '. Paste the text instead' + (d.proxy && d.proxy.url ? '' : ', or run the optional fetch helper from the repo\u2019s server/ folder') + (d.tavily ? '' : ', or add a Tavily key') + '.');
  }
  async function pdfText(bytes, base) {
    const lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', base).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base).href;
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise; const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 60); i++) { const pg = await doc.getPage(i); const tc = await pg.getTextContent(); pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ')); }
    return { text: pages.join('\n\n').trim(), pages: doc.numPages };
  }
  async function readFile(file, base) {
    const name = file.name || 'file'; const lower = name.toLowerCase();
    if (lower.endsWith('.pdf') || file.type === 'application/pdf') { const r = await pdfText(new Uint8Array(await file.arrayBuffer()), base); if (r.text.length < 40) throw new Error(name + ' has no text layer (scanned?). Paste its text instead.'); return { title: name, text: r.text, type: 'PDF' }; }
    if (/\.(md|markdown|txt|text)$/.test(lower) || /^text\//.test(file.type)) return { title: name, text: await file.text(), type: lower.endsWith('.txt') ? 'text file' : 'Markdown file' };
    if (/\.html?$/.test(lower)) { const h = htmlToText(await file.text()); return { title: h.title || name, text: h.text, type: 'HTML file' }; }
    throw new Error(name + ': only PDF, Markdown, text and HTML files are supported.');
  }
  function fromTavily(results, prefix) { return (results || []).filter((r) => r && r.content).map((r, i) => ({ id: (prefix || 'W') + (i + 1), kind: 'web', title: r.title || r.url, publisher: hostOf(r.url), type: 'web search result', quality: 'unknown', date: r.date || '', url: r.url, text: String(r.content).slice(0, 8000) })); }
  return { htmlToText, make, fetchUrl, readFile, pdfText, fromTavily, hostOf, MAX_CHARS };
});
