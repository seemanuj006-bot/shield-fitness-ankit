/** Workout lifecycle: previews, start, finish, skip, rest, pause, history queries. */
import * as db from './db.js';
import { store, saveState } from './store.js';
import { buildSnapshot, buildSteps } from './planner.js';
import { detectPRs } from './progression.js';
import { programWeek, phaseFor, gapDays, gapAdjustment, localDateStr, addDays, completeInQueue, moveInQueue, normalizeQueue, DEFAULT_PHASE_RULES } from './scheduler.js';
import { uid } from './util.js';

export const allSessions = () => db.getAll('sessions');
export const logsFor = async (sid) => (await db.byIndex('setLogs', 'sessionId', sid)).sort((a, b) => a.setIndex - b.setIndex);
const rules = () => store.settings.phaseRules || DEFAULT_PHASE_RULES;
export const completedOf = (sessions) => sessions.filter((s) => s.status === 'completed');
export const lastCompletedDate = (sessions) => completedOf(sessions).map((s) => s.date).sort().pop() || null;

/** Past completed sessions' sets for an exercise, newest first: [{session, sets}] */
export async function exerciseHistory(exId, sessionsIn) {
  const [logs, sessions] = await Promise.all([db.byIndex('setLogs', 'exerciseId', exId), sessionsIn || allSessions()]);
  const map = new Map(sessions.filter((s) => s.status === 'completed').map((s) => [s.id, s]));
  const by = new Map();
  for (const l of logs) if (map.has(l.sessionId)) { if (!by.has(l.sessionId)) by.set(l.sessionId, []); by.get(l.sessionId).push(l); }
  return [...by.entries()].map(([id, sets]) => ({ session: map.get(id), sets: sets.sort((a, b) => a.setIndex - b.setIndex) }))
    .sort((a, b) => (b.session.date + b.session.endedAt).toString().localeCompare((a.session.date + a.session.endedAt).toString()));
}

async function lastSetsMap(exIds, sessions) {
  const out = {};
  await Promise.all([...new Set(exIds)].map(async (id) => { out[id] = (await exerciseHistory(id, sessions))[0]?.sets || []; }));
  return out;
}

/** Build (without saving) the snapshot for a day: used by Today and by startSession. */
export async function previewSnapshot(dayId, date, { ignoreGap = false, sessions } = {}) {
  sessions = sessions || await allSessions();
  const day = store.days.find((d) => d.id === dayId);
  const completed = sessions.filter((s) => s.status === 'completed' && !s.adhoc);
  const week = programWeek(completed.length, store.settings.programWeekOverride, store.days.length);
  const phaseInfo = { week, phase: phaseFor(week, rules()) };
  const today = localDateStr();
  const last = lastCompletedDate(sessions);
  let gapAdj = date === today ? gapAdjustment(gapDays(last, date)) : null;
  if (ignoreGap || store.state.gapOverrideDate === date) gapAdj = null;
  const exIds = day.sections.flatMap((s) => (s.items || []).flatMap((i) => [i.exerciseId, i.lightAlt?.exerciseId])).filter(Boolean);
  const history = await lastSetsMap(exIds, sessions);
  const snap = buildSnapshot({ day, exMap: store.exercises, warmup: store.warmups[dayId], cooldown: store.cooldowns[dayId],
    history, phaseInfo, gapAdj, rules: rules(), date, sessions });
  return { snap, gapAdj, week, phase: snap.phase };
}

