/** App shell: boot, routing, event delegation, service worker updates, global error boundary. */
import * as db from './db.js';
import { loadStore, store } from './store.js';
import { hooks, parseHash, go } from './router.js';
import { localDateStr } from './scheduler.js';
import { icon, toast } from './ui/components.js';
import { esc } from './util.js';

const screens = {
  today: () => import('./ui/today.js'), plan: () => import('./ui/plan.js'), progress: () => import('./ui/progress.js'),
  settings: () => import('./ui/settings.js'), run: () => import('./ui/runner.js'), setup: () => import('./ui/setup.js'),
};
const main = document.getElementById('main');
let current = null, token = 0, shownDate = localDateStr(), lastKey = '';

async function renderRoute({ refresh = false, keepScroll = false } = {}) {
  const my = ++token;
  const { parts } = parseHash();
  const name = screens[parts[0]] ? parts[0] : 'today';
  if (!store.settings.setupDone && name !== 'setup') return go('setup', { replace: true });
  if (store.settings.setupDone && name === 'setup') return go('today', { replace: true });
  const y = window.scrollY;
  try {
    const view = await (await screens[name]()).render(parts[0] === name ? parts : [name]);
    if (my !== token) return;
    const key = parts.join('/');
    if (current && !refresh && key !== lastKey) current.unmount?.();
    current = view; lastKey = key;
    main.innerHTML = view.html;
    document.getElementById('nav').classList.toggle('hidden', view.nav === false);
    document.querySelectorAll('#nav a').forEach((a) => (a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    view.mount?.();
    shownDate = localDateStr();
    if (refresh && keepScroll) window.scrollTo(0, y); else if (!refresh) window.scrollTo(0, 0);
  } catch (e) { if (my === token) showError(e); }
}
hooks.refresh = (o = {}) => renderRoute({ refresh: true, keepScroll: !!o.keepScroll });
addEventListener('hashchange', () => renderRoute());

/* Event delegation: screens expose {act, chg, inp} maps keyed by data attributes. */
const run = async (fn, ...a) => { try { await fn?.(...a); } catch (e) { toast(db.humanError(e)); console.error(e); } };
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el && main.contains(el)) run(current?.act?.[el.dataset.act], el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-chg]'); if (el && main.contains(el)) run(current?.chg?.[el.dataset.chg], el, e); });
document.addEventListener('input', (e) => { const el = e.target.closest('[data-inp]'); if (el && main.contains(el)) run(current?.inp?.[el.dataset.inp], el, e); });
/* Keep the active input visible above the on-screen keyboard. */
document.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea, select')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'auto' }), 300); });

/* Midnight rollover: one timeout to the next local midnight, plus a check when the app returns to the foreground. */
function scheduleMidnight() {
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
  setTimeout(() => { rollover(); scheduleMidnight(); }, next - n);
}
function rollover() { if (localDateStr() !== shownDate && parseHash().parts[0] !== 'run') { shownDate = localDateStr(); renderRoute({ refresh: true }); } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });

/* ---------- Service worker + update prompt ---------- */
function updateBanner(reg) {
  const b = document.getElementById('banners');
  if (b.querySelector('[data-update]')) return;
  b.insertAdjacentHTML('beforeend', `<div class="banner info update" data-update role="status">${icon('download')}<div class="grow"><b>Update available</b><div class="small">Reload when you are between sets. Open workouts are safe.</div></div><button class="btn sm primary" id="do-update">Reload</button></div>`);
  document.getElementById('do-update').onclick = () => { navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); reg.waiting?.postMessage('SKIP_WAITING'); };
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) updateBanner(reg);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBanner(reg); }); });
  } catch (e) { console.warn('Service worker unavailable', e); }
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });

/* ---------- Error boundary ---------- */
function showError(err) {
  console.error(err);
  if (document.getElementById('crash')) return;
  const d = document.createElement('div'); d.id = 'crash'; d.className = 'sheet-wrap';
  d.innerHTML = `<div class="scrim"></div><div class="sheet" role="alertdialog"><h2>Something went wrong</h2><p class="muted">Your logged sets are safe. Download a backup, then reload.</p>
    <p class="small muted wrap-any">${esc(db.humanError(err))}</p><button class="btn primary block" id="crash-bk">Download backup</button><button class="btn secondary block" id="crash-rl">Reload</button></div>`;
  document.body.appendChild(d);
  document.getElementById('crash-rl').onclick = () => location.reload();
  document.getElementById('crash-bk').onclick = async () => {
    try { const blob = new Blob([JSON.stringify(await db.exportAll())], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'shield-fitness-emergency-backup.json'; a.click(); } catch (e) { alert(`Backup failed: ${e.message}`); }
  };
}
addEventListener('error', (e) => { if (!/ResizeObserver/.test(e.message || '')) showError(e.error || new Error(e.message)); });
addEventListener('unhandledrejection', (e) => showError(e.reason));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => import('./store.js').then((m) => m.applyUiSettings()));

/* ---------- Boot ---------- */
(async function boot() {
  try {
    await loadStore();
    if (!store.settings.setupDone) navigator.storage?.persist?.();
    registerSW(); scheduleMidnight();
    if (!location.hash) location.replace('#/today');
    await renderRoute();
  } catch (e) { showError(e); }
})();
