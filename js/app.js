import {COUNTRIES} from './countries.js';
import {state, save, flush, subscribe, statusOf, been, setStatus, entry, cleanup, stats, BY, TOTAL, CONTINENTS, CONT_TOTAL, distanceKm, LAND_TOTAL, exportJSON, replaceState, resetAll, STATUS, allTrips} from './store.js';
import {WorldMap} from './map.js';
import {icon} from './icons.js';
import {confetti} from './confetti.js';
import {parseImport, norm} from './parse.js';
import {evaluate, checkNew, MILESTONES, BADGES} from './badges.js';
import {makePoster} from './poster.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const fmt = n => n.toLocaleString('fr-FR');
const fmtPop = n => n >= 1e9 ? (n / 1e9).toLocaleString('fr-FR', {maximumFractionDigits: 2}) + ' Md' : n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', {maximumFractionDigits: n >= 1e8 ? 0 : 1}) + ' M' : fmt(Math.round(n / 100) * 100);
const fmtArea = n => n < 10 ? n.toLocaleString('fr-FR', {maximumFractionDigits: 2}) : fmt(Math.round(n));
const pctFmt = (v, d = 0) => (v > 0 && v < 1 && d === 0 ? v.toFixed(1) : v.toFixed(d)).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SORTED = [...COUNTRIES].sort((a, b) => a.n.localeCompare(b.n, 'fr'));
const ABBR = {Afrique: 'Afr', Amériques: 'Amé', Asie: 'Asie', Europe: 'Eur', Océanie: 'Océ'};
const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const home = () => BY[state.home] || BY.FR;

/* ---------------- theme ---------------- */
const mq = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = state.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : state.theme;
  document.documentElement.dataset.theme = t;
  $('#themeColor').content = t === 'light' ? '#f2eee5' : '#0b0c0a';
  requestAnimationFrame(() => { map && map.setColors(readColors()); makeStars(); });
}
mq.addEventListener?.('change', () => state.theme === 'auto' && applyTheme());
function readColors() {
  const cs = getComputedStyle(document.documentElement); const g = n => cs.getPropertyValue(n).trim();
  return {land: g('--m-land'), land2: g('--m-land2'), ocean1: g('--m-ocean1'), ocean2: g('--m-ocean2'), border: g('--m-border'), coast: g('--m-coast'),
    grat: g('--m-grat'), glow1: g('--m-glow1'), glow2: g('--m-glow2'), light: g('--m-light'), shade: g('--m-shade'), rim: g('--m-rim'), sel: g('--m-sel'),
    glowMid: g('--m-glowmid'), selGlow: g('--m-selglow'), flash: g('--m-flash'), marker: g('--m-marker'), markerHalo: g('--m-halo'), wishFill: g('--m-wishfill'),
    visited: g('--v'), lived: g('--l'), wish: g('--w'), bg: g('--bg'), h1: g('--h1'), h2: g('--h2'), h3: g('--h3'), h4: g('--h4'), h5: g('--h5')};
}
function makeStars() {
  const mk = (n, maxA, size) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const r = Math.random() ** 3 * size + .35; const a = .15 + Math.random() * maxA;
      x.beginPath(); x.arc(Math.random() * 600, Math.random() * 600, r, 0, Math.PI * 2);
      x.fillStyle = Math.random() < .2 ? `rgba(255,226,180,${a})` : `rgba(235,240,255,${a})`; x.fill();
    }
    return c.toDataURL();
  };
  if (makeStars.done) return; makeStars.done = true;
  $('.stars.s1').style.backgroundImage = `url(${mk(260, .55, 1.1)})`;
  $('.stars.s2').style.backgroundImage = `url(${mk(40, .85, 1.6)})`;
  $('.stars.s2').style.backgroundSize = '900px 900px';
}

/* ---------------- map colouring ---------------- */
let replaySet = null; // during replay: only these countries are lit
function mapStatus(code) {
  const s = statusOf(code);
  if (replaySet) return replaySet.has(code) ? (s === 'l' ? 'l' : 'v') : null;
  if (!s || s === 'w' || state.colorBy === 'status') return s;
  const e = state.countries[code];
  if (state.colorBy === 'trips') { const n = (e.visits || []).length; return n >= 5 ? 'h5' : n >= 3 ? 'h4' : n === 2 ? 'h3' : n === 1 ? 'h2' : 'h1'; }
  return e.r ? 'h' + e.r : null;
}
const COLOR_MODES = {status: 'Statut', trips: 'Voyages', rating: 'Note'};
function renderLegend() {
  const m = state.colorBy || 'status'; const el = $('#legend');
  const ramp = `<span class="ramp">${[1, 2, 3, 4, 5].map(i => `<i style="background:var(--h${i})"></i>`).join('')}</span>`;
  el.innerHTML = m === 'status' ? `<span><i class="dot v"></i>Visité</span><span><i class="dot l"></i>Vécu</span><span><i class="dot w"></i>Envie</span>${icon('layers')}`
    : m === 'trips' ? `<span class="lg-mode">Voyages</span><span>1</span>${ramp}<span>5+</span>${icon('layers')}`
    : `<span class="lg-mode">Note</span><span>★1</span>${ramp}<span>★5</span>${icon('layers')}`;
}
function openColorBy() {
  const html = () => `<h3 class="sh-title">Colorer la carte</h3><p class="sh-sub">Choisissez ce que les couleurs racontent.</p>
    <div class="opts">${Object.entries({status: ['Statut', 'Visité, vécu, envie'], trips: ['Nombre de voyages', 'Plus c’est doré, plus vous y êtes allé'], rating: ['Votre note', 'Vos pays préférés en doré']}).map(([k, [t, d]]) =>
      `<button class="opt ${state.colorBy === k ? 'on' : ''}" data-cb="${k}" aria-pressed="${state.colorBy === k}"><div><b>${t}</b><span>${d}</span></div>${state.colorBy === k ? icon('check') : ''}</button>`).join('')}</div>`;
  openSheet(html, el => el.querySelectorAll('[data-cb]').forEach(b => b.onclick = () => {
    state.colorBy = b.dataset.cb; save(); renderLegend(); map.request(); vib(6); closeSheet();
    if (state.colorBy === 'trips' && !allTrips().length) toast('Ajoutez des dates de voyage pour nuancer la carte');
    if (state.colorBy === 'rating' && !Object.values(state.countries).some(e => e.r)) toast('Notez vos pays pour voir vos préférés');
  }), {name: 'colorby'});
}
$('#legend').onclick = () => openColorBy();

/* ---------------- map search ---------------- */
const msearch = $('#msearch'), mqIn = $('#mq'), mres = $('#mres');
$('#zsearch').innerHTML = icon('search'); $('.ms-ic').outerHTML = icon('search'); $('#mqx').innerHTML = icon('x');
function openSearch() {
  closePeek(true); msearch.classList.add('show'); app.classList.add('searching');
  mqIn.value = ''; mres.innerHTML = ''; setTimeout(() => mqIn.focus(), 60);
  history.pushState({v: 'map', search: 1}, '');
}
function closeSearch(back = true) {
  if (!msearch.classList.contains('show')) return;
  msearch.classList.remove('show'); app.classList.remove('searching'); mqIn.blur();
  if (back && history.state?.search) { popGuard = true; history.back(); }
}
function hl(t, q) { const n = norm(t); const i = q ? n.indexOf(q) : -1; return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); }
function searchResults(q) {
  const nq = norm(q.trim()); if (!nq) return [];
  const sc = c => { const n = norm(c.n);
    if (c.c.toLowerCase() === nq || c.i3.toLowerCase() === nq) return 0; if (n.startsWith(nq)) return 1; if (n.split(/[\s-]/).some(w => w.startsWith(nq))) return 2;
    if (norm(c.en).startsWith(nq)) return 3; if (norm(c.cap).startsWith(nq)) return 4; if (n.includes(nq) || norm(c.en).includes(nq)) return 5; if (norm(c.cap).includes(nq)) return 6; return 9; };
  return SORTED.map(c => [sc(c), c]).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0]).slice(0, 7).map(x => x[1]);
}
mqIn.addEventListener('input', () => {
  const q = norm(mqIn.value.trim()); const r = searchResults(mqIn.value);
  mres.innerHTML = r.length ? r.map(c => { const s = statusOf(c.c); return `<button class="mres" role="option" data-code="${c.c}"><span class="flag">${c.f}</span><div class="rt"><b>${hl(c.n, q)}</b><span>${hl(c.cap, q)} · ${esc(c.k)}</span></div>${s ? `<em class="st">${STATUS[s].label}</em>` : ''}</button>`; }).join('')
    : (q ? `<div class="empty" style="padding:22px"><span class="serif">Aucun pays</span>Essayez un autre nom.</div>` : '');
});
mqIn.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = mres.querySelector('.mres'); b && b.click(); } if (e.key === 'Escape') closeSearch(); });
mres.addEventListener('click', e => { const b = e.target.closest('.mres'); if (!b) return; const code = b.dataset.code; closeSearch(); vib(8); map.flyTo(code, {d: 1500}); setTimeout(() => openPeek(code), 700); });
$('#zsearch').onclick = openSearch; $('#mqx').onclick = () => closeSearch();