/** Create a session and all its set rows in one transaction. Reuses an unfinished session if one exists. */
export async function startSession(dayId, { date = localDateStr(), adhoc = false } = {}) {
  const sessions = await allSessions();
  const open = sessions.find((s) => s.status === 'in_progress');
  if (open) return open.id;
  const { snap, gapAdj, week, phase } = await previewSnapshot(dayId, date, { sessions });
  const id = uid(), now = Date.now();
  const session = { id, date, dayId, status: 'in_progress', startedAt: now, endedAt: null, programWeek: week, phase, adhoc,
    gapAdjustment: gapAdj ? { tier: gapAdj.tier, pct: gapAdj.pct, gapDays: gapAdj.gapDays } : null, templateSnapshot: snap,
    note: '', energy: null, soreness: null, heavyCrunch: snap.heavyCrunch, muscleGroups: snap.muscleGroups, stepIndex: 0, checks: {} };
  const rows = [];
  if (snap.rampup) snap.rampup.sets.forEach((r, i) => rows.push({ id: uid(), sessionId: id, exerciseId: snap.rampup.exerciseId, setIndex: i,
    type: 'warmup', weightKg: r.weightKg, reps: r.reps, rpe: null, done: false, skipped: false, note: '', ts: now, ramp: true }));
  for (const sec of snap.sections) for (const item of sec.items || []) {
    if (item.kind === 'cardio') { rows.push({ id: uid(), sessionId: id, exerciseId: item.exerciseId, setIndex: 0, type: 'working', weightKg: 0, reps: item.minMin, rpe: null, done: false, skipped: false, note: '', ts: now }); continue; }
    for (let i = 0; i < item.sets; i++) rows.push({ id: uid(), sessionId: id, exerciseId: item.exerciseId, setIndex: i, type: 'working',
      weightKg: item.targetWeightKg, reps: item.repsPerSet?.[i] ?? item.repMax, rpe: null, done: false, skipped: false, note: '', ts: now,
      totalKg: totalOf(item.equipment, item.targetWeightKg) });
  }
  await db.tx(['sessions', 'setLogs'], 'readwrite', (o) => {
    o('sessions').put(session);
    for (const r of rows) o('setLogs').put(r);
  });
  return id;
}

/** Smith/barbell: weightKg is the plates added, total includes the bar. */
export function totalOf(equipment, kg) {
  if (equipment === 'smith') return kg + (store.settings.smithBarKg || 0);
  if (equipment === 'barbell') return kg + (store.settings.barbellBarKg || 0);
  return kg;
}

export async function recomputeProgramState() {
  const sessions = await allSessions();
  const done = sessions.filter((s) => s.status === 'completed' && !s.adhoc);
  await saveState({ completedSessions: done.length, lastCompletedDate: lastCompletedDate(sessions) });
}

export const workingDone = (logs) => logs.filter((l) => l.type !== 'warmup' && l.done && !l.skipped);
export const volumeOf = (logs, exMap = store.exercises) => workingDone(logs).filter((l) => exMap[l.exerciseId]?.equipment !== 'cardio')
  .reduce((t, l) => t + (l.weightKg || 0) * (l.reps || 0), 0);

export async function finishSession(id, { note = '', energy = null, soreness = null } = {}) {
  const sessions = await allSessions();
  const session = sessions.find((s) => s.id === id);
  const logs = await logsFor(id);
  const prs = [];
  for (const exId of [...new Set(logs.map((l) => l.exerciseId))]) {
    if (store.exercises[exId]?.equipment === 'cardio') continue;
    const hist = (await exerciseHistory(exId, sessions.filter((s) => s.id !== id))).flatMap((h) => h.sets);
    for (const pr of detectPRs(logs.filter((l) => l.exerciseId === exId), hist)) prs.push({ exerciseId: exId, ...pr });
  }
  const wasDone = session.status === 'completed';
  Object.assign(session, { status: 'completed', endedAt: wasDone ? session.endedAt : Date.now(), note, energy, soreness, prs });
  await db.put('sessions', session);
  if (!wasDone && !session.adhoc) await saveState({ queue: completeInQueue(store.state.queue, session.dayId), gapOverrideDate: null });
  await recomputeProgramState();
  return { session, prs, volume: volumeOf(logs) };
}

export async function discardSession(id) {
  const logs = await logsFor(id);
  await db.tx(['sessions', 'setLogs'], 'readwrite', (o) => { o('sessions').delete(id); for (const l of logs) o('setLogs').delete(l.id); });
}
export async function deleteSession(id) { await discardSession(id); await recomputeProgramState(); }

