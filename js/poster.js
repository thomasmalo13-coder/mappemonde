import {COUNTRIES} from './countries.js';
import {stats, statusOf, been, TOTAL, CONTINENTS, CONT_TOTAL} from './store.js';

const W = 1080, H = 1350;
const THEMES = {
  nuit: {bg1: '#171a16', bg2: '#070807', fg: '#efece4', muted: '#9c988d', faint: 'rgba(239,236,228,.12)', gold: '#d9aa58',
    map: {ocean: 'rgba(239,236,228,.03)', grat: 'rgba(239,236,228,.06)', land: '#2c2e29', land2: '#21231f', border: '#0b0c0a', visited: '#ece4d0', lived: '#d9aa58', wish: '#d8937a', wishFill: 'rgba(216,147,122,.28)', rim: 'rgba(239,236,228,.18)', glow: 'rgba(240,225,190,.55)'}},
  papier: {bg1: '#f6f3ec', bg2: '#e9e3d6', fg: '#1b1c18', muted: '#6b675d', faint: 'rgba(27,28,24,.12)', gold: '#b47d27',
    map: {ocean: 'rgba(27,28,24,.025)', grat: 'rgba(27,28,24,.07)', land: '#d6d0c1', land2: '#e0dbcf', border: '#f3efe7', visited: '#27362f', lived: '#b47d27', wish: '#c4694c', wishFill: 'rgba(196,105,76,.22)', rim: 'rgba(27,28,24,.18)', glow: 'rgba(39,54,47,.25)'}},
};

function rnd(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export async function makePoster(map, style = 'nuit') {
  const T = THEMES[style] || THEMES.nuit;
  try { await Promise.all([document.fonts.load('italic 100px "Instrument Serif"'), document.fonts.load('600 30px Figtree')]); } catch {}
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  // background
  const g = c.createRadialGradient(W / 2, H * .3, 50, W / 2, H * .45, H * .85);
  g.addColorStop(0, T.bg1); g.addColorStop(1, T.bg2); c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (style === 'nuit') {
    const r = rnd(7);
    for (let i = 0; i < 260; i++) { c.beginPath(); c.arc(r() * W, r() * H, r() ** 3 * 1.8 + .4, 0, 7); c.fillStyle = `rgba(240,236,225,${.1 + r() * .45})`; c.fill(); }
  } else {
    const r = rnd(3); c.fillStyle = 'rgba(80,60,30,.035)';
    for (let i = 0; i < 9000; i++) c.fillRect(r() * W, r() * H, 1.4, 1.4);
  }
  // frame
  c.strokeStyle = T.faint; c.lineWidth = 2; c.strokeRect(36, 36, W - 72, H - 72);
  const s = stats();
  c.textAlign = 'center'; c.fillStyle = T.muted;
  c.font = '600 22px Figtree, sans-serif';
  try { c.letterSpacing = '7px'; } catch {}
  c.fillText(`MAPPEMONDE  ·  ${new Date().getFullYear()}`, W / 2, 112);
  try { c.letterSpacing = '0px'; } catch {}
  c.fillStyle = T.fg; c.font = 'italic 104px "Instrument Serif", Georgia, serif';
  c.fillText('Mon tour du monde', W / 2, 218);
  // map
  map.renderPoster(c, 50, 270, W - 100, T.map, statusOf);
  // big number
  const y0 = 1010;
  c.textAlign = 'left'; c.fillStyle = T.fg; c.font = 'italic 250px "Instrument Serif", Georgia, serif';
  const num = String(s.been); c.fillText(num, 84, y0);
  const nw = c.measureText(num).width;
  const x2 = 84 + nw + 34;
  c.font = 'italic 64px "Instrument Serif", Georgia, serif'; c.fillText(s.been > 1 ? 'pays visités' : 'pays visité', x2, y0 - 120);
  c.font = '500 30px Figtree, sans-serif'; c.fillStyle = T.muted;
  c.fillText(`sur ${TOTAL} · ${fmtPct(s.pct)} % du monde`, x2, y0 - 70);
  c.fillText(`${s.contsVisited} continent${s.contsVisited > 1 ? 's' : ''} · ${fmtPct(s.area)} % des terres`, x2, y0 - 26);
  // divider
  c.fillStyle = T.faint; c.fillRect(84, 1060, W - 168, 2);
  // continents
  const colW = (W - 168) / 5;
  CONTINENTS.forEach((k, i) => {
    const x = 84 + i * colW;
    c.fillStyle = T.muted; c.font = '600 19px Figtree, sans-serif'; try { c.letterSpacing = '3px'; } catch {}
    c.fillText(k.toUpperCase(), x, 1108); try { c.letterSpacing = '0px'; } catch {}
    c.fillStyle = T.fg; c.font = 'italic 56px "Instrument Serif", Georgia, serif';
    const a = String(s.cont[k]); c.fillText(a, x, 1170);
    const aw = c.measureText(a).width; c.font = '500 24px Figtree, sans-serif'; c.fillStyle = T.muted; c.fillText(`/${CONT_TOTAL[k]}`, x + aw + 6, 1170);
    c.fillStyle = T.faint; roundRect(c, x, 1190, colW - 26, 6, 3); c.fill();
    const f = s.cont[k] / CONT_TOTAL[k]; if (f > 0) { c.fillStyle = f >= 1 ? T.gold : T.map.visited; roundRect(c, x, 1190, Math.max(6, (colW - 26) * f), 6, 3); c.fill(); }
  });
  // flags + footer
  const flags = COUNTRIES.filter(x => been(x.c)).sort((a, b) => (statusOf(b.c) === 'l') - (statusOf(a.c) === 'l')).map(x => x.f);
  c.font = '36px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';
  const maxF = 11; let fx = 84;
  for (const f of flags.slice(0, maxF)) { c.fillText(f, fx, 1278); fx += 46; }
  if (flags.length > maxF) { c.font = '600 24px Figtree, sans-serif'; c.fillStyle = T.muted; c.fillText(`+${flags.length - maxF}`, fx + 4, 1272); }
  c.textAlign = 'right'; c.fillStyle = T.muted; c.font = 'italic 34px "Instrument Serif", Georgia, serif';
  c.fillText(new Date().toLocaleDateString('fr-FR', {day: 'numeric', month: 'long', year: 'numeric'}), W - 84, 1276);
  return await new Promise(r => cv.toBlob(r, 'image/png'));
}
function fmtPct(v) { return (v > 0 && v < 1 ? v.toFixed(1) : v.toFixed(0)).replace('.', ','); }
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
