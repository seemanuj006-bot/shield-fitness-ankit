/** Workout runner: the full-screen page used in the gym. Every change is written to IndexedDB immediately. */
import * as db from '../db.js';
import { store } from '../store.js';
import { buildSteps } from '../planner.js';
import { logsFor, finishSession, discardSession, totalOf, exerciseHistory, volumeOf, workingDone, allSessions } from '../session.js';
import * as timer from '../timer.js';
import { go, refresh } from '../router.js';
import { esc, uid, fmtW, parseW, wUnit, equipLabel, fmtDur, watchUrl, fmtDate, debounce } from '../util.js';
import { icon, chip, sheet, confirmDialog, toast } from './components.js';

let R = null; // runner state for the open session
let ticker = null, unsub = null;

const stepLogs = (ex, type = 'working') => R.logs.filter((l) => l.exerciseId === ex && (type === 'warmup' ? l.type === 'warmup' : l.type !== 'warmup')).sort((a, b) => a.setIndex - b.setIndex);
const persistLog = (l) => db.put('setLogs', l).catch((e) => toast(`Could not save: ${e.message}`));
const persistSession = () => db.put('sessions', R.session).catch((e) => toast(`Could not save: ${e.message}`));
const persistLater = debounce((l) => persistLog(l), 350);

async function load(id) {
  if (R?.session.id === id) return;
  const sessions = await allSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) { R = null; return; }
  const logs = await logsFor(id);
  const steps = buildSteps(session.templateSnapshot);
  R = { session, logs, steps, idx: Math.min(session.stepIndex || 0, steps.length - 1), openSet: null, finishing: false, finished: null, review: session.status === 'completed', hist: {}, form: { energy: session.energy, soreness: session.soreness } };
}

export async function render(parts) {
  document.body.dataset.route = 'run';
  await load(parts[1]);
  if (!R) return { html: `<div class="page"><div class="card">That workout was not found. <a href="#/today">Back to Today</a></div></div>`, nav: false };
  if (!R.review) timer.acquireWake();
  const step = R.steps[R.idx];
  if (step?.type === 'exercise' && !R.hist[step.item.exerciseId]) {
    R.hist[step.item.exerciseId] = 'loading';
    exerciseHistory(step.item.exerciseId).then((h) => { R.hist[step.item.exerciseId] = h.filter((x) => x.session.id !== R.session.id).flatMap((x) => x.sets); refresh({ keepScroll: true }); });
  }
  return { html: R.finished ? doneView() : R.finishing ? finishView() : view(), mount, unmount, act, chg, inp, nav: false };
}

function mount() {
  clearInterval(ticker); unsub?.();
  unsub = timer.subscribe(paintDock);
  const tick = () => { if (document.hidden) return; paintClock(); paintDock(); };
  ticker = setInterval(tick, 1000); tick();
}
function unmount() { clearInterval(ticker); unsub?.(); ticker = unsub = null; timer.releaseWake(); R = null; }

/* ---------- Clock / dock (text updates only, no re-render) ---------- */
function paintClock() {
  const el = document.getElementById('sess-timer');
  if (!el || !R || R.review) return;
  const sec = (Date.now() - R.session.startedAt) / 1000;
  el.textContent = fmtDur(sec);
  const est = (R.session.templateSnapshot.estMinutes || 60) * 60;
  const c = document.getElementById('sess-pace');
  if (c) { const over = sec > est; c.textContent = over ? 'Running long' : 'On track'; c.className = `chip ${over ? 'warn' : 'ok'}`; }
}
function paintDock() {
  const el = document.getElementById('dock'); if (!el) return;
  const s = timer.snapshot();
  if (!s.running && !s.done) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.querySelector('[data-t]').textContent = s.done ? 'Time is up' : fmtDur(s.remaining);
  el.querySelector('[data-l]').textContent = s.label;
  el.querySelector('[data-bar]').style.transform = `scaleX(${s.done ? 0 : Math.max(0, s.remaining / Math.max(1, s.total))})`;
  el.classList.toggle('over', s.done);
  el.querySelector('[data-adj]').classList.toggle('hidden', s.done);
}
const dockHtml = () => `<div id="dock" class="dock hidden" role="timer" aria-live="off">
  <div class="dock-bar"><i data-bar></i></div>
  <div class="row"><div class="grow"><div class="small muted" data-l></div><div class="dock-t" data-t aria-live="polite"></div></div>
  <div class="row" data-adj><button class="btn sm secondary" data-act="rest-adj" data-d="-15" aria-label="Minus 15 seconds">-15s</button>
  <button class="btn sm secondary" data-act="rest-adj" data-d="15" aria-label="Plus 15 seconds">+15s</button></div>
  <button class="btn sm primary" data-act="rest-skip">${R.finishing ? 'Close' : 'Skip'}</button></div></div>`;

