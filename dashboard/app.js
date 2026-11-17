// PreToken Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, its filters, a per-protocol detail drawer with the model's full breakdown and the
// protocol's farm plan, the category multiples the prices came from, and the already-trading reference
// set. No network: every byte it shows arrived inside data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function compact(n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function full(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="pct">—</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="pct ' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function factor(n) { return '×' + Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // ---- header meta -------------------------------------------------------
  document.getElementById('meta').textContent =
    'Snapshot ' + D.as_of + ' · ' + D.board_size + ' protocols ranked · all ' + D.watchlist_size +
    ' watchlist protocols covered · ' + D.early_size + ' early rows below the ' + compact(D.floor_usd) +
    ' floor · model ' + D.model_version + ' · global median multiple ×' + D.global_multiple;

  // ---- category multiples -------------------------------------------------
  document.getElementById('multiples').innerHTML = D.multiples.map(function (m) {
    return '<span class="mult' + (m.source === 'global' ? ' fallback' : '') + '">' + esc(m.category) +
      ' <b>×' + m.multiple + '</b> · n=' + m.sample + (m.source === 'global' ? ' · global' : '') + '</span>';
  }).join('');

  // ---- filters ------------------------------------------------------------
  var cats = [], chains = [], seenC = {}, seenCh = {};
  rows.forEach(function (r) {
    var c = r.category || '(uncategorised)';
    if (!seenC[c]) { seenC[c] = 1; cats.push(c); }
    r.chains.forEach(function (ch) { if (!seenCh[ch]) { seenCh[ch] = 1; chains.push(ch); } });
  });
  cats.sort(); chains.sort();
  var catSel = document.getElementById('f-cat');
  cats.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var chainSel = document.getElementById('f-chain');
  chains.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });

  var state = { q: '', cat: '', chain: '', tvl: 0, watch: false, sort: 'rank', dir: 1 };

  function value(r, key) {
    if (key === 'rank') return r.rank;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'multiple') return r.model.multiple;
    return r.implied_value_usd;
  }
  function visible() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.cat && (r.category || '(uncategorised)') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (state.watch && !r.watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    out.sort(function (a, b) {
      var va = value(a, state.sort), vb = value(b, state.sort);
      if (va < vb) return -state.dir;
      if (va > vb) return state.dir;
      return a.rank - b.rank;
    });
    return out;
  }

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  function render() {
    var list = visible();
    countEl.textContent = 'Showing ' + list.length + ' of ' + rows.length;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">No protocol matches these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (r) {
      var ch = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="wl-badge">WL</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(ch || '—') + '</td>' +
        '<td class="money num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="mult num">×' + r.model.multiple + '</td>' +
        '<td class="implied num">' + compact(r.implied_value_usd) + '</td></tr>';
    }).join('');
  }

  // ---- detail drawer --------------------------------------------------------
  var detail = document.getElementById('detail');
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var m = r.model;
    var comps = r.comparables.length === 0
      ? '<p class="prose">No trading protocol in this category records a market cap in the snapshot, so this row is priced with the global median multiple.</p>'
      : '<table class="mini"><thead><tr><th>Comparable</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">MCap/TVL</th></tr></thead><tbody>' +
        r.comparables.map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td><td class="num">' + compact(c.mcap_usd) + '</td><td class="num">' +
            compact(c.tvl_usd) + '</td><td class="num">×' + c.ratio + '</td></tr>';
        }).join('') + '</tbody></table>';
    detail.innerHTML =
      '<button class="close" id="d-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="wl-badge">WL</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + D.board_size + ' · ' + esc(r.category || 'uncategorised') + '</p>' +
      '<div class="big-label">Implied token value</div><div class="big">' + full(r.implied_value_usd) + '</div>' +
      '<dl class="kv">' +
      '<dt>Total value locked</dt><dd>' + full(r.tvl_usd) + '</dd>' +
      '<dt>TVL change, 7 days</dt><dd>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || '—') + '</dd>' +
      '<dt>Days with no token</dt><dd>' + (r.age_days === null ? '—' : r.age_days) + '</dd>' +
      '</dl>' +
      '<h3>Model breakdown</h3>' +
      '<dl class="kv">' +
      '<dt>Category multiple (' + (m.multiple_source === 'category' ? 'median of ' + m.multiple_sample + ' trading ' + esc(r.category || '') + ' protocols' : 'global median, thin category') + ')</dt><dd>×' + m.multiple + '</dd>' +
      '<dt>Base value (TVL × multiple)</dt><dd>' + full(m.base_value_usd) + '</dd>' +
      '<dt>Momentum (7d ' + (m.change_7d_used > 0 ? '+' : '') + m.change_7d_used + '% used)</dt><dd>' + factor(m.momentum_factor) + '</dd>' +
      '<dt>Track record (' + (m.age_days === null ? 'age unrecorded' : m.age_days + ' days') + ')</dt><dd>' + factor(m.age_factor) + '</dd>' +
      '<dt>Reach (' + m.chain_count + ' chain' + (m.chain_count === 1 ? '' : 's') + ')</dt><dd>' + factor(m.chain_factor) + '</dd>' +
      '<dt>Implied value</dt><dd>' + full(r.implied_value_usd) + '</dd>' +
      '</dl>' +
      '<h3>Priced like these trading protocols</h3>' + comps +
      '<h3>Farm plan</h3>' +
      '<ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detail.hidden = false;
    document.getElementById('d-close').addEventListener('click', function () {
      detail.hidden = true;
      if (location.hash.indexOf('#p/') === 0) history.pushState(null, '', '#board');
    });
    detail.scrollTop = 0;
  }

  // ---- events ---------------------------------------------------------------
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('f-tvl').addEventListener('change', function (e) { state.tvl = Number(e.target.value); render(); });
  document.getElementById('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  Array.prototype.forEach.call(document.querySelectorAll('#board th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; if (key === 'rank') state.dir = 1; }
      Array.prototype.forEach.call(document.querySelectorAll('#board th .arrow'), function (a) { a.remove(); });
      var arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = state.dir === 1 ? ' ▲' : ' ▼';
      th.appendChild(arrow);
      render();
    });
  });
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) location.hash = 'p/' + tr.getAttribute('data-slug');
  });

  function route() {
    var h = location.hash || '';
    if (h.indexOf('#p/') === 0) openDetail(decodeURIComponent(h.slice(3)));
    else if (h.indexOf('#cat/') === 0) {
      detail.hidden = true;
      state.cat = decodeURIComponent(h.slice(5));
      catSel.value = state.cat;
      render();
      document.getElementById('board-panel').scrollIntoView();
    } else if (h === '#top-board') {
      document.getElementById('board-panel').scrollIntoView();
    }
  }
  window.addEventListener('hashchange', route);

  // ---- live reference set -----------------------------------------------------
  document.getElementById('live').innerHTML = D.live.map(function (p) {
    return '<div class="live-card"><span class="n">' + esc(p.name) + '</span>' +
      '<span class="v">market cap <b>' + compact(p.mcap_usd) + '</b> · TVL ' + compact(p.tvl_usd) +
      ' · ' + esc(p.category || '—') + '</span></div>';
  }).join('');

  render();
  route();
})();