/** Marker sessions (skipped / moved / rest) carry no sets. */
const marker = (date, status, dayId = null, extra = {}) => ({ id: uid(), date, dayId, status, startedAt: null, endedAt: Date.now(), note: '', ...extra });

/** Missed-day choice 2: skip it. The workout is dropped and the queue moves on. */
export async function skipMissed(dates, all = false) {
  const list = all ? dates : dates.slice(0, 1);
  let q = store.state.queue;
  const recs = list.map((d) => { const dayId = q[0]; q = completeInQueue(q, dayId); return marker(d, 'skipped', dayId); });
  await db.putMany('sessions', recs);
  await saveState({ queue: q });
}
/** Missed-day choice 1: do it today. Missed dates are marked as moved; the queue keeps its order (everything shifts later). */
export async function moveMissedToToday(dates) { await db.putMany('sessions', dates.map((d) => marker(d, 'moved', null, { movedTo: localDateStr() }))); }
/** Missed-day choice 3: pick a day. The missed workout is slotted into the queue at that day's position. */
export async function moveMissedTo(dates, slotIndex) {
  await db.putMany('sessions', dates.map((d) => marker(d, 'moved', null)));
  await saveState({ queue: moveInQueue(store.state.queue, store.state.queue[0], slotIndex) });
}
export async function setRest(date, on) {
  const ss = (await db.byIndex('sessions', 'date', date)).filter((s) => s.status === 'rest');
  if (on && !ss.length) await db.put('sessions', marker(date, 'rest'));
  if (!on) await db.delMany('sessions', ss.map((s) => s.id));
}
export async function setPaused(on) {
  const today = localDateStr();
  if (on) return saveState({ pausedSince: store.state.pausedSince || today });
  const from = store.state.pausedSince;
  const ranges = from && from < today ? [...(store.state.pauseRanges || []), { from, to: addDays(today, -1) }] : store.state.pauseRanges || [];
  return saveState({ pausedSince: null, pauseRanges: ranges });
}
export const queueFix = () => normalizeQueue(store.state.queue, store.days.map((d) => d.id));

/** First-run helper: seed the owner's partially finished first Monday (smith incline + flat DB bench done). */
export async function seedPartialMonday({ flatKg, flatSets, flatReps }) {
  const id = await startSession('day-push', { adhoc: false });
  const [sessions, logs] = [await allSessions(), await logsFor(id)];
  const session = sessions.find((s) => s.id === id);
  const snap = session.templateSnapshot;
  const rows = [], keep = [];
  const doneSets = (exId, kg, n, reps) => {
    const base = logs.filter((l) => l.exerciseId === exId && l.type === 'working');
    for (let i = 0; i < n; i++) {
      const r = base[i] || { ...base[0], id: uid(), setIndex: i };
      rows.push({ ...r, weightKg: kg, reps, done: true, totalKg: totalOf(store.exercises[exId].equipment, kg), ts: Date.now() });
    }
    for (const extra of base.slice(n)) keep.push(extra.id);
  };
  doneSets('ex-smith-incline', 20, 3, 10);
  doneSets('ex-db-bench', flatKg, flatSets, flatReps);
  session.stepIndex = Math.max(0, buildSteps(snap).findIndex((s) => s.item?.exerciseId === 'ex-db-shoulder-press'));
  session.checks = Object.fromEntries(['A', 'B'].flatMap((b) => (snap.warmup?.blocks.find((x) => x.id === b)?.steps || []).map((_, i) => [`warmup:${b}:${i}`, true])));
  await db.tx(['sessions', 'setLogs'], 'readwrite', (o) => {
    o('sessions').put(session);
    for (const r of rows) o('setLogs').put(r);
    for (const k of keep) o('setLogs').delete(k);
    for (const l of logs.filter((x) => x.ramp)) o('setLogs').put({ ...l, done: true });
  });
  return id;
}
