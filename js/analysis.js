/* Statistics over training history + the weakness-targeting problem picker. */
(function () {
  'use strict';
  const P = window.Problems;

  const CAP_MS = 20000;          // a problem longer than this is treated as 20s (you looked away)
  const HALF_LIFE = 25;          // per category, observation weight halves every 25 newer attempts
  const PRIOR_WEIGHT = 3;        // pseudo-observations pulling sparse categories toward their operation's mean
  const BETA = 2.5;              // how aggressively Focus mode leans into slow categories
  const EXPLORE = 0.15;          // share of Focus problems drawn uniformly across categories
  const LEAK_HALF_LIFE = 150;    // patterns are rarer than categories, so leaks look further back
  const LEAK_PRIOR = 10;         // pseudo-observations at "same speed as the rest of its type" (tuned on simulated histories)
  const LEAK_MIN_N = 5;          // a pattern needs this many answers before it's shown as a leak

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
    sessions.forEach((s, si) => s.problems.forEach((p) => probs.push(Object.assign({ si, at: s.at, drill: s.mode === 'drill' }, p))));

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
    facts.forEach((f) => { f.traits = P.traits(f.p); });

    const leaks = findLeaks(byCat, catMap, facts);

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

    return { probs, globalLog, typical: Math.exp(globalLog), ops, cats, catMap, facts, factMap, heat, leaks, leakMap: Object.fromEntries(leaks.map((l) => [l.id, l])) };
  }

  /* Leaks: patterns inside a type that are slower than the rest of that type.
   * Each answer is compared with its own type's typical time over the same window (a log ratio), so a pattern
   * spanning several types (e.g. "× numbers ending in 7") isn't skewed by which types it happens to include.
   * The average ratio is shrunk toward "no difference", so a pattern needs repeated slow answers to stand out.
   * Drill answers are left out: a drill repeats a handful of problems, which makes you briefly fast at exactly those
   * and would make the rest of the type look like leaks. Leaks are measured in game conditions (classic and focus). */
  function findLeaks(byCat, catMap, facts) {
    const agg = {};
    let noise = 0, noiseN = 0;
    for (const [cat, all] of Object.entries(byCat)) {
      const list = all.filter((p) => !p.drill);
      if (!list.length || !catMap[cat]) continue;
      const w = list.map((_, i) => Math.pow(0.5, (list.length - 1 - i) / LEAK_HALF_LIFE));
      const sw = w.reduce((s, v) => s + v, 0);
      const base = list.reduce((s, p, i) => s + w[i] * log(p.ms), 0) / sw;
      const now = Math.log(estimate(list.map((p) => p.ms), base));
      list.forEach((p, i) => {
        const r = log(p.ms) - base;
        noise += r * r; noiseN++;
        for (const id of P.traits(p)) {
          const a = agg[id] || (agg[id] = { id, n: 0, sw: 0, sr: 0, sb: 0 });
          a.n++; a.sw += w[i]; a.sr += w[i] * r; a.sb += w[i] * now;
        }
      });
    }
    // `sure` is how many standard errors the pattern sits above the rest of its type, given your answer-to-answer noise.
    const sigma2 = noiseN ? noise / noiseN : 0.1;
    const seen = Object.values(agg).filter((a) => a.n >= LEAK_MIN_N);
    const out = [];
    for (const a of seen) {
      const tp = P.traitParts(a.id);
      const shrunk = a.sr / (a.sw + LEAK_PRIOR);
      const sure = (a.sr / a.sw) / Math.sqrt(sigma2 / a.sw);
      const baseTime = Math.exp(a.sb / a.sw);           // typical time of the types this pattern falls in, now
      const time = baseTime * Math.exp(shrunk);
      const example = facts.find((f) => f.traits.includes(a.id));
      out.push({
        id: a.id, op: tp.op, cat: tp.cat, n: a.n,
        ratio: Math.exp(shrunk), sure, time, baseTime, excess: time - baseTime,
        example: example ? example.p : null, exampleTime: example ? example.recent : NaN,
      });
    }
    return out.sort((x, y) => y.excess - x.excess);
  }

  /* Leaks worth showing and training: at least 10% slower than the rest of their type, and unlikely to be luck.
   * On simulated histories, sure >= 3 was almost always a real leak, 2-3 about half the time, under 2 mostly noise. */
  const isLeak = (l) => l.ratio >= 1.1 && l.sure >= 2;
  function topLeaks(A, k = 8) {
    return A.leaks.filter(isLeak).slice(0, k);
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

    const r = Math.random();
    if (c && c.n >= 5 && r < 0.3) {
      const slow = A.facts.filter((f) => f.cat === cat && f.score > c.est && inRange(f.p, settings)).slice(0, 12);
      if (slow.length) return replay(weightedPick(slow, slow.map((f) => f.recent)));
    }

    // Lean into this type's leaks: patterns inside it that are slower than the rest of it.
    if (r >= 0.3 && r < 0.65) {
      const cand = A.leaks.filter((l) => l.op === op && (l.cat === cat || !l.cat) && isLeak(l));
      if (cand.length) {
        const l = weightedPick(cand, cand.map((l) => l.ratio - 1));
        const p = P.generateTrait(settings, l.id, cat);
        if (p) return p;
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

  const replay = (f) => ({ op: f.p.op, a: f.p.a, b: f.p.b, ans: f.p.ans });

  /* ---------- Drill targets ----------
   * A drill target is one of: a category ("mul.7"), a trait ("mul.7/o8"),
   * "leaks" (a mix of your worst leaks) or "facts" (your slowest individual problems). */
  const isTrait = (t) => t.includes('/');

  function targetLabel(t) {
    if (t === 'leaks') return 'top leaks';
    if (t === 'facts') return 'slowest problems';
    return isTrait(t) ? P.traitLabel(t) : P.categoryLabel(t);
  }

  function targetHint(t) {
    if (t === 'leaks') return 'A mix of the patterns you lose the most time on';
    if (t === 'facts') return 'Replays the individual problems you’re slowest at';
    return isTrait(t) ? P.traitHint(t) : P.categoryHint(t);
  }

  /* The category or operation a drill target draws from, for a fallback when nothing matching turns up. */
  function fallback(t, settings) {
    const scope = isTrait(t) ? P.traitParts(t).scope : t;
    return scope.includes('.') ? P.generateIn(settings, scope) : P.generate(settings, scope);
  }

  function pickTrait(id, A, settings) {
    if (Math.random() < 0.3) {
      const slow = A.facts.filter((f) => f.traits.includes(id) && inRange(f.p, settings)).slice(0, 8);
      if (slow.length) return replay(weightedPick(slow, slow.map((f) => f.score)));
    }
    return P.generateTrait(settings, id) || fallback(id, settings);
  }

  function pickTarget(t, A, settings) {
    if (t === 'facts') {
      const slow = A.facts.filter((f) => inRange(f.p, settings)).slice(0, 25);
      return slow.length ? replay(weightedPick(slow, slow.map((f) => f.score))) : P.generate(settings);
    }
    if (t === 'leaks') {
      const top = topLeaks(A);
      return top.length ? pickTrait(weightedPick(top, top.map((l) => l.excess)).id, A, settings) : P.generate(settings);
    }
    return isTrait(t) ? pickTrait(t, A, settings) : pickInCategory(t, A, settings);
  }

  /* Avoids the last few problems where it can; a small pattern (e.g. 7 × _8 has ten problems) may have to repeat one,
   * which beats drifting off the pattern. Never repeats the problem just answered. */
  function nextDrill(t, A, settings, recentKeys) {
    let repeat = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = pickTarget(t, A, settings);
      const k = P.factKey(p);
      if (!recentKeys.includes(k)) return p;
      if (k !== recentKeys[0]) repeat = repeat || p;
    }
    return repeat || (t === 'facts' || t === 'leaks' ? P.generate(settings) : fallback(t, settings));
  }

  window.Analysis = { analyze, focusPlan, nextFocus, nextDrill, topLeaks, isLeak, targetLabel, targetHint, mean, median, rolling, CAP_MS };
})();
