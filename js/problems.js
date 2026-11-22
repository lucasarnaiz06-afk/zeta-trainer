/* Problem generation and categories. Defaults match Zetamac's standard game. */
(function () {
  'use strict';

  const OPS = ['add', 'sub', 'mul', 'div'];
  const SYMBOL = { add: '+', sub: '−', mul: '×', div: '÷' };
  const OP_NAME = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };

  // Zetamac defaults: (2–100)+(2–100), subtraction = addition reversed,
  // (2–12)×(2–100), division = multiplication reversed, 120 seconds.
  const DEFAULTS = {
    duration: 120,
    ops: { add: true, sub: true, mul: true, div: true },
    addA: [2, 100], addB: [2, 100],
    mulA: [2, 12], mulB: [2, 100],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function isStandard(s) {
    const d = DEFAULTS;
    return OPS.every((o) => !!s.ops[o]) &&
      ['addA', 'addB', 'mulA', 'mulB'].every((k) => s[k][0] === d[k][0] && s[k][1] === d[k][1]);
  }

  function enabledOps(s) {
    const ops = OPS.filter((o) => s.ops[o]);
    return ops.length ? ops : OPS.slice();
  }

  /* A problem is { op, a, b, ans } where "a op b = ans" is what is displayed. */
  function make(op, x, y) {
    switch (op) {
      case 'add': return { op, a: x, b: y, ans: x + y };
      case 'sub': return { op, a: x + y, b: x, ans: y };      // (x+y) − x = y
      case 'mul': return { op, a: x, b: y, ans: x * y };      // small × big
      case 'div': return { op, a: x * y, b: x, ans: y };      // (x·y) ÷ x = y
    }
  }

  /* The underlying operand pair (x, y) a problem was generated from. */
  function operands(p) {
    switch (p.op) {
      case 'add': return [p.a, p.b];
      case 'sub': return [p.b, p.ans];
      case 'mul': return [p.a, p.b];
      case 'div': return [p.b, p.ans];
    }
  }

  function generate(s, op) {
    op = op || pick(enabledOps(s));
    if (op === 'add' || op === 'sub') return make(op, randInt(...s.addA), randInt(...s.addB));
    return make(op, randInt(...s.mulA), randInt(...s.mulB));
  }

  /* ---------- categories ---------- */

  function category(p) {
    const [x, y] = operands(p);
    if (p.op === 'add' || p.op === 'sub') {
      const big = (x + y) >= 100;
      const carry = p.op === 'add' ? (x % 10) + (y % 10) >= 10 : ((x + y) % 10) < (x % 10);
      const word = p.op === 'add' ? 'carry' : 'borrow';
      return `${p.op}.${carry ? word : 'plain'}${big ? '100' : ''}`;
    }
    return `${p.op}.${x}`;
  }

  const ADDSUB_KINDS = {
    add: ['plain', 'carry', 'plain100', 'carry100'],
    sub: ['plain', 'borrow', 'plain100', 'borrow100'],
  };

  function categoryLabel(cat) {
    const [op, k] = cat.split('.');
    if (op === 'mul') return `× ${k}`;
    if (op === 'div') return `÷ ${k}`;
    const labels = {
      'add.plain': '+ no carry', 'add.carry': '+ with carry',
      'add.plain100': '+ past 100', 'add.carry100': '+ carry past 100',
      'sub.plain': '− no borrow', 'sub.borrow': '− with borrow',
      'sub.plain100': '− from 100+', 'sub.borrow100': '− borrow from 100+',
    };
    return labels[cat] || cat;
  }

  function categoryHint(cat) {
    const [op, k] = cat.split('.');
    if (op === 'mul') return `Multiplying by ${k}`;
    if (op === 'div') return `Dividing by ${k}`;
    return {
      'add.plain': 'Sums under 100, ones digits don’t carry',
      'add.carry': 'Sums under 100 where the ones digits carry',
      'add.plain100': 'Sums of 100 or more without a ones carry',
      'add.carry100': 'Sums of 100 or more with a ones carry',
      'sub.plain': 'Starting under 100, no borrowing',
      'sub.borrow': 'Starting under 100, ones digit needs a borrow',
      'sub.plain100': 'Starting at 100 or more, no ones borrow',
      'sub.borrow100': 'Starting at 100 or more with a ones borrow',
    }[cat] || '';
  }

  /* Which +/− categories can actually occur under the current ranges (e.g. none reach 100 for 2–5 + 2–5). */
  const reachCache = {};
  function reachable(s, op) {
    const key = `${op}|${s.addA}|${s.addB}`;
    if (reachCache[key]) return reachCache[key];
    const found = new Set();
    const [a0, a1] = s.addA, [b0, b1] = s.addB;
    const add = (x, y) => found.add(category(make(op, x, y)));
    if ((a1 - a0 + 1) * (b1 - b0 + 1) <= 40000) {
      for (let x = a0; x <= a1; x++) for (let y = b0; y <= b1; y++) add(x, y);
    } else {
      for (let i = 0; i < 6000; i++) add(randInt(a0, a1), randInt(b0, b1));
    }
    return (reachCache[key] = found);
  }

  function categoriesFor(s) {
    const out = [];
    for (const op of enabledOps(s)) {
      if (op === 'add' || op === 'sub') {
        const ok = reachable(s, op);
        ADDSUB_KINDS[op].forEach((k) => { if (ok.has(`${op}.${k}`)) out.push(`${op}.${k}`); });
      }
      else for (let n = s.mulA[0]; n <= s.mulA[1]; n++) out.push(`${op}.${n}`);
    }
    return out;
  }

  /* Column bucket for the large operand in × / ÷ heatmaps. */
  const BUCKETS = ['2–9', '10s', '20s', '30s', '40s', '50s', '60s', '70s', '80s', '90+'];
  function bucketOf(y) { return Math.max(0, Math.min(9, Math.floor(y / 10))); }
  function bucketRange(i, s) {
    const lo = Math.max(s.mulB[0], i === 0 ? 0 : i * 10);
    const hi = Math.min(s.mulB[1], i === 9 ? Infinity : i * 10 + 9);
    return lo <= hi ? [lo, hi] : null;
  }

  /* Generate a problem in a given category, optionally with the big operand in a bucket. */
  function generateIn(s, cat, bucket) {
    const [op, k] = cat.split('.');
    if (op === 'mul' || op === 'div') {
      const x = +k;
      const r = bucket != null ? bucketRange(bucket, s) : null;
      const y = r ? randInt(r[0], r[1]) : randInt(...s.mulB);
      return make(op, x, y);
    }
    for (let i = 0; i < 400; i++) {
      const p = generate(s, op);
      if (category(p) === cat) return p;
    }
    return generate(s, op);
  }

  function factKey(p) { return `${p.op}|${p.a}|${p.b}`; }
  function format(p) { return `${p.a} ${SYMBOL[p.op]} ${p.b}`; }

  window.Problems = {
    OPS, SYMBOL, OP_NAME, DEFAULTS, BUCKETS,
    clone, randInt, isStandard, enabledOps, make, operands, generate, generateIn,
    category, categoryLabel, categoryHint, categoriesFor, bucketOf, factKey, format,
  };
})();
