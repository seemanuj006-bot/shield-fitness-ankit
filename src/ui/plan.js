/** Plan tab: day previews, day editor, exercise library, warm-up/cooldown templates. Edits save immediately. */
import * as db from '../db.js';
import { store, saveDay, saveExercise, removeDay, saveWarmup, resetProgram, saveState } from '../store.js';
import { SEED_WARMUPS } from '../seed.js';
import { go, refresh } from '../router.js';
import { esc, uid, fmtW, parseW, wUnit, WEEKDAYS, EQUIPMENT, watchUrl } from '../util.js';
import { icon, chip, pageHeader, sheet, confirmDialog, toast, field, segmented } from './components.js';

const SEC_LABEL = { warmup: 'Warm-up', lifts: 'Main lifts', crunch: 'Crunches', cardio: 'Cardio', cooldown: 'Cooldown' };
const dayOf = (id) => store.days.find((d) => d.id === id);
const exName = (id) => store.exercises[id]?.name || 'Removed exercise';
const wdName = (d) => (d.defaultWeekday === null || d.defaultWeekday === undefined || d.defaultWeekday === '' ? 'Any day' : WEEKDAYS[d.defaultWeekday]);
const repText = (i) => (i.repsPerSet ? i.repsPerSet.join(', ') : i.repMin === i.repMax ? i.repMax : `${i.repMin}-${i.repMax}`);
let libTab = 'active';

export async function render(parts) {
  document.body.dataset.route = 'plan';
  const [, a, b, c] = parts;
  if (a === 'day') return dayView(b);
  if (a === 'edit') return editView(b);
  if (a === 'library') return libraryView();
  if (a === 'exercise') return exerciseView(b);
  if (a === 'warmup') return warmupView(b, c || 'warmup');
  return listView();
}

/* ---------- Day list ---------- */
function listView() {
  const html = `${pageHeader('Plan')}<div class="page">
    <div class="stack">${store.days.map((d) => {
      const n = d.sections.flatMap((s) => s.items || []).filter((i) => !i.kind).length;
      return `<a class="card daycard" href="#/plan/day/${d.id}"><div class="grow"><div class="row between"><b class="wrap-any">${esc(d.name)}</b>${chip(wdName(d))}</div>
        <div class="muted small">${esc(d.focus || '')} · ${n} exercises · ~${d.sections.reduce((t, s) => t + (s.durationMin || 0), 0)} min</div></div>${icon('chevron-right')}</a>`; }).join('')}</div>
    <section class="card stack"><h2>Customize</h2><div class="list">
      <a class="li" href="#/plan/library"><div class="grow"><div>Exercise library</div><div class="small muted">Add, rename, archive, links and increments</div></div>${icon('chevron-right')}</a>
      <button class="li" data-act="add-day"><div class="grow"><div>Add a workout day</div></div>${icon('plus')}</button>
      <button class="li" data-act="reset"><div class="grow"><div>Reset to the default program</div><div class="small muted">Your history is never touched</div></div>${icon('chevron-right')}</button></div></section></div>`;
  return { html, nav: true, act: {
    'add-day': async () => {
      const id = uid(), first = store.days[0];
      await saveDay({ id, name: 'New workout', focus: '', order: Math.max(-1, ...store.days.map((d) => d.order)) + 1, defaultWeekday: null,
        sections: [{ type: 'warmup', durationMin: 10 }, { type: 'lifts', durationMin: 40, items: [] }, { type: 'crunch', durationMin: 5, items: [] }, { type: 'cooldown', durationMin: 3 }] });
      for (const kind of ['warmup', 'cooldown']) { const src = (kind === 'warmup' ? store.warmups : store.cooldowns)[first?.id];
        await saveWarmup({ id: `${kind === 'warmup' ? 'wu' : 'cd'}-${id}`, dayId: id, kind, blocks: JSON.parse(JSON.stringify(src?.blocks.filter((x) => kind === 'cooldown' || x.id === 'A') || [])) }); }
      await saveState({ queue: [...store.state.queue, id] });
      go(`plan/edit/${id}`);
    },
    reset: async () => {
      if (await confirmDialog({ title: 'Reset to the default program?', message: 'Exercises, workout days and warm-ups return to the defaults, including your edits and custom links. Your logged history, body metrics and photos are not touched.', okLabel: 'Reset program', danger: true })) { await resetProgram(); toast('Program reset to defaults.'); refresh(); }
    } } };
}

