import {geoOrthographic, geoEqualEarth, geoPath, geoGraticule10, geoInterpolate, geoContains, geoBounds, geoDistance, feature, mesh} from './vendor.js';
import {COUNTRIES} from './countries.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const META = Object.fromEntries(COUNTRIES.map(c => [c.c, c]));
// micro-states (hard to tap) or absent from the map: draw a marker
const MICRO = COUNTRIES.filter(c => c.a < 2700 || c.c === 'TV').map(c => c.c);

function makeGrain(ctx) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 180; const x = c.getContext('2d'); const d = x.createImageData(180, 180);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 40 + Math.random() * 60 | 0; }
    x.putImageData(d, 0, 0); return ctx.createPattern(c, 'repeat');
  } catch { return null; }
}
const ORDER = ['other', 'land', 'w', 'h1', 'h2', 'h3', 'h4', 'h5', 'v', 'l'];
function colorOf(key, C) { return key === 'v' ? C.visited : key === 'l' ? C.lived : key === 'w' ? C.wishFill : key === 'other' ? C.land2 : key[0] === 'h' ? C[key] : C.land; }
function dotOf(key, C) { return key === 'v' ? C.visited : key === 'l' ? C.lived : key === 'w' ? C.wish : key && key[0] === 'h' ? C[key] : C.marker; }
function spanDeg(code) { const m = META[code]; return m ? Math.sqrt(m.a) / 111 : 10; }


const D2R = Math.PI / 180;
function toVec(ring) {
  const a = new Float32Array(ring.length * 3);
  for (let i = 0; i < ring.length; i++) {
    const l = ring[i][0] * D2R, p = ring[i][1] * D2R, cp = Math.cos(p);
    a[i * 3] = cp * Math.cos(l); a[i * 3 + 1] = cp * Math.sin(l); a[i * 3 + 2] = Math.sin(p);
  }
  return a;
}
function cap(arrs) {
  let x = 0, y = 0, z = 0;
  for (const a of arrs) for (let i = 0; i < a.length; i += 3) { x += a[i]; y += a[i + 1]; z += a[i + 2]; }
  const n = Math.hypot(x, y, z) || 1; x /= n; y /= n; z /= n;
  let minDot = 1;
  for (const a of arrs) for (let i = 0; i < a.length; i += 3) { const d = a[i] * x + a[i + 1] * y + a[i + 2] * z; if (d < minDot) minDot = d; }
  const rad = Math.acos(Math.max(-1, Math.min(1, minDot)));
  return {x, y, z, sinR: Math.sin(Math.min(rad, Math.PI / 2)), big: rad >= Math.PI / 2};
}
function prepFast(feats, borders, coast) {
  const out = [];
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const rings = []; for (const poly of polys) for (const r of poly) rings.push(toVec(r));
    out.push({f, code: f.code, rings, c: cap(rings)});
  }
  return {feats: out, borders: prepLines(borders.coordinates), coast: prepLines(coast.coordinates)};
}
function prepLines(lines) { return lines.map(l => { const a = toVec(l); return {a, c: cap([a])}; }); }

export class WorldMap {
  constructor(stage, canvas, opts) {
    this.stage = stage; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts; // {getStatus, onSelect, onRotate, onTapEmpty}
    this.mode = 'globe';
    this.rot = [-2, -30, 0]; this.k = 1; this.kMin = .8;
    this.tx = 0; this.ty = 0; this.fk = 1; // flat transform
    this.selected = null; this.pulses = []; this.anim = null; this.inertia = null;
    this.auto = true; this.autoPause = 0; this.moving = false; this.visible = true;
    this.pointers = new Map();
    this.colors = {};
    this.proj = geoOrthographic().clipAngle(90).precision(.6);
    this.path = geoPath(this.proj, this.ctx);
    this.grat = geoGraticule10();
    this.hit = document.createElement('canvas').getContext('2d');
    this.ready = false;
    this.last = performance.now();
    this._loop = this._loop.bind(this);
    this._bind();
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
  }

