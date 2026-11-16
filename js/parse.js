import {COUNTRIES, } from './countries.js';
import {BY} from './store.js';

export const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const ALIASES = {
  'usa': 'US', 'us': 'US', 'etats unis d amerique': 'US', 'amerique': 'US', 'america': 'US', 'u s a': 'US',
  'uk': 'GB', 'angleterre': 'GB', 'england': 'GB', 'ecosse': 'GB', 'scotland': 'GB', 'pays de galles': 'GB', 'wales': 'GB', 'grande bretagne': 'GB', 'great britain': 'GB', 'irlande du nord': 'GB',
  'hollande': 'NL', 'holland': 'NL', 'pays bas': 'NL', 'russie': 'RU', 'coree': 'KR', 'coree du sud': 'KR', 'korea': 'KR',
  'rdc': 'CD', 'congo kinshasa': 'CD', 'congo brazzaville': 'CG', 'emirats': 'AE', 'emirats arabes unis': 'AE', 'dubai': 'AE', 'eau': 'AE', 'uae': 'AE',
  'tchequie': 'CZ', 'republique tcheque': 'CZ', 'czech republic': 'CZ', 'czechia': 'CZ', 'birmanie': 'MM', 'burma': 'MM', 'swaziland': 'SZ',
  'cap vert': 'CV', 'ivory coast': 'CI', 'cote d ivoire': 'CI', 'cote divoire': 'CI', 'vatican': 'VA', 'saint siege': 'VA', 'macedoine': 'MK',
  'perse': 'IR', 'ceylan': 'LK', 'siam': 'TH', 'timor leste': 'TL', 'east timor': 'TL', 'palestine': 'PS', 'taiwan': 'TW', 'formose': 'TW',
  'bielorussie': 'BY', 'belarus': 'BY', 'moldavie': 'MD', 'kirghizistan': 'KG', 'kirghizstan': 'KG', 'suisse': 'CH', 'switzerland': 'CH',
  'allemagne': 'DE', 'germany': 'DE', 'espagne': 'ES', 'spain': 'ES', 'italie': 'IT', 'italy': 'IT', 'japon': 'JP', 'chine': 'CN', 'maroc': 'MA',
  'turquie': 'TR', 'turkiye': 'TR', 'grece': 'GR', 'tunisie': 'TN', 'algerie': 'DZ', 'mexique': 'MX', 'bresil': 'BR', 'etats unis': 'US',
  'bosnie': 'BA', 'nouvelle zelande': 'NZ', 'papouasie': 'PG', 'sao tome': 'ST', 'saint marin': 'SM', 'trinite': 'TT', 'guinee equatoriale': 'GQ',
  'reunion': 'FR', 'la reunion': 'FR', 'martinique': 'FR', 'guadeloupe': 'FR', 'guyane': 'FR', 'corse': 'FR', 'tahiti': 'FR', 'polynesie': 'FR', 'nouvelle caledonie': 'FR', 'mayotte': 'FR',
  'hawai': 'US', 'hawaii': 'US', 'porto rico': 'US', 'groenland': 'DK', 'greenland': 'DK', 'canaries': 'ES', 'baleares': 'ES', 'madere': 'PT', 'acores': 'PT', 'sicile': 'IT', 'sardaigne': 'IT',
  'hong kong': 'CN', 'macao': 'CN', 'tibet': 'CN', 'zanzibar': 'TZ', 'bali': 'ID', 'crete': 'GR',
};

let index = null;
function buildIndex() {
  index = new Map();
  const add = (k, c) => { k = norm(k); if (k && !index.has(k)) index.set(k, c); };
  for (const c of COUNTRIES) {
    add(c.c, c.c); add(c.i3, c.c); add(c.n, c.c); add(c.en, c.c);
    for (const a of c.alt || []) add(a, c.c);
  }
  for (const [k, v] of Object.entries(ALIASES)) index.set(norm(k), v);
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

export function matchOne(token) {
  if (!index) buildIndex();
  const raw = String(token).trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw) && BY[raw.toUpperCase()]) return raw.toUpperCase();
  const k = norm(raw.replace(/^(le|la|les|l)\s+/i, ''));
  if (index.has(k)) return index.get(k);
  const k2 = norm(raw);
  if (index.has(k2)) return index.get(k2);
  if (k.length >= 5) {
    let best = null, bd = 3;
    for (const [name, code] of index) {
      if (name.length < 4) continue;
      const d = lev(k, name);
      if (d < bd) { bd = d; best = code; }
    }
    if (best && bd <= (k.length > 8 ? 2 : 1)) return best;
  }
  return null;
}

/** Returns {codes:[...], unknown:[...], backup: object|null} */
export function parseImport(text) {
  const t = String(text || '').trim();
  if (!t) return {codes: [], unknown: [], backup: null};
  if (t[0] === '{' || t[0] === '[') {
    try {
      const j = JSON.parse(t);
      if (j && j.app === 'mappemonde' && j.data && j.data.countries) return {codes: Object.keys(j.data.countries), unknown: [], backup: j.data};
      if (j && j.countries && typeof j.countries === 'object' && !Array.isArray(j.countries)) return {codes: Object.keys(j.countries), unknown: [], backup: j};
      const arr = Array.isArray(j) ? j : Array.isArray(j?.visited) ? j.visited : null;
      if (arr) return fromTokens(arr.map(String));
    } catch {}
  }
  const tokens = t.replace(/^#?import=/, '').split(/[\n,;|\t•·]+|\s{2,}/).map(s => s.replace(/^[\s\-–*\d.)✓✔☑️]+/, '').trim()).filter(Boolean);
  return fromTokens(tokens);
}

function fromTokens(tokens) {
  const codes = [], unknown = [], seen = new Set();
  for (const tok of tokens) {
    let c = matchOne(tok);
    if (!c) {
      // maybe space-separated codes or names: try word-level split
      const parts = tok.split(/\s+/);
      if (parts.length > 1 && parts.every(p => /^[A-Za-z]{2,3}$/.test(p))) {
        for (const p of parts) { const m = matchOne(p); if (m && !seen.has(m)) { seen.add(m); codes.push(m); } }
        continue;
      }
      unknown.push(tok); continue;
    }
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }
  return {codes, unknown, backup: null};
}