/* ---------- Read-only day preview ---------- */
function dayView(id) {
  const d = dayOf(id);
  if (!d) return { html: `${pageHeader('Plan', { back: 'plan' })}<div class="page"><div class="card">Workout not found.</div></div>`, nav: true };
  const wu = store.warmups[id], cd = store.cooldowns[id];
  const html = `${pageHeader(d.name, { back: 'plan', sub: `${wdName(d)} · ${d.focus || ''}`, right: `<a class="btn sm primary" href="#/plan/edit/${id}">${icon('edit', 'sm')}Edit</a>` })}<div class="page">
    ${d.sections.map((s) => `<section class="card stack"><div class="row between"><h2>${SEC_LABEL[s.type]}</h2>${chip(`${s.durationMin} min`)}</div>
      ${s.items ? (s.items.length ? `<div class="list">${s.items.map((i) => i.kind ? `<div class="li"><div class="grow"><div>${esc(i.name)}</div><div class="small muted">${i.minMin}-${i.minMax} min · ${esc(i.note || '')}</div></div></div>` :
        `<div class="li"><div class="grow"><div>${esc(exName(i.exerciseId))}${i.optional ? ' ' + chip('Optional') : ''}${i.heavyCrunch ? ' ' + chip('Heavy', 'hot') : ''}</div>
        <div class="small muted">${i.sets} × ${repText(i)} · rest ${i.restSec}s · start ${esc(fmtW(i.startWeightKg))} ${wUnit()}</div></div></div>`).join('')}</div>` : '<p class="muted">No exercises yet.</p>') :
      `<div class="muted small">${s.type === 'warmup' ? (wu?.blocks || []).map((b) => esc(b.name)).join(' · ') + ' · Block C: ramp-up sets on the first lift (calculated for you)' : (cd?.blocks || []).flatMap((b) => b.steps.map((x) => esc(x.name))).join(' · ')}</div>
      <a class="btn sm secondary" href="#/plan/warmup/${id}/${s.type}">Edit ${s.type === 'warmup' ? 'warm-up' : 'cooldown'}</a>`}</section>`).join('')}</div>`;
  return { html, nav: true };
}

/* ---------- Day editor ---------- */
function editView(id) {
  const d = dayOf(id);
  if (!d) return listView();
  const idx = store.days.findIndex((x) => x.id === id);
  const html = `${pageHeader('Edit workout', { back: `plan/day/${id}`, sub: 'Changes save automatically' })}<div class="page">
    <section class="card stack">${field('Name', `<input data-chg="dname" value="${esc(d.name)}" maxlength="60">`)}${field('Focus', `<input data-chg="dfocus" value="${esc(d.focus || '')}" maxlength="80">`)}
      ${field('Default weekday', `<select data-chg="dwd"><option value="">Any day (no default)</option>${WEEKDAYS.map((w, i) => `<option value="${i}" ${d.defaultWeekday === i ? 'selected' : ''}>${w}</option>`).join('')}</select>`, 'Only a default. The rolling queue decides what is next.')}
      <div class="grid3">${d.sections.map((s, si) => field(SEC_LABEL[s.type] + ' min', `<input inputmode="numeric" data-chg="sdur" data-s="${si}" value="${s.durationMin}">`)).join('')}</div>
      <div class="row wrap"><button class="btn sm secondary" data-act="day-up" ${idx === 0 ? 'disabled' : ''}>${icon('up', 'sm')}Earlier in cycle</button><button class="btn sm secondary" data-act="day-down" ${idx === store.days.length - 1 ? 'disabled' : ''}>${icon('down', 'sm')}Later in cycle</button>
      <button class="btn sm secondary" data-act="dup">Duplicate</button><button class="btn sm danger" data-act="del-day">Delete day</button></div></section>
    ${d.sections.map((s, si) => s.items ? `<section class="card stack"><h2>${SEC_LABEL[s.type]}</h2>
      ${s.items.map((it, ii) => it.kind ? cardioEdit(it, si, ii) : itemEdit(it, si, ii, s.items.length)).join('') || '<p class="muted">Empty.</p>'}
      <button class="btn secondary block" data-act="add-ex" data-s="${si}">${icon('plus', 'sm')}Add exercise</button></section>` : '').join('')}
    <section class="card stack"><h2>Templates</h2><div class="row wrap"><a class="btn sm secondary" href="#/plan/warmup/${id}/warmup">Edit warm-up</a><a class="btn sm secondary" href="#/plan/warmup/${id}/cooldown">Edit cooldown</a></div></section></div>`;
  return { html, nav: true, act: dayActs(id), chg: dayChg(id) };
}
const itemEdit = (it, si, ii, n) => `<div class="edit-item stack-s"><div class="row"><b class="grow wrap-any">${esc(exName(it.exerciseId))}</b>
  <button class="iconbtn" data-act="mv" data-s="${si}" data-i="${ii}" data-d="-1" aria-label="Move up" ${ii === 0 ? 'disabled' : ''}>${icon('up')}</button>
  <button class="iconbtn" data-act="mv" data-s="${si}" data-i="${ii}" data-d="1" aria-label="Move down" ${ii === n - 1 ? 'disabled' : ''}>${icon('down')}</button></div>
  <div class="grid3">${field('Sets', `<input inputmode="numeric" data-chg="it" data-f="sets" data-s="${si}" data-i="${ii}" value="${it.sets}">`)}
  ${field('Reps min', `<input inputmode="numeric" data-chg="it" data-f="repMin" data-s="${si}" data-i="${ii}" value="${it.repMin}">`)}${field('Reps max', `<input inputmode="numeric" data-chg="it" data-f="repMax" data-s="${si}" data-i="${ii}" value="${it.repMax}">`)}</div>
  <div class="grid2">${field('Rest (s)', `<input inputmode="numeric" data-chg="it" data-f="restSec" data-s="${si}" data-i="${ii}" value="${it.restSec}">`)}
  ${field(`Start weight (${wUnit()})`, `<input inputmode="decimal" data-chg="it" data-f="startWeightKg" data-s="${si}" data-i="${ii}" value="${esc(fmtW(it.startWeightKg))}">`)}</div>
  <label class="check"><input type="checkbox" data-chg="it" data-f="optional" data-s="${si}" data-i="${ii}" ${it.optional ? 'checked' : ''}><span>Optional exercise</span></label>
  <div class="row wrap"><button class="btn sm secondary" data-act="swap" data-s="${si}" data-i="${ii}">Swap exercise</button><button class="btn sm secondary" data-act="rm-ex" data-s="${si}" data-i="${ii}">${icon('trash', 'sm')}Remove</button></div></div>`;
