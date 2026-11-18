import {COUNTRIES} from './countries.js';

export const TOTAL = COUNTRIES.length;
export const BY = Object.fromEntries(COUNTRIES.map(c => [c.c, c]));
export const CONTINENTS = ['Afrique', 'Amériques', 'Asie', 'Europe', 'Océanie'];
export const CONT_TOTAL = Object.fromEntries(CONTINENTS.map(k => [k, COUNTRIES.filter(c => c.k === k).length]));
export const LAND_TOTAL = COUNTRIES.reduce((s, c) => s + c.a, 0);
export const POP_TOTAL = COUNTRIES.reduce((s, c) => s + (c.pop || 0), 0);
export const STATUS = {
  v: {label: 'Visité', plural: 'Visités'},
  l: {label: 'Vécu', plural: 'Vécu'},
  w: {label: 'Envie', plural: 'Envies'},
};

const KEY = 'mappemonde.v2';
const LEGACY = 'mappemonde.visited.v1';

const defaults = () => ({v: 2, schema: 3, countries: {}, home: 'FR', theme: 'auto', view: 'globe', quick: false, badges: [], seen: {}, poster: 'nuit', colorBy: 'status', wishOrder: [], quiz: {}});

function load() {
  let s = null, raw = null;
  try { raw = localStorage.getItem(KEY); s = JSON.parse(raw || 'null'); } catch {}
  // safety copy of the previous schema before the first v3 save (never overwritten)
  try { if (raw && s && (s.schema || 2) < 3 && !localStorage.getItem(KEY + '.backup-schema2')) localStorage.setItem(KEY + '.backup-schema2', raw); } catch {}
  if (!s || typeof s !== 'object') s = defaults();
  s = Object.assign(defaults(), s);
  if (!s.countries || typeof s.countries !== 'object') s.countries = {};
  // legacy (same origin only) — harmless elsewhere
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY) || '[]');
    if (Array.isArray(old)) for (const c of old) { const k = String(c).toUpperCase(); if (BY[k] && !s.countries[k]) s.countries[k] = {s: 'v', t: Date.now()}; }
  } catch {}
  for (const k of Object.keys(s.countries)) if (!BY[k]) delete s.countries[k];
  // schema 3: additive fields only
  if (!Array.isArray(s.wishOrder)) s.wishOrder = [];
  if (!s.quiz || typeof s.quiz !== 'object') s.quiz = {};
  if (!['status', 'trips', 'rating'].includes(s.colorBy)) s.colorBy = 'status';
  for (const e of Object.values(s.countries)) { if (e.visits && !Array.isArray(e.visits)) e.visits = []; if (e.plan && !/^\d{4}-\d{2}-\d{2}$/.test(e.plan)) delete e.plan; }
  s.schema = 3;
  return s;
}

export const state = load();
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
let saveT = 0;
export function save(meta = {}) {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }, 60);
  for (const fn of subs) fn(meta);
}
export function flush() { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.hidden && flush());

export const statusOf = code => state.countries[code]?.s || null;
export const been = code => { const s = statusOf(code); return s === 'v' || s === 'l'; };
export function entry(code) { return state.countries[code] || (state.countries[code] = {s: null}); }

export function setStatus(code, s) {
  const e = entry(code);
  const prev = e.s || null;
  e.s = s || null; e.t = Date.now();
  cleanup(code);
  save({type: 'status', code, prev, next: e.s});
  return prev;
}
export function cleanup(code) {
  const e = state.countries[code];
  if (!e) return;
  if (!e.s && !(e.visits && e.visits.length) && !e.r && !e.n && !e.plan) delete state.countries[code];
}

export function stats() {
  const list = COUNTRIES;
  let v = 0, l = 0, w = 0, area = 0, pop = 0;
  const cont = Object.fromEntries(CONTINENTS.map(k => [k, 0]));
  for (const c of list) {
    const s = statusOf(c.c);
    if (s === 'v') v++; else if (s === 'l') l++; else if (s === 'w') w++;
    if (s === 'v' || s === 'l') { area += c.a; pop += c.pop || 0; cont[c.k]++; }
  }
  const beenN = v + l;
  return {v, l, w, been: beenN, pct: beenN / TOTAL * 100, area: area / LAND_TOTAL * 100, pop: pop / POP_TOTAL * 100, popAbs: pop, cont,
    contsVisited: CONTINENTS.filter(k => cont[k] > 0).length,
    contsDone: CONTINENTS.filter(k => cont[k] === CONT_TOTAL[k]).length};
}

export function distanceKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const [la1, lo1] = a, [la2, lo2] = b;
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function exportJSON() {
  return JSON.stringify({app: 'mappemonde', version: 2, exported: new Date().toISOString(), data: state}, null, 2);
}
export function replaceState(data) {
  const d = Object.assign(defaults(), data);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, d);
  for (const k of Object.keys(state.countries)) if (!BY[k]) delete state.countries[k];
  save({type: 'replace'}); flush();
}
export function resetAll() {
  state.countries = {}; state.badges = []; state.seen = {};
  save({type: 'replace'}); flush();
}

/** all dated trips, oldest first: [{code, d, e, n, id}] */
export function allTrips() {
  const out = [];
  for (const [code, e] of Object.entries(state.countries)) for (const v of e.visits || []) if (v.d) out.push({code, ...v});
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.code.localeCompare(b.code));
}
/** wish list ordered by user ranking */
export function wishList() {
  const wish = Object.keys(state.countries).filter(k => state.countries[k].s === 'w');
  const order = (state.wishOrder || []).filter(k => wish.includes(k));
  for (const k of wish) if (!order.includes(k)) order.push(k);
  state.wishOrder = order;
  return order;
}
export function nextPlan() {
  const today = new Date().toISOString().slice(0, 10);
  return Object.entries(state.countries).filter(([k, e]) => e.plan && e.plan >= today).map(([code, e]) => ({code, plan: e.plan})).sort((a, b) => a.plan.localeCompare(b.plan))[0] || null;
}