/* ---------------- map ---------------- */
let map;
const stage = $('#stage');
const sky1 = $('.stars.s1'), sky2 = $('.stars.s2');
function initMap() {
  map = new WorldMap(stage, $('#map'), {
    getStatus: mapStatus,
    onTap: (code) => onMapTap(code),
    onReady: () => { if (map.mode === 'globe' && !matchMedia('(prefers-reduced-motion: reduce)').matches) map.introSpin(state.home); },
    onRotate: rot => {
      const x = (rot[0] * 2.2) % 600, y = rot[1] * 1.6;
      sky1.style.transform = `translate3d(${x}px,${y}px,0)`;
      sky2.style.transform = `translate3d(${x * 1.5}px,${y * 1.5}px,0)`;
    },
  });
  const m = home(); map.rot = [-m.ll[1] - 40, -Math.max(-30, Math.min(40, m.ll[0] - 10)), 0];
  map.setColors(readColors());
  map.mode = state.view === 'flat' ? 'flat' : 'globe';
  app.dataset.mode = map.mode;
  map.intro = {t0: performance.now(), d: 1200};
  map.load().catch(() => toast('Impossible de charger la carte.'));
}
function onMapTap(code) {
  if (replaying) return;
  if (!code) { closePeek(); return; }
  if (state.quick) {
    const s = statusOf(code);
    applyStatus(code, s ? null : 'v', {source: 'map'});
  }
  openPeek(code);
}

/* ---------------- header counter ---------------- */
let shown = null;
function renderHeader(bump) {
  const s = stats();
  const el = $('#cnt');
  const from = shown ?? s.been; const to = s.been; shown = to;
  if (from !== to) {
    const t0 = performance.now(), d = 600;
    const step = now => { const t = Math.min(1, (now - t0) / d); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  } else el.textContent = to;
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  $('#pct').textContent = `${pctFmt(s.pct)} % du monde`;
  $('#progbar').style.width = s.pct + '%';
}

/* ---------------- views ---------------- */
let view = 'map';
let popGuard = false, pendingGo = null;
function go(v, {push = true} = {}) {
  if (popGuard && push) { pendingGo = v; return; }
  if (v === view && push) { const p = $('#v-' + v); if (p && p.scrollTop > 0) p.scrollTo({top: 0, behavior: 'smooth'}); return; }
  view = v; app.dataset.view = v;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === 'v-' + v));
  const tabs = $$('.tab'); const i = tabs.findIndex(t => t.dataset.view === v);
  tabs.forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('#tabInd').style.transform = `translateX(${i * 100}%)`;
  if (v !== 'map') { closePeek(true); closeSearch(false); if (replaying) stopReplay(); }
  if (v === 'list') renderList();
  if (v === 'stats') renderStats();
  if (v === 'journal') renderJournal();
  if (v === 'more') renderMore();
  if (map) { map.visible = v === 'map' && !document.hidden; if (map.visible) map.request(); }
  if (push) history.pushState({v}, '', v === 'map' ? location.pathname : '#' + v);
}
addEventListener('popstate', e => {
  if (popGuard) { popGuard = false; if (pendingGo) { const v = pendingGo; pendingGo = null; go(v); } return; }
  if (sheetOpen) { closeSheet(false); return; }
  if (msearch.classList.contains('show')) { closeSearch(false); return; }
  if (replaying) { stopReplay(); }
  go(e.state?.v || 'map', {push: false});
});

/* ---------------- peek ---------------- */
let peekCode = null;
const peek = $('#peek');
function openPeek(code) {
  peekCode = code; map.select(code);
  const c = BY[code];
  peek.className = 'peek card show';
  app.classList.add('peeking');
  peek.innerHTML = `
    <div class="peek-head">
      <div class="flag flag-tile">${c.f}</div>
      <div class="peek-title"><h3>${esc(c.n)}</h3><p>${esc(c.k)} · ${esc(c.cap)}</p></div>
      <button class="iconbtn" data-act="close" aria-label="Fermer">${icon('x')}</button>
    </div>
    ${statusRow(code)}
    <button class="peek-more" data-act="detail">Ouvrir la fiche ${icon('chevron')}</button>`;
  hint();
}
function closePeek(silent) {
  if (!peekCode && !silent) { map && map.select(null); return; }
  peekCode = null; map && map.select(null);
  peek.classList.remove('show'); app.classList.remove('peeking'); hint();
}
function statusRow(code) {
  const s = statusOf(code);
  const b = (k, ic) => `<button class="sbtn ${s === k ? 'on' : ''}" data-s="${k}" data-code="${code}" aria-pressed="${s === k}">${icon(ic)}<span>${STATUS[k].label}</span></button>`;
  return `<div class="status-row">${b('v', 'check')}${b('l', 'home')}${b('w', 'heart')}</div>`;
}
peek.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.act === 'close') closePeek();
  else if (t.dataset.act === 'detail') openDetail(peekCode);
  else if (t.dataset.s) toggleStatus(t.dataset.code, t.dataset.s, t);
});
function refreshStatusRows(code) {
  $$(`.status-row`).forEach(row => {
    const b0 = row.querySelector('.sbtn'); if (!b0 || b0.dataset.code !== code) return;
    const s = statusOf(code);
    row.querySelectorAll('.sbtn').forEach(b => { const on = b.dataset.s === s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  });
}
function toggleStatus(code, s, btn) {
  const cur = statusOf(code);
  applyStatus(code, cur === s ? null : s, {btn});
}

/* ---------------- status changes / celebrations ---------------- */
function applyStatus(code, next, {btn, source, silent} = {}) {
  const before = stats();
  const prev = setStatus(code, next);
  const after = stats();
  const c = BY[code];
  refreshStatusRows(code);
  if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  const colors = readColors();
  if (next) { map && map.pulse(code, next === 'v' ? colors.visited : next === 'l' ? colors.lived : colors.wish); vib(next === 'w' ? 8 : 14); }
  renderHeader(after.been > before.been);
  if (!next && prev && !silent) toast(`${c.n} retiré`, 'Annuler', () => applyStatus(code, prev, {silent: true}));
  if (after.been > before.been && !silent) celebrateCheck(code, before, after);
  else { checkNew(); save(); }
  if (view === 'list') updateRow(code);
}
const queue = [];
function celebrateCheck(code, before, after) {
  const items = [];
  state.seen = state.seen || {};
  if (MILESTONES.includes(after.been) && !state.seen['m' + after.been]) {
    state.seen['m' + after.been] = 1;
    items.push({kind: 'milestone', n: after.been});
  }
  for (const k of CONTINENTS) if (after.cont[k] === CONT_TOTAL[k] && before.cont[k] < CONT_TOTAL[k] && !state.seen['c' + k]) { state.seen['c' + k] = 1; items.push({kind: 'cont', k}); }
  if (after.cont[BY[code].k] === 1 && before.cont[BY[code].k] === 0 && after.been > 1) items.push({kind: 'newcont', k: BY[code].k, code});
  const fresh = checkNew();
  for (const b of fresh) items.push({kind: 'badge', b});
  save();
  if (!items.length) return;
  // prioritise: badge > cont > milestone; show one modal, rest as small toasts
  const order = {cont: 0, badge: 1, milestone: 2, newcont: 3};
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  const top = items[0];
  if (top.kind === 'newcont') { toast(`Nouveau continent : ${top.k} ✦`); confetti({count: 60, y: innerHeight * .55}); return; }
  queue.push(...items.filter(i => i.kind !== 'newcont'));
  if (!$('#modal').classList.contains('show')) showNextCelebration();
}
function showNextCelebration() {
  const it = queue.shift(); if (!it) return;
  let medal, eyebrow, title, text;
  if (it.kind === 'badge') { medal = it.b.icon; eyebrow = 'Badge débloqué'; title = it.b.name; text = it.b.desc; }
  else if (it.kind === 'cont') { medal = 'laurel'; eyebrow = 'Continent bouclé'; title = it.k; text = `Les ${CONT_TOTAL[it.k]} pays, tous visités. Chapeau.`; }
  else { medal = it.n >= 100 ? 'crown' : it.n >= 25 ? 'globe' : 'sparkle'; eyebrow = 'Cap franchi'; title = `${it.n} pays`; text = it.n === 1 ? 'Le premier tampon de votre carte.' : `${pctFmt(it.n / TOTAL * 100)} % du monde. Continuez !`; }
  const m = $('#modal');
  m.innerHTML = `<div class="mcard"><div class="medal">${icon(medal)}</div><div class="eyebrow">${eyebrow}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="row2"><button class="cta ghost small" data-act="share">${icon('share')}Partager</button><button class="cta small" data-act="ok">Continuer</button></div></div>`;
  m.classList.add('show');
  vib([20, 60, 30]);
  setTimeout(() => confetti({count: it.kind === 'milestone' && it.n < 5 ? 90 : 170}), 120);
}
$('#modal').addEventListener('click', e => {
  const t = e.target.closest('button'); const m = $('#modal');
  if (!t && e.target !== m) return;
  m.classList.remove('show');
  if (t?.dataset.act === 'share') { queue.length = 0; setTimeout(openPoster, 250); return; }
  setTimeout(showNextCelebration, 380);
});

/* ---------------- toast ---------------- */
let toastT;
function toast(msg, action, fn) {
  const el = $('#toast');
  el.innerHTML = `<div class="t"><span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}</div>`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); fn(); };
  el.classList.add('show'); clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), action ? 4200 : 2600);
}