/* ---------- Views ---------- */
const stepProgress = (s) => {
  if (s.type === 'exercise') { const r = stepLogs(s.item.exerciseId); return r.length && r.every((x) => x.done || x.skipped) ? 'done' : r.some((x) => x.done) ? 'part' : ''; }
  if (s.type === 'rampup') { const r = stepLogs(R.session.templateSnapshot.rampup.exerciseId, 'warmup'); return r.length && r.every((x) => x.done || x.skipped) ? 'done' : ''; }
  if (s.type === 'cardio') return stepLogs(s.item.exerciseId)[0]?.done ? 'done' : '';
  const keys = Object.keys(R.session.checks || {}).filter((k) => k.startsWith(s.type + ':') && R.session.checks[k]);
  const total = (R.session.templateSnapshot[s.type]?.blocks || []).reduce((t, b) => t + b.steps.length, 0);
  return keys.length >= total && total ? 'done' : keys.length ? 'part' : '';
};

function chrome(inner) {
  const snap = R.session.templateSnapshot;
  const done = R.steps.filter((s) => stepProgress(s) === 'done').length;
  const pct = Math.round((done / Math.max(1, R.steps.length)) * 100);
  const last = R.idx === R.steps.length - 1;
  return `<div class="runner">
    <header class="runner-bar top"><div class="runner-in">
      <button class="iconbtn" data-act="rn-exit" aria-label="Exit workout">${icon('x')}</button>
      <div class="grow"><div class="strong ellipsis">${esc(snap.dayName)}</div>
        <div class="small muted ellipsis">${R.review ? esc(fmtDate(R.session.date)) + ' · editing' : `Step ${R.idx + 1} of ${R.steps.length} · Phase ${snap.phase}, week ${snap.week}`}</div></div>
      ${R.review ? '' : `<div class="clock"><div id="sess-timer" class="strong">0:00</div><span id="sess-pace" class="chip ok">On track</span></div>`}
      <button class="iconbtn" data-act="rn-list" aria-label="All exercises">${icon('list')}</button>
    </div><div class="prog" aria-hidden="true"><i style="width:${pct}%"></i></div></header>
    <div class="runner-main">${inner}</div>
    <div class="runner-bar bottom">${dockHtml()}<div class="runner-in">
      <button class="btn secondary" data-act="rn-prev" ${R.idx === 0 ? 'disabled' : ''}>${icon('chevron-left')}Back</button>
      <button class="btn primary grow" data-act="rn-next">${last ? (R.review ? 'Review and save' : 'Finish workout') : 'Next'}${last ? '' : icon('chevron-right')}</button>
    </div></div></div>`;
}

function view() {
  const s = R.steps[R.idx];
  if (!s) return chrome('<div class="card">This workout has no steps.</div>');
  const body = { warmup: blocksView, cooldown: blocksView, rampup: rampView, exercise: exerciseView, cardio: cardioView }[s.type](s);
  return chrome(body);
}

