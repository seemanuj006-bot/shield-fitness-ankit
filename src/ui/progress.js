/** Progress tab: exercise charts and PRs, body metrics, photos, calendar, history, core tests. */
import * as db from '../db.js';
import { store } from '../store.js';
import { allSessions, exerciseHistory, volumeOf, logsFor, deleteSession } from '../session.js';
import { epley, detectPRs } from '../progression.js';
import { detectMissed, localDateStr, addDays, weekdayOf, streak, weekStart } from '../scheduler.js';
import { trainingWeekdays } from '../store.js';
import { go, refresh } from '../router.js';
import { esc, uid, fmtW, parseW, wUnit, fmtDate, fmtDur, dateObj } from '../util.js';
import { icon, chip, pageHeader, sheet, confirmDialog, toast, segmented, field, emptyState } from './components.js';

let tab = 'exercises', calMonth = null;
const TABS = [['exercises', 'Lifts'], ['body', 'Body'], ['calendar', 'Calendar'], ['history', 'History'], ['core', 'Core']];

export async function render(parts) {
  document.body.dataset.route = 'progress';
  if (parts[1] === 'ex') return exDetail(parts[2]);
  if (parts[1] === 'history') tab = 'history';
  const body = await { exercises: exTab, body: bodyTab, calendar: calTab, history: histTab, core: coreTab }[tab]();
  const html = `${pageHeader('Progress')}<div class="page">${segmented('tab', TABS, tab)}${body.html}</div>`;
  return { html, nav: true, act: { tab: (el) => { tab = el.dataset.v; refresh(); }, ...body.act }, chg: body.chg };
}

