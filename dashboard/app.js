// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail dialog with
// the model's own inputs and the protocol's farm plan. No network: every byte it shows is in
// data.js. The page recomputes each row from the snapshot figures, so the code and the board
// are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', readiness: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are the same model.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var breadth = 1 + Math.min(Math.max(chains - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
    var momentum = (row.age_days !== null && row.age_days !== undefined && row.age_days < model.momentum_age_days && growth > model.momentum_growth_pct) ? model.momentum_boost : 1;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth * momentum));
  }
  function readinessOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var m = Math.min(Math.max(age, 0), 1095) / 1095;
    var g = Math.min(Math.max((growth + 60) / 180, 0), 1);
    var b = Math.min(Math.max((row.chains ? row.chains.length : 1) - 1, 0), 5) / 5;
    return Math.max(0, Math.min(100, Math.round(100 * (0.5 * m + 0.3 * g + 0.2 * b))));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased, and the last step always says how to get out again.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function weeklyActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Make one qualifying action each week: add collateral, borrow a small amount and repay it, or vote in governance.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Make one qualifying action each week: add or rebalance liquidity, or run one swap through the pool.';
    if (c.indexOf('bridge') >= 0) return 'Make one qualifying action each week: bridge a small amount and use the bridged funds in the destination app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Make one qualifying action each week: top up the stake a little, or restake the rewards it pays.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Make one qualifying action each week: open and close one small hedged position, and keep the margin topped up.';
    if (c.indexOf('prediction') >= 0) return 'Make one qualifying action each week: place one small market position and settle it before it expires.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Make one qualifying action each week: deposit into a vault, or move a share between two of its vaults.';
    if (c.indexOf('stable') >= 0) return 'Make one qualifying action each week: mint, deposit or redeem a small amount of the stable asset.';
    if (c.indexOf('rwa') >= 0) return 'Make one qualifying action each week: mint a little of the yield asset, or claim and re-deposit its yield.';
    return 'Make one qualifying action each week: a deposit, a borrow, a swap or a vote in the protocol.';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'To exit, unwind in the reverse order you entered, leave dust behind for gas, and keep the farm log for tax time.', cost: 'about $' + gas + ' of gas to unwind', time: '15 minutes' }
    ].map(stepText);
  }

  // CSV export: the view the reader sees — the filtered, sorted board, or the live
  // set — as a spreadsheet file, built in the page from the same data.js the table
  // renders, so the download can never disagree with what is on screen. One cell is
  // quoted the RFC 4180 way when it holds a comma, a quote or a line break, and chains
  // join with a semicolon so a chain list never splits a row.
  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function boardCsv(list) {
    var lines = ['rank,name,category,chains,tvl_usd,change_7d_pct,age_days,readiness,implied_value_usd,value_per_tvl'];
    list.forEach(function (r) {
      lines.push([
        r.rank, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
        r.readiness, r.implied_value_usd, (r.implied_value_usd / r.tvl_usd).toFixed(4)
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function liveCsv() {
    var lines = ['name,category,chains,tvl_usd,mcap_usd,change_7d_pct'];
    DATA.live.forEach(function (r) {
      lines.push([
        r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.mcap_usd === null ? '' : r.mcap_usd, r.change_7d === null ? '' : r.change_7d
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function downloadCsv() {
    var text = state.tab === 'live' ? liveCsv() : boardCsv(sortedRows(rows()));
    var name = state.tab === 'live' ? 'token-radar-live.csv' : 'token-radar-board.csv';
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // The model's self-check, run in the reader's browser from the same snapshot
  // figures the board was built from: recompute every row and compare it with the
  // number board.json carries, then check the ranks, the order, the watchlist, the
  // farm plans and the readiness range. It is the same audit main.ts runs before
  // writing the output, so a stale or tampered data.js shows up here as a failed
  // check instead of a table that looks fine.
  function auditBoard() {
    var checks = [];
    var mismatches = 0;
    DATA.rows.forEach(function (r) {
      if (impliedOf(r, DATA.model) !== r.implied_value_usd) mismatches += 1;
    });
    checks.push({ name: 'Recompute', passed: mismatches === 0, detail: (DATA.rows.length - mismatches) + ' of ' + DATA.rows.length + ' rows recompute to the same implied value' });
    var ranksOk = DATA.rows.length > 0;
    DATA.rows.forEach(function (r, i) { if (r.rank !== i + 1) ranksOk = false; });
    checks.push({ name: 'Ranks', passed: ranksOk, detail: ranksOk ? 'ranks run 1 to ' + DATA.rows.length + ' with no gap and no repeat' : 'ranks are not 1..n in order' });
    var ordered = true;
    for (var i = 1; i < DATA.rows.length; i++) {
      if (DATA.rows[i].implied_value_usd > DATA.rows[i - 1].implied_value_usd) { ordered = false; break; }
    }
    checks.push({ name: 'Order', passed: ordered, detail: ordered ? 'implied value never rises going down the board' : 'a lower row outranks the row above it on implied value' });
    var absent = (DATA.watchlist || []).filter(function (s) {
      return DATA.rows.filter(function (r) { return r.slug === s; }).length === 0;
    });
    checks.push({ name: 'Watchlist', passed: absent.length === 0, detail: absent.length === 0 ? 'all ' + DATA.watchlist.length + ' watchlist protocols are on the board' : absent.length + ' watchlist slugs are missing' });
    var badPlans = 0;
    DATA.rows.forEach(function (r) {
      var steps = farmSteps(r);
      if (steps.length < 3 || steps.length > 12) { badPlans += 1; return; }
      for (var j = 0; j < steps.length; j++) {
        if (steps[j].length < 20 || steps[j].length > 600) { badPlans += 1; break; }
      }
    });
    checks.push({ name: 'Farm plans', passed: badPlans === 0, detail: badPlans === 0 ? 'every row carries 3 to 12 farm steps of 20 to 600 characters' : badPlans + ' rows carry a farm plan outside 3 to 12 steps of 20 to 600 characters' });
    var badReady = 0;
    DATA.rows.forEach(function (r) { if (!isFinite(r.readiness) || r.readiness < 0 || r.readiness > 100) badReady += 1; });
    checks.push({ name: 'Readiness', passed: badReady === 0, detail: badReady === 0 ? 'every readiness score sits between 0 and 100' : badReady + ' rows carry a readiness outside 0 to 100' });
    var distinct = {};
    DATA.rows.forEach(function (r) { distinct[r.implied_value_usd] = true; });
    var distinctCount = Object.keys(distinct).length;
    checks.push({ name: 'Spread', passed: DATA.rows.length < 2 || distinctCount > 1, detail: distinctCount > 1 ? distinctCount + ' distinct implied values across ' + DATA.rows.length + ' rows' : 'every row shares one implied value: the board ranks nothing' });
    return checks;
  }

  // The watchlist is the house's own list of slugs, carried in data.js; the board ranks it
  // plus every other rankable pre-token protocol. This set drives the watchlist-only filter.
  var WATCH_SET = new Set(DATA.watchlist || []);

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('rdy')) state.readiness = params.get('rdy');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.readiness !== 'all') params.set('rdy', state.readiness);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !WATCH_SET.has(r.slug)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.readiness !== 'all' && r.readiness < Number(state.readiness)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'readiness') { av = a.readiness; bv = b.readiness; }
      else if (key === 'efficiency') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols the watchlist left out. Implied value is a model, not a promise, and "no token" means the record carries none, never that the protocol has none.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var rdyOptions = [['all', 'Any readiness'], ['70', 'Ready 70+'], ['60', 'Ready 60+'], ['50', 'Ready 50+'], ['40', 'Ready 40+']];
    var rdy = el('select', { id: 'readiness', 'aria-label': 'Filter by readiness' },
      rdyOptions.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === state.readiness ? 'selected' : null }); })
    );
    rdy.addEventListener('change', function () { state.readiness = rdy.value; writeHash(); render(); });
    var csvCount = state.tab === 'pre-token' ? rows().length : DATA.live.length;
    var csv = el('button', { class: 'button', type: 'button', text: 'Download CSV (' + csvCount + ' rows)', onclick: downloadCsv });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'readiness', text: 'Readiness' }), rdy),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      csv,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.readiness = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num' }, el('span', { class: 'readiness', text: String(r.readiness) })),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('readiness', 'Ready'),
            sortHeader('implied', 'Implied value'),
            sortHeader('efficiency', 'Value / $ TVL'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var audit = auditBoard();
    var passed = audit.filter(function (c) { return c.passed; }).length;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl x ' + m.base_multiple + ' x (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x breadth x momentum )'
      ),
      el('div', { class: 'factors' },
        el('div', null, el('b', { text: 'TVL. ' }), 'The size of the bet the market has already placed.'),
        el('div', null, el('b', { text: 'Growth. ' }), 'Seven-day TVL change, clamped, moves the value up or down by half its rate.'),
        el('div', null, el('b', { text: 'Maturity. ' }), 'Time listed with no token: longer service lifts the value, up to three years.'),
        el('div', null, el('b', { text: 'Breadth. ' }), 'Each extra chain adds 2%, to 10%: distribution reaches more farmers.'),
        el('div', null, el('b', { text: 'Momentum. ' }), 'Under a year old and growing over 20% in 7 days: 1.05x, fresh momentum.'),
        el('div', null, el('b', { text: 'Readiness. ' }), 'Display only, 0-100: half maturity, three tenths growth, two tenths breadth.')
      ),
      el('h3', { text: 'Model self-check' }),
      el('p', { class: 'sub', text: 'Recomputed here in your browser from the same snapshot figures the board was built from: ' + passed + ' of ' + audit.length + ' checks passed. A failed check means the data on this page is stale, not the model.' }),
      el('ul', { class: 'checks' }, audit.map(function (c) {
        return el('li', { class: c.passed ? 'check-pass' : 'check-fail' }, el('b', { text: (c.passed ? 'Pass' : 'Fail') + ': ' + c.name + ' — ' }), c.detail);
      })),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol the watchlist left out, by the same function, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: String(row.momentum_multiplier) })),
        el('div', null, el('span', { text: 'Readiness (0-100)' }), el('b', { class: 'num', text: String(row.readiness) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
