/* Statistics over training history + the weakness-targeting problem picker. */
(function () {
  'use strict';
  const P = window.Problems;

  const CAP_MS = 20000;          // a problem longer than this is treated as 20s (you looked away)
  const HALF_LIFE = 25;          // per category, observation weight halves every 25 newer attempts
  const PRIOR_WEIGHT = 3;        // pseudo-observations pulling sparse categories toward their operation's mean
  const BETA = 2.5;              // how aggressively Focus mode leans into slow categories
  const EXPLORE = 0.15;          // share of Focus problems drawn uniformly across categories

  const log = (ms) => Math.log(Math.max(150, Math.min(CAP_MS, ms)));
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  function median(a) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function rolling(vals, w) {
    return vals.map((_, i) => mean(vals.slice(Math.max(0, i - w + 1), i + 1)));
  }
  function weightedPick(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  /* Recency-weighted geometric mean of times, shrunk toward a prior (in log space). */
  function estimate(times, priorLog) {
    let sw = PRIOR_WEIGHT, sx = PRIOR_WEIGHT * priorLog;
    for (let i = times.length - 1, k = 0; i >= 0; i--, k++) {
      const w = Math.pow(0.5, k / HALF_LIFE);
      sw += w; sx += w * log(times[i]);
    }
    return Math.exp(sx / sw);
  }

  /* Full analysis of all recorded problems. */
  function analyze(sessions, settings) {
    const probs = [];
    sessions.forEach((s, si) => s.problems.forEach((p) => probs.push(Object.assign({ si, at: s.at }, p))));

    const globalLog = probs.length ? mean(probs.map((p) => log(p.ms))) : Math.log(3000);

    const ops = {};
    for (const op of P.OPS) {
      const t = probs.filter((p) => p.op === op).map((p) => p.ms);
      ops[op] = { n: t.length, median: median(t), logMean: t.length ? mean(t.map(log)) : null };
    }

    // Categories: every category reachable under current settings plus any seen in history.
    const byCat = {};
    for (const c of P.categoriesFor(settings)) byCat[c] = [];
    for (const p of probs) (byCat[p.cat] = byCat[p.cat] || []).push(p);

    const cats = Object.entries(byCat).map(([cat, list]) => {
      const op = cat.split('.')[0];
      const prior = ops[op].logMean != null ? ops[op].logMean : globalLog + Math.log(1.15);
      const times = list.map((p) => p.ms);
      const chunks = [];
      for (let i = 0; i + 10 <= times.length; i += 10) chunks.push(median(times.slice(i, i + 10)));
      return {
        cat, op, n: times.length,
        est: estimate(times, prior),
        median: median(times),
        recent: median(times.slice(-20)),
        early: times.length >= 30 ? median(times.slice(0, 20)) : NaN,
        chunks,
        corrections: mean(list.map((p) => p.corrections || 0)),
      };
    });
    const catMap = Object.fromEntries(cats.map((c) => [c.cat, c]));

    const factMap = {};
    for (const p of probs) {
      const k = P.factKey(p);
      (factMap[k] = factMap[k] || { p, times: [] }).times.push(p.ms);
    }
    // Individual problems, ranked by their last few attempts shrunk toward the category's typical time, so one slow fluke
    // doesn't outrank a problem that's been slow repeatedly.
    const facts = Object.values(factMap).map((f) => {
      const recentTimes = f.times.slice(-3).map((t) => Math.min(CAP_MS, t));
      const catEst = catMap[f.p.cat] ? catMap[f.p.cat].est : Math.exp(globalLog);
      return {
        p: f.p, cat: f.p.cat, n: f.times.length,
        recent: mean(recentTimes), last: f.times[f.times.length - 1],
        score: (recentTimes.reduce((s, t) => s + t, 0) + catEst) / (recentTimes.length + 1),
      };
    });
    facts.sort((x, y) => y.score - x.score);

    // × and ÷ heatmaps: small factor × bucket of the large operand.
    const heat = {};
    for (const op of ['mul', 'div']) {
      const cells = {};
      for (const p of probs) {
        if (p.op !== op) continue;
        const [x, y] = P.operands(p);
        const k = `${x}|${P.bucketOf(y)}`;
        (cells[k] = cells[k] || []).push(p.ms);
      }
      heat[op] = cells;
    }

    return { probs, globalLog, typical: Math.exp(globalLog), ops, cats, catMap, facts, factMap, heat };
  }

  /* ---------- Focus mode ---------- */

  function focusPlan(A, settings) {
    const cats = P.categoriesFor(settings);
    const raw = cats.map((c) => {
      const s = A.catMap[c];
      const est = s ? s.est : A.typical * 1.15;
      return Math.exp(BETA * (Math.log(est) - A.globalLog));
    });
    const total = raw.reduce((s, w) => s + w, 0);
    const probs = raw.map((w) => (1 - EXPLORE) * (w / total) + EXPLORE / cats.length);
    const ranked = cats.map((c, i) => ({ cat: c, p: probs[i] })).sort((x, y) => y.p - x.p);
    return { cats, probs, top: ranked.slice(0, 5) };
  }

  function nextFocus(plan, A, settings, recentKeys) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cat = weightedPick(plan.cats, plan.probs);
      const p = pickInCategory(cat, A, settings);
      if (!recentKeys.includes(P.factKey(p))) return p;
    }
    return P.generate(settings);
  }

  /* Within a category: sometimes replay a specific slow fact, otherwise lean toward slow sub-areas. */
  function pickInCategory(cat, A, settings) {
    const c = A.catMap[cat];
    const [op, k] = cat.split('.');

    if (c && c.n >= 5 && Math.random() < 0.3) {
      const slow = A.facts.filter((f) => f.cat === cat && f.score > c.est && inRange(f.p, settings)).slice(0, 12);
      if (slow.length) {
        const f = weightedPick(slow, slow.map((f) => f.recent));
        return { op: f.p.op, a: f.p.a, b: f.p.b, ans: f.p.ans };
      }
    }

    if (op === 'mul' || op === 'div') {
      const cells = A.heat[op];
      const buckets = [], weights = [];
      const catEst = c ? c.est : A.typical;
      for (let b = 0; b < 10; b++) {
        const lo = Math.max(settings.mulB[0], b === 0 ? 0 : b * 10);
        const hi = Math.min(settings.mulB[1], b === 9 ? Infinity : b * 10 + 9);
        if (lo > hi) continue;
        const t = cells[`${k}|${b}`];
        const est = t && t.length ? estimate(t, Math.log(catEst)) : catEst * 1.1;
        buckets.push(b);
        weights.push((hi - lo + 1) * Math.exp(BETA * (Math.log(est) - Math.log(catEst))));
      }
      return P.generateIn(settings, cat, buckets.length ? weightedPick(buckets, weights) : null);
    }
    return P.generateIn(settings, cat);
  }

  function inRange(p, s) {
    const [x, y] = P.operands(p);
    const [ra, rb] = p.op === 'add' || p.op === 'sub' ? [s.addA, s.addB] : [s.mulA, s.mulB];
    return x >= ra[0] && x <= ra[1] && y >= rb[0] && y <= rb[1];
  }

  /* Drill a single category (picked from the Analysis view). */
  function nextDrill(cat, A, settings, recentKeys) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = pickInCategory(cat, A, settings);
      if (!recentKeys.includes(P.factKey(p))) return p;
    }
    return P.generateIn(settings, cat);
  }

  window.Analysis = { analyze, focusPlan, nextFocus, nextDrill, mean, median, rolling, CAP_MS };
})();
