// lightweight confetti — canvas, ~2 s, no deps
let cv, ctx, parts = [], raf = 0, last = 0;
const COLORS = ['#efe7d3', '#d9ab5a', '#f3d79a', '#7fb0a6', '#c98d72', '#ffffff'];
function ensure() {
  if (cv) return;
  cv = document.getElementById('confetti');
  ctx = cv.getContext('2d');
  const fit = () => { const d = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * d; cv.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  addEventListener('resize', fit); fit();
}
export function confetti({x = innerWidth / 2, y = innerHeight * .38, count = 140, spread = 1} = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ensure();
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.1 * spread;
    const v = 6 + Math.random() * 9;
    parts.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4,
      w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, c: COLORS[i % COLORS.length], life: 0, max: 1600 + Math.random() * 900, shape: Math.random() < .3 ? 1 : 0});
  }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}
function tick(now) {
  const dt = Math.min(40, now - last) / 16.7; last = now;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life < p.max);
  for (const p of parts) {
    p.life += dt * 16.7;
    p.vx *= Math.pow(.985, dt); p.vy = p.vy * Math.pow(.985, dt) + .28 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    const a = Math.min(1, (p.max - p.life) / 400);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.r);
    ctx.fillStyle = p.c;
    if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.scale(1, Math.cos(p.life / 90)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
    ctx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(tick); else { raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
