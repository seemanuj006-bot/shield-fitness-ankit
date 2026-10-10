/** Today: one clear next action, the missed-day banner, and quick stats. */
import * as db from '../db.js';
import { store, trainingWeekdays, saveState, setSetting } from '../store.js';
import { allSessions, previewSnapshot, startSession, skipMissed, moveMissedToToday, moveMissedTo, setRest, setPaused, volumeOf, logsFor, discardSession } from '../session.js';
import { todayPlan, detectMissed, localDateStr, addDays, trainingSlotIndex, streak, weekStart, moveInQueue, daysBetween } from '../scheduler.js';
import { esc, fmtW, wUnit, fmtDate, fmtDay, fmtDur, WEEKDAYS } from '../util.js';
import { go, refresh } from '../router.js';
import { icon, chip, pageHeader, sheet, toast, confirmDialog } from './components.js';

let ctx = null; // data for the current render, used by actions

export async function render() {
  document.body.dataset.route = 'today';
  const sessions = await allSessions();
  const today = localDateStr();
  const tw = trainingWeekdays();
  const paused = !!store.state.pausedSince;
  const plan = todayPlan({ today, sessions, queue: store.state.queue, trainingWeekdays: tw, paused });
  const missed = plan.state === 'in_progress' ? [] : detectMissed({ today, startDate: store.settings.startDate, sessions, trainingWeekdays: tw, paused, pauseRanges: store.state.pauseRanges });
  const nextDay = store.days.find((d) => d.id === plan.nextDayId);
  const preview = nextDay && plan.state !== 'in_progress' && plan.state !== 'paused' ? await previewSnapshot(nextDay.id, today, { sessions }) : null;
  const daily = (await db.get('daily', today)) || { date: today };
  ctx = { sessions, today, tw, plan, missed, nextDay, preview, daily };

  const completed = sessions.filter((s) => s.status === 'completed' && !s.adhoc);
  const week = preview?.week ?? Math.floor(completed.length / Math.max(1, store.days.length)) + 1;
  const phase = preview?.phase ?? '';
  const first = preview?.snap.sections.flatMap((s) => s.items || []).find((i) => !i.kind);
  const html = `${pageHeader('Today', { sub: fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' }) })}
  <div class="page">
    ${backupBanner(sessions)}
    ${paused ? pausedCard() : ''}
    ${missed.length && !paused ? missedBanner(missed, nextDay) : ''}
    ${await hero(plan, preview, nextDay, missed)}
    <section class="stats3">
      <div class="stat"><b>${week}</b><span>Program week${phase ? ` · Phase ${phase}` : ''}</span></div>
      <div class="stat"><b>${streak(sessions)}</b><span>Session streak</span></div>
      <div class="stat"><b>${first ? `${esc(fmtW(first.targetWeightKg))}` : '-'}</b><span>${first ? `${esc(first.name)}: now vs ${first.lastSets?.length ? esc(fmtW(Math.max(...first.lastSets.map((x) => x.weightKg)))) : 'new'} ${wUnit()}` : 'Next lift'}</span></div>
    </section>
    ${await weeklyCard(sessions, today)}
    ${dailyCard(daily, plan)}
    <section class="card stack"><h2>More</h2><div class="list">
      <button class="li" data-act="else"><div class="grow"><div>Train something else</div><div class="small muted">Start any workout today</div></div>${icon('chevron-right')}</button>
      <button class="li" data-act="past"><div class="grow"><div>Log a past workout</div><div class="small muted">Forgot to log one? Add it with its real date</div></div>${icon('chevron-right')}</button>
      ${plan.state !== 'rest' && plan.state !== 'in_progress' && !paused ? `<button class="li" data-act="rest-today"><div class="grow"><div>Rest today</div><div class="small muted">Mark today as a rest day</div></div>${icon('chevron-right')}</button>` : ''}
      ${!paused ? `<button class="li" data-act="pause"><div class="grow"><div>Pause schedule</div><div class="small muted">Illness or travel: nothing counts as missed</div></div>${icon('pause')}</button>` : ''}
    </div></section>
    <p class="small muted center">${esc(TIPS[Math.floor(Date.parse(today) / 864e5) % TIPS.length])}</p>
  </div>`;
  return { html, act, chg, nav: true };
}

