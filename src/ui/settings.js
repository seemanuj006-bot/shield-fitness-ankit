/** Settings: units, bars, phase rules, display, backup/restore, persistence, install help. */
import * as db from '../db.js';
import { store, setSetting, loadStore, saveState } from '../store.js';
import { setPaused } from '../session.js';
import { DEFAULT_PHASE_RULES } from '../scheduler.js';
import { go, refresh } from '../router.js';
import { esc, fmtW, parseW, wUnit, fmtDate } from '../util.js';
import { icon, chip, pageHeader, sheet, confirmDialog, toast, segmented, field } from './components.js';

const tgl = (k, label, hint = '') => `<label class="check"><input type="checkbox" data-chg="tgl" data-k="${k}" ${store.settings[k] ? 'checked' : ''}><span>${label}${hint ? `<span class="muted small"> ${hint}</span>` : ''}</span></label>`;
let persisted = null;

export async function render() {
  document.body.dataset.route = 'settings';
  persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const s = store.settings, r = s.phaseRules || DEFAULT_PHASE_RULES;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const html = `${pageHeader('Settings')}<div class="page">
    <section class="card stack"><h2>Training</h2>
      <div class="stack-s"><span class="lbl">Units</span>${segmented('units', [['kg', 'Kilograms'], ['lb', 'Pounds']], s.units)}</div>
      <div class="grid2">${field(`Smith bar weight (${wUnit()})`, `<input inputmode="decimal" data-chg="num" data-k="smithBarKg" value="${esc(fmtW(s.smithBarKg))}">`, 'Verify at your gym: often 7-20 kg.')}
      ${field(`Barbell bar (${wUnit()})`, `<input inputmode="decimal" data-chg="num" data-k="barbellBarKg" value="${esc(fmtW(s.barbellBarKg))}">`)}</div>
      ${field('Default rest for new exercises (s)', `<input inputmode="numeric" data-chg="int" data-k="defaultRestSec" value="${s.defaultRestSec || 60}">`)}
      ${field('Cable pulley ratio for crunches', `<select data-chg="ratio"><option ${s.pulleyRatio === '1:1' ? 'selected' : ''}>1:1</option><option ${s.pulleyRatio === '2:1' ? 'selected' : ''}>2:1</option></select>`, 'Stored as a note on the crunch exercises. A 2:1 stack means the real load is half the number shown.')}
      ${field('Program week override', `<input inputmode="numeric" data-chg="week" placeholder="Auto (${Math.floor((store.state.completedSessions || 0) / Math.max(1, store.days.length)) + 1})" value="${s.programWeekOverride || ''}">`, 'Week = completed sessions ÷ cycle length, plus 1. Leave empty for automatic.')}
      <label class="check"><input type="checkbox" data-chg="pause" ${store.state.pausedSince ? 'checked' : ''}><span>Pause schedule${store.state.pausedSince ? ` (since ${esc(fmtDate(store.state.pausedSince))})` : ''}<span class="muted small"> illness or travel</span></span></label></section>
    <section class="card stack"><h2>Phase rules</h2><p class="muted small">Phases follow completed training weeks, not the calendar. A long break never advances the phase.</p>
      ${['A', 'B', 'C'].map((k) => `<div class="stack-s"><b>Phase ${k}</b><div class="grid3">${field('From week', `<input inputmode="numeric" data-chg="rule" data-p="${k}" data-f="fromWeek" value="${r[k].fromWeek}" ${k === 'A' ? 'disabled' : ''}>`)}
        ${field('Sets cap', `<input inputmode="numeric" data-chg="rule" data-p="${k}" data-f="sets" placeholder="full" value="${r[k].sets ?? ''}">`)}${field('Weight %', `<input inputmode="numeric" data-chg="rule" data-p="${k}" data-f="weightPct" value="${r[k].weightPct}">`)}</div></div>`).join('')}
      <button class="btn ghost" data-act="rules-reset">Reset phase rules</button></section>
    <section class="card stack"><h2>Display and feel</h2>
      <div class="stack-s"><span class="lbl">Theme</span>${segmented('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}</div>
      ${tgl('batterySaver', 'Battery saver', 'solid surfaces, no blur or transitions')}${tgl('sound', 'Timer sound')}${tgl('vibrate', 'Vibration and haptics')}${tgl('wakeLock', 'Keep screen on during workouts')}</section>
    <section class="card stack"><h2>Backup and restore</h2>
      <p class="muted small">Your data lives only on this device. ${s.lastBackupAt ? `Last backup: ${esc(new Date(s.lastBackupAt).toLocaleString())}.` : 'No backup yet.'}</p>
      <button class="btn primary block" data-act="export">${icon('download', 'sm')}Export backup (JSON)</button>
      <label class="btn secondary block" for="imp">Import a backup</label><input type="file" id="imp" accept="application/json,.json" class="hidden" data-chg="import">
      <button class="btn danger block" data-act="wipe">Delete all data</button></section>
    <section class="card stack"><h2>Storage and install</h2>
      <div class="row wrap">${persisted === null ? chip('Persistence unknown') : persisted ? chip('Storage is persistent', 'ok') : chip('Storage may be cleared', 'warn')}${est?.usage != null ? chip(`${(est.usage / 1048576).toFixed(1)} MB used`) : ''}${standalone ? chip('Installed', 'ok') : ''}</div>
      ${persisted === false ? '<button class="btn secondary" data-act="persist">Ask the browser to keep my data</button>' : ''}
      <p class="muted small">iPhone/iPad Safari can clear data for sites you have not opened in a while unless the app is installed to your Home Screen. Install it and export a backup now and then.</p>
      ${window.__installPrompt ? '<button class="btn primary block" data-act="install">Install app</button>' : ''}
      ${ios && !standalone ? '<p class="small"><b>iPhone:</b> tap Share, then Add to Home Screen.</p>' : !window.__installPrompt && !standalone ? '<p class="small"><b>Android Chrome:</b> menu, then Install app (or Add to Home screen).</p>' : ''}</section>
    <section class="card stack"><h2>About</h2><p class="small muted">Shield Fitness works offline and keeps everything on your device. No accounts, no tracking.</p>
      <p class="small muted"><b>Safety:</b> sharp or joint pain means stop that exercise. Severe pain, major swelling, or dark brown urine after training means see a doctor. Persistent hair or hairline thinning is worth a dermatologist visit. This app is a logbook, not medical advice.</p></section></div>`;
  return { html, nav: true, act, chg };
}