const cardioEdit = (it, si, ii) => `<div class="edit-item stack-s"><b>${esc(it.name)}</b><div class="grid2">${field('Minutes min', `<input inputmode="numeric" data-chg="it" data-f="minMin" data-s="${si}" data-i="${ii}" value="${it.minMin}">`)}${field('Minutes max', `<input inputmode="numeric" data-chg="it" data-f="minMax" data-s="${si}" data-i="${ii}" value="${it.minMax}">`)}</div>
  <button class="btn sm secondary" data-act="rm-ex" data-s="${si}" data-i="${ii}">${icon('trash', 'sm')}Remove</button></div>`;

const dayChg = (id) => ({
  dname: (el) => { const d = dayOf(id); const v = el.value.trim(); if (v) saveDay({ ...d, name: v }); },
  dfocus: (el) => saveDay({ ...dayOf(id), focus: el.value.trim() }),
  dwd: async (el) => { await saveDay({ ...dayOf(id), defaultWeekday: el.value === '' ? null : +el.value }); },
  sdur: async (el) => { const d = structuredClone(dayOf(id)); const v = parseInt(el.value, 10); if (v >= 0) d.sections[+el.dataset.s].durationMin = v; await saveDay(d); refresh({ keepScroll: true }); },
  it: async (el) => {
    const d = structuredClone(dayOf(id)), it = d.sections[+el.dataset.s].items[+el.dataset.i], f = el.dataset.f;
    if (f === 'optional') it.optional = el.checked;
    else if (f === 'startWeightKg') { const v = parseW(el.value); if (v === null) return refresh({ keepScroll: true }); it.startWeightKg = v; }
    else { const v = parseInt(el.value, 10); if (!(v >= 0)) return refresh({ keepScroll: true }); it[f] = v; if (f === 'sets' && it.repsPerSet) it.repsPerSet = null; }
    if (it.repMin > it.repMax && (f === 'repMin' || f === 'repMax')) { if (f === 'repMin') it.repMax = it.repMin; else it.repMin = it.repMax; }
    await saveDay(d); refresh({ keepScroll: true });
  },
});