/* ---------------- hint / onboarding ---------------- */
function hint() {
  const el = $('#hint'); const s = stats();
  if (peekCode) { el.innerHTML = ''; return; }
  if (!state.seen?.importBanner && s.been === 0 && !Object.keys(state.countries).length) {
    el.innerHTML = `<div class="banner card"><div class="b-ic">${icon('upload')}</div><div class="b-txt"><b>Vos pays de l’ancienne appli ?</b><span>Récupérez-les en 30 secondes.</span></div><button class="iconbtn" data-act="imp" aria-label="Importer">${icon('chevron')}</button><button class="b-x" data-act="x" aria-label="Plus tard">${icon('x')}</button></div>`;
    return;
  }
  if (s.been === 0) { el.innerHTML = `<div class="pill">${icon('sparkle')}Touchez un pays pour commencer</div>`; return; }
  el.innerHTML = '';
}
$('#hint').addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) { if (e.target.closest('.banner')) openImport(); return; }
  if (t.dataset.act === 'imp') openImport();
  if (t.dataset.act === 'x') { state.seen = state.seen || {}; state.seen.importBanner = 1; save(); hint(); }
});

/* ---------------- list ---------------- */
let q = '', fStatus = 'all', fCont = 'all';
function renderList() {
  const el = $('#v-list');
  if (!el.dataset.ready) {
    el.dataset.ready = 1;
    el.innerHTML = `
      <div class="pg-head"><h2>Pays</h2><p id="listSub"></p></div>
      <div class="search"><label>${icon('search')}<input id="q" type="search" placeholder="Rechercher un pays, une capitale…" autocomplete="off" enterkeyhint="search"><button class="clear" id="qx" aria-label="Effacer" hidden>${icon('x')}</button></label></div>
      <div class="chips" id="fs"></div>
      <div class="chips" id="fc"></div>
      <div class="contbars" id="cbars"></div>
      <div id="rows"></div>`;
    $('#q').addEventListener('input', e => { q = e.target.value; $('#qx').hidden = !q; renderRows(); });
    $('#qx').addEventListener('click', () => { q = ''; $('#q').value = ''; $('#qx').hidden = true; renderRows(); $('#q').focus(); });
    $('#fs').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; fStatus = b.dataset.f; renderList(); });
    $('#fc').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; fCont = b.dataset.f; renderList(); });
    $('#rows').addEventListener('click', e => {
      const tick = e.target.closest('.tick');
      if (tick) { const code = tick.dataset.code; const s = statusOf(code); applyStatus(code, s === 'v' || s === 'l' ? null : 'v', {btn: tick}); return; }
      const row = e.target.closest('.row'); if (row) openDetail(row.dataset.code);
    });
  }
  const s = stats();
  $('#listSub').textContent = `${s.been} visité${s.been > 1 ? 's' : ''} · ${s.l} vécu · ${s.w} envie${s.w > 1 ? 's' : ''}`;
  const cnt = {all: TOTAL, been: s.been, l: s.l, w: s.w, todo: TOTAL - s.been - s.w};
  const F = [['all', 'Tous'], ['been', 'Visités'], ['l', 'Vécu'], ['w', 'Envies'], ['todo', 'À découvrir']];
  $('#fs').innerHTML = F.map(([k, l]) => `<button class="chip ${fStatus === k ? 'on' : ''}" data-f="${k}">${l} <em>${cnt[k]}</em></button>`).join('');
  $('#fc').innerHTML = [['all', 'Tous les continents'], ...CONTINENTS.map(k => [k, k])].map(([k, l]) => `<button class="chip ${fCont === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('#cbars').innerHTML = CONTINENTS.map(k => `<div class="contbar"><div class="bar"><i style="width:${s.cont[k] / CONT_TOTAL[k] * 100}%"></i></div>${ABBR[k]} <b>${s.cont[k]}</b></div>`).join('');
  renderRows();
}
function rowHTML(c) {
  const s = statusOf(c.c);
  const ic = s === 'l' ? 'home' : s === 'w' ? 'heart' : 'check';
  const e = state.countries[c.c];
  const extra = e?.visits?.length ? ` · ${e.visits.length} voyage${e.visits.length > 1 ? 's' : ''}` : '';
  return `<div class="row" data-code="${c.c}" role="button" tabindex="0"><div class="flag">${c.f}</div><div class="rt"><b>${esc(c.n)}</b><span>${esc(c.k)} · ${esc(c.cap)}${extra}</span></div>
    <button class="tick" data-code="${c.c}" data-s="${s || ''}" aria-label="${s ? 'Retirer' : 'Marquer visité'} ${esc(c.n)}">${icon(ic)}</button></div>`;
}
function renderRows() {
  const nq = norm(q);
  let list = SORTED.filter(c => {
    const s = statusOf(c.c);
    if (fStatus === 'been' && !(s === 'v' || s === 'l')) return false;
    if (fStatus === 'l' && s !== 'l') return false;
    if (fStatus === 'w' && s !== 'w') return false;
    if (fStatus === 'todo' && s) return false;
    if (fCont !== 'all' && c.k !== fCont) return false;
    if (nq) return norm(c.n).includes(nq) || norm(c.en).includes(nq) || norm(c.cap).includes(nq) || c.c.toLowerCase() === nq || c.i3.toLowerCase() === nq;
    return true;
  });
  const el = $('#rows');
  if (!list.length) { el.innerHTML = `<div class="empty"><span class="serif">Aucun pays</span>Essayez une autre recherche ou un autre filtre.</div>`; return; }
  let html = '', L = '';
  for (const c of list) {
    const l = norm(c.n)[0].toUpperCase();
    if (l !== L && !nq) { if (L) html += '</div>'; html += `<div class="letter">${l}</div><div class="rows">`; L = l; }
    else if (!L && nq) { html += '<div class="rows">'; L = '_'; }
    html += rowHTML(c);
  }
  el.innerHTML = html + '</div>';
}
function updateRow(code) {
  const row = $(`#rows .row[data-code="${code}"]`);
  const s = stats();
  $('#listSub') && ($('#listSub').textContent = `${s.been} visité${s.been > 1 ? 's' : ''} · ${s.l} vécu · ${s.w} envie${s.w > 1 ? 's' : ''}`);
  if (row) { const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(BY[code]); const nt = tmp.firstElementChild.querySelector('.tick'); const ot = row.querySelector('.tick'); ot.dataset.s = nt.dataset.s; ot.innerHTML = nt.innerHTML; ot.setAttribute('aria-label', nt.getAttribute('aria-label')); row.querySelector('.rt span').innerHTML = tmp.firstElementChild.querySelector('.rt span').innerHTML; }
  $$('#cbars .contbar').forEach((b, i) => { const k = CONTINENTS[i]; b.querySelector('i').style.width = s.cont[k] / CONT_TOTAL[k] * 100 + '%'; b.querySelector('b').textContent = s.cont[k]; });
  const cnt = {all: TOTAL, been: s.been, l: s.l, w: s.w, todo: TOTAL - s.been - s.w};
  $$('#fs .chip').forEach(ch => ch.querySelector('em').textContent = cnt[ch.dataset.f]);
}