const TIPS = ['Tip: a small calorie surplus (~300 kcal) and 100-120 g protein a day does the heavy lifting for muscle gain.',
  'Tip: 7-9 hours of sleep is when you actually grow. Protect it.', 'Tip: pick a load that leaves about 2 reps in the tank. Add weight only after hitting the top of the range on every set.',
  'Tip: sharp or joint pain means stop that exercise. Severe pain, major swelling or dark brown urine after training means see a doctor.',
  'Tip: skip the pre-workout. Water, food and sleep do more.'];

function backupBanner(sessions) {
  const done = sessions.filter((s) => s.status === 'completed');
  if (!done.length) return '';
  const week = 7 * 864e5, last = store.settings.lastBackupAt || 0;
  const firstDone = Math.min(...done.map((s) => s.endedAt || Date.now()));
  if (Date.now() - Math.max(last, firstDone) < week) return '';
  if (Date.now() - (store.settings.backupDismissedAt || 0) < 3 * 864e5) return '';
  return `<div class="banner info">${icon('download')}<div class="grow"><b>Weekly backup</b><div class="small">Save a copy of your data in case your phone clears the app.</div></div>
    <a class="btn sm primary" href="#/settings">Export</a><button class="iconbtn" data-act="dismiss-backup" aria-label="Dismiss">${icon('x')}</button></div>`;
}
const pausedCard = () => `<div class="banner warn">${icon('pause')}<div class="grow"><b>Schedule paused</b><div class="small">Since ${esc(fmtDate(store.state.pausedSince))}. Nothing counts as missed. When you resume, loads adjust to the time away.</div></div>
  <button class="btn sm primary" data-act="resume">Resume</button></div>`;

function missedBanner(missed, day) {
  const more = missed.length > 1 ? ` (${missed.length - 1} more since)` : '';
  return `<section class="card stack warnbox"><div class="row">${icon('alert')}<div class="grow"><b>You missed ${esc(day?.name || 'a workout')} (${esc(fmtDay(missed[0]))}).${esc(more)} What now?</b></div></div>
    <button class="btn primary block" data-act="missed-today">Do it today (recommended)</button>
    <div class="grid2"><button class="btn secondary" data-act="missed-skip">Skip it</button><button class="btn secondary" data-act="missed-move">Move to a day</button></div>
    ${missed.length > 1 ? `<button class="btn ghost block" data-act="missed-skip-all">Skip all ${missed.length} missed</button>` : ''}</section>`;
}

