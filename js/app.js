/* UI: routing, game loop, results, analysis, progress, settings. */
(function () {
  'use strict';
  const P = window.Problems, S = window.Store, A = window.Analysis, C = window.Charts;
  const $ = (id) => document.getElementById(id);

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sec = (ms, d = 2) => (Number.isFinite(ms) ? (ms / 1000).toFixed(d) + 's' : '—');
  const pct = (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%';
  const round1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '—');
  const dateFmt = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dateTimeFmt = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const solved = (p) => `${P.format(p)} = ${p.ans}`;
  const modeName = (s) => (s.mode === 'classic' ? 'Classic' : s.mode === 'focus' ? 'Focus' : `Drill ${P.categoryLabel(s.target)}`);

  function official(settings) {
    return S.sessions().filter((s) => s.mode === 'classic' && s.standard && s.duration === settings.duration);
  }
  function spark(container, vals, opts) { if (C && vals.length) C.spark(container, vals, opts || {}); }

  /* ---------- state & routing ---------- */
  const state = { mode: 'classic', drill: null, lastResultAt: 0 };
  let game = null;

  function show(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${view}`));
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === view && a.tagName === 'A' && !a.classList.contains('mark')));
    document.body.classList.toggle('playing', view === 'game');
    state.view = view;
  }

  function route() {
    if (game) return;
    const v = (location.hash || '#play').slice(1);
    const views = { play: renderHome, analysis: renderAnalysis, progress: renderProgress, settings: renderSettings };
    show(views[v] ? v : 'play');      // show first so charts can measure their containers
    (views[v] || renderHome)();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  function go(view) {
    if (location.hash === `#${view}`) route(); else location.hash = view;
  }

  /* ---------- home ---------- */
  function renderHome() {
    const s = S.settings();
    const sessions = S.sessions();
    const nAnswers = sessions.reduce((t, x) => t + x.problems.length, 0);
    const ops = P.enabledOps(s).map((o) => P.OP_NAME[o].toLowerCase());
    const opsText = ops.length === 4 ? 'all four operations' : ops.join(', ');

    $('drill-btn').hidden = !state.drill;
    if (state.drill) $('drill-btn').textContent = `Drill ${P.categoryLabel(state.drill)}`;
    if (state.mode === 'drill' && !state.drill) state.mode = 'classic';
    document.querySelectorAll('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));

    const desc = $('mode-desc'), targets = $('focus-targets');
    targets.innerHTML = '';
    if (state.mode === 'classic') {
      desc.textContent = P.isStandard(s)
        ? `Standard Zetamac rules: ${opsText}, ${s.duration} seconds. Counts toward your score history.`
        : `Custom ranges: ${opsText}, ${s.duration} seconds. Recorded, but not counted as an official score.`;
    } else if (state.mode === 'focus') {
      const an = A.analyze(sessions, s);
      const plan = A.focusPlan(an, s);
      desc.textContent = nAnswers < 60
        ? `${s.duration} seconds, weighted toward the problem types you're slowest at. Only ${nAnswers} answers recorded so far, so play a few classic games first to give it something to go on.`
        : `${s.duration} seconds, weighted toward the problem types that take you longest (based on ${nAnswers.toLocaleString()} answers). Right now that's:`;
      if (nAnswers >= 60) {
        targets.innerHTML = plan.top.map((t) => `<span class="chip">${esc(P.categoryLabel(t.cat))} · ${Math.round(t.p * 100)}%</span>`).join('');
      }
    } else {
      const hint = P.categoryHint(state.drill);
      desc.textContent = `${s.duration} seconds of only ${P.categoryLabel(state.drill)} problems${state.drill.startsWith('add') || state.drill.startsWith('sub') ? ` (${hint.charAt(0).toLowerCase() + hint.slice(1)})` : ''}, with extra reps on the ones you're slowest at. Doesn't count as an official score.`;
      targets.innerHTML = `<span class="chip">${esc(P.categoryLabel(state.drill))}</span>`;
    }

    const off = official(s);
    const box = $('home-stats');
    if (!off.length) { box.innerHTML = ''; return; }
    const scores = off.map((x) => x.score);
    const last10 = scores.slice(-10);
    box.innerHTML = `
      <div class="stat"><div class="v">${Math.max(...scores)}</div><div class="l">Best</div></div>
      <div class="stat"><div class="v">${round1(A.mean(last10))}</div><div class="l">Last ${last10.length} average</div></div>
      <div class="stat"><div class="v">${off.length}</div><div class="l">Official games</div><div class="spark" id="home-spark"></div></div>`;
    spark($('home-spark'), scores.slice(-30), { color: 'var(--accent)', height: 24 });
  }

  $('mode-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.mode;
    renderHome();
  });
  $('start').addEventListener('click', () => startGame());

  /* ---------- game ---------- */
  const input = $('g-in');

  function startGame() {
    const settings = P.clone(S.settings());
    const mode = state.mode;
    const an = mode === 'classic' ? null : A.analyze(S.sessions(), settings);
    game = {
      settings, mode, target: mode === 'drill' ? state.drill : null,
      duration: settings.duration, at: Date.now(), t0: performance.now(),
      an, plan: mode === 'focus' ? A.focusPlan(an, settings) : null,
      problems: [], recent: [], cur: null,
    };
    $('g-mode').textContent = mode === 'classic' ? '' : mode === 'focus' ? 'Focus' : `Drill ${P.categoryLabel(game.target)}`;
    $('g-score').textContent = '0';
    show('game');
    nextProblem();
    input.focus();
    game.timer = setInterval(tick, 50);   // wall-clock based, so it still ends if the tab is backgrounded
    tick();
  }

  function generate() {
    const g = game;
    if (g.mode === 'focus') return A.nextFocus(g.plan, g.an, g.settings, g.recent);
    if (g.mode === 'drill') return A.nextDrill(g.target, g.an, g.settings, g.recent);
    return P.generate(g.settings);
  }

  function nextProblem() {
    const p = generate();
    game.cur = Object.assign(p, { shown: performance.now(), corrections: 0, prevLen: 0 });
    game.recent = [P.factKey(p)].concat(game.recent).slice(0, 6);
    input.value = '';
    $('g-q').textContent = P.format(p);
    const box = $('g-q').parentElement;
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  }

  input.addEventListener('input', () => {
    if (!game) return;
    const clean = input.value.replace(/[^0-9]/g, '');
    if (clean !== input.value) input.value = clean;
    const p = game.cur;
    if (clean.length < p.prevLen) p.corrections++;
    p.prevLen = clean.length;
    if (clean === String(p.ans)) {
      game.problems.push({ op: p.op, a: p.a, b: p.b, ans: p.ans, ms: performance.now() - p.shown, corrections: p.corrections });
      $('g-score').textContent = game.problems.length;
      nextProblem();
    }
  });
  input.addEventListener('blur', () => { if (game) setTimeout(() => game && input.focus(), 0); });

  function tick() {
    if (!game) return;
    const elapsed = (performance.now() - game.t0) / 1000;
    const left = Math.max(0, game.duration - elapsed);
    $('g-time').textContent = clock(Math.ceil(left));
    $('g-bar').style.transform = `scaleX(${left / game.duration})`;
    if (left <= 0) { clearInterval(game.timer); return endGame(); }
  }

  function endGame() {
    const g = game;
    game = null;
    input.blur();
    const before = S.sessions().slice();
    const session = {
      id: g.at.toString(36) + Math.random().toString(36).slice(2, 7),
      at: g.at, mode: g.mode, target: g.target, duration: g.duration,
      standard: g.mode === 'classic' && P.isStandard(g.settings),
      problems: g.problems,
    };
    let saved = true;
    if (g.problems.length) saved = S.addSession(session);
    renderResults(session, before, g, saved);
    state.lastResultAt = Date.now();
    show('results');
  }

  function quitGame() {
    clearInterval(game.timer);
    game = null;
    input.blur();
    route();
  }

  /* ---------- results ---------- */
  function renderResults(s, before, g, saved) {
    const score = s.problems.length;
    const per = score ? (s.duration * 1000) / score : NaN;
    const hist = A.analyze(before, g.settings);
    let compare = '', badge = '';

    if (s.standard) {
      const prev = before.filter((x) => x.mode === 'classic' && x.standard && x.duration === s.duration).map((x) => x.score);
      if (prev.length) {
        const best = Math.max(...prev), avg = A.mean(prev.slice(-10));
        if (score > best) badge = `<div class="badge">New best (previous ${best})</div>`;
        const d1 = score - avg, d2 = score - best;
        compare = `
          <div class="stat"><div class="v ${d1 >= 0 ? 'delta-up' : 'delta-down'}">${d1 >= 0 ? '+' : ''}${round1(d1)}</div><div class="l">vs last ${Math.min(10, prev.length)} avg (${round1(avg)})</div></div>
          <div class="stat"><div class="v ${d2 >= 0 ? 'delta-up' : 'delta-down'}">${d2 >= 0 ? '+' : ''}${d2}</div><div class="l">vs best (${best})</div></div>`;
      } else badge = `<div class="badge">First official game</div>`;
    } else if (s.mode !== 'classic') {
      const cats = {};
      s.problems.forEach((p) => { const c = P.category(p); (cats[c] = cats[c] || []).push(p.ms); });
      const rows = Object.entries(cats).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
      compare = rows.map(([c, t]) => {
        const usual = hist.catMap[c] && hist.catMap[c].n ? hist.catMap[c].est : NaN;
        const now = Math.exp(A.mean(t.map(Math.log)));
        const better = Number.isFinite(usual) && now < usual;
        return `<div class="stat"><div class="v ${Number.isFinite(usual) ? (better ? 'delta-up' : 'delta-down') : ''}">${sec(now, 1)}</div>
          <div class="l">${esc(P.categoryLabel(c))} · usually ${sec(usual, 1)}</div></div>`;
      }).join('');
    }

    const opRows = P.OPS.map((op) => {
      const t = s.problems.filter((p) => p.op === op).map((p) => p.ms);
      if (!t.length) return '';
      const usual = hist.ops[op].median;
      const now = A.median(t);
      const cls = Number.isFinite(usual) ? (now <= usual ? 'delta-up' : 'delta-down') : '';
      return `<tr><td>${P.OP_NAME[op]}</td><td class="r m">${t.length}</td><td class="r ${cls}">${sec(now)}</td><td class="r m">${sec(usual)}</td></tr>`;
    }).join('');

    const slow = s.problems.slice().sort((a, b) => b.ms - a.ms).slice(0, 6)
      .map((p) => `<tr><td class="q">${esc(solved(p))}</td><td class="r">${sec(p.ms)}</td></tr>`).join('');

    $('results').innerHTML = `
      <div class="results">
        <div class="big">${score}</div>
        <div class="sub">${esc(modeName(s))} · ${s.duration}s${score ? ` · ${sec(per)} per problem` : ''}</div>
        ${badge}
        ${!saved ? '<div class="badge" style="color:var(--bad)">Could not save: browser storage is full or blocked</div>' : ''}
        ${!score ? '<div class="sub">Nothing answered, so this game wasn\'t recorded.</div>' : ''}
        ${compare ? `<div class="compare">${compare}</div>` : ''}
        ${score ? `
        <div class="cols" style="margin-top:40px">
          <div><h2>By operation</h2><table class="list"><tr><th>Operation</th><th class="r">Count</th><th class="r">Median</th><th class="r">Usual</th></tr>${opRows}</table></div>
          <div><h2>Slowest this game</h2><table class="list"><tr><th>Problem</th><th class="r">Time</th></tr>${slow}</table></div>
        </div>` : ''}
        <div class="actions">
          <button class="primary" id="again">Play again</button>
          <button class="ghost" id="to-analysis">Analysis</button>
          <button class="ghost" id="to-home">Home</button>
        </div>
        <p class="hint"><kbd>Enter</kbd> to play again</p>
      </div>`;
    $('again').onclick = () => startGame();
    $('to-analysis').onclick = () => go('analysis');
    $('to-home').onclick = () => go('play');
    state.mode = s.mode;
  }

  /* ---------- analysis ---------- */
  let analysisShowAll = false, heatOp = 'mul';

  function renderAnalysis() {
    const settings = S.settings();
    const sessions = S.sessions();
    const an = A.analyze(sessions, settings);
    const root = $('analysis');
    if (!an.probs.length) {
      root.innerHTML = `<div class="empty">No answers recorded yet.<br>Play a few games and your weak spots will show up here.<br><button class="start" onclick="location.hash='play'">Play</button></div>`;
      return;
    }

    const opCards = P.OPS.filter((o) => an.ops[o].n).map((o) => `
      <div class="card"><div class="l">${P.OP_NAME[o]}</div><div class="v">${sec(an.ops[o].median)}</div>
      <div class="l">median · ${an.ops[o].n.toLocaleString()} answers</div></div>`).join('');

    const cats = an.cats.slice().sort((a, b) => b.est - a.est);
    const maxEst = Math.max(...cats.map((c) => c.est));
    const shown = analysisShowAll ? cats : cats.slice(0, 12);
    const catRows = shown.map((c, i) => {
      const rel = c.est / an.typical - 1;
      return `<tr class="click" data-cat="${c.cat}" title="Click to drill ${esc(P.categoryLabel(c.cat))}">
        <td class="m">${i + 1}</td>
        <td><span class="q">${esc(P.categoryLabel(c.cat))}</span><br><span class="hint-sm">${esc(P.categoryHint(c.cat))}</span></td>
        <td class="barcell hide-sm"><div class="bar ${rel > 0.25 ? 'hot' : ''}"><i style="width:${(100 * c.est / maxEst).toFixed(1)}%"></i></div></td>
        <td class="r">${c.n ? sec(c.est) : '<span class="m">—</span>'}</td>
        <td class="r ${rel > 0 ? 'delta-down' : 'delta-up'}" style="font-size:13px">${c.n ? pct(rel) : ''}</td>
        <td class="r m hide-sm">${c.n}</td>
        <td class="hide-sm" style="width:84px"><div class="cspark" data-i="${i}"></div></td>
      </tr>`;
    }).join('');

    const factRows = an.facts.slice(0, 12).map((f) => `
      <tr><td class="q">${esc(solved(f.p))}</td><td class="m hide-sm">${esc(P.categoryLabel(f.cat))}</td>
      <td class="r">${sec(f.recent)}</td><td class="r m">${f.n}×</td></tr>`).join('');

    root.innerHTML = `
      <div class="page">
        <div class="head">
          <div><h1>Analysis</h1>
          <p class="lede">${an.probs.length.toLocaleString()} answers across ${sessions.length} game${sessions.length === 1 ? "" : "s"}. Recent answers count more, so these reflect how fast you are now.</p></div>
          <button class="primary" id="train-weak">Train weak spots</button>
        </div>
        <div class="grid" style="margin-top:20px">${opCards}</div>

        <h2>Slowest problem types</h2>
        <div class="panel">
          <table class="list">
            <tr><th></th><th>Type</th><th class="hide-sm"></th><th class="r">Typical</th><th class="r">vs avg</th><th class="r hide-sm">Seen</th><th class="hide-sm">Trend</th></tr>
            ${catRows}
          </table>
          ${cats.length > 12 ? `<div class="actions"><button class="ghost" id="toggle-all">${analysisShowAll ? 'Show fewer' : `Show all ${cats.length}`}</button><span class="note">Click a row to drill that type.</span></div>` : '<p class="note">Click a row to drill that type.</p>'}
        </div>

        <h2>Times by factor</h2>
        <div class="panel">
          <div class="head" style="margin-bottom:10px">
            <span class="note">Median seconds by small factor (rows) and size of the other number (columns).</span>
            <div class="tabs" id="heat-tabs"><button data-op="mul">×</button><button data-op="div">÷</button></div>
          </div>
          <div id="heat"></div>
        </div>

        <h2>Slowest individual problems</h2>
        <div class="panel">
          <table class="list"><tr><th>Problem</th><th class="hide-sm">Type</th><th class="r">Recent avg</th><th class="r">Seen</th></tr>${factRows}</table>
        </div>
      </div>`;

    root.querySelectorAll('.cspark').forEach((el) => {
      const c = shown[+el.dataset.i];
      spark(el, c.chunks.length >= 2 ? c.chunks : [], { color: 'var(--muted)', height: 20 });
    });
    root.querySelectorAll('tr[data-cat]').forEach((tr) => tr.addEventListener('click', () => {
      state.drill = tr.dataset.cat; state.mode = 'drill'; go('play');
    }));
    $('train-weak').onclick = () => { state.mode = 'focus'; go('play'); };
    if ($('toggle-all')) $('toggle-all').onclick = () => { analysisShowAll = !analysisShowAll; renderAnalysis(); };
    $('heat-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      heatOp = b.dataset.op; drawHeat(an, settings);
    });
    drawHeat(an, settings);
  }

  function drawHeat(an, settings) {
    document.querySelectorAll('#heat-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.op === heatOp));
    const cells = an.heat[heatOp];
    const rows = [];
    const seenRows = new Set(Object.keys(cells).map((k) => +k.split('|')[0]));
    for (let n = settings.mulA[0]; n <= settings.mulA[1]; n++) seenRows.add(n);
    rows.push(...[...seenRows].sort((a, b) => a - b));
    const cols = P.BUCKETS.map((label, i) => ({ label, i }))
      .filter(({ i }) => rows.some((r) => cells[`${r}|${i}`]) || ((i === 9 ? Infinity : i * 10 + 9) >= settings.mulB[0] && (i === 0 ? 0 : i * 10) <= settings.mulB[1]));
    const sym = P.SYMBOL[heatOp];
    C.heatmap($('heat'), {
      rows: rows.map((r) => `${sym} ${r}`),
      cols: cols.map((c) => c.label),
      cell: (ri, ci) => {
        const t = cells[`${rows[ri]}|${cols[ci].i}`];
        if (!t || !t.length) return { v: null, n: 0, title: 'No data' };
        const m = A.median(t) / 1000;
        return { v: m, n: t.length, title: `${sym} ${rows[ri]}, ${cols[ci].label}: ${m.toFixed(2)}s median over ${t.length}` };
      },
      format: (v) => v.toFixed(1),
    });
  }

  /* ---------- progress ---------- */
  let progressDuration = null;

  function renderProgress() {
    const settings = S.settings();
    const sessions = S.sessions();
    const root = $('progress');
    const offAll = sessions.filter((s) => s.mode === 'classic' && s.standard);
    if (!sessions.length) {
      root.innerHTML = `<div class="empty">No games yet.<br>Your score history and trends will build up here.<br><button class="start" onclick="location.hash='play'">Play</button></div>`;
      return;
    }
    const durations = [...new Set(offAll.map((s) => s.duration))].sort((a, b) => a - b);
    if (!durations.includes(progressDuration)) progressDuration = durations.includes(settings.duration) ? settings.duration : durations[durations.length - 1];
    const off = offAll.filter((s) => s.duration === progressDuration);
    const scores = off.map((s) => s.score);

    const first = scores.slice(0, 10), last = scores.slice(-10);
    const change = scores.length >= 4 ? A.mean(last) - A.mean(first) : NaN;
    const totalProblems = sessions.reduce((t, s) => t + s.problems.length, 0);
    const minutes = sessions.reduce((t, s) => t + s.duration, 0) / 60;
    const days = new Set(sessions.map((s) => new Date(s.at).toDateString())).size;

    const card = (l, v, d) => `<div class="card"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;

    // category trends: compare first 20 vs last 20 answers of each type
    const an = A.analyze(sessions, settings);
    const trends = an.cats.filter((c) => c.n >= 30).map((c) => ({ c, d: c.recent / c.early - 1 })).sort((a, b) => a.d - b.d);
    const trendRows = trends.map(({ c, d }) => `
      <tr><td class="q">${esc(P.categoryLabel(c.cat))}</td><td class="r m">${sec(c.early)}</td><td class="r">${sec(c.recent)}</td>
      <td class="r ${d <= 0 ? 'delta-up' : 'delta-down'}">${pct(d)}</td><td class="hide-sm" style="width:110px"><div class="tspark" data-cat="${c.cat}"></div></td></tr>`).join('');

    const recent = sessions.slice(-12).reverse().map((s) => `
      <tr><td class="m">${dateTimeFmt(s.at)}</td><td>${esc(modeName(s))}${s.mode === 'classic' && !s.standard ? ' <span class="m">(custom)</span>' : ''}</td>
      <td class="r m hide-sm">${s.duration}s</td><td class="r q">${s.score}</td><td class="r m">${s.score ? sec(s.duration * 1000 / s.score) : '—'}</td></tr>`).join('');

    root.innerHTML = `
      <div class="page">
        <div class="head">
          <div><h1>Progress</h1><p class="lede">Official scores only include classic games on Zetamac's default settings.</p></div>
          ${durations.length > 1 ? `<div class="tabs" id="dur-tabs">${durations.map((d) => `<button data-d="${d}" class="${d === progressDuration ? 'on' : ''}">${d}s</button>`).join('')}</div>` : ''}
        </div>
        <div class="grid" style="margin-top:20px">
          ${card('Best score', scores.length ? Math.max(...scores) : '—')}
          ${card(`Last ${last.length || 10} average`, round1(A.mean(last)), Number.isFinite(change) ? `<span class="${change >= 0 ? 'delta-up' : 'delta-down'}">${change >= 0 ? '+' : ''}${round1(change)} since your first ${first.length}</span>` : '')}
          ${card('Games', sessions.length, `${off.length} official`)}
          ${card('Problems solved', totalProblems.toLocaleString(), `${Math.round(minutes)} min over ${days} day${days === 1 ? '' : 's'}`)}
        </div>

        <h2>Score</h2>
        <div class="panel">
          <div class="legend"><span><i style="background:var(--faint)"></i>Each game</span><span><i style="background:var(--accent)"></i>10-game average</span></div>
          <div id="score-chart"></div>
        </div>

        <h2>Seconds per problem</h2>
        <div class="panel">
          <div class="legend">${P.OPS.map((o, i) => `<span><i style="background:var(--series-${i + 1})"></i>${P.OP_NAME[o]}</span>`).join('')}<span>· lower is better, 5-game average, all classic games</span></div>
          <div id="op-chart"></div>
        </div>

        <h2>Problem type trends</h2>
        <div class="panel">
          ${trendRows ? `<table class="list"><tr><th>Type</th><th class="r">First 20</th><th class="r">Last 20</th><th class="r">Change</th><th class="hide-sm">Medians, every 10</th></tr>${trendRows}</table>`
            : '<p class="note">Trends appear once a problem type has 30 or more answers.</p>'}
        </div>

        <h2>Recent games</h2>
        <div class="panel"><table class="list"><tr><th>When</th><th>Mode</th><th class="r hide-sm">Length</th><th class="r">Score</th><th class="r">Per problem</th></tr>${recent}</table></div>
      </div>`;

    if ($('dur-tabs')) $('dur-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { progressDuration = +b.dataset.d; renderProgress(); } };

    const roll = A.rolling(scores, 10);
    C.line($('score-chart'), {
      series: [
        { name: 'Score', color: 'var(--faint)', width: 1.25, dots: scores.length < 60, points: scores.map((y, i) => ({ x: i + 1, y })) },
        { name: '10-game avg', color: 'var(--accent)', width: 2.25, area: true, points: roll.map((y, i) => ({ x: i + 1, y })) },
      ],
      height: 240, xTickCount: $('score-chart').clientWidth < 520 ? 3 : 5,
      xFormat: (x) => { const s = off[Math.round(x) - 1]; return s ? `#${Math.round(x)} · ${dateFmt(s.at)}` : `#${Math.round(x)}`; },
      yFormat: (y) => round1(y),
    });

    const classic = sessions.filter((s) => s.mode === 'classic' && s.problems.length);
    const opSeries = P.OPS.map((op, i) => {
      const per = classic.map((s) => { const t = s.problems.filter((p) => p.op === op).map((p) => p.ms); return t.length ? A.mean(t) / 1000 : NaN; });
      const pts = [];
      per.forEach((_, j) => {
        const win = per.slice(Math.max(0, j - 4), j + 1).filter(Number.isFinite);
        if (win.length && Number.isFinite(per[j])) pts.push({ x: j + 1, y: A.mean(win) });
      });
      return { name: P.OP_NAME[op], color: `var(--series-${i + 1})`, width: 1.75, points: pts };
    }).filter((s) => s.points.length);
    C.line($('op-chart'), {
      series: opSeries, height: 220, yZero: true, xTickCount: $('op-chart').clientWidth < 520 ? 3 : 5,
      xFormat: (x) => { const s = classic[Math.round(x) - 1]; return s ? `#${Math.round(x)} · ${dateFmt(s.at)}` : `#${Math.round(x)}`; },
      yFormat: (y) => y.toFixed(2) + 's',
    });

    root.querySelectorAll('.tspark').forEach((el) => {
      const c = an.catMap[el.dataset.cat];
      spark(el, c.chunks, { color: 'var(--accent)', height: 22 });
    });
  }

  /* ---------- settings ---------- */
  const form = $('settings-form');
  function renderSettings() {
    const s = S.settings();
    form.duration.value = String(s.duration);
    P.OPS.forEach((o) => { form[`op-${o}`].checked = !!s.ops[o]; });
    ['addA', 'addB', 'mulA', 'mulB'].forEach((k) => { form[`${k}0`].value = s[k][0]; form[`${k}1`].value = s[k][1]; });
    $('saved-note').textContent = '';
  }
  function readSettings() {
    const s = P.clone(S.settings());
    s.duration = +form.duration.value;
    P.OPS.forEach((o) => { s.ops[o] = form[`op-${o}`].checked; });
    if (!P.OPS.some((o) => s.ops[o])) { s.ops.add = true; form['op-add'].checked = true; }
    ['addA', 'addB', 'mulA', 'mulB'].forEach((k) => {
      const clamp = (v) => Math.min(9999, Math.max(1, Math.round(+v || 1)));
      let lo = clamp(form[`${k}0`].value), hi = clamp(form[`${k}1`].value);
      if (lo > hi) [lo, hi] = [hi, lo];
      s[k] = [lo, hi];
    });
    return s;
  }
  let savedTimer;
  form.addEventListener('change', () => {
    S.saveSettings(readSettings());
    renderSettings();
    $('saved-note').textContent = P.isStandard(S.settings()) ? 'Saved · Zetamac defaults' : 'Saved · custom (games won’t count as official)';
    clearTimeout(savedTimer); savedTimer = setTimeout(() => ($('saved-note').textContent = ''), 2500);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('reset-settings').onclick = () => {
    const s = P.clone(P.DEFAULTS);
    s.duration = S.settings().duration;
    S.saveSettings(s); renderSettings();
    $('saved-note').textContent = 'Restored defaults';
  };
  $('export').onclick = () => {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zeta-trainer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('import').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = S.importJSON(await f.text()); $('data-note').textContent = `Imported ${n} new game${n === 1 ? '' : 's'}.`; }
    catch (err) { $('data-note').textContent = `Import failed: ${err.message}`; }
    e.target.value = '';
  };
  $('erase').onclick = () => {
    const n = S.sessions().length;
    if (!n) { $('data-note').textContent = 'Nothing to erase.'; return; }
    if (confirm(`Erase all ${n} recorded games? This can't be undone, so export first if you want a backup.`)) {
      S.eraseAll(); $('data-note').textContent = 'History erased.';
    }
  };

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && game) { e.preventDefault(); quitGame(); return; }
    if (e.key !== 'Enter' || game) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'a') return;
    if (state.view === 'play') { e.preventDefault(); startGame(); }
    else if (state.view === 'results' && Date.now() - state.lastResultAt > 700) { e.preventDefault(); startGame(); }
  });

  route();
})();
