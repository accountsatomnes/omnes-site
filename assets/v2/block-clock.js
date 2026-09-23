/* Omnes block clock.

   The last 24 hours of Bitcoin blocks on a 24-hour UTC dial, read live from mempool.space and
   computed in the browser.

   What it draws
     Blocks     one hairline per block at the UTC time it was found. Length is the fees it paid,
                on a square-root scale bounded by the day's 5th and 95th percentiles. Marks found
                within a few seconds of each other are spread just enough to stay separate. The
                last two hours lean toward the accent; the latest block is the accent, a touch
                heavier. Older marks fade gently.
     Hashrate   the ring inside: work over time for the trailing `window` blocks at every block,
                with timestamps through a three-point median, then a Gaussian-weighted local
                straight-line fit (40 min) so the newest end does not lag. The day's range sets
                the depth of a soft light-blue fill on a fixed baseline, never less than 5% of
                the level, so a flat day stays flat and a real move reads as the fill deepening
                or thinning. The newest value is ringed.
     Now        an accent index and bead on the dial ring with the time on the bezel, and a
                light-blue sweep across the block band for the wait since the latest block.
     Reading    hover, tap, or focus and use the arrow keys (Page Up/Down, Home, End, Escape).
                The block is marked on the band, the bezel and the ring; the centre shows its
                height, time, reward and fees; the key shows the hashrate at that time.
     Arrival    the new mark grows in over a brief light-blue bloom, the sweep closes, the
                height rolls over, and a screen reader hears the new block.
     States     a comb skeleton while loading, the same comb still on failure, instant final
                frames under reduced motion. Canvas drawn at the device pixel ratio, up to 3.

   Privacy     each block record is cut to height, time, reward, fees and difficulty the moment
               it arrives. Pool, coinbase and every other field is dropped unread, never stored.

   Markup      <figure class="block-clock" data-block-clock></figure>
   Script      every [data-block-clock] mounts itself on load. Options, as data-* attributes or
               OmnesBlockClock.mount(el, options):
                 api     mempool.space API base          default https://mempool.space/api
                 poll    ms between polls, at least 60000 default 60000
                 window  blocks per hashrate estimate     default 144 (24 to 432)
   Global      OmnesBlockClock.mount(el, options) -> instance, .mountAll(scope) -> instances,
               .instances(), .records() (the five numbers held per block, for inspection)
   Instance    pick(height) -> bool, latest() -> {height, time, reward, fees} | null,
               replayLatest(delayMs) -> bool (test hook: the newest block leaves, then arrives
               again as a new one would), refresh(), destroy(), el
   Tokens      reads --ink, --muted, --line, --line-strong, --soft, --tint, --tint-ink, --accent
               from the page, each with its own fallback; --bc-surface is the colour behind the
               dial and --bc-max its largest width.                                              */
