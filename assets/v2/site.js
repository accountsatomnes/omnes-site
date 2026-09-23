/* Omnes marketing system: shared behaviour.

   Index
   01  Helpers         $, $$, store (sessionStorage), reduced-motion flag, formatters
   02  Shell           capsule nav (scrolled state, menu sheet), access gate, reveal on scroll,
                       product annotations (numbered notes light their pins)
   03  Live data       Omnes.live: mempool.space network figures bound to [data-live] slots,
                       polled at most once a minute and only while the page is visible; it
                       starts only on a page with [data-live] slots (not the homepage)
   04  Loop            one requestAnimationFrame loop for every canvas field; paused when
                       offscreen or hidden, a single static frame under reduced motion
   05  Fields          Omnes.fields: "hashrate-wave" (data-driven particle wave, used by
                       partials/network-pays.html), "mark" (the Omnes mark drawn in dots),
                       "accrue" (points gathering along the note's term line, partials/note.html), "swell" (a
                       particle horizon drawn in the canvas's CSS color)
   05b Structure       the structure diagram (partials/structure.html; inert without [data-sx]):
                       links measured from the nodes' dots, a particle flow along the note's
                       line, and nodes that light their links
   06  Boot            mounts every [data-field] and every [data-sx] diagram on the page

   Markup contracts
   [data-live="price|hashrate|hashrateText|paid|paidUsd|hashprice|height|adjustment|updated"]
                                           a slot gets [data-na] while its figure is unavailable
   [data-live-status] [data-live-dot]      status text and dot for the live figures
   [data-wave-status] [data-wave-dot]      status text and dot for the hashrate history
   <canvas data-field="hashrate-wave|mark|accrue|swell">
   [data-sx] > .sx-n[data-node] > .sx-b > .sx-dot, .sx-desc; [data-sx-cap]
                                           a structure diagram, its nodes and its caption line
   [data-pin="n"] and [data-anno="n"]      a numbered note and the pin it points to
*/
(function () {
  "use strict";

  /* 01 Helpers ───────────────────────────────────────────────────────── */
  var doc = document, root = doc.documentElement;
  root.classList.add("js");
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener: function () {} };
  var onReduceChange = function (fn) { if (reduce.addEventListener) reduce.addEventListener("change", fn); else if (reduce.addListener) reduce.addListener(fn); };
  var pad2 = function (v) { return (v < 10 ? "0" : "") + v; };
  var fmt = {
    n: function (v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
    usd: function (v, d) { return "$" + fmt.n(v, d || 0); },
    compactUsd: function (v) {
      if (v >= 1e12) return "$" + fmt.n(v / 1e12, 2) + "T";
      if (v >= 1e9) return "$" + fmt.n(v / 1e9, 2) + "B";
      if (v >= 1e6) return "$" + fmt.n(v / 1e6, 1) + "M";
      return fmt.usd(v, 0);
    },
    signed: function (v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "") + fmt.n(Math.abs(v), d); },
    utc: function (date) { return pad2(date.getUTCHours()) + ":" + pad2(date.getUTCMinutes()) + " UTC"; },
    esc: function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  };
  /* deterministic pseudo-random numbers, so every visit paints the same picture */
  var prng = function (seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  var gauss = function (rnd) { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var smooth = function (e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  var Omnes = window.Omnes = window.Omnes || {};
  Omnes.fmt = fmt;

  /* 02 Shell ─────────────────────────────────────────────────────────── */
  var nav = $(".nav");
  if (nav) {
    var navTick = false;
    var navState = function () { navTick = false; nav.classList.toggle("is-scrolled", (window.scrollY || window.pageYOffset) > 12); };
    window.addEventListener("scroll", function () { if (!navTick) { navTick = true; requestAnimationFrame(navState); } }, { passive: true });
    navState();
  }
  var menuBtn = $(".menu-btn"), menu = $("#menu");
  if (menuBtn && menu) {
    var setMenu = function (open, focusBack) {
      menu.hidden = !open;
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      if (open) { var first = $("a", menu); if (first) first.focus(); }
      else if (focusBack) menuBtn.focus();
    };
    menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) setMenu(false, true); });
    doc.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });
    window.addEventListener("resize", function () { if (window.innerWidth >= 900 && !menu.hidden) setMenu(false); });
  }

  /* access gate: the Terms of Access, shown until the visitor clicks "I Agree", then not again in
     this browser. Agreement persists in localStorage under the live site's key
     "omnes_access_agreed"; the earlier session flag "omnes_gate" is honoured too. As on the live
     gate, "I Agree" ships disabled in the markup and is enabled here once the script runs. It
     cannot be dismissed with Escape; "Leave" leaves the site. ?gate=1 shows it again for review.
     The head script has already set html.omnes-agreed or html.omnes-gate-pending before paint. */
  var local = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  var gate = $("#gate");
  var gateForced = /[?&]gate=1(&|$)/.test(window.location.search);
  var gateAgreed = !gateForced && !!(local.get("omnes_access_agreed") || store.get("omnes_gate"));
  if (gateAgreed || !gate) { root.classList.add("omnes-agreed"); root.classList.remove("omnes-gate-pending"); }
  if (gate && typeof gate.showModal === "function") {
    var agreeBtn = $("#btnAgree"), leave = $("#gateLeave"), agreedNow = false;
    var openGate = function () { if (!gate.open) gate.showModal(); root.classList.add("omnes-gate-open"); };
    gate.addEventListener("cancel", function (e) { e.preventDefault(); });
    gate.addEventListener("keydown", function (e) { if (e.key === "Escape" || e.key === "Esc") e.preventDefault(); });
    /* some browsers close a modal on a repeated Escape regardless; reopen it until agreed */
    gate.addEventListener("close", function () { if (!agreedNow && !gateAgreed) openGate(); });
    if (agreeBtn) {
      agreeBtn.disabled = false;
      agreeBtn.addEventListener("click", function () {
        agreedNow = true;
        local.set("omnes_access_agreed", "1");
        store.set("omnes_gate", "1");
        root.classList.add("omnes-agreed");
        root.classList.remove("omnes-gate-pending", "omnes-gate-open");
        gate.close();
      });
    }
    if (leave) leave.addEventListener("click", function () { window.location.href = "about:blank"; });
    if (!gateAgreed) { openGate(); var gateScroll = $("#gateScroll"); if (gateScroll) gateScroll.scrollTop = 0; }
  } else root.classList.remove("omnes-gate-pending");

  /* product annotations: pointing at or focusing a numbered note lights its pin */
  $$("[data-anno]").forEach(function (item) {
    var n = item.getAttribute("data-anno"), pin = $('[data-pin="' + n + '"]');
    if (!pin) return;
    var on = function () { item.classList.add("is-on"); pin.classList.add("is-on"); };
    var off = function () { item.classList.remove("is-on"); pin.classList.remove("is-on"); };
    item.addEventListener("mouseenter", on); item.addEventListener("mouseleave", off);
    item.addEventListener("focusin", on); item.addEventListener("focusout", off);
  });

  /* reveal on scroll */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); rio.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { rio.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add("in-view"); });

  /* 03 Live data ─────────────────────────────────────────────────────── */
  var API = "https://mempool.space/api";
  var getJSON = function (path) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    return fetch(API + path, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .catch(function () { clearTimeout(timer); return null; });
  };
  var live = Omnes.live = (function () {
    var subs = [], last = null, lastOk = 0, busy = false;
    var num = function (v) { return typeof v === "number" && isFinite(v); };
    function snapshot(r) {
      var s = { time: new Date() };
      var prices = r[0], hr = r[1], rw = r[2], adj = r[3], tip = r[4];
      s.price = prices && num(prices.USD) && prices.USD > 0 ? prices.USD : null;
      s.hashrate = hr && num(hr.currentHashrate) && hr.currentHashrate > 0 ? hr.currentHashrate : null;
      s.difficulty = hr && num(hr.currentDifficulty) && hr.currentDifficulty > 0 ? hr.currentDifficulty : null;
      if (rw && rw.totalReward != null) {
        var blocks = rw.endBlock - rw.startBlock + 1;
        s.blocks = blocks > 0 ? blocks : null;
        s.paid = Number(rw.totalReward) / 1e8;
        s.fees = Number(rw.totalFee) / 1e8;
        if (!(s.paid > 0)) s.paid = null;
      }
      s.hashprice = s.paid && s.blocks && s.hashrate && s.price ? (s.paid / s.blocks) * 144 / (s.hashrate / 1e15) * s.price : null;
      s.height = num(tip) && tip > 0 ? tip : null;
      if (adj && num(adj.difficultyChange)) s.adj = { change: adj.difficultyChange, blocks: adj.remainingBlocks, at: adj.estimatedRetargetDate };
      s.ok = !!(s.price || s.hashrate || s.paid || s.height);
      return s;
    }
    var NA = "Unavailable";
    var put = function (key, html) {
      $$('[data-live="' + key + '"]').forEach(function (el) {
        el.innerHTML = html;
        if (html === NA) el.setAttribute("data-na", ""); else el.removeAttribute("data-na");
      });
    };
    function bind(s) {
      put("price", s.price ? fmt.usd(s.price) : NA);
      put("hashrate", s.hashrate ? fmt.n(s.hashrate / 1e18) + "<small>EH/s</small>" : NA);
      put("hashrateText", s.hashrate ? fmt.n(s.hashrate / 1e18) + " EH/s" : NA);
      put("paid", s.paid ? fmt.n(s.paid, 1) + "<small>BTC</small>" : NA);
      put("paidUsd", s.paid && s.price ? fmt.compactUsd(s.paid * s.price) : NA);
      put("hashprice", s.hashprice ? fmt.usd(s.hashprice, 2) : NA);
      put("height", s.height ? fmt.n(s.height) : NA);
      if (s.adj) {
        var days = s.adj.at ? Math.max(0, (s.adj.at - Date.now()) / 864e5) : null;
        put("adjustment", fmt.signed(s.adj.change, 2) + "%" + (days !== null ? " in about " + (days < 1.5 ? "1 day" : fmt.n(days) + " days") : ""));
      } else put("adjustment", NA);
      put("updated", s.ok ? fmt.utc(s.time) : NA);
      var text = s.ok ? "Live from mempool.space, updated " + fmt.utc(s.time) : "Unavailable. mempool.space could not be reached.";
      if (!s.ok && lastOk) text = "Unavailable just now. Last updated " + fmt.utc(new Date(lastOk)) + ".";
      $$("[data-live-status]").forEach(function (el) { el.textContent = text; });
      $$("[data-live-dot]").forEach(function (el) { el.className = "dot" + (s.ok ? "" : " down"); });
    }
    function load() {
      if (busy) return;
      busy = true;
      Promise.all([getJSON("/v1/prices"), getJSON("/v1/mining/hashrate/3d"), getJSON("/v1/mining/reward-stats/144"), getJSON("/v1/difficulty-adjustment"), getJSON("/blocks/tip/height")])
        .then(function (r) {
          busy = false;
          var s = snapshot(r);
          if (s.ok) { last = s; lastOk = s.time.getTime(); }
          else if (last) { s = Object.assign({}, last, { ok: false, time: new Date() }); }
          bind(s);
          subs.forEach(function (fn) { try { fn(s); } catch (e) { /* a listener failed */ } });
        });
    }
    var started = false, stamp = 0;
    function start() {
      if (started) return; started = true;
      var tick = function () { if (!doc.hidden) { stamp = Date.now(); load(); } };
      tick();
      setInterval(tick, 60000);
      doc.addEventListener("visibilitychange", function () { if (!doc.hidden && Date.now() - stamp > 60000) tick(); });
    }
    return {
      start: start,
      subscribe: function (fn) { subs.push(fn); if (last) fn(last); },
      get: getJSON,
      latest: function () { return last; }
    };
  })();

  /* 04 Loop ──────────────────────────────────────────────────────────── */
  var loop = (function () {
    var fields = [], raf = 0, prev = 0;
    function frame(ts) {
      raf = 0;
      var dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 1 / 60;
      prev = ts;
      var running = false;
      fields.forEach(function (f) { if (f.visible && !doc.hidden && !reduce.matches) { f.t += dt; f.paint(); running = true; } });
      if (running) raf = requestAnimationFrame(frame); else prev = 0;
    }
    function kick() { if (!raf && !doc.hidden && !reduce.matches) raf = requestAnimationFrame(frame); }
    doc.addEventListener("visibilitychange", kick);
    onReduceChange(function () { fields.forEach(function (f) { f.paint(); }); kick(); });
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { var f = en.target.__field; if (f) { f.visible = en.isIntersecting; if (f.visible) f.paint(); } });
      kick();
    }, { rootMargin: "80px 0px" }) : null;
    return {
      add: function (f) { fields.push(f); f.canvas.__field = f; if (io) io.observe(f.canvas); else f.visible = true; kick(); },
      kick: kick
    };
  })();

  /* A canvas sized to its box at a device pixel ratio capped at 2 */
  function Field(canvas, draw) {
    this.canvas = canvas; this.g = canvas.getContext("2d"); this.draw = draw; this.t = 0; this.visible = false;
    this.resize();
    var self = this, timer = 0;
    var onResize = function () { clearTimeout(timer); timer = setTimeout(function () { self.resize(); }, 120); };
    if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(canvas);
    else window.addEventListener("resize", onResize);
  }
  Field.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    if (this.onResize) this.onResize();
    this.paint();
  };
  Field.prototype.paint = function () {
    var g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this.draw(g, this.t, this);
  };
  var dot = function (g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832); };

  /* 05 Fields ────────────────────────────────────────────────────────── */
  var fields = Omnes.fields = {};

  /* Network hashrate as a drifting particle wave. The centre line is the last twelve months
     of daily network hashrate from mempool.space (seven-day average), the cloud's thickness
     follows how much the daily figure moved around that average, and every particle drifts
     toward the present at the right-hand end. Without data the wave rests as a flat band. */
  fields["hashrate-wave"] = function (canvas, opts) {
    opts = opts || {};
    var rnd = prng(144), P = [], series = null, noise = null, status = opts.onStatus || function () {};
    /* three populations: a dense core that draws the line, a soft halo around it, and a few
       large, faint points in front for depth */
    var build = function (w) {
      var n = Math.round(clamp(w * 1.5, 620, 2300));
      P = [];
      for (var i = 0; i < n; i++) {
        var r = rnd(), kind = r < 0.64 ? 0 : r < 0.95 ? 1 : 2;
        P.push({ u: rnd(), s: gauss(rnd), z: rnd(), ph: rnd() * 6.2832, sp: 0.6 + rnd() * 0.8, k: kind });
      }
    };
    var at = function (arr, u) {
      var x = clamp(u, 0, 1) * (arr.length - 1), i = Math.floor(x), f = x - i;
      if (i >= arr.length - 1) return arr[arr.length - 1];
      var p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(arr.length - 1, i + 2)];
      var f2 = f * f, f3 = f2 * f; /* Catmull-Rom */
      return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
    };
    var STYLE = [
      { spread: 0.5, r: [0.55, 1.35], a: [0.3, 0.88], c: ["#174f7b", "#2f6bff"] },
      { spread: 1.35, r: [0.6, 1.9], a: [0.1, 0.45], c: ["#2f6bff", "#2f6bff"] },
      { spread: 2.1, r: [2.2, 4.4], a: [0.05, 0.14], c: ["#2f6bff", "#2f6bff"] }
    ];
    var f = new Field(canvas, function (g, t, F) {
      var W = F.w, H = F.h, sc = clamp(H / 420, 0.7, 1.2);
      var x0 = -W * 0.01, x1 = W - Math.max(64, W * 0.07);
      var top = H * 0.3, span = H * 0.34, mid = H * 0.5;
      var centre = function (u) { return series ? top + (1 - at(series, u)) * span : mid + Math.sin(u * 5.2 + t * 0.2) * H * 0.03; };
      var thick = function (u) { return (series ? 9 + at(noise, u) * 20 : 12) * sc; };
      var buckets = [[], [], [], [], [], []];
      for (var i = 0; i < P.length; i++) {
        var p = P[i], st = STYLE[p.k];
        var u = (p.u + t * 0.0035 * p.sp) % 1;
        var x = x0 + u * (x1 - x0);
        var y = centre(u) + p.s * thick(u) * st.spread + Math.sin(t * 0.5 + p.ph) * (0.8 + 2.2 * p.z) * sc;
        var fade = smooth(0, 0.12, u) * (1 - 0.5 * smooth(0.975, 1, u));
        var a = (st.a[0] + (st.a[1] - st.a[0]) * p.z) * fade;
        if (a < 0.015) continue;
        buckets[p.k * 2 + (p.z > 0.55 ? 1 : 0)].push(x, y, (st.r[0] + (st.r[1] - st.r[0]) * p.z * p.z) * sc, a);
      }
      for (var b = 0; b < buckets.length; b++) {
        var arr = buckets[b];
        g.fillStyle = STYLE[b >> 1].c[b & 1];
        for (var k = 0; k < arr.length; k += 4) { g.globalAlpha = arr[k + 3]; g.beginPath(); dot(g, arr[k], arr[k + 1], arr[k + 2]); g.fill(); }
      }
      g.globalAlpha = 1;
      if (series) { /* the present: a calm accent point with a slow halo */
        var yNow = centre(1), pulse = reduce.matches ? 0.5 : (Math.sin(t * 1.4) + 1) / 2;
        g.fillStyle = "rgba(47,107,255," + (0.08 + 0.08 * pulse) + ")";
        g.beginPath(); dot(g, x1, yNow, 11 + 7 * pulse); g.fill();
        g.fillStyle = "#ffffff"; g.beginPath(); dot(g, x1, yNow, 5.5); g.fill();
        g.fillStyle = "#2f6bff"; g.beginPath(); dot(g, x1, yNow, 3.6); g.fill();
      }
    });
    f.onResize = function () { build(f.w); };
    build(f.w);
    loop.add(f);
    status("wait");
    getJSON("/v1/mining/hashrate/1y").then(function (d) {
      var rows = d && d.hashrates ? d.hashrates.filter(function (p) { return p && p.avgHashrate > 0; }) : [];
      if (rows.length < 30) { status("down"); f.paint(); return; }
      var raw = rows.map(function (p) { return p.avgHashrate; });
      var ma = raw.map(function (v, i) { var a = Math.max(0, i - 7), b = Math.min(raw.length - 1, i + 7), s = 0; for (var q = a; q <= b; q++) s += raw[q]; return s / (b - a + 1); });
      var lo = Math.min.apply(null, ma), hi = Math.max.apply(null, ma), rng = hi - lo || 1;
      series = ma.map(function (v) { return (v - lo) / rng; });
      var dev = raw.map(function (v, i) { return Math.abs(v - ma[i]) / rng; });
      var dm = dev.map(function (v, i) { var a = Math.max(0, i - 8), b = Math.min(dev.length - 1, i + 8), s = 0; for (var q = a; q <= b; q++) s += dev[q]; return s / (b - a + 1); });
      var dmax = Math.max.apply(null, dm) || 1;
      noise = dm.map(function (v) { return v / dmax; });
      status("ok", rows);
      f.paint();
    });
    return f;
  };

  /* The Omnes mark drawn in dots: two concentric arcs split by a level gap, traced with a
     slow travelling light. Geometry from the favicon: outer radius 100, inner 70, gap 15.3. */
  fields.mark = function (canvas) {
    var shape = function (sign) {
      var R = 100, r = 70, gp = 15.3, pts = [], a = Math.asin(gp / R), b = Math.asin(gp / r), i, n;
      var push = function (x, y) { pts.push([x, y * sign]); };
      n = 90; for (i = 0; i <= n; i++) { var t1 = Math.PI + a + (Math.PI - 2 * a) * i / n; push(R * Math.cos(t1), R * Math.sin(t1)); }
      var xo = R * Math.cos(a), xi = r * Math.cos(b);
      n = 6; for (i = 1; i < n; i++) push(xo + (xi - xo) * i / n, -gp);
      n = 64; for (i = 0; i <= n; i++) { var t2 = 2 * Math.PI - b - (Math.PI - 2 * b) * i / n; push(r * Math.cos(t2), r * Math.sin(t2)); }
      n = 6; for (i = 1; i < n; i++) push(-xi + (xi - xo) * i / n, -gp);
      return pts;
    };
    /* space the points of each outline evenly */
    var even = function (poly, step) {
      var out = [poly[0]], acc = 0;
      for (var i = 1; i < poly.length; i++) {
        var ax = poly[i - 1][0], ay = poly[i - 1][1], bx = poly[i][0], by = poly[i][1], d = Math.hypot(bx - ax, by - ay), s = step - acc;
        while (s <= d) { out.push([ax + (bx - ax) * s / d, ay + (by - ay) * s / d]); s += step; }
        acc = (acc + d) % step;
      }
      return out;
    };
    var loops = [even(shape(1), 4.6), even(shape(-1), 4.6)];
    var rnd = prng(11), jit = loops.map(function (l) { return l.map(function () { return [rnd() - 0.5, rnd() - 0.5, rnd()]; }); });
    var f = new Field(canvas, function (g, t, F) {
      var s = Math.min(F.w, F.h) / 224, cx = F.w / 2, cy = F.h / 2;
      loops.forEach(function (pts, li) {
        var L = pts.length, head = ((t * 0.045 + li * 0.5) % 1) * L;
        for (var i = 0; i < L; i++) {
          var d = Math.abs(i - head); d = Math.min(d, L - d);
          var glow = Math.exp(-(d * d) / 180), j = jit[li][i];
          var tw = reduce.matches ? 0 : Math.sin(t * 1.3 + j[2] * 6.28) * 0.08;
          g.globalAlpha = clamp(0.55 + 0.45 * glow + tw, 0, 1);
          g.fillStyle = glow > 0.25 ? "#2f6bff" : "#174f7b";
          g.beginPath(); dot(g, cx + (pts[i][0] + j[0] * 0.7) * s, cy + (pts[i][1] + j[1] * 0.7) * s, (1.45 + 0.55 * glow) * Math.max(0.8, s * 0.95)); g.fill();
        }
      });
      g.globalAlpha = 1;
    });
    loop.add(f);
    return f;
  };

  /* Accrual: points gathering over the note's term line, from none at commencement to the
     fullest at maturity, the way mined Bitcoin builds up in custody. No scale and no values:
     it draws the idea, not a projection. */
  fields.accrue = function (canvas) {
    var rnd = prng(730), P = [];
    var build = function (w) {
      P = [];
      var n = Math.round(clamp(w * 1.25, 380, 1600));
      for (var i = 0; i < n; i++) P.push({ x: Math.pow(rnd(), 0.8), v: Math.pow(rnd(), 1.15), z: rnd(), ph: rnd() * 6.2832 });
    };
    var f = new Field(canvas, function (g, t, F) {
      var W = F.w, H = F.h, still = reduce.matches;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], x = 3 + p.x * (W - 22), top = p.x * (H - 8);
        var y = H - 4 - p.v * top + (still ? 0 : Math.sin(t * 0.7 + p.ph) * 1.1);
        var edge = 1 - 0.55 * smooth(0.72, 1, p.v);
        var a = (0.16 + 0.62 * p.z) * edge * (0.4 + 0.6 * p.x) + (still ? 0 : Math.sin(t * 1.1 + p.ph * 2) * 0.06);
        if (a < 0.03) continue;
        g.globalAlpha = clamp(a, 0, 1);
        g.fillStyle = p.z > 0.68 ? "#2f6bff" : "#174f7b";
        g.beginPath(); dot(g, x, y, 0.5 + 1.1 * p.z * (0.45 + 0.55 * p.x)); g.fill();
      }
      g.globalAlpha = 1;
    });
    f.onResize = function () { build(f.w); };
    build(f.w);
    loop.add(f);
    return f;
  };

  /* The swell: a quiet wave of points rolling along the bottom of a panel, drawn in the
     canvas's CSS color (grey by default). */
  /* The fall: the swell turned on its side, a meandering stream of points flowing from the top
     of its canvas to the bottom, drawn in the canvas's CSS color. */
  fields.fall = function (canvas) {
    var ink = "#2f6bff";
    try { var c = window.getComputedStyle(canvas).color; if (c) ink = c; } catch (e) { /* keep the default */ }
    var rnd = prng(2027), P = [];
    var build = function (h) {
      P = [];
      var n = Math.round(clamp(h * 0.75, 260, 900));
      for (var i = 0; i < n; i++) P.push({ u: rnd(), s: gauss(rnd), z: Math.pow(rnd(), 1.3), ph: rnd() * 6.2832 });
    };
    var f = new Field(canvas, function (g, t, F) {
      var W = F.w, H = F.h;
      g.fillStyle = ink;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], v = (p.u + t * 0.012) % 1, y = v * H;
        var xc = W * 0.5 + Math.sin(v * 6.2832 * 1.1 - t * 0.28) * W * 0.22 * (0.7 + 0.3 * Math.sin(v * 3.1 + t * 0.12));
        var spread = (7 + 11 * (0.5 + 0.5 * Math.sin(v * 9.4 - t * 0.2))) * (W / 240);
        var x = xc + p.s * spread + Math.sin(t * 0.7 + p.ph) * 1.5;
        var fade = smooth(0, 0.1, v) * (1 - smooth(0.9, 1, v));
        g.globalAlpha = (0.14 + 0.5 * p.z) * fade;
        g.beginPath(); dot(g, x, y, 0.6 + p.z * 1.9); g.fill();
      }
      g.globalAlpha = 1;
    });
    f.onResize = function () { build(f.h); };
    build(f.h);
    loop.add(f);
    return f;
  };

  fields.swell = function (canvas) {
    var ink = "#8a939c";
    try { var c = window.getComputedStyle(canvas).color; if (c) ink = c; } catch (e) { /* keep the default */ }
    var rnd = prng(2026), P = [];
    var build = function (w) {
      P = [];
      var n = Math.round(clamp(w * 0.7, 260, 1000));
      for (var i = 0; i < n; i++) P.push({ u: rnd(), s: gauss(rnd), z: Math.pow(rnd(), 1.3), ph: rnd() * 6.2832 });
    };
    var f = new Field(canvas, function (g, t, F) {
      var W = F.w, H = F.h;
      g.fillStyle = ink;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], u = (p.u + t * 0.006) % 1, x = u * W;
        var yc = H * 0.5 + Math.sin(u * 6.2832 * 1.15 - t * 0.28) * H * 0.2 * (0.7 + 0.3 * Math.sin(u * 3.1 + t * 0.12));
        var spread = (7 + 11 * (0.5 + 0.5 * Math.sin(u * 9.4 - t * 0.2))) * (H / 240);
        var y = yc + p.s * spread + Math.sin(t * 0.7 + p.ph) * 1.5;
        var fade = smooth(0, 0.06, u) * (1 - smooth(0.94, 1, u));
        g.globalAlpha = (0.14 + 0.5 * p.z) * fade;
        g.beginPath(); dot(g, x, y, 0.6 + p.z * 1.9); g.fill();
      }
      g.globalAlpha = 1;
    });
    f.onResize = function () { build(f.w); };
    build(f.w);
    loop.add(f);
    return f;
  };

  /* 05b Structure ─────────────────────────────────────────────────────── */
  /* The structure diagram ([data-sx]): hairline links drawn between the nodes' dots, measured
     from the page, so they stay exact at any width; a flow of light-blue points along the
     note's line (hashrate, custody, noteholders); and a node lights its links on hover, focus
     or tap. Wide: the parties around one horizontal line. Below 1100px: one vertical rail. */
  var structure = function (map) {
    var svg = $(".sx-links", map), canvas = $(".sx-flow", map), cap = $("[data-sx-cap]");
    var capText = cap ? cap.textContent : "", NS = "http://www.w3.org/2000/svg", R = 12;
    var nodes = {};
    $$(".sx-n", map).forEach(function (n) { nodes[n.getAttribute("data-node")] = n; });
    var narrow = window.matchMedia("(max-width: 1099px)");
    var FLOW = ["agg", "iss", "cus", "inv"];
    var WIDE = [["agg", "iss", "h", 1], ["iss", "cus", "h", 1], ["cus", "inv", "h", 1], ["mgt", "iss", "hv"], ["iss", "reg", "v"],
      ["reg", "tok", "h"], ["agt", "cus", "v"]];
    var TALL = [["agg", "iss", "v", 1], ["iss", "cus", "v", 1], ["cus", "inv", "v", 1], ["iss", "mgt", "rail"], ["iss", "reg", "rail"],
      ["reg", "tok", "vh"], ["cus", "agt", "rail"]];
    var at = function (key) {
      var d = $(".sx-dot", nodes[key]).getBoundingClientRect(), m = map.getBoundingClientRect();
      return { x: Math.round(d.left + d.width / 2 - m.left) + 0.5, y: Math.round(d.top + d.height / 2 - m.top) + 0.5 };
    };
    var sgn = function (v) { return v < 0 ? -1 : 1; };
    var route = function (A, B, how) {
      var sx = sgn(B.x - A.x), sy = sgn(B.y - A.y);
      if (how === "h") return "M" + A.x + " " + A.y + "H" + B.x;
      if (how === "v") return "M" + A.x + " " + A.y + "V" + B.y;
      if (how === "hv") return "M" + A.x + " " + A.y + "H" + (B.x - R * sx) + "Q" + B.x + " " + A.y + " " + B.x + " " + (A.y + R * sy) + "V" + B.y;
      if (how === "vh") return "M" + A.x + " " + A.y + "V" + (B.y - R * sy) + "Q" + A.x + " " + B.y + " " + (A.x + R * sx) + " " + B.y + "H" + B.x;
      /* rail: a branch leaving the vertical rail with a rounded corner */
      return "M" + A.x + " " + (B.y - R) + "Q" + A.x + " " + B.y + " " + (A.x + R) + " " + B.y + "H" + B.x;
    };
    var path = [], length = 0, spread = 1, active = null, pinned = null;
    function layout() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      (narrow.matches ? TALL : WIDE).forEach(function (l) {
        var el = doc.createElementNS(NS, "path");
        el.setAttribute("d", route(at(l[0]), at(l[1]), l[2]));
        el.setAttribute("data-a", l[0]); el.setAttribute("data-b", l[1]);
        if (l[3]) el.setAttribute("class", "flow");
        svg.appendChild(el);
      });
      path = FLOW.map(at); length = 0; spread = narrow.matches ? 0.55 : 1;
      for (var i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      light(active);
      if (flow) { flow.build(); flow.paint(); }
    }
    /* a point at distance d along the flow line, with its direction */
    var along = function (d) {
      for (var i = 1; i < path.length; i++) {
        var a = path[i - 1], b = path[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= seg || i === path.length - 1) { var f = seg ? Math.min(1, d / seg) : 0; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / (seg || 1), dy: (b.y - a.y) / (seg || 1) }; }
        d -= seg;
      }
      return path[0];
    };
    var rnd = prng(2004), P = [];
    var flow = new Field(canvas, function (g, t) {
      if (path.length < 2 || !length) return;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], u = (p.u + t * p.sp / length) % 1, q = along(u * length);
        var off = p.off * spread + (reduce.matches ? 0 : Math.sin(t * 0.8 + p.ph) * 0.8);
        var fade = smooth(0, 0.04, u) * (1 - smooth(0.96, 1, u));
        g.globalAlpha = (0.14 + 0.62 * p.z) * fade * (1 - 0.45 * Math.min(1, Math.abs(p.off) / 7));
        g.fillStyle = p.z > 0.55 ? "#2f6bff" : "#7fa9f7";
        g.beginPath(); dot(g, q.x - q.dy * off, q.y + q.dx * off, 0.55 + 1.45 * p.z); g.fill();
      }
      g.globalAlpha = 1;
    });
    flow.build = function () {
      P = []; rnd = prng(2004);
      var n = Math.round(clamp(length / 3.2, 90, 520));
      for (var i = 0; i < n; i++) P.push({ u: rnd(), sp: 14 + rnd() * 18, off: gauss(rnd) * 3.4, z: Math.pow(rnd(), 1.6), ph: rnd() * 6.2832 });
    };
    loop.add(flow);
    /* lighting a node and its links, and its one-line role in the caption */
    function light(key) {
      active = key;
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.toggle("is-on", k === key); });
      $$("path", svg).forEach(function (el) { var on = !!key && (el.getAttribute("data-a") === key || el.getAttribute("data-b") === key); el.classList.toggle("is-on", on); });
      if (!cap) return;
      cap.textContent = "";
      if (!key) { cap.textContent = capText; return; }
      var b = doc.createElement("b"); b.textContent = $(".sx-name", nodes[key]).textContent;
      cap.appendChild(b); cap.appendChild(doc.createTextNode($(".sx-desc", nodes[key]).textContent));
    }
    Object.keys(nodes).forEach(function (k) {
      var btn = $(".sx-b", nodes[k]);
      btn.addEventListener("mouseenter", function () { light(k); });
      btn.addEventListener("mouseleave", function () { light(pinned); });
      btn.addEventListener("focus", function () { light(k); });
      btn.addEventListener("blur", function () { light(pinned); });
      btn.addEventListener("click", function () { pinned = pinned === k ? null : k; light(pinned || k); });
    });
    doc.addEventListener("click", function (e) { if (pinned && !e.target.closest(".sx-b")) { pinned = null; light(null); } });
    var timer = 0, relayout = function () { clearTimeout(timer); timer = setTimeout(layout, 60); };
    if ("ResizeObserver" in window) new ResizeObserver(relayout).observe(map); else window.addEventListener("resize", relayout);
    if (narrow.addEventListener) narrow.addEventListener("change", relayout);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(relayout);
    layout();
  };

  /* 06 Boot ──────────────────────────────────────────────────────────── */
  var boot = function () {
    if ($("[data-live]") || $("[data-live-status]")) live.start();
    $$("[data-sx]").forEach(structure);
    $$("canvas[data-field]").forEach(function (c) {
      var make = fields[c.getAttribute("data-field")];
      if (!make) return;
      var opts = {};
      if (c.getAttribute("data-field") === "hashrate-wave") {
        opts.onStatus = function (state, rows) {
          var dotEl = $("[data-wave-dot]"), text = $("[data-wave-status]"), panel = c.closest(".field-panel");
          if (dotEl) dotEl.className = "dot" + (state === "ok" ? "" : state === "down" ? " down" : " wait");
          if (panel) panel.classList.toggle("is-down", state === "down");
          if (!text) return;
          if (state === "ok") {
            var from = new Date(rows[0].timestamp * 1000), to = new Date(rows[rows.length - 1].timestamp * 1000);
            var d = function (x) { return x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
            text.textContent = "Network hashrate, daily, " + d(from) + " to " + d(to) + ". Source: mempool.space";
          } else if (state === "down") text.textContent = "Network hashrate history: Unavailable";
          else text.textContent = "Network hashrate history, loading from mempool.space";
        };
      }
      make(c, opts);
    });
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot); else boot();
})();
