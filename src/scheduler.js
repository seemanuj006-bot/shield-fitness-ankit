/**
 * Scheduler: pure functions only (no DOM, no IndexedDB), so they can be unit-tested in Node.
 * All dates are local "YYYY-MM-DD" strings. Date math runs in UTC on the Y-M-D parts,
 * which makes it immune to DST changes and timezone changes (no phantom missed days).
 */

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date of a JS Date as YYYY-MM-DD. */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function addDays(s, n) {
  const t = new Date(toUTC(s) + n * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
/** 0 = Sunday ... 6 = Saturday */
export const weekdayOf = (s) => new Date(toUTC(s)).getUTCDay();
/** Monday of the week containing s. */
export const weekStart = (s) => addDays(s, -((weekdayOf(s) + 6) % 7));
/** Position of a weekday with Monday = 0. */
export const monIndex = (wd) => (wd + 6) % 7;

export const DEFAULT_PHASE_RULES = {
  A: { fromWeek: 1, sets: 2, weightPct: 60, effort: 'Stop 3-4 reps short of failure' },
  B: { fromWeek: 3, sets: 3, weightPct: 100, effort: 'Stop 2-3 reps short of failure' },
  C: { fromWeek: 5, sets: null, weightPct: 100, effort: 'Last set 1-2 reps short, never total failure' },
};

export const DEFAULT_GAP_RULES = [
  { minDays: 14, tier: 'restart', pct: 70, sets: 2, forcePhase: 'A', effort: 'Stop 3-4 reps short of failure' },
  { minDays: 7, tier: 'long', pct: 80, sets: 2 },
  { minDays: 3, tier: 'short', pct: 90, setDelta: -1 },
];

/** Program week = floor(completed / cycleLength) + 1, unless manually overridden. */
export function programWeek(completed, override = null, cycleLength = 5) {
  if (override && override > 0) return override;
  return Math.floor(completed / Math.max(1, cycleLength)) + 1;
}
export function phaseFor(week, rules = DEFAULT_PHASE_RULES) {
  if (week >= rules.C.fromWeek) return 'C';
  if (week >= rules.B.fromWeek) return 'B';
  return 'A';
}

/** Days since the last completed session (never negative, 0 when unknown). */
export function gapDays(lastCompletedDate, today) {
  if (!lastCompletedDate) return 0;
  return Math.max(0, daysBetween(lastCompletedDate, today));
}
/** Returns the matching gap rule (with gapDays attached) or null for a normal session. */
export function gapAdjustment(gap, rules = DEFAULT_GAP_RULES) {
  const r = rules.find((x) => gap >= x.minDays);
  return r ? { ...r, gapDays: gap } : null;
}

/* ---------- Rolling queue ---------- */

/** Make queue a permutation of dayIds, keeping known order and appending new days. */
export function normalizeQueue(queue, dayIds) {
  const q = (queue || []).filter((id) => dayIds.includes(id));
  for (const id of dayIds) if (!q.includes(id)) q.push(id);
  return q;
}
/** After finishing or skipping a day it goes to the back; the rest keep their order. */
export const completeInQueue = (q, id) => [...q.filter((x) => x !== id), id];
/** Put id at a given slot index. */
export function moveInQueue(q, id, index) {
  const r = q.filter((x) => x !== id);
  r.splice(Math.max(0, Math.min(index, r.length)), 0, id);
  return r;
}
/** How many training slots lie in [from, target)? Used to reflow the queue for "move to a day". */
export function trainingSlotIndex(from, target, trainingWeekdays) {
  let n = 0;
  for (let d = from; daysBetween(d, target) > 0; d = addDays(d, 1)) {
    if (trainingWeekdays.includes(weekdayOf(d))) n++;
  }
  return n;
}

/* ---------- Missed days ---------- */

const RESOLVED = ['completed', 'skipped', 'rest', 'moved', 'in_progress'];

/**
 * Past training weekdays with no completed/skipped/rest/moved/in-progress record.
 * Weekend days are optional extension days and are never flagged. Paused periods are ignored.
 * @returns {string[]} ascending dates
 */
export function detectMissed({ today, startDate, sessions, trainingWeekdays = [1, 2, 3, 4, 5],
  paused = false, pauseRanges = [], maxLookbackDays = 14 }) {
  if (!startDate || paused) return [];
  const resolved = new Set(sessions.filter((s) => RESOLVED.includes(s.status)).map((s) => s.date));
  const from = [startDate, addDays(today, -maxLookbackDays)].sort().pop();
  const out = [];
  for (let d = from; daysBetween(d, today) > 0; d = addDays(d, 1)) {
    if (!trainingWeekdays.includes(weekdayOf(d))) continue;
    if (resolved.has(d)) continue;
    if (pauseRanges.some((r) => d >= r.from && d <= r.to)) continue;
    out.push(d);
  }
  return out;
}

/** Sessions of the Mon-Sun week containing `date` that count toward the cycle. */
export function weekProgress(sessions, date) {
  const a = weekStart(date), b = addDays(a, 6);
  return sessions.filter((s) => s.date >= a && s.date <= b && !s.adhoc &&
    (s.status === 'completed' || s.status === 'skipped')).length;
}

/**
 * What should Today show?
 * state: in_progress | done | paused | rest | planned
 * A day is a training day when the week's cycle is not yet complete and the weekday is a default
 * training weekday, or a weekend (after the last training weekday) when the cycle is still short.
 */
export function todayPlan({ today, sessions, queue, trainingWeekdays = [1, 2, 3, 4, 5], paused = false }) {
  const nextDayId = queue[0] || null;
  const open = sessions.find((s) => s.status === 'in_progress');
  if (open) return { state: 'in_progress', session: open, nextDayId, reason: 'You have a workout in progress.' };
  if (paused) return { state: 'paused', nextDayId, reason: 'Schedule is paused. Nothing counts as missed.' };
  const doneToday = sessions.find((s) => s.date === today && s.status === 'completed' && !s.adhoc);
  if (doneToday) return { state: 'done', session: doneToday, nextDayId, reason: 'Done for today. Nice work.' };
  const manualRest = sessions.find((s) => s.date === today && s.status === 'rest');
  if (manualRest) return { state: 'rest', nextDayId, manual: true, reason: 'Rest day, as you chose.' };
  const n = queue.length;
  const count = weekProgress(sessions, today);
  const wd = weekdayOf(today);
  const lastTrain = Math.max(...trainingWeekdays.map(monIndex), -1);
  const isTrainingDay = trainingWeekdays.includes(wd);
  const isExtension = !isTrainingDay && monIndex(wd) > lastTrain && count < n;
  if (count >= n) return { state: 'rest', nextDayId, reason: 'Full cycle done this week. Rest and recover.' };
  if (isTrainingDay) return { state: 'planned', nextDayId, reason: 'Next in your cycle.' };
  if (isExtension) return { state: 'planned', nextDayId, extension: true,
    reason: 'You are behind this week, so the weekend becomes a training day.' };
  return { state: 'rest', nextDayId, reason: 'Rest day.' };
}

/* ---------- Protections ---------- */

/** True if a heavy-crunch session happened on the day before or after `date`. */
export function heavyCrunchConflict(date, sessions) {
  const y = addDays(date, -1), t = addDays(date, 1);
  return sessions.some((s) => s.heavyCrunch && (s.date === y || s.date === t) &&
    (s.status === 'completed' || s.status === 'in_progress'));
}

const GROUPS = [
  ['chest', /chest|pec/i], ['shoulders', /front delt|side delt|^delts?$/i],
  ['back', /lats|mid-back/i], ['biceps', /bicep/i], ['triceps', /tricep/i],
  ['quads', /quad/i], ['hamstrings', /hamstring/i], ['calves', /calve/i],
];
/** Reduce muscle names to major groups (rear delts, glutes and abs are deliberately ignored). */
export function muscleGroups(list) {
  const out = new Set();
  for (const m of list || []) for (const [g, re] of GROUPS) if (re.test(m.trim())) out.add(g);
  return [...out];
}
/** Major groups shared with a completed session on the previous day. */
export function backToBackMuscles(groups, date, sessions) {
  const y = addDays(date, -1);
  const prev = sessions.filter((s) => s.date === y && s.status === 'completed' && !s.adhoc);
  const shared = new Set();
  for (const s of prev) for (const g of s.muscleGroups || []) if (groups.includes(g)) shared.add(g);
  return [...shared];
}

/* ---------- Stats ---------- */

/** Consecutive cycle sessions completed without a skip, newest first. */
export function streak(sessions) {
  const list = sessions.filter((s) => (s.status === 'completed' && !s.adhoc) || s.status === 'skipped')
    .sort((a, b) => (b.date + (b.startedAt || 0)).localeCompare(a.date + (a.startedAt || 0)));
  let n = 0;
  for (const s of list) { if (s.status !== 'completed') break; n++; }
  return n;
}