(function (root, doc) {
  "use strict";
  if (!root || !doc || root.OmnesBlockClock) return;

  var TAU = Math.PI * 2, DAY = 86400, QUARTER = Math.PI / 2, TWO32 = 4294967296, FRESH = 7200;
  var DEFAULTS = { api: "https://mempool.space/api", poll: 60000, window: 144 };
  var mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduced = function () { return !!(mq && mq.matches); };
  var clock = function () { return root.performance && performance.now ? performance.now() : Date.now(); };

  /* ── numbers and words ──────────────────────────────────────────────── */
  var isNum = function (v) { return typeof v === "number" && isFinite(v); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var ease = function (x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
  var easeIO = function (x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var fmt = function (v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var btc = function (sats) { return fmt(sats / 1e8, 4) + " BTC"; };
  var usd = function (v) { return "$" + fmt(v, 0); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var hm = function (sec) { var d = new Date(sec * 1000); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
  var hashFmt = function (v) { return fmt(v / 1e18, 0) + " EH/s"; };
  var subsidy = function (h) { var e = Math.floor(h / 210000); return e >= 64 ? 0 : Math.floor(5e9 / Math.pow(2, e)); };
  var angleOf = function (t) { return ((((t % DAY) + DAY) % DAY) / DAY) * TAU - QUARTER; };
  var spell = function (s) {
    s = Math.max(0, Math.floor(s));
    if (s < 60) return s + " s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min " + pad(s % 60) + " s";
    return Math.floor(m / 60) + " h " + pad(m % 60) + " min";
  };
  var spellLong = function (s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 1) return r + (r === 1 ? " second" : " seconds");
    if (m < 60) return m + (m === 1 ? " minute" : " minutes");
    return Math.floor(m / 60) + " hours " + (m % 60) + " minutes";
  };

  /* ── colours: page tokens resolved to rgb for the canvas ────────────── */
  var probe = null;
  function rgbOf(str, fallback) {
    probe = probe || doc.createElement("canvas").getContext("2d");
    var parse = function (v) {
      probe.fillStyle = "#000"; probe.fillStyle = v; var s = String(probe.fillStyle);
      if (s.charAt(0) === "#") return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16), 1];
      var m = s.match(/[\d.]+/g) || [0, 0, 0, 1];
      return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
    };
    var c = parse((str || "").trim() || fallback);
    // a translucent token cannot stand in for a solid colour here: use the component's own
    return c[3] < 0.5 ? parse(fallback) : c;
  }
  var rgba = function (c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + clamp(a, 0, 1).toFixed(3) + ")"; };
  var mix = function (p, q, k) { return [Math.round(p[0] + (q[0] - p[0]) * k), Math.round(p[1] + (q[1] - p[1]) * k), Math.round(p[2] + (q[2] - p[2]) * k)]; };

  /* ═══════════════════════════════════════════════════════════════════
     Feed: one per API base, shared by every clock on the page, polling
     at most once a minute and only while a page is visible.
     ═══════════════════════════════════════════════════════════════════ */
  var feeds = {};
  function feedFor(api, poll) {
    var key = String(api).replace(/\/+$/, "");
    var f = feeds[key] || (feeds[key] = new Feed(key));
    f.pollMs = Math.max(60000, Math.min(f.pollMs || Infinity, poll || 60000));
    return f;
  }

  function Feed(api) {
    this.api = api;
    this.blocks = [];          // ascending by height: { h, t, reward, fees, d }, sats and difficulty
    this.price = null;         // USD per BTC
    this.adj = null;           // { epochStart, prev } for the current difficulty epoch
    this.status = "loading";   // loading | live | stale | down
    this.updated = null;       // ms of the last good read
    this.version = 0;
    this.subs = [];
    this.timer = null; this.busy = false; this.lastPoll = 0; this.sleeping = false; this.started = false;
    var self = this;
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden) self.wake(); });
  }

  Feed.prototype.get = function (path, asText) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(this.api + path, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return asText ? r.text() : r.json(); })
      .then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  };

  // From /v1/blocks: keep five numbers, drop the rest of the record (pool included) unread.
  function slimBlock(b) {
    if (!b || typeof b !== "object") return null;
    var h = Number(b.height), t = Number(b.timestamp), ex = b.extras || {};
    var reward = isNum(ex.reward) ? ex.reward : null;
    var fees = isNum(ex.totalFees) ? ex.totalFees : reward !== null ? Math.max(0, reward - subsidy(h)) : null;
    var d = isNum(b.difficulty) && b.difficulty > 0 ? b.difficulty : null;
    return h > 0 && t > 0 && h % 1 === 0 ? { h: h, t: t, reward: reward, fees: fees, d: d } : null;
  }
  // From /v1/mining/blocks/rewards/3d: one point per block; fees are the reward above the subsidy.
  function slimReward(x) {
    if (!x || typeof x !== "object") return null;
    var h = Number(x.avgHeight), t = Number(x.timestamp), r = Number(x.avgRewards);
    return h > 0 && h % 1 === 0 && t > 0 && r >= 0 ? { h: h, t: t, reward: r, fees: Math.max(0, r - subsidy(h)), d: null } : null;
  }
  var nothing = function () { return null; };

  Feed.prototype.maxH = function () { return this.blocks.length ? this.blocks[this.blocks.length - 1].h : 0; };
  Feed.prototype.latest = function () { return this.blocks.length ? this.blocks[this.blocks.length - 1] : null; };

  Feed.prototype.merge = function (list, born) {
    var byH = {}, maxH = this.maxH(), added = [];
    this.blocks.forEach(function (b) { byH[b.h] = b; });
    list.forEach(function (b) {
      if (!b) return;
      var old = byH[b.h];
      if (old) {
        old.t = b.t;
        if (b.d) old.d = b.d;
        if (b.reward !== null) { old.reward = b.reward; old.fees = b.fees; }
        return;
      }
      byH[b.h] = b;
      if (born && b.h > maxH) added.push(b);
    });
    this.blocks = Object.keys(byH).map(function (k) { return byH[k]; }).sort(function (a, b) { return a.h - b.h; });
    added.sort(function (a, b) { return a.h - b.h; });
    this.trim();
    this.version++;
    return added;
  };

  // keep the day, plus enough earlier blocks to estimate hashrate at its start
  Feed.prototype.trim = function () {
    var B = this.blocks, from = Date.now() / 1000 - DAY - 3600, i = 0, keep = (this.window || 144) + 16;
    while (i < B.length && B[i].t <= from) i++;
    if (i - keep > 0) this.blocks = B.slice(i - keep);
  };

  Feed.prototype.setAdj = function (a) {
    if (a && isNum(a.nextRetargetHeight) && isNum(a.previousRetarget)) this.adj = { epochStart: a.nextRetargetHeight - 2016, prev: a.previousRetarget };
    return !!a;
  };
  Feed.prototype.setPrice = function (p) {
    var v = p && Number(p.USD);
    if (v > 0) { this.price = v; return true; }
    return false;
  };

  Feed.prototype.subscribe = function (clk) {
    if (this.subs.indexOf(clk) < 0) this.subs.push(clk);
    if (!this.started) { this.started = true; this.load(true); }
    else if (this.blocks.length || this.status === "down") clk.onFeed("load", []);
  };
  Feed.prototype.unsubscribe = function (clk) {
    this.subs = this.subs.filter(function (c) { return c !== clk; });
    if (!this.subs.length) { clearTimeout(this.timer); this.timer = null; this.started = false; }
  };
  Feed.prototype.emit = function (kind, info) {
    this.subs.slice().forEach(function (c) { try { c.onFeed(kind, info || []); } catch (e) { if (root.console) console.error(e); } });
  };

  Feed.prototype.schedule = function (ms) {
    var self = this;
    clearTimeout(this.timer);
    if (!this.subs.length) return;
    this.timer = setTimeout(function () { self.tick(); }, ms === undefined ? this.pollMs : ms);
  };
  Feed.prototype.tick = function () {
    if (!this.subs.length || this.busy) return;
    if (doc.hidden) { this.sleeping = true; return; }
    if (!this.blocks.length) this.load(false); else this.poll();
  };
  Feed.prototype.wake = function () {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.schedule(Math.max(0, this.pollMs - (Date.now() - this.lastPoll)));
  };

  // The full read: the day's blocks, the newest fifteen with their difficulty, the difficulty
  // epoch and the price. Used on first load and after a long sleep or a reorganisation.
  Feed.prototype.load = function () {
    var self = this;
    this.busy = true; this.lastPoll = Date.now();
    return Promise.all([
      this.get("/v1/mining/blocks/rewards/3d").catch(nothing),
      this.get("/v1/blocks").catch(nothing),
      this.get("/v1/difficulty-adjustment").catch(nothing),
      this.get("/v1/prices").catch(nothing)
    ]).then(function (r) {
      var day = Array.isArray(r[0]) ? r[0].map(slimReward) : [];
      var recent = Array.isArray(r[1]) ? r[1].map(slimBlock) : [];
      r[0] = r[1] = null;   // the raw records go here, pool and coinbase fields with them
      var gotAdj = self.setAdj(r[2]), gotPrice = self.setPrice(r[3]);
      var fill = day.length || !recent.length ? Promise.resolve([]) : self.backfill(recent);
      return fill.then(function (older) {
        self.blocks = [];
        self.merge(day.concat(older), false);
        self.merge(recent, false);
        var ok = day.length && recent.length && gotAdj && gotPrice;
        self.finish(self.blocks.length ? (ok ? "live" : "stale") : "down", "load", [], day.length + recent.length > 0);
      });
    }).catch(function () { self.finish(self.blocks.length ? "stale" : "down", "load", [], false); });
  };

  // If the day's list is unavailable, walk back through /v1/blocks/{height}, fifteen at a time.
  Feed.prototype.backfill = function (recent) {
    var self = this, got = [], pages = 0;
    var low = recent.reduce(function (m, b) { return b && b.h < m ? b.h : m; }, Infinity);
    var step = function () {
      if (pages >= 20 || !(low > 1)) return Promise.resolve(got);
      pages++;
      return self.get("/v1/blocks/" + (low - 1)).then(function (l) {
        var list = Array.isArray(l) ? l.map(slimBlock).filter(Boolean) : [];
        l = null;
        if (!list.length) return got;
        got = got.concat(list);
        low = list.reduce(function (m, b) { return b.h < m ? b.h : m; }, low);
        var oldest = list.reduce(function (m, b) { return b.t < m ? b.t : m; }, Infinity);
        return oldest < Date.now() / 1000 - DAY - 150 * 600 ? got : step();
      }).catch(function () { return got; });
    };
    return step();
  };

  // The minute poll: the tip height and the price; the newest blocks only when the tip moved.
  Feed.prototype.poll = function () {
    var self = this;
    this.busy = true; this.lastPoll = Date.now();
    Promise.all([
      this.get("/blocks/tip/height", true).then(function (t) { var v = Number(String(t).trim()); return v > 0 ? v : null; }).catch(nothing),
      this.get("/v1/prices").catch(nothing)
    ]).then(function (r) {
      var tip = r[0], gotPrice = self.setPrice(r[1]), max = self.maxH();
      var status = tip && gotPrice ? "live" : "stale";
      if (!tip || tip === max) return self.finish(status, "update", [], !!(tip || gotPrice));
      if (tip < max || tip - max > 14) { self.busy = false; return self.load(); }
      // asking from the tip down gets a fresh answer; the plain list can trail it on a cache
      return self.get("/v1/blocks/" + tip).then(function (l) {
        var list = Array.isArray(l) ? l.map(slimBlock) : [];
        l = null;
        var added = self.merge(list, true), now = clock();
        added.forEach(function (b, i) { b.born = now + i * 320; });
        var crossed = self.adj && added.some(function (b) { return b.h >= self.adj.epochStart + 2016; });
        var next = crossed ? self.get("/v1/difficulty-adjustment").then(function (a) { self.setAdj(a); }).catch(nothing) : Promise.resolve();
        return next.then(function () { self.finish(status, added.length ? "arrive" : "update", added, true); });
      }).catch(function () { self.finish("stale", "update", [], true); });
    }).catch(function () { self.finish(self.blocks.length ? "stale" : "down", "update", [], false); });
  };

  // `read` says whether anything new came back; only then does the "updated" time move
  Feed.prototype.finish = function (status, kind, added, read) {
    this.busy = false;
    this.status = status;
    if (read) this.updated = Date.now();
    this.emit(kind, added);
    this.schedule();
  };

  // Test hook: take the newest block away, then let it arrive again, as a new block would.
  Feed.prototype.replay = function (delay) {
    if (this.busy || this.blocks.length < 3) return false;
    var self = this, b = this.blocks.pop();
    delete b.born;
    this.version++;
    this.emit("update", []);
    setTimeout(function () {
      if (self.maxH() >= b.h) return;
      var added = self.merge([b], true);
      added.forEach(function (x) { x.born = clock(); });
      self.emit("arrive", added);
    }, delay === undefined ? 1600 : delay);
    return true;
  };

  /* Hashrate at each block: the work in the last N blocks over the time they took.
     H(i) = sum of difficulty(k) for k in (i-N, i], times 2^32, over t(i) - t(i-N).
     Timestamps are first put through a three-point median, which removes the odd miner clock
     that runs ahead or behind without moving anything else. */
  Feed.prototype.hashrate = function (N) {
    if (this._hr && this._hr.v === this.version && this._hr.N === N) return this._hr.pts;
    var B = this.blocks, n = B.length, pts = [], i, cur = null, adj = this.adj;
    for (i = n - 1; i >= 0; i--) if (B[i].d) { cur = B[i]; break; }
    if (cur && n > N + 4) {
      // blocks from before the last retarget carry the previous difficulty
      var prevD = adj ? cur.d / (1 + adj.prev / 100) : cur.d;
      var D = B.map(function (b) { return b.d || (adj && b.h < adj.epochStart ? prevD : cur.d); });
      var tm = B.map(function (b, k) {
        if (k === 0 || k === n - 1) return b.t;
        var a = B[k - 1].t, c = B[k + 1].t, x = b.t;
        return Math.max(Math.min(a, x), Math.min(Math.max(a, x), c));
      });
      var pre = [0];
      for (i = 0; i < n; i++) pre.push(pre[i] + D[i]);
      for (i = N; i < n; i++) {
        if (B[i].h - B[i - N].h !== N) continue;
        var dt = tm[i] - tm[i - N];
        if (!(dt > N * 60)) continue;
        pts.push({ t: tm[i], v: (pre[i + 1] - pre[i - N + 1]) * TWO32 / dt });
      }
      // the newest point sits at the newest block's own time, so the ring ends on its mark
      if (pts.length) pts[pts.length - 1].t = Math.max(pts[pts.length - 1].t, B[n - 1].t);
      pts.sort(function (a, b) { return a.t - b.t; });
    }
    this._hr = { v: this.version, N: N, pts: pts };
    return pts;
  };

  /* ── helpers for the dial ────────────────────────────────────────────── */

  // Spread marks that sit closer than d seconds, keeping their order and moving each cluster
  // as little as possible (least squares), inside [lo, hi].
  function dodge(ts, d, lo, hi) {
    var n = ts.length, out = new Array(n), cl = [], i, k;
    if (!n) return out;
    for (i = 0; i < n; i++) {
      cl.push({ i: i, n: 1, s: ts[i] });
      while (cl.length > 1) {
        var b = cl[cl.length - 1], a = cl[cl.length - 2];
        if ((b.s / b.n - (b.n - 1) * d / 2) - (a.s / a.n + (a.n - 1) * d / 2) >= d) break;
        a.n += b.n; a.s += b.s; cl.pop();
      }
    }
    cl.forEach(function (c) { var x = c.s / c.n - (c.n - 1) * d / 2; for (k = 0; k < c.n; k++) out[c.i + k] = x + k * d; });
    if (out[0] < lo) { out[0] = lo; for (i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + d); }
    if (out[n - 1] > hi) { out[n - 1] = hi; for (i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - d); }
    return out;
  }

  // Smoothing of irregular points at time t: a Gaussian-weighted local straight-line fit. Inside
  // the day it behaves like a plain weighted average; at the newest end, where there is nothing
  // after t to balance the weights, it follows the trend instead of lagging behind it.
  function kernel(pts, t, sig, cursor) {
    var s0 = 0, s1 = 0, s2 = 0, t0 = 0, t1 = 0, lim = 3 * sig, k;
    for (k = cursor.i; k < pts.length; k++) {
      var dt = pts[k].t - t;
      if (dt < -lim) { cursor.i = k + 1; continue; }
      if (dt > lim) break;
      var w = Math.exp(-(dt * dt) / (2 * sig * sig)), d = dt / sig;
      s0 += w; s1 += w * d; s2 += w * d * d; t0 += w * pts[k].v; t1 += w * d * pts[k].v;
    }
    if (!(s0 > 1e-9)) return null;
    var det = s0 * s2 - s1 * s1;
    return det > 1e-6 * s0 * s0 ? (s2 * t0 - s1 * t1) / det : t0 / s0;
  }

  // Catmull-Rom through radii, linear in time, `sub` steps per segment.
  function spline(ps, sub) {
    var out = [], n = ps.length, i, s;
    for (i = 0; i < n - 1; i++) {
      var r0 = ps[Math.max(0, i - 1)].r, r1 = ps[i].r, r2 = ps[i + 1].r, r3 = ps[Math.min(n - 1, i + 2)].r;
      for (s = 0; s < sub; s++) {
        var u = s / sub, u2 = u * u, u3 = u2 * u;
        out.push({
          t: ps[i].t + (ps[i + 1].t - ps[i].t) * u,
          r: 0.5 * (2 * r1 + (-r0 + r2) * u + (2 * r0 - 5 * r1 + 4 * r2 - r3) * u2 + (-r0 + 3 * r1 - 3 * r2 + r3) * u3)
        });
      }
    }
    out.push({ t: ps[n - 1].t, r: ps[n - 1].r });
    return out;
  }

  // Radii as fractions of the dial. A small dial gives the centre more room: the band of
  // marks gets a little shorter and moves outward, and the hashrate band follows it.
  function geometry(S) {
    var m = Math.round(clamp(S * 0.056, 22, 34)), R = S / 2 - m, k = clamp((R - 150) / 110, 0, 1);
    var lerp = function (small, large) { return small + (large - small) * k; };
    return {
      S: S, c: S / 2, m: m, R: R,
      tMaj: clamp(R * 0.036, 6.5, 10), tMid: clamp(R * 0.026, 5, 7.5), tMin: clamp(R * 0.016, 3.5, 5),
      lab: R + clamp(R * 0.04, 8, 11),
      fs: R < 200 ? 11 : 11.5,
      b0: R * lerp(0.74, 0.705),            // base of the block band
      gap: clamp(R * 0.012, 2, 3.5),
      Lmin: R * 0.05, Lmax: R * lerp(0.172, 0.2),
      h0: R * lerp(0.612, 0.572), h1: R * lerp(0.712, 0.678),   // the hashrate band
      core: R * lerp(0.6, 0.55),
      lw: clamp(R / 205, 1.05, 1.35)        // the one hairline weight
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Clock: one mounted dial.
     ═══════════════════════════════════════════════════════════════════ */
  var uid = 0, all = [];

  function Clock(el, opts) {
    this.el = el;
    this.o = opts;
    this.id = "bclk" + (++uid);
    this.pick = null;
    this.dim = { v: 0, from: 0, to: 0, at: 0 };
    this.introAt = null; this.introDone = false;
    this.prevLatest = null; this.sweepAnim = null;
    this.marks = []; this.order = [];
    this.onscreen = true; this.raf = null; this.lastDraw = 0;
    this.shownH = null;
    this.feed = feedFor(opts.api, opts.poll);
    this.feed.window = Math.max(this.feed.window || 0, opts.window);
    this.build();
    this.bind();
    this.measure();
    this.feed.subscribe(this);
    this.renderText();
    this.kick();
  }

  Clock.prototype.build = function () {
    var el = this.el, id = this.id;
    el.classList.add("block-clock", "is-loading");
    el.setAttribute("data-block-clock-mounted", "");
    el.innerHTML =
      '<div class="bc-stage">' +
        '<canvas class="bc-canvas" aria-hidden="true"></canvas>' +
        '<div class="bc-hit" tabindex="0" role="slider" aria-orientation="horizontal" aria-label="Bitcoin blocks in the last 24 hours" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1" aria-valuetext="Loading" aria-describedby="' + id + '-help"></div>' +
        '<svg class="bc-svg" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"></svg>' +
        '<div class="bc-core">' +
          '<div class="bc-k">Latest block</div>' +
          '<div class="bc-h"><span class="bc-hv">&#8203;</span></div>' +
          '<div class="bc-s">&#8203;</div>' +
          '<div class="bc-comp">' +
            '<div class="bc-c"><div class="bc-cl">Reward</div><div class="bc-cv" data-k="rv">&#8203;</div><div class="bc-cu" data-k="ru">&#8203;</div></div>' +
            '<div class="bc-c"><div class="bc-cl">Fees</div><div class="bc-cv" data-k="fv">&#8203;</div><div class="bc-cu" data-k="fu">&#8203;</div></div>' +
          '</div>' +
          '<div class="bc-fail">Unavailable</div>' +
        '</div>' +
      '</div>' +
      '<figcaption class="bc-cap">' +
        '<span class="bc-keys">' +
          '<span class="bc-key"><svg class="bc-g" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 12V6M7 12V2M11 12V8"/></svg><span data-k="count">Blocks</span></span>' +
          '<span class="bc-key bc-key-hash"><svg class="bc-g" viewBox="0 0 18 14" aria-hidden="true" focusable="false"><path class="bc-g-fill" d="M1 13V8C4 5 6 9 9 7S14 4 17 6V13Z"/><path class="bc-g-line" d="M1 8C4 5 6 9 9 7S14 4 17 6"/></svg><span data-k="hash">Hashrate</span></span>' +
        '</span>' +
        '<span class="bc-status"><i class="bc-dot" aria-hidden="true"></i><span data-k="status">Loading from mempool.space</span></span>' +
        '<span class="bc-vh" id="' + id + '-help">Each mark is one block, placed at the UTC time it was found, and longer marks paid more in fees. The ring inside is network hashrate through the day. Use the arrow keys to read each block, and Escape to return to the latest.</span>' +
        '<span class="bc-vh" data-k="live" aria-live="polite" aria-atomic="true"></span>' +
      '</figcaption>';
    var q = function (s) { return el.querySelector(s); };
    this.stage = q(".bc-stage");
    this.canvas = q(".bc-canvas");
    this.g = this.canvas.getContext("2d");
    this.hit = q(".bc-hit");
    this.svg = q(".bc-svg");
    this.core = q(".bc-core");
    this.t = {
      k: q(".bc-k"), h: q(".bc-h"), s: q(".bc-s"),
      rv: q('[data-k="rv"]'), ru: q('[data-k="ru"]'), fv: q('[data-k="fv"]'), fu: q('[data-k="fu"]'),
      count: q('[data-k="count"]'), hash: q('[data-k="hash"]'), status: q('[data-k="status"]'), live: q('[data-k="live"]')
    };
  };

  Clock.prototype.colours = function () {
    var cs = root.getComputedStyle(this.el), v = function (n) { return cs.getPropertyValue(n); };
    this.C = {
      ink: rgbOf(v("--bc-ink"), "#17191c"),
      muted: rgbOf(v("--bc-muted"), "#5f666e"),
      line: rgbOf(v("--bc-line"), "#e5e8eb"),
      soft: rgbOf(v("--bc-soft"), "#f6f7f8"),
      tint: rgbOf(v("--bc-tint"), "#dbeeff"),
      tintInk: rgbOf(v("--bc-tint-ink"), "#174f7b"),
      accent: rgbOf(v("--bc-accent"), "#2f6bff"),
      bg: rgbOf(v("--bc-bg"), "#ffffff")
    };
  };

  /* ── size: everything is laid out in CSS pixels from the stage width ── */
  Clock.prototype.measure = function () {
    var w = Math.round(this.stage.getBoundingClientRect().width);
    if (!(w > 40)) return;
    var dpr = Math.min(3, root.devicePixelRatio || 1);
    if (this.G && this.G.S === w && this.dpr === dpr) return;
    this.G = geometry(w);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(w * dpr);
    var st = this.el.style;
    st.setProperty("--bc-R", String(Math.round(this.G.R)));
    st.setProperty("--bc-core", String(Math.round(this.G.core)));
    this.hit.style.inset = Math.max(0, this.G.m - 14) + "px";
    this.colours();
    this.dial();
    this._lay = null; this._ring = null;
    this.hands(Date.now() / 1000, true);
    this.draw(clock());
  };

  /* ── the dial: rings, hour ticks, labels and the present-time marker (SVG) ── */
  Clock.prototype.dial = function () {
    var G = this.G, c = G.c, R = G.R, id = this.id, s = "", h;
    var P = function (a, r) { return (c + Math.cos(a) * r).toFixed(2) + " " + (c + Math.sin(a) * r).toFixed(2); };
    var circle = function (cls, r) { return '<circle class="' + cls + '" cx="' + c + '" cy="' + c + '" r="' + r.toFixed(2) + '"/>'; };
    s += circle("bc-focus bc-focus-halo", R + 5) + circle("bc-focus", R + 5);
    s += circle("bc-ring bc-ring-dial", R);
    s += circle("bc-ring bc-ring-band", G.b0);
    s += circle("bc-ring bc-ring-hash", G.h0);
    // hours, with every third hour a little longer and every sixth longest and labelled
    var minor = "", mid = "", major = "";
    for (h = 0; h < 24; h++) {
      var a = h / 24 * TAU - QUARTER, lvl = h % 6 === 0 ? 2 : h % 3 === 0 ? 1 : 0;
      var seg = "M" + P(a, R - [G.tMin, G.tMid, G.tMaj][lvl]) + "L" + P(a, R - 0.5);
      if (lvl === 2) major += seg; else if (lvl === 1) mid += seg; else minor += seg;
    }
    s += '<path class="bc-tick" d="' + minor + '"/><path class="bc-tick bc-tick-mid" d="' + mid + '"/><path class="bc-tick bc-tick-major" d="' + major + '"/>';
    var L = G.lab;
    s += '<g class="bc-hours" style="font-size:' + G.fs + 'px">' +
      '<text data-a="0" x="' + c + '" y="' + (c - L).toFixed(2) + '" text-anchor="middle">00 UTC</text>' +
      '<text data-a="6" x="' + (c + L).toFixed(2) + '" y="' + c + '" dy="0.35em" text-anchor="start">06</text>' +
      '<text data-a="12" x="' + c + '" y="' + (c + L).toFixed(2) + '" dy="0.74em" text-anchor="middle">12</text>' +
      '<text data-a="18" x="' + (c - L).toFixed(2) + '" y="' + c + '" dy="0.35em" text-anchor="end">18</text>' +
      '</g>';
    s += '<g class="bc-pk"><line class="bc-pk-tick"/><path class="bc-arc" id="' + id + '-pp"/>' +
      '<text class="bc-pk-t" style="font-size:' + G.fs + 'px"><textPath href="#' + id + '-pp" xlink:href="#' + id + '-pp" startOffset="50%" text-anchor="middle"></textPath></text></g>';
    s += '<g class="bc-now"><line class="bc-now-hand"/><circle class="bc-now-dot" r="' + (G.R < 200 ? 2 : 2.4) + '"/><path class="bc-arc" id="' + id + '-np"/>' +
      '<text class="bc-now-t" style="font-size:' + G.fs + 'px"><textPath href="#' + id + '-np" xlink:href="#' + id + '-np" startOffset="50%" text-anchor="middle"></textPath></text></g>';
    this.svg.setAttribute("viewBox", "0 0 " + G.S + " " + G.S);
    this.svg.setAttribute("width", G.S);
    this.svg.setAttribute("height", G.S);
    this.svg.innerHTML = s;
    var q = function (sel) { return this.svg.querySelector(sel); }.bind(this);
    this.sv = {
      hours: Array.prototype.slice.call(this.svg.querySelectorAll(".bc-hours text")),
      now: q(".bc-now"), hand: q(".bc-now-hand"), dot: q(".bc-now-dot"), np: q("#" + id + "-np"), nt: q(".bc-now-t textPath"), ntext: q(".bc-now-t"),
      pk: q(".bc-pk"), ptick: q(".bc-pk-tick"), pp: q("#" + id + "-pp"), pt: q(".bc-pk-t textPath"), ptext: q(".bc-pk-t")
    };
    this._nowKey = null;
  };

  // an arc for curved bezel text, centred on angle a; flipped on the lower half so it reads upright
  Clock.prototype.arc = function (a, span) {
    var G = this.G, c = G.c, flip = Math.sin(a) > 0.02, r = G.lab + (flip ? G.fs * 0.72 : 0);
    var p = function (x) { return (c + Math.cos(x) * r).toFixed(2) + " " + (c + Math.sin(x) * r).toFixed(2); };
    return flip ? "M" + p(a + span) + "A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 0 " + p(a - span)
                : "M" + p(a - span) + "A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 1 " + p(a + span);
  };

  // half the angle a bezel label takes up, from its rendered length
  Clock.prototype.halfAngle = function (textEl, fallbackChars) {
    var len = 0;
    try { len = textEl.getComputedTextLength(); } catch (e) { len = 0; }
    if (!(len > 0)) len = fallbackChars * this.G.fs * 0.56;
    return (len / 2 + 5) / this.G.lab;
  };

  // The present: an accent index and bead on the dial ring, and the time along the bezel.
  Clock.prototype.hands = function (tNow, force) {
    var G = this.G, sv = this.sv;
    if (!G || !sv) return;
    var a = angleOf(tNow), c = G.c, key = Math.floor(tNow / 5);
    if (!force && key === this._nowKey && !this.pickChanged) return;
    this._nowKey = key; this.pickChanged = false;
    // a short accent index across the dial ring, with a bead on the ring itself
    var rIn = G.R - G.tMaj - 2, rOut = G.R;
    var set = function (el, o) { for (var k in o) el.setAttribute(k, typeof o[k] === "number" ? o[k].toFixed(2) : o[k]); };
    set(sv.hand, { x1: c + Math.cos(a) * rIn, y1: c + Math.sin(a) * rIn, x2: c + Math.cos(a) * rOut, y2: c + Math.sin(a) * rOut });
    set(sv.dot, { cx: c + Math.cos(a) * G.R, cy: c + Math.sin(a) * G.R });
    var label = "Now " + hm(tNow) + " UTC";
    if (sv.nt.textContent !== label) sv.nt.textContent = label;
    sv.np.setAttribute("d", this.arc(a, 1.1));
    var nowHalf = this.halfAngle(sv.ntext, label.length);

    // the block being read gets its own bead and time on the dial
    var pm = this.pick ? this.markOf(this.pick) : null, pa = null, pHalf = 0;
    if (pm) {
      pa = pm.a;
      var r0 = G.R - G.tMaj - 1, r1 = G.R + 3;
      set(sv.ptick, { x1: c + Math.cos(pa) * r0, y1: c + Math.sin(pa) * r0, x2: c + Math.cos(pa) * r1, y2: c + Math.sin(pa) * r1 });
      var pl = hm(this.pick.t) + " UTC";
      if (sv.pt.textContent !== pl) sv.pt.textContent = pl;
      sv.pp.setAttribute("d", this.arc(pa, 1.1));
      pHalf = this.halfAngle(sv.ptext, pl.length);
    }
    sv.pk.classList.toggle("is-on", !!pm);
    var dist = function (p, q) { return Math.abs(((p - q) % TAU + TAU + Math.PI) % TAU - Math.PI); };
    var nowHidden = pm && dist(pa, a) < nowHalf + pHalf + 0.02;
    sv.now.classList.toggle("is-quiet", !!nowHidden);
    sv.hours.forEach(function (t) {
      var ha = (+t.getAttribute("data-a")) / 24 * TAU - QUARTER, half = (t.getAttribute("data-a") === "0" ? 3.2 : 1.1) * G.fs / G.lab;
      var hide = (!nowHidden && dist(ha, a) < nowHalf + half + 0.04) || (pm && dist(ha, pa) < pHalf + half + 0.04);
      t.classList.toggle("is-hidden", !!hide);
    });
  };

  /* ── layout of the day's marks, cached until the data or the minute changes ── */
  Clock.prototype.layout = function (tNow) {
    var F = this.feed, G = this.G, key = F.version + ":" + Math.floor(tNow / 20) + ":" + G.S;
    if (this._lay && this._lay.key === key) return this._lay;
    var t0 = tNow - DAY, latest = F.latest();
    var day = F.blocks.filter(function (b) { return b.t > t0; }).sort(function (a, b) { return a.t - b.t || a.h - b.h; });
    // fees on a square-root scale between the day's 5th and 95th percentiles
    var fs = day.map(function (b) { return b.fees; }).filter(isNum).sort(function (a, b) { return a - b; });
    var q = function (p) { return fs.length ? fs[clamp(Math.round(p * (fs.length - 1)), 0, fs.length - 1)] : 0; };
    var lo = Math.sqrt(q(0.05)), hi = Math.sqrt(q(0.95));
    if (!(hi > lo)) hi = lo + 1;
    // close neighbours are spread to one hairline and a gap apart, at the band's base
    var dSec = (G.lw + 1.8) / (TAU * G.b0) * DAY;
    var raw = day.map(function (b) { return Math.min(b.t, tNow); });
    var pos = dodge(raw, dSec, t0 + dSec / 2, raw.length ? raw[raw.length - 1] : tNow);
    var marks = day.map(function (b, i) {
      return { b: b, t: pos[i], f: isNum(b.fees) ? clamp((Math.sqrt(b.fees) - lo) / (hi - lo), 0, 1) : 0.3 };
    });
    this._lay = { key: key, marks: marks, latest: latest, count: day.length };
    return this._lay;
  };

  Clock.prototype.markOf = function (b) {
    for (var i = 0; i < this.marks.length; i++) if (this.marks[i].b === b) return this.marks[i];
    return null;
  };

  /* ── hashrate ring: smoothed, splined, mapped into a narrow band ── */
  Clock.prototype.ring = function (tNow) {
    var F = this.feed, G = this.G, key = F.version + ":" + Math.floor(tNow / 60) + ":" + G.S;
    if (this._ring && this._ring.key === key) return this._ring.val;
    var pts = F.hashrate(this.o.window), t0 = tNow - DAY, val = null;
    if (pts.length > 12) {
      var step = 300, sig = 2400, tEnd = pts[pts.length - 1].t, tStart = Math.max(t0, pts[0].t);
      if (tEnd - tStart > 3 * 3600) {
        var ts = [tStart], t, cur = { i: 0 };
        for (t = Math.ceil(tStart / step) * step; t < tEnd - step / 3; t += step) if (t > tStart + step / 3) ts.push(t);
        ts.push(tEnd);
        var sm = [];
        ts.forEach(function (x) { var v = kernel(pts, x, sig, cur); if (isNum(v)) sm.push({ t: x, v: v }); });
        if (sm.length > 6) {
          var lo = Infinity, hi = -Infinity;
          sm.forEach(function (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
          // The day's low sits near the band's base and its high near the top, so real movement
          // reads as a change in the fill's depth. A flat day is never stretched into drama:
          // the scale always spans at least 5% of the level, centred on the day.
          var mid = (lo + hi) / 2, span = Math.max(hi - lo, mid * 0.05);
          var vLo = mid - span / 2, band = G.h1 - G.h0;
          var rad = function (v) { return G.h0 + band * (0.16 + 0.78 * clamp((v - vLo) / span, 0, 1)); };
          var path = spline(sm.map(function (p) { return { t: p.t, r: rad(p.v) }; }), 3);
          val = { path: path, sm: sm, rad: rad, v: sm[sm.length - 1].v, now: pts[pts.length - 1].v, lo: lo, hi: hi, tEnd: tEnd, rEnd: rad(sm[sm.length - 1].v) };
        }
      }
    }
    this._ring = { key: key, val: val };
    return val;
  };

  // the smoothed hashrate at time t, read off the ring, or null outside it
  Clock.prototype.ringAt = function (t) {
    var ring = this.G && this.feed.blocks.length ? this.ring(Date.now() / 1000) : null, sm = ring && ring.sm, i;
    if (!sm || t < sm[0].t || t > sm[sm.length - 1].t) return null;
    for (i = 1; i < sm.length && sm[i].t < t; i++);
    var p = sm[Math.max(0, i - 1)], q = sm[Math.min(sm.length - 1, i)], k = q.t > p.t ? (t - p.t) / (q.t - p.t) : 0;
    var v = p.v + (q.v - p.v) * k;
    return { v: v, r: ring.rad(v) };
  };

  /* ── drawing ─────────────────────────────────────────────────────────── */
  Clock.prototype.draw = function (now) {
    var G = this.G;
    if (!G) return false;
    var g = this.g, c = G.c, C = this.C, RM = reduced(), F = this.feed;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, G.S, G.S);
    g.lineCap = "round"; g.lineJoin = "round";
    this.lastDraw = now;
    if (!F.blocks.length) return this.drawEmpty(now, F.status === "down");

    var tNow = Date.now() / 1000, t0 = tNow - DAY, a0 = angleOf(t0), anim = false;
    var A = function (t) { return a0 + (t - t0) / DAY * TAU; };
    var X = function (a, r) { return c + Math.cos(a) * r; }, Y = function (a, r) { return c + Math.sin(a) * r; };
    var lay = this.layout(tNow), marks = lay.marks, latest = lay.latest, n = marks.length;

    var ip = 1;
    if (this.introAt !== null) {
      ip = RM ? 1 : clamp((now - this.introAt) / 1700, 0, 1);
      if (ip < 1) anim = true; else { this.introAt = null; this.introDone = true; }
    }
    var d = this.dim, dk = RM ? 1 : clamp((now - d.at) / 200, 0, 1);
    d.v = d.from + (d.to - d.from) * ease(dk);
    if (dk < 1) anim = true;
    var dim = d.v;
    var conic = typeof g.createConicGradient === "function";

    // 1. the wait since the latest block: a light-blue sweep that deepens toward the present
    if (latest && tNow - latest.t < DAY) {
      var ts = latest.t;
      if (this.sweepAnim) {
        var sk = RM ? 1 : clamp((now - this.sweepAnim.at) / 900, 0, 1);
        ts = this.sweepAnim.from + (this.sweepAnim.to - this.sweepAnim.from) * easeIO(sk);
        if (sk < 1) anim = true; else this.sweepAnim = null;
      }
      var s0 = A(Math.min(ts, tNow)), s1 = A(tNow), rIn = G.b0 + 0.5, rOut = G.b0 + G.gap + G.Lmax + G.R * 0.012;
      var sa = clamp((ip - 0.8) / 0.2, 0, 1);
      if (s1 - s0 > 0.0005 && sa > 0) {
        var fill;
        if (conic) {
          fill = g.createConicGradient(s0, c, c);
          var frac = Math.min(0.999, (s1 - s0) / TAU);
          fill.addColorStop(0, rgba(C.tint, 0.35 * sa));
          fill.addColorStop(frac, rgba(C.tint, 1 * sa));
          fill.addColorStop(Math.min(1, frac + 0.0005), rgba(C.tint, 0));
          fill.addColorStop(1, rgba(C.tint, 0));
        } else fill = rgba(C.tint, 0.8 * sa);
        g.fillStyle = fill;
        g.beginPath(); g.arc(c, c, rOut, s0, s1); g.arc(c, c, rIn, s1, s0, true); g.closePath(); g.fill();
        // soften it outward: nothing else is drawn yet, so this only thins the sweep
        var fade = g.createRadialGradient(c, c, rIn, c, c, rOut);
        fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,0.78)");
        g.globalCompositeOperation = "destination-out"; g.fillStyle = fade; g.fill();
        g.globalCompositeOperation = "source-over";
      }
    }
    // the present's edge: a light-blue hairline from the band to the index on the dial
    var nA = A(tNow), nk = clamp((ip - 0.8) / 0.2, 0, 1);
    if (nk > 0) {
      var nIn = G.b0 - 1, nOut = G.R - G.tMaj - 3, ng = g.createLinearGradient(X(nA, nIn), Y(nA, nIn), X(nA, nOut), Y(nA, nOut));
      ng.addColorStop(0, rgba(C.accent, 0)); ng.addColorStop(1, rgba(C.accent, 0.42 * nk));
      g.strokeStyle = ng; g.lineWidth = G.lw;
      g.beginPath(); g.moveTo(X(nA, nIn), Y(nA, nIn)); g.lineTo(X(nA, nOut), Y(nA, nOut)); g.stroke();
    }

    // 2. hashrate: a soft light-blue fill on its baseline, an accent line, a clean end point
    var ring = this.ring(tNow);
    if (ring && ring.path.length > 2) {
      var P = ring.path, upto = ip < 1 ? Math.max(2, Math.floor(P.length * easeIO(clamp(ip / 0.9, 0, 1)))) : P.length, k;
      var fillG, lineG;
      if (conic) {
        // the gradients open a hair before the day starts, so the oldest end's round cap never
        // picks up the newest end's colour across the seam; the oldest half hour fades in
        var eps = 0.012, e0 = eps / TAU, e1 = e0 + 0.022;
        fillG = g.createConicGradient(a0 - eps, c, c);
        fillG.addColorStop(0, rgba(C.tint, 0)); fillG.addColorStop(e0, rgba(C.tint, 0)); fillG.addColorStop(e1, rgba(C.tint, 0.5)); fillG.addColorStop(1, rgba(C.tint, 1));
        lineG = g.createConicGradient(a0 - eps, c, c);
        lineG.addColorStop(0, rgba(C.accent, 0)); lineG.addColorStop(e0, rgba(C.accent, 0)); lineG.addColorStop(e1, rgba(C.accent, 0.38));
        lineG.addColorStop(0.6, rgba(C.accent, 0.7)); lineG.addColorStop(1, rgba(C.accent, 1));
      } else { fillG = rgba(C.tint, 0.8); lineG = rgba(C.accent, 0.85); }
      var aStart = A(P[0].t), aUp = A(P[upto - 1].t);
      g.beginPath();
      g.moveTo(X(aStart, G.h0), Y(aStart, G.h0));
      for (k = 0; k < upto; k++) { var ak = A(P[k].t); g.lineTo(X(ak, P[k].r), Y(ak, P[k].r)); }
      g.lineTo(X(aUp, G.h0), Y(aUp, G.h0));
      g.arc(c, c, G.h0, aUp, aStart, true);
      g.closePath();
      g.fillStyle = fillG; g.globalAlpha = 1 - 0.35 * dim; g.fill();
      g.beginPath();
      for (k = 0; k < upto; k++) { var al = A(P[k].t); if (k) g.lineTo(X(al, P[k].r), Y(al, P[k].r)); else g.moveTo(X(al, P[k].r), Y(al, P[k].r)); }
      g.strokeStyle = lineG; g.lineWidth = G.lw * 1.2; g.stroke();
      g.globalAlpha = 1;
      var rr = G.R < 200 ? 2.6 : 3.1;
      if (ip >= 1) {
        var ae = A(P[P.length - 1].t), re = P[P.length - 1].r;
        g.fillStyle = rgba(C.bg, 1); g.beginPath(); g.arc(X(ae, re), Y(ae, re), rr + 1.2, 0, TAU); g.fill();
        g.strokeStyle = rgba(C.accent, 1); g.lineWidth = G.lw * 1.15; g.beginPath(); g.arc(X(ae, re), Y(ae, re), rr, 0, TAU); g.stroke();
      }
      // the block being read, marked on the ring at its time
      var at = this.pick ? this.ringAt(this.pick.t) : null;
      if (at && ip >= 1) {
        var ap = A(this.pick.t);
        g.fillStyle = rgba(C.bg, 1); g.beginPath(); g.arc(X(ap, at.r), Y(ap, at.r), rr + 1.2, 0, TAU); g.fill();
        g.fillStyle = rgba(C.accent, 1); g.beginPath(); g.arc(X(ap, at.r), Y(ap, at.r), rr - 0.2, 0, TAU); g.fill();
      }
    }

    // 3. one hairline per block, fading gently with age; the newest lean to the accent
    var r0 = G.b0 + G.gap, lw = G.lw, pick = this.pick, pickM = null, latestM = null, pl = this.prevLatest, i, m;
    var seg = function (a, ra, rb) { g.beginPath(); g.moveTo(X(a, ra), Y(a, ra)); g.lineTo(X(a, rb), Y(a, rb)); g.stroke(); };
    for (i = 0; i < n; i++) {
      m = marks[i];
      var grow = 1;
      m.a = A(m.t); m.L = G.Lmin + m.f * (G.Lmax - G.Lmin);
      if (ip < 1) grow = ease((ip - (i / Math.max(1, n - 1)) * 0.74) / 0.26);
      if (m.b.born && !RM) {
        var e = (now - m.b.born) / 1100;
        if (e < 1) { anim = true; grow *= e < 0 ? 0 : ease(e); }
      }
      m.grow = grow;
      if (m.b === pick) pickM = m;
      if (m.b === latest) latestM = m;
    }
    this.marks = marks;

    // behind the marks: a light-blue capsule for the block being read, and a brief one that
    // blooms and fades behind each new arrival
    var cap = Math.max(6, lw * 5);
    g.lineCap = "round";
    if (pickM) { g.strokeStyle = rgba(C.tint, 1); g.lineWidth = cap; seg(pickM.a, r0 - 1, r0 + pickM.L + 1); }
    if (!RM) for (i = 0; i < n; i++) {
      m = marks[i];
      if (!m.b.born || m.b === pick) continue;
      var q = (now - m.b.born - 150) / 1900;
      if (q >= 1) continue;
      anim = true;
      if (q <= 0) continue;
      g.strokeStyle = rgba(C.tint, Math.min(1, q * 6) * Math.pow(1 - q, 1.4));
      g.lineWidth = cap * (0.6 + 0.9 * ease(Math.min(1, q * 2.5)));
      seg(m.a, r0 - 1, r0 + m.L * m.grow + 1);
    }

    g.lineWidth = lw;
    for (i = 0; i < n; i++) {
      m = marks[i];
      var b = m.b;
      if (b === latest || b === pick || m.grow <= 0.001) continue;
      var alpha = 0.2 + 0.62 * Math.pow(1 - clamp((tNow - b.t) / DAY, 0, 1), 1.2), col = C.ink;
      // the last two hours lean toward the accent, the newest most: the grey the mark would
      // show on the page is blended toward the accent, so the blue stays clean, never navy
      var fresh = Math.sqrt(1 - clamp((tNow - b.t) / FRESH, 0, 1));
      if (fresh > 0) { col = mix(mix(C.bg, C.ink, alpha), C.accent, fresh); alpha = 1; }
      if (pl && pl.b === b && !RM) {
        var pk = clamp((now - pl.at) / 900, 0, 1);
        if (pk < 1) { anim = true; col = mix(C.accent, col, ease(pk)); alpha = 1 + (alpha - 1) * ease(pk); }
      }
      g.strokeStyle = rgba(col, alpha * (1 - 0.62 * dim));
      seg(m.a, r0, r0 + m.L * m.grow);
    }

    // the latest block, in the accent and a touch heavier
    if (latestM && latestM.grow > 0.001 && latestM !== pickM) {
      g.strokeStyle = rgba(C.accent, 1 - 0.45 * dim); g.lineWidth = lw * 1.4;
      seg(latestM.a, r0, r0 + latestM.L * latestM.grow);
    }

    // 4. the block being read: an accent hairline over its capsule
    if (pickM) { g.strokeStyle = rgba(C.accent, 1); g.lineWidth = lw * (pickM === latestM ? 1.4 : 1.2); seg(pickM.a, r0, r0 + pickM.L * pickM.grow); }
    if (this.pick && !pickM) this.setPick(null, false);
    return anim;
  };

  // Loading: a comb of even hairlines where the blocks will be and a shallow band where the
  // hashrate will run, with a slow highlight travelling round. Failure: the same, paler and still.
  Clock.prototype.drawEmpty = function (now, down) {
    var G = this.G, g = this.g, c = G.c, C = this.C, n = 144, i;
    var live = !down && !reduced(), head = live ? (now / 2600) % 1 * TAU - QUARTER : 0;
    var r0 = G.b0 + G.gap, r1 = r0 + G.Lmin + (G.Lmax - G.Lmin) * 0.34;
    g.fillStyle = rgba(C.soft, down ? 0.7 : 1);
    g.beginPath(); g.arc(c, c, G.h0 + (G.h1 - G.h0) * 0.42, 0, TAU); g.arc(c, c, G.h0, TAU, 0, true); g.fill();
    g.lineWidth = G.lw;
    for (i = 0; i < n; i++) {
      var a = i / n * TAU - QUARTER, glow = 0;
      if (live) { var da = Math.abs(((a - head) % TAU + TAU + Math.PI) % TAU - Math.PI); glow = Math.exp(-(da * da) / 0.09); }
      g.strokeStyle = rgba(glow > 0.02 ? mix(C.line, C.muted, 0.35 * glow) : C.line, down ? 0.75 : 1);
      g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    }
    return live;
  };

  /* ── the frame loop: runs only while something moves and the dial is on screen ── */
  Clock.prototype.kick = function () {
    var self = this;
    if (this.raf !== null || !this.onscreen || doc.hidden) return;
    this.raf = root.requestAnimationFrame(function (t) {
      self.raf = null;
      if (!self.onscreen || doc.hidden) return;
      if (self.draw(t)) self.kick();
    });
  };

  // once a second: the time since the block, the present marker and the sweep
  Clock.prototype.second = function () {
    if (doc.hidden || !this.G) return;
    var tNow = Date.now() / 1000;
    this.renderSince();
    this.hands(tNow, false);
    if (this.onscreen && this.raf === null) {
      var now = clock();
      if (!reduced() || now - this.lastDraw > 30000) this.draw(now);
    }
  };

  /* ── words: centre readout, caption, status, and what a screen reader hears ── */
  Clock.prototype.renderSince = function () {
    var b = this.feed.latest();
    if (!b || (this.pick && this.pick !== b)) return;
    var txt = "Found " + spell(Date.now() / 1000 - b.t) + " ago";
    if (this.t.s.textContent !== txt) this.t.s.textContent = txt;
  };

  Clock.prototype.setHeight = function (txt, animate) {
    var box = this.t.h, cur = box.querySelector(".bc-hv:not(.bc-out)");
    if (cur && cur.textContent === txt) return;
    if (!animate || !cur || reduced()) {
      box.innerHTML = "";
      var s = doc.createElement("span"); s.className = "bc-hv"; s.textContent = txt; box.appendChild(s);
      return;
    }
    Array.prototype.forEach.call(box.querySelectorAll(".bc-out"), function (x) { x.remove(); });
    cur.classList.add("bc-out");
    var n = doc.createElement("span"); n.className = "bc-hv bc-in"; n.textContent = txt; box.appendChild(n);
    setTimeout(function () { if (cur.parentNode) cur.remove(); n.classList.remove("bc-in"); }, 760);
  };

  // the hashrate key: the latest estimate, or the value at the block being read
  Clock.prototype.renderHash = function () {
    var F = this.feed, ring = F.blocks.length && this.G ? this.ring(Date.now() / 1000) : null, at = this.pick ? this.ringAt(this.pick.t) : null;
    var txt = at ? "Hashrate " + hashFmt(at.v) + " at " + hm(this.pick.t) + " UTC" :
      ring ? "Hashrate " + hashFmt(ring.now) + ", last " + this.o.window + " blocks" : F.blocks.length ? "Hashrate unavailable" : "Hashrate from block times";
    if (this.t.hash.textContent !== txt) this.t.hash.textContent = txt;
  };

  Clock.prototype.renderCore = function (animate) {
    var F = this.feed, latest = F.latest(), b = this.pick || latest, t = this.t, el = this.el;
    // reading an earlier block: its own time, and no dollar figure (today's price would mislead)
    var older = !!this.pick && this.pick !== latest;
    this.renderHash();
    el.classList.toggle("is-loading", !b && F.status === "loading");
    el.classList.toggle("is-down", !b && F.status === "down");
    el.classList.toggle("is-picking", !!this.pick);
    if (!b) return;
    t.k.textContent = older ? "Block" : "Latest block";
    this.setHeight(fmt(b.h, 0), animate && !this.pick);
    if (older) t.s.textContent = "Found " + hm(b.t) + " UTC";
    else this.renderSince();
    var p = F.price, live = !older && p > 0;
    t.rv.textContent = isNum(b.reward) ? btc(b.reward) : "Unavailable";
    t.fv.textContent = isNum(b.fees) ? btc(b.fees) : "Unavailable";
    t.ru.textContent = live && isNum(b.reward) ? usd(b.reward / 1e8 * p) : older ? "\u200b" : "USD unavailable";
    t.fu.textContent = live && isNum(b.fees) ? usd(b.fees / 1e8 * p) : "\u200b";
  };

  Clock.prototype.describe = function (b, withAge) {
    return "Block " + fmt(b.h, 0) + ", found at " + hm(b.t) + " UTC" + (withAge ? ", " + spellLong(Date.now() / 1000 - b.t) + " ago" : "") +
      (isNum(b.reward) ? ". Reward " + fmt(b.reward / 1e8, 4) + " BTC" : "") + (isNum(b.fees) ? ", fees " + fmt(b.fees / 1e8, 4) + " BTC." : ".");
  };

  Clock.prototype.renderAria = function () {
    var F = this.feed, lay = F.blocks.length && this.G ? this.layout(Date.now() / 1000) : null, h = this.hit;
    var order = lay ? lay.marks.map(function (m) { return m.b; }) : [];
    this.order = order;
    var latest = F.latest();
    h.setAttribute("aria-valuemax", String(Math.max(1, order.length)));
    if (!latest) { h.setAttribute("aria-valuenow", "1"); h.setAttribute("aria-valuetext", F.status === "down" ? "Unavailable" : "Loading"); return; }
    var b = this.pick || latest, i = order.indexOf(b);
    h.setAttribute("aria-valuenow", String(i < 0 ? Math.max(1, order.length) : i + 1));
    h.setAttribute("aria-valuetext", (b === latest ? "Latest. " : "") + this.describe(b, b === latest));
  };

  Clock.prototype.renderText = function (animate) {
    var F = this.feed, t = this.t, lay = F.blocks.length && this.G ? this.layout(Date.now() / 1000) : null;
    var up = F.updated ? hm(F.updated / 1000) + " UTC" : "";
    t.status.textContent =
      F.status === "live" ? "Live from mempool.space, updated " + up :
      F.status === "stale" ? "From mempool.space" + (up ? ", updated " + up : "") + ", partly unavailable" :
      F.status === "down" ? "Unavailable from mempool.space, retrying each minute" : "Loading from mempool.space";
    this.el.setAttribute("data-status", F.status);
    t.count.textContent = lay ? fmt(lay.count, 0) + " blocks in 24 h, length by fees" : "Blocks in 24 h, length by fees";
    this.renderCore(!!animate);
    this.renderAria();
  };

  Clock.prototype.say = function (msg) {
    var live = this.t.live;
    live.textContent = "";
    setTimeout(function () { live.textContent = msg; }, 60);
  };

  /* ── data events ─────────────────────────────────────────────────────── */
  Clock.prototype.onFeed = function (kind, added) {
    var F = this.feed, now = clock(), self = this;
    this._lay = null; this._ring = null;
    if (kind === "arrive" && added.length) {
      var newest = added[added.length - 1], prior = null;
      for (var i = F.blocks.length - 1; i >= 0; i--) if (F.blocks[i].h < added[0].h) { prior = F.blocks[i]; break; }
      if (prior) {
        this.prevLatest = { b: prior, at: newest.born || now };
        this.sweepAnim = { from: prior.t, to: newest.t, at: newest.born || now };
      }
      this.renderText(true);
      this.say("New block " + fmt(newest.h, 0) + " found at " + hm(newest.t) + " UTC" + (isNum(newest.reward) ? ", reward " + fmt(newest.reward / 1e8, 4) + " BTC." : "."));
    } else {
      this.renderText();
      if (kind === "load" && F.blocks.length && !this.introDone && this.introAt === null) {
        this.introAt = reduced() ? null : now + 120;
        if (reduced()) this.introDone = true;
        var lay = this.layout(Date.now() / 1000), l = F.latest();
        if (l) this.say("In the last 24 hours the network found " + lay.count + " blocks. The latest, block " + fmt(l.h, 0) + ", was found at " + hm(l.t) + " UTC.");
      }
    }
    this.el.classList.toggle("is-ready", F.blocks.length > 0);
    this.draw(now);
    this.kick();
  };

  /* ── reading blocks: pointer, touch and keyboard ─────────────────────── */
  Clock.prototype.setPick = function (b, announce) {
    b = b || null;
    if (b === this.pick) return;
    var now = clock();
    this.dim = { v: this.dim.v, from: this.dim.v, to: b ? 1 : 0, at: now };
    this.pick = b;
    this.pickChanged = true;
    this.renderCore(false);
    this.renderAria();
    this.hands(Date.now() / 1000, true);
    if (announce === "live" && b) this.say(this.describe(b, false));
    this.draw(now);
    this.kick();
  };

  Clock.prototype.at = function (clientX, clientY) {
    var G = this.G, r = this.stage.getBoundingClientRect();
    if (!G || !this.marks.length) return null;
    var x = clientX - r.left - G.c, y = clientY - r.top - G.c, d = Math.sqrt(x * x + y * y);
    if (d < G.h0 - 6 || d > G.R + 22) return null;
    var a = Math.atan2(y, x), best = null, bd = Infinity;
    this.marks.forEach(function (m) {
      if (!isNum(m.a)) return;
      var da = Math.abs(((m.a - a) % TAU + TAU + Math.PI) % TAU - Math.PI);
      if (da < bd) { bd = da; best = m.b; }
    });
    return bd * G.b0 <= Math.max(10, G.R * 0.045) ? best : null;
  };

  Clock.prototype.bind = function () {
    var self = this, h = this.hit, down = null;
    h.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      self.setPick(self.at(e.clientX, e.clientY), false);
    });
    h.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch" && doc.activeElement !== h) self.setPick(null, false); });
    h.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY, at: Date.now(), type: e.pointerType }; });
    h.addEventListener("pointerup", function (e) {
      if (!down || down.type === "mouse") { down = null; return; }
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      if (moved < 12 && Date.now() - down.at < 700) {
        var b = self.at(e.clientX, e.clientY);
        self.setPick(b && b !== self.pick ? b : null, "live");
      }
      down = null;
    });
    h.addEventListener("keydown", function (e) {
      var order = self.order.length ? self.order : [], n = order.length;
      if (!n) return;
      var i = self.pick ? order.indexOf(self.pick) : n - 1;
      var k = e.key, next = null;
      if (k === "ArrowLeft" || k === "ArrowDown") next = self.pick ? Math.max(0, i - 1) : Math.max(0, n - 2);
      else if (k === "ArrowRight" || k === "ArrowUp") next = self.pick ? Math.min(n - 1, i + 1) : n - 1;
      else if (k === "PageDown") next = Math.max(0, i - 6);
      else if (k === "PageUp") next = Math.min(n - 1, i + 6);
      else if (k === "Home") next = 0;
      else if (k === "End") next = n - 1;
      else if (k === "Escape") { if (self.pick) { e.preventDefault(); self.setPick(null, false); } return; }
      else return;
      e.preventDefault();
      self.setPick(order[next], false);
    });
    h.addEventListener("blur", function () { self.setPick(null, false); });

    if (root.ResizeObserver) { this.ro = new ResizeObserver(function () { self.measure(); }); this.ro.observe(this.stage); }
    else root.addEventListener("resize", function () { self.measure(); });
    if (root.IntersectionObserver) {
      this.io = new IntersectionObserver(function (es) {
        self.onscreen = es[es.length - 1].isIntersecting;
        if (self.onscreen) { self.draw(clock()); self.kick(); }
      }, { rootMargin: "120px" });
      this.io.observe(this.stage);
    }
    this.onVis = function () { if (!doc.hidden) { self.hands(Date.now() / 1000, true); self.draw(clock()); self.kick(); } };
    doc.addEventListener("visibilitychange", this.onVis);
    this.onMotion = function () { self.draw(clock()); self.kick(); };
    if (mq && mq.addEventListener) mq.addEventListener("change", this.onMotion);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { self.hands(Date.now() / 1000, true); });
  };

  Clock.prototype.destroy = function () {
    this.feed.unsubscribe(this);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    doc.removeEventListener("visibilitychange", this.onVis);
    if (mq && mq.removeEventListener) mq.removeEventListener("change", this.onMotion);
    if (this.raf !== null) root.cancelAnimationFrame(this.raf);
    all = all.filter(function (c) { return c !== this; }, this);
    this.el.innerHTML = "";
    this.el.removeAttribute("data-block-clock-mounted");
    this.el.__blockClock = null;
  };

  setInterval(function () { all.forEach(function (c) { c.second(); }); }, 1000);

  /* ── public API ──────────────────────────────────────────────────────── */
  function mount(el, options) {
    if (!el || el.nodeType !== 1) return null;
    if (el.__blockClock) return el.__blockClock.api;
    var ds = el.dataset || {}, o = {};
    options = options || {};
    o.api = options.api || ds.api || DEFAULTS.api;
    o.poll = Math.max(60000, Number(options.poll || ds.poll) || DEFAULTS.poll);
    o.window = Math.round(clamp(Number(options.window || ds.window) || DEFAULTS.window, 24, 432));
    var c = new Clock(el, o);
    all.push(c);
    c.api = {
      el: el,
      pick: function (height) {
        var b = null;
        c.feed.blocks.forEach(function (x) { if (x.h === height) b = x; });
        c.setPick(b && c.markOf(b) ? b : null, "live");
        return !!c.pick;
      },
      latest: function () { var b = c.feed.latest(); return b ? { height: b.h, time: b.t, reward: b.reward, fees: b.fees } : null; },
      replayLatest: function (delay) { return c.feed.replay(delay); },
      refresh: function () { if (!c.feed.busy) c.feed.load(); },
      destroy: function () { c.destroy(); }
    };
    el.__blockClock = c;
    return c.api;
  }

  function mountAll(scope) {
    return Array.prototype.map.call((scope || doc).querySelectorAll("[data-block-clock]"), function (el) { return mount(el); });
  }

  root.OmnesBlockClock = {
    mount: mount,
    mountAll: mountAll,
    instances: function () { return all.map(function (c) { return c.api; }); },
    // what the page holds for each block, for inspection: five numbers, nothing else
    records: function () { var out = []; Object.keys(feeds).forEach(function (k) { out = out.concat(feeds[k].blocks.map(function (b) { return { h: b.h, t: b.t, reward: b.reward, fees: b.fees, d: b.d }; })); }); return out; },
    _feeds: feeds
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { mountAll(); });
  else mountAll();
})(typeof window !== "undefined" ? window : null, typeof document !== "undefined" ? document : null);
