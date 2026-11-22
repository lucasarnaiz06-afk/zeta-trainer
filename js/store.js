/* Persistence in localStorage. Problems are stored compactly: [opIndex, a, b, ms, corrections]. */
(function () {
  'use strict';
  const P = window.Problems;
  const KEY = 'zetatrainer.v1';

  let db = null;

  function blank() { return { version: 1, settings: P.clone(P.DEFAULTS), sessions: [] }; }

  function load() {
    if (db) return db;
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : blank();
    } catch (e) { db = blank(); }
    db.settings = Object.assign(P.clone(P.DEFAULTS), db.settings || {});
    db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
    return db;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { console.error('Could not save', e); return false; }
  }

  function pack(p) { return [P.OPS.indexOf(p.op), p.a, p.b, Math.round(p.ms), p.corrections || 0]; }
  function unpack(r) {
    const op = P.OPS[r[0]];
    const ans = op === 'add' ? r[1] + r[2] : op === 'sub' ? r[1] - r[2] : op === 'mul' ? r[1] * r[2] : r[1] / r[2];
    const p = { op, a: r[1], b: r[2], ans, ms: r[3], corrections: r[4] || 0 };
    p.cat = P.category(p);
    return p;
  }

  const MODES = ['classic', 'focus', 'drill'];
  const isInt = (v) => Number.isInteger(v) && v >= 0;
  function validRow(r) {
    if (!Array.isArray(r) || !isInt(r[0]) || r[0] > 3 || !isInt(r[1]) || !isInt(r[2]) || !Number.isFinite(r[3]) || r[3] < 0) return false;
    if (r[0] === 1 && r[1] - r[2] < 0) return false;                       // subtraction answer must be ≥ 0
    if (r[0] === 3 && (r[2] === 0 || r[1] % r[2] !== 0)) return false;     // division must be exact
    return true;
  }
  function validSession(s) {
    return !!s && typeof s.id === 'string' && Number.isFinite(s.at) && Number.isFinite(s.duration) &&
      MODES.includes(s.mode) && Array.isArray(s.p) && s.p.every(validRow) &&
      (s.mode !== 'drill' || typeof s.target === 'string');
  }

  /* Expanded sessions, oldest first. Cached until the next write. */
  let cache = null;
  function sessions() {
    if (cache) return cache;
    cache = load().sessions
      .filter(validSession)
      .map((s) => Object.assign({}, s, { problems: s.p.map(unpack) }))
      .sort((x, y) => x.at - y.at);
    return cache;
  }

  function addSession(s) {
    load().sessions.push({
      id: s.id, at: s.at, mode: s.mode, target: s.target || null,
      duration: s.duration, standard: !!s.standard, score: s.problems.length,
      p: s.problems.map(pack),
    });
    cache = null;
    return persist();
  }

  function settings() { return load().settings; }
  function saveSettings(s) { load().settings = s; persist(); }

  function exportJSON() { return JSON.stringify(load(), null, 0); }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.sessions)) throw new Error('Not a trainer export file');
    const have = new Set(load().sessions.map((s) => s.id));
    let added = 0, skipped = 0;
    for (const s of data.sessions) {
      if (!validSession(s)) { skipped++; continue; }
      if (have.has(s.id)) continue;
      s.score = s.p.length;
      db.sessions.push(s); have.add(s.id); added++;
    }
    if (!added && skipped) throw new Error(`no valid games found (${skipped} malformed)`);
    cache = null;
    persist();
    return added;
  }

  function eraseAll() {
    const keep = load().settings;
    db = blank(); db.settings = keep;
    cache = null; persist();
  }

  window.Store = { sessions, addSession, settings, saveSettings, exportJSON, importJSON, eraseAll };
})();