function exercisePicker(day, onPick, excludeId) {
  const used = new Set(day.sections.flatMap((s) => (s.items || []).map((i) => i.exerciseId)));
  const list = Object.values(store.exercises).filter((e) => !e.archived && e.equipment !== 'cardio' && (!used.has(e.id) || e.id === excludeId) && e.id !== excludeId).sort((a, b) => a.name.localeCompare(b.name));
  sheet(`<h2>Choose an exercise</h2>${list.length ? `<div class="list">${list.map((e) => `<button class="li" data-sh="pick" data-id="${e.id}"><div class="grow"><div>${esc(e.name)}</div><div class="small muted">${esc(e.equipment)} · ${esc((e.muscles || []).join(', '))}</div></div></button>`).join('')}</div>` : '<p class="muted">Every exercise is already in this workout. Create a new one in the library.</p>'}
    <a class="btn secondary block" href="#/plan/exercise/new" data-sh="__close">Create a new exercise</a>`, { pick: (t, _e, close) => { close(); onPick(t.dataset.id); } });
}

const dayActs = (id) => ({
  mv: async (el) => { const d = structuredClone(dayOf(id)), items = d.sections[+el.dataset.s].items, i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; await saveDay(d); refresh({ keepScroll: true }); },
  'rm-ex': async (el) => { const d = structuredClone(dayOf(id)); d.sections[+el.dataset.s].items.splice(+el.dataset.i, 1); await saveDay(d); refresh({ keepScroll: true }); },
  'add-ex': (el) => exercisePicker(dayOf(id), async (exId) => {
    const d = structuredClone(dayOf(id)), ex = store.exercises[exId];
    d.sections[+el.dataset.s].items.push({ exerciseId: exId, sets: 3, repMin: 10, repMax: 12, restSec: store.settings.defaultRestSec || 60, startWeightKg: ex.equipment === 'bodyweight' ? 0 : 10, optional: false, note: '' });
    await saveDay(d); refresh({ keepScroll: true });
  }),
  swap: (el) => { const cur = dayOf(id).sections[+el.dataset.s].items[+el.dataset.i].exerciseId;
    exercisePicker(dayOf(id), async (exId) => { const d = structuredClone(dayOf(id)); d.sections[+el.dataset.s].items[+el.dataset.i].exerciseId = exId; await saveDay(d); toast('Swapped. Past sessions keep the original.'); refresh({ keepScroll: true }); }, cur); },
  'day-up': () => reorder(id, -1), 'day-down': () => reorder(id, 1),
  dup: async () => {
    const d = structuredClone(dayOf(id)), nid = uid();
    Object.assign(d, { id: nid, name: `${d.name} copy`, order: Math.max(...store.days.map((x) => x.order)) + 1 });
    await saveDay(d);
    for (const [kind, src] of [['warmup', store.warmups[id]], ['cooldown', store.cooldowns[id]]]) if (src) await saveWarmup({ ...structuredClone(src), id: `${kind === 'warmup' ? 'wu' : 'cd'}-${nid}`, dayId: nid });
    await saveState({ queue: [...store.state.queue, nid] }); toast('Duplicated.'); go(`plan/edit/${nid}`);
  },
  'del-day': async () => {
    if (store.days.length <= 1) return toast('Keep at least one workout day.');
    if (await confirmDialog({ title: 'Delete this workout day?', message: 'Past sessions stay in your history. This only removes it from your plan.', okLabel: 'Delete day', danger: true })) { await removeDay(id); go('plan'); }
  },
});
async function reorder(id, dir) {
  const arr = [...store.days], i = arr.findIndex((d) => d.id === id), j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (let k = 0; k < arr.length; k++) await saveDay({ ...arr[k], order: k });
  refresh({ keepScroll: true });
}

/* ---------- Library ---------- */
async function libraryView() {
  const usedLogs = new Set((await db.getAll('setLogs')).map((l) => l.exerciseId));
  const all = Object.values(store.exercises).filter((e) => e.equipment !== 'cardio').sort((a, b) => a.name.localeCompare(b.name));
  const list = all.filter((e) => (libTab === 'archived') === !!e.archived);
  const html = `${pageHeader('Exercise library', { back: 'plan', right: `<a class="btn sm primary" href="#/plan/exercise/new">${icon('plus', 'sm')}New</a>` })}<div class="page">
    ${segmented('lib-tab', [['active', 'Active'], ['archived', 'Archived']], libTab)}
    <input type="search" placeholder="Search exercises" aria-label="Search exercises" data-inp="q">
    <section class="card"><div class="list">${list.map((e) => `<a class="li" data-name="${esc(e.name.toLowerCase())}" href="#/plan/exercise/${e.id}"><div class="grow"><div>${esc(e.name)}</div>
      <div class="small muted">${esc(e.equipment)} · ${esc((e.muscles || []).join(', '))}${e.videoUrl ? ' · custom link' : ''}</div></div>${icon('chevron-right')}</a>`).join('') || '<p class="muted">Nothing here.</p>'}</div></section></div>`;
  void usedLogs;
  return { html, nav: true, act: { 'lib-tab': (el) => { libTab = el.dataset.v; refresh(); } },
    inp: { q: (el) => { const q = el.value.trim().toLowerCase(); document.querySelectorAll('.li[data-name]').forEach((r) => r.classList.toggle('hidden', !!q && !r.dataset.name.includes(q))); } } };
}

