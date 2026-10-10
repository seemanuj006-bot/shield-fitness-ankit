/**
 * Rest / step timer. Remaining time is always computed from an end timestamp (Date.now()),
 * so it stays correct through backgrounding and screen lock. The 250 ms interval only runs
 * while a timer is active AND the page is visible; nothing polls otherwise.
 */
import { store } from './store.js';

const KEY = 'shield.timer'; // trivial UI flag: lets the countdown survive a page reload
const st = { endsAt: 0, total: 0, label: 'Rest', running: false, done: false };
const subs = new Set();
let iv = null, actx = null, wake = null;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage may be blocked */ } };
const emit = () => subs.forEach((f) => f(snapshot()));
export const snapshot = () => ({ ...st, remaining: st.running ? Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000)) : 0 });
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

export function beep() {
  if (!store.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    [0, 0.25, 0.5].forEach((d) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime + d;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
  } catch { /* audio unavailable */ }
}
export const haptic = (p = 25) => { if (store.settings.vibrate && navigator.vibrate) navigator.vibrate(p); };

function tick() {
  if (!st.running) return stop();
  if (Date.now() >= st.endsAt) {
    const late = Date.now() - st.endsAt;
    st.running = false; st.done = true; save(); stop();
    if (late < 5000) { haptic([220, 100, 220]); beep(); }
    return emit();
  }
  emit();
}
function run() { stop(); if (st.running && !document.hidden) iv = setInterval(tick, 250); }
function stop() { if (iv) clearInterval(iv); iv = null; }

export function start(sec, label = 'Rest') {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch { /* ok */ }
  Object.assign(st, { endsAt: Date.now() + sec * 1000, total: sec, label, running: true, done: false });
  save(); run(); emit();
}
export function adjust(d) {
  if (!st.running) return;
  st.endsAt += d * 1000; st.total = Math.max(1, st.total + d);
  save(); tick(); run();
}
export function dismiss() { Object.assign(st, { running: false, done: false }); save(); stop(); emit(); }

document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); run(); } else stop(); });

try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); if (st.running && st.endsAt < Date.now()) { st.running = false; st.done = false; } } catch { /* ignore */ }
if (st.running) run();

/* ---------- Screen Wake Lock (during workouts only) ---------- */
export async function acquireWake() {
  if (!store.settings.wakeLock || !('wakeLock' in navigator) || wake) return;
  try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch { wake = null; }
}
export function releaseWake() { try { wake?.release(); } catch { /* ok */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.dataset.route === 'run') acquireWake(); });
