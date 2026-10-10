/** In-memory cache of the editable program + settings, backed by IndexedDB. */
import * as db from './db.js';
import { SEED_EXERCISES, SEED_DAYS, SEED_WARMUPS, DEFAULT_SETTINGS } from './seed.js';
import { DEFAULT_PHASE_RULES, normalizeQueue } from './scheduler.js';
import { units } from './util.js';

export const store = { settings: { ...DEFAULT_SETTINGS, phaseRules: DEFAULT_PHASE_RULES }, exercises: {}, days: [], warmups: {}, cooldowns: {}, state: { key: 'state', queue: [], pauseRanges: [], pausedSince: null } };

export async function seedProgram() {
  await db.tx(['exercises', 'days', 'warmups'], 'readwrite', async (o) => {
    for (const s of ['exercises', 'days', 'warmups']) await new Promise((r, j) => { const q = o(s).clear(); q.onsuccess = r; q.onerror = j; });
    for (const e of SEED_EXERCISES) o('exercises').put({ ...e, createdAt: Date.now() });
    for (const d of SEED_DAYS) o('days').put(d);
    for (const w of SEED_WARMUPS) o('warmups').put(w);
  });
}

export async function loadStore() {
  let [settings, exs] = await Promise.all([db.getAll('settings'), db.getAll('exercises')]);
  if (!exs.length) { await seedProgram(); exs = await db.getAll('exercises'); }
  const [days, wus, st] = await Promise.all([db.getAll('days'), db.getAll('warmups'), db.get('programState', 'state')]);
  store.settings = { ...DEFAULT_SETTINGS, phaseRules: DEFAULT_PHASE_RULES, ...Object.fromEntries(settings.map((s) => [s.key, s.value])) };
  store.exercises = Object.fromEntries(exs.map((e) => [e.id, e]));
  store.days = days.sort((a, b) => a.order - b.order);
  store.warmups = {}; store.cooldowns = {};
  for (const w of wus) (w.kind === 'cooldown' ? store.cooldowns : store.warmups)[w.dayId] = w;
  store.state = { key: 'state', queue: [], pauseRanges: [], pausedSince: null, gapOverrideDate: null, ...(st || {}) };
  const q = normalizeQueue(store.state.queue, store.days.map((d) => d.id));
  if (q.join() !== store.state.queue.join()) await saveState({ queue: q });
  units.unit = store.settings.units;
  applyUiSettings();
}

export async function setSetting(key, value) {
  store.settings[key] = value;
  await db.put('settings', { key, value });
  if (['units', 'theme', 'batterySaver'].includes(key)) { units.unit = store.settings.units; applyUiSettings(); }
}
export async function saveState(patch) {
  store.state = { ...store.state, ...patch, key: 'state' };
  await db.put('programState', store.state);
}
export async function saveExercise(e) { store.exercises[e.id] = e; await db.put('exercises', e); }
export async function saveDay(d) {
  const i = store.days.findIndex((x) => x.id === d.id);
  if (i >= 0) store.days[i] = d; else store.days.push(d);
  store.days.sort((a, b) => a.order - b.order);
  await db.put('days', d);
}
export async function removeDay(id) {
  store.days = store.days.filter((d) => d.id !== id);
  await db.tx(['days', 'warmups'], 'readwrite', (o) => {
    o('days').delete(id); o('warmups').delete(`wu-${id}`); o('warmups').delete(`cd-${id}`);
  });
  delete store.warmups[id]; delete store.cooldowns[id];
  await saveState({ queue: store.state.queue.filter((x) => x !== id) });
}
export async function saveWarmup(w) { (w.kind === 'cooldown' ? store.cooldowns : store.warmups)[w.dayId] = w; await db.put('warmups', w); }
/** Reset exercises, days and warm-ups to the defaults. Sessions, logs and metrics are never touched. */
export async function resetProgram() {
  await seedProgram();
  await saveState({ queue: SEED_DAYS.map((d) => d.id) });
  await loadStore();
}

export const trainingWeekdays = () => [...new Set(store.days.map((d) => d.defaultWeekday).filter((v) => v !== null && v !== undefined && v !== ''))].map(Number);

/** Reflect theme, battery saver and units on <html>. Saver is also forced by reduced-motion/reduced-data. */
export function applyUiSettings() {
  const root = document.documentElement;
  const s = store.settings;
  root.dataset.theme = s.theme;
  const forced = matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(prefers-reduced-data: reduce)').matches;
  root.dataset.saver = s.batterySaver || forced ? '1' : '0';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    meta.content = dark ? '#111C28' : '#E9EEF2';
  }
}