function blocksView(s) {
  const snap = R.session.templateSnapshot;
  const tpl = snap[s.type];
  const notes = s.type === 'warmup' ? [...snap.notes, ...(snap.backToBack.length ? [`Heads up: ${snap.backToBack.join(', ')} were trained yesterday. Go easy and listen to your body.`] : []), ...(R.session.gapAdjustment ? [`Welcome back after ${R.session.gapAdjustment.gapDays} days: loads are at ${R.session.gapAdjustment.pct}% today.`] : [])] : [];
  return `${notes.map((n) => `<div class="banner info">${icon('alert')}<div>${esc(n)}</div></div>`).join('')}
  <section class="card stack"><div><h2>${esc(s.title)}</h2><p class="muted small">${s.type === 'warmup' ? 'Block A and B here. Block C (ramp-up sets) is next.' : 'Easy stretches. Tap a timer for the timed ones.'}</p></div>
  ${tpl.blocks.map((b) => `<div class="stack-s"><h3>${esc(b.name)}</h3>${b.steps.map((st, i) => {
    const key = `${s.type}:${b.id}:${i}`, on = !!R.session.checks?.[key];
    return `<div class="mv ${on ? 'on' : ''}"><label class="check"><input type="checkbox" data-chg="check" data-key="${esc(key)}" ${on ? 'checked' : ''}>
      <span><span class="strong">${esc(st.name)}</span>${st.amount || st.seconds ? `<span class="muted small"> · ${esc(st.amount || st.seconds + ' s')}</span>` : ''}</span></label>
      <div class="row">${st.seconds ? `<button class="iconbtn fill" data-act="timer" data-sec="${st.seconds}" data-label="${esc(st.name)}" aria-label="Start ${st.seconds} second timer">${icon('timer')}</button>` : ''}
      <a class="iconbtn fill" href="${esc(watchUrl(st))}" target="_blank" rel="noopener" aria-label="Watch form: ${esc(st.name)}">${icon('video')}</a></div></div>`;
  }).join('')}</div>`).join('')}</section>`;
}