/* ---------------- detail sheet ---------------- */
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtMonth = v => { if (!v) return ''; const [y, m] = v.split('-'); return m ? `${MONTHS[+m - 1]} ${y}` : y; };
function openDetail(code) {
  const c = BY[code]; if (!c) return;
  openSheet(() => detailHTML(code), el => bindDetail(el, code), {name: 'detail', code});
}
function detailHTML(code) {
  const c = BY[code]; const e = state.countries[code] || {}; const s = e.s;
  const h = home(); const d = Math.round(distanceKm(h.ll, c.ll) / 10) * 10;
  const glow = s === 'v' ? 'var(--v)' : s === 'l' ? 'var(--l)' : s === 'w' ? 'var(--w)' : 'var(--surface3)';
  const visits = (e.visits || []).slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  return `
  <div class="d-hero"><div class="glow" style="background:${glow}"></div><div class="d-vis"><canvas id="mini" aria-hidden="true"></canvas><div class="flag d-flag">${c.f}</div></div><h2>${esc(c.n)}</h2><p>${esc(c.en)} · ${esc(c.k)}</p></div>
  ${statusRow(code)}
  <div class="facts" style="margin-top:14px">
    <div class="fact"><div class="eyebrow">Capitale</div><b>${esc(c.cap)}</b></div>
    <div class="fact"><div class="eyebrow">Superficie</div><b>${fmtArea(c.a)} km²</b></div>
    <div class="fact"><div class="eyebrow">${code === h.c ? 'Chez vous' : 'Depuis ' + esc(h.n)}</div><b>${code === h.c ? '0 km' : fmt(d) + ' km'}</b></div>
    <div class="fact"><div class="eyebrow">Part des terres</div><b>${c.a / LAND_TOTAL * 100 < .01 ? '< 0,01' : pctFmt(c.a / LAND_TOTAL * 100, 2)} %</b></div>
    <div class="fact"><div class="eyebrow">Population</div><b>${c.pop ? fmtPop(c.pop) : '—'}</b></div>
    <div class="fact"><div class="eyebrow">Habitants</div><b class="wrap">${esc(c.dem || '—')}</b></div>
    ${c.lg && c.lg.length ? `<div class="fact wide"><div class="eyebrow">Langue${c.lg.length > 1 ? 's' : ''}</div><b class="wrap">${esc(c.lg.join(', '))}</b></div>` : ''}
    ${c.cur ? `<div class="fact wide"><div class="eyebrow">Monnaie</div><b class="wrap">${esc(c.cur)}</b></div>` : ''}
  </div>
  ${(() => { const nb = (c.nb || []).filter(k => BY[k]); if (!nb.length) return ''; const nv = nb.filter(k => been(k)).length;
    return `<div class="blk"><div class="blk-h"><h4>Voisins</h4><span class="muted" style="font-size:12.5px">${nv}/${nb.length} visité${nv > 1 ? 's' : ''}</span></div><div class="nbs">${nb.sort((a, b) => BY[a].n.localeCompare(BY[b].n, 'fr')).map(k => `<button class="nbc ${been(k) ? 'been' : ''}" data-nb="${k}"><span class="flag">${BY[k].f}</span>${esc(BY[k].n)}</button>`).join('')}</div></div>`; })()}
  <div class="blk"><div class="blk-h"><h4>Votre note</h4></div>
    <div class="stars-in" id="stars">${[1, 2, 3, 4, 5].map(i => `<button data-r="${i}" class="${(e.r || 0) >= i ? 'on' : ''}" aria-label="${i} étoile${i > 1 ? 's' : ''}">${icon('star')}</button>`).join('')}</div></div>
  <div class="blk"><div class="blk-h"><h4>Voyages</h4><button class="linkbtn" id="addV">${icon('plus')}Ajouter</button></div>
    <div id="vform"></div>
    ${visits.length ? visits.map(v => `<div class="visit">${icon('calendar')}<div class="vt">${fmtMonth(v.d)}${v.e && v.e !== v.d ? ' → ' + fmtMonth(v.e) : ''}${v.n ? `<span>${esc(v.n)}</span>` : ''}</div><button class="iconbtn" data-del="${esc(v.id)}" aria-label="Supprimer ce voyage">${icon('trash')}</button></div>`).join('') : `<p class="note" style="margin-top:0">Ajoutez les dates de vos séjours pour voir vos voyages par année dans les stats.</p>`}
  </div>
  <div class="blk"><div class="blk-h"><h4>Carnet</h4></div>
    <textarea class="notes" id="notes" placeholder="Souvenirs, bonnes adresses, envies…">${esc(e.n || '')}</textarea></div>
  <button class="cta ghost" id="seeMap">${icon('globe')}Voir sur la carte</button>`;
}
function bindDetail(el, code) {
  el.querySelectorAll('[data-nb]').forEach(b => b.onclick = () => { vib(5); closeSheet(false); history.replaceState(history.state, ''); setTimeout(() => { openDetail(b.dataset.nb); }, 30); });
  const mini = el.querySelector('#mini'); if (mini) requestAnimationFrame(() => map.renderMini(mini, code, readColors(), statusOf));
  el.querySelector('.status-row').addEventListener('click', ev => {
    const b = ev.target.closest('.sbtn'); if (!b) return; toggleStatus(code, b.dataset.s, b);
    const s = statusOf(code); const mc = el.querySelector('#mini'); if (mc) { mc.style.animation = 'none'; map.renderMini(mc, code, readColors(), statusOf); } const g = el.querySelector('.glow'); if (g) g.style.background = s === 'v' ? 'var(--v)' : s === 'l' ? 'var(--l)' : s === 'w' ? 'var(--w)' : 'var(--surface3)';
  });
  el.querySelector('#stars').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return; const e = entry(code); const r = +b.dataset.r;
    e.r = e.r === r ? 0 : r; cleanup(code); save(); vib(6);
    el.querySelectorAll('#stars button').forEach(x => x.classList.toggle('on', +x.dataset.r <= (e.r || 0)));
  });
  let nt; el.querySelector('#notes').addEventListener('input', ev => { clearTimeout(nt); nt = setTimeout(() => { const e = entry(code); e.n = ev.target.value.trim() ? ev.target.value : ''; cleanup(code); save(); }, 300); });
  el.querySelector('#addV').addEventListener('click', () => {
    const f = el.querySelector('#vform'); if (f.innerHTML) { f.innerHTML = ''; return; }
    const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    f.innerHTML = `<div class="vform"><label>Début<input type="month" id="vd" value="${ym}" max="${ym}"></label><label>Fin<input type="month" id="ve" placeholder="optionnel"></label>
      <label class="full">Note<input type="text" id="vn" placeholder="Ex. Road-trip, mariage, Erasmus…" maxlength="80"></label>
      <button class="cta small full" id="vok" style="margin-top:4px">${icon('check')}Enregistrer le voyage</button></div>`;
    f.querySelector('#vok').addEventListener('click', () => {
      const d = f.querySelector('#vd').value; if (!d) { f.querySelector('#vd').focus(); return; }
      let e2 = f.querySelector('#ve').value; if (e2 && e2 < d) e2 = '';
      const e = entry(code); e.visits = e.visits || [];
      e.visits.push({id: Math.random().toString(36).slice(2, 9), d, e: e2 || '', n: f.querySelector('#vn').value.trim()});
      if (!e.s || e.s === 'w') applyStatus(code, 'v', {});
      else save();
      rerenderSheet(); toast('Voyage ajouté');
    });
  });
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const e = entry(code); e.visits = (e.visits || []).filter(v => v.id !== b.dataset.del); cleanup(code); save(); rerenderSheet();
  }));
  el.querySelector('#seeMap').addEventListener('click', () => {
    closeSheet(); go('map');
    setTimeout(() => { map.flyTo(code); openPeek(code); }, 250);
  });
}