  async load(base = 'data/') {
    const lite = await fetch(base + 'world-lite.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    this._setTopo('lite', lite);
    this.ready = true; this.opts.onReady && this.opts.onReady(); this.request();
    const full = await fetch(base + 'world-50m.json').then(r => r.json());
    this._setTopo('full', full);
    this._buildFlat();
    this.request();
  }

  _setTopo(kind, topo) {
    const obj = topo.objects.countries;
    const feats = feature(topo, obj).features;
    for (const f of feats) f.code = f.id;
    const borders = mesh(topo, obj, (a, b) => a !== b);
    const coast = mesh(topo, obj, (a, b) => a === b);
    this[kind] = {feats, borders, coast};
    this[kind].fast = prepFast(feats, borders, coast);
    if (!this.gratFast) this.gratFast = prepLines(this.grat.coordinates);
    if (kind === 'full') {
      for (const f of feats) { f.bb = geoBounds(f); }
    }
  }

  _buildFlat() {
    const feats = this.full.feats.filter(f => f.code !== '-010');
    const proj = geoEqualEarth().rotate([-10, 0]).fitExtent([[0, 0], [1000, 1000 * .487]], {type: 'Sphere'});
    this.fproj = proj;
    const sp = geoPath(proj);
    const toP = d => new Path2D(sp(d) || '');
    this.flat = {
      feats: feats.map(f => { const b = sp.bounds(f); return {code: f.code, p: toP(f), b}; }),
      borders: toP(this.full.borders), coast: toP(this.full.coast),
      sphere: toP({type: 'Sphere'}), grat: toP(this.grat),
      h: sp.bounds({type: 'Sphere'})[1][1],
    };
  }

  setColors(c) { this.colors = c; this.request(); }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    this.r0 = Math.min(this.w * .44, this.h * .32);
    this.cy = this.h * .46;
    if (this._flatInit !== this.w) { this._flatInit = this.w; this.resetFlat(false); }
    this.request();
  }

  setMode(m, animate = true) {
    if (m === this.mode) return;
    this.mode = m;
    if (animate) { this.intro = {t0: performance.now(), d: 520}; }
    this.request();
  }

  // ---------- render loop ----------
  request() { if (!this.raf) this.raf = requestAnimationFrame(this._loop); }
  _loop(now) {
    this.raf = 0;
    const dt = Math.min(64, now - this.last); this.last = now;
    let more = false;
    if (this.anim) { more = true; const a = this.anim, t = clamp((now - a.t0) / a.d, 0, 1); a.step(a.ease(t), t); if (t >= 1) { this.anim = null; a.done && a.done(); } }
    if (this.inertia) {
      more = true; const v = this.inertia; const f = Math.pow(.92, dt / 16);
      v.x *= f; v.y *= f;
      this._dragBy(v.x * dt, v.y * dt);
      if (Math.abs(v.x) + Math.abs(v.y) < .01) this.inertia = null;
    }
    const canAuto = this.mode === 'globe' && this.auto && !this.selected && !this.pointers.size && !this.anim && !this.inertia && now > this.autoPause && this.visible && !this.reduced;
    if (canAuto) { this.rot[0] += dt * .006; more = true; this.opts.onRotate && this.opts.onRotate(this.rot); }
    if (this.pulses.length) { more = true; this.pulses = this.pulses.filter(p => now - p.t0 < p.d); }
    if (this.intro) { more = true; if (now - this.intro.t0 > this.intro.d) this.intro = null; }
    this.moving = more || this.pointers.size > 0;
    this.draw(now);
    if (more) this.request();
    else if (this._wasMoving) { this._wasMoving = false; this.request(); } // one crisp frame with full detail
    if (more) this._wasMoving = true;
  }