async function hero(plan, preview, nextDay, missed) {
  const s = plan.state;
  if (s === 'in_progress') {
    const se = plan.session, snap = se.templateSnapshot;
    return `<section class="card hero stack"><div class="row between">${chip('In progress', 'hot')}<span class="small muted">Started ${esc(fmtDate(se.date))}</span></div>
      <h2 class="hero-t">${esc(snap.dayName)}</h2><p class="muted">Your sets are saved. Pick up exactly where you left off.</p>
      <button class="btn primary big block" data-act="resume-run" data-id="${se.id}">${icon('play')}Resume workout</button>
      <button class="btn ghost block" data-act="discard-run" data-id="${se.id}">Discard this workout</button></section>`;
  }
  if (s === 'paused') return nextDay ? `<section class="card stack"><div>${chip('Paused')}</div><h2>Next up: ${esc(nextDay.name)}</h2><p class="muted">Resume the schedule to start.</p></section>` : '';
  if (s === 'done') {
    const se = plan.session, logs = await logsFor(se.id);
    return `<section class="card hero stack"><div class="row between">${chip('Done', 'ok')}${icon('check')}</div><h2 class="hero-t">${esc(se.templateSnapshot.dayName)}</h2>
      <div class="stats"><div class="stat"><b>${esc(fmtW(volumeOf(logs)))}</b><span>${wUnit()} volume</span></div><div class="stat"><b>${fmtDur(((se.endedAt || 0) - se.startedAt) / 1000)}</b><span>duration</span></div><div class="stat"><b>${(se.prs || []).length}</b><span>PRs</span></div></div>
      <p class="muted">Done for today. Next up: <b>${esc(nextDay?.name || "")}</b>.</p>
      <div class="row wrap"><a class="btn secondary grow" href="#/run/${se.id}">Edit this session</a><button class="btn secondary grow" data-act="start">Train next anyway</button></div></section>`;
  }
  if (!nextDay) return `<section class="card"><h2>No workouts in your plan</h2><a class="btn primary" href="#/plan">Open Plan</a></section>`;
  const snap = preview.snap;
  const muscles = [...new Set(snap.sections.flatMap((x) => x.items || []).flatMap((i) => i.muscles || []))].slice(0, 8);
  const count = snap.sections.flatMap((x) => x.items || []).filter((i) => !i.kind).length;
  const gap = preview.gapAdj;
  const gapHtml = gap ? `<div class="banner info">${icon('alert')}<div class="grow"><b>Welcome back, taking it lighter today</b><div class="small">${gap.gapDays} days since your last session: loads at ${gap.pct}%, ${gap.sets ? `${gap.sets} sets` : '1 fewer set'} per exercise${gap.forcePhase ? ', Phase A rules' : ''}.</div></div>
    <button class="btn sm secondary" data-act="normal-loads">Normal loads</button></div>` : '';
  const warn = [...snap.notes, ...(snap.backToBack.length ? [`Heads up: ${snap.backToBack.join(', ')} were worked yesterday. Go easy.`] : [])];
  const status = s === 'rest' ? chip('Rest day', 'ok') : missed.length ? chip('Behind', 'warn') : chip('Planned');
  const trainBtn = s === 'rest' ? `<button class="btn secondary block" data-act="start">Train anyway: ${esc(nextDay.name)}</button>` :
    `<button class="btn primary big block" data-act="start">${icon('play')}Start workout</button>`;
  if (s === 'rest') {
    return `<section class="card hero stack"><div class="row between">${status}<span class="small muted">${plan.manual ? 'Your choice' : ''}</span></div><h2 class="hero-t">Rest day</h2>
      <p class="muted">${esc(plan.reason)} Recovery is when the muscle is built. Eat well, hydrate, sleep.</p>
      <div class="muted small">Next up: <b>${esc(nextDay.name)}</b></div>${trainBtn}
      ${plan.manual ? `<button class="btn ghost block" data-act="undo-rest">Undo rest day</button>` : ''}</section>`;
  }
  return `<section class="card hero stack"><div class="row between">${status}<span class="small muted">~${snap.estMinutes} min</span></div>
    <div><h2 class="hero-t">${esc(nextDay.name)}</h2><div class="muted">${esc(nextDay.focus || '')}</div></div>
    <div class="chips">${chip(`${count} exercises`)}${chip(`Phase ${snap.phase} · week ${snap.week}`)}${muscles.map((m) => chip(m)).join('')}</div>
    <p class="why small muted">${esc(plan.reason)}</p>${gapHtml}
    ${warn.map((w) => `<div class="banner info">${icon('alert')}<div>${esc(w)}</div></div>`).join('')}${trainBtn}</section>`;
}

async function weeklyCard(sessions, today) {
  const a = weekStart(today), b = addDays(a, 6);
  const wk = sessions.filter((s) => s.status === 'completed' && s.date >= a && s.date <= b);
  if (!wk.length) return '';
  let vol = 0; for (const s of wk) vol += volumeOf(await logsFor(s.id));
  const prs = wk.reduce((t, s) => t + (s.prs?.length || 0), 0);
  const bm = (await db.getAll('bodyMetrics')).filter((m) => m.weightKg).sort((x, y) => x.date.localeCompare(y.date));
  const recent = bm.filter((m) => m.date >= addDays(today, -7));
  const delta = recent.length >= 2 ? recent[recent.length - 1].weightKg - recent[0].weightKg : null;
  return `<section class="card stack"><h2>This week</h2><div class="stats4">
    <div class="stat"><b>${wk.length}/${store.days.length}</b><span>sessions</span></div><div class="stat"><b>${esc(fmtW(vol))}</b><span>${wUnit()} volume</span></div>
    <div class="stat"><b>${prs}</b><span>PRs</span></div><div class="stat"><b>${delta === null ? '-' : (delta > 0 ? '+' : '') + fmtW(delta)}</b><span>${wUnit()} body</span></div></div></section>`;
}

function dailyCard(d, plan) {
  const row = (k, label, hint) => `<label class="check"><input type="checkbox" data-chg="daily" data-k="${k}" ${d[k] ? 'checked' : ''}><span>${label}<span class="muted small"> ${hint}</span></span></label>`;
  return `<section class="card stack"><h2>Daily habits</h2>${row('protein', 'Protein target hit', '100-120 g')}${row('water', 'Water', 'steady through the day')}
    ${plan.state === 'rest' ? row('walk', 'Easy walk', '20-30 min, optional') : ''}</section>`;
}