/* ---------------- sheet ---------------- */
let sheetOpen = null;
const sheet = $('#sheet'), body = $('#sheetBody'), scrim = $('#scrim');
function openSheet(html, bind, meta = {}) {
  const wasOpen = !!sheetOpen;
  sheetOpen = {html, bind, meta};
  body.innerHTML = html(); bind && bind(body);
  body.scrollTop = 0;
  sheet.classList.add('show'); scrim.classList.add('show');
  if (!wasOpen) history.pushState({v: view, sheet: 1}, '');
}
function rerenderSheet() { if (!sheetOpen) return; const st = body.scrollTop; body.innerHTML = sheetOpen.html(); sheetOpen.bind && sheetOpen.bind(body); body.scrollTop = st; }
function closeSheet(back = true) {
  if (!sheetOpen) return;
  const m = sheetOpen.meta; sheetOpen = null;
  sheet.classList.remove('show'); scrim.classList.remove('show');
  sheet.style.transform = '';
  if (back && history.state?.sheet) { popGuard = true; history.back(); }
  if (view === 'list') renderList(); if (view === 'stats') renderStats(); if (view === 'journal') renderJournal(); if (view === 'more') renderMore();
  if (peekCode) openPeek(peekCode);
  flush();
}
scrim.addEventListener('click', () => closeSheet());
(() => { // drag to close
  let y0 = null, dy = 0, fromBody = false;
  const start = (e, fb) => { if (fb && body.scrollTop > 0) return; y0 = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; fromBody = fb; };
  const move = e => { if (y0 === null) return; const y = e.touches ? e.touches[0].clientY : e.clientY; dy = Math.max(0, y - y0); if (fromBody && dy < 8) return; sheet.classList.add('dragging'); sheet.style.transform = `translateY(${dy}px)`; if (fromBody && e.cancelable) e.preventDefault(); };
  const end = () => { if (y0 === null) return; y0 = null; sheet.classList.remove('dragging'); if (dy > 110) closeSheet(); else sheet.style.transform = ''; };
  const g = $('#grab');
  g.addEventListener('pointerdown', e => { g.setPointerCapture(e.pointerId); start(e, false); });
  g.addEventListener('pointermove', move); g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  body.addEventListener('touchstart', e => start(e, true), {passive: true});
  body.addEventListener('touchmove', move, {passive: false});
  body.addEventListener('touchend', end);
})();

