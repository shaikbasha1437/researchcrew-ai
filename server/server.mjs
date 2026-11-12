#!/usr/bin/env node
/* ResearchCrew fetch helper: a tiny, optional, self-hosted CORS proxy so the web app can read pages that
   block cross-origin reads. Safety: listens on 127.0.0.1 only, needs a token, only fetches hosts on your
   allowlist, refuses private/loopback addresses (re-checked on every redirect), GET only, 2 MB and 15 s caps,
   and returns plain text (no scripts, no cookies). No dependencies. */
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { htmlToText } = require('../js/sources.js');

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const v = ip.toLowerCase(); if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
export function hostAllowed(host, allow) { const h = String(host || '').toLowerCase().replace(/\.$/, ''); return allow.some((a) => { const x = a.toLowerCase().trim(); return x && (h === x || h.endsWith('.' + x)); }); }
function safeEqual(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

export function createHandler(o) {
  const token = o.token; const allow = o.allow || []; const origins = o.origins || ['https://shaikbasha1437.github.io'];
  const doFetch = o.fetch || globalThis.fetch; const lookup = o.lookup || ((h) => dns.lookup(h, { all: true }));
  const maxBytes = o.maxBytes || 2 * 1024 * 1024; const timeoutMs = o.timeoutMs || 15000;
  async function check(u) {
    let url; try { url = new URL(u); } catch (e) { throw Object.assign(new Error('Not a valid URL.'), { code: 400 }); }
    if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Only http and https URLs.'), { code: 400 });
    if (url.username || url.password) throw Object.assign(new Error('URLs with credentials are refused.'), { code: 400 });
    if (!hostAllowed(url.hostname, allow)) throw Object.assign(new Error(url.hostname + ' is not on the allowlist. Restart with --allow ' + url.hostname), { code: 403 });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('Refused: ' + url.hostname + ' resolves to a private or local address.'), { code: 403 });
    return url;
  }
  return async function handler(req, res) {
    const origin = req.headers.origin || '';
    const cors = origins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'authorization', 'access-control-allow-methods': 'GET', 'access-control-allow-private-network': 'true' } : {};
    const send = (code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, cors)); res.end(JSON.stringify(obj)); };
    if (origin && !cors['access-control-allow-origin']) return send(403, { error: 'Origin not allowed: ' + origin });
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'GET') return send(405, { error: 'GET only.' });
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/health') return send(200, { ok: true, app: 'researchcrew-fetch-helper' });
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token || !safeEqual(auth, token)) return send(401, { error: 'Missing or wrong token.' });
    if (u.pathname !== '/fetch') return send(404, { error: 'Not found.' });
    try {
      let target = await check(u.searchParams.get('url') || '');
      let resp = null;
      for (let hop = 0; hop < 4; hop++) {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
        try { resp = await doFetch(target.href, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'ResearchCrewFetchHelper/1.0', accept: 'text/html,text/plain,application/json;q=0.8,*/*;q=0.1' } }); } finally { clearTimeout(t); }
        if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) { if (hop === 3) throw Object.assign(new Error('Too many redirects.'), { code: 502 }); target = await check(new URL(resp.headers.get('location'), target).href); continue; }
        break;
      }
      if (!resp.ok) return send(502, { error: 'Upstream answered HTTP ' + resp.status + '.' });
      const ct = resp.headers.get('content-type') || '';
      if (!/text\/|json|xml/i.test(ct)) return send(415, { error: 'Not a text page (' + (ct || 'unknown type') + '). Download it and upload the file instead.' });
      const len = +resp.headers.get('content-length') || 0; if (len > maxBytes) return send(413, { error: 'Page is larger than 2 MB.' });
      const buf = Buffer.from(await resp.arrayBuffer()); if (buf.length > maxBytes) return send(413, { error: 'Page is larger than 2 MB.' });
      const raw = buf.toString('utf8');
      const out = /html/i.test(ct) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw) : { title: '', text: raw };
      return send(200, { url: target.href, title: out.title, text: out.text.slice(0, 200000) });
    } catch (e) { return send(e.code || 502, { error: e.name === 'AbortError' ? 'Upstream timed out.' : e.message }); }
  };
}
function parseArgs(argv) { const a = { port: 8788, allow: [], origins: [] }; for (let i = 0; i < argv.length; i++) { const k = argv[i]; const v = argv[i + 1]; if (k === '--port') { a.port = +v; i++; } else if (k === '--allow') { a.allow.push(...String(v || '').split(',').filter(Boolean)); i++; } else if (k === '--origin') { a.origins.push(v); i++; } } return a; }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = parseArgs(process.argv.slice(2));
  const token = process.env.RC_TOKEN || crypto.randomBytes(18).toString('base64url');
  const origins = a.origins.length ? a.origins : ['https://shaikbasha1437.github.io'];
  if (!a.allow.length) console.warn('No --allow hosts given: every fetch will be refused. Example: node server.mjs --allow example.org,news.example.com');
  http.createServer(createHandler({ token, allow: a.allow, origins })).listen(a.port, '127.0.0.1', () => {
    console.log('ResearchCrew fetch helper on http://127.0.0.1:' + a.port);
    console.log('Token (paste into Settings > Helper token): ' + token);
    console.log('Allowed hosts: ' + (a.allow.join(', ') || '(none)') + ' · allowed page origins: ' + origins.join(', '));
  });
}