  draw(now = performance.now()) {
    const {ctx, dpr} = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.ready) return;
    let a = 1, s = 1;
    if (this.intro) { const t = easeOut(clamp((now - this.intro.t0) / this.intro.d, 0, 1)); a = t; s = .92 + .08 * t; }
    ctx.globalAlpha = a;
    if (this.mode === 'globe') this._drawGlobe(now, s); else this._drawFlat(now, s);
    ctx.globalAlpha = 1;
  }

  _group(feats) {
    const g = {land: [], v: [], l: [], w: [], other: []};
    const st = this.opts.getStatus;
    for (const f of feats) {
      if (f.code[0] === '-') { g.other.push(f); continue; }
      const s = st(f.code); (g[s] || g.land).push(f);
    }
    return g;
  }

  _drawGlobe(now, s) {
    const {ctx, colors: C} = this;
    const cx = this.w / 2, cy = this.cy;
    const r = this.r0 * this.k * s;
    const p = this.proj.scale(r).translate([cx, cy]).rotate(this.rot);
    const path = this.path;
    const data = !this.full ? this.lite : (this.moving && this.k < 2 ? this.lite : this.full);
    // atmosphere
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(this.w - cx, cy), Math.hypot(cx, this.h - cy), Math.hypot(this.w - cx, this.h - cy));
    const covers = r > far + 2;
    let g;
    if (!covers) {
      const R = r * 1.42;
      g = ctx.createRadialGradient(cx, cy, r * .97, cx, cy, R);
      g.addColorStop(0, C.glow1); g.addColorStop(.09, C.glowMid); g.addColorStop(.4, C.glow2); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Math.min(R, far + 4), 0, TAU); ctx.fill();
    }
    // ocean
    if (this.k > 2.2) ctx.fillStyle = C.ocean1;
    else { g = ctx.createRadialGradient(cx - r * .4, cy - r * .45, r * .05, cx, cy, r * 1.02); g.addColorStop(0, C.ocean1); g.addColorStop(1, C.ocean2); ctx.fillStyle = g; }
    if (covers) ctx.fillRect(0, 0, this.w, this.h); else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
    // paper-like grain on the sea (screen-space, very subtle)
    if (!this._grain) this._grain = makeGrain(ctx);
    if (this._grain && C.grain) { ctx.save(); ctx.globalAlpha = +C.grain || 0; ctx.fillStyle = this._grain; if (covers) ctx.fillRect(0, 0, this.w, this.h); else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); } ctx.restore(); }
    // view basis
    const TOL = this.moving ? 1.1 : 0.6;
    const zoomedIn = this.k > 1.6, W = this.w, H = this.h;
    const lc = -this.rot[0] * D2R, pc = -this.rot[1] * D2R;
    const cl = Math.cos(lc), sl = Math.sin(lc), cpc = Math.cos(pc), spc = Math.sin(pc);
    const V = [cpc * cl, cpc * sl, spc], E = [-sl, cl, 0], N = [-spc * cl, -spc * sl, cpc];
    this._basis = {V, E, N, cx, cy, r};
    const lines = (list) => {
      for (const L of list) {
        const c = L.c; const dc = c.x * V[0] + c.y * V[1] + c.z * V[2];
        if (!c.big && dc < -c.sinR) continue;
        if (zoomedIn && !c.big) { const X0 = cx + r * (c.x * E[0] + c.y * E[1] + c.z * E[2]), Y0 = cy - r * (c.x * N[0] + c.y * N[1] + c.z * N[2]), rr = r * c.sinR + 4; if (X0 + rr < 0 || X0 - rr > W || Y0 + rr < 0 || Y0 - rr > H) continue; }
        const a = L.a; let pen = false, lx = 0, ly = 0; const n3 = a.length - 3;
        for (let i = 0; i < a.length; i += 3) {
          const x = a[i], y = a[i + 1], z = a[i + 2];
          if (x * V[0] + y * V[1] + z * V[2] <= 0.0) { pen = false; continue; }
          const X = cx + r * (x * E[0] + y * E[1] + z * E[2]), Y = cy - r * (x * N[0] + y * N[1] + z * N[2]);
          if (pen) { if (i === n3 || Math.abs(X - lx) + Math.abs(Y - ly) > TOL) { ctx.lineTo(X, Y); lx = X; ly = Y; } }
          else { ctx.moveTo(X, Y); pen = true; lx = X; ly = Y; }
        }
      }
    };
    ctx.beginPath(); lines(this.gratFast); ctx.strokeStyle = C.grat; ctx.lineWidth = .6; ctx.stroke();
    const fast = data.fast;
    const st = this.opts.getStatus;
    const groups = {}; for (const k of ORDER) groups[k] = [];
    for (const F of fast.feats) {
      const c = F.c; const dc = c.x * V[0] + c.y * V[1] + c.z * V[2];
      if (!c.big && dc < -c.sinR) continue; // hidden
      if (zoomedIn && !c.big) { const X0 = cx + r * (c.x * E[0] + c.y * E[1] + c.z * E[2]), Y0 = cy - r * (c.x * N[0] + c.y * N[1] + c.z * N[2]), rr = r * c.sinR + 4; if (X0 + rr < 0 || X0 - rr > W || Y0 + rr < 0 || Y0 - rr > H) continue; }
      const key = F.code[0] === '-' ? 'other' : (st(F.code) || 'land');
      (groups[key] || groups.land).push(F);
      F.vis = !c.big && dc > c.sinR + 0.01; // fully in front
    }
    const drawFeat = F => {
      if (F.c.big && this.useD3Big === true) { path(F.f); return; }
      const clampIt = !F.vis;
      for (const a of F.rings) {
        let lx = 0, ly = 0, fx = 0, fy = 0;
        for (let i = 0; i < a.length; i += 3) {
          const x = a[i], y = a[i + 1], z = a[i + 2];
          let X = x * E[0] + y * E[1] + z * E[2], Y = x * N[0] + y * N[1] + z * N[2];
          if (clampIt && x * V[0] + y * V[1] + z * V[2] < 0) { const h = Math.hypot(X, Y) || 1; X /= h; Y /= h; }
          X = cx + r * X; Y = cy - r * Y;
          if (!i) { ctx.moveTo(X, Y); lx = fx = X; ly = fy = Y; }
          else if (Math.abs(X - lx) + Math.abs(Y - ly) > TOL) { ctx.lineTo(X, Y); lx = X; ly = Y; }
        }
        ctx.lineTo(fx, fy);
      }
    };
    this._drawFeat = drawFeat;
    const fillGroup = (list, color) => { if (!list.length) return; ctx.beginPath(); for (const F of list) drawFeat(F); ctx.fillStyle = color; ctx.fill(); };
    for (const k of ORDER) fillGroup(groups[k], colorOf(k, C));
    ctx.beginPath(); lines(fast.borders); ctx.strokeStyle = C.border; ctx.lineWidth = .7; ctx.stroke();
    ctx.beginPath(); lines(fast.coast); ctx.strokeStyle = C.coast; ctx.lineWidth = .6; ctx.stroke();
    if (C.vedge && (groups.v.length || groups.l.length)) { ctx.beginPath(); for (const F of groups.v) drawFeat(F); for (const F of groups.l) drawFeat(F); ctx.strokeStyle = C.vedge; ctx.lineWidth = .8; ctx.stroke(); }
    if (groups.w.length) { ctx.beginPath(); for (const F of groups.w) drawFeat(F); ctx.strokeStyle = C.wish; ctx.lineWidth = 1; ctx.stroke(); }
    const byCode = code => fast.feats.filter(F => F.code === code && (F.c.big || (F.c.x * V[0] + F.c.y * V[1] + F.c.z * V[2]) >= -F.c.sinR));
    // pulses (country flash)
    for (const pl of this.pulses) {
      const t = (now - pl.t0) / pl.d;
      const fs = byCode(pl.code);
      if (fs.length) { ctx.beginPath(); for (const F of fs) drawFeat(F); ctx.globalAlpha = (1 - t) * .9; ctx.fillStyle = C.flash; ctx.fill(); ctx.globalAlpha = 1; }
    }
    // selection
    if (this.selected) {
      const fs = byCode(this.selected);
      if (fs.length) {
        ctx.beginPath(); for (const F of fs) drawFeat(F);
        ctx.save(); ctx.shadowColor = C.selGlow; ctx.shadowBlur = 14; ctx.strokeStyle = C.sel; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      }
    }
    // markers for micro-states
    this._markers = [];
    const center = [-this.rot[0], -this.rot[1]];
    for (const code of MICRO) {
      const m = META[code]; const ll = [m.ll[1], m.ll[0]];
      if (geoDistance(center, ll) > 1.45) continue;
      const xy = p(ll); this._drawMarker(xy, code, r);
    }
    // ring pulses
    for (const pl of this.pulses) {
      const m = META[pl.code]; const ll = [m.ll[1], m.ll[0]];
      if (geoDistance(center, ll) > 1.5) continue;
      this._ring(p(ll), (now - pl.t0) / pl.d, pl.color);
    }
    // 3D shading + rim
    if (this.k > 2.6) return;
    this._light(ctx, cx, cy, r, C);
  }
  _light(ctx, cx, cy, r, C) {
    // soft key light from upper-left + limb darkening
    let g = ctx.createRadialGradient(cx - r * .38, cy - r * .42, 0, cx - r * .1, cy - r * .1, r * 1.12);
    g.addColorStop(0, C.light); g.addColorStop(.5, 'rgba(0,0,0,0)'); g.addColorStop(.82, 'rgba(0,0,0,0)'); g.addColorStop(1, C.shade);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    // terminator: gentle night side toward lower-right
    if (C.night) { g = ctx.createLinearGradient(cx - r * .7, cy - r * .7, cx + r * .75, cy + r * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.58, 'rgba(0,0,0,0)'); g.addColorStop(1, C.night); ctx.fillStyle = g; ctx.fill(); }
    // atmospheric haze just inside the limb
    if (C.haze) { g = ctx.createRadialGradient(cx, cy, r * .78, cx, cy, r); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, C.haze); ctx.fillStyle = g; ctx.fill(); }
    ctx.beginPath(); ctx.arc(cx, cy, r - .5, 0, TAU); ctx.strokeStyle = C.rim; ctx.lineWidth = 1; ctx.stroke();
    // rim light on the lit edge
    if (C.rimlight) { g = ctx.createLinearGradient(cx - r, cy - r, cx + r * .2, cy + r * .2); g.addColorStop(0, C.rimlight); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.beginPath(); ctx.arc(cx, cy, r - 1, Math.PI * .72, Math.PI * 1.78); ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'; }
  }

  _drawMarker(xy, code, scale) {
    const {ctx, colors: C} = this; const s = this.opts.getStatus(code);
    const zoomed = this.mode === 'globe' ? this.k > 2.2 : this.fk > 2.6;
    if (!s && !zoomed && code !== this.selected) { this._markers.push({code, x: xy[0], y: xy[1], hidden: true}); return; }
    const rad = s ? 3.4 : 2.4;
    const col = dotOf(s, C);
    ctx.beginPath(); ctx.arc(xy[0], xy[1], rad + 2.2, 0, TAU); ctx.fillStyle = C.markerHalo; ctx.fill();
    ctx.beginPath(); ctx.arc(xy[0], xy[1], rad, 0, TAU); ctx.fillStyle = col; ctx.fill();
    if (code === this.selected) { ctx.beginPath(); ctx.arc(xy[0], xy[1], rad + 5, 0, TAU); ctx.strokeStyle = C.sel; ctx.lineWidth = 1.5; ctx.stroke(); }
    this._markers.push({code, x: xy[0], y: xy[1]});
  }

  _ring(xy, t, color) {
    const {ctx} = this; const e = easeOut(t);
    ctx.beginPath(); ctx.arc(xy[0], xy[1], 6 + e * 46, 0, TAU);
    ctx.strokeStyle = color; ctx.globalAlpha = (1 - t) * .9; ctx.lineWidth = 2 * (1 - t) + .5; ctx.stroke();
    ctx.beginPath(); ctx.arc(xy[0], xy[1], 4 + e * 24, 0, TAU); ctx.globalAlpha = (1 - t) * .5; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _flatBase() { return (this.w - 20) / 1000; }
  _drawFlat(now, s) {
    const {ctx, colors: C, dpr} = this;
    if (!this.flat) { return; }
    const F = this.flat; const b = this._flatBase();
    const k = this.fk * b * s;
    const ox = this.tx + (1 - s) * this.w / 2, oy = this.ty + (1 - s) * this.h / 2;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    const px = 1 / k;
    const g = ctx.createLinearGradient(0, 0, 0, F.h);
    g.addColorStop(0, C.ocean1); g.addColorStop(1, C.ocean2);
    ctx.fillStyle = g; ctx.fill(F.sphere);
    ctx.strokeStyle = C.grat; ctx.lineWidth = .6 * px; ctx.stroke(F.grat);
    const groups = {}; for (const k of ORDER) groups[k] = new Path2D();
    const st = this.opts.getStatus;
    for (const f of F.feats) { const key = f.code[0] === '-' ? 'other' : (st(f.code) || 'land'); (groups[key] || groups.land).addPath(f.p); }
    for (const k of ORDER) { ctx.fillStyle = colorOf(k, C); ctx.fill(groups[k]); }
    ctx.strokeStyle = C.border; ctx.lineWidth = .7 * px; ctx.stroke(F.borders);
    ctx.strokeStyle = C.coast; ctx.lineWidth = .6 * px; ctx.stroke(F.coast);
    ctx.strokeStyle = C.wish; ctx.lineWidth = 1 * px; ctx.stroke(groups.w);
    ctx.strokeStyle = C.rim; ctx.lineWidth = 1 * px; ctx.stroke(F.sphere);
    for (const pl of this.pulses) {
      const t = (now - pl.t0) / pl.d; const P = new Path2D();
      for (const f of F.feats) if (f.code === pl.code) P.addPath(f.p);
      ctx.globalAlpha = (1 - t) * .9; ctx.fillStyle = C.flash; ctx.fill(P); ctx.globalAlpha = 1;
    }
    if (this.selected) {
      const P = new Path2D(); for (const f of F.feats) if (f.code === this.selected) P.addPath(f.p);
      ctx.save(); ctx.shadowColor = C.selGlow; ctx.shadowBlur = 12 * dpr; ctx.strokeStyle = C.sel; ctx.lineWidth = 1.6 * px; ctx.stroke(P); ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._markers = [];
    for (const code of MICRO) {
      const m = META[code]; const q = this.fproj([m.ll[1], m.ll[0]]);
      this._drawMarker([q[0] * k + ox, q[1] * k + oy], code, 1);
    }
    for (const pl of this.pulses) {
      const m = META[pl.code]; const q = this.fproj([m.ll[1], m.ll[0]]);
      this._ring([q[0] * k + ox, q[1] * k + oy], (now - pl.t0) / pl.d, pl.color);
    }
  }

  // ---------- interaction ----------
  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._down(e));
    c.addEventListener('pointermove', e => this._move(e));
    c.addEventListener('pointerup', e => this._up(e));
    c.addEventListener('pointercancel', e => this._up(e, true));
    c.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(-e.deltaY * .0015); this.zoomAt(f, e.offsetX, e.offsetY); }, {passive: false});
    document.addEventListener('visibilitychange', () => { this.visible = !document.hidden; if (this.visible) this.request(); });
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  _xy(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const xy = this._xy(e);
    this.pointers.set(e.pointerId, {x: xy[0], y: xy[1], x0: xy[0], y0: xy[1], t0: performance.now()});
    this.inertia = null; this.anim = null; this.autoPause = performance.now() + 7000;
    this.samples = [];
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = {d: Math.hypot(a.x - b.x, a.y - b.y), k: this.mode === 'globe' ? this.k : this.fk, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2}; }
    this.request();
  }
  _move(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const xy = this._xy(e); const dx = xy[0] - p.x, dy = xy[1] - p.y;
    p.x = xy[0]; p.y = xy[1];
    if (this.pointers.size === 1) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
      if (p.moved) { this._dragBy(dx, dy); this.samples.push({t: performance.now(), dx, dy}); if (this.samples.length > 6) this.samples.shift(); }
    } else if (this.pointers.size === 2 && this.pinch) {
      for (const q of this.pointers.values()) q.moved = true;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const target = this.pinch.k * d / this.pinch.d;
      if (this.mode === 'globe') { this.k = clamp(target, this.kMin, 9); this._dragBy(mx - this.pinch.mx, my - this.pinch.my); }
      else { const f = clamp(target, 1, 14) / this.fk; this._zoomFlat(f, mx, my); this.tx += mx - this.pinch.mx; this.ty += my - this.pinch.my; this._clampFlat(); }
      this.pinch.mx = mx; this.pinch.my = my;
    }
    this.request();
  }
  _up(e, cancel) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const now = performance.now();
    if (!cancel && !p.moved && now - p.t0 < 500 && this.pointers.size === 0) {
      // double tap zoom
      if (this._lastTap && now - this._lastTap.t < 300 && Math.hypot(p.x - this._lastTap.x, p.y - this._lastTap.y) < 30) {
        this._lastTap = null; clearTimeout(this._tapT);
        this.zoomAt(2, p.x, p.y, true); return;
      }
      this._lastTap = {t: now, x: p.x, y: p.y};
      const code = this.pick(p.x, p.y);
      this.opts.onTap && this.opts.onTap(code, p.x, p.y);
    } else if (p.moved && this.pointers.size === 0 && this.samples.length) {
      const recent = this.samples.filter(s => now - s.t < 90);
      if (recent.length) {
        const span = Math.max(16, now - recent[0].t);
        const vx = recent.reduce((s, q) => s + q.dx, 0) / span, vy = recent.reduce((s, q) => s + q.dy, 0) / span;
        if (Math.hypot(vx, vy) > .05) this.inertia = {x: vx, y: vy};
      }
    }
    this.request();
  }
  _dragBy(dx, dy) {
    if (this.mode === 'globe') {
      const r = this.r0 * this.k; const d = 180 / Math.PI / r;
      this.rot[0] += dx * d; this.rot[1] = clamp(this.rot[1] - dy * d, -85, 85);
      this.opts.onRotate && this.opts.onRotate(this.rot);
    } else { this.tx += dx; this.ty += dy; this._clampFlat(); }
  }
  _zoomFlat(f, x, y) {
    const nk = clamp(this.fk * f, 1, 14); f = nk / this.fk;
    this.tx = x - (x - this.tx) * f; this.ty = y - (y - this.ty) * f; this.fk = nk;
  }
  _clampFlat() {
    if (!this.flat && !this.fproj) return;
    const b = this._flatBase() * this.fk; const W = 1000 * b, H = (this.flat ? this.flat.h : 487) * b;
    const mx = this.w * .25, my = this.h * .2;
    if (W <= this.w) this.tx = (this.w - W) / 2; else this.tx = clamp(this.tx, this.w - W - mx, mx);
    if (H <= this.h * .9) this.ty = clamp(this.ty, this.h * .08, this.h * .92 - H);
    else this.ty = clamp(this.ty, this.h - H - my, my);
  }
  resetFlat(animate = true) {
    const b = this._flatBase(); const H = 487 * b;
    const to = {fk: 1, tx: 10, ty: this.h * .44 - H / 2};
    if (!animate) { Object.assign(this, to); return; }
    this._tweenFlat(to, 600);
  }
  _tweenFlat(to, d = 800) {
    const from = {fk: this.fk, tx: this.tx, ty: this.ty};
    this.anim = {t0: performance.now(), d, ease: easeInOut, step: t => { this.fk = from.fk + (to.fk - from.fk) * t; this.tx = from.tx + (to.tx - from.tx) * t; this.ty = from.ty + (to.ty - from.ty) * t; }};
    this.request();
  }
  zoomAt(f, x, y, animate) {
    this.autoPause = performance.now() + 7000;
    if (this.mode === 'globe') {
      const from = this.k, to = clamp(this.k * f, this.kMin, 9);
      if (!animate) { this.k = to; this.request(); return; }
      this.anim = {t0: performance.now(), d: 320, ease: easeOut, step: t => { this.k = from + (to - from) * t; }};
    } else {
      if (!animate) { this._zoomFlat(f, x, y); this._clampFlat(); this.request(); return; }
      const nk = clamp(this.fk * f, 1, 14), ff = nk / this.fk;
      const to = {fk: nk, tx: x - (x - this.tx) * ff, ty: y - (y - this.ty) * ff};
      const from = {fk: this.fk, tx: this.tx, ty: this.ty};
      this.anim = {t0: performance.now(), d: 320, ease: easeOut, step: t => { this.fk = from.fk + (to.fk - from.fk) * t; this.tx = from.tx + (to.tx - from.tx) * t; this.ty = from.ty + (to.ty - from.ty) * t; this._clampFlat(); }};
    }
    this.request();
  }
  zoom(f) { this.zoomAt(f, this.w / 2, this.mode === 'globe' ? this.cy : this.h * .45, true); }
  reset(homeCode) {
    if (this.mode === 'globe') this.flyTo(homeCode, {k: 1, d: 1100});
    else this.resetFlat(true);
  }

  flyTo(code, {k, d = 1300, yFrac = .4} = {}) {
    const m = META[code]; if (!m) return;
    const lon = m.ll[1], lat = m.ll[0];
    this.inertia = null; this.autoPause = performance.now() + 9000;
    if (this.mode === 'globe') {
      const k1 = k ?? clamp(46 / (spanDeg(code) + 5), 1.05, 6);
      const k0 = this.k;
      const from = [-this.rot[0], -this.rot[1]];
      const ip = geoInterpolate(from, [lon, clamp(lat, -70, 70)]);
      const dist = geoDistance(from, [lon, lat]);
      const dip = Math.min(.35, dist / Math.PI * .5);
      this.anim = {t0: performance.now(), d: d * (.6 + dist / Math.PI * .6), ease: easeInOut, step: t => {
        const q = ip(t); this.rot[0] = -q[0]; this.rot[1] = -q[1];
        this.k = (k0 + (k1 - k0) * t) * (1 - dip * Math.sin(Math.PI * t));
        this.opts.onRotate && this.opts.onRotate(this.rot);
      }};
    } else {
      if (!this.fproj) return;
      const q = this.fproj([lon, lat]); const b = this._flatBase();
      const fk = k ?? clamp(.3 * 360 / (spanDeg(code) + 3), 1.4, 9);
      const s = b * fk;
      this._tweenFlat({fk, tx: this.w / 2 - q[0] * s, ty: this.h * yFrac - q[1] * s}, d * .8);
      const done = this.anim; done.done = () => this._clampFlat();
    }
    this.request();
  }

  introSpin(homeCode) {
    const m = META[homeCode] || META.FR;
    const to = [-m.ll[1] - 8, -Math.max(-30, Math.min(45, m.ll[0] - 12))];
    const from = [to[0] + 110, to[1] + 18];
    this.rot = [from[0], from[1], 0]; this.k = .72;
    this.autoPause = performance.now() + 2600;
    this.anim = {t0: performance.now(), d: 2200, ease: t => 1 - Math.pow(1 - t, 4), step: t => {
      this.rot[0] = from[0] + (to[0] - from[0]) * t; this.rot[1] = from[1] + (to[1] - from[1]) * t; this.k = .72 + .28 * t;
      this.opts.onRotate && this.opts.onRotate(this.rot);
    }};
    this.request();
  }

  pulse(code, color) { this.pulses.push({code, t0: performance.now(), d: 900, color}); this.request(); }
  select(code) { this.selected = code; this.request(); }

  pick(x, y) {
    let best = null, bd = 13;
    for (const m of this._markers || []) { if (m.hidden) continue; const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m.code; } }
    if (best) return best;
    const hit = this._pickShape(x, y);
    if (hit) return hit;
    for (const m of this._markers || []) if (m.hidden && Math.hypot(m.x - x, m.y - y) < 8) return m.code;
    return null;
  }
  _pickShape(x, y) {
    if (!this.full) return null;
    if (this.mode === 'globe') {
      const cx = this.w / 2, cy = this.cy, r = this.proj.scale();
      if (Math.hypot(x - cx, y - cy) > r) return null;
      const ll = this.proj.invert([x, y]); if (!ll) return null;
      for (const f of this.full.feats) {
        const [[x0, y0], [x1, y1]] = f.bb;
        if (ll[1] < y0 - .5 || ll[1] > y1 + .5) continue;
        if (x0 <= x1 ? (ll[0] < x0 - .5 || ll[0] > x1 + .5) : (ll[0] < x0 && ll[0] > x1)) continue;
        if (geoContains(f, ll)) return f.code[0] === '-' ? null : f.code;
      }
      return null;
    }
    if (!this.flat) return null;
    const k = this.fk * this._flatBase();
    const px = (x - this.tx) / k, py = (y - this.ty) / k;
    for (const f of this.flat.feats) {
      const [[x0, y0], [x1, y1]] = f.b;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      if (this.hit.isPointInPath(f.p, px, py)) return f.code[0] === '-' ? null : f.code;
    }
    return null;
  }

  renderMini(cv, code, C, getStatus) {
    if (!this.full) return;
    const meta = META[code]; const dpr = Math.min(devicePixelRatio || 1, 2);
    const S = cv.clientWidth || 140; cv.width = S * dpr; cv.height = S * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = S / 2 - 10, cx = S / 2, cy = S / 2;
    const z = Math.max(1, Math.min(3.4, 26 / (Math.sqrt(meta.a) / 111 + 5)));
    const p = geoOrthographic().clipAngle(z > 1 ? Math.min(90, 90 / z * 1.6) : 90).scale(r * z).translate([cx, cy]).rotate([-meta.ll[1], -Math.max(-60, Math.min(60, meta.ll[0]))]);
    const path = geoPath(p, ctx);
    const clipSphere = () => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip(); };
    let g = ctx.createRadialGradient(cx, cy, r * .97, cx, cy, r + 10);
    g.addColorStop(0, C.glow1); g.addColorStop(.3, C.glowMid); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, TAU); ctx.fill();
    g = ctx.createRadialGradient(cx - r * .4, cy - r * .45, 2, cx, cy, r); g.addColorStop(0, C.ocean1); g.addColorStop(1, C.ocean2);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.save(); clipSphere();
    ctx.beginPath(); path(this.grat); ctx.strokeStyle = C.grat; ctx.lineWidth = .5; ctx.stroke();
    const others = [], mine = [];
    for (const f of this.lite.feats) (f.code === code ? mine : others).push(f);
    ctx.beginPath(); for (const f of others) path(f); ctx.fillStyle = C.land; ctx.fill();
    ctx.beginPath(); path(this.lite.borders); ctx.strokeStyle = C.border; ctx.lineWidth = .5; ctx.stroke();
    const s = getStatus(code); const col = s === 'v' ? C.visited : s === 'l' ? C.lived : s === 'w' ? C.wish : C.sel;
    const fm = this.full.feats.filter(f => f.code === code);
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.beginPath(); for (const f of fm) path(f); ctx.fillStyle = col; ctx.fill(); ctx.restore();
    if (meta.a < 20000) { const q = p([meta.ll[1], meta.ll[0]]); ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, TAU); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(q[0], q[1], 2.4, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
    ctx.restore();
    this._light(ctx, cx, cy, r, C);
  }

  // render a static poster map onto a given ctx (flat), used for sharing
  renderPoster(ctx, x, y, w, colors, getStatus) {
    const proj = geoEqualEarth().rotate([-10, 0]).fitWidth(w, {type: 'Sphere'});
    const sp = geoPath(proj, ctx);
    const h = sp.bounds({type: 'Sphere'})[1][1];
    ctx.save(); ctx.translate(x, y);
    const feats = this.full.feats.filter(f => f.code !== '-010');
    const C = colors;
    ctx.beginPath(); sp({type: 'Sphere'}); ctx.fillStyle = C.ocean; ctx.fill();
    ctx.beginPath(); sp(this.grat); ctx.strokeStyle = C.grat; ctx.lineWidth = 1; ctx.stroke();
    const groups = {land: [], v: [], l: [], w: [], other: []};
    for (const f of feats) groups[f.code[0] === '-' ? 'other' : (getStatus(f.code) || 'land')].push(f);
    const fill = (l, c) => { ctx.beginPath(); for (const f of l) sp(f); ctx.fillStyle = c; ctx.fill(); };
    fill(groups.other, C.land2); fill(groups.land, C.land); fill(groups.w, C.wishFill);
    ctx.save(); ctx.shadowColor = C.glow; ctx.shadowBlur = 18; fill(groups.v, C.visited); fill(groups.l, C.lived); ctx.restore();
    ctx.beginPath(); sp(this.full.borders); ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();
    if (groups.w.length) { ctx.beginPath(); for (const f of groups.w) sp(f); ctx.strokeStyle = C.wish; ctx.lineWidth = 1.4; ctx.stroke(); }
    for (const code of MICRO) { const s = getStatus(code); if (!s) continue; const m = META[code]; const q = proj([m.ll[1], m.ll[0]]); ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, TAU); ctx.fillStyle = s === 'v' ? C.visited : s === 'l' ? C.lived : C.wish; ctx.fill(); }
    ctx.beginPath(); sp({type: 'Sphere'}); ctx.strokeStyle = C.rim; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    return h;
  }
}