async function exerciseView(id) {
  const isNew = id === 'new';
  const e = isNew ? { id: uid(), name: '', equipment: 'machine', muscles: [], cues: '', videoUrl: null, searchQuery: '', incrementKg: 2.5, pulleyRatio: '', pinnedNote: '', archived: false, createdAt: Date.now() } : store.exercises[id];
  if (!e) return libraryView();
  const inUse = store.days.some((d) => d.sections.some((s) => (s.items || []).some((i) => i.exerciseId === e.id)));
  const html = `${pageHeader(isNew ? 'New exercise' : 'Edit exercise', { back: 'plan/library' })}<div class="page"><form class="card stack" id="exform" onsubmit="return false">
    ${field('Name', `<input id="x-name" value="${esc(e.name)}" maxlength="80" required>`)}
    ${field('Equipment (decides how weight is entered)', `<select id="x-eq">${EQUIPMENT.map((q) => `<option ${e.equipment === q ? 'selected' : ''}>${q}</option>`).join('')}</select>`, 'Assisted: less assistance counts as progress. Smith and barbell: you log plates added; the bar is added for the total.')}
    ${field('Muscles (comma separated)', `<input id="x-mus" value="${esc((e.muscles || []).join(', '))}">`)}
    ${field('Form cues', `<textarea id="x-cues">${esc(e.cues)}</textarea>`)}
    <div class="grid2">${field(`Increment (${wUnit()})`, `<input id="x-inc" inputmode="decimal" value="${esc(fmtW(e.incrementKg))}">`, 'Smallest jump when you progress.')}${field('Pulley ratio (cables)', `<input id="x-ratio" placeholder="1:1 or 2:1" value="${esc(e.pulleyRatio || '')}">`)}</div>
    ${field('Pinned note', `<input id="x-note" value="${esc(e.pinnedNote || '')}" placeholder="Seat position 4, pin 3...">`)}
    ${field('Custom video URL', `<input id="x-url" inputmode="url" value="${esc(e.videoUrl || '')}" placeholder="https://www.youtube.com/shorts/...">`, 'Leave empty to use a YouTube search for this exercise.')}
    ${field('YouTube search text', `<input id="x-q" value="${esc(e.searchQuery || '')}" placeholder="auto: name + proper form shorts">`)}
    ${isNew ? '' : `<label class="check"><input type="checkbox" id="x-arch" ${e.archived ? 'checked' : ''}><span>Archived (hidden from pickers, history kept)</span></label>`}
    <button class="btn primary block" data-act="save">Save exercise</button>
    ${isNew ? '' : `<a class="btn secondary block" href="${esc(watchUrl(e))}" target="_blank" rel="noopener">${icon('video', 'sm')}Test the video link</a><button class="btn danger block" data-act="del">Delete exercise</button>`}</form></div>`;
  return { html, nav: true, act: {
    save: async () => {
      const name = document.getElementById('x-name').value.trim();
      if (!name) return toast('Give the exercise a name.');
      const url = document.getElementById('x-url').value.trim();
      if (url && !/^https?:\/\//i.test(url)) return toast('The video link must start with http:// or https://');
      const inc = parseW(document.getElementById('x-inc').value);
      const q = document.getElementById('x-q').value.trim();
      await saveExercise({ ...e, name, equipment: document.getElementById('x-eq').value, incrementKg: inc ?? e.incrementKg, pulleyRatio: document.getElementById('x-ratio').value.trim(),
        muscles: document.getElementById('x-mus').value.split(',').map((m) => m.trim()).filter(Boolean), cues: document.getElementById('x-cues').value.trim(), pinnedNote: document.getElementById('x-note').value.trim(),
        videoUrl: url || null, searchQuery: q || `${name} proper form shorts`, archived: isNew ? false : document.getElementById('x-arch').checked });
      toast('Saved.'); go('plan/library');
    },
    del: async () => {
      const logs = (await db.byIndex('setLogs', 'exerciseId', e.id)).length;
      if (inUse || logs) return toast(inUse ? 'It is used in a workout. Swap it out first, or archive it.' : 'It has logged history. Archive it instead to keep your charts.');
      if (await confirmDialog({ title: 'Delete exercise?', message: e.name, okLabel: 'Delete', danger: true })) { await db.del('exercises', e.id); delete store.exercises[e.id]; go('plan/library'); }
    } } };
}

/* ---------- Warm-up / cooldown editor ---------- */
function warmupView(dayId, kind) {
  const d = dayOf(dayId);
  const tpl = (kind === 'warmup' ? store.warmups : store.cooldowns)[dayId];
  if (!d || !tpl) return listView();
  const save = (t) => saveWarmup(t);
  const clone = () => structuredClone(tpl);
  const html = `${pageHeader(kind === 'warmup' ? 'Warm-up' : 'Cooldown', { back: `plan/day/${dayId}`, sub: d.name })}<div class="page">
    ${kind === 'warmup' ? '<div class="banner info">' + icon('alert') + '<div class="small">Block C, the ramp-up sets on your first lift, is calculated automatically from your working weight.</div></div>' : ''}
    ${tpl.blocks.map((b, bi) => `<section class="card stack">${field('Block name', `<input data-chg="bname" data-b="${bi}" value="${esc(b.name)}">`)}
      ${b.steps.map((s, si) => `<div class="edit-item stack-s">${field('Move', `<input data-chg="sf" data-f="name" data-b="${bi}" data-s="${si}" value="${esc(s.name)}">`)}
        <div class="grid2">${field('Reps / amount', `<input data-chg="sf" data-f="amount" data-b="${bi}" data-s="${si}" value="${esc(s.amount || '')}" placeholder="x10">`)}${field('Seconds (timer)', `<input inputmode="numeric" data-chg="sf" data-f="seconds" data-b="${bi}" data-s="${si}" value="${s.seconds || ''}">`)}</div>
        <button class="btn sm secondary" data-act="rm-step" data-b="${bi}" data-s="${si}">${icon('trash', 'sm')}Remove move</button></div>`).join('')}
      <div class="row wrap"><button class="btn sm secondary" data-act="add-step" data-b="${bi}">${icon('plus', 'sm')}Add move</button>
      <button class="btn sm secondary" data-act="rm-block" data-b="${bi}">Remove block</button></div></section>`).join('')}
    <button class="btn secondary block" data-act="add-block">${icon('plus', 'sm')}Add block</button>
    <button class="btn ghost block" data-act="restore">Restore this template to default</button></div>`;
  const re = () => refresh({ keepScroll: true });
  return { html, nav: true,
    chg: {
      bname: async (el) => { const t = clone(); t.blocks[+el.dataset.b].name = el.value.trim() || 'Block'; await save(t); },
      sf: async (el) => { const t = clone(), s = t.blocks[+el.dataset.b].steps[+el.dataset.s], f = el.dataset.f;
        if (f === 'seconds') { const v = parseInt(el.value, 10); if (v > 0) s.seconds = v; else delete s.seconds; } else if (f === 'amount') { if (el.value.trim()) s.amount = el.value.trim(); else delete s.amount; }
        else { s.name = el.value.trim() || s.name; s.searchQuery = `${s.name} exercise form shorts`; }
        await save(t); },
    },
    act: {
      'rm-step': async (el) => { const t = clone(); t.blocks[+el.dataset.b].steps.splice(+el.dataset.s, 1); await save(t); re(); },
      'add-step': async (el) => { const t = clone(); t.blocks[+el.dataset.b].steps.push({ name: 'New move', searchQuery: 'new move exercise form shorts', amount: 'x10' }); await save(t); re(); },
      'rm-block': async (el) => { const t = clone(); t.blocks.splice(+el.dataset.b, 1); await save(t); re(); },
      'add-block': async () => { const t = clone(); t.blocks.push({ id: uid().slice(0, 4), name: 'New block', durationSec: 120, steps: [] }); await save(t); re(); },
      restore: async () => {
        const def = SEED_WARMUPS.find((w) => w.dayId === dayId && w.kind === kind) || SEED_WARMUPS.find((w) => w.kind === kind);
        if (await confirmDialog({ title: 'Restore default?', message: 'This template returns to the original version.', okLabel: 'Restore' })) { await save({ ...structuredClone(def), id: tpl.id, dayId }); refresh(); }
      } } };
}
