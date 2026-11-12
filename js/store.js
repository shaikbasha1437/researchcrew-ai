/* ResearchCrew storage: localStorage for settings, keys (only if you choose) and your sources list;
   IndexedDB for run history. Falls back to memory if storage is blocked. */
(function (root) {
  'use strict';
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  let dbp = null; const mem = new Map();
  function db() { if (dbp) return dbp; dbp = new Promise((res, rej) => { if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; } const r = indexedDB.open('researchcrew', 1); r.onupgradeneeded = () => { r.result.createObjectStore('runs', { keyPath: 'id' }); r.result.createObjectStore('sources', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return dbp; }
  function store(name) {
    const m = new Map(); mem.set(name, m);
    async function tx(mode, fn) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(name, mode); const req = fn(t.objectStore(name)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); }); }
    return {
      async put(r) { const copy = JSON.parse(JSON.stringify(r)); try { await tx('readwrite', (s) => s.put(copy)); } catch (e) { m.set(r.id, copy); } },
      async del(id) { try { await tx('readwrite', (s) => s.delete(id)); } catch (e) { /* ignore */ } m.delete(id); },
      async all() { let a = []; try { a = (await tx('readonly', (s) => s.getAll())) || []; } catch (e) { /* ignore */ } const ids = new Set(a.map((x) => x.id)); for (const r of m.values()) if (!ids.has(r.id)) a.push(r); return a.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))); },
      async clear() { try { await tx('readwrite', (s) => s.clear()); } catch (e) { /* ignore */ } m.clear(); }
    };
  }
  root.RCStore = { ls, runs: store('runs'), sources: store('sources') };
})(typeof self !== 'undefined' ? self : this);
