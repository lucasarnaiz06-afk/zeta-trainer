/* Charts: small dependency-free SVG charting module. Exposes window.Charts. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var M = { top: 10, right: 12, bottom: 22, left: 40 };

  // ---------- helpers ----------
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function f2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function defFmt(v) {
    return String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
  }
  function widthOf(c) { return Math.max(c.clientWidth || 0, 0) || 600; }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceTicks(lo, hi, count) {
    if (hi - lo <= 0) { hi = lo + 1; }
    var step = niceStep((hi - lo) / Math.max(count, 1));
    var a = Math.floor(lo / step + 1e-9) * step;
    var b = Math.ceil(hi / step - 1e-9) * step;
    var ticks = [];
    for (var t = a, i = 0; t <= b + step / 2 && i < 50; t += step, i++) ticks.push(f2(t));
    return { ticks: ticks, lo: a, hi: b };
  }
  function linTicks(lo, hi, count) {
    if (count < 2) return [(lo + hi) / 2];
    var out = [];
    for (var i = 0; i < count; i++) out.push(lo + ((hi - lo) * i) / (count - 1));
    return out;
  }

  var uid = 0;

  // Per-container render registry: one ResizeObserver per element, re-render on width change.
  function mount(container, renderFn) {
    var st = container.__charts;
    if (!st) {
      st = container.__charts = { w: 0, ro: null };
      if (typeof ResizeObserver !== 'undefined') {
        st.ro = new ResizeObserver(function () {
          var w = widthOf(container);
          if (w !== st.w && st.render) { st.render(); }
        });
        st.ro.observe(container);
      }
    }
    st.render = function () {
      st.w = widthOf(container);
      container.innerHTML = '';
      renderFn(st.w);
    };
    st.render();
  }

  function ensureRelative(c) {
    try {
      if (window.getComputedStyle(c).position === 'static') c.style.position = 'relative';
    } catch (e) { c.style.position = 'relative'; }
  }

  function svgRoot(w, h) {
    var svg = el('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    return svg;
  }

  function text(parent, x, y, str, anchor, extra) {
    var t = el('text', {
      x: x, y: y, 'text-anchor': anchor || 'start', fill: 'var(--muted)',
      'font-size': 11, style: 'font-variant-numeric: tabular-nums; font-family: inherit;'
    }, parent);
    if (extra) for (var k in extra) t.setAttribute(k, extra[k]);
    t.textContent = str;
    return t;
  }

  function empty(container, h) {
    var d = document.createElement('div');
    d.style.cssText = 'height:' + h + 'px;display:flex;align-items:center;justify-content:center;' +
      'color:var(--muted);font-size:13px;';
    d.textContent = 'No data yet';
    container.appendChild(d);
  }

  // ---------- line chart ----------
  function line(container, opts) {
    opts = opts || {};
    var H = opts.height || 220;
    var series = (opts.series || []).map(function (s) {
      var pts = (s.points || []).filter(function (p) { return p && num(p.x) && num(p.y); })
        .slice().sort(function (a, b) { return a.x - b.x; });
      return { s: s, pts: pts };
    });
    ensureRelative(container);

    mount(container, function (W) {
      var all = [];
      series.forEach(function (r) { all = all.concat(r.pts); });
      if (!all.length) { empty(container, H); return; }

      var xFmt = opts.xFormat || defFmt, yFmt = opts.yFormat || defFmt;
      var xs = all.map(function (p) { return p.x; }), ys = all.map(function (p) { return p.y; });
      var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
      var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
      if (opts.yZero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
      if (ymax === ymin) { var pad = Math.abs(ymax) * 0.1 || 1; ymin -= pad; ymax += pad; }
      var nt = niceTicks(ymin, ymax, opts.yTickCount || 4);
      ymin = nt.lo; ymax = nt.hi;

      // measure left margin from y labels (approx 6.5px per char)
      var ml = M.left;
      var maxLen = 0;
      nt.ticks.forEach(function (t) { maxLen = Math.max(maxLen, String(yFmt(t)).length); });
      ml = Math.max(28, Math.ceil(maxLen * 6.5) + 10);

      var iw = Math.max(W - ml - M.right, 10), ih = H - M.top - M.bottom;
      var single = xmax === xmin;
      function X(x) { return ml + (single ? iw / 2 : ((x - xmin) / (xmax - xmin)) * iw); }
      function Y(y) {
        var t = (y - ymin) / (ymax - ymin);
        if (opts.invertY) t = 1 - t;
        return M.top + (1 - t) * ih;
      }

      var svg = svgRoot(W, H);
      var defs = el('defs', null, svg);
      var gGrid = el('g', null, svg);

      // y grid + labels
      nt.ticks.forEach(function (t) {
        var y = f2(Y(t));
        el('line', { x1: ml, x2: ml + iw, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 1 }, gGrid);
        text(gGrid, ml - 8, y + 4, yFmt(t), 'end');
      });
      // x labels
      var xc = single ? 1 : Math.max(2, opts.xTickCount || 5);
      linTicks(xmin, xmax, xc).forEach(function (t, i, arr) {
        var anchor = arr.length > 1 ? (i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle') : 'middle';
        text(gGrid, f2(X(t)), H - 6, xFmt(t), anchor);
      });

      // series
      series.forEach(function (r) {
        var s = r.s, pts = r.pts;
        if (!pts.length) return;
        var color = s.color || 'var(--accent)';
        var g = el('g', null, svg);
        if (pts.length >= 2) {
          var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + f2(X(p.x)) + ',' + f2(Y(p.y)); }).join('');
          if (s.area) {
            var id = 'chg' + (++uid);
            var lg = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
            el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.22 }, lg);
            el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }, lg);
            var base = M.top + ih;
            el('path', {
              d: d + 'L' + f2(X(pts[pts.length - 1].x)) + ',' + base + 'L' + f2(X(pts[0].x)) + ',' + base + 'Z',
              fill: 'url(#' + id + ')', stroke: 'none'
            }, g);
          }
          el('path', {
            d: d, fill: 'none', stroke: color, 'stroke-width': s.width || 1.75,
            'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            'stroke-dasharray': s.dashed ? '4 4' : null
          }, g);
        }
        if (s.dots || pts.length < 2) {
          pts.forEach(function (p) {
            el('circle', { cx: f2(X(p.x)), cy: f2(Y(p.y)), r: pts.length < 2 ? 3.5 : 2.75, fill: color }, g);
          });
        }
      });

      // hover layer
      var hair = el('line', {
        y1: M.top, y2: M.top + ih, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-opacity': 0.6,
        visibility: 'hidden', 'pointer-events': 'none'
      }, svg);
      var marks = el('g', { 'pointer-events': 'none' }, svg);
      var overlay = el('rect', { x: ml, y: M.top, width: iw, height: ih, fill: 'transparent' }, svg);
      overlay.style.touchAction = 'pan-y';

      var tip = document.createElement('div');
      tip.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;display:none;z-index:5;' +
        'background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 9px;' +
        'font-size:12px;line-height:1.5;color:var(--fg);white-space:nowrap;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.12);font-variant-numeric:tabular-nums;';

      var xvals = Array.from(new Set(xs)).sort(function (a, b) { return a - b; });
      function show(ev) {
        var rect = svg.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var best = xvals[0], bd = Infinity;
        xvals.forEach(function (x) { var dd = Math.abs(X(x) - mx); if (dd < bd) { bd = dd; best = x; } });
        var px = f2(X(best));
        hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.setAttribute('visibility', 'visible');
        marks.innerHTML = '';
        var rows = '';
        series.forEach(function (r) {
          var p = r.pts.filter(function (q) { return q.x === best; })[0];
          if (!p) return;
          var color = r.s.color || 'var(--accent)';
          el('circle', { cx: px, cy: f2(Y(p.y)), r: 3.5, fill: color, stroke: 'var(--surface)', 'stroke-width': 1.5 }, marks);
          rows += '<div style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;' +
            'border-radius:50%;flex:none;background:' + color + '"></span><span style="color:var(--muted)">' +
            esc(r.s.name || '') + '</span><span style="margin-left:auto;padding-left:10px">' +
            esc(yFmt(p.y)) + '</span></div>';
        });
        tip.innerHTML = '<div style="color:var(--muted);margin-bottom:2px">' + esc(xFmt(best)) + '</div>' + rows;
        tip.style.display = 'block';
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        var left = px + 12;
        if (left + tw > W) left = px - 12 - tw;
        left = clamp(left, 0, Math.max(0, W - tw));
        tip.style.left = f2(left) + 'px';
        tip.style.top = f2(clamp(M.top + 4, 0, Math.max(0, H - th))) + 'px';
      }
      function hide() {
        hair.setAttribute('visibility', 'hidden'); marks.innerHTML = ''; tip.style.display = 'none';
      }
      overlay.addEventListener('pointermove', show);
      overlay.addEventListener('pointerdown', show);
      overlay.addEventListener('pointerleave', hide);
      overlay.addEventListener('pointercancel', hide);

      container.appendChild(svg);
      container.appendChild(tip);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- heatmap ----------
  function heatmap(container, opts) {
    opts = opts || {};
    var rows = opts.rows || [], cols = opts.cols || [];
    var cellFn = opts.cell || function () { return { v: null }; };
    var fmt = opts.format || defFmt;
    var CH = 26, GAP = 2, HEAD = 22;
    var data = rows.map(function (_, ri) {
      return cols.map(function (_, ci) { return cellFn(ri, ci) || { v: null }; });
    });

    mount(container, function (W) {
      var vals = [];
      data.forEach(function (r) { r.forEach(function (c) { if (num(c.v)) vals.push(c.v); }); });
      var lo = vals.length ? Math.min.apply(null, vals) : 0, hi = vals.length ? Math.max.apply(null, vals) : 1;
      if (opts.domain && num(opts.domain[0]) && num(opts.domain[1])) { lo = opts.domain[0]; hi = opts.domain[1]; }
      if (hi === lo) { lo -= 1; hi += 1; }

      var maxLab = 0;
      rows.forEach(function (r) { maxLab = Math.max(maxLab, String(r).length); });
      var LW = Math.max(20, Math.ceil(maxLab * 6.5) + 10);
      var nc = Math.max(cols.length, 1);
      var cw = Math.max((W - LW - GAP * (nc - 1)) / nc, 4);
      var H = HEAD + rows.length * (CH + GAP);
      var svg = svgRoot(W, H);

      cols.forEach(function (c, ci) {
        text(svg, f2(LW + ci * (cw + GAP) + cw / 2), 12, c, 'middle');
      });
      rows.forEach(function (r, ri) {
        var y = HEAD + ri * (CH + GAP);
        text(svg, LW - 8, f2(y + CH / 2 + 4), r, 'end');
        cols.forEach(function (_, ci) {
          var c = data[ri][ci], x = LW + ci * (cw + GAP);
          var g = el('g', null, svg);
          var has = num(c.v);
          var p = has ? clamp(((c.v - lo) / (hi - lo)) * 100, 0, 100) : 0;
          var rect = el('rect', {
            x: f2(x), y: y, width: f2(cw), height: CH, rx: 3, ry: 3,
            fill: has ? 'color-mix(in oklab, var(--heat-lo), var(--heat-hi) ' + f2(p) + '%)' : 'var(--line)',
            'fill-opacity': has ? 1 : 0.35
          }, g);
          if (c.title) el('title', null, g).textContent = c.title;
          if (has) {
            var t = el('text', {
              x: f2(x + cw / 2), y: f2(y + CH / 2 + 3.5), 'text-anchor': 'middle', fill: 'var(--fg)',
              'font-size': 10.5, 'pointer-events': 'none',
              style: 'font-variant-numeric: tabular-nums; font-family: inherit;'
            }, g);
            t.textContent = fmt(c.v);
          }
        });
      });
      container.appendChild(svg);
    });
  }

  // ---------- sparkline ----------
  function spark(container, values, opts) {
    opts = opts || {};
    var H = opts.height || 28, color = opts.color || 'var(--accent)';
    var vs = (values || []).filter(num);

    mount(container, function (W) {
      if (!vs.length) return;
      var pad = 3, lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      if (hi === lo) { lo -= 1; hi += 1; }
      var iw = W - pad * 2, ih = H - pad * 2;
      function X(i) { return pad + (vs.length < 2 ? iw / 2 : (i / (vs.length - 1)) * iw); }
      function Y(v) {
        var t = (v - lo) / (hi - lo);
        if (opts.invertY) t = 1 - t;
        return pad + (1 - t) * ih;
      }
      var svg = svgRoot(W, H);
      if (vs.length > 1) {
        el('path', {
          d: vs.map(function (v, i) { return (i ? 'L' : 'M') + f2(X(i)) + ',' + f2(Y(v)); }).join(''),
          fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }, svg);
      }
      var last = vs.length - 1;
      el('circle', { cx: f2(X(last)), cy: f2(Y(vs[last])), r: 2.5, fill: color }, svg);
      container.appendChild(svg);
    });
  }

  window.Charts = { line: line, heatmap: heatmap, spark: spark };
})();
