import {COUNTRIES} from './countries.js';
import {state, been, stats, BY, distanceKm, CONTINENTS, CONT_TOTAL, statusOf} from './store.js';

const MICRO = ['VA', 'MC', 'SM', 'LI', 'AD', 'MT'];
const n = () => COUNTRIES.filter(c => been(c.c));
const home = () => BY[state.home] || BY.FR;

// icon names refer to glyphs in ui icons
export const BADGES = [
  {id: 'b1', icon: 'stamp', name: 'Premier tampon', desc: 'Votre premier pays', goal: 1, val: () => n().length},
  {id: 'b5', icon: 'compass', name: 'Baroudeur', desc: '5 pays visités', goal: 5, val: () => n().length},
  {id: 'b10', icon: 'plane', name: 'Explorateur', desc: '10 pays visités', goal: 10, val: () => n().length},
  {id: 'b25', icon: 'globe', name: 'Globe-trotteur', desc: '25 pays visités', goal: 25, val: () => n().length},
  {id: 'b50', icon: 'sextant', name: 'Grand voyageur', desc: '50 pays visités', goal: 50, val: () => n().length},
  {id: 'b100', icon: 'crown', name: 'Centurion', desc: '100 pays visités', goal: 100, val: () => n().length},
  {id: 'b197', icon: 'sun', name: 'Citoyen du monde', desc: 'Les 197 pays', goal: 197, val: () => n().length},
  {id: 'c3', icon: 'tri', name: 'Trois continents', desc: '3 continents différents', goal: 3, val: () => stats().contsVisited},
  {id: 'c5', icon: 'rings', name: 'Les cinq continents', desc: 'Au moins un pays par continent', goal: 5, val: () => stats().contsVisited},
  {id: 'cdone', icon: 'laurel', name: 'Continent bouclé', desc: 'Tous les pays d’un continent', goal: 1, val: () => stats().contsDone},
  {id: 'eu10', icon: 'castle', name: 'Tour d’Europe', desc: '10 pays d’Europe', goal: 10, val: () => n().filter(c => c.k === 'Europe').length},
  {id: 'hemi', icon: 'hemi', name: 'Deux hémisphères', desc: 'Nord et Sud de l’équateur', goal: 2, val: () => { const l = n(); return (l.some(c => c.ll[0] > 0) ? 1 : 0) + (l.some(c => c.ll[0] < 0) ? 1 : 0); }},
  {id: 'far', icon: 'pin', name: 'Aux antipodes', desc: 'Un pays à plus de 12 000 km de chez vous', goal: 1, val: () => n().some(c => distanceKm(home().ll, c.ll) > 12000) ? 1 : 0},
  {id: 'isl', icon: 'island', name: 'Insulaire', desc: '5 pays insulaires', goal: 5, val: () => n().filter(c => c.is).length},
  {id: 'land', icon: 'mountain', name: 'Cœur des terres', desc: '5 pays sans accès à la mer', goal: 5, val: () => n().filter(c => c.ll2).length},
  {id: 'micro', icon: 'gem', name: 'Micro-États', desc: '3 parmi Vatican, Monaco, Saint-Marin, Liechtenstein, Andorre, Malte', goal: 3, val: () => MICRO.filter(been).length},
  {id: 'lived', icon: 'home', name: 'Expatrié', desc: 'Avoir vécu dans un pays', goal: 1, val: () => COUNTRIES.filter(c => statusOf(c.c) === 'l').length},
  {id: 'dream', icon: 'heart', name: 'Rêveur', desc: '10 pays en envie', goal: 10, val: () => COUNTRIES.filter(c => statusOf(c.c) === 'w').length},
  {id: 'area', icon: 'quarter', name: 'Un quart de la Terre', desc: '25 % des terres émergées', goal: 25, val: () => Math.floor(stats().area)},
];

export function evaluate() {
  return BADGES.map(b => { const v = b.val(); return {...b, v: Math.min(v, b.goal), done: v >= b.goal}; });
}

/** returns newly unlocked badges and marks them */
export function checkNew() {
  const got = new Set(state.badges || []);
  const res = evaluate();
  const fresh = res.filter(b => b.done && !got.has(b.id));
  state.badges = res.filter(b => b.done).map(b => b.id);
  return fresh;
}

export const MILESTONES = [1, 5, 10, 25, 50, 75, 100, 150, 197];
export function contDone() { const s = stats(); return CONTINENTS.filter(k => s.cont[k] === CONT_TOTAL[k]); }