const days = () => store.days.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
const go2 = async (dayId, opts) => { go(`run/${await startSession(dayId, opts)}`); };

const act = {
  start: async () => { try { await go2(ctx.nextDay.id, { date: ctx.today }); } catch (e) { toast(`Could not start: ${e.message}`); } },
  'resume-run': (el) => go(`run/${el.dataset.id}`),
  'discard-run': async (el) => { if (await confirmDialog({ title: 'Discard workout?', message: 'All sets logged in this session will be deleted.', okLabel: 'Discard', danger: true })) { await discardSession(el.dataset.id); refresh(); } },
  'normal-loads': async () => { await saveState({ gapOverrideDate: ctx.today }); refresh(); },
  'missed-today': async () => { await moveMissedToToday(ctx.missed); toast(`${ctx.nextDay.name} is today's workout. Everything after it shifts one slot later.`); refresh(); },
  'missed-skip': async () => { await skipMissed(ctx.missed, false); toast('Skipped. It stays in your history.'); refresh(); },
  'missed-skip-all': async () => { await skipMissed(ctx.missed, true); toast('Skipped all missed sessions.'); refresh(); },
  'missed-move': () => {
    const opts = []; for (let i = 1; i <= 14; i++) { const d = addDays(ctx.today, i); opts.push(d); }
    sheet(`<h2>Move ${esc(ctx.nextDay.name)} to...</h2><p class="muted small">The rest of the cycle reflows around it.</p><div class="list">${opts.map((d) => `<button class="li" data-sh="pick" data-d="${d}"><div class="grow">${esc(fmtDate(d))}</div>${icon('chevron-right')}</button>`).join('')}</div>`, {
      pick: async (t, _e, close) => {
        const idx = (ctx.plan.state === 'planned' ? 1 : 0) + trainingSlotIndex(addDays(ctx.today, 1), t.dataset.d, ctx.tw);
        close(); await moveMissedTo(ctx.missed, idx); toast(`${ctx.nextDay.name} moved to ${fmtDate(t.dataset.d)}.`); refresh();
      } });
  },
  'rest-today': async () => { await setRest(ctx.today, true); refresh(); },
  'undo-rest': async () => { await setRest(ctx.today, false); refresh(); },
  pause: async () => { if (await confirmDialog({ title: 'Pause the schedule?', message: 'Nothing will count as missed while paused. When you resume, loads adjust to how long you were away.', okLabel: 'Pause' })) { await setPaused(true); refresh(); } },
  resume: async () => { await setPaused(false); refresh(); },
  'dismiss-backup': async () => { await setSetting('backupDismissedAt', Date.now()); refresh(); },
  else: () => {
    sheet(`<h2>Train something else</h2><label class="field"><span class="lbl">Workout</span><select id="else-day">${days()}</select></label>
      <label class="check"><input type="checkbox" id="else-count"><span>Count it as my next workout (moves it to the front of the cycle)</span></label>
      <p class="muted small">Unticked, it is logged as an extra session and your cycle stays where it is.</p>
      <button class="btn primary block" data-sh="go">Start</button>`, {
      go: async (_t, _e, close) => {
        const id = document.getElementById('else-day').value, count = document.getElementById('else-count').checked;
        close();
        if (id === ctx.nextDay?.id) return go2(id, { date: ctx.today });
        if (count) { await saveState({ queue: moveInQueue(store.state.queue, id, 0) }); return go2(id, { date: ctx.today }); }
        return go2(id, { date: ctx.today, adhoc: true });
      } });
  },
  past: () => {
    sheet(`<h2>Log a past workout</h2><label class="field"><span class="lbl">Date</span><input type="date" id="past-date" max="${ctx.today}" value="${addDays(ctx.today, -1)}"></label>
      <label class="field"><span class="lbl">Workout</span><select id="past-day">${days()}</select></label>
      <p class="muted small">Enter the sets as you remember them. It updates your cycle and history.</p><button class="btn primary block" data-sh="go">Continue</button>`, {
      go: async (_t, _e, close) => {
        const d = document.getElementById('past-date').value, id = document.getElementById('past-day').value;
        if (!d || d > ctx.today || daysBetween(d, ctx.today) > 365) return toast('Pick a date within the last year.');
        close(); go2(id, { date: d });
      } });
  },
};
const chg = {
  daily: async (el) => { const d = { ...ctx.daily, [el.dataset.k]: el.checked }; ctx.daily = d; await db.put('daily', d); },
};