/* ---------------- stats ---------------- */
function renderStats() {
  const s = stats(); const el = $('#v-stats');
  const R = 92, C = 2 * Math.PI * R;
  const beenList = COUNTRIES.filter(c => been(c.c));
  const h = home();
  const far = beenList.filter(c => c.c !== h.c).map(c => ({c, d: distanceKm(h.ll, c.ll)})).sort((a, b) => b.d - a.d)[0];
  const big = beenList.slice().sort((a, b) => b.a - a.a)[0];
  const small = beenList.slice().sort((a, b) => a.a - b.a)[0];
  const top = Object.entries(state.countries).filter(([k, e]) => e.r).sort((a, b) => b[1].r - a[1].r)[0];
  // years
  const years = {};
  for (const [k, e] of Object.entries(state.countries)) {
    if (!(e.s === 'v' || e.s === 'l') || !e.visits?.length) continue;
    const ys = new Set(e.visits.map(v => (v.d || '').slice(0, 4)).filter(Boolean));
    for (const y of ys) years[y] = (years[y] || 0) + 1;
  }
  const yk = Object.keys(years).sort().slice(-8); const ymax = Math.max(1, ...yk.map(y => years[y]));
  const nextM = MILESTONES.find(m => m > s.been) || 197; const prevM = [...MILESTONES].reverse().find(m => m <= s.been) || 0;
  const badges = evaluate(); const nb = badges.filter(b => b.done).length;
  const nextBadge = badges.filter(b => !b.done).sort((a, b) => (b.v / b.goal) - (a.v / a.goal))[0];
  el.innerHTML = `
    <div class="pg-head"><h2>Statistiques</h2><p>Votre monde, en chiffres.</p></div>
    <div class="card hero">
      <div class="ring"><svg viewBox="0 0 210 210"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--v)"/><stop offset="1" stop-color="var(--gold)"/></linearGradient></defs>
        <circle class="trk" cx="105" cy="105" r="${R}" fill="none" stroke-width="10"/>
        <circle class="val" cx="105" cy="105" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - Math.max(s.pct, s.been ? 1.2 : 0) / 100)}"/></svg>
        <div class="ctr"><b>${s.been}</b><span>pays sur ${TOTAL}</span></div></div>
      <div class="metrics">
        <div class="metric"><b>${pctFmt(s.pct)} %</b><span>du monde</span></div>
        <div class="metric"><b>${pctFmt(s.area)} %</b><span>des terres</span></div>
        <div class="metric"><b>${pctFmt(s.pop)} %</b><span>de l’humanité</span></div>
      </div>
      <div class="metrics" style="margin-top:8px">
        <div class="metric"><b>${s.contsVisited}/5</b><span>continents</span></div>
        <div class="metric"><b>${s.w}</b><span>envies</span></div>
        <div class="metric"><b>${nb}/${BADGES.length}</b><span>badges</span></div>
      </div>
      <p class="src" style="text-align:center;margin-top:10px">Vos pays comptent ${s.popAbs ? fmtPop(s.popAbs) : '0'} d’habitants · population : Banque mondiale</p>
    </div>
    <div class="card next"><div class="medal" style="width:48px;height:48px">${icon('sparkle')}</div><div class="nb"><b>Prochain cap : ${nextM} pays</b><p>${s.been >= 197 ? 'Vous avez tout vu. Respect.' : `Encore ${nextM - s.been} pays`}</p><div class="bar"><i style="width:${(s.been - prevM) / Math.max(1, nextM - prevM) * 100}%"></i></div></div></div>

    <div class="section-title"><h3>Par continent</h3><span>${s.contsDone} bouclé${s.contsDone > 1 ? 's' : ''}</span></div>
    <div class="card conts">${CONTINENTS.map(k => `<button class="cont" data-k="${k}"><h4>${k}</h4><span class="frac"><b>${s.cont[k]}</b> / ${CONT_TOTAL[k]} · ${Math.round(s.cont[k] / CONT_TOTAL[k] * 100)} %</span><div class="bar"><i class="${s.cont[k] === CONT_TOTAL[k] ? 'done' : ''}" style="width:0" data-w="${s.cont[k] / CONT_TOTAL[k] * 100}"></i></div></button>`).join('')}</div>

    <div class="section-title"><h3>Records</h3></div>
    <div class="recs">
      ${recCard('Le plus loin', far?.c, far ? `${fmt(Math.round(far.d / 10) * 10)} km de ${esc(h.n)}` : 'Ajoutez des pays')}
      ${recCard('Le plus grand', big, big ? `${fmt(big.a)} km²` : '—')}
      ${recCard('Le plus petit', small, small ? `${fmtArea(small.a)} km²` : '—')}
      ${recCard('Coup de cœur', top ? BY[top[0]] : null, top ? '★'.repeat(top[1].r) : 'Notez un pays')}
    </div>

    <div class="section-title"><h3>Voyages par année</h3><span>${yk.length ? '' : 'à compléter'}</span></div>
    <div class="card years">${yk.length ? `<div class="yb">${yk.map((y, i) => `<div class="col"><b>${years[y]}</b><i style="height:${years[y] / ymax * 80}%;animation-delay:${i * 60}ms"></i><span>${y}</span></div>`).join('')}</div>` : `<p class="note" style="margin:0;text-align:center">Ouvrez la fiche d’un pays et ajoutez la date de votre voyage : votre frise apparaîtra ici.</p>`}</div>

    <div class="section-title"><h3>Badges</h3><span>${nb} sur ${BADGES.length}</span></div>
    ${nextBadge ? `<p class="note" style="margin:-4px 4px 12px">Le plus proche : <b style="color:var(--fg)">${esc(nextBadge.name)}</b> — ${nextBadge.v}/${nextBadge.goal}</p>` : ''}
    <div class="badges">${badges.map(b => `<div class="badge card ${b.done ? '' : 'locked'}"><div class="medal">${icon(b.icon)}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>${b.done ? '' : `<div class="mini"><i style="width:${b.v / b.goal * 100}%"></i></div>`}</div>`).join('')}</div>
    <button class="cta" id="sharePoster">${icon('share')}Créer mon affiche à partager</button>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const v = el.querySelector('.ring .val'); if (v) v.style.strokeDashoffset = v.dataset.off;
    el.querySelectorAll('.cont .bar i').forEach(i => i.style.width = i.dataset.w + '%');
  }));
  el.querySelector('#sharePoster').onclick = openPoster;
  el.querySelectorAll('.cont').forEach(b => b.onclick = () => { fCont = b.dataset.k; fStatus = 'all'; go('list'); });
  el.querySelectorAll('.rec[data-code]').forEach(b => b.onclick = () => openDetail(b.dataset.code));
}
function recCard(label, c, sub) {
  return `<div class="rec card" ${c ? `data-code="${c.c}" role="button"` : ''}><div class="eyebrow">${label}</div><div class="rv">${c ? `<span class="flag">${c.f}</span><b>${esc(c.n)}</b>` : '<b style="color:var(--subtle)">—</b>'}</div><small>${sub}</small></div>`;
}

/* ---------------- settings ---------------- */
function renderMore() {
  const el = $('#v-more');
  const opts = SORTED.map(c => `<option value="${c.c}" ${c.c === state.home ? 'selected' : ''}>${c.n}</option>`).join('');
  const seg = (name, val, items) => `<div class="seg small" data-seg="${name}"><i class="seg-ind"></i>${items.map(([k, l]) => `<button data-v="${k}" aria-selected="${val === k}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `
    <div class="pg-head"><h2>Réglages</h2><p>Votre carte reste sur ce téléphone, même sans réseau.</p></div>
    <div class="eyebrow group-title">Apparence</div>
    <div class="card group">
      <div class="item"><div class="i-ic">${icon(document.documentElement.dataset.theme === 'light' ? 'sun' : 'moon')}</div><div class="i-t"><b>Thème</b></div>${seg('theme', state.theme, [['auto', 'Auto'], ['dark', 'Sombre'], ['light', 'Clair']])}</div>
      <div class="item"><div class="i-ic">${icon('layers')}</div><div class="i-t"><b>Vue au démarrage</b></div>${seg('view', state.view, [['globe', 'Globe'], ['flat', 'Plan']])}</div>
    </div>
    <div class="eyebrow group-title">Carte</div>
    <div class="card group">
      <button class="item" id="quick"><div class="i-ic">${icon('sparkle')}</div><div class="i-t"><b>Toucher rapide</b><span>Un toucher sur la carte = visité</span></div><span class="switch ${state.quick ? 'on' : ''}"></span></button>
      <label class="item"><div class="i-ic">${icon('home')}</div><div class="i-t"><b>Chez moi</b><span>Pour les distances</span></div><select class="select" id="home">${opts}</select></label>
    </div>
    <div class="eyebrow group-title">Partage</div>
    <div class="card group">
      <button class="item" id="poster"><div class="i-ic">${icon('share')}</div><div class="i-t"><b>Mon affiche</b><span>Une belle image de votre carte</span></div>${icon('chevron')}</button>
    </div>
    <div class="eyebrow group-title">Données</div>
    <div class="card group">
      <button class="item" id="imp"><div class="i-ic">${icon('upload')}</div><div class="i-t"><b>Importer depuis l’ancienne appli</b><span>Une liste de pays ou de codes</span></div>${icon('chevron')}</button>
      <button class="item" id="exp"><div class="i-ic">${icon('download')}</div><div class="i-t"><b>Exporter une sauvegarde</b><span>Fichier .json</span></div>${icon('chevron')}</button>
      <label class="item" for="file"><div class="i-ic">${icon('undo')}</div><div class="i-t"><b>Restaurer une sauvegarde</b><span>Depuis un fichier .json</span></div>${icon('chevron')}</label>
      <button class="item danger" id="reset"><div class="i-ic">${icon('trash')}</div><div class="i-t"><b>Tout effacer</b><span>Remet la carte à zéro</span></div></button>
    </div>
    <input type="file" id="file" accept="application/json,.json" class="sr">
    <div class="about"><div class="serif">Mappemonde</div>Version 3 · ${COUNTRIES.length} pays · Fonctionne hors connexion<br>Carte : Natural Earth · Population : Banque mondiale</div>`;
  el.querySelectorAll('[data-seg]').forEach(s => {
    placeSeg(s);
    s.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const k = s.dataset.seg; state[k] = b.dataset.v; save();
      s.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', x === b)); placeSeg(s);
      if (k === 'theme') { applyTheme(); setTimeout(renderMore, 30); }
      if (k === 'view') setMode(b.dataset.v, false);
    });
  });
  el.querySelector('#quick').onclick = e => { state.quick = !state.quick; save(); e.currentTarget.querySelector('.switch').classList.toggle('on', state.quick); };
  el.querySelector('#home').onchange = e => { state.home = e.target.value; save(); toast(`Chez vous : ${BY[state.home].n}`); };
  el.querySelector('#poster').onclick = openPoster;
  el.querySelector('#imp').onclick = () => openImport();
  el.querySelector('#exp').onclick = doExport;
  el.querySelector('#file').onchange = doRestore;
  el.querySelector('#reset').onclick = confirmReset;
}
function placeSeg(s) {
  const btns = [...s.querySelectorAll('button')]; const on = btns.find(b => b.getAttribute('aria-selected') === 'true') || btns[0];
  const ind = s.querySelector('.seg-ind');
  requestAnimationFrame(() => { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft - 4}px)`; });
}
function doExport() {
  const blob = new Blob([exportJSON()], {type: 'application/json'});
  const d = new Date(); const name = `mappemonde-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([blob], name, {type: 'application/json'});
  if (navigator.canShare && navigator.canShare({files: [file]})) { navigator.share({files: [file], title: 'Sauvegarde Mappemonde'}).catch(() => download(blob, name)); }
  else download(blob, name);
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Sauvegarde téléchargée'); }
function doRestore(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const r = parseImport(t);
    if (r.backup) { replaceState(r.backup); applyTheme(); renderHeader(); renderMore(); hint(); toast(`Sauvegarde restaurée · ${stats().been} pays`); }
    else if (r.codes.length) { openImport(r.codes.join(', ')); }
    else toast('Fichier non reconnu');
  });
  e.target.value = '';
}
function confirmReset() {
  const m = $('#modal');
  m.innerHTML = `<div class="mcard"><div class="eyebrow" style="color:#e0705a">Attention</div><h3>Effacer la carte ?</h3><p>Tous vos pays, voyages et notes seront retirés. Pensez à exporter une sauvegarde avant.</p><div class="row2"><button class="cta ghost small" data-act="ok">Annuler</button><button class="cta small" id="doReset" style="background:#e0705a;color:#fff">Tout effacer</button></div></div>`;
  m.classList.add('show');
  m.querySelector('#doReset').addEventListener('click', ev => { ev.stopPropagation(); resetAll(); m.classList.remove('show'); renderHeader(); hint(); renderMore(); map.request(); toast('Carte remise à zéro'); });
}

/* ---------------- import ---------------- */
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const BOOKMARKLET = `javascript:(function(){var v=[];try{v=JSON.parse(localStorage.getItem('mappemonde.visited.v1')||'[]')}catch(e){}location.href='${APP_URL}#import='+v.join(',')})()`;
function openImport(prefill = '') {
  let txt = prefill, st = 'v', tab = prefill ? 'paste' : 'paste';
  const html = () => {
    const r = parseImport(txt);
    return `<h3 class="sh-title">Récupérer vos pays</h3><p class="sh-sub">Votre ancienne Mappemonde garde ses pays dans son propre site : on les ramène ici en un geste.</p>
      <div class="seg small tabs2" data-seg="imptab"><i class="seg-ind"></i><button data-v="paste" aria-selected="${tab === 'paste'}">Coller une liste</button><button data-v="auto" aria-selected="${tab === 'auto'}">Transfert auto</button></div>
      ${tab === 'paste' ? `
      <textarea class="notes" id="impTxt" placeholder="France, Espagne, Italie, Maroc…&#10;ou : FR ES IT MA">${esc(txt)}</textarea>
      <p class="note">Noms en français ou en anglais, codes ISO (FR, FRA), séparés par des virgules ou des retours à la ligne. Les fautes légères sont corrigées.</p>
      <div class="preview" id="pv">${pvHTML(r)}</div>
      <div class="blk-h" style="margin-top:14px"><span class="eyebrow">Ajouter comme</span></div>
      <div class="seg small" data-seg="impst" style="display:grid;width:100%"><i class="seg-ind"></i><button data-v="v" aria-selected="${st === 'v'}">Visités</button><button data-v="l" aria-selected="${st === 'l'}">Vécu</button><button data-v="w" aria-selected="${st === 'w'}">Envies</button></div>
      <button class="cta" id="impGo" ${r.codes.length ? '' : 'disabled style="opacity:.45"'}>${icon('check')}${r.codes.length ? `Ajouter ${r.codes.length} pays` : 'Ajouter'}</button>` : `
      <div class="steps">
        <div class="step"><div>Copiez ce lien magique.<br><span>Il lit vos pays dans l’ancienne appli et les envoie ici.</span></div></div>
      </div>
      <div class="code"><span>${esc(BOOKMARKLET)}</span><button class="iconbtn" id="cpy" aria-label="Copier">${icon('copy')}</button></div>
      <div class="steps" style="counter-reset:s 1">
        <div class="step"><div>Dans Chrome, ajoutez un favori (⋮ puis ☆), puis modifiez-le : nom <b>monde</b>, adresse : collez le lien.</div></div>
        <div class="step"><div>Ouvrez l’ancienne Mappemonde, tapez <b>monde</b> dans la barre d’adresse et touchez le favori.</div></div>
        <div class="step"><div>Vous revenez ici avec vos pays prêts à ajouter.<br><span>Plus simple : recopiez vos pays dans « Coller une liste ».</span></div></div>
      </div>`}`;
  };
  const bind = el => {
    el.querySelectorAll('[data-seg]').forEach(s => { placeSeg(s); s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (s.dataset.seg === 'imptab') { tab = b.dataset.v; rerenderSheet(); } else { st = b.dataset.v; s.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', x === b)); placeSeg(s); } }); });
    const ta = el.querySelector('#impTxt');
    if (ta) ta.addEventListener('input', () => { txt = ta.value; const r = parseImport(txt); el.querySelector('#pv').innerHTML = pvHTML(r); const go = el.querySelector('#impGo'); go.disabled = !r.codes.length; go.style.opacity = r.codes.length ? '' : '.45'; go.innerHTML = icon('check') + (r.codes.length ? `Ajouter ${r.codes.length} pays` : 'Ajouter'); });
    const g = el.querySelector('#impGo');
    if (g) g.addEventListener('click', () => {
      const r = parseImport(txt);
      if (r.backup) { replaceState(r.backup); closeSheet(); renderHeader(); hint(); toast('Sauvegarde restaurée'); return; }
      if (!r.codes.length) return;
      const before = stats(); let n = 0;
      for (const c of r.codes) { const cur = statusOf(c); if (cur === st || (st === 'w' && (cur === 'v' || cur === 'l'))) continue; entry(c).s = st; entry(c).t = Date.now(); n++; }
      state.seen = state.seen || {}; state.seen.importBanner = 1;
      for (const m of MILESTONES) if (m <= stats().been) state.seen['m' + m] = 1;
      const fresh = checkNew(); save(); flush();
      closeSheet(); renderHeader(true); hint(); map.request();
      if (view !== 'map') go('map');
      toast(`${n} pays ajouté${n > 1 ? 's' : ''} à votre carte`);
      const after = stats();
      if (after.been > before.been) { setTimeout(() => confetti({count: 160}), 300); if (fresh.length) { queue.push(...fresh.slice(0, 1).map(b => ({kind: 'badge', b}))); setTimeout(showNextCelebration, 900); } }
    });
    const cp = el.querySelector('#cpy');
    if (cp) cp.addEventListener('click', () => { navigator.clipboard?.writeText(BOOKMARKLET).then(() => toast('Lien copié'), () => toast('Copie impossible : sélectionnez le texte')); });
  };
  openSheet(html, bind, {name: 'import'});
}
function pvHTML(r) {
  if (!r.codes.length && !r.unknown.length) return '';
  return r.codes.map(c => `<span class="pv"><span class="flag">${BY[c].f}</span>${esc(BY[c].n)}</span>`).join('') + r.unknown.slice(0, 12).map(u => `<span class="pv bad">? ${esc(u)}</span>`).join('');
}

/* ---------------- poster ---------------- */
function openPoster() {
  let style = state.poster || 'nuit'; let url = null, blob = null;
  const html = () => `<h3 class="sh-title">Mon affiche</h3><p class="sh-sub">Une image de votre carte, prête pour Instagram ou WhatsApp.</p>
    <div class="seg small tabs2" data-seg="pst"><i class="seg-ind"></i><button data-v="nuit" aria-selected="${style === 'nuit'}">Nuit</button><button data-v="papier" aria-selected="${style === 'papier'}">Papier</button></div>
    <div class="poster-wrap" id="pw"><div class="spin"></div></div>
    <div class="row2" style="margin-top:14px"><button class="cta ghost small" id="psave">${icon('download')}Enregistrer</button><button class="cta small" id="pshare">${icon('share')}Partager</button></div>`;
  const render = async el => {
    const pw = el.querySelector('#pw'); pw.innerHTML = '<div class="spin"></div>';
    if (!map.full) { await new Promise(r => { const i = setInterval(() => { if (map.full) { clearInterval(i); r(); } }, 100); }); }
    blob = await makePoster(map, style);
    if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
    pw.innerHTML = `<img src="${url}" alt="Affiche de votre carte du monde">`;
  };
  const bind = el => {
    const s = el.querySelector('[data-seg]'); placeSeg(s);
    s.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; style = b.dataset.v; state.poster = style; save(); s.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', x === b)); placeSeg(s); render(el); });
    el.querySelector('#psave').onclick = () => blob && download(blob, 'ma-mappemonde.png');
    el.querySelector('#pshare').onclick = async () => {
      if (!blob) return; const file = new File([blob], 'ma-mappemonde.png', {type: 'image/png'});
      if (navigator.canShare && navigator.canShare({files: [file]})) { try { await navigator.share({files: [file], title: 'Ma Mappemonde', text: `J’ai visité ${stats().been} pays sur ${TOTAL} !`}); } catch {} }
      else download(blob, 'ma-mappemonde.png');
    };
    render(el);
  };
  openSheet(html, bind, {name: 'poster'});
}

/* ---------------- journal ---------------- */
function renderJournal() {
  const el = $('#v-journal'); const trips = allTrips();
  const firstOf = {}; for (const t of trips) if (!firstOf[t.code]) firstOf[t.code] = t.id;
  const byYear = {}; for (const t of trips) (byYear[t.d.slice(0, 4)] ||= []).push(t);
  const years = Object.keys(byYear).sort().reverse();
  const nC = Object.keys(firstOf).length;
  const undated = COUNTRIES.filter(c => been(c.c) && !(state.countries[c.c].visits || []).length).length;
  el.innerHTML = `
    <div class="pg-head"><h2>Journal</h2><p>${trips.length ? `${trips.length} voyage${trips.length > 1 ? 's' : ''} · ${nC} pays datés` : 'Vos voyages, dans l’ordre.'}</p></div>
    ${trips.length ? `<button class="cta" id="jReplay">${icon('play')}Rejouer mes voyages</button>
    <div class="tl">${years.map(y => `<div class="tl-year"><h3>${y}</h3><span>${byYear[y].length} voyage${byYear[y].length > 1 ? 's' : ''} · ${new Set(byYear[y].map(t => t.code)).size} pays</span></div>
      ${byYear[y].slice().reverse().map(t => `<button class="card trip" data-code="${t.code}"><span class="flag">${BY[t.code].f}</span><div class="tt"><b>${esc(BY[t.code].n)}</b><span>${fmtMonth(t.d)}${t.e && t.e !== t.d ? ' → ' + fmtMonth(t.e) : ''}${t.n ? ' · ' + esc(t.n) : ''}</span></div>${firstOf[t.code] === t.id ? '<span class="new">1ʳᵉ fois</span>' : ''}</button>`).join('')}`).join('')}</div>`
    : `<div class="card empty" style="padding:28px 20px"><span class="serif">Aucun voyage daté</span>Ouvrez un pays, puis « Voyages » → <b>Ajouter</b> pour noter vos séjours. Ils apparaîtront ici, et vous pourrez les rejouer sur le globe.</div>`}
    ${undated ? `<p class="note" style="text-align:center">${undated} pays visité${undated > 1 ? 's' : ''} sans date. <button class="linkbtn" id="jList" style="display:inline">Compléter</button></p>` : ''}
    <div style="height:20px"></div>`;
  el.querySelectorAll('.trip').forEach(b => b.onclick = () => openDetail(b.dataset.code));
  const r = el.querySelector('#jReplay'); if (r) r.onclick = replay;
  const l = el.querySelector('#jList'); if (l) l.onclick = () => { fStatus = 'been'; go('list'); };
}
let replaying = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function replay() {
  const trips = allTrips(); if (!trips.length || replaying) return;
  const token = replaying = {stop: false};
  go('map'); closePeek(true); map.select(null);
  replaySet = new Set(); map.request();
  app.classList.add('replaying');
  const rp = $('#replay');
  rp.innerHTML = `<div class="rp-year" id="rpY">&nbsp;</div><div class="rp-country" id="rpC"></div><div class="rp-meta" id="rpM"></div><div class="rp-bar"><i id="rpB"></i></div><button class="rp-stop" id="rpS">${icon('stop')}Arrêter</button>`;
  $('#rpS').onclick = stopReplay;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastY = '';
  await sleep(400);
  for (let i = 0; i < trips.length; i++) {
    if (token.stop) return;
    const t = trips[i], c = BY[t.code]; const y = t.d.slice(0, 4);
    if (y !== lastY) { const Y = $('#rpY'); Y.textContent = y; Y.classList.remove('flip'); void Y.offsetWidth; Y.classList.add('flip'); lastY = y; }
    const C = $('#rpC'); C.innerHTML = `<span class="flag">${c.f}</span>${esc(c.n)}`; C.classList.remove('flip'); void C.offsetWidth; C.classList.add('flip');
    const isNew = !replaySet.has(t.code);
    replaySet.add(t.code);
    $('#rpM').textContent = `${fmtMonth(t.d)} · ${replaySet.size} pays`;
    $('#rpB').style.width = (i + 1) / trips.length * 100 + '%';
    if (map.mode === 'globe') map.flyTo(t.code, {d: reduce ? 1 : 1300, k: 1.3}); else map.flyTo(t.code, {d: reduce ? 1 : 1100});
    map.request();
    await sleep(reduce ? 500 : 650); if (token.stop) return;
    if (isNew) { map.pulse && map.pulse(t.code); vib(8); }
    await sleep(reduce ? 600 : 1050);
  }
  if (token.stop) return;
  $('#rpY').textContent = `${replaySet.size} pays`; $('#rpC').innerHTML = `${trips.length} voyage${trips.length > 1 ? 's' : ''} · ${trips[0].d.slice(0, 4)} → ${trips[trips.length - 1].d.slice(0, 4)}`;
  $('#rpM').textContent = 'Et ce n’est que le début'; $('#rpS').innerHTML = `${icon('check')}Terminer`;
  if (!reduce) confetti({count: 90});
  await sleep(4500); if (replaying === token) stopReplay();
}
function stopReplay() {
  if (!replaying) return; replaying.stop = true; replaying = null; replaySet = null;
  app.classList.remove('replaying'); map.request();
}

/* ---------------- mode / controls ---------------- */
function setMode(m, persist = true) {
  map.setMode(m); app.dataset.mode = m;
  const seg = $('#modeSeg'); seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m)); placeSeg(seg);
  if (persist) { state.view = m; save(); }
  if (peekCode) setTimeout(() => map.flyTo(peekCode, {d: 900}), 50);
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.mode); vib(5); } });
$('#zin').innerHTML = icon('plus'); $('#zout').innerHTML = icon('minus'); $('#zreset').innerHTML = icon('target');
$('#zin').onclick = () => map.zoom(1.6); $('#zout').onclick = () => map.zoom(1 / 1.6);
$('#zreset').onclick = () => map.reset(state.home);
$('#zsurp').innerHTML = icon('dice');
$('#zsurp').onclick = () => {
  const wish = COUNTRIES.filter(c => statusOf(c.c) === 'w'), todo = COUNTRIES.filter(c => !statusOf(c.c));
  const pool = wish.length && Math.random() < .4 ? wish : (todo.length ? todo : COUNTRIES);
  const c = pool[Math.floor(Math.random() * pool.length)];
  closePeek(true); vib(10);
  map.flyTo(c.c, {d: 1900});
  setTimeout(() => { openPeek(c.c); toast(statusOf(c.c) === 'w' ? `Et si c’était ${c.n} ?` : `Pourquoi pas ${c.n} ?`); }, 1200);
};
$('#counter').onclick = () => go('stats');
$$('.tab').forEach(t => { t.querySelector('.ti').outerHTML = icon(t.querySelector('.ti').dataset.icon); t.onclick = () => go(t.dataset.view); });

subscribe(meta => { if (meta.type === 'replace') { map && map.request(); } });

/* ---------------- boot ---------------- */
applyTheme();
makeStars();
initMap();
renderHeader();
renderLegend();
setMode(map.mode, false);
hint();
const h0 = location.hash.slice(1);
function hashImport() {
  const h = location.hash.slice(1); if (!h.startsWith('import=')) return false;
  const codes = decodeURIComponent(h.slice(7));
  history.replaceState({v: 'map'}, '', location.pathname);
  if (sheetOpen) closeSheet(false);
  setTimeout(() => openImport(codes || ''), 500);
  return true;
}
addEventListener('hashchange', hashImport);
if (h0.startsWith('import=')) {
  hashImport();
} else if (['list', 'journal', 'stats', 'more'].includes(h0)) { history.replaceState({v: 'map'}, '', location.pathname); go(h0); }
else history.replaceState({v: 'map'}, '', location.pathname);
go(view === 'map' ? 'map' : view, {push: false});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(() => {}));
}
window.__mm = {renderJournal, replay, openSearch, openColorBy, mapStatus, state, map: () => map, go, openDetail, openImport, openPoster, applyStatus, openPeek, setMode, closeSheet, renderStats, showNextCelebration, queue};
