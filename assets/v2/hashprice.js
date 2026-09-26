/* Omnes Hashprice Index: the /hashprice/ page. Loaded after site.js.

   site.js already polls mempool.space for the live figures (Omnes.live, at most once a minute
   and only while the page is visible) and fills the [data-live] slots and the status line. This
   file adds what only this page needs:
   1  Live extras   the Bitcoin figure, the four inputs and the worked calculation, from each
                    Omnes.live snapshot ([data-hx] slots)
   2  History       the daily series, built in the browser from three public mempool.space series
   3  Changes       the 1-day and 30-day changes in the daily index, beside the live figure
   4  Chart         an SVG line of the daily index with a light fill, halving markers, a pointer
                    and keyboard readout (role="slider" over the days), ranges, a US$ or BTC
                    unit, and the range's high, low, average and change
   5  CSV           the full daily series as a download

   The index: 144 x (block subsidy + average fees per block) / (network hashrate in PH/s) x
   Bitcoin price, in US dollars per PH/s per day; without the price term, Bitcoin per PH/s per day.

   Live value (site.js snapshot): subsidy and fees are the average reward per block over the last
   144 blocks (/v1/mining/reward-stats/144: totalReward and totalFee over startBlock..endBlock);
   hashrate is mempool.space's currentHashrate (/v1/mining/hashrate/3d), which is its estimate over
   the last 1,008 blocks, about seven days (checked against block times and difficulty); the price
   is /v1/prices USD.

   Daily series, one row per UTC day d:
     reward(d)   the average reward per block on day d, subsidy plus fees, in BTC.
                 /v1/mining/blocks/rewards/all returns one bucket per UTC day: avgRewards in
                 satoshis per block, stamped at the average time of that day's blocks.
     hashrate(d) mempool.space's network hashrate estimate for day d, from that day's blocks.
                 /v1/mining/hashrate/all returns one value per day stamped at the midnight that
                 ENDS the day it covers (the value stamped 00:00 on d + 1 matches the block count
                 of d), so each value is moved back one day.
     price(d)    the mean of the US dollar prices from /v1/historical-price?currency=USD stamped
                 within day d (hourly since late 2022; daily, then weekly, before that). A day
                 with no price point is interpolated in time between the nearest points on either
                 side; nothing is extrapolated beyond the first or last point.
     btc(d)      144 x reward(d) / hashrate(d) in PH/s             Bitcoin per PH/s per day
     usd(d)      btc(d) x price(d)                                 US dollars per PH/s per day
   A day is kept only when all three inputs exist and are positive, so the series ends with the
   last closed UTC day. The chart also draws a trailing 7-day average of the daily values (the
   day and the six before it, only where all seven exist) as a reading aid; it is labelled as
   such and is not part of the CSV. One day's hashrate estimate moves with the luck of that
   day's blocks, so daily values are more volatile than the live figure. The changes beside the
   live figure therefore compare daily values with daily values, never the live figure with a
   daily one.

   Mining pool fields in any response are never read.
*/
(function () {
  "use strict";
  var doc = document;
  var O = window.Omnes || {};
  var API = "https://mempool.space/api", DAY = 86400, MS = 864e5, NA = "Unavailable";
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };

  /* formatting ────────────────────────────────────────────────────────── */
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var nf = function (v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var fin = function (v) { return typeof v === "number" && isFinite(v); };
  var pos = function (v) { return fin(v) && v > 0; };
  /* a figure per PH/s per day: cents below $1,000, whole dollars above (the early years) */
  var usd = function (v) { return "$" + nf(v, v >= 1000 ? 0 : 2); };
  /* Bitcoin per PH/s per day: to the satoshi below 1 BTC */
  var btc = function (v) { return nf(v, v >= 100 ? 2 : v >= 1 ? 4 : 8); };
  /* significant digits without exponent notation */
  var sig = function (v, n) {
    if (!pos(v)) return "0";
    var e = Math.floor(Math.log10(v));
    return v.toFixed(Math.min(20, Math.max(0, n - 1 - e)));
  };
  /* a percentage that never rounds to a false 100%: a fall beyond 99.99% (the full history)
     reads as such */
  var pct = function (v) {
    var a = Math.abs(v);
    if (v < 0 && a > 99.99) return "Down more than 99.99%";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(a, v < 0 && a >= 99.95 ? 2 : 1) + "%";
  };
  var dayOf = function (d) { return new Date(d * MS); };
  var longDate = function (d) { var x = dayOf(d); return x.getUTCDate() + " " + MON[x.getUTCMonth()] + " " + x.getUTCFullYear(); };
  var isoDate = function (d) { return dayOf(d).toISOString().slice(0, 10); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* a slot on this page: [data-hx="key"]; "Unavailable" marks it with [data-na] */
  var put = function (key, html) {
    $$('[data-hx="' + key + '"]').forEach(function (el) {
      el.innerHTML = html;
      if (html === NA) el.setAttribute("data-na", ""); else el.removeAttribute("data-na");
    });
  };

  /* JSON from mempool.space, or null on any failure; history payloads get a longer timeout */
  var getJSON = function (path, ms) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    return fetch(API + path, { signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .catch(function () { clearTimeout(timer); return null; });
  };

  /* 1 Live extras ─────────────────────────────────────────────────────── */
  function liveExtras(s) {
    var blocks = s && pos(s.blocks) ? s.blocks : null;
    var perBlock = blocks && pos(s.paid) ? s.paid / blocks : null;
    var fees = blocks && fin(s.fees) && s.fees >= 0 ? s.fees / blocks : null;
    var subsidy = perBlock !== null && fees !== null ? perBlock - fees : null;
    var ph = s && pos(s.hashrate) ? s.hashrate / 1e15 : null;
    var price = s && pos(s.price) ? s.price : null;
    var perPh = perBlock !== null && ph ? 144 * perBlock / ph : null;
    put("btc", perPh ? btc(perPh) : NA);
    put("subsidy", subsidy !== null && subsidy > 0 ? nf(subsidy, 3) + "<small>BTC</small>" : NA);
    put("fees", fees !== null ? sig(fees, 4) + "<small>BTC</small>" : NA);
    put("phSub", "Seven-day estimate" + (ph ? ", " + nf(ph, 0) + " PH/s" : ""));
    if (perPh && price && subsidy !== null && fees !== null) {
      put("work", '144 &times; (' + nf(subsidy, 3) + ' + ' + sig(fees, 4) + ') BTC <span class="op">&divide;</span> ' + nf(ph, 0) +
        ' PH/s <span class="op">&times;</span> $' + nf(price, 0) + ' <span class="op">=</span> <b>' + usd(perPh * price) + '</b>');
    } else put("work", NA);
    maybeRefresh();
  }

  /* 2 History ─────────────────────────────────────────────────────────── */
  var rows = null, loading = false, lastTry = 0, failed = false;

  function build(hr, rw, px) {
    if (!hr || !Array.isArray(hr.hashrates) || !Array.isArray(rw) || !px || !Array.isArray(px.prices)) return null;
    var H = {}, R = {}, Rn = {};
    hr.hashrates.forEach(function (x) {
      /* only the daily values stamped at midnight; each covers the day before its stamp */
      if (x && fin(x.timestamp) && x.timestamp % DAY === 0 && pos(x.avgHashrate)) H[x.timestamp / DAY - 1] = x.avgHashrate;
    });
    rw.forEach(function (x) {
      if (!x || !fin(x.timestamp) || !pos(x.avgRewards)) return;
      var d = Math.floor(x.timestamp / DAY);
      R[d] = (R[d] || 0) + x.avgRewards; Rn[d] = (Rn[d] || 0) + 1;
    });
    var pts = px.prices.filter(function (p) { return p && fin(p.time) && pos(p.USD); })
      .map(function (p) { return [p.time, p.USD]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length) return null;
    var sum = {}, cnt = {};
    pts.forEach(function (p) { var d = Math.floor(p[0] / DAY); sum[d] = (sum[d] || 0) + p[1]; cnt[d] = (cnt[d] || 0) + 1; });
    var first = Math.floor(pts[0][0] / DAY), last = Math.floor(pts[pts.length - 1][0] / DAY);
    var out = [], j = 0;
    for (var d = first; d <= last; d++) {
      if (!H[d] || !R[d]) continue;
      var price;
      if (cnt[d]) price = sum[d] / cnt[d];
      else {
        /* no point on this day: interpolate at noon UTC between the points either side */
        var t = d * DAY + DAY / 2;
        while (j < pts.length - 1 && pts[j + 1][0] < t) j++;
        var a = pts[j], b = pts[j + 1];
        if (!b || a[0] > t) continue;
        price = a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
      }
      var reward = R[d] / Rn[d] / 1e8, perPh = 144 * reward / (H[d] / 1e15);
      if (!pos(price) || !pos(perPh)) continue;
      out.push({ d: d, usd: perPh * price, btc: perPh, reward: reward, eh: H[d] / 1e18, price: price });
    }
    if (out.length <= 31) return null;
    /* the trailing 7-day average, only over seven consecutive days */
    for (var i = 6; i < out.length; i++) {
      if (out[i].d - out[i - 6].d !== 6) continue;
      var su = 0, sb = 0;
      for (var k = i - 6; k <= i; k++) { su += out[k].usd; sb += out[k].btc; }
      out[i].usd7 = su / 7; out[i].btc7 = sb / 7;
    }
    return out;
  }

  function loadHistory() {
    if (loading) return;
    loading = true; lastTry = Date.now();
    if (!rows) chartState("wait");
    Promise.all([
      getJSON("/v1/mining/hashrate/all", 30000),
      getJSON("/v1/mining/blocks/rewards/all", 30000),
      getJSON("/v1/historical-price?currency=USD", 30000)
    ]).then(function (r) {
      loading = false;
      var next = build(r[0], r[1], r[2]);
      if (next) { rows = next; failed = false; changes(); chart.set(rows); csvReady(); }
      else if (!rows) { failed = true; changes(); chartState("down"); }
    });
  }

  /* a closed day becomes available after each UTC midnight: reload then, at most every 30
     minutes; after a failure, try again at most every 5 minutes. Called on each live tick, so it
     only runs while the page is visible. */
  function maybeRefresh() {
    var now = Date.now(), today = Math.floor(now / MS);
    if (loading) return;
    if (rows && rows[rows.length - 1].d < today - 1 && now - lastTry > 30 * 6e4) loadHistory();
    else if (failed && now - lastTry > 5 * 6e4) loadHistory();
  }

  /* 3 Changes ─────────────────────────────────────────────────────────── */
  var TRI = '<svg class="tri" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.6L9 8.4H1z"/></svg>';
  function changes() {
    var at = function (d) { for (var i = rows.length - 1; i >= 0 && rows[i].d >= d; i--) if (rows[i].d === d) return rows[i]; return null; };
    var show = function (key, ref, last) {
      var el = $$('[data-hx="' + key + '"]');
      if (!ref) { put(key, NA); el.forEach(function (e) { e.parentNode.removeAttribute("data-dir"); }); return; }
      var v = (last.usd / ref.usd - 1) * 100, dir = v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
      put(key, (dir === "flat" ? "" : TRI) + '<span>' + pct(v) + '</span>');
      el.forEach(function (e) { e.parentNode.setAttribute("data-dir", dir); });
    };
    var list = $(".hx-chg");
    if (!rows) { if (list) list.hidden = true; put("chgNote", "Changes in the daily index are unavailable just now."); return; }
    var last = rows[rows.length - 1], r1 = at(last.d - 1), r30 = at(last.d - 30);
    show("chg1", r1, last);
    show("chg30", r30, last);
    /* only a change that can be computed is shown */
    $$(".hx-chg > div").forEach(function (d) { d.hidden = !!$("[data-na]", d) || d.querySelector("dd").hasAttribute("data-na"); });
    if (list) list.hidden = !r1 && !r30;
    put("chgNote", "Changes compare daily values: " + longDate(last.d) + " with the day before and with 30 days before.");
  }

  /* 4 Chart ───────────────────────────────────────────────────────────── */
  /* the four halvings so far, by block height and the UTC day of that block */
  var HALVINGS = [
    { h: 210000, d: Date.UTC(2012, 10, 28) / MS },
    { h: 420000, d: Date.UTC(2016, 6, 9) / MS },
    { h: 630000, d: Date.UTC(2020, 4, 11) / MS },
    { h: 840000, d: Date.UTC(2024, 3, 20) / MS }
  ];
  var RANGES = { "3m": 3, "6m": 6, "1y": 12, "2y": 24, "3y": 36, "all": 0 };

  var chartEl = $("[data-hx-chart]");
  var chart = (function () {
    if (!chartEl) return { set: function () {} };
    var plot = $(".hx-plot", chartEl), svg = $("svg", plot), msg = $(".hx-msg", chartEl);
    var readD = $('[data-hx="readDate"]', chartEl), readV = $('[data-hx="readValue"]', chartEl), readO = $('[data-hx="readOther"]', chartEl), readA = $('[data-hx="readAvg"]', chartEl);
    var summary = $("#hxSummary"), caption = $('[data-hx="caption"]', chartEl);
    var st = { range: "1y", unit: "usd", all: null, view: null, i: -1, geo: null, active: false };
    /* a link can open a range or a unit: ?range=3m|6m|1y|2y|3y|all and ?unit=usd|btc */
    var q = window.location.search;
    var qr = /[?&]range=(3m|6m|1y|2y|3y|all)(&|$)/.exec(q), qu = /[?&]unit=(usd|btc)(&|$)/.exec(q);
    if (qr) st.range = qr[1];
    if (qu) st.unit = qu[1];
    var press = function () {
      $$("[data-hx-range]", chartEl).forEach(function (o) { o.setAttribute("aria-pressed", o.getAttribute("data-hx-range") === st.range ? "true" : "false"); });
      $$("[data-hx-unit]", chartEl).forEach(function (o) { o.setAttribute("aria-pressed", o.getAttribute("data-hx-unit") === st.unit ? "true" : "false"); });
    };
    press();
    var NS = "http://www.w3.org/2000/svg";

    /* the first day of a range: the same calendar day, N months before the last day */
    var startOf = function (range, last) {
      var m = RANGES[range];
      if (!m) return st.all[0].d;
      var x = dayOf(last);
      return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - m, x.getUTCDate()) / MS;
    };
    var val = function (r) { return st.unit === "usd" ? r.usd : r.btc; };
    var avg = function (r) { return st.unit === "usd" ? r.usd7 : r.btc7; };
    var fmtV = function (v) { return st.unit === "usd" ? usd(v) : btc(v) + " BTC"; };

    /* nice linear ticks from zero */
    function linTicks(max, count) {
      var raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
      var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
      var top = Math.ceil(max * 1.06 / step) * step, t = [];
      for (var v = 0; v <= top + step / 2; v += step) t.push(v);
      return { top: top, ticks: t, step: step };
    }
    /* a tick label: compact for big values, enough decimals for small ones */
    function tickLabel(v, step) {
      var pre = st.unit === "usd" ? "$" : "";
      if (v === 0) return pre + "0";
      if (v >= 1e9) return pre + nf(v / 1e9, 0) + "B";
      if (v >= 1e6) return pre + nf(v / 1e6, 0) + "M";
      if (v >= 1e3 && v % 1e3 === 0) return pre + nf(v / 1e3, 0) + "K";
      if (v >= 1) return pre + nf(v, step && step < 1 ? 1 : 0);
      var dec = Math.max(1, Math.ceil(-Math.log10(step || v)) + ((step || v).toPrecision(2).indexOf("5") > -1 ? 1 : 0));
      return pre + v.toFixed(Math.min(10, dec));
    }

    function draw() {
      if (!st.view) return;
      var W = Math.round(plot.clientWidth), H = Math.round(plot.clientHeight);
      if (W < 50 || H < 50) return;
      var narrow = W < 600;
      var m = { l: 0, r: narrow ? 50 : 64, t: 30, b: 30 };
      var pw = W - m.l - m.r, ph = H - m.t - m.b, base = m.t + ph;
      var v = st.view, n = v.length, d0 = v[0].d, d1 = v[n - 1].d;
      var min = Infinity, max = -Infinity;
      v.forEach(function (r) { var x = val(r); if (x < min) min = x; if (x > max) max = x; });
      /* a linear scale from zero, unless the range spans more than a factor of 20 (the full
         history covers several orders of magnitude): then a log scale, labelled as such */
      var log = max / min > 20, y, ticks = [], step = 0;
      if (log) {
        var lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
        if (hi === lo) hi++;
        var every = Math.max(1, Math.ceil((hi - lo) / (narrow ? 5 : 7)));
        for (var k = lo; k <= hi; k += every) ticks.push(Math.pow(10, k));
        y = function (x) { return m.t + ph * (1 - (Math.log10(x) - lo) / (hi - lo)); };
      } else {
        var lt = linTicks(max, narrow ? 4 : 5);
        ticks = lt.ticks; step = lt.step;
        y = function (x) { return m.t + ph * (1 - x / lt.top); };
      }
      var x = function (d) { return m.l + (d1 === d0 ? pw : (d - d0) / (d1 - d0) * pw); };
      st.geo = { x: x, y: y, m: m, pw: pw, ph: ph, base: base, d0: d0, d1: d1, log: log };

      var s = "";
      s += '<defs><linearGradient id="hxFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6bff" stop-opacity=".16"/><stop offset="1" stop-color="#2f6bff" stop-opacity="0"/></linearGradient></defs>';
      /* horizontal grid and value labels in the right-hand gutter */
      s += '<g class="hx-grid">';
      ticks.forEach(function (t) {
        var ty = Math.round(y(t)) + 0.5;
        if (ty < m.t - 1 || ty > base + 1) return;
        s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + ty + '" y2="' + ty + '"' + (t === 0 ? ' class="b"' : "") + '/>';
        s += '<text x="' + (W - 2) + '" y="' + ty + '" dy=".34em" text-anchor="end">' + esc(tickLabel(t, step)) + '</text>';
      });
      if (log) s += '<line class="b" x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + (base + 0.5) + '" y2="' + (base + 0.5) + '"/>';
      s += '</g>';
      /* time labels: months or years, aligned to round months */
      var a0 = dayOf(d0), a1 = dayOf(d1);
      var mi0 = a0.getUTCFullYear() * 12 + a0.getUTCMonth(), mi1 = a1.getUTCFullYear() * 12 + a1.getUTCMonth();
      var target = Math.max(2, Math.floor(pw / (narrow ? 74 : 104))), stepM = 48;
      [1, 2, 3, 6, 12, 24, 48].some(function (c) { if ((mi1 - mi0) / c <= target) { stepM = c; return true; } return false; });
      s += '<g class="hx-time">';
      var firstTick = true, lastRight = -Infinity, carryYear = false;
      for (var mi = mi0; mi <= mi1 + 1; mi++) {
        if (mi % stepM) continue;
        var yr = Math.floor(mi / 12), mo = mi % 12, td = Date.UTC(yr, mo, 1) / MS;
        if (td < d0 || td > d1) continue;
        /* month labels carry the year in January and on the first label, and on the next label
           shown when one that carried it had to be dropped for space */
        var withYear = stepM < 12 && (mo === 0 || firstTick || carryYear);
        var tx = x(td), label = stepM >= 12 ? String(yr) : MON[mo] + (withYear ? " " + yr : "");
        var w = label.length * 6.4, anchor = "middle", left = tx - w / 2;
        if (left < 0) { anchor = "start"; left = tx; } else if (tx + w / 2 > m.l + pw) { anchor = "end"; left = tx - w; }
        if (left < lastRight + 12) { if (withYear) carryYear = true; continue; }
        lastRight = left + w;
        if (withYear) carryYear = false;
        s += '<line x1="' + (Math.round(tx) + 0.5) + '" x2="' + (Math.round(tx) + 0.5) + '" y1="' + base + '" y2="' + (base + 5) + '"/>';
        s += '<text x="' + tx.toFixed(1) + '" y="' + (base + 20) + '" text-anchor="' + anchor + '">' + label + '</text>';
        firstTick = false;
      }
      s += '</g>';
      /* halvings inside the range, a solid hairline and a label at the top */
      s += '<g class="hx-halv">';
      HALVINGS.forEach(function (hv) {
        if (hv.d <= d0 || hv.d >= d1) return;
        var hx = Math.round(x(hv.d)) + 0.5, right = hx > m.l + pw - 70;
        s += '<line x1="' + hx + '" x2="' + hx + '" y1="' + (m.t - 8) + '" y2="' + base + '"/>';
        s += '<text x="' + (right ? hx - 6 : hx + 6) + '" y="' + (m.t - 12) + '" text-anchor="' + (right ? "end" : "start") + '">Halving</text>';
      });
      s += '</g>';
      /* the daily line, then the 7-day average over it with a light fill beneath */
      var p = "", pa = "", a0x = null;
      for (var i = 0; i < n; i++) {
        var px = x(v[i].d).toFixed(1);
        p += (i ? "L" : "M") + px + " " + y(val(v[i])).toFixed(1);
        if (avg(v[i])) { pa += (a0x === null ? "M" : "L") + px + " " + y(avg(v[i])).toFixed(1); if (a0x === null) a0x = px; }
      }
      if (pa) s += '<path class="hx-area" d="' + pa + "L" + x(d1).toFixed(1) + " " + base + "L" + a0x + " " + base + 'Z"/>';
      s += '<path class="hx-day" d="' + p + '"/>';
      if (pa) s += '<path class="hx-line" d="' + pa + '"/>';
      /* the cursor, moved by the pointer or the keys */
      s += '<g class="hx-cur"><line y1="' + m.t + '" y2="' + base + '"/><circle r="4.5"/></g>';
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("width", W); svg.setAttribute("height", H);
      svg.innerHTML = s;
      if (caption) caption.textContent = "Daily, " + longDate(d0) + " to " + longDate(d1) + " (UTC)" + (log ? ". Log scale" : "");
      cursor(st.i, false);
    }

    /* place the cursor on day index i of the view and update the readout */
    function cursor(i, announce) {
      if (!st.view || !st.geo) return;
      var v = st.view, g = st.geo;
      i = Math.max(0, Math.min(v.length - 1, i));
      st.i = i;
      var r = v[i], cx = g.x(r.d), cy = g.y(val(r));
      var cur = $(".hx-cur", svg);
      if (cur) {
        cur.setAttribute("transform", "translate(" + cx.toFixed(1) + " 0)");
        $("circle", cur).setAttribute("cy", cy.toFixed(1));
        cur.classList.toggle("on", st.active || i !== v.length - 1);
      }
      var main = st.unit === "usd" ? usd(r.usd) : btc(r.btc) + " BTC";
      var other = st.unit === "usd" ? btc(r.btc) + " BTC" : usd(r.usd);
      if (readD) readD.textContent = (i === v.length - 1 ? "Latest day, " : "") + longDate(r.d);
      if (readV) readV.textContent = main;
      if (readO) readO.textContent = other;
      if (readA) readA.textContent = avg(r) ? "7-day average " + (st.unit === "usd" ? usd(avg(r)) : btc(avg(r)) + " BTC") : "";
      plot.setAttribute("aria-valuenow", String(i));
      plot.setAttribute("aria-valuetext", longDate(r.d) + ": " + usd(r.usd) + " per PH/s per day, " + btc(r.btc) + " BTC per PH/s per day" +
        (avg(r) ? ", 7-day average " + (st.unit === "usd" ? usd(avg(r)) : btc(avg(r)) + " BTC") : ""));
    }

    function stats() {
      var v = st.view, hiR = v[0], loR = v[0], sum = 0;
      v.forEach(function (r) { var x = val(r); if (x > val(hiR)) hiR = r; if (x < val(loR)) loR = r; sum += x; });
      var first = v[0], last = v[v.length - 1];
      put("hi", fmtV(val(hiR)) + "<small>" + longDate(hiR.d) + "</small>");
      put("lo", fmtV(val(loR)) + "<small>" + longDate(loR.d) + "</small>");
      put("avg", fmtV(sum / v.length) + "<small>Mean of " + nf(v.length, 0) + " daily values</small>");
      put("chg", pct((val(last) / val(first) - 1) * 100) + "<small>" + longDate(first.d) + " to " + longDate(last.d) + "</small>");
      if (summary) summary.textContent = "Chart of the Omnes Hashprice Index in " + (st.unit === "usd" ? "US dollars" : "Bitcoin") + " per PH/s per day, daily from " +
        longDate(first.d) + " to " + longDate(last.d) + ". Latest " + fmtV(val(last)) + ". High " + fmtV(val(hiR)) + " on " + longDate(hiR.d) +
        ", low " + fmtV(val(loR)) + " on " + longDate(loR.d) + ". Use the left and right arrow keys to move a day, Page Down and Page Up to move 30 days back or forward, and Home and End for the first and last day.";
    }

    function view() {
      var all = st.all, last = all[all.length - 1].d, from = startOf(st.range, last), lo = 0;
      while (lo < all.length && all[lo].d < from) lo++;
      st.view = all.slice(lo);
      st.i = st.view.length - 1;
      plot.setAttribute("aria-valuemin", "0");
      plot.setAttribute("aria-valuemax", String(st.view.length - 1));
      plot.setAttribute("aria-label", "Omnes Hashprice Index, daily, " + (st.unit === "usd" ? "US dollars" : "Bitcoin") + " per PH/s per day");
      stats();
      draw();
    }

    /* the range and unit controls: toggle buttons (aria-pressed) */
    $$("[data-hx-range]", chartEl).forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.disabled || !st.all) return;
        st.range = b.getAttribute("data-hx-range");
        press();
        view();
      });
    });
    $$("[data-hx-unit]", chartEl).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!st.all) return;
        st.unit = b.getAttribute("data-hx-unit");
        press();
        var keep = st.i; view(); cursor(keep, false);
      });
    });

    /* pointer: the nearest day to the pointer. A mouse leaving the plot returns to the latest
       day. On a touch screen a tap (or a sideways drag) keeps its day after the finger lifts,
       until the next tap on the plot or a tap outside it; if the browser takes the touch over to
       scroll the page, the readout goes back to what it showed before the touch. */
    var fromPointer = function (e) {
      if (!st.geo) return;
      var rc = plot.getBoundingClientRect(), g = st.geo;
      var t = (e.clientX - rc.left - g.m.l) / g.pw, d = g.d0 + Math.round(Math.max(0, Math.min(1, t)) * (g.d1 - g.d0));
      var v = st.view, lo = 0, hi = v.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (v[mid].d < d) lo = mid + 1; else hi = mid; }
      st.active = true;
      cursor(lo, false);
    };
    var isMouse = function (e) { return !e.pointerType || e.pointerType === "mouse"; };
    var latest = function () { st.active = false; if (st.view) cursor(st.view.length - 1, false); };
    var before = null, tap = null;
    plot.addEventListener("pointermove", fromPointer);
    plot.addEventListener("pointerdown", function (e) {
      before = isMouse(e) ? null : { i: st.i, active: st.active };
      fromPointer(e);
    });
    plot.addEventListener("pointerup", function () { before = null; });
    plot.addEventListener("pointercancel", function (e) {
      if (isMouse(e) || !before || !st.view) return;
      st.active = before.active; cursor(before.i, false); before = null;
    });
    plot.addEventListener("pointerleave", function (e) { if (isMouse(e) && doc.activeElement !== plot) latest(); });
    /* a tap outside the plot returns to the latest day; a scroll that starts outside it does not */
    doc.addEventListener("pointerdown", function (e) {
      tap = !isMouse(e) && st.active && !plot.contains(e.target) ? { x: e.clientX, y: e.clientY, at: Date.now() } : null;
    });
    doc.addEventListener("pointercancel", function () { tap = null; });
    doc.addEventListener("pointerup", function (e) {
      if (!tap) return;
      var moved = Math.abs(e.clientX - tap.x) + Math.abs(e.clientY - tap.y), quick = Date.now() - tap.at < 700;
      tap = null;
      if (moved >= 12 || !quick || !st.active) return;
      if (doc.activeElement === plot) plot.blur(); else latest();
    });
    plot.addEventListener("focus", function () { st.active = true; cursor(st.i, false); });
    plot.addEventListener("blur", function () { st.active = false; if (st.view) cursor(st.view.length - 1, false); });
    plot.addEventListener("keydown", function (e) {
      if (!st.view) return;
      var i = st.i, n = st.view.length;
      switch (e.key) {
        case "ArrowLeft": case "ArrowDown": i -= 1; break;
        case "ArrowRight": case "ArrowUp": i += 1; break;
        case "PageUp": i += 30; break;
        case "PageDown": i -= 30; break;
        case "Home": i = 0; break;
        case "End": i = n - 1; break;
        default: return;
      }
      e.preventDefault();
      st.active = true;
      cursor(i, true);
    });

    var timer = 0;
    if ("ResizeObserver" in window) new ResizeObserver(function () { clearTimeout(timer); timer = setTimeout(draw, 80); }).observe(plot);
    else window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(draw, 80); });

    return {
      set: function (all) {
        var first = st.all === null;
        st.all = all;
        /* a range is offered only when the data reaches back that far */
        $$("[data-hx-range]", chartEl).forEach(function (b) {
          var r = b.getAttribute("data-hx-range"), ok = !RANGES[r] || startOf(r, all[all.length - 1].d) >= all[0].d;
          b.disabled = !ok;
          if (!ok && st.range === r) { st.range = "1y"; press(); }
        });
        chartEl.classList.remove("is-wait", "is-down");
        plot.setAttribute("role", "slider");
        plot.setAttribute("tabindex", "0");
        plot.setAttribute("aria-describedby", "hxSummary");
        if (msg) msg.textContent = "";
        if (first || !st.view) view(); else { var keepLatest = st.i === st.view.length - 1; view(); if (!keepLatest) cursor(st.i, false); }
      },
      state: function (s) {
        chartEl.classList.toggle("is-wait", s === "wait");
        chartEl.classList.toggle("is-down", s === "down");
        if (msg) msg.textContent = s === "down" ? "The daily history is unavailable just now: mempool.space could not be reached." : "Loading the daily history from mempool.space";
        if (s === "down") ["hi", "lo", "avg", "chg"].forEach(function (k) { put(k, NA); });
      }
    };
  })();
  function chartState(s) { if (chart.state) chart.state(s); }

  /* 5 CSV ─────────────────────────────────────────────────────────────── */
  var csvBtn = $("[data-hx-csv]");
  function csvReady() { if (csvBtn) csvBtn.disabled = !rows; var n = $('[data-hx="csvNote"]'); if (n && rows) n.textContent = "The CSV holds the full daily series, " + longDate(rows[0].d) + " to " + longDate(rows[rows.length - 1].d) + ", one row per UTC day."; }
  if (csvBtn) csvBtn.addEventListener("click", function () {
    if (!rows) return;
    var lines = ["date,usd_per_ph_day,btc_per_ph_day,avg_reward_btc_per_block,hashrate_eh_s,price_usd"];
    rows.forEach(function (r) {
      lines.push([isoDate(r.d), r.usd.toFixed(4), sig(r.btc, 10), r.reward.toFixed(8), sig(r.eh, 10), r.price >= 1 ? r.price.toFixed(2) : sig(r.price, 6)].join(","));
    });
    var blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    var a = doc.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "omnes-hashprice-index-daily-" + isoDate(rows[rows.length - 1].d) + ".csv";
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });

  /* start ─────────────────────────────────────────────────────────────── */
  /* site.js calls every subscriber after each poll. A very fast first failure (offline) can
     resolve before this file subscribes, so if the status dot already reads down, or nothing
     has arrived 15 seconds in (site.js gives up at 12), mark the extras Unavailable. site.js only
     polls while the page is visible, so in a background tab the 15 seconds start when it is shown. */
  var heard = false;
  if (O.live && O.live.subscribe) O.live.subscribe(function (s) { heard = true; liveExtras(s); });
  var dotDown = $("[data-live-dot]");
  if (!heard && dotDown && dotDown.classList.contains("down")) liveExtras({});
  var giveUp = function () { setTimeout(function () { if (!heard) liveExtras({}); }, 15000); };
  if (!doc.hidden) giveUp();
  else doc.addEventListener("visibilitychange", function shown() {
    if (doc.hidden) return;
    doc.removeEventListener("visibilitychange", shown);
    giveUp();
  });
  loadHistory();
})();
