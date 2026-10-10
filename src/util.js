/** Small shared helpers: DOM, formatting, unit conversion. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Active display unit. Everything is stored in kg; conversion happens only at the edges. */
export const units = { unit: 'kg' };
const LB = 2.20462;
export function fmtW(kg) {
  if (kg == null || kg === '' || Number.isNaN(kg)) return '';
  const v = units.unit === 'lb' ? Math.round(kg * LB * 10) / 10 : Math.round(kg * 100) / 100;
  return String(+v);
}
/** Parse user input in the display unit to kg (null if invalid). */
export function parseW(str) {
  const v = parseFloat(String(str).replace(',', '.'));
  if (!Number.isFinite(v) || v < 0) return null;
  return units.unit === 'lb' ? Math.round((v / LB) * 100) / 100 : v;
}
export const wUnit = () => units.unit;

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const dateObj = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const fmtDate = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => dateObj(s).toLocaleDateString(undefined, o);
export const fmtDay = (s) => dateObj(s).toLocaleDateString(undefined, { weekday: 'short' });
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function equipLabel(eq) {
  return { dumbbell: 'kg each hand', machine: 'stack kg', cable: 'stack kg', smith: 'plates added (kg)', barbell: 'plates added (kg)',
    bodyweight: 'added kg (optional)', assisted: 'assistance kg (less = harder)' }[eq]?.replace('kg', wUnit()) || wUnit();
}
export const EQUIPMENT = ['dumbbell', 'machine', 'cable', 'smith', 'barbell', 'bodyweight', 'assisted'];
export const watchUrl = (e) => e.videoUrl?.trim() || `https://www.youtube.com/results?search_query=${encodeURIComponent(e.searchQuery || `${e.name} proper form shorts`)}`;