function setRows(rows, item, { ramp = false } = {}) {
  const eq = item.equipment || store.exercises[rows[0]?.exerciseId]?.equipment;
  const maxHist = Array.isArray(R.hist[rows[0]?.exerciseId]) ? Math.max(0, ...R.hist[rows[0].exerciseId].filter((h) => h.type !== 'warmup' && h.done).map((h) => h.weightKg || 0)) : null;
  return rows.map((l, i) => {
    const open = R.openSet === l.id;
    const tot = (eq === 'smith' || eq === 'barbell') ? `<div class="small muted" id="tot-${l.id}">Total ${esc(fmtW(totalOf(eq, l.weightKg || 0)))} ${wUnit()} incl. bar</div>` : '';
    const pr = !ramp && l.done && maxHist !== null && maxHist > 0 && (l.weightKg || 0) > maxHist && eq !== 'assisted' ? chip('PR', 'hot') : '';
    return `<div class="set ${l.done ? 'done' : ''} ${l.skipped ? 'skipped' : ''}">
      <div class="setrow">
        <button class="setnum ${open ? 'on' : ''}" data-act="more" data-id="${l.id}" aria-expanded="${open}" aria-label="Set ${i + 1}${l.type === 'warmup' && !ramp ? ' warm-up' : ''} options">${i + 1}${l.type === 'warmup' && !ramp ? '<small>W</small>' : ''}</button>
        <input aria-label="Set ${i + 1} weight in ${wUnit()}" inputmode="decimal" autocomplete="off" value="${esc(fmtW(l.weightKg))}" data-chg="w" data-inp="w" data-id="${l.id}" ${eq === 'cardio' ? 'disabled' : ''}>
        <input aria-label="Set ${i + 1} reps" inputmode="numeric" autocomplete="off" value="${l.reps ?? ''}" data-chg="r" data-inp="r" data-id="${l.id}">
        <button class="donebtn ${l.done ? 'on' : ''}" data-act="done" data-id="${l.id}" aria-pressed="${l.done}" aria-label="Set ${i + 1} ${l.done ? 'done, tap to undo' : 'mark done'}">${icon('check')}</button>
      </div>
      <div class="row between wrap setmeta">${tot}${l.skipped ? chip('Skipped') : ''}${l.rpe ? chip(`RPE ${l.rpe}`) : ''}${l.formPoor ? chip('Form flagged', 'warn') : ''}${pr}</div>
      ${open ? `<div class="extras stack-s">
        <div class="grid2"><label class="field"><span class="lbl">RPE (optional)</span><select data-chg="rpe" data-id="${l.id}"><option value="">Not set</option>${[6, 7, 8, 9, 10].map((v) => `<option ${l.rpe === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Note</span><input data-chg="note" data-id="${l.id}" value="${esc(l.note)}" maxlength="120"></label></div>
        <label class="check"><input type="checkbox" data-chg="form" data-id="${l.id}" ${l.formPoor ? 'checked' : ''}><span>Form was poor (hold the weight next time)</span></label>
        ${ramp ? '' : `<label class="check"><input type="checkbox" data-chg="warm" data-id="${l.id}" ${l.type === 'warmup' ? 'checked' : ''}><span>Mark as warm-up set</span></label>`}
        <div class="row wrap"><button class="btn sm secondary" data-act="skipset" data-id="${l.id}">${icon('skip', 'sm')}${l.skipped ? 'Unskip' : 'Skip set'}</button>
        <button class="btn sm secondary" data-act="delset" data-id="${l.id}">${icon('trash', 'sm')}Delete set</button></div></div>` : ''}
    </div>`;
  }).join('');
}

function rampView() {
  const r = R.session.templateSnapshot.rampup;
  const rows = stepLogs(r.exerciseId, 'warmup');
  return `<section class="card stack"><div><h2>${esc(s0().title)}</h2><p class="muted small">Light sets to groove the movement. Weights are 40% and 70% of today's working weight. Rest 45 s.</p></div>
  <div class="setcols small muted"><span></span><span>${esc(wUnit())}</span><span>Reps</span><span></span></div>
  ${setRows(rows, { equipment: store.exercises[r.exerciseId].equipment }, { ramp: true })}</section>`;
}
const s0 = () => R.steps[R.idx];

function exerciseView(s) {
  const it = s.item, ex = store.exercises[it.exerciseId] || it;
  const rows = stepLogs(it.exerciseId);
  const reps = it.repsPerSet ? it.repsPerSet.join(', ') : it.repMin === it.repMax ? it.repMax : `${it.repMin}-${it.repMax}`;
  const last = it.lastSets?.length ? `Last: ${[...new Set(it.lastSets.map((x) => fmtW(x.weightKg)))].join('/')} ${wUnit()} × ${it.lastSets.map((x) => x.reps).join(', ')}` : 'First time doing this one.';
  const eqText = { dumbbell: 'Dumbbells (per hand)', machine: 'Machine', cable: 'Cable', smith: 'Smith machine', barbell: 'Barbell', bodyweight: 'Bodyweight', assisted: 'Assisted' }[it.equipment] || it.equipment;
  const ratio = (it.equipment === 'cable' || it.equipment === 'machine') && (ex.pulleyRatio || it.pulleyRatio) ? `<span class="chip">Pulley ${esc(ex.pulleyRatio || it.pulleyRatio)}</span>` : '';
  return `<section class="card stack">
    <div><div class="row between"><h2 class="grow">${esc(it.name)}</h2>${it.optional ? chip('Optional') : ''}${it.downgraded ? chip('Lighter today', 'warn') : ''}</div>
    <div class="chips">${chip(eqText)}${ratio}${(it.muscles || []).map((m) => chip(m)).join('')}</div></div>
    <div class="kv"><div><span class="muted">Plan</span> <span class="strong">${it.sets} × ${esc(reps)}</span> · rest ${it.restSec} s</div>
    <div class="muted">${esc(last)}</div>
    <div class="suggest"><span class="strong">Today: ${esc(fmtW(it.targetWeightKg))} ${wUnit()}</span> <span class="muted">${esc(it.reason)}</span></div></div>
    ${it.cues ? `<p class="cues">${esc(it.cues)}</p>` : ''}
    ${(ex.pinnedNote || it.note) ? `<p class="pinned">${esc([ex.pinnedNote, it.note].filter(Boolean).join(' · '))}</p>` : ''}
    <div class="row wrap"><a class="btn sm secondary" href="${esc(watchUrl(ex))}" target="_blank" rel="noopener">${icon('video', 'sm')}Watch form</a>
    <button class="btn sm ghost" data-act="replace-link">${icon('link', 'sm')}Replace link</button>
    ${(it.equipment === 'smith' || it.equipment === 'barbell') ? `<button class="btn sm ghost" data-act="plates">Plates</button>` : ''}</div>
  </section>
  <section class="card stack"><div class="row between"><h3>Sets</h3><span class="small muted ellipsis">${esc(equipLabel(it.equipment))}</span></div>
    <div class="setcols small muted"><span></span><span>${esc(wUnit())}</span><span>Reps</span><span></span></div>
    ${setRows(rows, it)}
    <div class="row wrap"><button class="btn secondary grow" data-act="addset">${icon('plus', 'sm')}Add set</button>
    ${it.optional ? `<button class="btn secondary grow" data-act="skipall">${icon('skip', 'sm')}Skip exercise</button>` : ''}</div>
    <p class="small muted">Tap a set number for RPE, notes, skip or delete. Sharp or joint pain means stop this exercise.</p>
  </section>
  ${s.sec === 'crunch' && !R.review ? `<button class="btn secondary block" data-act="skipcrunch">Skip crunches today</button>` : ''}`;
}

function cardioView(s) {
  const l = stepLogs(s.item.exerciseId)[0];
  return `<section class="card stack"><div><h2>${esc(s.item.name)}</h2><p class="muted">${esc(s.item.note || '')}</p></div>
  <label class="field"><span class="lbl">Minutes (plan ${s.item.minMin}-${s.item.minMax})</span><input inputmode="numeric" value="${l?.reps ?? ''}" data-chg="r" data-inp="r" data-id="${l?.id}"></label>
  <div class="row wrap"><button class="btn secondary grow" data-act="timer" data-sec="${(l?.reps || s.item.minMin) * 60}" data-label="Cardio">${icon('timer', 'sm')}Start timer</button>
  <button class="btn ${l?.done ? 'secondary' : 'primary'} grow" data-act="done" data-id="${l?.id}">${icon('check', 'sm')}${l?.done ? 'Done, tap to undo' : 'Mark done'}</button></div></section>`;
}

function finishView() {
  const logs = R.logs, vol = volumeOf(logs), sets = workingDone(logs).length;
  const planned = logs.filter((l) => l.type !== 'warmup').length;
  const dur = R.session.endedAt ? (R.session.endedAt - R.session.startedAt) / 1000 : (Date.now() - R.session.startedAt) / 1000;
  const scale = (name, v) => `<div class="seg" role="radiogroup" aria-label="${name}">${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${v === n}" class="${v === n ? 'on' : ''}" data-act="rate" data-k="${name}" data-v="${n}">${n}</button>`).join('')}</div>`;
  return chrome(`<section class="card stack"><h2>${R.review ? 'Save changes' : 'Nice work. Wrap it up.'}</h2>
    <div class="stats"><div class="stat"><b>${sets}</b><span>sets done</span></div><div class="stat"><b>${esc(fmtW(vol))}</b><span>${wUnit()} volume</span></div><div class="stat"><b>${R.review ? '' : fmtDur(dur)}</b><span>${R.review ? 'edited' : 'duration'}</span></div></div>
    ${planned - sets > 0 ? `<div class="banner info">${icon('alert')}<div>${planned - sets} planned sets are not marked done. They will be left out of your stats.</div></div>` : ''}
    <div class="stack-s"><span class="lbl">Energy (1 low, 5 high)</span>${scale('energy', R.form.energy)}</div>
    <div class="stack-s"><span class="lbl">Soreness (1 none, 5 very sore)</span>${scale('soreness', R.form.soreness)}</div>
    <label class="field"><span class="lbl">Session note (optional)</span><textarea data-chg="snote" maxlength="500" placeholder="How did it feel?">${esc(R.session.note || '')}</textarea></label>
    <button class="btn primary big block" data-act="save-finish">${R.review ? 'Save changes' : 'Save workout'}</button></section>`);
}

function doneView() {
  const { prs, volume, session } = R.finished;
  const name = (id) => store.exercises[id]?.name || 'Exercise';
  return `<div class="page"><section class="card stack center"><img class="logo-big" src="assets/icons/logo-96.png" alt="" width="72" height="72">
    <h2>${R.review ? 'Changes saved' : 'Workout saved'}</h2>
    <div class="stats"><div class="stat"><b>${esc(fmtW(volume))}</b><span>${wUnit()} volume</span></div><div class="stat"><b>${prs.length}</b><span>PRs</span></div><div class="stat"><b>${fmtDur(((session.endedAt || Date.now()) - session.startedAt) / 1000)}</b><span>duration</span></div></div>
    ${prs.length ? `<div class="stack-s" style="text-align:left">${prs.map((p) => `<div class="row">${icon('trophy')}<div class="grow wrap-any"><span class="strong">${esc(name(p.exerciseId))}</span> <span class="muted">${p.type === 'weight' ? `weight PR ${esc(fmtW(p.value))} ${wUnit()}` : p.type === 'reps' ? `rep PR: ${p.value} reps at ${esc(fmtW(p.weightKg))} ${wUnit()}` : `volume PR ${esc(fmtW(p.value))} ${wUnit()}`}</span></div></div>`).join('')}</div>` : '<p class="muted">Consistency beats everything. See you next session.</p>'}
    <div class="stack-s"><button class="btn primary block" data-act="rn-home">Back to Today</button><button class="btn secondary block" data-act="share">${icon('share', 'sm')}Share summary</button></div></section></div>`;
}

/* ---------- Actions ---------- */
const byId = (id) => R.logs.find((l) => l.id === id);
const setStep = (i) => { R.idx = Math.max(0, Math.min(R.steps.length - 1, i)); R.session.stepIndex = R.idx; R.openSet = null; persistSession(); window.scrollTo(0, 0); refresh(); };
const rerender = () => refresh({ keepScroll: true });

const act = {
  'rn-prev': () => setStep(R.idx - 1),
  'rn-next': () => { if (R.idx >= R.steps.length - 1) { R.finishing = true; window.scrollTo(0, 0); refresh(); } else setStep(R.idx + 1); },
  'rn-list': () => {
    sheet(`<h2>Workout overview</h2><div class="list">${R.steps.map((s, i) => { const p = stepProgress(s);
      return `<button class="li" data-sh="jump" data-i="${i}"><div class="grow"><div>${esc(s.title)}</div><div class="small muted">${i === R.idx ? 'You are here' : s.type === 'exercise' ? `${s.item.sets} sets` : s.sub || ''}</div></div>${p === 'done' ? chip('Done', 'ok') : p === 'part' ? chip('Started') : ''}</button>`; }).join('')}</div>`,
    { jump: (t, _e, close) => { close(); R.finishing = false; setStep(+t.dataset.i); } });
  },
  'rn-exit': async () => {
    if (R.review) return go('progress/history');
    sheet(`<h2>Leave workout?</h2><p class="muted">Everything is saved. You can resume exactly where you left off.</p>
      <button class="btn primary block" data-sh="keep">Keep going</button><button class="btn secondary block" data-sh="save">Save and exit</button>
      <button class="btn danger block" data-sh="discard">Discard this workout</button>`, {
      keep: (_t, _e, c) => c(), save: (_t, _e, c) => { c(); go('today'); },
      discard: async (_t, _e, c) => { c(); if (await confirmDialog({ title: 'Discard workout?', message: 'All sets logged in this session will be deleted.', okLabel: 'Discard', danger: true })) { await discardSession(R.session.id); go('today'); } },
    });
  },
  'rn-home': () => go('today'),
  more: (el) => { R.openSet = R.openSet === el.dataset.id ? null : el.dataset.id; rerender(); },
  done: (el) => {
    const l = byId(el.dataset.id); if (!l) return;
    l.done = !l.done; if (l.done) l.skipped = false; l.ts = Date.now();
    if (l.done && (l.reps == null || Number.isNaN(l.reps))) l.reps = 0;
    persistLog(l);
    if (l.done) {
      timer.haptic(30);
      if (!R.review) {
        const s = R.steps[R.idx];
        const rest = s.type === 'rampup' ? 45 : s.type === 'exercise' ? s.item.restSec : 0;
        const lastEx = R.idx === R.steps.length - 1 || R.steps.slice(R.idx + 1).every((x) => x.type === 'cooldown');
        const allDone = stepLogs(l.exerciseId, l.type === 'warmup' ? 'warmup' : 'working').every((x) => x.done || x.skipped);
        if (rest && !(lastEx && allDone && s.type === 'exercise')) timer.start(rest, `Rest · ${s.type === 'rampup' ? 'ramp-up' : s.item.name}`);
      }
    }
    rerender();
  },
  addset: () => {
    const s = R.steps[R.idx], rows = stepLogs(s.item.exerciseId), last = rows[rows.length - 1];
    const l = { id: uid(), sessionId: R.session.id, exerciseId: s.item.exerciseId, setIndex: rows.length, type: 'working', weightKg: last?.weightKg ?? s.item.targetWeightKg, reps: last?.reps ?? s.item.repMax, rpe: null, done: false, skipped: false, note: '', ts: Date.now(), totalKg: totalOf(s.item.equipment, last?.weightKg ?? s.item.targetWeightKg) };
    R.logs.push(l); persistLog(l); rerender();
  },
  delset: async (el) => {
    const l = byId(el.dataset.id); R.logs = R.logs.filter((x) => x !== l); R.openSet = null;
    stepLogs(l.exerciseId, l.type === 'warmup' ? 'warmup' : 'working').forEach((x, i) => { if (x.setIndex !== i) { x.setIndex = i; persistLog(x); } });
    await db.del('setLogs', l.id); rerender();
  },
  skipset: (el) => { const l = byId(el.dataset.id); l.skipped = !l.skipped; if (l.skipped) l.done = false; persistLog(l); R.openSet = null; rerender(); },
  skipall: () => { stepLogs(R.steps[R.idx].item.exerciseId).forEach((l) => { l.skipped = true; l.done = false; persistLog(l); }); rerender(); },
  skipcrunch: async () => {
    const ids = R.steps.filter((s) => s.sec === 'crunch');
    for (const s of ids) for (const l of stepLogs(s.item.exerciseId)) { if (!l.done) { l.skipped = true; persistLog(l); } }
    toast('Crunches skipped for today.'); setStep(R.idx + 1);
  },
  timer: (el) => timer.start(+el.dataset.sec, el.dataset.label),
  'rest-adj': (el) => timer.adjust(+el.dataset.d),
  'rest-skip': () => timer.dismiss(),
  'replace-link': () => {
    const ex = store.exercises[R.steps[R.idx].item.exerciseId];
    sheet(`<h2>Form video link</h2><p class="muted small">Paste a YouTube Short or any video link. Leave empty to use the default YouTube search.</p>
      <label class="field"><span class="lbl">Video URL</span><input id="vurl" inputmode="url" placeholder="https://www.youtube.com/shorts/..." value="${esc(ex.videoUrl || '')}"></label>
      <button class="btn primary block" data-sh="save">Save link</button>${ex.videoUrl ? `<button class="btn secondary block" data-sh="clear">Use default search</button>` : ''}`, {
      save: async (_t, _e, c) => {
        const v = document.getElementById('vurl').value.trim();
        if (v && !/^https?:\/\//i.test(v)) return toast('The link must start with http:// or https://');
        const { saveExercise } = await import('../store.js'); await saveExercise({ ...ex, videoUrl: v || null }); c(); rerender();
      },
      clear: async (_t, _e, c) => { const { saveExercise } = await import('../store.js'); await saveExercise({ ...ex, videoUrl: null }); c(); rerender(); },
    });
  },
  plates: () => {
    const it = R.steps[R.idx].item, rows = stepLogs(it.exerciseId), added = rows.find((r) => !r.done)?.weightKg ?? rows[0]?.weightKg ?? 0;
    const per = added / 2; let rem = per; const out = [];
    for (const p of [25, 20, 15, 10, 5, 2.5, 1.25, 0.5]) while (rem + 1e-6 >= p) { out.push(p); rem -= p; }
    sheet(`<h2>Plate calculator</h2><p>Added load <b>${esc(fmtW(added))} ${wUnit()}</b> (${esc(fmtW(per))} per side)</p>
      <p class="strong">${out.length ? out.join(' + ') + ' kg each side' : 'No plates'}</p>${rem > 0.05 ? `<p class="muted small">${rem.toFixed(2)} kg per side cannot be made with standard plates.</p>` : ''}
      <p class="muted small">Total on the bar: ${esc(fmtW(totalOf(it.equipment, added)))} ${wUnit()} including the ${store.settings[it.equipment === 'smith' ? 'smithBarKg' : 'barbellBarKg']} kg bar.</p>
      <button class="btn primary block" data-sh="__close">Close</button>`);
  },
  rate: (el) => { R.form[el.dataset.k] = +el.dataset.v; rerender(); },
  'save-finish': async (el) => {
    el.disabled = true;
    try {
      R.finished = await finishSession(R.session.id, { note: R.session.note || '', energy: R.form.energy, soreness: R.form.soreness });
      R.finishing = false; timer.dismiss(); timer.releaseWake(); window.scrollTo(0, 0); refresh();
    } catch (e) { el.disabled = false; toast(`Could not save: ${e.message}`); }
  },
  share: async () => {
    const f = R.finished, snap = R.session.templateSnapshot, lines = [`${snap.dayName} · ${fmtDate(R.session.date)}`, `Volume: ${fmtW(f.volume)} ${wUnit()}`];
    for (const exId of [...new Set(R.logs.map((l) => l.exerciseId))]) {
      const sets = workingDone(R.logs.filter((l) => l.exerciseId === exId));
      if (sets.length && store.exercises[exId]?.equipment !== 'cardio') lines.push(`${store.exercises[exId]?.name}: ${sets.map((s) => `${fmtW(s.weightKg)}×${s.reps}`).join(', ')}`);
    }
    const text = lines.join('\n');
    try { if (navigator.share) await navigator.share({ title: 'Shield Fitness', text }); else { await navigator.clipboard.writeText(text); toast('Summary copied.'); } } catch { /* cancelled */ }
  },
};

const chg = {
  w: (el) => { const l = byId(el.dataset.id), v = parseW(el.value); if (v === null) { el.value = fmtW(l.weightKg); return; } l.weightKg = v; l.totalKg = totalOf(store.exercises[l.exerciseId]?.equipment, v); persistLog(l); paintTotal(l); },
  r: (el) => { const l = byId(el.dataset.id), v = parseInt(el.value, 10); if (!Number.isFinite(v) || v < 0) { el.value = l.reps ?? ''; return; } l.reps = v; persistLog(l); },
  rpe: (el) => { const l = byId(el.dataset.id); l.rpe = el.value ? +el.value : null; persistLog(l); },
  note: (el) => { const l = byId(el.dataset.id); l.note = el.value.trim(); persistLog(l); },
  form: (el) => { const l = byId(el.dataset.id); l.formPoor = el.checked; persistLog(l); rerender(); },
  warm: (el) => { const l = byId(el.dataset.id); l.type = el.checked ? 'warmup' : 'working'; persistLog(l); rerender(); },
  snote: (el) => { R.session.note = el.value; persistSession(); },
  check: (el) => { R.session.checks = { ...R.session.checks, [el.dataset.key]: el.checked }; persistSession(); el.closest('.mv').classList.toggle('on', el.checked); },
};
/** Typing is mirrored to memory and written after a short pause, so a killed browser loses at most a moment of typing. */
const inp = {
  w: (el) => { const l = byId(el.dataset.id), v = parseW(el.value); if (v === null) return; l.weightKg = v; l.totalKg = totalOf(store.exercises[l.exerciseId]?.equipment, v); paintTotal(l); persistLater(l); },
  r: (el) => { const l = byId(el.dataset.id), v = parseInt(el.value, 10); if (Number.isFinite(v)) { l.reps = v; persistLater(l); } },
};
function paintTotal(l) {
  const t = document.getElementById(`tot-${l.id}`);
  if (t) t.textContent = `Total ${fmtW(l.totalKg)} ${wUnit()} incl. bar`;
}