/* ---------- Charts: hand-rolled SVG, drawn once, no animation ---------- */
export function lineChart(pts, { fmt = (v) => v } = {}) {
  if (!pts.length) return '<p class="muted small">Not enough data yet. Log a few sessions.</p>';
  const W = 320, H = 150, L = 38, R = 10, T = 12, B = 24;
  const ys = pts.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo || Math.max(1, hi * 0.1)) * 0.15;
  const y0 = lo - pad, y1 = hi + pad;
  const X = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart from ${esc(pts[0].label)} to ${esc(pts[pts.length - 1].label)}, latest ${esc(String(fmt(pts[pts.length - 1].y)))}">
    <line class="ch-grid" x1="${L}" x2="${W - R}" y1="${Y(hi)}" y2="${Y(hi)}"/><line class="ch-grid" x1="${L}" x2="${W - R}" y1="${Y(lo)}" y2="${Y(lo)}"/>
    <text class="ch-t" x="${L - 4}" y="${Y(hi) + 4}" text-anchor="end">${esc(String(fmt(hi)))}</text><text class="ch-t" x="${L - 4}" y="${Y(lo) + 4}" text-anchor="end">${esc(String(fmt(lo)))}</text>
    <text class="ch-t" x="${L}" y="${H - 6}">${esc(pts[0].label)}</text><text class="ch-t" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(pts[pts.length - 1].label)}</text>
    ${pts.length > 1 ? `<path class="ch-line" d="${path}"/>` : ''}${pts.map((p, i) => `<circle class="ch-dot" cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5"/>`).join('')}</svg>`;
}
const short = (d) => fmtDate(d, { day: 'numeric', month: 'short' });

/* ---------- Lifts ---------- */
async function exTab() {
  const ids = new Set((await db.getAll('setLogs')).filter((l) => l.done && l.type !== 'warmup').map((l) => l.exerciseId));
  const list = [...ids].map((id) => store.exercises[id]).filter((e) => e && e.equipment !== 'cardio').sort((a, b) => a.name.localeCompare(b.name));
  return { html: list.length ? `<section class="card"><div class="list">${list.map((e) => `<a class="li" href="#/progress/ex/${e.id}"><div class="grow"><div>${esc(e.name)}</div><div class="small muted">${esc(e.equipment)}</div></div>${icon('chevron-right')}</a>`).join('')}</div></section>`
    : emptyState('No lifts logged yet', 'Finish a workout and your charts show up here.') };
}
async function exDetail(id) {
  const e = store.exercises[id];
  const hist = e ? (await exerciseHistory(id)).reverse() : [];
  const top = hist.map((h) => { const w = h.sets.filter((s) => s.type !== 'warmup' && s.done && s.reps > 0); return w.length ? { date: h.session.date, w, best: w.reduce((a, s) => (s.weightKg > a.weightKg || (s.weightKg === a.weightKg && s.reps > a.reps) ? s : a)), id: h.session.id } : null; }).filter(Boolean);
  const assisted = e?.equipment === 'assisted';
  const prs = []; for (let i = 1; i < top.length; i++) { const p = detectPRs(top[i].w, top.slice(0, i).flatMap((t) => t.w)); if (p.length) prs.push({ date: top[i].date, p }); }
  const html = `${pageHeader(e?.name || 'Exercise', { back: 'progress' })}<div class="page">
    <section class="card stack"><h2>${assisted ? 'Assistance' : 'Top weight'} (${wUnit()})</h2>${lineChart(top.map((t) => ({ y: +fmtW(t.best.weightKg), label: short(t.date) })))}
      ${assisted ? '<p class="small muted">Lower is better for assisted exercises.</p>' : ''}</section>
    ${assisted || e?.equipment === 'bodyweight' ? '' : `<section class="card stack"><h2>Estimated 1RM (${wUnit()})</h2>${lineChart(top.map((t) => ({ y: +fmtW(Math.max(...t.w.map((s) => epley(s.weightKg, s.reps)))), label: short(t.date) })), { fmt: (v) => Math.round(v * 10) / 10 })}<p class="small muted">Epley estimate from your best set each session.</p></section>`}
    <section class="card stack"><h2>Personal records</h2>${prs.length ? prs.reverse().map((x) => `<div class="row">${icon('trophy')}<div class="grow"><b>${esc(short(x.date))}</b> <span class="muted">${x.p.map((q) => q.type === 'weight' ? `weight ${esc(fmtW(q.value))}` : q.type === 'reps' ? `${q.value} reps at ${esc(fmtW(q.weightKg))}` : `volume ${esc(fmtW(q.value))}`).join(' · ')}</span></div></div>`).join('') : '<p class="muted">PRs show up when you beat your earlier sessions.</p>'}</section>
    <section class="card stack"><h2>Sessions</h2><div class="list">${[...top].reverse().map((t) => `<a class="li" href="#/run/${t.id}"><div class="grow"><div>${esc(fmtDate(t.date))}</div><div class="small muted">${t.w.map((s) => `${esc(fmtW(s.weightKg))}×${s.reps}`).join(', ')}</div></div>${icon('chevron-right')}</a>`).join('')}</div></section></div>`;
  return { html, nav: true };
}

/* ---------- Body ---------- */
const FIELDS = [['weightKg', 'Body weight', 'w'], ['waistCm', 'Waist (cm)'], ['chestCm', 'Chest (cm)'], ['shouldersCm', 'Shoulders (cm)'], ['armCm', 'Arm (cm)'], ['thighCm', 'Thigh (cm)'], ['neckCm', 'Neck (cm)']];
let photoUrls = [];
async function bodyTab() {
  photoUrls.forEach((u) => URL.revokeObjectURL(u)); photoUrls = [];
  const m = (await db.getAll('bodyMetrics')).sort((a, b) => a.date.localeCompare(b.date));
  const photos = (await db.getAll('photos')).sort((a, b) => b.date.localeCompare(a.date));
  const wpts = m.filter((x) => x.weightKg).map((x) => ({ y: +fmtW(x.weightKg), label: short(x.date) }));
  const html = `<section class="card stack"><h2>Body weight (${wUnit()})</h2>${lineChart(wpts)}</section>
  <section class="card stack"><h2>Log measurements</h2>${field('Date', `<input type="date" id="m-date" value="${localDateStr()}" max="${localDateStr()}">`)}
    <div class="grid2">${FIELDS.map(([k, l, t]) => field(t ? `${l} (${wUnit()})` : l, `<input inputmode="decimal" id="m-${k}" placeholder="optional">`)).join('')}</div>
    <button class="btn primary block" data-act="save-m">Save</button></section>
  <section class="card stack"><div class="row between"><h2>Progress photos</h2><label class="btn sm secondary" for="photo-in">${icon('camera', 'sm')}Add</label></div>
    <input type="file" id="photo-in" accept="image/*" class="hidden" data-chg="photo">
    ${photos.length ? `<div class="photos">${await Promise.all(photos.map(async (p) => { const u = URL.createObjectURL(p.blob); photoUrls.push(u); return `<button class="ph" data-act="photo" data-id="${p.id}"><img src="${u}" alt="Progress photo ${esc(p.date)}" loading="lazy"><span>${esc(short(p.date))}</span></button>`; })).then((a) => a.join(''))}</div>` : '<p class="muted small">Photos stay on this device, compressed to save space.</p>'}</section>
  <section class="card stack"><h2>Entries</h2><div class="list">${[...m].reverse().slice(0, 30).map((x) => `<div class="li"><div class="grow"><div>${esc(fmtDate(x.date))}</div><div class="small muted">${FIELDS.filter(([k]) => x[k]).map(([k, l]) => `${l.replace(' (cm)', '')} ${k === 'weightKg' ? esc(fmtW(x[k])) + ' ' + wUnit() : x[k]}`).join(' · ')}</div></div><button class="iconbtn" data-act="del-m" data-id="${x.id}" aria-label="Delete entry">${icon('trash')}</button></div>`).join('') || '<p class="muted">No entries yet.</p>'}</div></section>`;
  return { html, act: {
    'save-m': async () => {
      const rec = { id: uid(), date: document.getElementById('m-date').value || localDateStr() };
      for (const [k, , t] of FIELDS) { const raw = document.getElementById(`m-${k}`).value.trim(); if (!raw) continue; const v = t ? parseW(raw) : parseFloat(raw.replace(',', '.')); if (v === null || !Number.isFinite(v) || v <= 0) return toast('Check the numbers you entered.'); rec[k] = v; }
      if (Object.keys(rec).length <= 2) return toast('Enter at least one value.');
      await db.put('bodyMetrics', rec); toast('Saved.'); refresh();
    },
    'del-m': async (el) => { if (await confirmDialog({ title: 'Delete entry?', okLabel: 'Delete', danger: true })) { await db.del('bodyMetrics', el.dataset.id); refresh(); } },
    photo: async (el) => { const p = photos.find((x) => x.id === el.dataset.id), u = URL.createObjectURL(p.blob); photoUrls.push(u);
      sheet(`<img src="${u}" alt="Progress photo" style="width:100%;border-radius:12px"><p class="muted">${esc(fmtDate(p.date))}</p><button class="btn danger block" data-sh="del">Delete photo</button>`, { del: async (_t, _e, c) => { c(); await db.del('photos', p.id); refresh(); } }); },
  }, chg: { photo: async (el) => {
    const f = el.files[0]; if (!f) return;
    try { const blob = await compress(f); await db.put('photos', { id: uid(), date: localDateStr(), label: '', blob }); toast('Photo saved.'); refresh(); } catch (e) { toast(`Could not save photo: ${e.message}`); }
  } } };
}
/** Resize to max 1280 px and re-encode as JPEG ~0.8. */
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image conversion failed'))), 'image/jpeg', 0.8));
}

/* ---------- Calendar ---------- */
async function calTab() {
  const sessions = await allSessions(), today = localDateStr();
  calMonth = calMonth || today.slice(0, 7);
  const [y, mo] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`, lead = (weekdayOf(first) + 6) % 7, dim = new Date(y, mo, 0).getDate();
  const missed = new Set(detectMissed({ today, startDate: store.settings.startDate, sessions, trainingWeekdays: trainingWeekdays(), paused: !!store.state.pausedSince, pauseRanges: store.state.pauseRanges, maxLookbackDays: 400 }));
  const mark = (d) => { const ss = sessions.filter((s) => s.date === d); const st = (k) => ss.find((s) => s.status === k);
    if (st('completed')) return ['ok', '✓', 'Completed']; if (st('in_progress')) return ['hot', '•', 'In progress']; if (st('skipped')) return ['warn', '–', 'Skipped'];
    if (st('rest')) return ['rest', 'R', 'Rest']; if (st('moved')) return ['rest', '→', 'Moved']; if (missed.has(d)) return ['err', '!', 'Missed']; return ['', '', '']; };
  const cells = Array(lead).fill('<i></i>').concat(Array.from({ length: dim }, (_, i) => { const d = `${calMonth}-${String(i + 1).padStart(2, '0')}`; const [c, sym, lab] = mark(d);
    return `<div class="cal ${c} ${d === today ? 'today' : ''}" ${lab ? `aria-label="${esc(fmtDate(d))}: ${lab}"` : ''}><span>${i + 1}</span><b aria-hidden="true">${sym}</b></div>`; }));
  const mStart = first, mEnd = `${calMonth}-${String(dim).padStart(2, '0')}`;
  const doneM = sessions.filter((s) => s.status === 'completed' && s.date >= mStart && s.date <= mEnd).length;
  const wk = sessions.filter((s) => s.status === 'completed' && !s.adhoc && s.date >= weekStart(today) && s.date <= addDays(weekStart(today), 6)).length;
  const html = `<section class="card stack"><div class="row between"><button class="iconbtn fill" data-act="cal" data-d="-1" aria-label="Previous month">${icon('chevron-left')}</button><h2 style="margin:0">${esc(dateObj(first).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2><button class="iconbtn fill" data-act="cal" data-d="1" aria-label="Next month">${icon('chevron-right')}</button></div>
    <div class="calgrid" role="grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="calh">${d}</div>`).join('')}${cells.join('')}</div>
    <div class="chips"><span class="chip ok">✓ Done</span><span class="chip warn">– Skipped</span><span class="chip err">! Missed</span><span class="chip">R Rest</span></div></section>
    <div class="stats3"><div class="stat"><b>${doneM}</b><span>this month</span></div><div class="stat"><b>${wk}/${store.days.length}</b><span>this week</span></div><div class="stat"><b>${streak(sessions)}</b><span>streak</span></div></div>`;
  return { html, act: { cal: (el) => { const d = new Date(y, mo - 1 + +el.dataset.d, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; refresh(); } } };
}

/* ---------- History ---------- */
async function histTab() {
  const sessions = (await allSessions()).filter((s) => ['completed', 'skipped', 'in_progress'].includes(s.status)).sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0));
  const rows = await Promise.all(sessions.slice(0, 60).map(async (s) => { const vol = s.status === 'completed' ? volumeOf(await logsFor(s.id)) : 0;
    const name = s.templateSnapshot?.dayName || store.days.find((d) => d.id === s.dayId)?.name || 'Workout';
    return `<div class="li"><a class="grow li-a" href="${s.status === 'skipped' ? '#/progress/history' : `#/run/${s.id}`}"><div>${esc(name)} ${s.status === 'skipped' ? chip('Skipped', 'warn') : s.status === 'in_progress' ? chip('Unfinished', 'hot') : ''}${s.adhoc ? ' ' + chip('Extra') : ''}${s.prs?.length ? ' ' + chip(`${s.prs.length} PR`, 'hot') : ''}</div>
      <div class="small muted">${esc(fmtDate(s.date))}${s.status === 'completed' ? ` · ${esc(fmtW(vol))} ${wUnit()} · ${fmtDur(((s.endedAt || 0) - s.startedAt) / 1000)}` : ''}</div></a>
      <button class="iconbtn" data-act="del-s" data-id="${s.id}" aria-label="Delete session">${icon('trash')}</button></div>`; }));
  return { html: `<section class="card"><div class="list">${rows.join('') || emptyState('No sessions yet', 'Your finished workouts appear here. Tap one to fix a typo.')}</div></section>`,
    act: { 'del-s': async (el) => { if (await confirmDialog({ title: 'Delete this session?', message: 'Its sets are removed from your history and charts.', okLabel: 'Delete', danger: true })) { await deleteSession(el.dataset.id); refresh(); } } } };
}

/* ---------- Core tests ---------- */
const CORE = [['frontPlankSec', 'Front plank (s)', '60 decent / 90+ strong'], ['sidePlankLSec', 'Side plank left (s)', '45 / 60+ (sides within ~10%)'], ['sidePlankRSec', 'Side plank right (s)', '45 / 60+'], ['hollowSec', 'Hollow hold (s)', '30 / 45+'], ['hangingLegRaiseReps', 'Hanging leg raise (reps)', '10 knees-to-chest / 8+ straight-leg']];
async function coreTab() {
  const t = (await db.getAll('coreTests')).sort((a, b) => b.date.localeCompare(a.date));
  const last = t[0], due = !last || (Date.parse(localDateStr()) - Date.parse(last.date)) / 864e5 >= 28;
  const passes = last ? [last.frontPlankSec >= 60, Math.min(last.sidePlankLSec, last.sidePlankRSec) >= 45, last.hollowSec >= 30, last.hangingLegRaiseReps >= 10].filter(Boolean).length : 0;
  const html = `<section class="card stack"><h2>Core test</h2><p class="muted small">Retest every 4 weeks, fresh. Pass 3 of 4 and your core is ready for heavy lifting. If your back arches or sags, add planks and dead bugs.</p>
    ${due ? `<div class="banner info">${icon('alert')}<div>${last ? 'Time for your 4-week retest.' : 'Take your first core test when you are fresh.'}</div></div>` : ''}
    ${last ? `<div class="chips">${chip(`${passes} of 4 passed`, passes >= 3 ? 'ok' : 'warn')}${chip(fmtDate(last.date))}</div>` : ''}
    <div class="grid2">${CORE.map(([k, l, h]) => field(l, `<input inputmode="numeric" id="c-${k}" placeholder="${last ? last[k] : ''}">`, h)).join('')}</div>
    <button class="btn primary block" data-act="save-c">Save test</button></section>
    <section class="card stack"><h2>Past tests</h2>${t.map((x) => `<div class="row between"><b>${esc(fmtDate(x.date))}</b><span class="small muted">${x.frontPlankSec}s · ${x.sidePlankLSec}/${x.sidePlankRSec}s · ${x.hollowSec}s · ${x.hangingLegRaiseReps} reps</span></div>`).join('') || '<p class="muted">None yet.</p>'}</section>`;
  return { html, act: { 'save-c': async () => {
    const rec = { id: uid(), date: localDateStr() };
    for (const [k] of CORE) { const v = parseInt(document.getElementById(`c-${k}`).value, 10); if (!(v >= 0)) return toast('Fill in all five results (use 0 if you could not do one).'); rec[k] = v; }
    await db.put('coreTests', rec); toast('Saved.'); refresh();
  } } };
}