const act = {
  units: async (el) => { await setSetting('units', el.dataset.v); refresh(); },
  theme: async (el) => { await setSetting('theme', el.dataset.v); refresh(); },
  'rules-reset': async () => { await setSetting('phaseRules', DEFAULT_PHASE_RULES); refresh(); },
  persist: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Done. Your data is protected.' : 'The browser said no. Installing the app usually helps.'); refresh(); },
  install: async () => { const p = window.__installPrompt; window.__installPrompt = null; await p.prompt(); refresh(); },
  export: async () => {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `shield-fitness-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await setSetting('lastBackupAt', Date.now()); toast('Backup downloaded.'); refresh();
    } catch (e) { toast(db.humanError(e)); }
  },
  wipe: async () => {
    if (!(await confirmDialog({ title: 'Delete all data?', message: 'This removes every workout, set, photo and setting from this device.', okLabel: 'Continue', danger: true }))) return;
    if (!(await confirmDialog({ title: 'Really delete everything?', message: 'This cannot be undone. Export a backup first if you might want it back.', okLabel: 'Delete everything', danger: true }))) return;
    await db.wipeAll(); location.hash = '#/today'; location.reload();
  },
};

const chg = {
  tgl: async (el) => { await setSetting(el.dataset.k, el.checked); if (el.dataset.k === 'batterySaver') refresh({ keepScroll: true }); },
  num: async (el) => { const v = parseW(el.value); if (v === null) return refresh({ keepScroll: true }); await setSetting(el.dataset.k, v); },
  int: async (el) => { const v = parseInt(el.value, 10); if (v > 0) await setSetting(el.dataset.k, v); else refresh({ keepScroll: true }); },
  week: async (el) => { const v = parseInt(el.value, 10); await setSetting('programWeekOverride', v > 0 ? v : null); },
  ratio: async (el) => { await setSetting('pulleyRatio', el.value); for (const id of ['ex-crunch-light', 'ex-crunch-heavy', 'ex-crunch-burnout']) if (store.exercises[id]) await db.put('exercises', (store.exercises[id] = { ...store.exercises[id], pulleyRatio: el.value })); },
  pause: async (el) => { await setPaused(el.checked); refresh({ keepScroll: true }); },
  rule: async (el) => {
    const r = structuredClone(store.settings.phaseRules || DEFAULT_PHASE_RULES), p = el.dataset.p, f = el.dataset.f, raw = el.value.trim();
    if (f === 'sets' && raw === '') r[p].sets = null; else { const v = parseInt(raw, 10); if (!(v > 0)) return refresh({ keepScroll: true }); r[p][f] = v; }
    if (r.B.fromWeek <= 1 || r.C.fromWeek <= r.B.fromWeek) { toast('Phase start weeks must increase: A, then B, then C.'); return refresh({ keepScroll: true }); }
    await setSetting('phaseRules', r);
  },
  import: async (el) => {
    const f = el.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text()), rows = await db.previewImport(json);
      sheet(`<h2>Import preview</h2><p class="muted small">Backup from ${esc(new Date(json.exportedAt || 0).toLocaleString())}</p>
        <div class="list">${rows.map((x) => `<div class="li"><div class="grow">${esc(x.store)}</div><span class="small muted">${x.total} total · ${x.fresh} new</span></div>`).join('') || '<p class="muted">The file is empty.</p>'}</div>
        <button class="btn primary block" data-sh="merge">Merge (add only what is new)</button>
        <button class="btn danger block" data-sh="replace">Replace everything on this device</button><button class="btn secondary block" data-sh="__close">Cancel</button>`, {
        merge: async (_t, _e, c) => { c(); await doImport(json, 'merge'); }, replace: async (_t, _e, c) => { c(); if (await confirmDialog({ title: 'Replace all data?', message: 'Everything currently on this device is overwritten by the backup.', okLabel: 'Replace', danger: true })) await doImport(json, 'replace'); } });
    } catch (e) { toast(e.message.includes('JSON') ? 'That file is not valid JSON.' : e.message); }
    el.value = '';
  },
};
async function doImport(json, mode) {
  try { await db.importBackup(json, mode); await loadStore(); toast(mode === 'merge' ? 'Merged.' : 'Backup restored.'); go('today'); refresh(); } catch (e) { toast(db.humanError(e)); }
}
